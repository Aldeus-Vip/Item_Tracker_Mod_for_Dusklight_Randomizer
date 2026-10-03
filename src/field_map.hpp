#pragma once

#include <string>

// The overworld as the game's map screen shows it (dMenu_Fmap_c): every province (region) with
// its field stages placed side by side, read from the game's field map archive (dat/field.dat,
// <stage>/stage.dat, <stage>/room<n>.dzs) the way the map screen reads them. Game thread only.
//
// Reading it all takes a while, so it starts when the page first asks for it and goes one room
// per frame, only while the game is plainly playing (tracker::is_playing).
namespace tracker::fieldmap {

// Once per frame.
void update();

// {"ready": false} until read; then {"ready": true, "regions": [{"no", "x", "z", "stages":
//  [{"name", "x", "z", "rooms": [{"no", "floors", "vertices"}]}]}]}: room shapes in the format of
// map_data.hpp, placed at region (x, z) + stage (x, z). {"ready": false, "error"} if the archive
// cannot be read. Asking for it starts the reading.
const std::string& cached_map();

// {"level": the province Link is in (region no), "stages": {"<name>": [visited room no, ...]}}:
// what the game's map screen shows (stages with a visited room). Rebuilt every few seconds.
const std::string& cached_visited();

}  // namespace tracker::fieldmap
