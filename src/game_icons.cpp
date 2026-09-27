#include "game_icons.hpp"

#include "gx_texture.hpp"

#include "JSystem/J2DGraph/J2DPicture.h"
#include "JSystem/JKernel/JKRArchive.h"
#include "d/d_com_inf_game.h"
#include "d/d_item_data.h"
#include "d/d_meter2_info.h"

#include <map>
#include <vector>

namespace tracker::icons {
namespace {

// Item types whose menu icon is drawn from the 2nd and 3rd textures (dMeter2Info_c::readItemTexture
// with two buffers): the contents and the bottle. Values of dMeter2_ItemType, which is local to
// d_meter2_info.cpp: POU_FIRE, FAIRY, BEE_CHILD, WORM.
bool in_bottle_type(u8 type) {
    return type >= 27 && type <= 30;
}

gx::Color color(const JUtility::TColor& c) { return {c.r, c.g, c.b, c.a}; }

// Reads one texture of the item icon archive and takes the colors the menu gives its picture.
bool load_layer(JKRArchive* arc, s16 index, const J2DPicture& pic, gx::Layer& out) {
    if (index < 0) return false;
    alignas(32) static u8 buffer[0x4000];
    const u32 size = arc->readIdxResource(buffer, sizeof(buffer), static_cast<u32>(index));
    if (size < 0x20 || size > sizeof(buffer)) return false;
    out.texture = gx::decode_timg(buffer, size);
    if (out.texture.width == 0) return false;
    out.alphaEnabled = buffer[1] != 0;
    out.black = color(pic.getBlack());
    out.white = color(pic.getWhite());
    for (int i = 0; i < 4; ++i) out.corners[i] = color(pic.corner(i));
    return true;
}

std::string build(u8 itemNo) {
    JKRArchive* arc = dComIfGp_getItemIconArchive();
    if (arc == nullptr) return {};
    dMeter2Info_c& info = g_meter2_info;
    const u8 type = info.getItemType(itemNo);

    // Same texture and color choice as dMeter2Info_c::readItemTexture, without its special cases
    // that depend on the current game state (unlit lantern, inactive Dominion Rod).
    struct Part {
        s16 texture;
        void (dMeter2Info_c::*setColor)(u8, J2DPicture*);
    };
    std::vector<Part> parts;
    if (in_bottle_type(type)) {
        parts = {{info.get2ndTexture(type), &dMeter2Info_c::set2ndColor},
            {info.get3rdTexture(type), &dMeter2Info_c::set3rdColor}};
    } else {
        parts.push_back({dItem_data::getTexture(itemNo), &dMeter2Info_c::set1stColor});
        const s16 second = info.get2ndTexture(type);
        if (second > 0) {
            parts.push_back({second, &dMeter2Info_c::set2ndColor});
            const s16 third = info.get3rdTexture(type);
            if (third > 0) {
                parts.push_back({third, &dMeter2Info_c::set3rdColor});
                const s16 fourth = info.get4thTexture(type);
                if (fourth > 0) parts.push_back({fourth, &dMeter2Info_c::set4thColor});
            }
        }
    }

    std::vector<gx::Layer> layers;
    for (const Part& part : parts) {
        J2DPicture pic;  // only receives the colors; never drawn
        (info.*part.setColor)(type, &pic);
        gx::Layer layer;
        if (!load_layer(arc, part.texture, pic, layer)) return {};
        layers.push_back(std::move(layer));
    }
    const gx::Image image = gx::compose(layers);
    return image.width ? gx::encode_png(image) : std::string{};
}

std::map<u8, std::string> g_cache;

}  // namespace

std::string item_icon_png(uint8_t itemNo) {
    if (itemNo == dItemNo_NONE_e) return {};
    if (const auto it = g_cache.find(itemNo); it != g_cache.end()) return it->second;
    std::string png = build(itemNo);
    // Only cache once the archive exists, so an early request is retried later.
    if (dComIfGp_getItemIconArchive() != nullptr) g_cache.emplace(itemNo, png);
    return png;
}

}  // namespace tracker::icons
