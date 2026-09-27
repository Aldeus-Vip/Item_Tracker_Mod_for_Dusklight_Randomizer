#include "gx_texture.hpp"

#include <algorithm>

namespace tracker::gx {
namespace {

uint16_t be16(const uint8_t* p) { return static_cast<uint16_t>(p[0] << 8 | p[1]); }
uint32_t be32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 |
           static_cast<uint32_t>(p[2]) << 8 | p[3];
}

Color from_rgb565(uint16_t v) {
    const int r = v >> 11 & 0x1F, g = v >> 5 & 0x3F, b = v & 0x1F;
    return {static_cast<uint8_t>(r << 3 | r >> 2), static_cast<uint8_t>(g << 2 | g >> 4),
        static_cast<uint8_t>(b << 3 | b >> 2), 255};
}

Color from_rgb5a3(uint16_t v) {
    if (v & 0x8000) {
        const int r = v >> 10 & 0x1F, g = v >> 5 & 0x1F, b = v & 0x1F;
        return {static_cast<uint8_t>(r << 3 | r >> 2), static_cast<uint8_t>(g << 3 | g >> 2),
            static_cast<uint8_t>(b << 3 | b >> 2), 255};
    }
    const int a = v >> 12 & 0x7, r = v >> 8 & 0xF, g = v >> 4 & 0xF, b = v & 0xF;
    return {static_cast<uint8_t>(r * 17), static_cast<uint8_t>(g * 17), static_cast<uint8_t>(b * 17),
        static_cast<uint8_t>(a << 5 | a << 2 | a >> 1)};
}

Color from_ia8(uint16_t v) {
    const uint8_t a = v >> 8, i = v & 0xFF;
    return {i, i, i, a};
}

enum Format : uint8_t {
    I4 = 0, I8 = 1, IA4 = 2, IA8 = 3, RGB565 = 4, RGB5A3 = 5, RGBA8 = 6,
    C4 = 8, C8 = 9, C14X2 = 10, CMPR = 14,
};

struct BlockInfo {
    int bw, bh, bytes;  // block size in pixels and bytes
};

bool block_info(uint8_t format, BlockInfo& out) {
    switch (format) {
    case I4: case C4: case CMPR: out = {8, 8, 32}; return true;
    case I8: case IA4: case C8: out = {8, 4, 32}; return true;
    case IA8: case RGB565: case RGB5A3: case C14X2: out = {4, 4, 32}; return true;
    case RGBA8: out = {4, 4, 64}; return true;
    default: return false;
    }
}

void put(Image& img, int x, int y, Color c) {
    if (x >= img.width || y >= img.height) return;  // padding of the last block row/column
    std::copy(c.begin(), c.end(), img.rgba.begin() + (static_cast<size_t>(y) * img.width + x) * 4);
}

Color lerp(Color a, Color b, int num, int den) {
    Color c{};
    for (int i = 0; i < 4; ++i) c[i] = static_cast<uint8_t>((a[i] * (den - num) + b[i] * num) / den);
    return c;
}

void decode_cmpr_sub(Image& img, const uint8_t* p, int x0, int y0) {
    const uint16_t v0 = be16(p), v1 = be16(p + 2);
    Color pal[4] = {from_rgb565(v0), from_rgb565(v1), {}, {}};
    if (v0 > v1) {
        pal[2] = lerp(pal[0], pal[1], 1, 3);
        pal[3] = lerp(pal[0], pal[1], 2, 3);
    } else {
        pal[2] = lerp(pal[0], pal[1], 1, 2);
        pal[3] = {0, 0, 0, 0};
    }
    for (int y = 0; y < 4; ++y) {
        const uint8_t row = p[4 + y];
        for (int x = 0; x < 4; ++x) put(img, x0 + x, y0 + y, pal[row >> (6 - x * 2) & 3]);
    }
}

}  // namespace

Image decode_timg(const uint8_t* data, size_t size) {
    Image img;
    if (size < 0x20) return img;
    const uint8_t format = data[0];
    const int width = be16(data + 2), height = be16(data + 4);
    const uint8_t paletteFormat = data[9];
    const int numColors = be16(data + 0xA);
    const uint32_t paletteOffset = be32(data + 0xC);
    const uint32_t imageOffset = be32(data + 0x1C);
    BlockInfo bi{};
    if (!block_info(format, bi) || width <= 0 || height <= 0 || width > 1024 || height > 1024) return img;
    const int bx = (width + bi.bw - 1) / bi.bw, by = (height + bi.bh - 1) / bi.bh;
    const size_t need = static_cast<size_t>(bx) * by * bi.bytes;
    if (imageOffset > size || size - imageOffset < need) return img;

    std::vector<Color> palette;
    if (format == C4 || format == C8 || format == C14X2) {
        if (paletteOffset > size || size - paletteOffset < static_cast<size_t>(numColors) * 2) return img;
        for (int i = 0; i < numColors; ++i) {
            const uint16_t v = be16(data + paletteOffset + i * 2);
            palette.push_back(paletteFormat == 0 ? from_ia8(v) : paletteFormat == 1 ? from_rgb565(v) : from_rgb5a3(v));
        }
    }
    const auto indexed = [&](unsigned i) { return i < palette.size() ? palette[i] : Color{0, 0, 0, 0}; };

    img.width = width;
    img.height = height;
    img.rgba.assign(static_cast<size_t>(width) * height * 4, 0);
    const uint8_t* p = data + imageOffset;
    for (int byi = 0; byi < by; ++byi) {
        for (int bxi = 0; bxi < bx; ++bxi, p += bi.bytes) {
            const int x0 = bxi * bi.bw, y0 = byi * bi.bh;
            switch (format) {
            case I4:
            case C4:
                for (int i = 0; i < 64; ++i) {
                    const int n = p[i / 2] >> (i % 2 ? 0 : 4) & 0xF;
                    const uint8_t v = static_cast<uint8_t>(n * 17);
                    put(img, x0 + i % 8, y0 + i / 8, format == I4 ? Color{v, v, v, v} : indexed(n));
                }
                break;
            case I8:
            case C8:
                for (int i = 0; i < 32; ++i) {
                    const uint8_t v = p[i];
                    put(img, x0 + i % 8, y0 + i / 8, format == I8 ? Color{v, v, v, v} : indexed(v));
                }
                break;
            case IA4:
                for (int i = 0; i < 32; ++i) {
                    const uint8_t a = static_cast<uint8_t>((p[i] >> 4) * 17), v = static_cast<uint8_t>((p[i] & 0xF) * 17);
                    put(img, x0 + i % 8, y0 + i / 8, {v, v, v, a});
                }
                break;
            case IA8:
            case RGB565:
            case RGB5A3:
            case C14X2:
                for (int i = 0; i < 16; ++i) {
                    const uint16_t v = be16(p + i * 2);
                    const Color c = format == IA8 ? from_ia8(v) : format == RGB565 ? from_rgb565(v)
                                  : format == RGB5A3 ? from_rgb5a3(v) : indexed(v & 0x3FFF);
                    put(img, x0 + i % 4, y0 + i / 4, c);
                }
                break;
            case RGBA8:
                for (int i = 0; i < 16; ++i) {
                    put(img, x0 + i % 4, y0 + i / 4, {p[i * 2 + 1], p[32 + i * 2], p[32 + i * 2 + 1], p[i * 2]});
                }
                break;
            case CMPR:
                for (int s = 0; s < 4; ++s) decode_cmpr_sub(img, p + s * 8, x0 + s % 2 * 4, y0 + s / 2 * 4);
                break;
            }
        }
    }
    return img;
}

Image compose(const std::vector<Layer>& layers) {
    Image out;
    if (layers.empty() || layers[0].texture.width == 0) return out;
    out.width = layers[0].texture.width;
    out.height = layers[0].texture.height;
    out.rgba.assign(static_cast<size_t>(out.width) * out.height * 4, 0);
    for (const Layer& layer : layers) {
        const Image& t = layer.texture;
        if (t.width == 0) continue;
        for (int y = 0; y < out.height; ++y) {
            for (int x = 0; x < out.width; ++x) {
                // Layers are drawn over the same box: scale smaller or larger textures to it.
                const int tx = x * t.width / out.width, ty = y * t.height / out.height;
                const uint8_t* s = &t.rgba[(static_cast<size_t>(ty) * t.width + tx) * 4];
                // Corner colors are interpolated over the box (rasterized vertex color).
                const float fx = out.width > 1 ? static_cast<float>(x) / (out.width - 1) : 0.f;
                const float fy = out.height > 1 ? static_cast<float>(y) / (out.height - 1) : 0.f;
                float src[4];
                for (int c = 0; c < 4; ++c) {
                    const float texel = (c < 3 ? s[c] : layer.alphaEnabled ? s[3] : 255) / 255.f;
                    const float tinted = layer.black[c] + (layer.white[c] - layer.black[c]) * texel;
                    const auto& k = layer.corners;
                    const float vertex = (k[0][c] * (1 - fx) + k[1][c] * fx) * (1 - fy) + (k[2][c] * (1 - fx) + k[3][c] * fx) * fy;
                    src[c] = tinted * vertex / 255.f;
                }
                // Source-over blend in straight alpha.
                uint8_t* d = &out.rgba[(static_cast<size_t>(y) * out.width + x) * 4];
                const float sa = src[3] / 255.f, da = d[3] / 255.f;
                const float oa = sa + da * (1 - sa);
                for (int c = 0; c < 3; ++c) {
                    const float v = oa > 0 ? (src[c] * sa + d[c] * da * (1 - sa)) / oa : 0;
                    d[c] = static_cast<uint8_t>(std::clamp(v + 0.5f, 0.f, 255.f));
                }
                d[3] = static_cast<uint8_t>(std::clamp(oa * 255.f + 0.5f, 0.f, 255.f));
            }
        }
    }
    return out;
}

namespace {

uint32_t crc32(const uint8_t* data, size_t size, uint32_t crc = 0) {
    static const auto table = [] {
        std::array<uint32_t, 256> t{};
        for (uint32_t i = 0; i < 256; ++i) {
            uint32_t c = i;
            for (int k = 0; k < 8; ++k) c = c & 1 ? 0xEDB88320u ^ c >> 1 : c >> 1;
            t[i] = c;
        }
        return t;
    }();
    crc = ~crc;
    for (size_t i = 0; i < size; ++i) crc = table[(crc ^ data[i]) & 0xFF] ^ crc >> 8;
    return ~crc;
}

void put32(std::string& out, uint32_t v) {
    for (int s = 24; s >= 0; s -= 8) out += static_cast<char>(v >> s & 0xFF);
}

void chunk(std::string& out, const char* type, const std::string& body) {
    put32(out, static_cast<uint32_t>(body.size()));
    std::string typed = std::string(type, 4) + body;
    out += typed;
    put32(out, crc32(reinterpret_cast<const uint8_t*>(typed.data()), typed.size()));
}

}  // namespace

std::string encode_png(const Image& image) {
    std::string raw;  // filter byte 0 + RGBA per row
    for (int y = 0; y < image.height; ++y) {
        raw += '\0';
        raw.append(reinterpret_cast<const char*>(&image.rgba[static_cast<size_t>(y) * image.width * 4]),
            static_cast<size_t>(image.width) * 4);
    }
    std::string z = "\x78\x01";  // zlib header, no compression
    for (size_t pos = 0; pos < raw.size() || pos == 0; pos += 65535) {
        const size_t len = std::min<size_t>(65535, raw.size() - pos);
        z += static_cast<char>(pos + len >= raw.size() ? 1 : 0);
        z += static_cast<char>(len & 0xFF);
        z += static_cast<char>(len >> 8);
        z += static_cast<char>(~len & 0xFF);
        z += static_cast<char>(~len >> 8 & 0xFF);
        z.append(raw, pos, len);
        if (raw.empty()) break;
    }
    uint32_t a = 1, b = 0;
    for (unsigned char c : raw) {
        a = (a + c) % 65521;
        b = (b + a) % 65521;
    }
    put32(z, b << 16 | a);

    std::string ihdr;
    put32(ihdr, static_cast<uint32_t>(image.width));
    put32(ihdr, static_cast<uint32_t>(image.height));
    ihdr += std::string("\x08\x06\x00\x00\x00", 5);  // 8-bit RGBA
    std::string out = "\x89PNG\r\n\x1a\n";
    chunk(out, "IHDR", ihdr);
    chunk(out, "IDAT", z);
    chunk(out, "IEND", "");
    return out;
}

}  // namespace tracker::gx
