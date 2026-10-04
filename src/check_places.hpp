#pragma once

#include <cstdint>
#include <string>
#include <vector>

// Where the checks are placed in the game: every stage's room files (/res/Stage/<stage>/R??_00.arc
// room.dzr, STG_00.arc stage.dzs / room<n>.dzs) are read from the disc a little each frame, and
// the actors that give checks (chests, items lying around, heart pieces, small keys, poes) are
// kept under the randomizer's check names (mods/items.h: chest:<stage>:<box>, ...). The result is
// saved in the mod's data folder, so this is done once. Game thread only.
namespace tracker::places {

struct Place {
    std::string key;
    int room;  // -1: placed by the stage file
    float x;
    float y;
    float z;
};

// The checks in one room file (a .dzs / .dzr, as on the disc or as loaded by the game; size 0 when
// a loaded file's size is not known), added to out unless already there.
void parse_room_file(const std::string& stage, int room, const uint8_t* data, uint32_t size, std::vector<Place>& out);

// A position placed in a room (world coordinates) moved to the map's coordinates by the room's
// offset and turn (FILI), as dMapInfo_n::correctionOriginPos does; unchanged when not known.
void to_map(const std::string& stage, int room, float& x, float& z);
// Whether the rooms' offsets of a stage are known.
bool shift_known(const std::string& stage);

// The file the result is kept in (the mod's data folder).
void set_cache_file(std::string path);

// Once per frame: reads a little more while the game is plainly playing.
void update();

// The places of one stage (nullptr when not known yet).
const std::vector<Place>* stage_places(const std::string& stage);

// {"done", "read", "total", "stages": {"<stage>": [{"key", "room", "x", "y", "z", "floor"}]},
//  "maps": [stage with a map], "mapRooms": {stage: [room]}, "singleRooms": [stage whose map shows
//  one room at a time]} ("stages" and "maps" once done; "read" / "total" archives while
// reading).
const std::string& cached_json();

// A stage's map, read from its room files: {"stage", "rooms": [{"no", "floors", "vertices"}]} in
// the format of map_data.hpp ("" when not known).
std::string stage_map_json(const std::string& stage);

// A dungeon's map background (the game's dungeon map parchment, with the dungeon's emblem) as PNG,
// by its stage (D_MN05...). "" until read: asking for it queues the read.
std::string dungeon_art(const std::string& stage);

}  // namespace tracker::places
