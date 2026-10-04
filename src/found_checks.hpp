#pragma once

#include <string>

namespace tracker {
class JsonWriter;
}

// What the player has learned about the seed's placements without collecting the items: hints
// read, freestanding items seen near Link, and shops entered (reported by the page). The list is
// kept with the save file (this mod's save data for the slot) and written only when the game
// saves, so loading a save shows exactly what was known at that save. The seed hash the page used
// is stored alongside, so loading a save also picks its seed.
//
// Entries are strings: "check:<item check name>[\t<hex item it looks like>]" (e.g.
// "check:freestanding:F_SP108:23\t1d"), "hint:<location as named in the hint>",
// "loc:<location name>" (seen in a shop) and "told:<location name>" (an NPC named the item).
// The page also keeps its per-save marks here: "map:<region>" (marked reachable),
// "mark:<location>" (marked checked by hand) and "note:<key>\t<text>".
namespace tracker::found {

// Registers the save observers, the item check watcher and the message hook. Game thread.
void init();

// Once per frame: reveals watched freestanding items once Link is close to them and can see them.
void update();

// Adds entries sent by the page: an optional first line "seed\t<hash>", then one entry per line.
// "-<entry key>" removes a map, mark or note entry; a note entry replaces the note of its key.
void add_from_page(const std::string& body);

// Writes "found": {"seed": "<hash or empty>", "entries": [...]} into the state object.
void write_json(tracker::JsonWriter& w);

// How close Link must be to an item lying around to count it as seen (game units, ~cm).
void set_see_distance(float distance);

}  // namespace tracker::found
