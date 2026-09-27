#pragma once

#include <string>

namespace tracker {

// Protocol version sent to the tracker page. Bump when the JSON layout changes incompatibly.
inline constexpr int kProtocolVersion = 1;

// Reads the live save data and serializes it as the tracker state JSON (see docs/protocol.md).
// When no save is active (title screen, file select), writes {"inGame":false,...} instead.
std::string build_state_json();

}  // namespace tracker
