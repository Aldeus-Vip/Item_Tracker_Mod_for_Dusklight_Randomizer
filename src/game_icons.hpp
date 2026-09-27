#pragma once

#include <cstdint>
#include <string>

namespace tracker::icons {

// PNG of the game's own item icon for a game item number, built the way the item menus draw it:
// the icon's textures from the item icon archive, tinted with the menu's colors and layered.
// Returns an empty string when the icon cannot be built (yet), e.g. before the archive is loaded.
// Game thread only; results are cached.
std::string item_icon_png(uint8_t itemNo);

}  // namespace tracker::icons
