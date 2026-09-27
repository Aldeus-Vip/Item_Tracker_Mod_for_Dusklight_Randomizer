// Host-side test for src/gx_texture.cpp: texture decoding, J2DPicture-style tinting and PNG output.
// Build and run with tests/run.sh.

#include "../src/gx_texture.hpp"

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

using namespace tracker::gx;

namespace {

int g_failures = 0;
void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++g_failures;
}

std::vector<uint8_t> header(uint8_t format, int w, int h, bool alpha = true) {
    std::vector<uint8_t> d(0x20, 0);
    d[0] = format;
    d[1] = alpha;
    d[2] = static_cast<uint8_t>(w >> 8);
    d[3] = static_cast<uint8_t>(w);
    d[4] = static_cast<uint8_t>(h >> 8);
    d[5] = static_cast<uint8_t>(h);
    d[0x1F] = 0x20;  // image data right after the header
    return d;
}

const uint8_t* px(const Image& img, int x, int y) { return &img.rgba[(static_cast<size_t>(y) * img.width + x) * 4]; }

}  // namespace

int main() {
    // I4, 16x8: two 8x8 blocks. Block 0 pixel (1,0) = 0xF, block 1 pixel (0,0) = 0x8.
    auto i4 = header(0, 16, 8);
    std::vector<uint8_t> blocks(64, 0);
    blocks[0] = 0x0F;
    blocks[32] = 0x80;
    i4.insert(i4.end(), blocks.begin(), blocks.end());
    Image img = decode_timg(i4.data(), i4.size());
    check(img.width == 16 && img.height == 8, "I4 size");
    check(px(img, 1, 0)[0] == 255 && px(img, 1, 0)[3] == 255, "I4 block 0 texel");
    check(px(img, 8, 0)[0] == 0x88 && px(img, 0, 0)[0] == 0, "I4 block order (left to right)");
    check(decode_timg(i4.data(), i4.size() - 1).width == 0, "truncated data is rejected");

    // IA4 8x4: alpha in the high nibble.
    auto ia4 = header(2, 8, 4);
    std::vector<uint8_t> ia(32, 0);
    ia[3] = 0xA5;
    ia4.insert(ia4.end(), ia.begin(), ia.end());
    img = decode_timg(ia4.data(), ia4.size());
    check(px(img, 3, 0)[0] == 0x55 && px(img, 3, 0)[3] == 0xAA, "IA4 texel");

    // RGB5A3 4x4: opaque red, then translucent blue.
    auto r5 = header(5, 4, 4);
    std::vector<uint8_t> rb(32, 0);
    rb[0] = 0xFC; rb[1] = 0x00;  // 1 11111 00000 00000
    rb[2] = 0x40; rb[3] = 0x0F;  // 0 100 0000 0000 1111
    r5.insert(r5.end(), rb.begin(), rb.end());
    img = decode_timg(r5.data(), r5.size());
    check(px(img, 0, 0)[0] == 255 && px(img, 0, 0)[2] == 0 && px(img, 0, 0)[3] == 255, "RGB5A3 opaque");
    check(px(img, 1, 0)[2] == 255 && px(img, 1, 0)[3] == 0x92, "RGB5A3 translucent");

    // CMPR 8x8: first 4x4 sub-block uses color 0 (white) everywhere, the second is transparent.
    auto cm = header(14, 8, 8);
    std::vector<uint8_t> c(32, 0);
    c[0] = 0xFF; c[1] = 0xFF;             // c0 = white, c1 = black, c0 > c1
    c[8] = 0x00; c[9] = 0x00; c[10] = 0xFF; c[11] = 0xFF;  // c0 <= c1: index 3 transparent
    for (int i = 0; i < 4; ++i) c[12 + i] = 0xFF;          // all index 3
    cm.insert(cm.end(), c.begin(), c.end());
    img = decode_timg(cm.data(), cm.size());
    check(px(img, 0, 0)[0] == 255 && px(img, 0, 0)[3] == 255, "CMPR color 0");
    check(px(img, 5, 0)[3] == 0, "CMPR transparent index");

    // Tint: I4 texel 0xF with black = dark red, white = yellow -> yellow; texel 0 -> dark red alpha 0.
    Layer layer;
    layer.texture = decode_timg(i4.data(), i4.size());
    layer.black = {0x40, 0, 0, 0};
    layer.white = {255, 255, 0, 255};
    Image out = compose({layer});
    check(px(out, 1, 0)[0] == 255 && px(out, 1, 0)[1] == 255 && px(out, 1, 0)[2] == 0 && px(out, 1, 0)[3] == 255,
        "white end of the tint");
    check(px(out, 0, 0)[3] == 0, "black end of the tint is transparent");
    layer.corners[0] = {255, 0, 0, 255};
    out = compose({layer});
    check(px(out, 1, 0)[1] < 255, "corner color multiplies the tint");

    // PNG: signature, IHDR, and the fixed IEND chunk.
    const std::string png = encode_png(out);
    check(png.rfind("\x89PNG\r\n\x1a\n", 0) == 0, "PNG signature");
    check(png.substr(12, 4) == "IHDR", "IHDR first");
    check(png.size() > 12 && png.substr(png.size() - 12) == std::string("\0\0\0\0IEND\xAE\x42\x60\x82", 12), "IEND with CRC");
    if (const char* path = std::getenv("GX_PNG_OUT")) {
        if (FILE* f = std::fopen(path, "wb")) {
            std::fwrite(png.data(), 1, png.size(), f);
            std::fclose(f);
        }
    }

    std::printf("%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
