// Location list for the Locations tab: which checks exist, how they are grouped, and whether they
// have been obtained. Obtained-state rules follow the randomizer's tracker
// (TwilitRealm/dusklight-randomizer src/tools.cpp isLocationMetadataObtained / getStageSaveId).

// Stage index (the randomizer's allStages order) -> stage save table id. -1 / 255 = none.
const STAGE_SAVE_IDS = [
  18, 18, 18, 17, 17, 17, 16, 16, 16, 21, 21, 21, 22, 22, 22, 23, 23, 23, 23, 23, 24, 24, 24, 24, 19,
  19, 19, 20, 20, 20, 25, 25, 25, 26, 26, 27, 27, 27, 27, 27, 2, 0, 255, 0, 0, 2, 3, 3, 3, 4, 4, 8,
  4, 9, 7, 10, 6, 6, 6, 10, 10, 4, 11, 3, 6, 0, 1, 2, 3, 3, 9, 4, 3, 9, 9, 3,
];

// The randomizer's allStages order (src/stages.cpp): stage numbers in its data files index this.
export const STAGE_NAMES = [
  "D_MN01", "D_MN01A", "D_MN01B", "D_MN04", "D_MN04A", "D_MN04B", "D_MN05", "D_MN05A", "D_MN05B", "D_MN06",
  "D_MN06A", "D_MN06B", "D_MN07", "D_MN07A", "D_MN07B", "D_MN08", "D_MN08A", "D_MN08B", "D_MN08C", "D_MN08D",
  "D_MN09", "D_MN09A", "D_MN09B", "D_MN09C", "D_MN10", "D_MN10A", "D_MN10B", "D_MN11", "D_MN11A", "D_MN11B",
  "D_SB00", "D_SB01", "D_SB02", "D_SB03", "D_SB04", "D_SB05", "D_SB06", "D_SB07", "D_SB08", "D_SB09",
  "D_SB10", "F_SP00", "F_SP102", "F_SP103", "F_SP104", "F_SP108", "F_SP109", "F_SP110", "F_SP111", "F_SP112",
  "F_SP113", "F_SP114", "F_SP115", "F_SP116", "F_SP117", "F_SP118", "F_SP121", "F_SP122", "F_SP123", "F_SP124",
  "F_SP125", "F_SP126", "F_SP127", "F_SP128", "F_SP200", "R_SP01", "R_SP107", "R_SP108", "R_SP109", "R_SP110",
  "R_SP116", "R_SP127", "R_SP128", "R_SP160", "R_SP161", "R_SP209", "R_SP300", "R_SP301",
];

// Logic region of each stage room, from the randomizer's entrance data: every entrance names the
// area it leads to and the stage and room of that area. Returns lookup(stageName, room) -> region
// or null; a stage whose known rooms all share one region answers for its other rooms too.
export function buildRoomRegions(entranceData, world) {
  const rooms = new Map(); // "stage/room" -> region
  const stages = new Map(); // stage -> Set of regions
  for (const entry of entranceData ?? []) {
    for (const side of [entry?.Forward, entry?.Return]) {
      // An interior has no region of its own: it takes the region of the area its door is in.
      const [from, target] = String(side?.Connection ?? "").split(" -> ");
      const regionOf = (area) => {
        const r = world.areas.get(area)?.region;
        return r && r !== "None" ? r : null;
      };
      const region = regionOf(target) ?? regionOf(from);
      const stage = STAGE_NAMES[side?.Stage];
      if (!region || region === "None" || !stage || typeof side.Room !== "number") continue;
      rooms.set(`${stage}/${side.Room}`, region);
      if (!stages.has(stage)) stages.set(stage, new Set());
      stages.get(stage).add(region);
    }
  }
  return (stage, room) => {
    const exact = rooms.get(`${stage}/${room}`);
    if (exact) return exact;
    const all = stages.get(stage);
    return all?.size === 1 ? [...all][0] : null;
  };
}

// Region groups shown on the left, as in the randomizer's in-game tracker tab.
export const REGION_GROUPS = [
  { name: "Ordon", categories: ["Ordona Province"] },
  { name: "Faron", categories: ["Faron Province", "Faron Woods", "Hyrule Field - Faron Province", "Sacred Grove"] },
  {
    name: "Eldin",
    categories: ["Eldin Province", "Hyrule Field - Eldin", "Hyrule Field - Eldin Province", "Eldin Lantern Cave",
      "Eldin Stockcave", "Death Mountain", "Kakariko Village", "Kakariko Graveyard", "Hidden Village"],
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
const ALWAYS_HIDDEN = ["Warp Portal", "Twilit Insect", "Hint Sign", "Non-Item Location", "Placeholder"];

// Group for checks no region group names (e.g. a new area in a randomizer update); shown only when
// it has checks, so nothing randomized goes missing.
export const OTHER_GROUP = { name: "Other", categories: [] };

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
