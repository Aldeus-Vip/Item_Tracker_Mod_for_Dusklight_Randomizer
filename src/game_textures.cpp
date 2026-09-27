#include "game_textures.hpp"

#include "gx_texture.hpp"
#include "json_writer.hpp"

#include "JSystem/JKernel/JKRArchive.h"
#include "d/d_com_inf_game.h"

#include <cstring>
#include <map>
#include <vector>

namespace tracker::textures {
namespace {

struct ArchiveInfo {
    const char* key;
    JKRArchive* (*get)();
};

// 2D archives the game keeps mounted from the start (d_s_logo.cpp): item icons and dungeon map.
const ArchiveInfo kArchives[] = {
    {"itemicon", [] { return dComIfGp_getItemIconArchive(); }},
    {"dmap", [] { return dComIfGp_getDmapResArchive(); }},
};

JKRArchive* find_archive(const std::string& key) {
    for (const ArchiveInfo& a : kArchives) {
        if (key == a.key) return a.get();
    }
    return nullptr;
}

bool ends_with_bti(const char* name) {
    const size_t n = std::strlen(name);
    return n > 4 && std::strcmp(name + n - 4, ".bti") == 0;
}

const char* entry_name(const JKRArchive* arc, const JKRArchive::SDIFileEntry& e) {
    return arc->mStringTable + (static_cast<u32>(e.type_flags_and_name_offset) & 0x00FFFFFF);
}

bool is_file(const JKRArchive::SDIFileEntry& e) {
    return (static_cast<u32>(e.type_flags_and_name_offset) >> 24 & 0x01) != 0;
}

std::map<std::string, std::string> g_cache;  // "<archive>/<name>" -> PNG ("" = failed)

}  // namespace

std::string list_json(const std::string& archive) {
    JKRArchive* arc = find_archive(archive);
    if (arc == nullptr) return {};
    JsonWriter w;
    w.beginArray();
    for (u32 i = 0; i < arc->countFile(); ++i) {
        const JKRArchive::SDIFileEntry& e = arc->mFiles[i];
        if (!is_file(e)) continue;
        const char* name = entry_name(arc, e);
        if (ends_with_bti(name)) w.value(std::string{name});
    }
    w.endArray();
    return w.str();
}

std::string texture_png(const std::string& archive, const std::string& name) {
    JKRArchive* arc = find_archive(archive);
    if (arc == nullptr || name.empty() || name.size() > 64) return {};
    const std::string key = archive + "/" + name;
    if (const auto it = g_cache.find(key); it != g_cache.end()) return it->second;

    static std::vector<u8> buffer(4 * 1024 * 1024);
    u32 size = 0;
    if (name[0] == '#') {
        const std::string digits = name.substr(1);
        if (digits.empty() || digits.size() > 5 || digits.find_first_not_of("0123456789") != std::string::npos) return {};
        size = arc->readIdxResource(buffer.data(), static_cast<u32>(buffer.size()), static_cast<u32>(std::stoul(digits)));
    } else {
        // readResource(name) resolves the name in the current directory only, and textures live in
        // subdirectories (timg/); look the file up anywhere and read it by its index instead.
        const JKRArchive::SDIFileEntry* entry = ends_with_bti(name.c_str()) ? arc->findNameResource(name.c_str()) : nullptr;
        if (entry == nullptr) return {};
        size = arc->readIdxResource(buffer.data(), static_cast<u32>(buffer.size()), static_cast<u32>(entry - arc->mFiles));
    }
    std::string png;
    if (size >= 0x20 && size <= buffer.size()) {
        gx::Layer layer;  // neutral colors: the texture as stored
        layer.texture = gx::decode_timg(buffer.data(), size);
        layer.alphaEnabled = buffer[1] != 0;
        const gx::Image image = gx::compose({layer});
        if (image.width) png = gx::encode_png(image);
    }
    g_cache.emplace(key, png);
    return png;
}

}  // namespace tracker::textures
