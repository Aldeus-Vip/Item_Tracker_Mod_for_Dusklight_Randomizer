#pragma once

#include <string>

namespace tracker {

// Protocol version sent to the tracker page. Bump when the JSON layout changes incompatibly.
inline constexpr int kProtocolVersion = 1;

// Reads the live save data and serializes it as the tracker state JSON (see docs/protocol.md).
// When no save is active (title screen, file select), writes {"inGame":false,...} instead.
std::string build_state_json();

// A save is being played (not the title screen or file select).
bool is_in_game();

// The game is plainly playing: a save is loaded, Link is a live actor, no stage change is pending
// and no reset is in progress. Game memory tied to the stage (map data, actors) is only read then.
bool is_playing();

}  // namespace tracker
