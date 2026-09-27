// Location list for the Locations tab: which checks exist, how they are grouped, and whether they
// have been obtained. Obtained-state rules follow the randomizer's tracker
// (TwilitRealm/dusklight-randomizer src/tools.cpp isLocationMetadataObtained / getStageSaveId).

// Stage index (the randomizer's allStages order) -> stage save table id. -1 / 255 = none.
const STAGE_SAVE_IDS = [
  18, 18, 18, 17, 17, 17, 16, 16, 16, 21, 21, 21, 22, 22, 22, 23, 23, 23, 23, 23, 24, 24, 24, 24, 19,
  19, 19, 20, 20, 20, 25, 25, 25, 26, 26, 27, 27, 27, 27, 27, 2, 0, 255, 0, 0, 2, 3, 3, 3, 4, 4, 8,
  4, 9, 7, 10, 6, 6, 6, 10, 10, 4, 11, 3, 6, 0, 1, 2, 3, 3, 9, 4, 3, 9, 9, 3,
];

// Region groups shown on the left, as in the randomizer's in-game tracker tab.
export const REGION_GROUPS = [
  { name: "Ordon", categories: ["Ordona Province"] },
  { name: "Faron", categories: ["Faron Province", "Faron Woods", "Hyrule Field - Faron Province", "Sacred Grove"] },
  {
    name: "Eldin",
    categories: ["Eldin Province", "Hyrule Field - Eldin", "Hyrule Field - Eldin Province", "Eldin Lantern Cave",
      "Eldin Stockcave", "Death Mountain", "Kakariko Village", "Kakariko Graveyard"],
  },
  {
    name: "Lanayru",
    categories: ["Lanayru Province", "Hyrule Field - Lanayru", "Hyrule Field - Lanayru Province", "Castle Town",
      "Fishing Hole", "Lake Hylia", "Lake Lantern Cave", "Upper Zoras River", "Zoras Domain"],
  },
  { name: "Gerudo Desert", categories: ["Gerudo Desert", "Bulblin Camp", "Mirror Chamber", "Cave of Ordeals"] },
  { name: "Snowpeak", categories: ["Snowpeak Province", "Snowpeak"] },
  { name: "Forest Temple", categories: ["Forest Temple"] },
  { name: "Goron Mines", categories: ["Goron Mines"] },
  { name: "Lakebed Temple", categories: ["Lakebed Temple"] },
  { name: "Arbiter's Grounds", categories: ["Arbiters Grounds"] },
  { name: "Snowpeak Ruins", categories: ["Snowpeak Ruins"] },
  { name: "Temple of Time", categories: ["Temple of Time"] },
  { name: "City in the Sky", categories: ["City in the Sky"] },
  { name: "Palace of Twilight", categories: ["Palace of Twilight"] },
  { name: "Hyrule Castle", categories: ["Hyrule Castle"] },
];

// Categories every location in this list must not have (never item checks the player tracks).
const ALWAYS_HIDDEN = ["Warp Portal", "Twilit Insect", "Hint Sign", "Non-Item Location"];

/**
 * Builds the tracked location list from locations.yaml, filtered by the randomizer settings the
 * same way the in-game tracker filters it.
 */
export function buildLocationList(locationsYaml, settings) {
  const s = (name) => settings.get(name);
  const poes = s("Poe Souls") ?? "Off";
  const hiddenIf = [
    [s("Golden Bugs") !== "On", (c) => c.has("Golden Bug")],
    [s("Sky Characters") !== "On", (c) => c.has("Sky Character")],
    [s("Gifts From NPCs") !== "On", (c) => c.has("Npc")],
    [s("Shop Items") !== "On", (c) => c.has("Shop")],
    [s("Hidden Skills") !== "On", (c) => c.has("Golden Wolf")],
    [s("Hidden Rupees") !== "On", (c) => c.has("Rupee - Hidden")],
    [s("Freestanding Rupees") !== "On", (c) => c.has("Rupee - Freestanding")],
    [!["Overworld", "All"].includes(poes), (c) => c.has("Poe") && c.has("Overworld")],
    [!["Dungeon", "All"].includes(poes), (c) => c.has("Poe") && c.has("Dungeon")],
  ];

  const list = [];
  for (const node of locationsYaml ?? []) {
    if (!node?.Name) continue;
    const metadata = node.Metadata && typeof node.Metadata === "object" && !Array.isArray(node.Metadata) ? node.Metadata : {};
    const categories = new Set([...(node.Categories ?? []), ...Object.keys(metadata)].filter(Boolean));
    if (ALWAYS_HIDDEN.some((c) => categories.has(c))) continue;
    if (hiddenIf.some(([hide, match]) => hide && match(categories))) continue;
    // Case-insensitive so "Cave Of Ordeals" style differences still match.
    const lower = new Set([...categories].map((c) => c.toLowerCase()));
    const group = REGION_GROUPS.find((g) => g.categories.some((c) => lower.has(c.toLowerCase())));
    list.push({ name: node.Name, group: group?.name ?? "Other", categories, metadata });
  }
  return list;
}

// ---- Obtained state from the mod's raw flags (state.flags) ----

function hexBit(hex, bit) {
  if (!hex || bit < 0) return false;
  const byte = bit >> 3;
  if (byte * 2 + 2 > hex.length) return false;
  return ((parseInt(hex.substr(byte * 2, 2), 16) >> (bit & 7)) & 1) === 1;
}

function stageSaveId(stageIndex) {
  const id = STAGE_SAVE_IDS[stageIndex];
  return id === undefined || id === 255 ? -1 : id;
}

export class FlagReader {
  constructor(flags) {
    this.flags = flags ?? null;
  }

  get ok() {
    return !!this.flags;
  }

  event(flag) {
    const f = Number(flag);
    const byte = f >> 8;
    const mask = f & 0xff;
    const hex = this.flags?.events ?? "";
    if (byte * 2 + 2 > hex.length) return false;
    return (parseInt(hex.substr(byte * 2, 2), 16) & mask) !== 0;
  }

  tbox(saveId, n) {
    return hexBit(this.flags?.stages?.[saveId]?.t, n);
  }

  switch(saveId, n) {
    return hexBit(this.flags?.stages?.[saveId]?.s, n);
  }

  // tracker_isStageItem: current stage reads live bits, other stages the saved 0x80+ range.
  item(saveId, n) {
    if (saveId === this.flags?.currentStage) return hexBit(this.flags?.currentItems, n);
    return n >= 0x80 ? hexBit(this.flags?.stages?.[saveId]?.i, n - 0x80) : false;
  }
}

// isLocationMetadataObtained
export function isObtained(location, reader) {
  const m = location.metadata;
  const first = (v) => (Array.isArray(v) ? v[0] : v) ?? {};
  if (m.Chest) {
    const c = first(m.Chest);
    return reader.tbox(stageSaveId(c.Stage), c["Tbox Id"]);
  }
  if (m.Poe) {
    const p = first(m.Poe);
    return reader.switch(stageSaveId(p.Stage), p.Flag);
  }
  if (m["Freestanding Item"]) {
    const f = first(m["Freestanding Item"]);
    // The big baba key uses a treasure box flag.
    if (location.name === "Forest Temple Big Baba Key") return reader.tbox(stageSaveId(f.Stage), f.Flag);
    return reader.item(stageSaveId(f.Stage), f.Flag);
  }
  if (m["Event Flag"] !== undefined) return reader.event(m["Event Flag"]);
  if (m["Golden Wolf"]) return reader.event(first(m["Golden Wolf"]).Flag);
  if (m["Switch Flag"]) {
    const f = first(m["Switch Flag"]);
    return reader.switch(stageSaveId(f.Stage), f.Flag);
  }
  if (m["Item Flag"]) {
    const f = first(m["Item Flag"]);
    return reader.item(stageSaveId(f.Stage), f.Flag);
  }
  if (m["Twilit Insect"]) {
    const f = first(m["Twilit Insect"]);
    return reader.tbox(stageSaveId(f.Stage), f.Flag);
  }
  return false;
}
