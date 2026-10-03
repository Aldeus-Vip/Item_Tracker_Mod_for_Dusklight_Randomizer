#include "map_data.hpp"

#include "json_writer.hpp"

#include "d/d_com_inf_game.h"
#include "d/d_map_path_dmap.h"
#include "d/d_save.h"
#include "tracker_state.hpp"

#include <cstring>

namespace tracker::map {
namespace {

// How the game decides whether a group is drawn (renderingDAmap_c::isSwitch): groups tied to a
// stage switch appear when it is off (type 0) or on (other types).
bool group_shown(const dDrawPath_c::group_class& g, int roomNo) {
    if (g.mSwbit == 0xFF) return true;
    const bool on = dComIfGs_isSwitch(g.mSwbit, roomNo) != FALSE;
    return g.field_0x1 == 0 ? !on : on;
}

void write_strip(JsonWriter& w, const BE(u16)* data, int count, int& maxIndex) {
    w.key("strip").beginArray();
    for (int i = 0; i < count; i++) {
        const int index = static_cast<u16>(data[i]);
        if (index > maxIndex) maxIndex = index;
        w.value(index);
    }
    w.endArray();
}

void write_room(JsonWriter& w, int layer, int roomNo, dDrawPath_c::room_class* room) {
    w.beginObject();
    w.member("no", roomNo);
    w.member("layer", layer);
    w.member("visited", dMapInfo_n::isVisitedRoom(roomNo));
    int maxIndex = -1;
    w.key("floors").beginArray();
    dDrawPath_c::floor_class* floor = room->mpFloor;
    for (int f = 0; floor != nullptr && f < room->mFloorNum; f++, floor++) {
        w.beginObject();
        w.member("no", static_cast<int>(floor->mFloorNo));
        w.key("groups").beginArray();
        dDrawPath_c::group_class* group = floor->mpGroup;
        for (int g = 0; group != nullptr && g < floor->mGroupNum; g++, group++) {
            w.beginObject();
            w.member("sw", static_cast<int>(group->mSwbit));
            w.member("swType", static_cast<int>(group->field_0x1));
            w.member("shown", group_shown(*group, roomNo));
            w.key("polys").beginArray();
            dDrawPath_c::poly_class* poly = group->mpPoly;
            for (int i = 0; poly != nullptr && i < group->mPolyNum; i++, poly++) {
                w.beginObject();
                w.member("type", static_cast<int>(poly->field_0x0));
                write_strip(w, poly->mpData, poly->mDataNum, maxIndex);
                w.endObject();
            }
            w.endArray();
            w.key("lines").beginArray();
            dDrawPath_c::line_class* line = group->mpLine;
            for (int i = 0; line != nullptr && i < group->mLineNum; i++, line++) {
                w.beginObject();
                w.member("type", static_cast<int>(line->field_0x0));
                w.member("width", static_cast<int>(line->field_0x1));
                write_strip(w, line->mpData, line->mDataNum, maxIndex);
                w.endObject();
            }
            w.endArray();
            w.endObject();
        }
        w.endArray();
        w.endObject();
    }
    w.endArray();
    // Vertices: x, z pairs (the game's position array has an 8-byte stride).
    w.key("vertices").beginArray();
    const BE(f32)* xz = room->mpFloatData;
    for (int i = 0; xz != nullptr && i <= maxIndex; i++) {
        w.number(static_cast<f32>(xz[i * 2]));
        w.number(static_cast<f32>(xz[i * 2 + 1]));
    }
    w.endArray();
    w.endObject();
}

// Link's position on the map, his angle and the floor the game puts him on.
void write_player(JsonWriter& w) {
    const Vec pos = dMapInfo_n::getMapPlayerPos();
    w.key("player").beginObject();
    w.key("x").number(pos.x);
    w.key("y").number(pos.y);
    w.key("z").number(pos.z);
    // Game angle units (0x10000 = a full turn).
    w.member("angle", static_cast<int>(static_cast<u16>(dMapInfo_n::getMapPlayerAngleY())));
    w.endObject();
    w.member("wolf", dComIfGs_getTransformStatus() != TF_STATUS_HUMAN);
    if (dMapInfo_c::mNowStayFloorNoDecisionFlg) {
        w.member("stayFloor", static_cast<int>(dMapInfo_c::mNowStayFloorNo));
    }
}

}  // namespace

std::string build_player_json() {
    JsonWriter w;
    w.beginObject();
    const char* stage = dComIfGp_getStartStageName();
    w.member("stage", stage != nullptr ? stage : "");
    w.member("stayRoom", static_cast<int>(dComIfGp_roomControl_getStayNo()));
    if (dMpath_c::mLayerList != nullptr && dMpath_c::isExistMapPathData()) write_player(w);
    w.endObject();
    return w.str();
}

std::string build_json() {
    JsonWriter w;
    w.beginObject();
    const char* stage = dComIfGp_getStartStageName();
    w.member("stage", stage != nullptr ? stage : "");
    w.member("stayRoom", static_cast<int>(dComIfGp_roomControl_getStayNo()));
    const bool exists = dMpath_c::mLayerList != nullptr && dMpath_c::isExistMapPathData();
    w.member("exists", exists);
    if (exists) {
        s8 top = 0;
        s8 bottom = 0;
        dMpath_c::getTopBottomFloorNo(&top, &bottom);
        w.key("floors").beginArray().value(static_cast<int>(bottom)).value(static_cast<int>(top)).endArray();
        w.key("bounds").beginObject();
        w.key("minX").number(dMpath_c::getMinX());
        w.key("maxX").number(dMpath_c::getMaxX());
        w.key("minZ").number(dMpath_c::getMinZ());
        w.key("maxZ").number(dMpath_c::getMaxZ());
        w.endObject();
        w.member("hasMap", dMapInfo_n::chkGetMap());
        w.member("hasCompass", dMapInfo_n::chkGetCompass());
        write_player(w);
        w.key("rooms").beginArray();
        for (int layer = 0; layer < 2; layer++) {
            for (int roomNo = 0; roomNo < 0x40; roomNo++) {
                dDrawPath_c::room_class* room = dMpath_c::getRoomPointer(layer, roomNo);
                if (room != nullptr) write_room(w, layer, roomNo, room);
            }
        }
        w.endArray();
    }
    w.endObject();
    return w.str();
}

namespace {

constexpr int kSettleFrames = 30;      // stable frames after a stage or room change before reading
constexpr int kPlayerEveryFrames = 4;  // Link's position: ~15 times a second
constexpr int kMapEveryFrames = 90;    // the map itself: visited rooms and switches change rarely

std::string g_map = R"({"exists":false})";
std::string g_player = R"({"loading":true})";
std::string g_stage;
int g_stableFrames = 0;
int g_frame = 0;
bool g_mapStale = true;

}  // namespace

void update() {
    g_frame++;
    if (!tracker::is_playing()) {
        g_stableFrames = 0;
        g_player = R"({"loading":true})";
        g_mapStale = true;
        return;
    }
    const char* stage = dComIfGp_getStartStageName();
    if (stage == nullptr || g_stage != stage) {
        g_stage = stage != nullptr ? stage : "";
        g_stableFrames = 0;
        g_mapStale = true;
        g_map = R"({"exists":false})";
        return;
    }
    if (g_stableFrames < kSettleFrames) {
        g_stableFrames++;
        return;
    }
    if (g_frame % kPlayerEveryFrames == 0) g_player = build_player_json();
    if (g_mapStale || g_frame % kMapEveryFrames == 0) {
        g_map = build_json();
        g_mapStale = false;
    }
}

const std::string& cached_map() { return g_map; }
const std::string& cached_player() { return g_player; }

}  // namespace tracker::map
