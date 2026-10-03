#pragma once

#include <string>

// The map the game draws in its pause menu and minimap, read from the rooms it has loaded for the
// current stage (dMpath_c): per room, floors of groups of filled shapes and lines, in the map's
// own x/z coordinates. Game thread only.
namespace tracker::map {

// {"stage", "stayRoom", "floors": [bottom, top], "player": {x, z, angle}, "wolf", "stayFloor" (when the
//  game has decided it), "hasMap", "hasCompass",
//  "rooms": [{"no", "layer", "visited", "vertices": [x, z, ...], "floors": [{"no", "groups":
//  [{"sw", "swType", "shown", "polys": [{"type", "strip": [index...]}], "lines": [{"type",
//  "width", "strip": [index...]}]}]}]}]}. Shapes are triangle strips over the room's vertices.
std::string build_json();

// Just {"stage", "stayRoom", "player", "wolf", "stayFloor"}, for following Link several times a
// second ("wolf": Link is a wolf).
std::string build_player_json();

}  // namespace tracker::map
