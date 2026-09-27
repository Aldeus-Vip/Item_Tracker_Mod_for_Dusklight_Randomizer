#include "tracker_state.hpp"

#include "json_writer.hpp"

#include "d/d_com_inf_game.h"
#include "d/d_item.h"
#include "d/d_item_data.h"
#include "d/d_menu_ring.h"
#include "d/d_save.h"
#include "d/d_stage.h"

#include <cstring>

// Save-data layout references (stage save ids, key door switch flags, event bits) follow the
// official Dusklight Randomizer's tracker helpers (TwilitRealm/dusklight-randomizer, src/tools.cpp).
// Item names match the randomizer's logic item names so the logic layer can consume them directly.

namespace tracker {
namespace {

// Dungeon progress, keyed by the save table ("stage save id") each dungeon writes to.
struct DungeonInfo {
    const char* name;
    int saveId;
    int maxSmallKeys;
    bool hasBigKey;
    // Switch flags set when a small-key door in this dungeon is unlocked.
    int keyDoorFlags[8];
    int keyDoorFlagCount;
};

constexpr DungeonInfo kDungeons[] = {
    {"Forest Temple", 0x10, 4, true, {0x07, 0x0B, 0x2B, 0x3E}, 4},
    {"Goron Mines", 0x11, 3, false, {0x33, 0x3D, 0x3F}, 3},
    {"Lakebed Temple", 0x12, 3, true, {0x23, 0x24, 0x34}, 3},
    {"Arbiters Grounds", 0x13, 5, true, {0x27, 0x46, 0x4D, 0x5A, 0x5B}, 5},
    {"Snowpeak Ruins", 0x14, 4, true, {0x2B, 0x2C, 0x2F, 0x30}, 4},
    {"Temple of Time", 0x15, 3, true, {0x1B, 0x1C, 0x1D}, 3},
    {"City in the Sky", 0x16, 1, true, {0x06}, 1},
    {"Palace of Twilight", 0x17, 7, true, {0x06, 0x07, 0x08, 0x23, 0x24, 0x25, 0x33}, 7},
    {"Hyrule Castle", 0x18, 3, true, {0x4C, 0x6F, 0x7C}, 3},
};

// Item wheel slots holding bottles and bomb bags (see dSv_player_item_c).
constexpr u8 kFirstBottleSlot = SLOT_11;
constexpr u8 kBottleCount = 4;
constexpr u8 kFirstBombBagSlot = SLOT_15;
constexpr u8 kBombBagCount = 3;

// Faron gates: stage switches the randomizer sets when the matching key is obtained.
constexpr int kFaronSaveId = 0x02;
constexpr int kNorthFaronGateFlag = 0x14;
constexpr int kCoroGateFlag = 0x0C;

constexpr int kSkyCharacterCount = 6;

// Randomizer custom item ids (TwilitRealm/dusklight-randomizer src/item_ids.h) and the matching
// logic item names (generator/data/items.yaml).
struct RandomizerItem {
    u8 id;
    const char* name;
};
constexpr RandomizerItem kRandomizerPortals[] = {
    {0x14, "Ordon Spring Portal"},
    {0x15, "South Faron Portal"},
    {0x3C, "North Faron Portal"},
    {0xBF, "Sacred Grove Portal"},
    {0x4D, "Kakariko Gorge Portal"},
    {0x4E, "Kakariko Village Portal"},
    {0x52, "Death Mountain Portal"},
    {0xE8, "Bridge of Eldin Portal"},
    {0x3A, "Castle Town Portal"},
    {0x39, "Upper Zoras River Portal"},
    {0x57, "Zoras Domain Portal"},
    {0x8F, "Lake Hylia Portal"},
    {0xAF, "Snowpeak Portal"},
    {0x3B, "Gerudo Desert Portal"},
    {0xAE, "Mirror Chamber Portal"},
};
constexpr u8 kFirstHiddenSkill = 0xE1;  // Ending Blow .. Great Spin
constexpr u8 kLastHiddenSkill = 0xE7;

constexpr int kBulblinCampSaveId = 0x0A;
constexpr int kBulblinCampKeyDoorFlag = 0x00;

// Event bits (see d_save / randomizer tools.cpp).
constexpr u16 kEventShadowCrystal = 0x0D04;
constexpr u16 kEventDominionRodPowered = 0x2580;
constexpr u16 kEventShowedAurusMemo = 0x2680;
constexpr u16 kEventShowedAsheisSketch = 0x3B80;

bool have(u8 item) {
    return checkItemGet(item, 1) != 0;
}

bool is_current_save_table(int saveId) {
    stage_stag_info_class* stagInfo = dComIfGp_getStageStagInfo();
    return stagInfo != nullptr && saveId == dStage_stagInfo_GetSaveTbl(stagInfo);
}

// Small keys currently held. The active stage keeps its copy in "memory", not the save table.
int held_key_count(int saveId) {
    if (is_current_save_table(saveId)) {
        return dComIfGs_getKeyNum();
    }
    return dComIfGs_getSaveData()->getSave(saveId).getBit().getKeyNum();
}

// Keys obtained in total = keys held + key doors already unlocked.
int keys_found(int saveId, const int* doorFlags, int doorFlagCount) {
    int count = held_key_count(saveId);
    for (int i = 0; i < doorFlagCount; ++i) {
        if (dComIfGs_isStageSwitch(saveId, doorFlags[i])) {
            ++count;
        }
    }
    return count;
}

bool boss_defeated(int saveId) {
    // dComIfGs_isStageBossEnemy(int) does not null-check the stage info, so branch here.
    if (is_current_save_table(saveId)) {
        return dComIfGs_isStageBossEnemy() != 0;
    }
    return dComIfGs_getSaveData()->getSave(saveId).getBit().isStageBossEnemy() != 0;
}

bool is_in_game() {
    if (dComIfGp_getStageStagInfo() == nullptr) {
        return false;
    }
    const char* stage = dComIfGp_getStartStageName();
    if (stage == nullptr) {
        return false;
    }
    // Title screen: movie stage, or the title layer of F_SP102.
    if (std::strcmp(stage, "S_MV000") == 0) {
        return false;
    }
    if (std::strcmp(stage, "F_SP102") == 0 && dComIfG_play_c::getLayerNo(0) == 10) {
        return false;
    }
    return true;
}

struct ItemCounts {
    int fishingRod = 0;
    int bow = 0;
    int clawshot = 0;
    int dominionRod = 0;
    int slingshot = 0;
    int lantern = 0;
    int boomerang = 0;
    int ironBoots = 0;
    int hawkeye = 0;
    int bombBags = 0;
    int spinner = 0;
    int ballAndChain = 0;
    int bottles = 0;
    int skyBookSlot = -1;
    bool aurusMemo = false;
    bool asheisSketch = false;
};

// Scans the item wheel slots. Mirrors the randomizer's getSaveItemPool().
ItemCounts scan_item_slots() {
    ItemCounts c{};
    for (int i = 0; i < MAX_ITEM_SLOTS; ++i) {
        switch (dComIfGs_getItem(i, false)) {
        case dItemNo_HAWK_EYE_e: c.hawkeye = 1; break;
        case dItemNo_BOOMERANG_e: c.boomerang = 1; break;
        case dItemNo_SPINNER_e: c.spinner = 1; break;
        case dItemNo_IRONBALL_e: c.ballAndChain = 1; break;
        case dItemNo_BOW_e: c.bow = 1; break;
        case dItemNo_HOOKSHOT_e: c.clawshot = c.clawshot > 1 ? c.clawshot : 1; break;
        case dItemNo_W_HOOKSHOT_e: c.clawshot = 2; break;
        case dItemNo_HVY_BOOTS_e: c.ironBoots = 1; break;
        case dItemNo_COPY_ROD_e: c.dominionRod = dComIfGs_isEventBit(kEventDominionRodPowered) ? 2 : 1; break;
        case dItemNo_KANTERA_e: c.lantern = 1; break;
        case dItemNo_JEWEL_ROD_e:
        case dItemNo_JEWEL_BEE_ROD_e:
        case dItemNo_JEWEL_WORM_ROD_e: c.fishingRod = 2; break;
        case dItemNo_FISHING_ROD_1_e:
        case dItemNo_BEE_ROD_e:
        case dItemNo_WORM_ROD_e: c.fishingRod = c.fishingRod > 1 ? c.fishingRod : 1; break;
        case dItemNo_PACHINKO_e: c.slingshot = 1; break;
        case dItemNo_BOMB_BAG_LV1_e:
        case dItemNo_NORMAL_BOMB_e:
        case dItemNo_WATER_BOMB_e:
        case dItemNo_POKE_BOMB_e: ++c.bombBags; break;
        case dItemNo_RAFRELS_MEMO_e: c.aurusMemo = true; break;
        case dItemNo_ASHS_SCRIBBLING_e: c.asheisSketch = true; break;
        case dItemNo_ANCIENT_DOCUMENT_e:
        case dItemNo_AIR_LETTER_e:
        case dItemNo_ANCIENT_DOCUMENT2_e: c.skyBookSlot = i; break;
        default:
            break;
        }
        // A bottle counts regardless of its contents.
        const u8 item = dComIfGs_getItem(i, false);
        if (item != dItemNo_NONE_e && isBottleItem(item)) {
            ++c.bottles;
        }
    }
    return c;
}

// Sky characters collected so far. The randomizer keeps this count in its own save data and
// reports it through a post-hook on dMenu_Ring_c::getItemNum (the item wheel's counter). Calling
// the hooked function returns the same number the item wheel shows. getItemNum only reads save
// data, so a placeholder object stands in for the menu instance.
int sky_book_characters(int slot) {
    alignas(dMenu_Ring_c) static unsigned char placeholder[sizeof(dMenu_Ring_c)] = {};
    auto* ring = reinterpret_cast<dMenu_Ring_c*>(placeholder);
    int characters = ring->getItemNum(static_cast<u8>(slot));
    // Without the randomizer the counter stays 0; a filled book still means all 6 characters.
    if (characters == 0 && dComIfGs_getItem(slot, false) == dItemNo_ANCIENT_DOCUMENT2_e) {
        characters = kSkyCharacterCount;
    }
    return characters < kSkyCharacterCount ? characters : kSkyCharacterCount;
}

int count_swords() {
    int n = 0;
    for (u8 sword : {dItemNo_WOOD_STICK_e, dItemNo_SWORD_e, dItemNo_MASTER_SWORD_e, dItemNo_LIGHT_SWORD_e}) {
        n += have(sword) ? 1 : 0;
    }
    return n;
}

int count_fused_shadows() {
    int n = 0;
    for (int i = 0; i < 3; ++i) {
        n += dComIfGs_isCollectCrystal(i) ? 1 : 0;
    }
    return n;
}

int count_mirror_shards() {
    int n = 0;
    for (int i = 0; i < 4; ++i) {
        n += dComIfGs_isCollectMirror(i) ? 1 : 0;
    }
    return n;
}

int count_key_shards() {
    if (have(dItemNo_L2_KEY_PIECES3_e)) return 3;
    if (have(dItemNo_L2_KEY_PIECES2_e)) return 2;
    if (have(dItemNo_L2_KEY_PIECES1_e)) return 1;
    return 0;
}

void write_items(JsonWriter& w) {
    const ItemCounts slots = scan_item_slots();

    w.key("items").beginObject();
    // Progressive equipment
    w.member("Progressive Sword", count_swords());
    w.member("Ordon Shield", have(dItemNo_WOOD_SHIELD_e) ? 1 : 0);
    w.member("Wooden Shield", have(dItemNo_SHIELD_e) ? 1 : 0);
    w.member("Hylian Shield", have(dItemNo_HYLIA_SHIELD_e) ? 1 : 0);
    w.member("Zora Armor", have(dItemNo_WEAR_ZORA_e) ? 1 : 0);
    w.member("Magic Armor", have(dItemNo_ARMOR_e) ? 1 : 0);
    w.member("Progressive Wallet", static_cast<int>(dComIfGs_getWalletSize()));
    w.member("Progressive Fishing Rod", slots.fishingRod);
    // Progressive Bow = bow + quiver upgrades (arrow capacity 30 / 60 / 100).
    const int arrowMax = dComIfGs_getArrowMax();
    w.member("Progressive Bow", slots.bow ? 1 + (arrowMax >= 60 ? 1 : 0) + (arrowMax >= 100 ? 1 : 0) : 0);
    w.member("Giant Bomb Bag", have(dItemNo_BOMB_BAG_LV2_e) ? 1 : 0);
    w.member("Progressive Clawshot", slots.clawshot);
    w.member("Progressive Dominion Rod", slots.dominionRod);
    // Progressive Sky Book = the book itself + one per sky character (randomizer logic item).
    const int skyCharacters = slots.skyBookSlot >= 0 ? sky_book_characters(slots.skyBookSlot) : 0;
    w.member("Progressive Sky Book", slots.skyBookSlot >= 0 ? 1 + skyCharacters : 0);
    w.member("Sky Book Characters", skyCharacters);
    // Item wheel
    w.member("Slingshot", slots.slingshot);
    w.member("Lantern", slots.lantern);
    w.member("Gale Boomerang", slots.boomerang);
    w.member("Iron Boots", slots.ironBoots);
    w.member("Hawkeye", slots.hawkeye);
    w.member("Bomb Bag", slots.bombBags);
    w.member("Spinner", slots.spinner);
    w.member("Ball and Chain", slots.ballAndChain);
    w.member("Empty Bottle", slots.bottles);
    // Quest items (count "shown" events too: the item leaves the wheel after use)
    w.member("Aurus Memo", (slots.aurusMemo || dComIfGs_isEventBit(kEventShowedAurusMemo)) ? 1 : 0);
    w.member("Asheis Sketch", (slots.asheisSketch || dComIfGs_isEventBit(kEventShowedAsheisSketch)) ? 1 : 0);
    w.member("Renados Letter", have(dItemNo_LETTER_e) ? 1 : 0);
    w.member("Invoice", have(dItemNo_BILL_e) ? 1 : 0);
    w.member("Wooden Statue", have(dItemNo_WOOD_STATUE_e) ? 1 : 0);
    w.member("Ilias Charm", have(dItemNo_IRIAS_PENDANT_e) ? 1 : 0);
    w.member("Horse Call", have(dItemNo_HORSE_FLUTE_e) ? 1 : 0);
    // Field keys. The randomizer unlocks the Faron gates when their key is obtained.
    w.member("North Faron Woods Gate Key", dComIfGs_isStageSwitch(kFaronSaveId, kNorthFaronGateFlag) ? 1 : 0);
    w.member("Faron Woods Coro Key", dComIfGs_isStageSwitch(kFaronSaveId, kCoroGateFlag) ? 1 : 0);
    w.member("Gate Keys", have(dItemNo_BOSSRIDER_KEY_e) ? 1 : 0);
    w.member("Goron Mines Key Shard", count_key_shards());
    w.member("Ordon Pumpkin", have(dItemNo_TOMATO_PUREE_e) ? 1 : 0);
    w.member("Ordon Cheese", have(dItemNo_TASTE_e) ? 1 : 0);
    w.member("Gerudo Desert Bulblin Camp Key",
        keys_found(kBulblinCampSaveId, &kBulblinCampKeyDoorFlag, 1));
    // Story progress
    w.member("Shadow Crystal", dComIfGs_isEventBit(kEventShadowCrystal) ? 1 : 0);
    w.member("Progressive Fused Shadow", count_fused_shadows());
    w.member("Progressive Mirror Shard", count_mirror_shards());
    w.member("Faron Twilight Tear", static_cast<int>(dComIfGs_getLightDropNum(0)));
    w.member("Eldin Twilight Tear", static_cast<int>(dComIfGs_getLightDropNum(1)));
    w.member("Lanayru Twilight Tear", static_cast<int>(dComIfGs_getLightDropNum(2)));
    // Collectibles
    w.member("Poe Soul", static_cast<int>(dComIfGs_getPohSpiritNum()));
    int bugs = 0;
    for (int i = dItemNo_M_BEETLE_e; i <= dItemNo_F_MAYFLY_e; ++i) {
        bugs += have(static_cast<u8>(i)) ? 1 : 0;
    }
    w.member("Golden Bug", bugs);
    // Randomizer-only items (custom item ids): warp portals and hidden skills.
    for (const auto& [id, name] : kRandomizerPortals) {
        w.member(name, have(id) ? 1 : 0);
    }
    int skills = 0;
    for (u8 id = kFirstHiddenSkill; id <= kLastHiddenSkill; ++id) {
        skills += have(id) ? 1 : 0;
    }
    w.member("Progressive Hidden Skill", skills);
    w.endObject();

    // Max life in heart-piece units (5 = one heart); the logic's hearts(n) uses it.
    w.member("maxLife", static_cast<int>(dComIfGs_getMaxLife()));
}

// Consumable state shown on top of item icons: ammo, lantern oil, rupees, and the contents of
// every bomb bag and bottle slot.
void write_inventory(JsonWriter& w) {
    w.key("ammo").beginObject();
    w.member("seeds", static_cast<int>(dComIfGs_getPachinkoNum()));
    w.member("seedsMax", static_cast<int>(dComIfGs_getPachinkoMax()));
    w.member("arrows", static_cast<int>(dComIfGs_getArrowNum()));
    w.member("arrowsMax", static_cast<int>(dComIfGs_getArrowMax()));
    w.member("oil", static_cast<int>(dComIfGs_getOil()));
    w.member("oilMax", static_cast<int>(dComIfGs_getMaxOil()));
    w.member("rupees", static_cast<int>(dComIfGs_getRupee()));
    w.member("rupeesMax", static_cast<int>(dComIfGs_getRupeeMax()));
    w.endObject();

    // Bag slots hold BOMB_BAG_LV1 when empty, or the bomb type they carry. Missing bags are omitted.
    w.key("bombBags").beginArray();
    for (u8 i = 0; i < kBombBagCount; ++i) {
        const u8 item = dComIfGs_getItem(kFirstBombBagSlot + i, false);
        if (item == dItemNo_NONE_e) {
            continue;
        }
        const bool hasBombs = item != dItemNo_BOMB_BAG_LV1_e;
        w.beginObject();
        w.member("item", static_cast<int>(item));
        w.member("count", hasBombs ? static_cast<int>(dComIfGs_getBombNum(i)) : 0);
        w.member("max", hasBombs ? static_cast<int>(dComIfGs_getBombMax(item)) : 0);
        w.endObject();
    }
    w.endArray();

    // Bottle slots hold the bottle's contents (EMPTY_BOTTLE when empty). Missing bottles are omitted.
    w.key("bottles").beginArray();
    for (u8 i = 0; i < kBottleCount; ++i) {
        const u8 item = dComIfGs_getItem(kFirstBottleSlot + i, false);
        if (item == dItemNo_NONE_e || !isBottleItem(item)) {
            continue;
        }
        w.beginObject();
        w.member("item", static_cast<int>(item));
        w.member("count", static_cast<int>(dComIfGs_getBottleNum(i)));
        w.endObject();
    }
    w.endArray();
}

void write_dungeons(JsonWriter& w) {
    w.key("dungeons").beginArray();
    for (const DungeonInfo& d : kDungeons) {
        w.beginObject();
        w.member("name", d.name);
        w.member("smallKeys", keys_found(d.saveId, d.keyDoorFlags, d.keyDoorFlagCount));
        w.member("smallKeysHeld", held_key_count(d.saveId));
        w.member("maxSmallKeys", d.maxSmallKeys);
        w.member("hasBigKey", d.hasBigKey);
        w.member("bigKey", dComIfGs_isDungeonItemBossKey(d.saveId) != 0);
        w.member("map", dComIfGs_isDungeonItemMap(d.saveId) != 0);
        w.member("compass", dComIfGs_isDungeonItemCompass(d.saveId) != 0);
        w.member("bossDefeated", boss_defeated(d.saveId));
        w.endObject();
    }
    w.endArray();
}

// ---- Raw save flags for the location tracker ----
// The page decides which check each flag belongs to (from the randomizer's locations.yaml), so the
// mod only reports bits. Accessors are used instead of raw memory so the current stage's live copy
// ("memory") is read where the game keeps it.

constexpr int kStageSaveCount = 32;  // dSv_save_c stage tables

// Appends bits [0, count) as lowercase hex, 4 bits per digit, least significant flag first
// within each byte pair: byte i = flags 8i..8i+7, bit b = flag 8i+b.
template <typename Fn>
void append_bits_hex(std::string& out, int count, Fn&& isSet) {
    static constexpr char kHex[] = "0123456789abcdef";
    for (int byte = 0; byte < count / 8; ++byte) {
        unsigned value = 0;
        for (int bit = 0; bit < 8; ++bit) {
            if (isSet(byte * 8 + bit)) value |= 1u << bit;
        }
        out += kHex[value >> 4];
        out += kHex[value & 0xF];
    }
}

void write_flags(JsonWriter& w) {
    stage_stag_info_class* stagInfo = dComIfGp_getStageStagInfo();
    const int current = stagInfo != nullptr ? dStage_stagInfo_GetSaveTbl(stagInfo) : -1;

    w.key("flags").beginObject();
    w.member("currentStage", current);

    // Event bits: flag 0xAABB is bit mask 0xBB of byte 0xAA.
    std::string events;
    events.reserve(512);
    const u8* eventBytes = static_cast<const u8*>(dComIfGs_getSaveData()->getEvent().getPEventBit());
    static constexpr char kHex[] = "0123456789abcdef";
    for (int i = 0; i < 256; ++i) {
        events += kHex[eventBytes[i] >> 4];
        events += kHex[eventBytes[i] & 0xF];
    }
    w.member("events", events);

    // Per stage save table: treasure boxes (64), switches (128), item bits (0x80-0xBF).
    w.key("stages").beginArray();
    for (int stage = 0; stage < kStageSaveCount; ++stage) {
        auto& bits = dComIfGs_getSaveData()->getSave(stage).getBit();
        std::string tbox, sw, item;
        append_bits_hex(tbox, 64, [&](int f) { return dComIfGs_isStageTbox(stage, f) != 0; });
        append_bits_hex(sw, 128, [&](int f) { return dComIfGs_isStageSwitch(stage, f) != 0; });
        append_bits_hex(item, 64, [&](int f) {
            return stage == current ? dComIfGs_isItem(f + 0x80, -1) != 0 : bits.isItem(f) != 0;
        });
        w.beginObject();
        w.member("t", tbox);
        w.member("s", sw);
        w.member("i", item);
        w.endObject();
    }
    w.endArray();

    // The current stage also has dungeon-temporary item bits below 0x80 ("dan"). Bits from 0xC0 are
    // zone flags that need a room number, so only 0x00-0xBF are read.
    std::string currentItems;
    if (current >= 0) {
        append_bits_hex(currentItems, 0xC0, [](int f) { return dComIfGs_isItem(f, -1) != 0; });
    }
    w.member("currentItems", currentItems);
    w.endObject();
}

}  // namespace

std::string build_state_json() {
    JsonWriter w;
    w.beginObject();
    w.member("protocol", kProtocolVersion);
    const bool inGame = is_in_game();
    w.member("inGame", inGame);
    if (inGame) {
        w.member("stage", dComIfGp_getStartStageName());
        write_items(w);
        write_inventory(w);
        write_flags(w);
        write_dungeons(w);
    }
    w.endObject();
    return w.str();
}

}  // namespace tracker
