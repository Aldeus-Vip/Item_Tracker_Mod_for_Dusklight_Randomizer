#pragma once

#include <string>

// The map the game draws in its pause menu and minimap, read from the rooms it has loaded for the
// current stage (dMpath_c): per room, floors of groups of filled shapes and lines, in the map's
// own x/z coordinates. Game thread only.
//
// The game's map data lives in the stage's memory and is not cleared when a stage is left, reset
// or reloaded, so it is read only while the game is plainly playing (a live Link, no stage change
// pending, no reset) and has been for a moment; the JSON is built then and kept for the server.
namespace tracker::map {

// {"stage", "stayRoom", "floors": [bottom, top], "player": {x, z, angle}, "wolf", "stayFloor" (when the
//  game has decided it), "hasMap", "hasCompass",
//  "rooms": [{"no", "layer", "visited", "vertices": [x, z, ...], "floors": [{"no", "groups":
//  [{"sw", "swType", "shown", "polys": [{"type", "strip": [index...]}], "lines": [{"type",
//  "width", "strip": [index...]}]}]}]}]}. Shapes are triangle strips over the room's vertices.
std::string build_json();

// Once per frame: refreshes the cached map and player JSON when it is safe to read them.
void update();

// The last map / player JSON built by update() ({"exists":false} / {"loading":true} until then).
const std::string& cached_map();
const std::string& cached_player();

// Just {"stage", "stayRoom", "player", "wolf", "stayFloor"}, for following Link several times a
// second ("wolf": Link is a wolf).
std::string build_player_json();

}  // namespace tracker::map
