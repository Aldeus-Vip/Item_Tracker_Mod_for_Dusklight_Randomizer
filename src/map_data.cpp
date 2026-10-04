#include "map_data.hpp"

#include "json_writer.hpp"

#include "d/d_com_inf_game.h"
#include "d/d_map_path_dmap.h"
#include "d/d_save.h"
#include "d/d_stage.h"
#include "d/d_tresure.h"
#include "d/d_lib.h"
#include "JSystem/JKernel/JKRAramArchive.h"
#include "d/actor/d_a_door_shutter.h"
#include "f_op/f_op_actor_mng.h"
#include "check_places.hpp"
#include "tracker_state.hpp"

#include <cmath>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <memory>
#include <new>
#include <vector>
#include <functional>

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
    write_room_shapes(w, room, [roomNo](const dDrawPath_c::group_class& g) { return group_shown(g, roomNo); });
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

// Switch state as the game sees it; zone switches of rooms not loaded are unknown (-1).
int switch_state(int sw, int roomNo) {
    if (sw == 0xFF || roomNo < 0 || roomNo >= 64) return -1;
    if (sw >= 0xC0 && dComIfGp_roomControl_getZoneNo(roomNo) < 0) return -1;
    return dComIfGs_isSwitch(sw, roomNo) ? 1 : 0;
}

// Door shutters alive in the loaded rooms (daDoor20_c), to see bars that drop behind Link (a room
// that shuts until its enemies are beaten) as they happen.
struct LiveDoor {
    float x;
    float z;
    bool barred;
};

void* collect_door(void* actor, void* data) {
    auto* ac = static_cast<fopAc_ac_c*>(actor);
    if (ac == nullptr || fopAcM_GetName(ac) != fpcNm_DOOR20_e) return nullptr;
    auto* door = static_cast<daDoor20_c*>(ac);
    // The bar is down while its stop exists and is not raised all the way (300 = open).
    const bool barred = door->mDoorStop.field_0x8 != 0 && door->mDoorStop.field_0x4 < 299.0f;
    static_cast<std::vector<LiveDoor>*>(data)->push_back({ac->home.pos.x, ac->home.pos.z, barred});
    return nullptr;
}

std::vector<LiveDoor> live_doors() {
    std::vector<LiveDoor> out;
    fopAcM_Search(collect_door, &out);
    return out;
}

// One door the game marks on its maps (renderingPlusDoor_c::drawDoorCommon): its place, the
// rooms on both sides and floors, its kind and its state now.
struct DoorInfo {
    char name[9] = {};
    int front = 0;
    int back = 0;
    float rawX = 0;
    float rawZ = 0;
    BE(Vec) pos;
    int angle = 0;
    // "boss" (big key door), "key" (small key lock), "stop" (bars until a switch), "switch" (a
    // heavy door shut until a mechanism sets its switch), "door".
    const char* kind = "door";
    // 'L' locked, 'U' unlocked, 'C' barred (bars down now), 'F' / 'B' shut from the front / back
    // side only (the front faces the front room, the door's facing), 'D' shut from both sides,
    // 'O' open, '?' unknown.
    char state = 'O';
};

// A door shut per side by switches (1 open, 0 shut, -1 unknown).
char side_state(int front, int back) {
    if (front < 0 && back < 0) return '?';
    const bool f = front == 0;
    const bool b = back == 0;
    return f && b ? 'D' : f ? 'F' : b ? 'B' : 'O';
}

DoorInfo door_info(const stage_tgsc_data_class& d, bool stageDoor, const std::vector<LiveDoor>& live) {
    DoorInfo out;
    const u32 prm = d.base.parameters;
    out.front = (prm >> 13) & 0x3F;
    out.back = (prm >> 19) & 0x3F;
    const int frontOpt = (prm >> 8) & 0x3;
    const int backOpt = (prm >> 10) & 0x7;
    const u16 angleZ = static_cast<u16>(static_cast<s16>(d.base.angle.z));
    const int sw = angleZ & 0xFF;
    const int sw2 = angleZ >> 8;
    out.rawX = d.base.position.x;
    out.rawZ = d.base.position.z;
    out.pos.x = d.base.position.x;
    out.pos.y = d.base.position.y;
    out.pos.z = d.base.position.z;
    if (stageDoor) dMapInfo_n::correctionOriginPos(static_cast<s8>(out.front), &out.pos);
    out.angle = static_cast<u16>(static_cast<s16>(d.base.angle.y));
    std::memcpy(out.name, d.name, 8);

    const bool boss = std::strcmp(out.name, "bdoor") == 0 || std::strstr(out.name, "Bdoor") != nullptr;
    if (boss) {
        out.kind = "boss";
        const int s = switch_state(sw, out.front);
        if (s >= 0) out.state = s == 0 ? 'L' : 'U';
        else out.state = sw == 0xFF ? (dComIfGs_isDungeonItemBossKey() == 0 ? 'L' : 'U') : '?';
    } else if (frontOpt == 2 || backOpt == 2) {
        out.kind = "key";
        const int s = switch_state(sw, out.front);
        out.state = s < 0 ? '?' : s == 0 ? 'L' : 'U';
    } else if (std::strncmp(out.name, "L", 1) == 0 && std::strstr(out.name, "door") != nullptr &&
               ((frontOpt == 0 && sw != 0xFF) || (backOpt == 0 && sw2 != 0xFF))) {
        // The dungeons' heavy doors (L1Mdoor..., L5door, L7door: daMBdoorL1_c) also stay shut on a
        // plain switch (checkFrontSw / checkBackSw): a mechanism in the room opens them.
        out.kind = "switch";
        out.state = side_state(frontOpt == 0 && sw != 0xFF ? switch_state(sw, out.front) : 1,
                               backOpt == 0 && sw2 != 0xFF ? switch_state(sw2, out.back) : 1);
    } else {
        const bool stop = frontOpt == 1 || frontOpt == 3 || backOpt == 1 || backOpt == 3;
        if (stop) {
            out.kind = "stop";
            out.state = side_state(frontOpt == 1 || frontOpt == 3 ? switch_state(sw, out.front) : 1,
                                   backOpt == 1 || backOpt == 3 ? switch_state(sw2, out.back) : 1);
        }
    }
    // A door alive now tells best whether its bars are down.
    if (out.state != 'L') {
        for (const LiveDoor& l : live) {
            if (std::fabs(l.x - out.rawX) < 1.0f && std::fabs(l.z - out.rawZ) < 1.0f) {
                if (l.barred) out.state = 'C';
                else if (out.state == '?') out.state = 'O';
                break;
            }
        }
    }
    return out;
}

template <typename F>
void for_each_door(F&& f) {
    const std::vector<LiveDoor> live = live_doors();
    const dStage_KeepDoorInfo* stageDoors = dStage_GetKeepDoorInfo();
    for (int i = 0; stageDoors != nullptr && i < stageDoors->mNum && i < 0x40; i++) {
        f(door_info(stageDoors->mDrTgData[i], true, live));
    }
    const dStage_KeepDoorInfo* roomDoors = dStage_GetRoomKeepDoorInfo();
    for (int i = 0; roomDoors != nullptr && i < roomDoors->mNum && i < 0x40; i++) {
        f(door_info(roomDoors->mDrTgData[i], false, live));
    }
}

void write_doors(JsonWriter& w) {
    w.key("doors").beginArray();
    for_each_door([&](const DoorInfo& d) {
        w.beginObject();
        w.member("name", d.name);
        w.key("rooms").beginArray().value(d.front).value(d.back).endArray();
        w.key("x").number(static_cast<f32>(d.pos.x));
        w.key("z").number(static_cast<f32>(d.pos.z));
        w.member("angle", d.angle);
        w.key("floors").beginArray()
            .value(static_cast<int>(dMapInfo_c::calcFloorNo(d.pos.y, true, d.front)))
            .value(static_cast<int>(dMapInfo_c::calcFloorNo(d.pos.y, true, d.back)))
            .endArray();
        w.member("kind", d.kind);
        if (d.state == 'L' || d.state == 'U') w.member("locked", d.state == 'L');
        w.member("state", std::string(1, d.state));
        w.endObject();
    });
    w.endArray();
}

// The doors' states now, one letter each in the order of "doors" (see DoorInfo::state).
std::string door_states() {
    std::string out;
    for_each_door([&](const DoorInfo& d) { out += d.state; });
    return out;
}

// ---- Where the checks are ----

// Checks placed in the stage's rooms, read from the room files (<stage>/room<n>.dzs in the field
// map archive, which the game also loads rooms from): chests (tbox*: box number), items lying
// around (item / witem: item bit) and poes (E_hp: switch), keyed like the randomizer's check
// names (mods/items.h).
std::vector<tracker::places::Place> g_checks;  // from the rooms loaded now
int g_checkRoom = 0;      // next room to look at (they are looked at again and again: rooms load)
int g_checkRoomsRead = 0; // room files read
bool g_roomScanned[64] = {};
bool g_checksAdded = false;
std::string g_checkStage;

// The checks of a room the game has loaded now (its room.dzr, or room<n>.dzs in the stage
// archive), and of the stage file with room 0's turn. The whole game is read by check_places too;
// this shows the rooms around Link before that is done.
bool scan_room(const std::string& stage, int roomNo) {
    const size_t before = g_checks.size();
    bool found = false;
    if (roomNo == 0) {
        if (void* dzs = dComIfG_getStageRes("stage.dzs")) tracker::places::parse_room_file(stage, -1, static_cast<const u8*>(dzs), 0, g_checks);
    }
    if (void* dzr = dComIfG_getStageRes(dComIfG_getRoomArcName(roomNo), "room.dzr")) {
        tracker::places::parse_room_file(stage, roomNo, static_cast<const u8*>(dzr), 0, g_checks);
        found = true;
    } else {
        char name[16];
        std::snprintf(name, sizeof(name), "room%d.dzs", roomNo);
        if (void* dzs = dComIfG_getStageRes(name)) {
            tracker::places::parse_room_file(stage, roomNo, static_cast<const u8*>(dzs), 0, g_checks);
            found = true;
        }
    }
    if (g_checks.size() != before) g_checksAdded = true;
    return found;
}

void write_checks(JsonWriter& w) {
    w.member("checkRooms", g_checkRoomsRead);
    // The whole game's places once read, with the loaded rooms' (same keys) for what is missing.
    std::vector<tracker::places::Place> all;
    if (const auto* known = tracker::places::stage_places(g_checkStage)) all = *known;
    for (const auto& c : g_checks) {
        bool have = false;
        for (const auto& a : all) have = have || a.key == c.key;
        if (!have) all.push_back(c);
    }
    w.member("checksAll", tracker::places::stage_places(g_checkStage) != nullptr);
    w.key("checks").beginArray();
    for (const auto& c : all) {
        w.beginObject();
        w.member("key", c.key);
        w.member("room", c.room);
        w.key("x").number(c.x);
        w.key("z").number(c.z);
        w.member("floor", static_cast<int>(dMapInfo_c::calcFloorNo(c.y, true, c.room)));
        w.endObject();
    }
    w.endArray();
}

// The map screen's icons of the stage (dTres type groups: small keys 2, monkeys 9, iron balls 11,
// Sols 12, Yeto 13, Yeta 14, statues 15, Ooccoo 16; as d_menu_dmap.cpp draws them).
void write_icons(JsonWriter& w) {
    w.key("icons").beginArray();
    for (int type : {2, 9, 11, 12, 13, 14, 15, 16}) {
        dTres_c::typeGroupData_c* d = dTres_c::getFirstData(static_cast<u8>(type));
        const int count = dTres_c::getTypeGroupNumber(type);
        for (int i = 0; i < count && d != nullptr && i < 256; i++, d = dTres_c::getNextData(d)) {
            const BE(Vec)* pos = d->getPos();
            w.beginObject();
            w.member("type", type);
            w.member("room", static_cast<int>(d->getRoomNo()));
            w.member("sw", static_cast<int>(d->getSwBit()));
            w.key("x").number(static_cast<f32>(pos->x));
            w.key("z").number(static_cast<f32>(pos->z));
            w.member("floor", static_cast<int>(dMapInfo_c::calcFloorNo(pos->y, true, d->getRoomNo())));
            w.endObject();
        }
    }
    w.endArray();
}

// Where the dungeon's boss is (the game's boss map icon, treasure type group 3).
void write_boss(JsonWriter& w) {
    dTres_c::typeGroupData_c* boss = dTres_c::getFirstData(3);
    if (dTres_c::getTypeGroupNumber(3) <= 0 || boss == nullptr) return;
    const BE(Vec)* pos = boss->getPos();
    const int room = boss->getRoomNo();
    w.key("boss").beginObject();
    w.member("room", room);
    w.key("x").number(static_cast<f32>(pos->x));
    w.key("z").number(static_cast<f32>(pos->z));
    w.member("floor", static_cast<int>(dMapInfo_c::calcFloorNo(pos->y, true, room)));
    w.endObject();
}

}  // namespace

void write_room_shapes(JsonWriter& w, const dDrawPath_c::room_class* room,
                       const std::function<bool(const dDrawPath_c::group_class&)>& shown) {
    int maxIndex = -1;
    w.key("floors").beginArray();
    const dDrawPath_c::floor_class* floor = room->mpFloor;
    for (int f = 0; floor != nullptr && f < room->mFloorNum; f++, floor++) {
        w.beginObject();
        w.member("no", static_cast<int>(floor->mFloorNo));
        w.key("groups").beginArray();
        const dDrawPath_c::group_class* group = floor->mpGroup;
        for (int g = 0; group != nullptr && g < floor->mGroupNum; g++, group++) {
            w.beginObject();
            w.member("sw", static_cast<int>(group->mSwbit));
            w.member("swType", static_cast<int>(group->field_0x1));
            w.member("shown", shown(*group));
            w.key("polys").beginArray();
            const dDrawPath_c::poly_class* poly = group->mpPoly;
            for (int i = 0; poly != nullptr && i < group->mPolyNum; i++, poly++) {
                w.beginObject();
                w.member("type", static_cast<int>(poly->field_0x0));
                write_strip(w, poly->mpData, poly->mDataNum, maxIndex);
                w.endObject();
            }
            w.endArray();
            w.key("lines").beginArray();
            const dDrawPath_c::line_class* line = group->mpLine;
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
}

std::string build_player_json() {
    JsonWriter w;
    w.beginObject();
    const char* stage = dComIfGp_getStartStageName();
    w.member("stage", stage != nullptr ? stage : "");
    w.member("stayRoom", static_cast<int>(dComIfGp_roomControl_getStayNo()));
    if (dMpath_c::mLayerList != nullptr && dMpath_c::isExistMapPathData()) {
        write_player(w);
        if (stage != nullptr && std::strncmp(stage, "D_", 2) == 0) w.member("doors", door_states());
    }
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
        write_doors(w);
        write_boss(w);
        write_checks(w);
        write_icons(w);
        // Stages whose map shows only the room Link is in (STAG up button 2, 3, 6: renderingAmap_c::
        // isRendAllRoom), such as Lake Hylia and Lanayru Spring.
        stage_stag_info_class* stag = dComIfGp_getStage() != nullptr ? dComIfGp_getStage()->getStagInfo() : nullptr;
        const int upButton = stag != nullptr ? dStage_stagInfo_GetUpButton(stag) : 0;
        w.member("singleRoom", upButton == 2 || upButton == 3 || upButton == 6);
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
int g_doorCount = -1;

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
        g_checks.clear();
        g_checkRoom = 0;
        g_checkRoomsRead = 0;
        std::fill(std::begin(g_roomScanned), std::end(g_roomScanned), false);
        g_checkStage = g_stage;
        return;
    }
    if (g_stableFrames < kSettleFrames) {
        g_stableFrames++;
        return;
    }
    // The checks: one room file a frame, then the map is rebuilt with them.
    // Rooms not read yet are looked at again as they may load later.
    {
        const int room = g_checkRoom;
        g_checkRoom = (g_checkRoom + 1) % 64;
        if (!g_roomScanned[room] && scan_room(g_checkStage, room)) {
            g_roomScanned[room] = true;
            g_checkRoomsRead++;
        }
        if (g_checksAdded && g_checkRoom == 0) {
            g_checksAdded = false;
            g_mapStale = true;
        }
    }
    if (g_frame % kPlayerEveryFrames == 0) {
        g_player = build_player_json();
        // Doors appear as rooms load: rebuild the map when their number changes.
        const dStage_KeepDoorInfo* a = dStage_GetKeepDoorInfo();
        const dStage_KeepDoorInfo* b = dStage_GetRoomKeepDoorInfo();
        const int doors = (a != nullptr ? a->mNum : 0) + (b != nullptr ? b->mNum : 0);
        if (doors != g_doorCount) {
            g_doorCount = doors;
            g_mapStale = true;
        }
    }
    if (g_mapStale || g_frame % kMapEveryFrames == 0) {
        g_map = build_json();
        g_mapStale = false;
    }
}

const std::string& cached_map() { return g_map; }
const std::string& cached_player() { return g_player; }

}  // namespace tracker::map
