#pragma once

#include <string>

// Randomizer data used by the location tracker (check list, logic graph, macros, items, settings).
//
// The files belong to TwilitRealm/dusklight-randomizer and are not bundled with this mod: they are
// downloaded from the public repository into <data dir>/rando-data/ on first use and served to the
// tracker page from there. The randomizer's own settings.yaml (the user's current seed options) is
// read from its data directory.
namespace tracker::rando {

// Sets the storage locations. `dataDir` is this mod's data directory.
void init(const std::string& dataDir);

// Starts downloading any missing file (or every file when `force` is set) from `ref`
// (a branch, tag or commit of the randomizer repository).
void download(const std::string& ref, bool force);

// Human-readable download status for the mod panel.
std::string status();

// Absolute path of a downloaded data file (e.g. "world/dungeons/Forest Temple.yaml"), or empty
// if `relative` is not one of the known files.
std::string data_file(const std::string& relative);

// Absolute path of the randomizer's settings.yaml.
std::string settings_file();

}  // namespace tracker::rando
