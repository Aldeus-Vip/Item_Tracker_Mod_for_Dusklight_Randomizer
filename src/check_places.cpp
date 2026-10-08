#include "check_places.hpp"

#include "gx_texture.hpp"
#include "json_writer.hpp"
#include "tracker_state.hpp"

#include "d/d_com_inf_game.h"

#include <dolphin/dvd.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <set>
#include <sstream>

namespace tracker::places {
namespace {

constexpr const char* kCacheVersion = "check-places 17";
constexpr uint32_t kReadPerFrame = 512 * 1024;  // bytes read from the disc each frame

// Checks so far placed only from a layer chunk (stage/key).
std::set<std::string> g_layered;

uint32_t be32(const uint8_t* p) {
    return (uint32_t{p[0]} << 24) | (uint32_t{p[1]} << 16) | (uint32_t{p[2]} << 8) | p[3];
}
uint16_t be16(const uint8_t* p) { return static_cast<uint16_t>((p[0] << 8) | p[1]); }
float befloat(const uint8_t* p) {
    const uint32_t v = be32(p);
    float f;
    std::memcpy(&f, &v, sizeof f);
    return f;
}

// A chunk's data. Room files the game has loaded have their offsets made relative to the offset
// field itself (OffsetPtr, top bit set); files as on the disc count from the start of the file.
const uint8_t* chunk_data(const uint8_t* file, const uint8_t* node) {
    const uint32_t raw = be32(node + 8);
    if ((raw & 0x80000000u) == 0) return file + raw;
    const int32_t rel = (raw & 0x40000000u) ? static_cast<int32_t>(raw) : static_cast<int32_t>(raw & 0x7FFFFFFFu);
    return node + 8 + rel;
}

// Yaz0 (the disc's compression).
bool yaz0_decode(const std::vector<uint8_t>& in, std::vector<uint8_t>& out) {
    if (in.size() < 16 || std::memcmp(in.data(), "Yaz0", 4) != 0) return false;
    const uint32_t size = be32(in.data() + 4);
    out.assign(size, 0);
    size_t src = 16;
    size_t dst = 0;
    while (dst < size && src < in.size()) {
        const uint8_t code = in[src++];
        for (int bit = 7; bit >= 0 && dst < size; bit--) {
            if (code & (1 << bit)) {
                if (src >= in.size()) return false;
                out[dst++] = in[src++];
            } else {
                if (src + 1 >= in.size()) return false;
                const uint8_t b1 = in[src++];
                const uint8_t b2 = in[src++];
                const size_t back = (((b1 & 0x0F) << 8) | b2) + 1;
                size_t count = b1 >> 4;
                if (count == 0) {
                    if (src >= in.size()) return false;
                    count = in[src++] + 0x12;
                } else {
                    count += 2;
                }
                if (back > dst) return false;
                for (size_t i = 0; i < count && dst < size; i++, dst++) out[dst] = out[dst - back];
            }
        }
    }
    return dst == size;
}

// The files of a RARC archive: name -> (data, size).
struct ArcFile {
    std::string name;
    const uint8_t* data;
    uint32_t size;
};

std::vector<ArcFile> rarc_files(const std::vector<uint8_t>& arc) {
    std::vector<ArcFile> out;
    if (arc.size() < 0x40 || std::memcmp(arc.data(), "RARC", 4) != 0) return out;
    const uint8_t* b = arc.data();
    const uint32_t dataStart = 0x20 + be32(b + 0x0C);
    const uint8_t* info = b + 0x20;
    const uint32_t numEntries = be32(info + 0x08);
    const uint32_t entryOffset = 0x20 + be32(info + 0x0C);
    const uint32_t stringOffset = 0x20 + be32(info + 0x14);
    if (entryOffset + numEntries * 0x14 > arc.size() || stringOffset > arc.size()) return out;
    for (uint32_t i = 0; i < numEntries; i++) {
        const uint8_t* e = b + entryOffset + i * 0x14;
        const uint8_t flags = e[4];
        if ((flags & 0x02) != 0 || (flags & 0x01) == 0) continue;  // directories
        const uint32_t nameOffset = stringOffset + be16(e + 6);
        const uint32_t data = dataStart + be32(e + 8);
        const uint32_t size = be32(e + 0xC);
        if (nameOffset >= arc.size() || data + size > arc.size()) continue;
        const char* name = reinterpret_cast<const char*>(b + nameOffset);
        out.push_back({std::string{name, strnlen(name, arc.size() - nameOffset)}, b + data, size});
    }
    return out;
}

// ---- Reading the disc ----

struct Job {
    std::string stage;
    std::string path;
    int room;  // R<room>_00.arc; -1: the stage archive
};

enum class Phase { Idle, Cache, List, Read, Done };

Phase g_phase = Phase::Idle;
std::string g_cacheFile;
std::vector<Job> g_jobs;
size_t g_job = 0;
std::map<std::string, std::vector<Place>> g_places;
// Each stage's map (rooms' shapes as JSON objects, by room) and its floor spacing (STAG).
std::map<std::string, std::map<int, std::string>> g_maps;
struct FloorSpacing {
    float gap = 0;
    float rangeUp = 0;
    float rangeDown = 0;
    int mapKind = 0;  // STAG "up button": 2, 3, 6 = the map shows only the room Link is in
    int saveTbl = -1;  // the stage's switches and chests in the save (dStage_stagInfo_GetSaveTbl)
};
// The doors the maps mark (the "Door" chunks of stage.dzs and the rooms: stage_tgsc_data_class),
// as the game keeps them (dStage_KeepDoorInfo).
struct Door {
    std::string name;
    uint32_t prm = 0;
    int angleY = 0;
    int angleZ = 0;
    float x = 0;
    float y = 0;
    float z = 0;
    bool stageDoor = false;  // placed by the stage file: moved by its front room's offset
};
std::map<std::string, std::vector<Door>> g_doors;
std::map<std::string, std::vector<Shutter>> g_shutters;  // in room coordinates (to_map when served)
// Where Link starts in a room by the point an exit sends him to (PLYR: the point is the low byte of
// angle.z), for placing entrances on the maps.
struct Spawn {
    int room;
    int point;
    float x;
    float y;
    float z;
};
std::map<std::string, std::vector<Spawn>> g_spawns;
// Overworld rooms the game has no map for (the Sacred Grove's): their ground from the room's
// collision (room.dzb or room.kcl), its triangles facing up in room coordinates (x, z; water marked),
// made into a map once all is read (finish_ground_maps).
struct GroundTri {
    float x[3];
    float z[3];
    bool water = false;
    float y = 0;  // its height (the middle)
};
std::map<std::string, std::map<int, std::vector<GroundTri>>> g_ground;
// What was found for each overworld room's ground (its files, triangles), shown on the debug page.
std::map<std::string, std::map<int, std::string>> g_groundInfo;

// The walkable ground of a room's collision (cBgD_t: vertices, triangles): triangles facing up.
void read_ground(const std::string& stage, int room, const std::vector<uint8_t>& dzb) {
    std::string& info = g_groundInfo[stage][room];
    info += "room.dzb " + std::to_string(dzb.size()) + " bytes";
    if (dzb.size() < 0x34) return;
    const uint8_t* b = dzb.data();
    const uint32_t vNum = be32(b);
    const uint32_t vOff = be32(b + 4);
    const uint32_t tNum = be32(b + 8);
    const uint32_t tOff = be32(b + 0xC);
    info += ", " + std::to_string(vNum) + " vertices, " + std::to_string(tNum) + " triangles";
    if (vNum == 0 || tNum == 0 || vOff + vNum * 12 > dzb.size() || tOff + tNum * 10 > dzb.size()) {
        info += " (out of the file)";
        return;
    }
    const auto vtx = [&](uint32_t i, float out[3]) {
        const uint8_t* v = b + vOff + i * 12;
        out[0] = befloat(v);
        out[1] = befloat(v + 4);
        out[2] = befloat(v + 8);
    };
    std::vector<GroundTri> tris;
    for (uint32_t i = 0; i < tNum; i++) {
        const uint8_t* t = b + tOff + i * 10;
        const uint32_t ia = be16(t), ib = be16(t + 2), ic = be16(t + 4);
        if (ia >= vNum || ib >= vNum || ic >= vNum) continue;
        float a[3], c1[3], c2[3];
        vtx(ia, a);
        vtx(ib, c1);
        vtx(ic, c2);
        const float ux = c1[0] - a[0], uy = c1[1] - a[1], uz = c1[2] - a[2];
        const float vx = c2[0] - a[0], vy = c2[1] - a[1], vz = c2[2] - a[2];
        const float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const float len = std::sqrt(nx * nx + ny * ny + nz * nz);
        if (len < 1e-3f || std::fabs(ny) / len < 0.55f) continue;  // walls and ceilings
        tris.push_back({{a[0], c1[0], c2[0]}, {a[2], c1[2], c2[2]}, false, (a[1] + c1[1] + c2[1]) / 3});
    }
    info += ", " + std::to_string(tris.size()) + " ground";
    if (!tris.empty()) g_ground[stage][room] = std::move(tris);
}

// The same from a room's KCL collision (room.kcl, KC_Header: the Sacred Grove's rooms), its prisms
// made into triangles as dBgWKCol::GetTriPnt does; water from the room's poly codes (room.plc,
// sBgPlc: dBgPc::getWtr).
void read_ground_kcl(const std::string& stage, int room, const std::vector<uint8_t>& kcl, const std::vector<uint8_t>& plc) {
    std::string& info = g_groundInfo[stage][room];
    info += "room.kcl " + std::to_string(kcl.size()) + " bytes";
    if (kcl.size() < 0x38) return;
    const uint8_t* b = kcl.data();
    const uint32_t posOff = be32(b), nrmOff = be32(b + 4), prismOff = be32(b + 8), blockOff = be32(b + 0xC);
    const auto count = [&](uint32_t from, uint32_t to, uint32_t each) {
        return from < to && to <= kcl.size() ? (to - from) / each : from < kcl.size() ? static_cast<uint32_t>((kcl.size() - from) / each) : 0u;
    };
    const uint32_t posNum = count(posOff, nrmOff, 12);
    const uint32_t nrmNum = count(nrmOff, prismOff, 12);
    const uint32_t prismNum = count(prismOff, blockOff, 0x10);
    // The poly codes: "SPLC", entry size, count, then 0x14-byte entries.
    const uint32_t codeSize = plc.size() >= 8 ? be16(plc.data() + 4) : 0;
    const uint32_t codeNum = plc.size() >= 8 ? be16(plc.data() + 6) : 0;
    const bool codes = codeSize >= 0x14 && 8 + codeSize * codeNum <= plc.size();
    info += ", " + std::to_string(posNum) + " points, " + std::to_string(prismNum) + " prisms" + (codes ? ", " + std::to_string(codeNum) + " codes" : ", no room.plc");
    using V = std::array<float, 3>;
    const auto vec = [&](uint32_t off, uint32_t i) { const uint8_t* p = b + off + i * 12; return V{befloat(p), befloat(p + 4), befloat(p + 8)}; };
    const auto cross = [](const V& a, const V& c) { return V{a[1] * c[2] - a[2] * c[1], a[2] * c[0] - a[0] * c[2], a[0] * c[1] - a[1] * c[0]}; };
    const auto dot = [](const V& a, const V& c) { return a[0] * c[0] + a[1] * c[1] + a[2] * c[2]; };
    std::vector<GroundTri> tris;
    int water = 0;
    for (uint32_t i = 0; i < prismNum; i++) {
        const uint8_t* pd = b + prismOff + i * 0x10;
        const float height = befloat(pd);
        const uint32_t pi = be16(pd + 4), fi = be16(pd + 6), e1 = be16(pd + 8), e2 = be16(pd + 0xA), e3 = be16(pd + 0xC);
        const uint32_t attr = be16(pd + 0xE);
        if (pi >= posNum || fi >= nrmNum || e1 >= nrmNum || e2 >= nrmNum || e3 >= nrmNum) continue;
        const V face = vec(nrmOff, fi);
        if (!(face[1] >= 0.55f) || std::fabs(dot(face, face) - 1.0f) > 0.1f) continue;  // walls, ceilings
        const V a = vec(posOff, pi);
        const V n3 = vec(nrmOff, e3);
        const V c1 = cross(face, vec(nrmOff, e1));
        const V c2 = cross(vec(nrmOff, e2), face);
        const float d1 = dot(c1, n3);
        const float d2 = dot(c2, n3);
        if (std::fabs(d1) < 1e-6f || std::fabs(d2) < 1e-6f || !std::isfinite(height)) continue;
        const float s1 = height / d1, s2 = height / d2;
        const V p2{a[0] + c1[0] * s1, a[1] + c1[1] * s1, a[2] + c1[2] * s1};
        const V p1{a[0] + c2[0] * s2, a[1] + c2[1] * s2, a[2] + c2[2] * s2};
        if (!std::isfinite(p1[0]) || !std::isfinite(p2[0]) || !std::isfinite(p1[2]) || !std::isfinite(p2[2])) continue;
        GroundTri t{{a[0], p1[0], p2[0]}, {a[2], p1[2], p2[2]}, false, (a[1] + p1[1] + p2[1]) / 3};
        if (codes && attr < codeNum) t.water = (be32(plc.data() + 8 + attr * codeSize + 0x10) & (1u << 8)) != 0;
        water += t.water ? 1 : 0;
        tris.push_back(t);
    }
    // Water surfaces reach under the banks: the water is shown on the ground under them (the
    // riverbed), which follows the land's shape, and the surfaces themselves are left out.
    std::vector<GroundTri> surfaces;
    std::vector<GroundTri> ground;
    for (GroundTri& t : tris) (t.water ? surfaces : ground).push_back(t);
    if (!surfaces.empty()) {
        const float cell = 1000.0f;
        std::map<std::pair<int, int>, std::vector<int>> buckets;
        for (int i = 0; i < static_cast<int>(surfaces.size()); i++) {
            const GroundTri& w = surfaces[i];
            const int c0 = static_cast<int>(std::floor(std::min({w.x[0], w.x[1], w.x[2]}) / cell));
            const int c1 = static_cast<int>(std::floor(std::max({w.x[0], w.x[1], w.x[2]}) / cell));
            const int r0 = static_cast<int>(std::floor(std::min({w.z[0], w.z[1], w.z[2]}) / cell));
            const int r1 = static_cast<int>(std::floor(std::max({w.z[0], w.z[1], w.z[2]}) / cell));
            if ((c1 - c0 + 1) * (r1 - r0 + 1) > 4096) continue;
            for (int c = c0; c <= c1; c++) for (int r = r0; r <= r1; r++) buckets[{c, r}].push_back(i);
        }
        const auto inside = [](const GroundTri& w, float px, float pz) {
            const float d = (w.z[1] - w.z[2]) * (w.x[0] - w.x[2]) + (w.x[2] - w.x[1]) * (w.z[0] - w.z[2]);
            if (std::fabs(d) < 1e-6f) return false;
            const float l1 = ((w.z[1] - w.z[2]) * (px - w.x[2]) + (w.x[2] - w.x[1]) * (pz - w.z[2])) / d;
            const float l2 = ((w.z[2] - w.z[0]) * (px - w.x[2]) + (w.x[0] - w.x[2]) * (pz - w.z[2])) / d;
            return l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0;
        };
        int wet = 0;
        for (GroundTri& g : ground) {
            const float cx = (g.x[0] + g.x[1] + g.x[2]) / 3, cz = (g.z[0] + g.z[1] + g.z[2]) / 3;
            const auto it = buckets.find({static_cast<int>(std::floor(cx / cell)), static_cast<int>(std::floor(cz / cell))});
            if (it == buckets.end()) continue;
            for (int i : it->second) {
                if (surfaces[i].y > g.y + 1.0f && inside(surfaces[i], cx, cz)) {
                    g.water = true;
                    wet++;
                    break;
                }
            }
        }
        info += ", " + std::to_string(wet) + " under water";
    }
    tris = std::move(ground);
    info += ", " + std::to_string(tris.size()) + " ground (" + std::to_string(water) + " water surfaces)";
    if (!tris.empty()) g_ground[stage][room] = std::move(tris);
}

// The ground maps of the rooms with no map of their own, in the map's coordinates (by the rooms'
// offsets), in the format of the game's maps: one floor; water (type 5) under the ground (type
// 0), each triangle a strip of three; the ground's outline (edges of one triangle only) as lines.
void finish_ground_maps() {
    for (auto& [stage, rooms] : g_ground) {
        for (auto& [room, tris] : rooms) {
            // A room with a map of its own keeps it, unless that map has nothing to draw.
            const auto own = g_maps[stage].find(room);
            if (own != g_maps[stage].end() && own->second.find(R"("polys":[{)") != std::string::npos) {
                g_groundInfo[stage][room] += "; its own map (MPAT) is drawn";
                continue;
            }
            if (own != g_maps[stage].end()) g_groundInfo[stage][room] += "; its own map (MPAT) has no shapes: the ground is drawn";
            // Shared points (rounded to a unit), so triangles meet and outlines can be found.
            std::map<std::pair<int, int>, int> index;
            std::vector<std::pair<float, float>> points;
            const auto point = [&](float x, float z) {
                const std::pair<int, int> k{static_cast<int>(std::lround(x)), static_cast<int>(std::lround(z))};
                const auto it = index.find(k);
                if (it != index.end()) return it->second;
                const int i = static_cast<int>(points.size());
                index.emplace(k, i);
                float mx = x, mz = z;
                to_map(stage, room, mx, mz);
                points.emplace_back(mx, mz);
                return i;
            };
            struct Tri { int v[3]; bool water; };
            std::vector<Tri> out;
            for (const GroundTri& t : tris) {
                Tri o{{point(t.x[0], t.z[0]), point(t.x[1], t.z[1]), point(t.x[2], t.z[2])}, t.water};
                if (o.v[0] == o.v[1] || o.v[1] == o.v[2] || o.v[0] == o.v[2]) continue;
                out.push_back(o);
            }
            std::stable_sort(out.begin(), out.end(), [](const Tri& l, const Tri& r) { return l.water > r.water; });
            // The outline: edges of the ground (not water) used by one triangle only, joined into lines.
            std::map<std::pair<int, int>, int> edges;
            for (const Tri& t : out) {
                if (t.water) continue;
                for (int k = 0; k < 3; k++) {
                    const int a = t.v[k], c = t.v[(k + 1) % 3];
                    edges[{std::min(a, c), std::max(a, c)}]++;
                }
            }
            std::multimap<int, int> next;
            for (const auto& [e, n] : edges) {
                if (n != 1) continue;
                next.emplace(e.first, e.second);
                next.emplace(e.second, e.first);
            }
            std::vector<std::vector<int>> lines;
            while (!next.empty()) {
                std::vector<int> line{next.begin()->first};
                for (;;) {
                    const auto it = next.find(line.back());
                    if (it == next.end()) break;
                    const int to = it->second;
                    next.erase(it);
                    for (auto r = next.equal_range(to); r.first != r.second; ++r.first) {
                        if (r.first->second == line.back()) {
                            next.erase(r.first);
                            break;
                        }
                    }
                    line.push_back(to);
                }
                if (line.size() >= 2) lines.push_back(std::move(line));
            }
            g_groundInfo[stage][room] += "; map: " + std::to_string(out.size()) + " triangles, " + std::to_string(lines.size()) + " outlines";
            JsonWriter w;
            w.beginObject();
            w.member("no", room);
            w.member("ground", true);
            w.key("floors").beginArray().beginObject();
            w.member("no", 0);
            w.key("groups").beginArray().beginObject();
            w.member("sw", 255);
            w.member("swType", 1);
            w.member("shown", true);
            w.key("polys").beginArray();
            for (const Tri& t : out) {
                w.beginObject();
                w.member("type", t.water ? 5 : 0);
                w.key("strip").beginArray().value(t.v[0]).value(t.v[1]).value(t.v[2]).endArray();
                w.endObject();
            }
            w.endArray();
            w.key("lines").beginArray();
            for (const auto& line : lines) {
                w.beginObject();
                w.member("type", 0);
                w.member("width", 1);
                w.key("strip").beginArray();
                for (int v : line) w.value(v);
                w.endArray();
                w.endObject();
            }
            w.endArray();
            w.endObject().endArray();
            w.endObject().endArray();
            w.key("vertices").beginArray();
            for (const auto& [x, z] : points) {
                w.number(x, 0);
                w.number(z, 0);
            }
            w.endArray();
            w.endObject();
            g_maps[stage][room] = w.str();
        }
    }
    g_ground.clear();
}
// The map screen's icons of a stage (TRES in the stage archive's room<n>.dzs: dTres_c::data_s):
// monkeys, iron balls, statues, Sols, Ooccoo, small keys...
struct Icon {
    int type;
    int room;
    int sw;
    float x;
    float y;
    float z;
};
std::map<std::string, std::vector<Icon>> g_icons;
// Each room's place on the map (FILI: dStage_FileList2_dt_c offset and turn): actors are placed in
// world coordinates, the map is drawn in map coordinates (dMapInfo_n::correctionOriginPos).
struct RoomShift {
    float x = 0;
    float z = 0;
    int turn = 0;
    // The room's lowest and highest floor (dMapInfo_c::calcFloorNo keeps a room's things in them).
    int minFloor = -128;
    int maxFloor = 127;
};
std::map<std::string, std::map<int, RoomShift>> g_shifts;
std::map<std::string, FloorSpacing> g_floors;
std::string g_json = R"({"done":false,"read":0,"total":0})";

// The archive being read.
DVDFileInfo g_file;
bool g_open = false;
std::vector<uint8_t> g_buffer;
uint32_t g_readBytes = 0;

std::vector<std::string> list_dir(const std::string& dir, bool dirs) {
    std::vector<std::string> out;
    DVDDir d;
    if (!DVDOpenDir(dir.c_str(), &d)) return out;
    DVDDirEntry e;
    while (DVDReadDir(&d, &e)) {
        if (e.name != nullptr && (e.isDir != FALSE) == dirs) out.emplace_back(e.name);
    }
    DVDCloseDir(&d);
    return out;
}

void list_jobs() {
    g_jobs.clear();
    for (const std::string& stage : list_dir("/res/Stage", true)) {
        const std::string dir = "/res/Stage/" + stage;
        for (const std::string& file : list_dir(dir, false)) {
            std::string lower = file;
            for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            int room = -2;
            int layer = 0;
            if (std::sscanf(lower.c_str(), "r%d_%d.arc", &room, &layer) == 2) {
                if (layer != 0) continue;
            } else if (lower == "stg_00.arc") {
                room = -1;
            } else {
                continue;
            }
            g_jobs.push_back({stage, dir + "/" + file, room});
        }
    }
}

// A room's map shapes (MPAT: room_class, floors, groups, polys, lines; offsets from the room's
// start, see dMpath_c::setPointer) as JSON in the format of map_data.hpp, or "" if not valid.
std::string room_map_json(int roomNo, const uint8_t* file, uint32_t size, const uint8_t* room) {
    const uint8_t* end = file + size;
    auto inside = [&](const uint8_t* p, uint32_t n) { return p >= file && p + n <= end; };
    if (!inside(room, 12)) return "";
    const int floorNum = room[0];
    const uint8_t* floors = room + be32(room + 4);
    const uint8_t* floats = room + be32(room + 8);
    if (floorNum < 1 || floorNum > 16 || !inside(floors, floorNum * 8)) return "";
    JsonWriter w;
    w.beginObject();
    w.member("no", roomNo);
    int maxIndex = -1;
    auto strip = [&](const uint8_t* data, int count) -> bool {
        if (!inside(data, count * 2)) return false;
        w.key("strip").beginArray();
        for (int i = 0; i < count; i++) {
            const int index = be16(data + i * 2);
            maxIndex = std::max(maxIndex, index);
            w.value(index);
        }
        w.endArray();
        return true;
    };
    w.key("floors").beginArray();
    for (int f = 0; f < floorNum; f++) {
        const uint8_t* fl = floors + f * 8;
        const int groupNum = fl[1];
        const uint8_t* groups = room + be32(fl + 4);
        if (!inside(groups, groupNum * 0x14)) return "";
        w.beginObject();
        w.member("no", static_cast<int>(static_cast<int8_t>(fl[0])));
        w.key("groups").beginArray();
        for (int g = 0; g < groupNum; g++) {
            const uint8_t* gr = groups + g * 0x14;
            const int sw = gr[0];
            const int swType = gr[1];
            const int lineNum = gr[2];
            const int polyNum = gr[4];
            const uint8_t* lines = room + be32(gr + 8);
            const uint8_t* polys = room + be32(gr + 0x10);
            if ((lineNum && !inside(lines, lineNum * 8)) || (polyNum && !inside(polys, polyNum * 8))) return "";
            w.beginObject();
            w.member("sw", sw);
            w.member("swType", swType);
            // Another stage's switches are not known here: groups shown by default.
            w.member("shown", sw == 0xFF || swType == 0);
            w.key("polys").beginArray();
            for (int i = 0; i < polyNum; i++) {
                const uint8_t* p = polys + i * 8;
                w.beginObject();
                w.member("type", static_cast<int>(p[0]));
                if (!strip(room + be32(p + 4), p[1])) return "";
                w.endObject();
            }
            w.endArray();
            w.key("lines").beginArray();
            for (int i = 0; i < lineNum; i++) {
                const uint8_t* l = lines + i * 8;
                w.beginObject();
                w.member("type", static_cast<int>(l[0]));
                w.member("width", static_cast<int>(l[1]));
                if (!strip(room + be32(l + 4), l[2])) return "";
                w.endObject();
            }
            w.endArray();
            w.endObject();
        }
        w.endArray();
        w.endObject();
    }
    w.endArray();
    if (!inside(floats, (maxIndex + 1) * 8)) return "";
    w.key("vertices").beginArray();
    for (int i = 0; i <= maxIndex; i++) {
        w.number(befloat(floats + i * 8));
        w.number(befloat(floats + i * 8 + 4));
    }
    w.endArray();
    w.endObject();
    return w.str();
}

// The map of a room file (its MPAT chunk), its map icons (TRES, in the stage archive's room
// files), and the floor spacing of a stage file (STAG).
void parse_room_map(const std::string& stage, int roomNo, const uint8_t* b, uint32_t size, bool stageArchiveRoom) {
    const uint32_t chunks = be32(b);
    if (chunks > 256 || 4 + chunks * 12 > size) return;
    for (uint32_t c = 0; c < chunks; c++) {
        const uint8_t* node = b + 4 + c * 12;
        const uint8_t* data = chunk_data(b, node);
        if (data < b || data + 8 > b + size) continue;
        if (std::memcmp(node, "STAG", 4) == 0 && data + 0x20 <= b + size) {
            const auto s16 = [](const uint8_t* p) { return static_cast<float>(static_cast<int16_t>(be16(p))); };
            g_floors[stage] = {s16(data + 0x1A), std::fabs(s16(data + 0x1C)), std::fabs(s16(data + 0x1E)), be16(data + 0x0A) & 7, (data[0x09] >> 1) & 0x1F};
        }
        // Doors of all story stages too (layer chunks Doo0..Doob: Forest Temple keeps its doors there).
        if (std::memcmp(node, "Doo", 3) == 0) {
            const uint32_t num = be32(node + 4);
            for (uint32_t i = 0; i < num && i < 0x40 && data + (i + 1) * 0x24 <= b + size; i++) {
                const uint8_t* e = data + i * 0x24;
                Door d;
                char name[9] = {};
                std::memcpy(name, e, 8);
                d.name = name;
                d.prm = be32(e + 8);
                d.x = befloat(e + 0x0C);
                d.y = befloat(e + 0x10);
                d.z = befloat(e + 0x14);
                d.angleY = be16(e + 0x1A);
                d.angleZ = be16(e + 0x1C);
                d.stageDoor = roomNo < 0;
                bool known = false;
                for (const Door& o : g_doors[stage]) known = known || (o.name == d.name && o.x == d.x && o.z == d.z && o.y == d.y);
                if (!known && !d.name.empty()) g_doors[stage].push_back(std::move(d));
            }
        }
        // (The stage archive's room files carry the map's FILI, dStage_FileList2_dt_c; a room's own
        // file has another FILI.)
        if (stageArchiveRoom && roomNo >= 0 && std::memcmp(node, "FILI", 4) == 0 && be32(node + 4) > 0 && data + 0x20 <= b + size) {
            g_shifts[stage][roomNo] = {befloat(data + 0x14), befloat(data + 0x18), static_cast<int16_t>(be16(data + 0x1C)),
                                       static_cast<int8_t>(data[0x10]), static_cast<int8_t>(data[0x11])};
        }
        if (stageArchiveRoom && roomNo >= 0 && std::memcmp(node, "TRE", 3) == 0) {
            const uint32_t num = be32(node + 4);
            for (uint32_t i = 0; i < num && data + (i + 1) * 0x14 <= b + size && i < 512; i++) {
                const uint8_t* e = data + i * 0x14;
                // The file keeps the icon's type; the map screen draws by type group
                // (dTres_c::typeToTypeGroup: 0 chest -> 1, 1 small key -> 2, 2 boss -> 3, 0x80.. -> 9..).
                static const uint8_t kTypeToGroup[][2] = {{0xFF, 0}, {0x00, 1}, {0x01, 2}, {0x02, 3}, {0x03, 4}, {0x04, 5}, {0x05, 6},
                                                          {0x06, 7}, {0x07, 8}, {0x80, 9}, {0x81, 10}, {0x82, 11}, {0x83, 12},
                                                          {0x84, 13}, {0x85, 14}, {0x87, 15}, {0x88, 16}};
                int type = -1;
                for (const auto& m : kTypeToGroup) {
                    if (m[0] == e[0x11]) type = m[1];
                }
                // The groups drawn as icons (d_menu_dmap.cpp); chests (1) and the boss (3) too: a
                // chest's icon tells its room (resolve_duplicates).
                if (type != 1 && type != 2 && type != 3 && type != 9 && type != 11 && type != 12 && type != 13 && type != 14 && type != 15 &&
                    type != 16) {
                    continue;
                }
                const Icon icon{type, roomNo, e[0x10], befloat(e + 4), befloat(e + 8), befloat(e + 12)};
                bool known = false;
                for (const Icon& o : g_icons[stage]) {
                    known = known || (o.type == icon.type && o.room == icon.room && o.sw == icon.sw && o.x == icon.x && o.z == icon.z);
                }
                if (!known) g_icons[stage].push_back(icon);
            }
        }
        // The map (MPAT, MPA0); for Past Sacred Grove (F_SP117 room 2) also its other story layers
        // (MPA1..MPAe: dStage_setLayerTagName), where its map is kept.
        const char layer = static_cast<char>(node[3]);
        const bool layered = stage == "F_SP117" && roomNo == 2 && std::memcmp(node, "MPA", 3) == 0 &&
                             ((layer >= '1' && layer <= '9') || (layer >= 'a' && layer <= 'e'));
        // (The Sacred Grove's map chunks, for the debug page.)
        if (stage == "F_SP117" && roomNo >= 0 && std::memcmp(node, "MPA", 3) == 0) {
            g_groundInfo[stage][roomNo] += std::string(stageArchiveRoom ? "stage file " : "room file ") + std::string(reinterpret_cast<const char*>(node), 4) +
                                           (g_maps[stage].count(roomNo) ? " (a map is already read); " : "; ");
        }
        if (roomNo < 0 || (std::memcmp(node, "MPAT", 4) != 0 && std::memcmp(node, "MPA0", 4) != 0 && !layered)) continue;
        if (g_maps[stage].count(roomNo)) continue;
        // The chunk's data is the room's map itself (dStage_mapPathInit: the node's count and
        // offset read as a map_path_class); other layouts are tried in case.
        const uint32_t off = be32(data + 4);
        for (const uint8_t* room : {data, data + 8, b + off, data + 4 + off}) {
            std::string json = room_map_json(roomNo, b, size, room);
            if (!json.empty()) {
                if (stage == "F_SP117") g_groundInfo[stage][roomNo] += "read as its map; ";
                g_maps[stage][roomNo] = std::move(json);
                break;
            }
        }
    }
}

void parse_archive(const Job& job) {
    std::vector<uint8_t> plain;
    const std::vector<uint8_t>* arc = &g_buffer;
    if (yaz0_decode(g_buffer, plain)) arc = &plain;
    std::vector<Place>& out = g_places[job.stage];
    if (job.room >= 0 && job.stage.rfind("F_", 0) == 0) {
        std::string names;
        for (const ArcFile& f : rarc_files(*arc)) names += (names.empty() ? "" : " ") + f.name;
        g_groundInfo[job.stage][job.room] += "files: " + names + "; ";
    }
    std::vector<uint8_t> kcl;
    std::vector<uint8_t> plc;
    for (const ArcFile& f : rarc_files(*arc)) {
        int room = -2;
        // The Lost Woods' ground (F_SP117 room 3): the only room drawn from its collision.
        // (Past Sacred Grove's too, when its own map is not found: finish_ground_maps keeps a map.)
        const bool groundRoom = job.stage == "F_SP117" && (job.room == 2 || job.room == 3);
        if (f.name == "room.dzb" && groundRoom) {
            // An overworld room's collision: its ground, for a room with no map.
            std::vector<uint8_t> raw(f.data, f.data + f.size);
            std::vector<uint8_t> dzb;
            if (!yaz0_decode(raw, dzb)) dzb = std::move(raw);
            read_ground(job.stage, job.room, dzb);
            continue;
        }
        if ((f.name == "room.kcl" || f.name == "room.plc") && groundRoom) {
            // ... kept as KCL in some rooms (the Sacred Grove's), with its poly codes: read below.
            std::vector<uint8_t> raw(f.data, f.data + f.size);
            std::vector<uint8_t>& to = f.name == "room.kcl" ? kcl : plc;
            if (!yaz0_decode(raw, to)) to = std::move(raw);
            continue;
        }
        if (f.name == "room.dzr" && job.room >= 0) {
            room = job.room;
        } else if (job.room == -1 && f.name == "stage.dzs") {
            room = -1;
        } else if (job.room == -1 && std::sscanf(f.name.c_str(), "room%d.dzs", &room) == 1) {
            // a room kept in the stage archive
        } else {
            continue;
        }
        // A file can be compressed on its own too.
        std::vector<uint8_t> raw(f.data, f.data + f.size);
        std::vector<uint8_t> file;
        if (!yaz0_decode(raw, file)) file = std::move(raw);
        parse_room_file(job.stage, room, file.data(), static_cast<uint32_t>(file.size()), out);
        parse_room_map(job.stage, room, file.data(), static_cast<uint32_t>(file.size()), job.room == -1);
    }
    if (!kcl.empty()) read_ground_kcl(job.stage, job.room, kcl, plc);
}

// Reads a little of the current archive; true when the job is finished (read or skipped).
bool step_read() {
    const Job& job = g_jobs[g_job];
    if (!g_open) {
        const s32 entry = DVDConvertPathToEntrynum(job.path.c_str());
        if (entry < 0 || !DVDFastOpen(entry, &g_file)) return true;
        g_open = true;
        g_buffer.assign((g_file.length + 31) & ~31u, 0);
        g_readBytes = 0;
    }
    const uint32_t total = static_cast<uint32_t>(g_buffer.size());
    const uint32_t len = std::min(kReadPerFrame, total - g_readBytes);
    s32 got = 0;
    if (len > 0) got = DVDReadPrio(&g_file, g_buffer.data() + g_readBytes, static_cast<s32>(len), static_cast<s32>(g_readBytes), 2);
    if (got > 0) g_readBytes += static_cast<uint32_t>(got);
    if (g_readBytes < g_file.length) {
        if (got > 0) return false;
        // A read failed: skip this archive.
        DVDClose(&g_file);
        g_open = false;
        return true;
    }
    DVDClose(&g_file);
    g_open = false;
    g_buffer.resize(g_file.length);
    parse_archive(job);
    g_buffer.clear();
    g_buffer.shrink_to_fit();
    return true;
}

// ---- Dungeon map backgrounds ----
// The parchment the game's dungeon map is drawn on (/res/FieldMap/D_MNxx.arc, tex/bg.bti, as
// dMenu_DmapBg_c reads it), read from the disc when the page asks for it, a little each frame.

std::map<std::string, std::string> g_art;  // stage -> PNG ("" = could not be read)
std::map<std::string, std::string> g_artWhy;  // stage -> why it could not be read
std::vector<std::string> g_artQueue;
DVDFileInfo g_artFile;
bool g_artOpen = false;
std::vector<uint8_t> g_artBuffer;
uint32_t g_artRead = 0;

void finish_art(const std::string& stage) {
    std::vector<uint8_t> plain;
    const std::vector<uint8_t>* arc = &g_artBuffer;
    if (yaz0_decode(g_artBuffer, plain)) arc = &plain;
    std::string png;
    std::string names;
    for (const ArcFile& f : rarc_files(*arc)) {
        names += (names.empty() ? "" : " ") + f.name;
        if (f.name != "bg.bti") continue;
        std::vector<uint8_t> raw(f.data, f.data + f.size);
        std::vector<uint8_t> file;
        if (!yaz0_decode(raw, file)) file = std::move(raw);
        if (file.size() < 0x20) break;
        gx::Layer layer;
        layer.texture = gx::decode_timg(file.data(), file.size());
        layer.alphaEnabled = file[1] != 0;
        const gx::Image image = gx::compose({layer});
        if (image.width) png = gx::encode_png(image);
        else g_artWhy[stage] = "bg.bti format " + std::to_string(file[0]) + " could not be decoded";
        break;
    }
    if (png.empty() && !g_artWhy.count(stage)) g_artWhy[stage] = "no bg.bti in the archive (" + names + ")";
    g_art[stage] = std::move(png);
}

void step_art() {
    if (g_artQueue.empty()) return;
    const std::string stage = g_artQueue.front();
    if (!g_artOpen) {
        const std::string path = "/res/FieldMap/" + stage + ".arc";
        const s32 entry = DVDConvertPathToEntrynum(path.c_str());
        if (entry < 0 || !DVDFastOpen(entry, &g_artFile)) {
            g_art[stage] = "";
            g_artWhy[stage] = path + " not found";
            g_artQueue.erase(g_artQueue.begin());
            return;
        }
        g_artOpen = true;
        g_artBuffer.assign((g_artFile.length + 31) & ~31u, 0);
        g_artRead = 0;
    }
    const uint32_t total = static_cast<uint32_t>(g_artBuffer.size());
    const uint32_t len = std::min(kReadPerFrame, total - g_artRead);
    s32 got = 0;
    if (len > 0) got = DVDReadPrio(&g_artFile, g_artBuffer.data() + g_artRead, static_cast<s32>(len), static_cast<s32>(g_artRead), 2);
    if (got > 0) g_artRead += static_cast<uint32_t>(got);
    if (g_artRead < g_artFile.length && got > 0) return;
    DVDClose(&g_artFile);
    g_artOpen = false;
    if (g_artRead >= g_artFile.length) {
        g_artBuffer.resize(g_artFile.length);
        finish_art(stage);
    } else {
        g_art[stage] = "";
        g_artWhy[stage] = "reading the archive failed";
    }
    g_artBuffer.clear();
    g_artBuffer.shrink_to_fit();
    g_artQueue.erase(g_artQueue.begin());
}

// The floor of a height in a stage, as dMapInfo_c::calcFloorNo works it out from the stage's floor
// spacing, kept in the room's floors (its FILI).
int floor_of(const std::string& stage, float y, int room) {
    const auto it = g_floors.find(stage);
    if (it == g_floors.end() || it->second.gap <= 0) return 0;
    const FloorSpacing& f = it->second;
    int floorNo = static_cast<int>(std::floor(y / f.gap));
    const float base = floorNo * f.gap;
    const float up = base + f.rangeUp;
    const float down = base + f.gap - f.rangeDown;
    if (y < up) {
        if (y >= down && y >= 0.5f * (down + up)) floorNo++;
    } else {
        floorNo++;
    }
    const auto st = g_shifts.find(stage);
    if (st != g_shifts.end() && room >= 0) {
        const auto rm = st->second.find(room);
        if (rm != st->second.end() && rm->second.minFloor <= rm->second.maxFloor) {
            floorNo = std::clamp(floorNo, rm->second.minFloor, rm->second.maxFloor);
        }
    }
    return floorNo;
}

void build_json(bool done) {
    JsonWriter w;
    w.beginObject();
    w.member("done", done);
    w.member("read", static_cast<int>(g_job));
    w.member("total", static_cast<int>(g_jobs.size()));
    if (done) {
        w.key("stages").beginObject();
        for (const auto& [stage, places] : g_places) {
            w.key(stage).beginArray();
            for (const Place& p : places) {
                float x = p.x;
                float z = p.z;
                to_map(stage, p.room, x, z);
                w.beginObject();
                w.member("key", p.key);
                w.member("room", p.room);
                w.key("x").number(x);
                w.key("y").number(p.y);
                w.key("z").number(z);
                w.member("floor", floor_of(stage, p.y, p.room));
                w.endObject();
            }
            w.endArray();
        }
        w.endObject();
        // The stages whose map can be shown (/stage-map/<stage>).
        w.key("maps").beginArray();
        for (const auto& [stage, rooms] : g_maps) {
            if (!rooms.empty()) w.value(stage);
        }
        w.endArray();
        // Rooms placed with an offset and a turn in their stage (FILI): [x, z, turn] by room, for
        // places the page adds (the randomizer's patches, in room coordinates).
        w.key("shifts").beginObject();
        for (const auto& [stage, rooms] : g_shifts) {
            w.key(stage).beginObject();
            for (const auto& [room, sh] : rooms) {
                w.key(std::to_string(room)).beginArray();
                w.number(sh.x);
                w.number(sh.z);
                w.value(sh.turn);
                w.endArray();
            }
            w.endObject();
        }
        w.endObject();
        // Spawn points: {stage: [[room, point, x, z, floor]]} in map coordinates.
        w.key("spawns").beginObject();
        for (const auto& [stage, list] : g_spawns) {
            w.key(stage).beginArray();
            for (const Spawn& sp : list) {
                float x = sp.x;
                float z = sp.z;
                if (sp.room >= 0) to_map(stage, sp.room, x, z);
                w.beginArray().value(sp.room).value(sp.point).number(x, 0).number(z, 0).value(floor_of(stage, sp.y, sp.room)).endArray();
            }
            w.endArray();
        }
        w.endObject();
        // Stages whose map shows one room at a time (STAG up button 2, 3, 6): each room is a place
        // of its own (Lake Hylia and Lanayru Spring).
        w.key("singleRooms").beginArray();
        for (const auto& [stage, f] : g_floors) {
            if (f.mapKind == 2 || f.mapKind == 3 || f.mapKind == 6) w.value(stage);
        }
        w.endArray();
        // Their rooms (a stage of houses holds one house a room).
        w.key("mapRooms").beginObject();
        for (const auto& [stage, rooms] : g_maps) {
            if (rooms.empty()) continue;
            w.key(stage).beginArray();
            for (const auto& [room, json] : rooms) w.value(room);
            w.endArray();
        }
        w.endObject();
    }
    w.endObject();
    g_json = w.str();
}

// The cache: "P\tstage\tkey\troom x y z", "F\tstage\tgap up down", "M\tstage\troom\t<json>".
bool load_cache() {
    if (g_cacheFile.empty()) return false;
    std::ifstream in(g_cacheFile);
    std::string line;
    if (!std::getline(in, line) || line != kCacheVersion) return false;
    g_places.clear();
    g_maps.clear();
    g_floors.clear();
    g_icons.clear();
    g_shifts.clear();
    g_doors.clear();
    g_shutters.clear();
    g_spawns.clear();
    g_groundInfo.clear();
    while (std::getline(in, line)) {
        std::istringstream fields(line);
        std::string kind;
        std::string stage;
        if (!std::getline(fields, kind, '\t') || !std::getline(fields, stage, '\t')) continue;
        if (kind == "P") {
            Place p;
            if (std::getline(fields, p.key, '\t') && (fields >> p.room >> p.x >> p.y >> p.z)) g_places[stage].push_back(std::move(p));
        } else if (kind == "F") {
            FloorSpacing f;
            if (fields >> f.gap >> f.rangeUp >> f.rangeDown >> f.mapKind) {
                fields >> f.saveTbl;
                g_floors[stage] = f;
            }
        } else if (kind == "W") {
            Spawn sp{};
            if (fields >> sp.room >> sp.point >> sp.x >> sp.y >> sp.z) g_spawns[stage].push_back(sp);
        } else if (kind == "K") {
            Shutter sh{};
            int big = 0;
            if (std::getline(fields, sh.name, '\t') && (fields >> sh.room >> sh.prm >> sh.x >> sh.y >> sh.z >> sh.angle >> big)) {
                sh.big = big != 0;
                g_shutters[stage].push_back(std::move(sh));
            }
        } else if (kind == "D") {
            Door d;
            int stageDoor = 0;
            if (std::getline(fields, d.name, '\t') && (fields >> d.prm >> d.angleY >> d.angleZ >> d.x >> d.y >> d.z >> stageDoor)) {
                d.stageDoor = stageDoor != 0;
                g_doors[stage].push_back(std::move(d));
            }
        } else if (kind == "S") {
            int room = 0;
            RoomShift sh;
            if (fields >> room >> sh.x >> sh.z >> sh.turn >> sh.minFloor >> sh.maxFloor) g_shifts[stage][room] = sh;
        } else if (kind == "I") {
            Icon i;
            if (fields >> i.type >> i.room >> i.sw >> i.x >> i.y >> i.z) g_icons[stage].push_back(i);
        } else if (kind == "G") {
            int room = 0;
            std::string info;
            if ((fields >> room) && fields.get() == '\t' && std::getline(fields, info)) g_groundInfo[stage][room] = info;
        } else if (kind == "M") {
            std::string room;
            std::string json;
            if (std::getline(fields, room, '\t') && std::getline(fields, json)) g_maps[stage][std::atoi(room.c_str())] = json;
        }
    }
    return true;
}

void save_cache() {
    if (g_cacheFile.empty()) return;
    std::ofstream out(g_cacheFile, std::ios::trunc);
    out << kCacheVersion << "\n";
    for (const auto& [stage, places] : g_places) {
        for (const Place& p : places) out << "P\t" << stage << '\t' << p.key << '\t' << p.room << ' ' << p.x << ' ' << p.y << ' ' << p.z << "\n";
    }
    for (const auto& [stage, f] : g_floors) out << "F\t" << stage << '\t' << f.gap << ' ' << f.rangeUp << ' ' << f.rangeDown << ' ' << f.mapKind << ' ' << f.saveTbl << "\n";
    for (const auto& [stage, list] : g_spawns) {
        for (const Spawn& sp : list) out << "W\t" << stage << '\t' << sp.room << ' ' << sp.point << ' ' << sp.x << ' ' << sp.y << ' ' << sp.z << "\n";
    }
    for (const auto& [stage, list] : g_shutters) {
        for (const Shutter& sh : list) {
            out << "K\t" << stage << '\t' << sh.name << '\t' << sh.room << ' ' << sh.prm << ' ' << sh.x << ' ' << sh.y << ' ' << sh.z << ' ' << sh.angle << ' ' << (sh.big ? 1 : 0) << "\n";
        }
    }
    for (const auto& [stage, doors] : g_doors) {
        for (const Door& d : doors) {
            out << "D\t" << stage << '\t' << d.name << '\t' << d.prm << ' ' << d.angleY << ' ' << d.angleZ << ' ' << d.x << ' ' << d.y << ' ' << d.z << ' ' << (d.stageDoor ? 1 : 0) << "\n";
        }
    }
    for (const auto& [stage, rooms] : g_groundInfo) {
        for (const auto& [room, info] : rooms) out << "G\t" << stage << '\t' << room << '\t' << info << "\n";
    }
    for (const auto& [stage, rooms] : g_shifts) {
        for (const auto& [room, sh] : rooms) out << "S\t" << stage << '\t' << room << ' ' << sh.x << ' ' << sh.z << ' ' << sh.turn << ' ' << sh.minFloor << ' ' << sh.maxFloor << "\n";
    }
    for (const auto& [stage, icons] : g_icons) {
        for (const Icon& i : icons) out << "I\t" << stage << '\t' << i.type << ' ' << i.room << ' ' << i.sw << ' ' << i.x << ' ' << i.y << ' ' << i.z << "\n";
    }
    for (const auto& [stage, rooms] : g_maps) {
        for (const auto& [room, json] : rooms) out << "M\t" << stage << '\t' << room << '\t' << json << "\n";
    }
}

}  // namespace

void to_map(const std::string& stage, int room, float& x, float& z) {
    const auto st = g_shifts.find(stage);
    if (st == g_shifts.end()) return;
    const auto it = st->second.find(room);
    if (it == st->second.end()) return;
    const RoomShift& s = it->second;
    // mDoMtx YrotS then the offset, as dMapInfo_n::rotAngle / offsetPlus.
    const float a = s.turn * (3.14159265f / 32768.0f);
    const float c = std::cos(a);
    const float n = std::sin(a);
    const float rx = x * c + z * n;
    const float rz = -x * n + z * c;
    x = rx + s.x;
    z = rz + s.z;
}

bool shift_known(const std::string& stage) { return g_shifts.count(stage) != 0; }

// The people (and golden wolves) of the game, by their actor names (the NPC entries of the game's
// object table, d_stage.cpp; not the townsfolk, soldiers or fish): kept as npc:<name>:<room>, so
// checks given by them can be placed where they stand.
static bool is_npc(const char* name) {
    static const char* const kNames[] = {
        "Aru", "Ash", "AshB", "Bans", "Besu", "Blue_NS", "Bou", "BouS", "Coach", "Doc", "DoorBoy",
        "DrSol1", "DrSol2", "FSeirei", "Fairy", "GWolf", "Gnd", "Hanjo", "Henna", "Henna0", "Hoz",
        "Jagar", "Kakashi", "Kdk", "Kkri", "Kn", "Knj", "Kolin", "Kolinb", "Kyury", "Len", "Lud",
        "Maro", "Mk", "Moi", "MoiR", "NPC_TK", "Npc_du", "Npc_ks", "Npc_lf", "Npc_ne", "Npc_tr",
        "PA_Besu", "PA_Maro", "PA_Taro", "Post", "Pouya", "Raca", "Rafrel", "Saru", "Seira", "Seira2",
        "Seirei", "Sha", "Shad", "Shop0", "Taro", "The", "TheB", "Tkc", "Tkj", "Tkj2", "Tks", "Toby",
        "Uri", "Yelia", "Zant", "ZelR", "ZelRo", "Zelda", "chin", "clerkA", "clerkB", "clerkT", "grA",
        "grC", "grD", "grD1", "grM", "grMC", "grO", "grR", "grS", "grZ", "impal", "ins", "km_Hana",
        "km_Kyu", "km_Mich", "midP", "prayer", "sMaro", "seiB", "seiC", "seiD", "shoe", "solA",
        "yamiD", "yamiS", "yamiT", "ykM", "ykW", "zanB", "zrA", "zrC", "zrD", "zrR", "zrS", "zrSP",
        "zrSPA", "zrWF", "zrZ",
    };
    for (const char* n : kNames) {
        if (std::strcmp(n, name) == 0) return true;
    }
    return false;
}

void parse_room_file(const std::string& stage, int room, const uint8_t* b, uint32_t size, std::vector<Place>& out) {
    if (size != 0 && size < 4) return;
    const uint32_t chunks = be32(b);
    if (chunks > 256 || (size != 0 && 4 + chunks * 12 > size)) return;
    for (uint32_t c = 0; c < chunks; c++) {
        const uint8_t* node = b + 4 + c * 12;
        if (std::memcmp(node, "PLYR", 4) == 0) {
            const uint32_t num = be32(node + 4);
            const uint8_t* data = chunk_data(b, node);
            for (uint32_t i = 0; i < num && i < 256 && (size == 0 || data + (i + 1) * 0x20 <= b + size); i++) {
                const uint8_t* e = data + i * 0x20;
                const Spawn sp{room, e[0x1D], befloat(e + 0xC), befloat(e + 0x10), befloat(e + 0x14)};
                bool known = false;
                for (const Spawn& o : g_spawns[stage]) known = known || (o.room == sp.room && o.point == sp.point);
                if (!known) g_spawns[stage].push_back(sp);
            }
            continue;
        }
        // Actors (ACTR, TRES, TGOB and their layers ACT0.., TRE0..: 0x20 bytes each) and scaled
        // objects (SCOB, TGSC, SCO0..: 0x24 bytes).
        uint32_t stride = 0;
        if (std::memcmp(node, "ACT", 3) == 0 || std::memcmp(node, "TRE", 3) == 0 || std::memcmp(node, "TGOB", 4) == 0) stride = 0x20;
        else if (std::memcmp(node, "SCO", 3) == 0 || std::memcmp(node, "TGSC", 4) == 0) stride = 0x24;
        if (stride == 0) continue;
        // Layer chunks (ACT0..ACTb, TRE0.., SCO0..) hold actors of one story stage only; a check
        // placed both in a layer and in the common chunk takes the common one.
        const bool layer = !(std::memcmp(node, "ACTR", 4) == 0 || std::memcmp(node, "TRES", 4) == 0 || std::memcmp(node, "SCOB", 4) == 0 ||
                             std::memcmp(node, "TGOB", 4) == 0 || std::memcmp(node, "TGSC", 4) == 0);
        const uint32_t num = be32(node + 4);
        const uint8_t* data = chunk_data(b, node);
        if (num > 1024) continue;
        if (size != 0 && (data < b || data + num * stride > b + size)) continue;
        for (uint32_t i = 0; i < num; i++) {
            const uint8_t* e = data + i * stride;
            char name[9] = {};
            std::memcpy(name, e, 8);
            const uint32_t prm = be32(e + 8);
            char key[64] = {};
            // As the actors name their checks (item_give_tag_* in d_a_tbox, d_a_tbox2, d_a_obj_item,
            // d_a_obj_life_container, d_a_obj_smallkey, d_a_e_hp, d_a_e_po).
            if (std::strncmp(name, "tboxEL", 6) == 0) {
                std::snprintf(key, sizeof(key), "chest:%s:%u", stage.c_str(), (prm >> 16) & 0xFF);
            } else if (std::strncmp(name, "tbox", 4) == 0) {
                std::snprintf(key, sizeof(key), "chest:%s:%u", stage.c_str(), (prm >> 6) & 0x3F);
            } else if (std::strcmp(name, "item") == 0 || std::strcmp(name, "witem") == 0 || std::strcmp(name, "htPiece") == 0 ||
                       std::strcmp(name, "htCase") == 0 || std::strcmp(name, "itemKey") == 0) {
                const uint32_t bit = (prm >> 8) & 0xFF;
                if (bit == 0xFF) continue;
                std::snprintf(key, sizeof(key), "freestanding:%s:%u", stage.c_str(), bit);
            } else if (std::strcmp(name, "E_hp") == 0 || std::strcmp(name, "E_po") == 0) {
                const uint32_t sw = (prm >> 8) & 0xFF;
                if (sw == 0xFF) continue;
                std::snprintf(key, sizeof(key), "poe:%s:%u", stage.c_str(), sw);
            } else if (std::strcmp(name, "kshtr00") == 0 || std::strcmp(name, "vshuter") == 0 || std::strcmp(name, "L3Bdoor") == 0) {
                if (room >= 0) {
                    Shutter sh{name, room, prm, befloat(e + 0xC), befloat(e + 0x10), befloat(e + 0x14), be16(e + 0x1A), std::strcmp(name, "L3Bdoor") == 0};
                    bool known = false;
                    for (const Shutter& o : g_shutters[stage]) known = known || (o.room == sh.room && o.x == sh.x && o.z == sh.z);
                    if (!known) g_shutters[stage].push_back(std::move(sh));
                }
                continue;
            } else if (is_npc(name)) {
                std::snprintf(key, sizeof(key), "npc:%s:%d", name, room);
            } else {
                continue;
            }
            // The same check in another room is kept too (a box number can come back in a room
            // the game does not use for it); resolve_duplicates picks one once all are read.
            Place* known = nullptr;
            for (Place& p : out) {
                if (p.key == key && p.room == room) known = &p;
            }
            const std::string layerKey = stage + "/" + key + "/" + std::to_string(room);
            if (known == nullptr) {
                out.push_back({key, room, befloat(e + 0xC), befloat(e + 0x10), befloat(e + 0x14)});
                if (layer) g_layered.insert(layerKey);
            } else if (!layer && g_layered.erase(layerKey) != 0) {
                *known = {key, room, befloat(e + 0xC), befloat(e + 0x10), befloat(e + 0x14)};
            }
        }
    }
}

// A check found in several rooms of a stage: the room the game's map marks it in (a chest's
// treasure icon, TRES, carries its box number), else one placed for good (not in a layer of one
// story stage only), else the first.
void resolve_duplicates() {
    for (auto& [stage, list] : g_places) {
        std::vector<Place> out;
        for (const Place& p : list) {
            bool seen = false;
            for (const Place& o : out) seen = seen || o.key == p.key;
            if (seen) continue;
            std::vector<const Place*> all;
            for (const Place& q : list) {
                if (q.key == p.key) all.push_back(&q);
            }
            const Place* pick = all.front();
            if (all.size() > 1) {
                unsigned box = 0;
                const bool chest = std::sscanf(p.key.c_str(), "chest:%*[^:]:%u", &box) == 1;
                const Place* marked = nullptr;
                const Place* steady = nullptr;
                for (const Place* q : all) {
                    if (chest && marked == nullptr) {
                        for (const Icon& i : g_icons[stage]) {
                            if (i.type == 1 && i.room == q->room && static_cast<unsigned>(i.sw) == box) marked = q;
                        }
                    }
                    if (steady == nullptr && !g_layered.count(stage + "/" + q->key + "/" + std::to_string(q->room))) steady = q;
                }
                pick = marked != nullptr ? marked : steady != nullptr ? steady : all.front();
            }
            out.push_back(*pick);
        }
        list = std::move(out);
    }
}

void set_cache_file(std::string path) { g_cacheFile = std::move(path); }

void update() {
    switch (g_phase) {
    case Phase::Idle:
        g_phase = Phase::Cache;
        break;
    case Phase::Cache:
        if (load_cache()) {
            g_phase = Phase::Done;
            build_json(true);
        } else {
            g_phase = Phase::List;
        }
        break;
    case Phase::List:
        // The disc is read only while the game is plainly playing (not while it loads a stage).
        if (!tracker::is_playing()) break;
        list_jobs();
        g_job = 0;
        g_places.clear();
        g_maps.clear();
        g_floors.clear();
        g_icons.clear();
        g_shifts.clear();
        g_doors.clear();
        g_shutters.clear();
        g_spawns.clear();
        g_groundInfo.clear();
        g_phase = Phase::Read;
        build_json(false);
        break;
    case Phase::Read:
        if (!tracker::is_playing() && !g_open) break;
        if (g_job >= g_jobs.size()) {
            resolve_duplicates();
            finish_ground_maps();
            save_cache();
            g_phase = Phase::Done;
            build_json(true);
            break;
        }
        if (step_read()) {
            g_job++;
            if (g_job % 8 == 0) build_json(false);
        }
        break;
    case Phase::Done:
        break;
    }
    // Dungeon map backgrounds, between the reads of the check places.
    if (!g_open && (g_artOpen || tracker::is_playing())) step_art();
}

std::string dungeon_art_status() {
    JsonWriter w;
    w.beginObject();
    for (const std::string& stage : g_artQueue) w.member(stage, std::string{"queued"});
    for (const auto& [stage, png] : g_art) {
        if (!png.empty()) w.member(stage, "read (" + std::to_string(png.size()) + " bytes)");
        else w.member(stage, g_artWhy.count(stage) ? g_artWhy[stage] : std::string{"failed"});
    }
    w.endObject();
    return w.str();
}

std::string dungeon_art(const std::string& stage) {
    // Only the dungeons' own: D_MN followed by two digits.
    if (stage.size() != 6 || stage.compare(0, 4, "D_MN") != 0 || !std::isdigit(static_cast<unsigned char>(stage[4])) ||
        !std::isdigit(static_cast<unsigned char>(stage[5]))) {
        return {};
    }
    if (const auto it = g_art.find(stage); it != g_art.end()) return it->second;
    if (std::find(g_artQueue.begin(), g_artQueue.end(), stage) == g_artQueue.end()) g_artQueue.push_back(stage);
    return {};
}

const std::vector<Place>* stage_places(const std::string& stage) {
    if (g_phase != Phase::Done) return nullptr;
    const auto it = g_places.find(stage);
    return it == g_places.end() ? nullptr : &it->second;
}

const std::string& cached_json() { return g_json; }

// A stage's doors as map_data.hpp gives the doors of the stage Link is in, their kind and state
// from the save (the stage's saved switches; zone and temporary switches are not known: '?').
std::string doors_json(const std::string& stage) {
    const auto fl = g_floors.find(stage);
    const int saveTbl = fl != g_floors.end() ? fl->second.saveTbl : -1;
    const auto switch_state = [saveTbl](int sw) {
        if (sw == 0xFF || sw >= 0x80 || saveTbl < 0) return -1;
        return dComIfGs_isStageSwitch(saveTbl, sw) ? 1 : 0;
    };
    const auto side_state = [](int front, int back) {
        if (front < 0 && back < 0) return '?';
        const bool f = front == 0;
        const bool b = back == 0;
        return f && b ? 'D' : f ? 'F' : b ? 'B' : 'O';
    };
    JsonWriter w;
    w.beginArray();
    for (const Door& d : g_doors[stage]) {
        const int front = (d.prm >> 13) & 0x3F;
        const int back = (d.prm >> 19) & 0x3F;
        const int frontOpt = (d.prm >> 8) & 0x3;
        const int backOpt = (d.prm >> 10) & 0x7;
        const int sw = d.angleZ & 0xFF;
        const int sw2 = (d.angleZ >> 8) & 0xFF;
        const char* kind = "door";
        char state = 'O';
        const bool boss = d.name == "bdoor" || d.name.find("Bdoor") != std::string::npos;
        if (boss) {
            kind = "boss";
            const int st = switch_state(sw);
            state = st < 0 ? '?' : st == 0 ? 'L' : 'U';
        } else if (frontOpt == 2 || backOpt == 2) {
            kind = "key";
            const int st = switch_state(sw);
            state = st < 0 ? '?' : st == 0 ? 'L' : 'U';
        } else if (d.name.rfind("L", 0) == 0 && d.name.find("door") != std::string::npos &&
                   ((frontOpt == 0 && sw != 0xFF) || (backOpt == 0 && sw2 != 0xFF))) {
            kind = "switch";
            state = side_state(frontOpt == 0 && sw != 0xFF ? switch_state(sw) : 1, backOpt == 0 && sw2 != 0xFF ? switch_state(sw2) : 1);
        } else if (frontOpt == 1 || frontOpt == 3 || backOpt == 1 || backOpt == 3) {
            kind = "stop";
            state = side_state(frontOpt == 1 || frontOpt == 3 ? switch_state(sw) : 1, backOpt == 1 || backOpt == 3 ? switch_state(sw2) : 1);
        }
        float x = d.x;
        float z = d.z;
        if (d.stageDoor) to_map(stage, front, x, z);
        w.beginObject();
        w.member("name", d.name);
        w.key("rooms").beginArray().value(front).value(back).endArray();
        w.key("x").number(x);
        w.key("z").number(z);
        w.member("angle", d.angleY);
        w.key("floors").beginArray().value(floor_of(stage, d.y, front)).value(floor_of(stage, d.y, back)).endArray();
        w.member("kind", kind);
        if (state == 'L' || state == 'U') w.member("locked", state == 'L');
        w.member("state", std::string(1, state));
        w.endObject();
    }
    // Key shutters: locked while their switch is off.
    for (const Shutter& sh : g_shutters[stage]) {
        float x = sh.x;
        float z = sh.z;
        to_map(stage, sh.room, x, z);
        const int st = switch_state(static_cast<int>(sh.prm & 0xFF));
        const char state = st < 0 ? '?' : st == 0 ? 'L' : 'U';
        w.beginObject();
        w.member("name", sh.name);
        w.key("rooms").beginArray().value(sh.room).value(sh.room).endArray();
        w.key("x").number(x);
        w.key("z").number(z);
        w.member("angle", sh.angle);
        w.key("floors").beginArray().value(floor_of(stage, sh.y, sh.room)).value(floor_of(stage, sh.y, sh.room)).endArray();
        w.member("kind", sh.big ? "boss" : "key");
        if (state != '?') w.member("locked", state == 'L');
        w.member("state", std::string(1, state));
        w.endObject();
    }
    w.endArray();
    return w.str();
}

const std::vector<Shutter>* stage_shutters(const std::string& stage) {
    if (g_phase != Phase::Done) return nullptr;
    const auto it = g_shutters.find(stage);
    return it == g_shutters.end() ? nullptr : &it->second;
}

std::string stage_map_json(const std::string& stage) {
    if (g_phase != Phase::Done) return "";
    // (An overworld stage with no map at all still answers, with what was found of its ground.)
    static const std::map<int, std::string> kNone;
    const auto it = g_maps.find(stage);
    const bool none = it == g_maps.end() || it->second.empty();
    if (none && !g_groundInfo.count(stage)) return "";
    const std::map<int, std::string>& maps = none ? kNone : it->second;
    std::string out = R"({"stage":")" + stage + R"(",)";
    const auto fl = g_floors.find(stage);
    out += R"("singleRoom":)" + std::string((fl != g_floors.end() && (fl->second.mapKind == 2 || fl->second.mapKind == 3 || fl->second.mapKind == 6)) ? "true" : "false") + ",";
    {
        JsonWriter w;
        w.beginArray();
        for (const Icon& i : g_icons[stage]) {
            w.beginObject();
            w.member("type", i.type);
            w.member("room", i.room);
            w.member("sw", i.sw);
            w.key("x").number(i.x);
            w.key("z").number(i.z);
            w.member("floor", floor_of(stage, i.y, i.room));
            w.endObject();
        }
        w.endArray();
        out += R"("icons":)" + w.str() + ",";
    }
    out += R"("doors":)" + doors_json(stage) + ",";
    {
        JsonWriter w;
        w.beginObject();
        for (const auto& [room, info] : g_groundInfo[stage]) w.member(std::to_string(room).c_str(), info);
        w.endObject();
        out += R"("groundInfo":)" + w.str() + ",";
    }
    out += R"("rooms":[)";
    bool first = true;
    for (const auto& [room, json] : maps) {
        if (!first) out += ',';
        out += json;
        first = false;
    }
    return out + "]}";
}

}  // namespace tracker::places
