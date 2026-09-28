#pragma once

#include <string>

namespace tracker::textures {

// Textures (.bti) of the game's 2D archives, for the texture browser and for icons made from a
// game texture. Archives are named "itemicon" (item icons), "dmap" (dungeon map) and "fmap" (field
// map). Game thread only.

// JSON array of the .bti file names in an archive, or "" for an unknown or unloaded archive.
std::string list_json(const std::string& archive);

// PNG of one texture, drawn with neutral colors. `name` is a file name ("tt_map_48.bti", found in
// any directory of the archive) or, for "#<n>", the n-th file entry. Returns "" when it cannot be
// read or decoded.
std::string texture_png(const std::string& archive, const std::string& name);

}  // namespace tracker::textures
