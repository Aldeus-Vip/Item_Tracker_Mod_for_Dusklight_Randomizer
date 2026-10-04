#include "check_places.hpp"

#include "json_writer.hpp"
#include "tracker_state.hpp"

#include <dolphin/dvd.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <map>
#include <sstream>

namespace tracker::places {
namespace {

constexpr const char* kCacheVersion = "check-places 2";
constexpr uint32_t kReadPerFrame = 512 * 1024;  // bytes read from the disc each frame

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
};
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

// The map of a room file (its MPAT chunk), and the floor spacing of a stage file (STAG).
void parse_room_map(const std::string& stage, int roomNo, const uint8_t* b, uint32_t size) {
    const uint32_t chunks = be32(b);
    if (chunks > 256 || 4 + chunks * 12 > size) return;
    for (uint32_t c = 0; c < chunks; c++) {
        const uint8_t* node = b + 4 + c * 12;
        const uint8_t* data = chunk_data(b, node);
        if (data < b || data + 8 > b + size) continue;
        if (std::memcmp(node, "STAG", 4) == 0 && data + 0x20 <= b + size) {
            const auto s16 = [](const uint8_t* p) { return static_cast<float>(static_cast<int16_t>(be16(p))); };
            g_floors[stage] = {s16(data + 0x1A), std::fabs(s16(data + 0x1C)), std::fabs(s16(data + 0x1E))};
        }
        if (roomNo < 0 || (std::memcmp(node, "MPAT", 4) != 0 && std::memcmp(node, "MPA0", 4) != 0)) continue;
        if (g_maps[stage].count(roomNo)) continue;
        // The room data: where the entry offset points (from the file, or from the field), or
        // right after the chunk's header.
        const uint32_t off = be32(data + 4);
        for (const uint8_t* room : {b + off, data + 4 + off, data + 8}) {
            std::string json = room_map_json(roomNo, b, size, room);
            if (!json.empty()) {
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
    for (const ArcFile& f : rarc_files(*arc)) {
        int room = -2;
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
        parse_room_map(job.stage, room, file.data(), static_cast<uint32_t>(file.size()));
    }
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

// The floor of a height in a stage, as dMapInfo_c::calcFloorNo works it out from the stage's floor
// spacing (without the room limits only known for the stage being played).
int floor_of(const std::string& stage, float y) {
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
                w.beginObject();
                w.member("key", p.key);
                w.member("room", p.room);
                w.key("x").number(p.x);
                w.key("y").number(p.y);
                w.key("z").number(p.z);
                w.member("floor", floor_of(stage, p.y));
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
            if (fields >> f.gap >> f.rangeUp >> f.rangeDown) g_floors[stage] = f;
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
    for (const auto& [stage, f] : g_floors) out << "F\t" << stage << '\t' << f.gap << ' ' << f.rangeUp << ' ' << f.rangeDown << "\n";
    for (const auto& [stage, rooms] : g_maps) {
        for (const auto& [room, json] : rooms) out << "M\t" << stage << '\t' << room << '\t' << json << "\n";
    }
}

}  // namespace

void parse_room_file(const std::string& stage, int room, const uint8_t* b, uint32_t size, std::vector<Place>& out) {
    if (size != 0 && size < 4) return;
    const uint32_t chunks = be32(b);
    if (chunks > 256 || (size != 0 && 4 + chunks * 12 > size)) return;
    for (uint32_t c = 0; c < chunks; c++) {
        const uint8_t* node = b + 4 + c * 12;
        // Actors (ACTR, TRES, TGOB and their layers ACT0.., TRE0..: 0x20 bytes each) and scaled
        // objects (SCOB, TGSC, SCO0..: 0x24 bytes).
        uint32_t stride = 0;
        if (std::memcmp(node, "ACT", 3) == 0 || std::memcmp(node, "TRE", 3) == 0 || std::memcmp(node, "TGOB", 4) == 0) stride = 0x20;
        else if (std::memcmp(node, "SCO", 3) == 0 || std::memcmp(node, "TGSC", 4) == 0) stride = 0x24;
        if (stride == 0) continue;
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
            } else {
                continue;
            }
            bool known = false;
            for (const Place& p : out) known = known || p.key == key;
            if (!known) out.push_back({key, room, befloat(e + 0xC), befloat(e + 0x10), befloat(e + 0x14)});
        }
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
        g_phase = Phase::Read;
        build_json(false);
        break;
    case Phase::Read:
        if (!tracker::is_playing() && !g_open) break;
        if (g_job >= g_jobs.size()) {
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
}

const std::vector<Place>* stage_places(const std::string& stage) {
    if (g_phase != Phase::Done) return nullptr;
    const auto it = g_places.find(stage);
    return it == g_places.end() ? nullptr : &it->second;
}

const std::string& cached_json() { return g_json; }

std::string stage_map_json(const std::string& stage) {
    if (g_phase != Phase::Done) return "";
    const auto it = g_maps.find(stage);
    if (it == g_maps.end() || it->second.empty()) return "";
    std::string out = R"({"stage":")" + stage + R"(","rooms":[)";
    bool first = true;
    for (const auto& [room, json] : it->second) {
        if (!first) out += ',';
        out += json;
        first = false;
    }
    return out + "]}";
}

}  // namespace tracker::places
