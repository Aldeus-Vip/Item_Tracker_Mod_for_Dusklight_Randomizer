#include "texture_replacement.hpp"

#include <algorithm>
#include <chrono>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <unordered_map>

// Third-party decoders (src/third_party): public domain / MIT (stb_image), MIT / Unlicense (bcdec).
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-function"
#pragma GCC diagnostic ignored "-Wunused-parameter"
#pragma GCC diagnostic ignored "-Wsign-compare"
#endif
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#define STBI_NO_LINEAR
#define STBI_NO_HDR
#include "third_party/stb_image.h"

#define BCDEC_IMPLEMENTATION
#include "third_party/bcdec.h"
#if defined(__GNUC__) || defined(__clang__)
#pragma GCC diagnostic pop
#endif

namespace tracker::texrep {
namespace {

// ---- XXH64 (as Aurora hashes texture and palette data) ----

constexpr uint64_t P1 = 0x9E3779B185EBCA87ull, P2 = 0xC2B2AE3D27D4EB4Full, P3 = 0x165667B19E3779F9ull,
                   P4 = 0x85EBCA77C2B2AE63ull, P5 = 0x27D4EB2F165667C5ull;

uint64_t rotl(uint64_t v, int r) { return v << r | v >> (64 - r); }
uint64_t le64(const uint8_t* p) {
    uint64_t v = 0;
    for (int i = 7; i >= 0; --i) v = v << 8 | p[i];
    return v;
}
uint32_t le32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) | static_cast<uint32_t>(p[1]) << 8 | static_cast<uint32_t>(p[2]) << 16 |
           static_cast<uint32_t>(p[3]) << 24;
}
uint64_t round64(uint64_t acc, uint64_t input) { return rotl(acc + input * P2, 31) * P1; }
uint64_t merge64(uint64_t acc, uint64_t v) { return (acc ^ round64(0, v)) * P1 + P4; }

uint16_t be16(const uint8_t* p) { return static_cast<uint16_t>(p[0] << 8 | p[1]); }
uint32_t be32(const uint8_t* p) {
    return static_cast<uint32_t>(p[0]) << 24 | static_cast<uint32_t>(p[1]) << 16 | static_cast<uint32_t>(p[2]) << 8 | p[3];
}

// ---- File names ----

std::optional<uint64_t> parse_hex(std::string_view text) {
    if (text.empty()) return std::nullopt;
    uint64_t value = 0;
    for (const char ch : text) {
        value <<= 4;
        if (ch >= '0' && ch <= '9') value |= static_cast<uint64_t>(ch - '0');
        else if (ch >= 'a' && ch <= 'f') value |= static_cast<uint64_t>(ch - 'a' + 10);
        else if (ch >= 'A' && ch <= 'F') value |= static_cast<uint64_t>(ch - 'A' + 10);
        else return std::nullopt;
    }
    return value;
}

std::optional<uint32_t> parse_u32(std::string_view text) {
    if (text.empty() || text.size() > 9) return std::nullopt;
    uint32_t value = 0;
    for (const char ch : text) {
        if (ch < '0' || ch > '9') return std::nullopt;
        value = value * 10 + static_cast<uint32_t>(ch - '0');
    }
    return value;
}

char lower(char c) { return c >= 'A' && c <= 'Z' ? static_cast<char>(c + 'a' - 'A') : c; }

bool iequals(std::string_view a, std::string_view b) {
    return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin(), [](char x, char y) { return lower(x) == lower(y); });
}

bool is_sidecar_mip(std::string_view stem) {
    constexpr std::string_view tag = "_mip";
    size_t i = stem.size();
    while (i > 0 && stem[i - 1] >= '0' && stem[i - 1] <= '9') --i;
    if (i == stem.size() || i < tag.size()) return false;
    return stem.substr(i - tag.size(), tag.size()) == tag;
}

// Aurora's candidate order: path components compared case-insensitively, then exactly; the first
// file of a key wins.
bool path_before(const std::vector<std::string>& a, const std::vector<std::string>& b) {
    for (size_t i = 0; i < std::min(a.size(), b.size()); ++i) {
        const auto ci = std::lexicographical_compare(a[i].begin(), a[i].end(), b[i].begin(), b[i].end(),
            [](char x, char y) { return static_cast<unsigned char>(lower(x)) < static_cast<unsigned char>(lower(y)); });
        if (ci) return true;
        if (!iequals(a[i], b[i])) return false;
        if (a[i] != b[i]) return a[i] < b[i];
    }
    return a.size() < b.size();
}

// ---- The folder ----

struct KeyHash {
    size_t operator()(const Key& k) const {
        uint64_t h = k.textureHash ^ rotl(k.tlutHash, 17) ^ (static_cast<uint64_t>(k.width) << 40) ^
                     (static_cast<uint64_t>(k.height) << 20) ^ k.format ^ (k.hasTlut ? P5 : 0);
        return static_cast<size_t>(h ^ h >> 29);
    }
};

std::filesystem::path g_configDir;
std::unordered_map<Key, std::filesystem::path, KeyHash> g_files;
bool g_enabled = false;
bool g_scanned = false;
uint64_t g_revision = 1;
std::filesystem::file_time_type g_configTime{};
std::chrono::steady_clock::time_point g_nextCheck{};

// Dusklight's "game.enableTextureReplacements" (on unless config.json says false).
bool setting_enabled() {
    std::ifstream in(g_configDir / "config.json", std::ios::binary);
    if (!in) return true;
    const std::string text{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    constexpr std::string_view name = "\"game.enableTextureReplacements\"";
    size_t pos = text.find(name);
    if (pos == std::string::npos) return true;
    pos = text.find(':', pos + name.size());
    if (pos == std::string::npos) return true;
    pos = text.find_first_not_of(" \t\r\n", pos + 1);
    return pos == std::string::npos || text.compare(pos, 5, "false") != 0;
}

void scan() {
    g_files.clear();
    if (!g_enabled || g_configDir.empty()) return;
    const std::filesystem::path root = g_configDir / "texture_replacements";
    struct Candidate {
        std::filesystem::path path;
        std::vector<std::string> components;
    };
    std::vector<Candidate> candidates;
    std::error_code ec;
    for (std::filesystem::recursive_directory_iterator it(root,
             std::filesystem::directory_options::skip_permission_denied |
                 std::filesystem::directory_options::follow_directory_symlink,
             ec);
         !ec && it != std::filesystem::recursive_directory_iterator(); it.increment(ec)) {
        std::error_code fileEc;
        if (!it->is_regular_file(fileEc)) continue;
        const auto& path = it->path();
        try {  // path::string() throws on Windows for names it cannot convert (never "tex1_..." ones)
            const std::string ext = path.extension().string();
            if (!iequals(ext, ".dds") && !iequals(ext, ".png")) continue;
            if (is_sidecar_mip(path.stem().string())) continue;
            Candidate c{path, {}};
            for (const auto& part : path.lexically_relative(root)) c.components.push_back(part.string());
            candidates.push_back(std::move(c));
        } catch (...) {
        }
    }
    std::sort(candidates.begin(), candidates.end(),
        [](const Candidate& a, const Candidate& b) { return path_before(a.components, b.components); });
    for (const Candidate& c : candidates) {
        if (const auto key = parse_filename(c.path.filename().string())) g_files.try_emplace(*key, c.path);
    }
}

void refresh() {
    const auto now = std::chrono::steady_clock::now();
    if (g_scanned && now < g_nextCheck) return;
    g_nextCheck = now + std::chrono::seconds(1);
    std::error_code ec;
    const auto time = std::filesystem::last_write_time(g_configDir / "config.json", ec);
    if (g_scanned && !ec && time == g_configTime) return;
    if (!ec) g_configTime = time;
    const bool enabled = setting_enabled();
    if (g_scanned && enabled == g_enabled) return;
    g_enabled = enabled;
    g_scanned = true;
    scan();
    ++g_revision;
}

const std::filesystem::path* find(const Key& key) {
    if (const auto it = g_files.find(key); it != g_files.end()) return &it->second;
    if (key.hasTlut) {
        Key any = key;
        any.tlutHash = kWildcardTlut;
        if (const auto it = g_files.find(any); it != g_files.end()) return &it->second;
    }
    Key any = key;
    any.textureHash = kWildcardTexture;
    if (const auto it = g_files.find(any); it != g_files.end()) return &it->second;
    return nullptr;
}

gx::Image load(const std::filesystem::path& path) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return {};
    const std::vector<uint8_t> bytes{std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
    return decode_file(bytes, iequals(path.extension().string(), ".png"));
}

// ---- DDS ----

enum class Dds { RGBA8, BGRA8, BC1, BC3, BC5, BC7 };

gx::Image decode_dds(const std::vector<uint8_t>& bytes) {
    constexpr size_t kHeader = 4 + 124;
    if (bytes.size() < kHeader || std::memcmp(bytes.data(), "DDS ", 4) != 0) return {};
    const uint8_t* h = bytes.data() + 4;
    const uint32_t height = le32(h + 8), width = le32(h + 12);
    const uint32_t pfFlags = le32(h + 76), fourCC = le32(h + 80), bits = le32(h + 84);
    const uint32_t rMask = le32(h + 88), gMask = le32(h + 92), bMask = le32(h + 96), aMask = le32(h + 100);
    size_t offset = kHeader;
    Dds format = Dds::RGBA8;
    if (pfFlags & 0x4) {
        if (fourCC == 0x31545844) format = Dds::BC1;       // DXT1
        else if (fourCC == 0x35545844) format = Dds::BC3;  // DXT5
        else if (fourCC == 0x32495441) format = Dds::BC5;  // ATI2
        else if (fourCC == 0x30315844) {                   // DX10
            if (bytes.size() < offset + 20) return {};
            const uint32_t dxgi = le32(bytes.data() + offset);
            offset += 20;
            switch (dxgi) {
            case 28: case 29: format = Dds::RGBA8; break;
            case 87: case 91: format = Dds::BGRA8; break;
            case 71: case 72: format = Dds::BC1; break;
            case 77: case 78: format = Dds::BC3; break;
            case 83: format = Dds::BC5; break;
            case 98: case 99: format = Dds::BC7; break;
            default: return {};
            }
        } else return {};
    } else if ((pfFlags & 0x40) && bits == 32 && gMask == 0x0000FF00 && aMask == 0xFF000000 &&
               ((rMask == 0x000000FF && bMask == 0x00FF0000) || (rMask == 0x00FF0000 && bMask == 0x000000FF))) {
        format = rMask == 0x000000FF ? Dds::RGBA8 : Dds::BGRA8;
    } else {
        return {};
    }
    if (width == 0 || height == 0 || width > 8192 || height > 8192) return {};

    gx::Image img;
    img.width = static_cast<int>(width);
    img.height = static_cast<int>(height);
    img.rgba.assign(static_cast<size_t>(width) * height * 4, 0);
    const uint8_t* src = bytes.data() + offset;
    const size_t avail = bytes.size() - offset;
    if (format == Dds::RGBA8 || format == Dds::BGRA8) {
        if (avail < img.rgba.size()) return {};
        std::memcpy(img.rgba.data(), src, img.rgba.size());
        if (format == Dds::BGRA8) {
            for (size_t i = 0; i < img.rgba.size(); i += 4) std::swap(img.rgba[i], img.rgba[i + 2]);
        }
        return img;
    }
    const uint32_t bw = (width + 3) / 4, bh = (height + 3) / 4;
    const size_t blockBytes = format == Dds::BC1 ? 8 : 16;
    if (avail < static_cast<size_t>(bw) * bh * blockBytes) return {};
    uint8_t block[4 * 4 * 4];
    uint8_t rg[4 * 4 * 2];
    for (uint32_t by = 0; by < bh; ++by) {
        for (uint32_t bx = 0; bx < bw; ++bx, src += blockBytes) {
            switch (format) {
            case Dds::BC1: bcdec_bc1(src, block, 16); break;
            case Dds::BC3: bcdec_bc3(src, block, 16); break;
            case Dds::BC7: bcdec_bc7(src, block, 16); break;
            case Dds::BC5:
                bcdec_bc5(src, rg, 8);
                for (int i = 0; i < 16; ++i) {
                    block[i * 4] = rg[i * 2];
                    block[i * 4 + 1] = rg[i * 2 + 1];
                    block[i * 4 + 2] = 0;
                    block[i * 4 + 3] = 255;
                }
                break;
            default: return {};
            }
            for (uint32_t y = 0; y < 4 && by * 4 + y < height; ++y) {
                const uint32_t w = std::min<uint32_t>(4, width - bx * 4);
                std::memcpy(&img.rgba[((static_cast<size_t>(by) * 4 + y) * width + bx * 4) * 4], block + y * 16, w * 4);
            }
        }
    }
    return img;
}

}  // namespace

uint64_t xxh64(const void* data, size_t size, uint64_t seed) {
    const auto* p = static_cast<const uint8_t*>(data);
    const uint8_t* const end = p + size;
    uint64_t h;
    if (size >= 32) {
        uint64_t v1 = seed + P1 + P2, v2 = seed + P2, v3 = seed, v4 = seed - P1;
        for (; p + 32 <= end; p += 32) {
            v1 = round64(v1, le64(p));
            v2 = round64(v2, le64(p + 8));
            v3 = round64(v3, le64(p + 16));
            v4 = round64(v4, le64(p + 24));
        }
        h = rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18);
        h = merge64(h, v1);
        h = merge64(h, v2);
        h = merge64(h, v3);
        h = merge64(h, v4);
    } else {
        h = seed + P5;
    }
    h += size;
    for (; p + 8 <= end; p += 8) h = rotl(h ^ round64(0, le64(p)), 27) * P1 + P4;
    if (p + 4 <= end) {
        h = rotl(h ^ static_cast<uint64_t>(le32(p)) * P1, 23) * P2 + P3;
        p += 4;
    }
    for (; p < end; ++p) h = rotl(h ^ *p * P5, 11) * P1;
    h ^= h >> 33;
    h *= P2;
    h ^= h >> 29;
    h *= P3;
    h ^= h >> 32;
    return h;
}

// tex1_{w}x{h}[_m]_{texture hash|$}[_{tlut hash|$}]_{format}[_arb].dds|.png
std::optional<Key> parse_filename(std::string_view filename) {
    const size_t dot = filename.rfind('.');
    if (dot == std::string_view::npos) return std::nullopt;
    if (!iequals(filename.substr(dot), ".dds") && !iequals(filename.substr(dot), ".png")) return std::nullopt;
    const std::string_view stem = filename.substr(0, dot);
    if (!stem.starts_with("tex1_")) return std::nullopt;

    std::string_view parts[6];
    size_t count = 0, offset = 0;
    bool consumedAll = false;
    while (offset <= stem.size() && count < 6) {
        const size_t next = stem.find('_', offset);
        parts[count++] = stem.substr(offset, next == std::string_view::npos ? stem.size() - offset : next - offset);
        if (next == std::string_view::npos) {
            consumedAll = true;
            break;
        }
        offset = next + 1;
    }
    if (!consumedAll || count < 4 || count > 6 || parts[0] != "tex1") return std::nullopt;

    const size_t x = parts[1].find('x');
    if (x == std::string_view::npos) return std::nullopt;
    const auto width = parse_u32(parts[1].substr(0, x)), height = parse_u32(parts[1].substr(x + 1));
    if (!width || !height) return std::nullopt;

    size_t index = 2;
    if (parts[index] == "m") ++index;
    size_t remaining = count - index;
    if (remaining != 2 && remaining != 3) return std::nullopt;

    Key key;
    key.width = *width;
    key.height = *height;
    if (parts[index] == "$") {
        key.textureHash = kWildcardTexture;
    } else {
        const auto hash = parse_hex(parts[index]);
        if (!hash) return std::nullopt;
        key.textureHash = *hash;
    }
    std::string_view formatPart = parts[count - 1];
    if (formatPart == "arb") {
        formatPart = parts[count - 2];
        remaining -= 1;
    }
    const auto format = parse_u32(formatPart);
    if (!format) return std::nullopt;
    key.format = *format;
    key.hasTlut = remaining == 3;
    if (key.hasTlut) {
        if (parts[index + 1] == "$") {
            key.tlutHash = kWildcardTlut;
        } else {
            const auto hash = parse_hex(parts[index + 1]);
            if (!hash) return std::nullopt;
            key.tlutHash = *hash;
        }
    }
    return key;
}

std::optional<Key> key_of(const uint8_t* timg, size_t size) {
    if (size < 0x20) return std::nullopt;
    const uint8_t format = timg[0];
    const int width = be16(timg + 2), height = be16(timg + 4);
    const uint32_t imageOffset = be32(timg + 0x1C) ? be32(timg + 0x1C) : 0x20;  // as JUTTexture reads it
    const size_t imageSize = gx::timg_image_size(format, width, height);
    if (imageSize == 0 || imageOffset > size || size - imageOffset < imageSize) return std::nullopt;
    const uint8_t* texels = timg + imageOffset;

    Key key;
    key.width = static_cast<uint32_t>(width);
    key.height = static_cast<uint32_t>(height);
    key.format = format;
    key.textureHash = xxh64(texels, imageSize);
    key.hasTlut = format == 8 || format == 9 || format == 10;  // C4, C8, C14X2
    if (key.hasTlut) {
        // Only the palette entries the texels use, as Aurora hashes the loaded TLUT.
        uint32_t lo = 0xFFFF, hi = 0;
        const auto use = [&](uint32_t i) {
            lo = std::min(lo, i);
            hi = std::max(hi, i);
        };
        if (format == 8) {
            for (size_t i = 0; i < imageSize; ++i) {
                use(texels[i] & 0xF);
                use(texels[i] >> 4);
            }
        } else if (format == 9) {
            for (size_t i = 0; i < imageSize; ++i) use(texels[i]);
        } else {
            for (size_t i = 0; i + 2 <= imageSize; i += 2) use(be16(texels + i) & 0x3FFF);
        }
        const size_t numColors = be16(timg + 0xA);
        const uint32_t paletteOffset = be32(timg + 0xC);
        const size_t tlutBytes = numColors * 2, start = static_cast<size_t>(lo) * 2;
        const size_t length = 2 * (static_cast<size_t>(hi) + 1 - lo);
        if (numColors > 0 && paletteOffset <= size && size - paletteOffset >= tlutBytes && start + length <= tlutBytes) {
            key.tlutHash = xxh64(timg + paletteOffset + start, length);
        }
    }
    return key;
}

gx::Image decode_file(const std::vector<uint8_t>& bytes, bool png) {
    if (!png) return decode_dds(bytes);
    int w = 0, h = 0, channels = 0;
    stbi_uc* pixels = stbi_load_from_memory(bytes.data(), static_cast<int>(bytes.size()), &w, &h, &channels, 4);
    if (pixels == nullptr) return {};
    gx::Image img;
    if (w > 0 && h > 0 && w <= 8192 && h <= 8192) {
        img.width = w;
        img.height = h;
        img.rgba.assign(pixels, pixels + static_cast<size_t>(w) * h * 4);
    }
    stbi_image_free(pixels);
    return img;
}

void set_config_dir(std::filesystem::path dir) {
    g_configDir = std::move(dir);
    g_scanned = false;
}

uint64_t revision() {
    refresh();
    return g_revision;
}

gx::Image decode(const uint8_t* timg, size_t size) {
    refresh();
    if (!g_files.empty()) {
        if (const auto key = key_of(timg, size)) {
            if (const auto* path = find(*key)) {
                gx::Image img = load(*path);
                if (img.width) return img;
            }
        }
    }
    return gx::decode_timg(timg, size);
}

}  // namespace tracker::texrep
