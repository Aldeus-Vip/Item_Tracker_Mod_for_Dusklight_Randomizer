#include "field_map.hpp"

#include "json_writer.hpp"
#include "map_data.hpp"
#include "tracker_state.hpp"

#include "JSystem/JKernel/JKRAramArchive.h"
#include "d/d_com_inf_game.h"
#include "d/d_lib.h"
#include "d/d_map_path_dmap.h"
#include "d/d_map_path_fmap.h"
#include "d/d_menu_fmap.h"
#include "d/d_menu_map_common.h"
#include "d/d_stage.h"

#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <vector>

namespace tracker::fieldmap {
namespace {

constexpr int kRegions = 8;
constexpr int kVisitedEveryFrames = 120;

struct FreeAligned {
    void operator()(void* p) const { ::operator delete(p, std::align_val_t{32}); }
};
using Buffer = std::unique_ptr<void, FreeAligned>;

// A resource of the field map archive, read whole (as dMenu_Fmap_c::readFieldMapData).
Buffer read_resource(const char* path) {
    JKRAramArchive* arc = dComIfGp_getFieldMapArchive2();
    if (arc == nullptr) return nullptr;
    const u32 size = dLib_getExpandSizeFromAramArchive(arc, path);
    if (size == 0) return nullptr;
    Buffer buf{::operator new(size, std::align_val_t{32})};
    if (arc->readResource(buf.get(), size, path) == 0) return nullptr;
    return buf;
}

struct Stage {
    int region = 0;
    std::string name;
    float x = 0;
    float z = 0;
    bool roomBits[64] = {};
    bool headerRead = false;
    int saveTable = -1;
    int visitedTable = -1;
    std::vector<int> rooms;
    std::size_t nextRoom = 0;
    std::vector<std::string> roomJson;
};

enum class Phase { Idle, Index, Stages, Done, Failed };

Phase g_phase = Phase::Idle;
bool g_requested = false;
std::vector<Stage> g_stages;
std::size_t g_stage = 0;
float g_regionX[kRegions] = {};
float g_regionZ[kRegions] = {};
std::string g_json = R"({"ready":false})";
std::string g_visited = R"({"stages":{}})";
int g_frame = 0;

// The provinces and which stages (and rooms) each shows, as dMenu_Fmap_c::decodeFieldMapData and
// readAreaData work them out.
bool read_index() {
    Buffer buf = read_resource("dat/field.dat");
    if (!buf) return false;
    auto* field = static_cast<dMenu_Fmap_field_data_c*>(buf.get());
    const auto base = reinterpret_cast<intptr_t>(field);
    auto* regions = reinterpret_cast<dMenu_Fmap_field_region_data_c*>(base + static_cast<u32>(field->mRegionDataOffset));
    auto* stageList = reinterpret_cast<dMenuMapCommon_c::Stage_c*>(base + static_cast<u32>(field->mStageDataOffset));

    bool used[kRegions] = {};
    for (int i = 0; i < regions->mCount; i++) {
        const int n = regions->mData[i].mTextureReadNum;
        if (n < 1 || n > kRegions) continue;
        used[n - 1] = true;
        g_regionX[n - 1] = regions->mData[i].mOriginX;
        g_regionZ[n - 1] = regions->mData[i].mOriginZ;
    }

    const int count = stageList->mCount;
    const dMenuMapCommon_c::Stage_c::data* stages = stageList->mData;
    auto name_of = [](const dMenuMapCommon_c::Stage_c::data& d) {
        char name[9] = {};
        std::memcpy(name, d.mName, 8);
        return std::string{name};
    };
    g_stages.clear();
    for (int region = 1; region <= kRegions; region++) {
        if (!used[region - 1]) continue;
        std::vector<bool> checked(count, false);
        for (int i = 0; i < count; i++) {
            if (checked[i]) continue;
            const std::string name = name_of(stages[i]);
            bool claimed[64] = {};
            Stage stage;
            int first = -1;
            for (int j = i; j < count; j++) {
                if (name_of(stages[j]) != name) continue;
                checked[j] = true;
                const int roomNo = stages[j].mRoomNo;
                if (stages[j].mRegionNo == region) {
                    if (roomNo != 0xFF) {
                        if (roomNo < 64) stage.roomBits[roomNo] = true;
                    } else {
                        for (int k = 0; k < 64; k++) {
                            if (!claimed[k]) stage.roomBits[k] = true;
                        }
                    }
                    if (first < 0) first = j;
                } else if (roomNo != 0xFF && roomNo < 64) {
                    claimed[roomNo] = true;
                }
            }
            if (first < 0) continue;
            stage.region = region;
            stage.name = name;
            stage.x = stages[first].mOffsetX;
            stage.z = stages[first].mOffsetZ;
            g_stages.push_back(std::move(stage));
        }
    }
    return true;
}

bool read_stage_header(Stage& stage) {
    char path[32];
    std::snprintf(path, sizeof(path), "%s/stage.dat", stage.name.c_str());
    Buffer buf = read_resource(path);
    if (!buf) return false;
    auto* arc = static_cast<dMenu_Fmap_stage_arc_data_c*>(buf.get());
    stage.saveTable = arc->mSaveTableNo;
    stage.visitedTable = arc->mVisitedRoomSaveTableNo;
    for (int i = 0; i < arc->mSize; i++) {
        const int roomNo = arc->mRoomNos[i];
        if (roomNo < 64 && stage.roomBits[roomNo]) stage.rooms.push_back(roomNo);
    }
    return true;
}

// Groups tied to a switch, as the map screen decides them for a stage Link is not in
// (renderingFmap_c::isSwitch): stage switches from the save, others by their default.
bool group_shown(const dDrawPath_c::group_class& g, int saveTable) {
    if (g.mSwbit == 0xFF) return true;
    if (g.mSwbit < 0x80 && saveTable >= 0) {
        const bool on = dComIfGs_isStageSwitch(saveTable, g.mSwbit) != FALSE;
        return g.field_0x1 != 0 ? on : !on;
    }
    return g.field_0x1 == 0;
}

void read_room(Stage& stage, int roomNo) {
    char path[32];
    std::snprintf(path, sizeof(path), "%s/room%d.dzs", stage.name.c_str(), roomNo);
    Buffer buf = read_resource(path);
    if (!buf) return;
    dMenu_Fmap_data_c data;
    dStage_dt_c_fieldMapLoader(buf.get(), reinterpret_cast<dStage_dt_c*>(&data));
    if (data.getMapPath() == nullptr) return;
    JsonWriter w;
    w.beginObject();
    w.member("no", roomNo);
    const int save = stage.saveTable;
    tracker::map::write_room_shapes(w, data.getMapPath(), [save](const dDrawPath_c::group_class& g) { return group_shown(g, save); });
    w.endObject();
    stage.roomJson.push_back(w.str());
}

void finish() {
    std::string out = R"({"ready":true,"regions":[)";
    bool firstRegion = true;
    for (int region = 1; region <= kRegions; region++) {
        bool any = false;
        for (const Stage& s : g_stages) any = any || (s.region == region && !s.roomJson.empty());
        if (!any) continue;
        JsonWriter head;
        head.beginObject();
        head.member("no", region);
        head.key("x").number(g_regionX[region - 1]);
        head.key("z").number(g_regionZ[region - 1]);
        head.endObject();
        std::string regionJson = head.str();
        regionJson.pop_back();  // reopen the object for "stages"
        regionJson += R"(,"stages":[)";
        bool firstStage = true;
        for (const Stage& s : g_stages) {
            if (s.region != region || s.roomJson.empty()) continue;
            JsonWriter sw;
            sw.beginObject();
            sw.member("name", s.name);
            sw.key("x").number(s.x);
            sw.key("z").number(s.z);
            sw.endObject();
            std::string stageJson = sw.str();
            stageJson.pop_back();
            stageJson += R"(,"rooms":[)";
            for (std::size_t i = 0; i < s.roomJson.size(); i++) {
                if (i) stageJson += ',';
                stageJson += s.roomJson[i];
            }
            stageJson += "]}";
            if (!firstStage) regionJson += ',';
            regionJson += stageJson;
            firstStage = false;
        }
        regionJson += "]}";
        if (!firstRegion) out += ',';
        out += regionJson;
        firstRegion = false;
    }
    out += "]}";
    g_json = std::move(out);
    // The room data is in the JSON now.
    for (Stage& s : g_stages) {
        s.roomJson.clear();
        s.roomJson.shrink_to_fit();
    }
}

void build_visited() {
    const char* now = dComIfGp_getStartStageName();
    JsonWriter w;
    w.beginObject();
    w.member("level", static_cast<int>(dComIfGp_getNowLevel()));
    w.key("stages").beginObject();
    for (const Stage& s : g_stages) {
        if (s.visitedTable < 0) continue;
        const bool here = now != nullptr && s.name == now;
        w.key(s.name).beginArray();
        for (int roomNo : s.rooms) {
            const bool visited = dComIfGs_isSaveVisitedRoom(s.visitedTable, roomNo) != FALSE ||
                                 (here && dMapInfo_n::isVisitedRoom(roomNo));
            if (visited) w.value(roomNo);
        }
        w.endArray();
    }
    w.endObject();
    w.endObject();
    g_visited = w.str();
}

}  // namespace

void update() {
    g_frame++;
    if (!tracker::is_playing()) return;
    switch (g_phase) {
    case Phase::Idle:
        if (g_requested) {
            g_phase = Phase::Index;
            g_json = R"({"ready":false,"reading":true})";
        }
        break;
    case Phase::Index:
        if (dComIfGp_getFieldMapArchive2() == nullptr) {
            g_phase = Phase::Failed;
            g_json = R"({"ready":false,"error":"The game's field map archive is not loaded."})";
        } else if (!read_index()) {
            g_phase = Phase::Failed;
            g_json = R"({"ready":false,"error":"dat/field.dat could not be read."})";
        } else if (g_stages.empty()) {
            g_phase = Phase::Failed;
            g_json = R"({"ready":false,"error":"dat/field.dat lists no stages."})";
        } else {
            g_phase = Phase::Stages;
            g_stage = 0;
            g_json = R"({"ready":false,"reading":true})";
        }
        break;
    case Phase::Stages: {
        // Progress for the page while reading.
        if (g_frame % 30 == 0) {
            int rooms = 0;
            for (const Stage& st : g_stages) rooms += static_cast<int>(st.roomJson.size());
            g_json = R"({"ready":false,"reading":true,"stage":)" + std::to_string(g_stage) + R"(,"stages":)" +
                     std::to_string(g_stages.size()) + R"(,"rooms":)" + std::to_string(rooms) + "}";
        }
        // One stage header or one room a frame.
        if (g_stage >= g_stages.size()) {
            finish();
            if (g_json == R"({"ready":true,"regions":[]})") {
                g_phase = Phase::Failed;
                g_json = R"({"ready":false,"error":"No room of the field stages had map data."})";
                break;
            }
            build_visited();
            g_phase = Phase::Done;
            break;
        }
        Stage& stage = g_stages[g_stage];
        if (!stage.headerRead) {
            stage.headerRead = true;
            if (!read_stage_header(stage)) g_stage++;
        } else if (stage.nextRoom < stage.rooms.size()) {
            read_room(stage, stage.rooms[stage.nextRoom++]);
        } else {
            g_stage++;
        }
        break;
    }
    case Phase::Done:
        if (g_frame % kVisitedEveryFrames == 0) build_visited();
        break;
    case Phase::Failed:
        break;
    }
}

const std::string& cached_map() {
    g_requested = true;
    return g_json;
}

const std::string& cached_visited() {
    g_requested = true;
    return g_visited;
}

}  // namespace tracker::fieldmap
