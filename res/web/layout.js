// Tracker tiles and the default layout.
//
// Every tile has a stable id (used in saved layouts) and a render(ctx) function returning:
//   on      obtained (highlighted)           label   display name (may change with contents)
//   icon    icon name (see GAME_ICON_IDS; also the file name of an uploaded custom icon)    badge   number/text drawn over the icon (optional)
//   meter   0..1 bar drawn over the icon (optional)
//   corner  { icon, text } upgrade marker in the top-right corner (icon, or text when the icon
//           pack has no such file), e.g. Big Quiver / Giant Bomb Bag
//
// ctx = { items, ammo, bombBags, bottles } straight from the mod's state (docs/protocol.md).
// Icons are built from the game data by the mod; a tile without an icon shows its label.

export const COLUMNS = 7;

const count = (ctx, id) => ctx.items[id] ?? 0;

// Simple owned / not owned item.
function simple(id, label, icon) {
  return { render: (ctx) => ({ on: count(ctx, id) > 0, label, icon }) };
}

// Progressive item: one label/icon per level (index 0 = level 1, also shown while not owned).
function progressive(id, labels, icons) {
  return {
    render: (ctx) => {
      const n = count(ctx, id);
      const i = Math.max(0, Math.min(n, labels.length) - 1);
      return { on: n > 0, label: labels[i], icon: icons[Math.min(i, icons.length - 1)] };
    },
  };
}

// Counted collectible with the count drawn over the icon.
function counted(id, label, icon, max) {
  return {
    render: (ctx) => {
      const n = count(ctx, id);
      return { on: n > 0, label, icon, badge: max ? `${n}/${max}` : n > 0 ? String(n) : "" };
    },
  };
}

// ---- Bomb bags and bottles (contents come from state.bombBags / state.bottles) ----

const ITEM = {
  BOMB_BAG: 0x50,
  EMPTY_BOTTLE: 0x60,
  BEE_LARVA: 0x76,
};

const BOMB_TYPES = {
  0x70: { label: "Bombs", icon: "Bombs" },
  0x71: { label: "Water Bombs", icon: "Water_Bombs" },
  0x72: { label: "Bomblings", icon: "Bomblings" },
};

// The Giant Bomb Bag doubles the capacity of every bag.
const GIANT_BOMB_BAG = { icon: "Giant_Bomb_Bag", text: "GIANT", title: "Giant Bomb Bag" };

function bombBag(index) {
  return {
    render: (ctx) => {
      const bag = ctx.bombBags?.[index];
      if (!bag) return { on: false, label: "Bomb Bag", icon: "Bomb_Bag" };
      const corner = count(ctx, "Giant Bomb Bag") > 0 ? GIANT_BOMB_BAG : undefined;
      const type = BOMB_TYPES[bag.item];
      if (!type) return { on: true, label: "Bomb Bag", icon: "Bomb_Bag", corner };
      return { on: true, label: type.label, icon: type.icon, item: bag.item, badge: String(bag.count), full: bag.count >= bag.max, corner };
    },
  };
}

// Quiver upgrades: Progressive Bow 2 = Big Quiver, 3 = Giant Quiver.
const QUIVERS = [
  undefined,
  { icon: "Quiver1", text: "BIG", title: "Big Quiver" },
  { icon: "Quiver2", text: "GIANT", title: "Giant Quiver" },
];

// Bottle contents by item id: [label, icon]. Unknown contents keep the plain bottle icon.
const BOTTLE_CONTENTS = {
  0x60: ["Empty Bottle", "Bottle"],
  0x61: ["Red Potion", "BottleRed"],
  0x69: ["Red Potion", "BottleRed"],
  0x62: ["Green Potion", "Bottle"],
  0x63: ["Blue Potion", "BottleBlue"],
  0x64: ["Milk", "BottleMilk"],
  0x65: ["Half Milk", "BottleMilkH"],
  0x66: ["Lantern Oil", "BottleYellow"],
  0x68: ["Lantern Oil", "BottleYellow"],
  0x6e: ["Lantern Oil", "BottleYellow"],
  0x6f: ["Lantern Oil", "BottleYellow"],
  0x9d: ["Lantern Oil", "BottleYellow"],
  0x67: ["Water", "BottleWater"],
  0x6a: ["Nasty Soup", "BottleNasty"],
  0x6b: ["Hot Spring Water", "BottleWater"],
  0x6d: ["Hot Spring Water", "BottleWater"],
  0x6c: ["Fairy", "BottleFairy"],
  0x73: ["Great Fairy's Tears", "BottleTears"],
  0x74: ["Worm", "BottleWorm"],
  0x76: ["Bee Larva", "BottleBee"],
  0x77: ["Rare Chu Jelly", "BottleRare"],
  0x78: ["Red Chu Jelly", "BottleRed"],
  0x79: ["Blue Chu Jelly", "BottleBlue"],
  0x7a: ["Green Chu Jelly", "Bottle"],
  0x7b: ["Yellow Chu Jelly", "BottleYellow"],
  0x7c: ["Purple Chu Jelly", "BottlePurple"],
  0x7d: ["Simple Soup", "BottleSoup"],
  0x7e: ["Good Soup", "BottleSoup"],
  0x7f: ["Superb Soup", "BottleSoup"],
  0x9f: ["Black Chu Jelly", "Bottle"],
  0xef: ["Poe's Flame", "Bottle"],
  0xf0: ["Poe's Flame", "Bottle"],
  0xf1: ["Poe's Flame", "Bottle"],
  0xf2: ["Poe's Flame", "Bottle"],
};

function bottle(index) {
  return {
    render: (ctx) => {
      const b = ctx.bottles?.[index];
      if (!b) return { on: false, label: "Bottle", icon: "Bottle" };
      const [label, icon] = BOTTLE_CONTENTS[b.item] ?? ["Bottle", "Bottle"];
      // The game shows a count only for bee larvae; for other contents the bottle's number is
      // left over (e.g. 10 after filling) and means nothing.
      const badge = b.item === ITEM.BEE_LARVA && b.count > 0 ? String(b.count) : "";
      return { on: true, label, icon, item: b.item, badge };
    },
  };
}

// ---- Tile catalogue ----

export const TILES = {
  // Items
  slingshot: {
    render: (ctx) => {
      const on = count(ctx, "Slingshot") > 0;
      return { on, label: "Slingshot", icon: "Slingshot", badge: on ? String(ctx.ammo?.seeds ?? 0) : "" };
    },
  },
  lantern: {
    render: (ctx) => {
      const on = count(ctx, "Lantern") > 0;
      const max = ctx.ammo?.oilMax || 0;
      return { on, label: "Lantern", icon: "Lantern", meter: on && max > 0 ? (ctx.ammo.oil ?? 0) / max : undefined };
    },
  },
  boomerang: simple("Gale Boomerang", "Gale Boomerang", "Gale_Boomerang"),
  ironBoots: simple("Iron Boots", "Iron Boots", "Iron_Boots"),
  bow: {
    render: (ctx) => {
      const level = count(ctx, "Progressive Bow");
      const on = level > 0;
      return {
        on,
        label: "Hero's Bow",
        icon: "Hero's_Bow",
        badge: on ? String(ctx.ammo?.arrows ?? 0) : "",
        full: on && ctx.ammo && ctx.ammo.arrows >= ctx.ammo.arrowsMax,
        corner: QUIVERS[Math.min(Math.max(level - 1, 0), 2)],
      };
    },
  },
  hawkeye: simple("Hawkeye", "Hawkeye", "Hawkeye"),
  clawshot: progressive("Progressive Clawshot", ["Clawshot", "Double Clawshots"], ["Progressive_Clawshot0", "Progressive_Clawshot1"]),
  spinner: simple("Spinner", "Spinner", "Spinner"),
  ballAndChain: simple("Ball and Chain", "Ball and Chain", "Ball_and_Chain"),
  dominionRod: progressive("Progressive Dominion Rod", ["Dominion Rod", "Dominion Rod (Powered)"], ["Progressive_Dominion_Rod0", "Progressive_Dominion_Rod1"]),
  fishingRod: progressive("Progressive Fishing Rod", ["Fishing Rod", "Coral Earring Rod"], ["Progressive_Fishing_Rod0", "Progressive_Fishing_Rod1"]),
  horseCall: simple("Horse Call", "Horse Call", "Horse_Call"),
  bombBag1: bombBag(0),
  bombBag2: bombBag(1),
  bombBag3: bombBag(2),
  bottle1: bottle(0),
  bottle2: bottle(1),
  bottle3: bottle(2),
  bottle4: bottle(3),

  // Quest items
  // Sky characters come from the randomizer's counter (see the mod's sky_book_characters()).
  skyBook: {
    render: (ctx) => {
      const owned = count(ctx, "Progressive Sky Book") > 0;
      const chars = count(ctx, "Sky Book Characters");
      return {
        on: owned,
        label: chars >= 6 ? "Sky Book (Filled)" : "Ancient Sky Book",
        icon: "Sky_Book_Character",
        badge: owned ? `${chars}/6` : "",
        full: chars >= 6,
      };
    },
  },
  aurusMemo: simple("Aurus Memo", "Auru's Memo", "Auru's_Memo"),
  asheisSketch: simple("Asheis Sketch", "Ashei's Sketch", "Ashei's_Sketch"),
  iliaQuest: {
    render: (ctx) => {
      const steps = [
        ["Renados Letter", "Renado's Letter", "Renado's_Letter"],
        ["Invoice", "Invoice", "Invoice"],
        ["Wooden Statue", "Wooden Statue", "Wooden_Statue"],
        ["Ilias Charm", "Ilia's Charm", "Ilia's_Charm"],
      ];
      let current = -1;
      steps.forEach(([id], i) => {
        if (count(ctx, id) > 0) current = i;
      });
      const [, label, icon] = steps[Math.max(current, 0)];
      return { on: current >= 0, label, icon };
    },
  },

  // Equipment
  sword: progressive("Progressive Sword", ["Wooden Sword", "Ordon Sword", "Master Sword", "Light Sword"],
    ["Progressive_Sword0", "Progressive_Sword1", "Progressive_Sword2", "Progressive_Sword3"]),
  // Ordon and Wooden Shield share one slot in game.
  shield: {
    render: (ctx) => {
      if (count(ctx, "Wooden Shield") > 0) return { on: true, label: "Wooden Shield", icon: "Progressive_Shield1" };
      return { on: count(ctx, "Ordon Shield") > 0, label: "Ordon Shield", icon: "Progressive_Shield0" };
    },
  },
  hylianShield: simple("Hylian Shield", "Hylian Shield", "Hylian_Shield"),
  zoraArmor: simple("Zora Armor", "Zora Armor", "Zora_Armor"),
  magicArmor: simple("Magic Armor", "Magic Armor", "Magic_Armor"),
  shadowCrystal: simple("Shadow Crystal", "Shadow Crystal", "Shadow_Crystal"),

  // Field keys
  faronGateKey: simple("North Faron Woods Gate Key", "Faron Gate Key", "Small_KeyF"),
  coroGateKey: simple("Faron Woods Coro Key", "Coro Gate Key", "Small_KeyC"),
  gateKeys: simple("Gate Keys", "Gate Keys", "Small_KeyG"),
  bulblinCampKey: simple("Gerudo Desert Bulblin Camp Key", "Bulblin Camp Key", "Small_KeyB"),

  // Collection
  fusedShadow: counted("Progressive Fused Shadow", "Fused Shadow", "Fused_Shadow", 3),
  mirrorShard: counted("Progressive Mirror Shard", "Mirror Shard", "Mirror_Shard", 4),
  wallet: {
    render: (ctx) => {
      const level = Math.min(count(ctx, "Progressive Wallet"), 2);
      const labels = ["Wallet", "Big Wallet", "Giant Wallet"];
      return {
        on: true,
        label: labels[level],
        icon: `Progressive_Wallet${level}`,
        badge: String(ctx.ammo?.rupees ?? 0),
        full: ctx.ammo && ctx.ammo.rupees >= ctx.ammo.rupeesMax,
      };
    },
  },
  hiddenSkills: counted("Progressive Hidden Skill", "Hidden Skills", "Hidden_Skill", 7),
  poeSoul: counted("Poe Soul", "Poe Souls", "Poe_Soul"),
  goldenBug: counted("Golden Bug", "Golden Bugs", "Bug0"),
};

// Default layout: sections of COLUMNS-wide rows. null = empty slot.
export const DEFAULT_LAYOUT = {
  version: 1,
  sections: [
    {
      id: "items",
      title: "Items",
      slots: [
        "slingshot", "lantern", "boomerang", "ironBoots", "bow", "hawkeye", "clawshot",
        "spinner", "ballAndChain", "dominionRod", "fishingRod", "horseCall", null, null,
        "bombBag1", "bombBag2", "bombBag3", "bottle1", "bottle2", "bottle3", "bottle4",
      ],
    },
    { id: "quest", title: "Quest Items", slots: ["skyBook", "aurusMemo", "asheisSketch", "iliaQuest", null, null, null] },
    { id: "equipment", title: "Equipment", slots: ["sword", "shield", "hylianShield", "zoraArmor", "magicArmor", "shadowCrystal", null] },
    { id: "fieldKeys", title: "Field Keys", slots: ["faronGateKey", "coroGateKey", "gateKeys", "bulblinCampKey", null, null, null] },
    { id: "collection", title: "Collection", slots: ["fusedShadow", "mirrorShard", "wallet", "hiddenSkills", "poeSoul", "goldenBug", null] },
  ],
};

// Makes a saved layout safe to use: unknown tiles are dropped, duplicates removed, rows padded to
// COLUMNS, and tiles added in newer versions are placed into their default section.
export function normalizeLayout(saved) {
  const base = structuredClone(DEFAULT_LAYOUT);
  if (!saved || !Array.isArray(saved.sections) || saved.sections.length === 0) return base;

  const seen = new Set();
  const sections = saved.sections
    .filter((s) => s && typeof s.id === "string" && Array.isArray(s.slots))
    .map((s) => ({
      id: s.id,
      title: typeof s.title === "string" ? s.title : s.id,
      slots: s.slots.map((id) => {
        if (typeof id !== "string" || !TILES[id] || seen.has(id)) return null;
        seen.add(id);
        return id;
      }),
    }));

  for (const def of base.sections) {
    let target = sections.find((s) => s.id === def.id);
    for (const id of def.slots) {
      if (!id || seen.has(id)) continue;
      if (!target) {
        target = { id: def.id, title: def.title, slots: [] };
        sections.push(target);
      }
      const free = target.slots.indexOf(null);
      if (free >= 0) target.slots[free] = id;
      else target.slots.push(id);
      seen.add(id);
    }
  }

  for (const s of sections) {
    while (s.slots.length === 0 || s.slots.length % COLUMNS !== 0) s.slots.push(null);
  }
  return { version: 1, sections };
}

// ---- Icons from the game ----

// Icon name -> game item number (d_item_data.h dItemNo_*), for icons the mod builds from the
// game's item icon archive (/game-icons/<n>.png). Names without an entry (bosses, Shadow Crystal,
// Fused Shadow, Mirror Shard, Hidden Skills) are drawn as text unless the user sets an image.
export const GAME_ICON_IDS = {
  Slingshot: 0x4b, Lantern: 0x48, Gale_Boomerang: 0x40, Iron_Boots: 0x45, "Hero's_Bow": 0x43,
  Hawkeye: 0x3e, Clawshot: 0x44, Progressive_Clawshot0: 0x44, Progressive_Clawshot1: 0x47,
  Spinner: 0x41, Ball_and_Chain: 0x42, Progressive_Dominion_Rod0: 0x4c, Progressive_Dominion_Rod1: 0x46,
  Progressive_Fishing_Rod0: 0x4a, Progressive_Fishing_Rod1: 0x5c, Horse_Call: 0x84,
  Bomb_Bag: 0x50, Bombs: 0x70, Water_Bombs: 0x71, Bomblings: 0x72, Giant_Bomb_Bag: 0x4f,
  Quiver1: 0x55, Quiver2: 0x56,
  Bottle: 0x60, BottleRed: 0x61, BottleBlue: 0x63, BottleMilk: 0x64, BottleMilkH: 0x65,
  BottleWater: 0x67, BottleNasty: 0x6a, BottleFairy: 0x6c, BottleTears: 0x73, BottleWorm: 0x74,
  BottleBee: 0x76, BottleRare: 0x77, BottleYellow: 0x7b, BottlePurple: 0x7c, BottleSoup: 0x7d,
  Sky_Book_Character: 0xe9, "Auru's_Memo": 0x90, "Ashei's_Sketch": 0x91, "Renado's_Letter": 0x80,
  Invoice: 0x81, Wooden_Statue: 0x82, "Ilia's_Charm": 0x83,
  Progressive_Sword0: 0x3f, Progressive_Sword1: 0x28, Progressive_Sword2: 0x29, Progressive_Sword3: 0x49,
  Progressive_Shield0: 0x2b, Progressive_Shield1: 0x2a, Hylian_Shield: 0x2c,
  Zora_Armor: 0x31, Magic_Armor: 0x30,
  Progressive_Wallet0: 0x34, Progressive_Wallet1: 0x35, Progressive_Wallet2: 0x36,
  Poe_Soul: 0xe0, Bug0: 0xc0,
  // Textures without an item: "<archive>/#<index>" in the item icon archive.
  Hidden_Skill: "itemicon/#61", // NI_ITEM_ICON_MAKIMONO
  Small_Key: 0x20, Boss_Key: 0x26, Boss_KeyHC: 0x26,
  // Field keys use the small key (the randomizer's own keys have no icon in the game).
  Small_KeyF: 0x20, Small_KeyC: 0x20, Small_KeyG: 0x20, Small_KeyB: 0x20, Dungeon_Map: 0x23, Compass: 0x24, Bedroom_Key: 0xf6,
  GBK0: 0xf9, GBK1: 0xfa, GBK2: 0xfb, GBK3: 0xfd,
  Ordon_Pumpkin: 0xf4, Ordon_Goat_Cheese: 0xf5,
};

// Default textures drawn behind an icon (icon name -> "<archive>/<file>.bti"). Users can set or
// clear one per icon in the icon editor.
export const GAME_ICON_BACKGROUNDS = {};

// ---- Dungeons view ----

export const DUNGEON_ICONS = {
  smallKey: "Small_Key",
  bigKey: "Boss_Key",
  map: "Dungeon_Map",
  compass: "Compass",
  // Dungeon-specific big key icons.
  bigKeys: {
    "Snowpeak Ruins": "Bedroom_Key",
    "Hyrule Castle": "Boss_KeyHC",
  },
  // Goron Mines uses three key shards instead of a big key.
  keyShards: ["GBK0", "GBK1", "GBK3"],
  bosses: {
    "Forest Temple": "Diababa",
    "Goron Mines": "Fyrus",
    "Lakebed Temple": "Morpheel",
    "Arbiters Grounds": "Stallord",
    "Snowpeak Ruins": "Blizzeta",
    "Temple of Time": "Armogohma",
    "City in the Sky": "Argorok",
    "Palace of Twilight": "Zant",
  },
};

// Dungeon-specific items shown in the "Other" column.
export const DUNGEON_EXTRAS = {
  "Snowpeak Ruins": [
    { id: "Ordon Pumpkin", label: "Ordon Pumpkin", icon: "Ordon_Pumpkin" },
    { id: "Ordon Cheese", label: "Ordon Goat Cheese", icon: "Ordon_Goat_Cheese" },
  ],
};
