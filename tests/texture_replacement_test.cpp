// Host-side test for src/texture_replacement.cpp: Aurora-compatible keys and file names, the
// replacement folder and the .png/.dds decoders. Build and run with tests/run.sh.

#include "../src/texture_replacement.hpp"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

using namespace tracker;
using namespace tracker::texrep;

namespace {

int g_failures = 0;
void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++g_failures;
}

std::vector<uint8_t> header(uint8_t format, int w, int h) {
    std::vector<uint8_t> d(0x20, 0);
    d[0] = format;
    d[1] = 1;
    d[2] = static_cast<uint8_t>(w >> 8);
    d[3] = static_cast<uint8_t>(w);
    d[4] = static_cast<uint8_t>(h >> 8);
    d[5] = static_cast<uint8_t>(h);
    d[0x1F] = 0x20;  // image data right after the header
    return d;
}

void write(const std::filesystem::path& path, const std::string& bytes) {
    std::filesystem::create_directories(path.parent_path());
    std::ofstream(path, std::ios::binary) << bytes;
}

std::string hex(uint64_t v) {
    char buf[17];
    std::snprintf(buf, sizeof buf, "%016llx", static_cast<unsigned long long>(v));
    return buf;
}

}  // namespace

int main() {
    // XXH64 reference values (xxHash 0.8.2).
    check(xxh64("", 0) == 0xEF46DB3751D8E999ull, "xxh64 of nothing");
    std::vector<uint8_t> seq(64);
    unsigned s = 1;
    for (auto& c : seq) {
        s = s * 1103515245 + 12345;
        c = static_cast<uint8_t>(s >> 16);
    }
    check(xxh64(seq.data(), 1) == 0xD2DA77930F69647Cull, "xxh64 of 1 byte");
    check(xxh64(seq.data(), 3) == 0xF7C331CF2042B940ull, "xxh64 of 3 bytes");
    check(xxh64(seq.data(), 32) == 0xAD7DC5A569BB047Cull, "xxh64 of 32 bytes");

    // File names.
    auto k = parse_filename("tex1_48x48_0123456789abcdef_14.dds");
    check(k && k->width == 48 && k->height == 48 && k->textureHash == 0x0123456789ABCDEFull && k->format == 14 &&
              !k->hasTlut, "name without palette");
    k = parse_filename("tex1_32x16_00000000000000aa_00000000000000bb_9.png");
    check(k && k->hasTlut && k->textureHash == 0xAA && k->tlutHash == 0xBB && k->format == 9, "name with palette");
    k = parse_filename("tex1_32x16_$_$_9.PNG");
    check(k && k->textureHash == kWildcardTexture && k->tlutHash == kWildcardTlut && k->hasTlut, "wildcards");
    k = parse_filename("tex1_32x16_00000000000000aa_14_arb.png");
    check(k && k->textureHash == 0xAA && !k->hasTlut && k->format == 14, "arb part");
    k = parse_filename("tex1_32x16_m_$_14.dds");
    check(k && k->textureHash == kWildcardTexture && !k->hasTlut && k->format == 14, "m part");
    check(!parse_filename("tex1_32x16_zz_9.png"), "bad hash rejected");
    check(!parse_filename("tex1_32x16_aa_9.bmp"), "other extension rejected");
    check(!parse_filename("tex2_32x16_aa_9.png"), "other prefix rejected");

    // Keys: CMPR 8x8 hashes its 32 bytes; C8 hashes the palette entries the texels use (2..3).
    auto cmpr = header(14, 8, 8);
    for (int i = 0; i < 32; ++i) cmpr.push_back(static_cast<uint8_t>(i * 7));
    k = key_of(cmpr.data(), cmpr.size());
    check(k && !k->hasTlut && k->format == 14 && k->textureHash == xxh64(cmpr.data() + 0x20, 32), "CMPR key");
    auto c8 = header(9, 8, 4);
    for (int i = 0; i < 32; ++i) c8.push_back(static_cast<uint8_t>(2 + i % 2));
    c8[0x0B] = 4;     // 4 palette entries
    c8[0x0F] = 0x40;  // palette after the texels
    for (int i = 0; i < 8; ++i) c8.push_back(static_cast<uint8_t>(0x10 + i));
    k = key_of(c8.data(), c8.size());
    check(k && k->hasTlut && k->tlutHash == xxh64(c8.data() + 0x40 + 4, 4), "C8 key hashes the used palette range");

    // Decoders.
    gx::Image red;
    red.width = 2;
    red.height = 1;
    red.rgba = {255, 0, 0, 255, 0, 0, 255, 128};
    const std::string png = gx::encode_png(red);
    gx::Image img = decode_file(std::vector<uint8_t>(png.begin(), png.end()), true);
    check(img.width == 2 && img.rgba == red.rgba, "PNG");
    std::vector<uint8_t> dds(128, 0);
    dds[0] = 'D'; dds[1] = 'D'; dds[2] = 'S'; dds[3] = ' ';
    dds[4 + 8] = 4;   // height
    dds[4 + 12] = 4;  // width
    dds[4 + 76] = 4;  // FourCC
    dds[4 + 80] = 'D'; dds[4 + 81] = 'X'; dds[4 + 82] = 'T'; dds[4 + 83] = '1';
    const uint8_t bc1[8] = {0x00, 0xF8, 0x00, 0x00, 0, 0, 0, 0};  // color 0 = red, all texels index 0
    dds.insert(dds.end(), bc1, bc1 + 8);
    img = decode_file(dds, false);
    check(img.width == 4 && img.rgba[0] == 255 && img.rgba[1] == 0 && img.rgba[3] == 255, "DDS BC1");

    // The folder: used while the setting is on, first file of a key wins, wildcard as fallback.
    const auto dir = std::filesystem::temp_directory_path() / "texrep_test";
    std::filesystem::remove_all(dir);
    const uint64_t cmprHash = xxh64(cmpr.data() + 0x20, 32);
    write(dir / "texture_replacements" / "a" / ("tex1_8x8_" + hex(cmprHash) + "_14.png"), png);
    gx::Image other = red;
    other.rgba[0] = 7;
    write(dir / "texture_replacements" / "b" / ("tex1_8x8_" + hex(cmprHash) + "_14.png"), gx::encode_png(other));
    // Aurora: any texture with this palette (a "$_$" name never matches).
    write(dir / "texture_replacements" / ("tex1_8x4_$_" + hex(xxh64(c8.data() + 0x40 + 4, 4)) + "_9.png"), gx::encode_png(other));
    write(dir / "config.json", "{\n    \"game.enableTextureReplacements\": true\n}");
    set_config_dir(dir);
    const uint64_t on = revision();
    img = decode(cmpr.data(), cmpr.size());
    check(img.width == 2 && img.rgba[0] == 255, "replacement used (a/ before b/)");
    img = decode(c8.data(), c8.size());
    check(img.width == 2 && img.rgba[0] == 7, "wildcard replacement");
    write(dir / "config.json", "{\"game.enableTextureReplacements\": false}");
    set_config_dir(dir);
    check(revision() != on, "revision changes when the setting is switched");
    img = decode(cmpr.data(), cmpr.size());
    check(img.width == 8, "game texture while the setting is off");
    std::filesystem::remove_all(dir);

    std::printf(g_failures ? "%d failure(s)\n" : "all passed\n", g_failures);
    return g_failures ? 1 : 0;
}
