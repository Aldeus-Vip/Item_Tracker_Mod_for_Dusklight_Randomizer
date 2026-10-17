#pragma once

// Dusklight's user texture replacements (<config>/texture_replacements, "tex1_..." .dds/.png files)
// applied to the textures the mod decodes itself (item icons, map icons, dungeon map backgrounds),
// matched the way Aurora matches them: by the XXH64 of the texture's base level (and of the part of
// its palette the texels use). Only while Dusklight's "Texture Replacements" setting is on; the
// folder is read again when the setting is switched, as Dusklight does. Replacements of other mods
// (their textures/ folders) are not seen. No game dependencies, so the host tests can exercise it.

#include "gx_texture.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string_view>
#include <vector>

namespace tracker::texrep {

// Dusklight's config folder (the one with config.json and texture_replacements/).
void set_config_dir(std::filesystem::path dir);

// Changes whenever the replacements in use change; callers keeping decoded images compare it.
// Checks Dusklight's setting (config.json) at most once a second.
uint64_t revision();

// The texture of a ResTIMG (header + data), or its replacement when one matches.
gx::Image decode(const uint8_t* timg, size_t size);

// ---- Exposed for the tests ----

constexpr uint64_t kWildcardTexture = 0xFFFFFFFFFFFFFFFFull;  // "$" in a file name
constexpr uint64_t kWildcardTlut = 0xFFFFFFFFFFFFFFFEull;

struct Key {
    uint64_t textureHash = 0;
    uint64_t tlutHash = 0;
    uint32_t width = 0;
    uint32_t height = 0;
    uint32_t format = 0;
    bool hasTlut = false;
    bool operator==(const Key&) const = default;
};

uint64_t xxh64(const void* data, size_t size, uint64_t seed = 0);
std::optional<Key> parse_filename(std::string_view filename);
std::optional<Key> key_of(const uint8_t* timg, size_t size);
// A .png or .dds file (RGBA8/BGRA8, BC1, BC3, BC5, BC7; first mip only).
gx::Image decode_file(const std::vector<uint8_t>& bytes, bool png);

}  // namespace tracker::texrep
