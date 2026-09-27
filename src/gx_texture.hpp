#pragma once

// GameCube texture (BTI / ResTIMG) decoding, J2DPicture-style tinting and PNG encoding for the
// item icons the mod builds from the game's own icon archive. No game dependencies, so the host
// tests can exercise it.

#include <array>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace tracker::gx {

struct Image {
    int width = 0;
    int height = 0;
    std::vector<uint8_t> rgba;  // width * height * 4, straight alpha
};

using Color = std::array<uint8_t, 4>;  // r, g, b, a

// Decodes a ResTIMG header (0x20 bytes, big-endian) followed by its data. Offsets in the header
// are relative to its start. Returns an empty image for unsupported formats or bad sizes.
Image decode_timg(const uint8_t* data, size_t size);

// One J2DPicture layer as the item menu draws it.
struct Layer {
    Image texture;
    bool alphaEnabled = true;             // ResTIMG alphaEnabled: use the texture's alpha
    Color black{0, 0, 0, 0};              // J2DPicture::setBlackWhite
    Color white{255, 255, 255, 255};
    std::array<Color, 4> corners{{{255, 255, 255, 255}, {255, 255, 255, 255},
        {255, 255, 255, 255}, {255, 255, 255, 255}}};  // left-up, right-up, left-down, right-down
};

// Draws the layers in order over a transparent canvas of the first layer's size, with the TEV
// setup of J2DPicture: color = lerp(black, white, texel), then multiplied by the corner colors.
Image compose(const std::vector<Layer>& layers);

// Uncompressed (stored-deflate) RGBA PNG.
std::string encode_png(const Image& image);

}  // namespace tracker::gx
