// Locations tab: every randomizer check grouped by region, marked obtained / reachable / not yet
// reachable, with per-check custom requirements (routes of items) that replace the randomizer
// logic for that check.

import yaml from "./vendor/js-yaml.mjs";
import { World, Search, itemsFromState, routeSatisfied, routeEntrySatisfied, routeEntryLabel, trackerEntry, parseDisplay, atomLabel, BOSS_NAMES } from "./logic.js";
import { REGION_GROUPS, OTHER_GROUP, STAGE_NAMES, FlagReader, buildLocationList, buildRoomRegions, buildRoomNames, isObtained } from "./locations.js";
import { TILE_ITEMS, OTHER_ITEM_GROUPS, DUNGEON_ICONS, isDungeonKey, dungeonKeyIcon } from "./layout.js";

const DATA_FILES = [
  "locations.yaml", "macros.yaml", "items.yaml", "settings_list.yaml", "world/Root.yaml",
  "world/overworld/Ordona Province.yaml", "world/overworld/Faron Province.yaml",
  "world/overworld/Eldin Province.yaml", "world/overworld/Lanayru Province.yaml",
  "world/overworld/Gerudo Desert.yaml", "world/overworld/Snowpeak Province.yaml",
  "world/dungeons/Forest Temple.yaml", "world/dungeons/Goron Mines.yaml",
  "world/dungeons/Lakebed Temple.yaml", "world/dungeons/Arbiters Grounds.yaml",
  "world/dungeons/Snowpeak Ruins.yaml", "world/dungeons/Temple of Time.yaml",
  "world/dungeons/City in the Sky.yaml", "world/dungeons/Palace of Twilight.yaml",
  "world/dungeons/Hyrule Castle.yaml",
];

// On/off conditions offered under "Rand Settings". The twilights are read from the game (cleared by
// playing or by the seed); the others are the randomizer's settings.
const RANDO_FLAG_GROUPS = [
  { title: "Story", flags: ["Skip Prologue", "Faron Twilight Cleared", "Eldin Twilight Cleared", "Lanayru Twilight Cleared", "Skip Midna's Desperate Hour"] },
  { title: "World", flags: ["Unlock Map Regions", "Open Door of Time", "Active Goron Mines Magnets", "Lower Hyrule Castle Chandelier", "Skip Bridge Donation", "Logic Transform Anywhere"] },
];
const RANDO_FLAGS = RANDO_FLAG_GROUPS.flatMap((g) => g.flags);
const GAME_TWILIGHTS = { "Faron Twilight Cleared": "Faron", "Eldin Twilight Cleared": "Eldin", "Lanayru Twilight Cleared": "Lanayru" };

// Dungeons in vanilla clear order.
const DUNGEON_ORDER = Object.keys(BOSS_NAMES);

// Seed conditions: met when the seed's requirement (randomizer logic, with the current items) is
// met, or when the game has set the flag it opens with.
const SEED_CONDITIONS = {
  // Won the sumo match against Gor Coron: the randomizer sets it from the start unless the
  // entrance is Closed.
  "Goron Mines Entrance Opened": { event: 0x0704 },
  "Door to the Past Opened": { expr: "Has_Sword_For_Temple_of_Time" },
  "Mirror of Twilight Repaired": {
    expr: "Palace_of_Twilight_Requirements == Open or " +
      "(Palace_of_Twilight_Requirements == Fused_Shadows and count(Progressive_Fused_Shadow, 3)) or " +
      "(Palace_of_Twilight_Requirements == Mirror_Shards and count(Progressive_Mirror_Shard, 4)) or " +
      "(Palace_of_Twilight_Requirements == Vanilla and 'Can_Complete_City_in_the_Sky')",
    event: 0x2b08,
  },
  "Hyrule Barrier Dispelled": { expr: "Can_Break_Hyrule_Castle_Barrier", event: 0x4208 },
};

// The Dungeon tab's "Entrance" group, in vanilla clear order: settings and seed conditions that
// open the way into each dungeon.
const ENTRANCE_ENTRIES = [
  "cond:Goron Mines Entrance Opened", "flag:Lakebed Does Not Require Water Bombs", "flag:Arbiters Does Not Require Bulblin Camp",
  "flag:Snowpeak Does Not Require Reekfish Scent", "flag:Sacred Grove Does Not Require Skull Kid",
  "cond:Door to the Past Opened", "flag:City Does Not Require Filled Skybook",
  "cond:Mirror of Twilight Repaired", "cond:Hyrule Barrier Dispelled",
];

// Portals offered in the Portals tab: the ones a route may need (the mod reports each as an item
// once the game has opened it).
const PORTALS = ["Gerudo Desert Portal", "Mirror Chamber Portal", "Snowpeak Portal", "Sacred Grove Portal",
  "Bridge of Eldin Portal", "Upper Zoras River Portal"];

// Condition groups of the requirement editor: [key, tab label, search placeholder].
const ENTRY_TABS = [
  ["item", "Items", "Search items…"],
  ["dungeon", "Dungeon", "Search keys, bosses, entrances…"],
  ["portal", "Portals", "Search portals…"],
  ["time", "Time", "Day or Night"],
  ["flag", "Rand Settings", "Search settings…"],
  ["map", "Map Reachable", "Search regions…"],
];

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

/**
 * @param root      container element
 * @param options.getOverrides  () => { [location]: [[{item, n}], ...] }
 * @param options.getPresetOverrides () => Promise of the custom requirements bundled with the mod
 * @param options.saveOverrides (overrides) => Promise
 * @param options.getLogic      () => boolean, whether reachability is evaluated
 * @param options.saveLogic     (enabled) => Promise
 * @param options.saveEntries   (lines) => Promise; changes the per-save "map:", "mark:" and "note:"
 *                              entries the mod keeps with the save (state.found.entries)
 * @param options.getLayoutSections () => the Items tab's sections ({ title, slots: [tile id] })
 * @param options.makeIcon      (icon name, game item id?) => <img> drawn as in the Items tab
 * @param options.getSeedView   () => { hash, show }: seed picked in Rules (null = the save's seed,
 *                              else the newest) and whether found items are shown
 * @param options.saveSeedView  (view) => Promise
 * @param options.setStatus     (kind, text) => void
 */
// Below this width the region list and the check list are shown one at a time.
const NARROW_WIDTH = 560;

// Found items are shown as the player would know them. An item only seen lying around shows what it
// looks like: every small key (and the field keys, which share its model) is just a small key.
// Shops, hints and NPCs name the item. A foolish item looks like the real item the randomizer
// disguised it as until it is collected.
const LOOKS_LIKE = [
  [/Small Key$|^(Gerudo Desert Bulblin Camp Key|North Faron Woods Gate Key|Gate Keys|Faron Woods Coro Key)$/, "Small Key"],
  [/Big Key$/, "Big Key"],
  [/Compass$/, "Compass"],
  [/Dungeon Map$/, "Dungeon Map"],
  [/Key Shard$/, "Key Shard"],
];
// The models a foolish item can wear (randomizer_getRandomFoolishItemModelID), as item ids.
const FOOLISH_MODELS = [0x30, 0x3f, 0x2a, 0x2c, 0x32, 0x4a, 0x3e, 0x40, 0x41, 0x42, 0x43, 0x46, 0x44, 0x45, 0x4b, 0x50, 0xe9];
// Rooms where an NPC names a check's item before it is given (stage index, room).
const TOLD_ON_ENTER = [{ loc: "Charlo Donation Blessing", stage: 53, room: 2 }];
// Shop slots shown with another room of the same shop: the Castle Town Goron selling arrows stands
// in the central square, but is only reached from the Goron shop.
const SHOP_ROOM = { "Castle Town Goron Shop Arrow Refill": { Stage: 73, Room: 4 } };

const CRC_TABLE = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes, previous = 0) {
  let crc = ~previous >>> 0;
  for (const b of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 0xff];
  return ~crc >>> 0;
}

export function createLocationsView(root, { getOverrides, getPresetOverrides, saveOverrides, getLogic, saveLogic, saveEntries, getLayoutSections, makeIcon, getSeedView, saveSeedView, setStatus, placeOf = () => null, showOnMap = null, getCheckAreas = () => ({}), saveCheckArea = () => {}, onRegionPicked = () => {}, onFocus = () => {}, onReqClosed = () => {}, clickMode = () => "left-req" }) {
  let world = null;
  let locations = [];
  let pickableItems = [];
  let itemById = new Map(); // item id -> name (items.yaml)
  let itemMax = new Map(); // item -> how many the item pool holds (the vanilla placement count)
  let mapGroups = []; // [{ title: province, regions }] in the order of the randomizer's world files
  let randoFlags = [];
  let roomRegion = () => null; // (stage, room) -> logic region
  let roomName = () => null; // (stage, room) -> the place's own name (interiors, caves, grottos)
  let roomVariants = () => []; // (stage, room) -> grottos sharing the room: [{ name, area }]
  let roomKind = () => null; // (stage, room) -> "Interior", "Cave" or "Grotto"
  let entranceList = []; // the randomizer's entrances: [{ type, from, to, fwd: { stage, room, spawn }, back: { ... } }]
  let lastRegion = null; // region Link was last seen in (marked reachable on entry)
  let seeds = []; // generated seeds with a spoiler log, newest first
  let seedHash = null; // seed whose placements are loaded
  let spoiler = null; // { placements, settings } of that seed
  let excluded = new Set();
  let settingsNote = "";
  let loadError = "";
  let state = null;
  let results = new Map(); // location -> "obtained" | "checked" (by hand) | "reachable" | "blocked" | "excluded" | "unknown"
  let search = null; // last finished logic search
  let selectedGroup = REGION_GROUPS[0].name;
  let hideObtained = false;
  let editing = null; // { name, routes, edit, active, tab } while the detail panel is open
  let popup = null; // separate window the requirement is edited in (null: edited in the panel)
  let focused = null; // highlighted check (left click, or right click to toggle)
  let highlightedGroup = null; // the one highlighted region (left or right click)
  let showChecks = false; // narrow layout: the check list of selectedGroup is open
  let groupByArea = false; // the check list grouped by the area (logic region) each check is in
  let detailHost = null; // where the Map tab shows a check's row and requirement (under the map)
  let sortReachable = false; // check list: reachable checks first
  let regionFilter = { group: null, region: "" }; // check list: only this region of the province
  let rowClickTimer = null; // a row's click, held back for a double-click
  let openMenu = null; // toolbar menu kept open across redraws ("regions", "req", "seed")
  let regionsScroll = 0; // scroll position of the Reachable regions menu

  // Per-save entries of one kind ("map", "mark"), from the mod's state.
  const entriesOf = (kind) => (state?.found?.entries ?? []).filter((e) => e.startsWith(`${kind}:`)).map((e) => e.slice(kind.length + 1));
  const getMapFlags = () => entriesOf("map");
  const markedChecked = () => new Set(entriesOf("mark"));

  new ResizeObserver(() => root.classList.toggle("loc-narrow", root.clientWidth > 0 && root.clientWidth < NARROW_WIDTH))
    .observe(root);
  // Height of the sticky toolbar, for the sticky region list and check list title below it.
  const toolbarSize = new ResizeObserver(([entry]) => root.style.setProperty("--loc-toolbar-h", `${entry.target.offsetHeight}px`));

  try {
    hideObtained = localStorage.getItem("tracker.hideObtained") === "1";
    selectedGroup = localStorage.getItem("tracker.locGroup") || selectedGroup;
    focused = localStorage.getItem("tracker.locFocus") || null;
    highlightedGroup = localStorage.getItem("tracker.locMark") || null;
    sortReachable = localStorage.getItem("tracker.locSort") === "reachable";
    groupByArea = localStorage.getItem("tracker.locByArea") === "1";
  } catch {}

  // ---- Data ----

  async function fetchText(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.text();
  }

  let retryTimer = null;
  let retries = 0;

  let loading = false;
  async function load() {
    loading = true;
    try {
      await loadData();
    } finally {
      loading = false;
    }
  }

  async function loadData() {
    clearTimeout(retryTimer);
    loadError = "";
    render();
    try {
      const fetched = await Promise.allSettled(
        DATA_FILES.map((f) => fetchText(`rando/${f.split("/").map(encodeURIComponent).join("/")}`)));
      const missing = DATA_FILES.filter((_, i) => fetched[i].status === "rejected");
      if (missing.length) {
        throw new Error(`${missing.length} of ${DATA_FILES.length} files missing, e.g. ${missing[0]}`);
      }
      const data = Object.fromEntries(DATA_FILES.map((f, i) => [f, yaml.load(fetched[i].value)]));
      await loadSeed();
      let settings = {};
      settingsNote = "";
      if (spoiler?.settings) {
        settings = spoiler.settings; // the settings the seed was generated with
      } else {
        try {
          settings = yaml.load(await fetchText("rando-settings.yaml")) ?? {};
        } catch {
          settingsNote = "Randomizer settings not found — using default settings.";
        }
      }
      world = new World({
        worldFiles: DATA_FILES.filter((f) => f.startsWith("world/")).map((f) => data[f]),
        macros: data["macros.yaml"],
        items: data["items.yaml"],
        settingsList: data["settings_list.yaml"],
        locations: data["locations.yaml"],
        settings,
      });
      if (world.errors.length) console.warn("logic parse errors", world.errors);
      locations = buildLocationList(data["locations.yaml"], world.settings);
      excluded = new Set(settings["Excluded Locations"] ?? []);
      itemById = new Map((data["items.yaml"] ?? []).filter((i) => i?.Name && i.Id !== undefined).map((i) => [Number(i.Id), i.Name]));
      pickableItems = (data["items.yaml"] ?? [])
        .filter((i) => i?.Name && i.Importance !== "Junk")
        .map((i) => i.Name)
        .sort((a, b) => a.localeCompare(b));
      mapGroups = regionGroups(data);
      itemMax = new Map();
      for (const l of data["locations.yaml"] ?? []) {
        const item = l?.["Original Item"];
        if (item) itemMax.set(item, (itemMax.get(item) ?? 0) + 1);
      }
      // Sold in two shops, but one is all anyone needs.
      itemMax.set("Hylian Shield", 1);
      randoFlags = RANDO_FLAGS.filter((f) => GAME_TWILIGHTS[f] || world.settingOptions.get(f)?.includes("On"));
      // Optional: older downloads of the logic data lack this file; regions are then only marked by hand.
      roomRegion = () => null;
      try {
        const entrances = yaml.load(await fetchText("rando/entrance_shuffle_data.yaml"));
        roomRegion = buildRoomRegions(entrances, world);
        const names = buildRoomNames(entrances, world);
        roomName = names.name;
        roomVariants = names.variants;
        roomKind = names.kind;
        const side = (x) => (x && STAGE_NAMES[x.Stage] ? { stage: STAGE_NAMES[x.Stage], room: Number(x.Room), spawn: Number(x.Spawn) } : null);
        entranceList = (entrances ?? []).map((e) => {
          const [from, to] = String(e?.Forward?.Connection ?? "").split(" -> ");
          return { type: e?.Type ?? "", from, to, fwd: side(e?.Forward), back: side(e?.Return) };
        }).filter((e) => e.to && e.fwd);
      } catch {}
      retries = 0;
    } catch (err) {
      world = null;
      loadError = `Logic data is not available yet (${err.message}). The mod downloads it on start — check the ` +
        `internet connection, then press "Update logic data" in the mod panel. Retrying automatically…`;
      // The download may still be running: try again for a couple of minutes.
      if (retries++ < 24) retryTimer = setTimeout(load, 5000);
    }
    evaluate();
    render();
  }

  // ---- Seed (found items) ----

  // The seed being played: the one picked in Rules, else the newest generated seed that has a
  // spoiler log. Its placements are only shown for checks the player has found.
  async function loadSeed() {
    seeds = [];
    spoiler = null;
    seedHash = null;
    try {
      seeds = JSON.parse(await fetchText("rando-seeds/")).filter((s) => s?.spoiler && typeof s.hash === "string");
    } catch {}
    // The save's own seed (kept with the save by the mod) wins; then the one picked in Rules.
    const saved = state?.found?.seed;
    const wanted = getSeedView().hash;
    const chosen = seeds.find((s) => s.hash === saved) ?? seeds.find((s) => s.hash === wanted) ?? seeds[0];
    if (!chosen) return;
    try {
      spoiler = parseSpoiler(await fetchText(`rando-seeds/${encodeURIComponent(chosen.hash)}`));
      seedHash = chosen.hash;
    } catch {}
    // The save remembers the seed from its next game save on.
    if (seedHash && state?.inGame && state.found?.seed !== seedHash) sendFound([]);
  }

  // Tells the mod what was found (kept with the next game save), with the seed being shown.
  function sendFound(entries) {
    const body = [`seed\t${seedHash ?? ""}`, ...entries].join("\n");
    fetch("found", { method: "POST", headers: { "Content-Type": "text/plain" }, body }).catch(() => {});
  }

  // Spoiler log -> { placements: Map(location -> item), settings } ("All Locations:" and "# Settings").
  function parseSpoiler(text) {
    const placements = new Map();
    const lines = text.split(/\r?\n/);
    let section = "";
    let settings = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("# Settings")) {
        try {
          const parsed = yaml.load(lines.slice(i + 1).join("\n"));
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed;
        } catch {}
        break;
      }
      if (/^\S/.test(line)) {
        section = line.replace(/:\s*$/, "");
        continue;
      }
      const m = section === "All Locations" && /^ {8}(\S.*?):\s+(\S.*)$/.exec(line);
      if (m) placements.set(m[1], m[2].trim());
    }
    return { placements, settings };
  }

  // What a found check holds, as the player knows it: the item itself once obtained, named in a
  // hint or by an NPC; what it looks like when only seen (lying around or in a shop).
  function foundItem(loc) {
    if (!spoiler || !getSeedView().show) return null;
    const item = spoiler.placements.get(loc.name);
    if (!item) return null;
    if (results.get(loc.name) === "obtained") return item;
    const info = foundLocations().get(loc.name);
    if (!info) return null;
    // A foolish item keeps its disguise until collected, wherever it was found (a shop or a hint
    // too): that is the joke.
    if (item === "Foolish Item") {
      const look = info.look !== undefined ? itemById.get(info.look) : foolishModel(loc);
      return look && look !== "Foolish Item" ? look : item;
    }
    // Shops, hints and NPCs name the item; only an item seen lying around is just its model.
    if (info.seen && !info.told && !info.shop) return LOOKS_LIKE.find(([re]) => re.test(item))?.[1] ?? item;
    return item;
  }

  // The randomizer's check name (mods/items.h prefixes) of a check, for the kinds whose metadata
  // gives it.
  function checkName(loc) {
    const first = (v) => (Array.isArray(v) ? v[0] : v);
    const m = loc.metadata;
    const f = first(m["Freestanding Item"]);
    if (f) return `freestanding:${STAGE_NAMES[f.Stage]}:${Number(f.Flag)}`;
    const shop = first(m.Shop);
    if (shop) return `shop:${STAGE_NAMES[shop.Stage]}:${Number(shop.Room)}:${Number(shop.Item)}`;
    const chest = first(m.Chest);
    if (chest) return `chest:${STAGE_NAMES[chest.Stage]}:${Number(chest["Tbox Id"])}`;
    const poe = first(m.Poe);
    if (poe) return `poe:${STAGE_NAMES[poe.Stage]}:${Number(poe.Flag)}`;
    const wolf = first(m["Golden Wolf"]);
    if (wolf) return `golden_wolf:${Number(wolf.Flag)}`;
    return null;
  }

  // The real item a foolish item is disguised as: picked from the seed hash and the check name.
  function foolishModel(loc) {
    const name = checkName(loc);
    if (!name || !seedHash) return null;
    const enc = new TextEncoder();
    const hash = crc32(enc.encode(name), crc32([0], crc32(enc.encode(seedHash))));
    return itemById.get(FOOLISH_MODELS[hash % FOOLISH_MODELS.length]) ?? null;
  }

  // Found checks from the mod's entries: location -> { told: item named, look: item id it looks
  // like (when the mod could tell) }, cached per entry list.
  let foundCache = { key: null, map: new Map() };
  function foundLocations() {
    const entries = state?.found?.entries ?? [];
    const key = entries.join("\n");
    if (foundCache.key === key) return foundCache.map;
    const map = new Map();
    const lower = new Map(locations.map((l) => [l.name.toLowerCase(), l.name]));
    const add = (name, info) => map.set(name, { ...map.get(name), ...info, told: map.get(name)?.told || info.told });
    for (const entry of entries) {
      const colon = entry.indexOf(":");
      const kind = entry.slice(0, colon);
      const value = entry.slice(colon + 1);
      if (kind === "loc") add(value, { shop: true });
      else if (kind === "told") add(value, { told: true });
      else if (kind === "hint") {
        // The hint names the location as its text calls it; match the location list by name.
        const v = value.toLowerCase();
        const name = lower.get(v) ?? (v.length >= 8 ? locations.find((l) => l.name.toLowerCase().includes(v))?.name : undefined);
        if (name) add(name, { told: true });
      } else if (kind === "check") {
        const [check, look] = value.split("\t");
        for (const name of checkLocations(check)) add(name, look ? { seen: true, look: parseInt(look, 16) } : { seen: true });
      }
    }
    foundCache = { key, map };
    return map;
  }

  // Item check names ("freestanding:<stage>:<bit>", "boss:<stage>") -> locations, from their metadata.
  function checkLocations(check) {
    const [type, stage, bit] = check.split(":");
    const flag = type === "boss" ? 0x9f : Number(bit);
    const out = [];
    for (const loc of locations) {
      const meta = loc.metadata["Freestanding Item"];
      const list = Array.isArray(meta) ? meta : meta ? [meta] : [];
      if (list.some((m) => STAGE_NAMES[m?.Stage] === stage && Number(m?.Flag) === flag)) out.push(loc.name);
    }
    return out;
  }

  // Entering a shop's room shows what each of its slots holds; entering some rooms has an NPC
  // name a check's item.
  function markSeenShops() {
    if (!spoiler || !state?.inGame) return;
    const known = new Set(state.found?.entries ?? []);
    const here = (s) => STAGE_NAMES[s?.Stage] === state.stage && Number(s?.Room) === state.room;
    const added = [];
    for (const loc of locations) {
      const shop = SHOP_ROOM[loc.name] ?? loc.metadata.Shop;
      const entries = Array.isArray(shop) ? shop : shop ? [shop] : [];
      if (!known.has(`loc:${loc.name}`) && entries.some(here)) added.push(`loc:${loc.name}`);
    }
    for (const t of TOLD_ON_ENTER) {
      if (!known.has(`told:${t.loc}`) && here({ Stage: t.stage, Room: t.room })) added.push(`told:${t.loc}`);
    }
    if (added.length) sendFound(added);
  }

  // Logic regions by province: the overworld files are one province each (Ordona, Faron, Eldin,
  // Lanayru, Gerudo Desert, Snowpeak, as the game numbers its regions), the dungeon files follow in
  // dungeon order. Within a province, regions keep the order they first appear in its file.
  function regionGroups(data) {
    // A dungeon's region can first appear in an overworld file (its entrance area, e.g. Snowpeak
    // Ruins in Snowpeak Province); dungeons always go to the Dungeons group.
    const dungeonRegions = new Set(DATA_FILES.filter((f) => f.startsWith("world/dungeons/"))
      .flatMap((f) => (data[f] ?? []).map((a) => a?.Region).filter(Boolean)));
    const seen = new Set();
    const groups = [];
    for (const f of DATA_FILES.filter((f) => f.startsWith("world/"))) {
      const title = f.startsWith("world/dungeons/") ? "Dungeons" : f.replace(/^.*\//, "").replace(/\.yaml$/, "").replace(/^Root$/, "Other");
      let group = groups.find((g) => g.title === title);
      for (const area of data[f] ?? []) {
        const r = area?.Region;
        if (!r || r === "None" || seen.has(r)) continue;
        if (dungeonRegions.has(r) && !f.startsWith("world/dungeons/")) continue;
        seen.add(r);
        if (!group) groups.push((group = { title, regions: [] }));
        group.regions.push(r);
      }
    }
    // Root holds only the start; anything there goes last.
    return [...groups.filter((g) => g.title !== "Other"), ...groups.filter((g) => g.title === "Other")];
  }

  // ---- Evaluation ----

  function evaluate() {
    results = new Map();
    search = null;
    if (!world || !state) return;
    const reader = new FlagReader(state.flags);
    if (!getLogic()) {
      // Logic off: only obtained / not obtained (e.g. entrance randomizer seeds).
      const marked = markedChecked();
      for (const loc of locations) {
        if (reader.ok && isObtained(loc, reader)) results.set(loc.name, "obtained");
        else if (marked.has(loc.name)) results.set(loc.name, "checked");
        else results.set(loc.name, excluded.has(loc.name) ? "excluded" : "unknown");
      }
      return;
    }
    const inv = itemsFromState(state);
    search = new Search(world, inv).run();
    const overrides = getOverrides();
    const marked = markedChecked();
    for (const loc of locations) {
      if (reader.ok && isObtained(loc, reader)) results.set(loc.name, "obtained");
      else if (marked.has(loc.name)) results.set(loc.name, "checked");
      else if (excluded.has(loc.name)) results.set(loc.name, "excluded");
      else {
        const custom = overrides[loc.name];
        const ok = custom ? custom.some((r) => routeSatisfied(search, r, entryContext())) : search.canReach(loc.name);
        results.set(loc.name, ok ? "reachable" : "blocked");
      }
    }
  }

  // Decides the time / setting / map / boss / seed-condition entries of custom routes.
  function entryContext() {
    return {
      test({ kind, name }) {
        if (kind === "time") return typeof state?.time?.night === "boolean" && state.time.night === (name === "Night");
        if (kind === "map") return getMapFlags().includes(name);
        if (kind === "flag") return flagOn(name);
        if (kind === "boss") return Boolean(state?.dungeons?.find((d) => d.name === name)?.bossDefeated);
        if (kind === "cond") return condOn(name);
        return false;
      },
    };
  }

  // "Setting" (an on/off setting, or a cleared twilight read from the save) or "Setting = Option".
  function flagOn(name) {
    const [setting, option] = name.split(" = ");
    if (option !== undefined) return world?.setting(setting) === option;
    const game = GAME_TWILIGHTS[name];
    if (game && state?.twilightCleared?.[game]) return true;
    return world?.setting(name) === "On";
  }

  function condOn(name) {
    const c = SEED_CONDITIONS[name];
    if (!c) return false;
    if (c.event !== undefined && new FlagReader(state?.flags).event(c.event)) return true;
    return Boolean(c.expr && search) && routeEntrySatisfied(search, { item: c.expr });
  }

  // Marks the region Link has just entered as reachable (hand marks stay as they are otherwise).
  function markCurrentRegion() {
    if (!state?.inGame || !world) return;
    const region = roomRegion(state.stage, state.room);
    if (!region || region === lastRegion) return;
    lastRegion = region;
    if (!getMapFlags().includes(region)) saveEntries([`map:${region}`]).then(() => { evaluate(); render(); });
  }

  function entryMet(entry) {
    return routeEntrySatisfied(search, entry, entryContext());
  }

  async function toggleMap(region) {
    await saveEntries([getMapFlags().includes(region) ? `-map:${region}` : `map:${region}`]);
    evaluate();
    render();
  }

  // A check marked checked by hand (a shop item not worth buying, an item seen but out of reach).
  async function toggleChecked(name) {
    await saveEntries([markedChecked().has(name) ? `-mark:${name}` : `mark:${name}`]);
    evaluate();
    render();
  }

  // ---- Rendering ----

  function counts(group) {
    let reachable = 0;
    let remaining = 0;
    let obtained = 0;
    for (const loc of locations) {
      if (group && groupOf(loc) !== group) continue;
      const r = results.get(loc.name);
      if (r === "reachable") reachable++;
      if (r === "reachable" || r === "blocked" || r === "unknown") remaining++;
      if (r === "obtained") obtained++;
    }
    return { reachable, remaining, obtained };
  }

  // "3 / 12" (reachable / remaining), or "12 left" with logic off.
  function countLabel(c) {
    return getLogic()
      ? [el("b", { className: "reach", textContent: String(c.reachable) }), ` / ${c.remaining}`]
      : [el("b", { textContent: String(c.remaining) }), " left"];
  }

  // A toolbar drop-down that stays open across redraws (the state updates every few seconds).
  function menu(id, label, title, ...items) {
    const details = el("details", { className: "loc-menu", open: openMenu === id },
      el("summary", { className: "tool", textContent: label, title }),
      el("div", { className: "loc-menu-items" }, ...items));
    details.addEventListener("toggle", () => {
      if (details.open) openMenu = id;
      else if (openMenu === id) openMenu = null;
      if (details.open) placeMenu(details);
    });
    if (details.open) requestAnimationFrame(() => placeMenu(details));
    return details;
  }

  // Opens a menu's list under its button, toward whichever side has room in the window.
  function placeMenu(details) {
    const items = details.querySelector(".loc-menu-items");
    if (!items) return;
    items.style.left = "0";
    items.style.right = "auto";
    if (items.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      items.style.left = "auto";
      items.style.right = "0";
    }
  }

  // Reachable regions: the logic regions by province, each marked reachable or not. Kept with the
  // game save; a region is marked when Link enters it. Map entries of custom requirements use them.
  function regionsMenu() {
    const on = new Set(getMapFlags());
    const inGame = Boolean(state?.inGame);
    const body = el("div", { className: "loc-regions" });
    body.append(el("p", { className: "loc-note", textContent: inGame
      ? "Marked when Link enters a region; kept with the game save. Used by Map entries of custom requirements."
      : "Load a save file to mark regions (the marks are kept with the save)." }));
    for (const g of mapGroups) {
      const count = g.regions.filter((r) => on.has(r)).length;
      const all = count === g.regions.length;
      body.append(el("div", { className: "loc-regions-head" },
        el("span", { textContent: g.title }),
        el("span", { className: "loc-count", textContent: `${count} / ${g.regions.length}` }),
        el("button", { type: "button", className: "tool rule-small", textContent: all ? "All off" : "All on", disabled: !inGame,
          onclick: async () => {
            await saveEntries(g.regions.filter((r) => on.has(r) === all).map((r) => (all ? `-map:${r}` : `map:${r}`)));
            evaluate();
            render();
          } })));
      for (const r of g.regions) {
        body.append(el("label", { className: "loc-toggle loc-region" },
          el("input", { type: "checkbox", checked: on.has(r), disabled: !inGame, onchange: () => toggleMap(r) }), ` ${r}`));
      }
    }
    body.addEventListener("scroll", () => { regionsScroll = body.scrollTop; });
    const details = menu("regions", "Reachable Regions ▾", "Map regions marked reachable", body);
    queueMicrotask(() => { body.scrollTop = regionsScroll; });
    return details;
  }

  // The marker left of a check. Clicking it marks a check you will not take (a shop item not worth
  // buying, an item seen but out of reach) as checked: it then shows the shop's red sold-out cross.
  function checkDot(name, r) {
    const can = Boolean(state?.inGame) && r !== "obtained";
    return el("span", {
      className: "loc-dot" + (can ? " clickable" : ""),
      title: !can ? "" : r === "checked" ? "Click: not checked any more" : "Click: mark as checked (kept with the game save)",
      onclick: can ? (e) => {
        e.stopPropagation();
        toggleChecked(name);
      } : null,
    });
  }

  // A check of the list: its marker (click: checked by hand), name, the item found there and its
  // custom tag. Click: highlight and requirement; right-click: highlight only; double-click: on
  // the map.
  function checkRow(loc, overrides) {
    const r = results.get(loc.name) ?? "unknown";
    const row = checkRowNode(loc, overrides, r);
    hoverRow(row, loc.name);
    return row;
  }
  function checkRowNode(loc, overrides, r) {
    return el("button", {
      type: "button",
      className: `loc-row plate ${r}` + (loc.name === focused ? " selected" : ""),
      title: { obtained: "Obtained", checked: "Marked as checked", reachable: "Reachable now", blocked: "Not reachable yet", excluded: "Excluded location", unknown: "Not obtained" }[r]
        + (clickMode() === "left-req" ? " · Click: requirement · Right-click: highlight" : " · Click: highlight · Right-click: requirement")
        + (showOnMap ? " · Double-click: show on the map" : ""),
      onclick: (e) => {
        // Done a moment later, so a double-click (the check on the map) is not taken by the
        // requirement panel opening over the row.
        if (e.detail > 1) return;
        clearTimeout(rowClickTimer);
        rowClickTimer = setTimeout(() => (clickMode() === "left-req" ? showRequirement(loc) : toggleHighlight(loc)), showOnMap ? 280 : 0);
      },
      oncontextmenu: (e) => {
        e.preventDefault();
        if (clickMode() === "left-req") toggleHighlight(loc);
        else showRequirement(loc);
      },
      ondblclick: showOnMap ? () => {
        clearTimeout(rowClickTimer);
        showOnMap(loc.name);
      } : null,
    }, checkDot(loc.name, r), el("span", { className: "loc-name", textContent: loc.name }),
    (() => {
      const item = foundItem(loc);
      return item ? el("span", { className: "loc-found", textContent: item, title: `Holds: ${item}` }) : null;
    })(),
    overrides[loc.name] ? el("span", { className: "loc-tag", textContent: "custom" }) : null);
  }

  // A check highlighted (again: no longer), and the map told (Checks and Map linked).
  function toggleHighlight(loc) {
    setFocus(focused === loc.name ? null : loc.name);
    onFocus(focused, false);
    render();
  }
  // A check highlighted with its requirement shown.
  function showRequirement(loc) {
    setFocus(loc.name);
    onFocus(loc.name, true);
    // Under the map while that is on screen (Checks + Map); otherwise the panel of the list.
    const host = editing?.host?.isConnected && editing.host.offsetParent !== null ? editing.host : null;
    if (host) mountDetail(host, loc.name, { row: editing.withRow });
    else openDetail(loc.name);
  }

  // The area a check is in: the logic region of the room the game places it in (or its shop's).
  function areaOf(loc) {
    const fixed = getCheckAreas()[loc.name];
    if (fixed) return fixed;
    const key = checkName(loc);
    const place = key ? placeOf(key) : null;
    if (place) return roomRegion(place.stage, place.room) ?? roomRegion(place.stage, 0) ?? place.stage;
    const first = (v) => (Array.isArray(v) ? v[0] : v);
    const shop = first(loc.metadata.Shop);
    if (shop) return roomRegion(STAGE_NAMES[shop.Stage], Number(shop.Room)) ?? "Elsewhere";
    return "Elsewhere";
  }

  // Shows a check's row and requirement in host (under the map), kept up to date.
  function mountDetail(host, name, { row = true } = {}) {
    closePopup();
    detailHost = host;
    const existing = getOverrides()[name];
    editing = { name, routes: existing ? structuredClone(existing) : null, edit: false, host, withRow: row };
    setFocus(name);
    render();
  }

  function render() {
    const toolbar = el("div", { className: "loc-toolbar" });
    if (loadError) {
      toolbar.append(el("span", { className: "loc-note bad" }, loadError), el("button", { className: "tool", type: "button", textContent: "Retry", onclick: () => { retries = 0; load(); } }));
      root.replaceChildren(toolbar);
      return;
    }
    if (!world) {
      root.replaceChildren(el("p", { className: "empty", textContent: "Loading logic data…" }));
      return;
    }
    const logic = getLogic();
    // Logic off (also when switched off on another page): back to game order.
    if (!logic && sortReachable) {
      sortReachable = false;
      remember("tracker.locSort", null);
    }
    const total = counts(null);
    const hide = el("label", { className: "loc-toggle" },
      el("input", { type: "checkbox", checked: hideObtained, onchange: (e) => {
        hideObtained = e.target.checked;
        try { localStorage.setItem("tracker.hideObtained", hideObtained ? "1" : "0"); } catch {}
        render();
      } }), " Hide obtained");
    const found = spoiler ? el("label", { className: "loc-toggle", title: "Show what each found check held: obtained, read in a hint, seen nearby, or in a shop you entered" },
      el("input", { type: "checkbox", checked: getSeedView().show, onchange: async (e) => {
        await saveSeedView({ ...getSeedView(), show: e.target.checked });
        render();
      } }), " Show found items") : null;
    const seedPicker = el("label", { className: "loc-seed", title: "Seed whose items are shown for found checks" },
      seeds.length
        ? el("select", {
          onchange: async (e) => {
            // Picking a seed also makes it the save's seed (stored with the next game save).
            await saveSeedView({ ...getSeedView(), hash: e.target.value || null });
            seedHash = e.target.value || seeds[0]?.hash || null;
            if (state?.found) state.found.seed = seedHash;
            if (state?.inGame) sendFound([]);
            load();
          },
        }, ...seeds.map((s) => el("option", { value: s.hash, textContent: s.hash, selected: s.hash === seedHash })))
        : el("span", { className: "loc-note", textContent: "No spoiler log found" }));
    const sort = el("label", { className: "loc-sort", title: logic ? "Order of the check list" : "Turn Logic on to sort by reachable" }, "Sort ",
      el("select", {
        disabled: !logic,
        onchange: (e) => {
          sortReachable = e.target.value === "reachable";
          remember("tracker.locSort", sortReachable ? "reachable" : null);
          render();
        },
      }, el("option", { value: "game", textContent: "Game order", selected: !sortReachable }),
      el("option", { value: "reachable", textContent: "Reachable first", selected: sortReachable })));
    const logicSwitch = el("button", {
      type: "button",
      className: "tool loc-logic-switch" + (logic ? " on" : ""),
      title: logic ? "Reachability is evaluated. Turn off to only track what was obtained." : "Only obtained / not obtained is shown.",
      onclick: async () => {
        await saveLogic(!logic);
        evaluate();
        render();
      },
    }, "Logic ", el("b", { textContent: logic ? "ON" : "OFF" }));
    const reqMenu = menu("req", "Requirements ▾", "Custom requirements",
      el("button", { className: "tool", type: "button", textContent: "Export Custom Requirements", onclick: exportOverrides }),
      el("label", { className: "tool" }, "Import Custom Requirements", el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: importOverrides })),
      el("button", { className: "tool", type: "button", textContent: "Load Preset Custom Requirements", onclick: loadPreset }),
      el("button", { className: "tool", type: "button", textContent: "Use Randomizer Logic for All", onclick: clearOverrides }));
    const seedMenu = menu("seed", "Seed ▾", "Seed used to show found items", seedPicker,
      el("button", { className: "tool", type: "button", textContent: "Reload Data", title: "Read the seeds' spoiler logs and the logic data again", onclick: load }));
    toolbar.append(
      el("div", { className: "loc-bar-row" },
        el("span", { className: "loc-summary" }, ...(logic
          ? [el("b", { className: "reach", textContent: String(total.reachable) }), " reachable · "]
          : [el("b", { textContent: String(total.obtained) }), " obtained · "]),
        el("b", { textContent: String(total.remaining) }), " remaining"),
        regionsMenu()),
      el("div", { className: "loc-bar-row" }, logicSwitch, reqMenu, seedMenu),
      el("div", { className: "loc-bar-row" }, sort, hide, found),
    );
    if (settingsNote && logic) toolbar.append(el("span", { className: "loc-note", textContent: settingsNote }));
    if (!state) toolbar.append(el("span", { className: "loc-note", textContent: "Waiting for the game…" }));

    const groups = el("div", { className: "loc-groups" });
    const shownGroups = locations.some((l) => l.group === OTHER_GROUP.name) ? [...REGION_GROUPS, OTHER_GROUP] : REGION_GROUPS;
    for (const g of shownGroups) {
      const c = counts(g.name);
      groups.append(el("button", {
        type: "button",
        className: "loc-group plate" + (g.name === (highlightedGroup ?? selectedGroup) ? " selected" : "") + (c.remaining === 0 ? " done" : ""),
        onclick: () => {
          // Left click: highlight and show this region's checks (opens them in the narrow layout).
          selectedGroup = g.name;
          highlightedGroup = g.name;
          remember("tracker.locMark", g.name);
          showChecks = true;
          try { localStorage.setItem("tracker.locGroup", g.name); } catch {}
          render();
        },
        // Right click: move the highlight only; the shown checks stay as they are.
        oncontextmenu: (e) => {
          e.preventDefault();
          highlightedGroup = g.name;
          remember("tracker.locMark", g.name);
          render();
        },
      }, el("span", { className: "loc-group-name", textContent: g.name }), el("span", { className: "loc-count" }, ...countLabel(c))));
    }

    const overrides = getOverrides();
    const list = el("div", { className: "loc-list" });
    // (The province of a check's Area when it was set by hand: filtered as changed.)
    let shown = locations.filter((l) => groupOf(l) === selectedGroup);
    // The logic regions of this province's checks, to show only one of them.

    // In the order of the randomizer's world files (about the order of the game), then by name.
    const regionRank = new Map(mapGroups.flatMap((g) => g.regions).map((r, i) => [r, i]));
    const rank = (r) => regionRank.get(r) ?? 1e6;
    const regionsHere = [...new Set(shown.map(regionOfLoc))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    if (regionFilter.group !== selectedGroup || !regionsHere.includes(regionFilter.region)) regionFilter = { group: selectedGroup, region: "" };
    if (regionFilter.region) shown = shown.filter((l) => regionOfLoc(l) === regionFilter.region);
    if (sortReachable) {
      // Stable: reachable first, then not yet known, blocked, excluded, done.
      const rank = { reachable: 0, unknown: 1, blocked: 2, excluded: 3, checked: 4, obtained: 5 };
      shown = shown.map((l, i) => [l, i]).sort(([a, i], [b, j]) =>
        (rank[results.get(a.name)] ?? 1) - (rank[results.get(b.name)] ?? 1) || i - j).map(([l]) => l);
    }
    const visibleLocs = shown.filter((loc) => {
      const r = results.get(loc.name) ?? "unknown";
      return !(hideObtained && (r === "obtained" || r === "checked"));
    });
    if (groupByArea) {
      // Areas in the order their first check comes.
      const areas = new Map();
      for (const loc of visibleLocs) {
        const area = areaOf(loc);
        if (!areas.has(area)) areas.set(area, []);
        areas.get(area).push(loc);
      }
      for (const [area, locs] of areas) {
        list.append(el("div", { className: "loc-subhead", textContent: area }));
        for (const loc of locs) list.append(checkRow(loc, overrides));
      }
    } else {
      for (const loc of visibleLocs) list.append(checkRow(loc, overrides));
    }
    if (!list.childElementCount) list.append(el("p", { className: "empty", textContent: "Nothing left here." }));

    const banner = el("div", { className: "loc-banner" },
      el("button", { type: "button", className: "loc-back", textContent: "‹ Back", onclick: () => { showChecks = false; render(); } }),
      el("span", { className: "loc-banner-title", textContent: selectedGroup }),
      el("span", { className: "loc-count" }, ...countLabel(counts(selectedGroup))),
      regionsHere.length > 1 ? el("select", { className: "loc-region-filter", title: "Show the checks of one region only",
        onchange: (e) => {
          regionFilter = { group: selectedGroup, region: e.target.value };
          render();
          if (e.target.value) onRegionPicked(e.target.value);
        } },
        el("option", { value: "", textContent: "All regions", selected: !regionFilter.region }),
        ...regionsHere.map((r) => el("option", { value: r, textContent: r, selected: r === regionFilter.region }))) : null,
      el("label", { className: "loc-by-area", title: "Group the checks by the area they are in (the places the map shows)" },
        el("input", { type: "checkbox", checked: groupByArea, onchange: (e) => {
          groupByArea = e.target.checked;
          remember("tracker.locByArea", groupByArea ? "1" : null);
          render();
        } }), "By area"));
    const checks = el("div", { className: "loc-checks" }, banner, list);
    const body = el("div", { className: "loc-body" + (showChecks ? " show-checks" : "") }, groups, checks);
    const searching = document.activeElement?.classList.contains("rule-search") && root.contains(document.activeElement);
    root.replaceChildren(toolbar, body);
    toolbarSize.disconnect();
    toolbarSize.observe(toolbar);
    if (editing && !editing.host) root.append(renderDetail());
    // The Map tab's place for a check: its row (as in the list) and its requirement panel.
    if (detailHost) {
      if (editing?.host === detailHost) {
        const loc = locations.find((l) => l.name === editing.name);
        const panel = renderDetail();
        panel.classList.add("embedded");
        detailHost.replaceChildren(...(loc && editing.withRow ? [checkRow(loc, overrides)] : []), panel);
        detailHost.hidden = false;
      } else {
        detailHost.replaceChildren();
        detailHost.hidden = true;
        detailHost = null;
      }
    }
    if (searching) root.querySelector(".rule-search")?.focus();
  }

  // ---- Custom requirement editor ----

  function remember(key, value) {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
  }

  function setFocus(name) {
    focused = name;
    remember("tracker.locFocus", name);
  }

  function openDetail(name) {
    closePopup();
    const existing = getOverrides()[name];
    editing = { name, routes: existing ? structuredClone(existing) : null, edit: false };
    render();
  }

  // Requirement tree: "and" parts side by side, "or" alternatives stacked, each atom framed.
  function renderReq(node) {
    if (node.t === "atom") {
      const entry = node.entry ?? { item: node.text, n: 1 };
      const met = search ? entryMet(entry) : null;
      const label = node.entry ? `${routeEntryLabel(entry.item)}${entry.n > 1 ? ` ×${entry.n}` : ""}` : atomLabel(node.text);
      const cls = "req-part" + (met === true ? " met" : met === false ? " unmet" : "");
      const special = node.entry ? trackerEntry(entry.item) : null;
      if (special?.kind === "map") {
        // Map entries are set by hand: clicking one switches that region for every check.
        return el("button", { type: "button", className: cls + " req-toggle", role: "checkbox", ariaChecked: String(Boolean(met)),
          title: met ? "Marked reachable — click to unmark this region" : "Click to mark this region reachable",
          onclick: () => toggleMap(special.name) }, mapCheck(met), label);
      }
      return el("span", { className: cls, title: met === false ? "Not met yet" : "", textContent: label });
    }
    const group = el("div", { className: `req-${node.t}` });
    node.args.forEach((arg, i) => {
      if (i) group.append(el("span", { className: "req-op", textContent: node.t }));
      group.append(renderReq(arg));
    });
    return group;
  }

  // Check box in front of Map entries, which are switched by hand.
  function mapCheck(on) {
    return el("span", { className: "req-check" + (on ? " on" : ""), ariaHidden: "true" });
  }

  // Routes (and nested Or groups) as a requirement tree for display.
  function routesTree(routes) {
    const part = (entry) => (Array.isArray(entry.or) ? routesTree(entry.or) : { t: "atom", entry });
    const and = (r) => (r.length === 1 ? part(r[0]) : { t: "and", args: r.map(part) });
    const nonEmpty = routes.filter((r) => r.length);
    if (nonEmpty.length < routes.length) return { t: "atom", text: "Nothing" };
    return nonEmpty.length === 1 ? and(nonEmpty[0]) : { t: "or", args: nonEmpty.map(and) };
  }

  function randomizerReq(access) {
    const parts = access.map((a) => el("div", { className: "req-access" },
      el("span", { className: "loc-area", textContent: `in ${a.area}` }), el("div", { className: "req-tree" }, renderReq(parseDisplay(a.source)))));
    if (!parts.length) return [el("p", { className: "loc-note", textContent: "Not in the logic graph." })];
    return parts.flatMap((p, i) => (i ? [el("div", { className: "req-op req-op-block", textContent: "or" }), p] : [p]));
  }

  // The province (group of the list) a check is listed under: the one of the area set for it by
  // hand (Area), else the randomizer's.
  function groupOf(loc) {
    const fixed = getCheckAreas()[loc.name];
    if (!fixed) return loc.group;
    const low = fixed.toLowerCase();
    const byName = (title) => REGION_GROUPS.find((g) => g.name.toLowerCase() === title.toLowerCase() || g.categories.some((c) => c.toLowerCase() === title.toLowerCase()));
    const direct = byName(low);
    if (direct) return direct.name;
    // The province most of that area's checks are in (an area's name rarely is a province's).
    const counted = areaProvinces().get(low);
    if (counted) return counted;
    const province = mapGroups.find((g) => g.regions.some((r) => r.toLowerCase() === low))?.title;
    return (province && byName(province)?.name) ?? loc.group;
  }
  // Each area (logic region, or the area a check's room is in) → the province (list group) most of
  // its checks are in, by the randomizer's grouping; "Other" only when nothing else is.
  let areaProvinceCache = null;
  function areaProvinces() {
    if (areaProvinceCache?.locations === locations && areaProvinceCache.world === world) return areaProvinceCache.map;
    const counts = new Map();
    const add = (area, group) => {
      if (!area || area === "Other" || area === "Elsewhere") return;
      const key = area.toLowerCase();
      if (!counts.has(key)) counts.set(key, new Map());
      const c = counts.get(key);
      c.set(group, (c.get(group) ?? 0) + (group === OTHER_GROUP.name ? 0.001 : 1));
    };
    const saved = getCheckAreas();
    for (const l of locations) {
      const accessArea = world?.locationAccess.get(l.name)?.[0]?.area;
      add(accessArea ? world.areas.get(accessArea)?.region : null, l.group);
      // (The room's area, without the one set by hand.)
      if (!saved[l.name]) add(areaOf(l), l.group);
    }
    const map = new Map([...counts].map(([area, c]) => [area, [...c].sort((a, b) => b[1] - a[1])[0][0]]));
    areaProvinceCache = { locations, world, map };
    return map;
  }

  // A check's status and requirement (under the map, and over a row the pointer rests on).
  // The region a check is listed under (set by hand, else its logic area's).
  function regionOfLoc(loc) {
    const fixed = getCheckAreas()[loc.name];
    if (fixed) return fixed;
    const area = world?.locationAccess.get(loc.name)?.[0]?.area;
    const region = area ? world.areas.get(area)?.region : null;
    return region && region !== "None" ? region : "Other";
  }

  function requirementPanel(name) {
    if (!world) return null;
    const status = results.get(name) ?? "unknown";
    const custom = getOverrides()[name];
    const access = world.locationAccess.get(name) ?? [];
    const panel = el("div", { className: "loc-req map-req-body" });
    panel.append(el("div", { className: "loc-detail-head" },
      el("h3", { textContent: name }),
      el("span", { className: `loc-status ${status}`, textContent: { obtained: "Obtained", checked: "Marked checked", reachable: "Reachable", blocked: "Not reachable", excluded: "Excluded", unknown: "Logic off" }[status] })));
    if (custom) {
      panel.append(el("h4", {}, "Requirement ", el("span", { className: "loc-tag", textContent: "custom" })),
        el("div", { className: "req-tree" }, renderReq(routesTree(custom))));
    } else {
      panel.append(el("h4", { textContent: "Requirement" }), ...randomizerReq(access));
    }
    return panel;
  }

  // Resting the pointer on a check's row shows its requirement beside it (no click needed).
  const hoverCapable = typeof matchMedia === "function" && matchMedia("(hover: hover)").matches;
  let hoverTimer = null;
  let hoverPop = null;
  function hideHover() {
    clearTimeout(hoverTimer);
    hoverPop?.remove();
    hoverPop = null;
  }
  function hoverRow(row, name) {
    if (!hoverCapable) return;
    row.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        if (!row.isConnected || editing?.name === name) return;
        const panel = requirementPanel(name);
        if (!panel) return;
        hideHover();
        hoverPop = el("div", { className: "loc-hover-req" }, panel);
        document.body.append(hoverPop);
        const r = row.getBoundingClientRect();
        const w = hoverPop.offsetWidth;
        const h = hoverPop.offsetHeight;
        const right = r.right + 8 + w <= innerWidth;
        const left = right ? r.right + 8 : Math.max(8, r.left - 8 - w);
        const top = Math.max(8, Math.min(innerHeight - h - 8, r.top));
        hoverPop.style.left = `${right || r.left - 8 - w >= 8 ? left : Math.max(8, r.left)}px`;
        hoverPop.style.top = `${right || r.left - 8 - w >= 8 ? top : Math.min(innerHeight - h - 8, r.bottom + 6)}px`;
      }, 350);
    });
    row.addEventListener("mouseleave", hideHover);
    row.addEventListener("mousedown", hideHover);
  }
  addEventListener("scroll", hideHover, { passive: true, capture: true });

  function renderDetail() {
    const { name } = editing;
    const status = results.get(name) ?? "unknown";
    const access = world.locationAccess.get(name) ?? [];
    const custom = getOverrides()[name];
    const panel = el("div", { className: "loc-detail" });
    panel.append(el("div", { className: "loc-detail-head" },
      el("h3", { textContent: name }),
      el("span", { className: `loc-status ${status}`, textContent: { obtained: "Obtained", checked: "Marked checked", reachable: "Reachable", blocked: "Not reachable", excluded: "Excluded", unknown: "Logic off" }[status] }),
      el("button", { className: "tool", type: "button", textContent: "Close", onclick: () => {
        const shown = editing?.host ? null : editing?.name;
        closePopup();
        editing = null;
        render();
        if (shown) onReqClosed(shown);
      } })));

    // The area the check is listed under (By area, the region filter): automatic, or set by hand
    // (people's and events' checks the game files do not place go to "Elsewhere").
    const loc = locations.find((l) => l.name === name);
    if (loc) {
      const auto = (() => {
        const saved = getCheckAreas()[name];
        if (!saved) return areaOf(loc);
        delete getCheckAreas()[name];
        const a = areaOf(loc);
        getCheckAreas()[name] = saved;
        return a;
      })();
      const choices = new Set();
      const sameProvince = (l) => l.group === loc.group || groupOf(l) === groupOf(loc);
      for (const l of locations) if (sameProvince(l)) choices.add(areaOf(l));
      // ... and the logic regions of the province's checks.
      for (const l of locations) {
        if (!sameProvince(l)) continue;
        const region = world.areas.get(world.locationAccess.get(l.name)?.[0]?.area)?.region;
        if (region && region !== "None") choices.add(region);
      }
      choices.delete("Elsewhere");
      const current = getCheckAreas()[name] ?? "";
      panel.append(el("label", { className: "loc-area-pick" }, "Area ",
        el("select", { onchange: (e) => { saveCheckArea(name, e.target.value || null); areaProvinceCache = null; render(); } },
          el("option", { value: "", textContent: `Automatic (${auto})`, selected: !current }),
          ...[...choices].sort().map((a) => el("option", { value: a, textContent: a, selected: a === current })))));
    }

    const req = el("div", { className: "loc-req" });
    if (editing.edit && !popup) {
      req.append(renderEditor());
    } else if (custom) {
      req.append(el("h4", {}, "Requirement ", el("span", { className: "loc-tag", textContent: "custom" })),
        el("div", { className: "req-tree" }, renderReq(routesTree(custom))),
        el("details", { className: "loc-rando" }, el("summary", { textContent: "Randomizer logic" }), ...randomizerReq(access)),
        editActions(custom));
    } else {
      req.append(el("h4", { textContent: "Requirement" }), ...randomizerReq(access), editActions(null));
    }
    panel.append(req);
    return panel;
  }

  function editActions(custom) {
    if (editing.edit && popup) {
      return el("div", { className: "loc-custom-actions" },
        el("span", { className: "loc-note", textContent: "Editing in the requirement window…" }),
        el("button", { className: "tool", type: "button", textContent: "Show window", onclick: () => popup?.focus() }));
    }
    return el("div", { className: "loc-custom-actions" },
      el("button", { className: "tool", type: "button", textContent: custom ? "Edit" : "Customize",
        title: "Replace the randomizer logic for this check with your own routes",
        onclick: () => startEdit(custom ? structuredClone(custom) : [[]]) }),
      custom ? el("button", { className: "tool", type: "button", textContent: "Use randomizer logic", onclick: () => save(null) }) : null);
  }

  // ---- Requirement editor (own window, or the panel where windows cannot open, e.g. OBS) ----

  function startEdit(routes) {
    Object.assign(editing, { routes, edit: true, target: routes[0], tab: "item", query: "" });
    popup = openPopup();
    if (popup) renderPopup();
    render();
  }

  function openPopup() {
    let w = null;
    try {
      // Centered on the screen.
      const width = Math.min(820, screen.availWidth);
      const height = Math.min(780, screen.availHeight);
      const left = (screen.availLeft ?? 0) + Math.round((screen.availWidth - width) / 2);
      const top = (screen.availTop ?? 0) + Math.round((screen.availHeight - height) / 2);
      w = window.open("", "tracker-requirement-editor", `popup,width=${width},height=${height},left=${left},top=${top}`);
      w?.moveTo(left, top); // a window reused from an earlier edit keeps its place otherwise
    } catch {}
    if (!w) return null;
    const d = w.document;
    d.open();
    d.write("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body class=\"rule-window\"></body></html>");
    d.close();
    d.title = `Requirement: ${editing.name}`;
    for (const css of ["style.css", "tp-ui.css"]) {
      d.head.append(Object.assign(d.createElement("link"), { rel: "stylesheet", href: new URL(css, location.href).href }));
    }
    d.body.dataset.theme = document.body.dataset.theme ?? "";
    // Closing the window cancels the edit.
    const watch = setInterval(() => {
      if (popup !== w) return clearInterval(watch);
      if (w.closed) {
        clearInterval(watch);
        popup = null;
        if (editing) editing.edit = false;
        render();
      }
    }, 400);
    return w;
  }

  function closePopup() {
    const w = popup;
    popup = null;
    if (w && !w.closed) w.close();
  }

  function renderPopup(focusSearch = false) {
    if (!popup || popup.closed) return;
    const editor = renderEditor();
    popup.document.body.replaceChildren(el("div", { className: "loc-detail rule-window-panel" }, editor));
    if (focusSearch) popup.document.querySelector(".rule-search")?.focus();
  }

  // Redraws the editor wherever it is shown.
  function redrawEditor(focusSearch = false) {
    if (popup) renderPopup(focusSearch);
    else {
      render();
      if (focusSearch) root.querySelector(".rule-search")?.focus();
    }
    const list = (popup?.document ?? root).querySelector(".rule-list");
    if (list) list.scrollTop = editing?.listScroll ?? 0;
  }

  function renderEditor() {
    const { name } = editing;
    const access = world.locationAccess.get(name) ?? [];
    const wrap = el("div", { className: "rule-editor" });
    wrap.append(el("div", { className: "loc-detail-head" },
      el("h3", { textContent: name }),
      el("button", { className: "tool", type: "button", textContent: "Cancel", onclick: cancelEdit }),
      el("button", { className: "tool primary", type: "button", textContent: "Save", onclick: () => save(editing.routes) })));

    // The requirement as it will look once saved, one framed row per route.
    const current = el("section", { className: "rule-frame rule-current" },
      el("h4", { textContent: "Custom requirement" }),
      el("p", { className: "loc-note", textContent: "Every part of a route is needed; any one route is enough. \"+ Or group\" adds a part that is met by any one of its options, e.g. A and (B or C). Click a route or option to add to it." }));
    editing.routes.forEach((route, ri) => {
      if (ri) current.append(el("div", { className: "req-op req-op-block", textContent: "or" }));
      current.append(renderAndList(route, `Route ${ri + 1}`, editing.routes.length > 1 ? () => editing.routes.splice(ri, 1) : null, "Remove route", editing.routes, ri));
    });
    current.append(el("button", { className: "tool", type: "button", textContent: "+ Route (or)",
      onclick: () => { editing.routes.push([]); editing.target = editing.routes.at(-1); redrawEditor(true); } }));

    wrap.append(current, renderPicker(),
      el("div", { className: "loc-custom-actions" },
        el("button", { className: "tool", type: "button", textContent: "Use randomizer logic", onclick: () => save(null) }),
        el("button", { className: "tool", type: "button", textContent: "Cancel", onclick: cancelEdit }),
        el("button", { className: "tool primary", type: "button", textContent: "Save", onclick: () => save(editing.routes) })),
      el("details", { className: "loc-rando" }, el("summary", { textContent: "Randomizer logic" }), ...randomizerReq(access)));
    return wrap;
  }

  // The list the picker adds to: a route or an option of an Or group, found again after edits.
  function targetList() {
    if (editing.target && findPath(editing.routes, editing.target)) return editing.target;
    editing.target = editing.routes[0];
    return editing.target;
  }

  // Where `list` sits, e.g. "Route 1 › Or group 1 › Option 2", or null.
  function findPath(routes, list, prefix = "Route") {
    for (let ri = 0; ri < routes.length; ri++) {
      const here = `${prefix} ${ri + 1}`;
      if (routes[ri] === list) return here;
      let g = 0;
      for (const entry of routes[ri]) {
        if (!Array.isArray(entry.or)) continue;
        const found = findPath(entry.or, list, `${here} › Or group ${++g} › Option`);
        if (found) return found;
      }
    }
    return null;
  }

  // ---- Drag and drop: parts move within or between routes/options; routes and options reorder
  // within their list (drag a row by its label). ----

  let drag = null; // { kind: "part", list, index } | { kind: "row", owner, index }

  // Whether `list` lies inside the Or group `group` (a group cannot be dropped into itself).
  function groupContains(group, list) {
    return group.or.some((option) => option === list || option.some((e) => Array.isArray(e.or) && groupContains(e, list)));
  }

  function canDropPart(list) {
    if (drag?.kind !== "part") return false;
    const entry = drag.list[drag.index];
    return !(Array.isArray(entry?.or) && groupContains(entry, list));
  }

  function movePart(list, index) {
    const [entry] = drag.list.splice(drag.index, 1);
    if (list === drag.list && index > drag.index) index--;
    list.splice(index, 0, entry);
    drag = null;
    redrawEditor();
  }

  function moveRow(owner, index) {
    const [row] = drag.owner.splice(drag.index, 1);
    if (index > drag.index) index--;
    owner.splice(index, 0, row);
    drag = null;
    redrawEditor();
  }

  // Drop handlers for an element: `accepts` decides, `apply` moves; the element is outlined while
  // something droppable is over it.
  function dropTarget(node, accepts, apply) {
    node.addEventListener("dragover", (e) => {
      if (!accepts()) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.add("drag-over");
    });
    node.addEventListener("dragleave", (e) => { e.stopPropagation(); node.classList.remove("drag-over"); });
    node.addEventListener("drop", (e) => {
      node.classList.remove("drag-over");
      if (!accepts()) return;
      e.preventDefault();
      e.stopPropagation();
      apply();
    });
    return node;
  }

  function draggable(node, start) {
    node.draggable = true;
    node.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      start();
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "requirement");
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => { node.classList.remove("dragging"); drag = null; });
    return node;
  }

  // Parts that are all needed (a route, or one option of an Or group), in one framed row.
  // owner/ownerIndex: the list of routes or options the row belongs to.
  function renderAndList(list, label, remove, removeLabel, owner, ownerIndex) {
    const active = list === targetList();
    const row = el("div", { className: "rule-route" + (active ? " active" : ""), title: active ? "" : "Click to add here",
      onclick: (e) => {
        e.stopPropagation();
        if (editing.target !== list) { editing.target = list; redrawEditor(true); }
      } },
    draggable(el("span", { className: "loc-route-label rule-handle", textContent: label, title: "Drag to reorder" }),
      () => { drag = { kind: "row", owner, index: ownerIndex }; }));
    // A part dropped on the row goes to its end; a row dropped on a row of the same list goes before it.
    dropTarget(row, () => canDropPart(list) || (drag?.kind === "row" && drag.owner === owner && drag.index !== ownerIndex),
      () => (drag.kind === "part" ? movePart(list, list.length) : moveRow(owner, ownerIndex)));
    const parts = el("div", { className: "req-and" });
    list.forEach((entry, ci) => {
      if (ci) parts.append(el("span", { className: "req-op", textContent: "and" }));
      const drop = (e) => { e.stopPropagation(); list.splice(ci, 1); redrawEditor(); };
      // Each part can be dragged, and a part dropped on it goes before it.
      const part = (node) => dropTarget(draggable(node, () => { drag = { kind: "part", list, index: ci }; }),
        () => canDropPart(list) && !(drag.list === list && drag.index === ci), () => movePart(list, ci));
      if (Array.isArray(entry.or)) {
        parts.append(part(renderOrGroup(entry, drop)));
        return;
      }
      const met = search ? entryMet(entry) : null;
      const map = trackerEntry(entry.item)?.kind === "map";
      parts.append(part(el("span", { className: "req-part" + (met === true ? " met" : met === false ? " unmet" : ""), title: met === false ? "Not met yet" : "Drag to move" },
        map ? mapCheck(met) : null,
        `${routeEntryLabel(entry.item)}${entry.n > 1 ? ` ×${entry.n}` : ""}`,
        el("button", { type: "button", className: "chip-x", textContent: "×", title: "Remove", onclick: drop }))));
    });
    if (!list.length) parts.append(el("span", { className: "loc-note", textContent: "(empty: always met)" }));
    row.append(parts, el("span", { className: "rule-route-tools" },
      el("button", { type: "button", className: "tool rule-small", textContent: "+ Or group", title: "Add a part met by any one of its options",
        onclick: (e) => {
          e.stopPropagation();
          const group = { or: [[], []] };
          list.push(group);
          editing.target = group.or[0];
          redrawEditor(true);
        } }),
      remove ? el("button", { type: "button", className: removeLabel === "×" ? "chip-x" : "tool rule-small", textContent: removeLabel,
        title: removeLabel === "×" ? "Remove this option" : "",
        onclick: (e) => { e.stopPropagation(); remove(); redrawEditor(); } }) : null));
    return row;
  }

  // A part met by any one of its options, framed inside the route.
  function renderOrGroup(group, drop) {
    const met = search ? entryMet(group) : null;
    const box = el("div", { className: "rule-orgroup" + (met === true ? " met" : "") },
      el("div", { className: "rule-orgroup-head" },
        el("span", { textContent: "Any one of" }),
        el("button", { type: "button", className: "chip-x", textContent: "×", title: "Remove this Or group", onclick: drop })));
    group.or.forEach((option, oi) => {
      if (oi) box.append(el("div", { className: "req-op", textContent: "or" }));
      box.append(renderAndList(option, `Option ${oi + 1}`, group.or.length > 1 ? () => group.or.splice(oi, 1) : null, "×", group.or, oi));
    });
    box.append(el("button", { type: "button", className: "tool rule-small", textContent: "+ Option (or)",
      onclick: (e) => { e.stopPropagation(); group.or.push([]); editing.target = group.or.at(-1); redrawEditor(true); } }));
    return box;
  }

  // Rows of the picker, grouped: [{ title, rows: [{ item, label, icon?, state? }] }]. icon is an
  // icon name (tracker icons, following the icon settings) or an image path; state is whether a
  // Time / Rand Settings / Map condition is currently on.
  function pickerGroups(tab) {
    if (tab === "time") {
      return [{ title: "Time of day", rows: ["Day", "Night"].map((t) => ({ item: `time:${t}`, label: t, src: `art/Time_${t}.svg`, state: entryMet({ item: `time:${t}` }) })) }];
    }
    if (tab === "flag") {
      return RANDO_FLAG_GROUPS.map((g) => ({ title: g.title, rows: g.flags.filter((f) => randoFlags.includes(f)).map((f) => ({ item: `flag:${f}`, label: f, state: flagOn(f) })) }));
    }
    if (tab === "map") {
      const on = new Set(getMapFlags());
      return mapGroups.map((g) => ({ title: g.title, rows: g.regions.map((r) => ({ item: `map:${r}`, label: r, state: on.has(r) })) }));
    }
    const pickable = new Set(pickableItems);
    if (tab === "dungeon") {
      // Keys, bosses and entrances, each in vanilla clear order.
      const keyOrder = (n) => (/Small Key$/.test(n) ? 0 : /Key Shard$/.test(n) ? 1 : /Bedroom Key$/.test(n) ? 2 : 3);
      const keys = DUNGEON_ORDER.flatMap((d) => pickableItems.filter((i) => isDungeonKey(i) && i.startsWith(`${d} `))
        .sort((a, b) => keyOrder(a) - keyOrder(b)))
        .map((i) => ({ item: i, label: i, icon: dungeonKeyIcon(i) }));
      const bosses = DUNGEON_ORDER.map((d) => ({ item: `boss:${d}`, label: `${BOSS_NAMES[d]} (${d})`, icon: DUNGEON_ICONS.bosses[d], state: entryMet({ item: `boss:${d}` }) }));
      const entrances = ENTRANCE_ENTRIES.filter((item) => {
        const { kind, name } = trackerEntry(item);
        if (kind !== "flag") return true;
        const [setting, option = "On"] = name.split(" = ");
        return world.settingOptions.get(setting)?.includes(option);
      }).map((item) => ({ item, label: routeEntryLabel(item), state: entryMet({ item }) }));
      return [{ title: "Keys", rows: keys }, { title: "Bosses", rows: bosses }, { title: "Entrance", rows: entrances }];
    }
    if (tab === "portal") {
      return [{ title: "Portals", rows: PORTALS.filter((p) => pickable.has(p)).map((p) => ({ item: p, label: p, icon: "Portal", state: (state?.items?.[p] ?? 0) > 0 })) }];
    }
    // Items: the tracker's sections in its order, then what no tile shows.
    const seen = new Set();
    const groups = [];
    for (const section of getLayoutSections()) {
      const rows = [];
      for (const tile of section.slots) {
        for (const [item, icon, itemId] of TILE_ITEMS[tile] ?? []) {
          if (!pickable.has(item) || seen.has(item)) continue;
          seen.add(item);
          rows.push({ item, label: item, icon, itemId });
        }
      }
      if (rows.length) groups.push({ title: section.title, rows });
    }
    const rest = pickableItems.filter((i) => !seen.has(i));
    for (const g of OTHER_ITEM_GROUPS) {
      const rows = rest.filter((i) => !seen.has(i) && g.match(i)).map((i) => {
        seen.add(i);
        return { item: i, label: i, icon: g.icon(i) };
      });
      if (rows.length) groups.push({ title: g.title, rows });
    }
    return groups;
  }

  function renderPicker() {
    const tab = editing.tab ?? "item";
    const route = targetList();
    const box = el("section", { className: "rule-frame rule-picker" },
      el("h4", { textContent: `Add to ${findPath(editing.routes, route)}` }));
    box.append(el("div", { className: "rule-tabs", role: "tablist" }, ...ENTRY_TABS.map(([key, label]) => el("button", {
      type: "button", role: "tab", className: "rule-tab" + (key === tab ? " selected" : ""), textContent: label,
      ariaSelected: String(key === tab),
      onclick: () => { editing.tab = key; editing.query = ""; editing.listScroll = 0; redrawEditor(true); },
    }))));
    const placeholder = ENTRY_TABS.find(([key]) => key === tab)[2];
    // The typed text survives redraws (e.g. a state update while the editor is in the panel).
    const input = el("input", { type: "search", className: "rule-search", placeholder, autocomplete: "off", spellcheck: false, value: editing.query ?? "" });
    const list = el("div", { className: "rule-list" + (["item", "dungeon", "portal", "time"].includes(tab) ? " with-icons" : "") });
    const groups = pickerGroups(tab);
    // Checked rows are in the route: clicking adds or removes them, with the count typed on the row.
    editing.counts ??= new Map(); // counts typed on rows not yet checked
    const maxOf = (item) => Math.max(1, itemMax.get(item) ?? 1);
    const toggle = (row) => {
      const at = route.findIndex((e) => e.item === row.item);
      if (at >= 0) route.splice(at, 1);
      else route.push({ item: row.item, n: Math.min(editing.counts.get(row.item) ?? 1, maxOf(row.item)) });
      redrawEditor();
    };
    // Count box for items the pool holds more than one of: 1..max, shown as "n / max".
    const countBox = (r, entry) => {
      const max = maxOf(r.item);
      if ((tab !== "item" && tab !== "dungeon") || max < 2) return null;
      const input = el("input", {
        type: "number", min: 1, max, step: 1, className: "rule-count", value: String(entry?.n ?? editing.counts.get(r.item) ?? 1),
        title: `How many are needed (1–${max})`, ariaLabel: `${r.label} count`,
        onclick: (e) => e.stopPropagation(),
        onkeydown: (e) => e.stopPropagation(),
        onchange: () => {
          const n = Math.max(1, Math.min(max, Math.round(Number(input.value)) || 1));
          input.value = String(n);
          editing.counts.set(r.item, n);
          if (entry) {
            entry.n = n;
            redrawEditor();
          }
        },
      });
      return el("span", { className: "rule-count-box" }, input, el("span", { textContent: `/ ${max}` }));
    };
    let first = null;
    const draw = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const query = words.join(" ");
      // Enter adds the best match: the exact name, then names starting with the text, then word starts.
      const rank = (label) => {
        const l = label.toLowerCase();
        if (l === query) return 0;
        if (l.startsWith(query)) return 1;
        return words.every((w) => l.split(/[\s'-]+/).some((part) => part.startsWith(w))) ? 2 : 3;
      };
      const inRoute = new Map(route.map((e) => [e.item, e]));
      first = null;
      let bestRank = 4;
      const nodes = [];
      for (const g of groups) {
        const rows = g.rows.filter((r) => words.every((w) => r.label.toLowerCase().includes(w)));
        if (!rows.length) continue;
        nodes.push(el("div", { className: "rule-group", textContent: g.title }));
        for (const r of rows) {
          const entry = inRoute.get(r.item);
          if (!entry && words.length && rank(r.label) < bestRank) {
            bestRank = rank(r.label);
            first = r;
          }
          const icon = r.icon !== undefined || r.src
            ? el("span", { className: "rule-icon" }, r.src ? el("img", { src: r.src, alt: "" }) : r.icon ? makeIcon(r.icon, r.itemId) : null)
            : null;
          nodes.push(el("div", {
            role: "checkbox", tabIndex: 0, ariaChecked: String(Boolean(entry)),
            className: "rule-row" + (entry ? " checked" : ""), title: entry ? "In this route — click to remove" : "Click to add to this route",
            onclick: () => toggle(r),
            onkeydown: (e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle(r);
              }
            },
          }, mapCheck(Boolean(entry)), icon, el("span", { className: "rule-label", textContent: r.label }), countBox(r, entry),
          r.state === undefined ? null : el("span", { className: "rule-state" + (r.state ? " on" : ""), textContent: r.state ? "ON" : "OFF" })));
        }
      }
      list.replaceChildren(...nodes);
      if (!nodes.length) list.append(el("span", { className: "loc-note", textContent: "No match." }));
    };
    input.addEventListener("input", () => { editing.query = input.value; draw(); list.scrollTop = 0; editing.listScroll = 0; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && first) {
        e.preventDefault();
        editing.query = "";
        editing.listScroll = 0;
        toggle(first);
        (popup?.document ?? document).querySelector(".rule-search")?.focus();
      }
    });
    draw();
    // Keep the list where it was scrolled to across redraws.
    list.addEventListener("scroll", () => { editing.listScroll = list.scrollTop; });
    box.append(el("div", { className: "rule-search-row" }, input), list);
    if (tab === "map") {
      box.append(el("p", { className: "loc-note" },
        "ON/OFF: whether the region is marked reachable (kept with the game save). A region is marked when you enter it in the game; switch them in Reachable Regions or with a Map entry of a check's requirement. ",
        el("button", { type: "button", className: "tool rule-small", textContent: "Unmark all", title: "For a new seed: clear every region mark",
          onclick: async () => {
            await saveEntries(getMapFlags().map((r) => `-map:${r}`));
            lastRegion = null;
            evaluate();
            render();
            redrawEditor();
          } })));
    }
    if (tab === "time") box.append(el("p", { className: "loc-note", textContent: "Met when the game's clock shows that time (night is 19:00–6:00)." }));
    return box;
  }

  function cancelEdit() {
    closePopup();
    openDetail(editing.name);
  }

  async function save(routes) {
    const next = { ...getOverrides() };
    if (routes) next[editing.name] = normalizeOverrides({ [editing.name]: routes })[editing.name] ?? [[]];
    else delete next[editing.name];
    await saveOverrides(next);
    closePopup();
    const name = editing.name;
    editing = null;
    evaluate();
    openDetail(name);
  }

  // ---- Copy and paste a check's custom requirement: Ctrl+C on the selected check, then select
  // another check and Ctrl+V (confirmed in a popup whose OK has the focus, so Enter pastes). ----

  let clipboard = null; // { from, routes }

  function toast(text) {
    // On the body: the tab re-renders on every state update.
    document.querySelector(".loc-toast")?.remove();
    const note = el("div", { className: "loc-toast", textContent: text, role: "status" });
    document.body.append(note);
    setTimeout(() => note.remove(), 2500);
  }

  function copyRequirement() {
    if (!focused) return toast("Select a check first (click it), then press Ctrl+C.");
    const routes = getOverrides()[focused];
    if (!routes) return toast(`${focused} uses the randomizer logic: nothing custom to copy.`);
    clipboard = { from: focused, routes: structuredClone(routes) };
    toast(`Copied the requirement of ${focused}.`);
  }

  function pasteRequirement() {
    if (!clipboard) return toast("Nothing copied yet: select a check with a custom requirement and press Ctrl+C.");
    if (!focused) return toast("Select the check to paste to (click it), then press Ctrl+V.");
    const target = focused;
    const replaces = Boolean(getOverrides()[target]);
    const close = () => backdrop.remove();
    const ok = el("button", { type: "button", className: "tool primary", textContent: "OK", onclick: async () => {
      close();
      await saveOverrides({ ...getOverrides(), [target]: structuredClone(clipboard.routes) });
      evaluate();
      render();
      toast(`Pasted to ${target}.`);
    } });
    const dialog = el("div", { className: "loc-modal", role: "dialog", ariaModal: "true", ariaLabel: "Paste requirement" },
      el("h3", { textContent: "Paste this requirement?" }),
      el("p", { className: "loc-note" }, "From ", el("b", { textContent: clipboard.from }), " to ", el("b", { textContent: target }),
        replaces ? " (replaces its current custom requirement)." : "."),
      el("div", { className: "req-tree" }, renderReq(routesTree(clipboard.routes))),
      el("div", { className: "loc-custom-actions" },
        el("button", { type: "button", className: "tool", textContent: "Cancel", onclick: close }), ok));
    const backdrop = el("div", { className: "loc-modal-backdrop", onclick: (e) => { if (e.target === backdrop) close(); } }, dialog);
    backdrop.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });
    document.body.append(backdrop);
    ok.focus(); // Enter confirms right away
  }

  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || root.closest("[hidden]") || !world) return;
    const key = e.key.toLowerCase();
    if (key !== "c" && key !== "v") return;
    // Leave text fields, text selections and an open dialog alone.
    const t = e.target;
    if (t?.closest?.("input, textarea, select, [contenteditable], .loc-modal-backdrop")) return;
    if (key === "c" && String(window.getSelection?.() ?? "")) return;
    e.preventDefault();
    if (key === "c") copyRequirement();
    else pasteRequirement();
  });

  // Drops every custom requirement: every check uses the randomizer logic again.
  function clearOverrides(e) {
    e.target.closest("details")?.removeAttribute("open");
    openMenu = null;
    const own = Object.keys(getOverrides()).length;
    if (!own) return toast("Every check already uses the randomizer logic.");
    const close = () => backdrop.remove();
    const ok = el("button", { type: "button", className: "tool primary", textContent: "Use Randomizer Logic", onclick: async () => {
      close();
      await saveOverrides({});
      evaluate();
      render();
      toast(`Removed ${own} custom requirements.`);
    } });
    const dialog = el("div", { className: "loc-modal", role: "dialog", ariaModal: "true", ariaLabel: "Use randomizer logic for all" },
      el("h3", { textContent: "Use the randomizer logic for every check?" }),
      el("p", { className: "loc-note", textContent: `This removes your ${own} custom requirements. Export them first (Export Custom Requirements) to keep a copy.` }),
      el("div", { className: "loc-custom-actions" },
        el("button", { type: "button", className: "tool", textContent: "Cancel", onclick: close }), ok));
    const backdrop = el("div", { className: "loc-modal-backdrop", onclick: (ev) => { if (ev.target === backdrop) close(); } }, dialog);
    backdrop.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });
    document.body.append(backdrop);
    // Cancel has the focus: Enter must not remove everything by accident.
    dialog.querySelector(".tool").focus();
  }

  // Custom requirements bundled with the mod: replace the current ones, or only fill in the checks
  // that have none.
  async function loadPreset(e) {
    e.target.closest("details")?.removeAttribute("open");
    openMenu = null;
    let preset;
    try {
      preset = await getPresetOverrides();
    } catch (err) {
      return setStatus("offline", `Could not load the preset (${err.message})`);
    }
    const current = getOverrides();
    const presetCount = Object.keys(preset).length;
    const own = Object.keys(current).length;
    const missing = Object.keys(preset).filter((name) => !current[name]).length;
    const close = () => backdrop.remove();
    const apply = (next, text) => async () => {
      close();
      await saveOverrides(next);
      evaluate();
      render();
      toast(text);
    };
    const replace = el("button", { type: "button", className: "tool primary", textContent: "Replace all",
      onclick: apply(structuredClone(preset), `Loaded the preset (${presetCount} checks).`) });
    const dialog = el("div", { className: "loc-modal", role: "dialog", ariaModal: "true", ariaLabel: "Load preset custom requirements" },
      el("h3", { textContent: "Load the preset custom requirements?" }),
      el("p", { className: "loc-note" }, `The preset has custom requirements for ${presetCount} checks. `,
        own ? `You have ${own} of your own; export them first (Export Custom Requirements) to keep a copy.` : "You have none of your own yet."),
      el("div", { className: "loc-custom-actions" },
        el("button", { type: "button", className: "tool", textContent: "Cancel", onclick: close }),
        own ? el("button", { type: "button", className: "tool", textContent: `Only add missing (${missing})`, disabled: !missing,
          onclick: apply({ ...structuredClone(preset), ...current }, `Added the preset to ${missing} checks.`) }) : null,
        replace));
    const backdrop = el("div", { className: "loc-modal-backdrop", onclick: (ev) => { if (ev.target === backdrop) close(); } }, dialog);
    backdrop.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        close();
      }
    });
    document.body.append(backdrop);
    replace.focus();
  }

  function exportOverrides() {
    const blob = new Blob([JSON.stringify({ version: 1, overrides: getOverrides() }, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "tracker-rules.json" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importOverrides(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      await saveOverrides(normalizeOverrides(parsed.overrides ?? parsed));
      evaluate();
      render();
    } catch (err) {
      setStatus("offline", `Could not import rules (${err.message})`);
    }
  }

  return {
    load,
    setState(next) {
      // Another save (or the title screen): its marks are its own.
      if (!next?.inGame || next.found?.seed !== state?.found?.seed) lastRegion = null;
      state = next;
      markCurrentRegion();
      markSeenShops();
      // A save of another seed was loaded: switch to it.
      const saved = next?.found?.seed;
      if (world && !loading && saved && saved !== seedHash && seeds.some((s) => s.hash === saved)) load();
      evaluate();
      render();
    },
    refresh() {
      // (The checks' places may be known now: areas' provinces counted again.)
      areaProvinceCache = null;
      evaluate();
      render();
    },
    // Logic region of a stage room (the Map tab's title), once the logic data is loaded.
    regionName: (stage, room) => roomRegion(stage, room),
    // The name of an interior, cave or grotto (null elsewhere).
    roomName: (stage, room) => roomName(stage, room),
    roomKind: (stage, room) => roomKind(stage, room),
    entrances: () => entranceList,
    // The provinces in the order of the randomizer's world files (the game's order).
    provinceOrder: () => mapGroups.map((g) => g.title),
    // Grottos built alike that share one room: [{ name, area }].
    roomVariants: (stage, room) => roomVariants(stage, room),
    // The region a check is listed under (its Area set by hand, else its logic region's).
    listedRegion(name) {
      const loc = locations.find((l) => l.name === name);
      return loc ? regionOfLoc(loc) : null;
    },
    // The logic region a check is in (its area's region), or null.
    checkRegion(name) {
      const area = world?.locationAccess.get(name)?.[0]?.area;
      const region = area ? world.areas.get(area)?.region : null;
      return region && region !== "None" ? region : null;
    },
    // A logic area's region, or null.
    areaRegion(area) {
      const region = world?.areas.get(area)?.region;
      return region && region !== "None" ? region : null;
    },
    // The checks of a logic area and the areas inside it (named after it).
    areaChecks(area) {
      const out = new Set();
      for (const [name, a] of world?.areas ?? []) {
        if (name === area || name.startsWith(area + " ")) for (const l of a.locations) out.add(l.name);
      }
      return out;
    },
    // The checks the Map tab can place, by the key the mod finds them under (chest:, freestanding:,
    // poe:; manual:<name> for those placed by hand): [{ name, key, status }] with the status of the marker left of the check.
    mapChecks() {
      const out = [];
      for (const loc of locations) {
        // Checks without a place in the game files (people, golden wolves, events) can be placed
        // on the map by hand.
        const key = checkName(loc) ?? `manual:${loc.name}`;
        out.push({ name: loc.name, key, status: results.get(loc.name) ?? "unknown" });
      }
      return out;
    },
    // A check's status and requirement, for showing under the map.
    requirementView: (name) => requirementPanel(name),
    focusedName: () => focused,
    // A check's row as in the list (its own buttons work; the caller may replace the row's clicks).
    rowFor(name) {
      const loc = locations.find((l) => l.name === name);
      return loc ? checkRow(loc, getOverrides()) : null;
    },
    // The province (the Reachable Regions group) of a logic region.
    provinceOf(region) {
      return mapGroups.find((g) => g.regions.includes(region))?.title ?? null;
    },
    // Highlight a check (null: none), as a right click in the list does.
    setFocused(name, reveal = false) {
      setFocus(name);
      render();
      // (Picked on the map with Checks and Map linked: its row brought into view.)
      if (reveal && name) requestAnimationFrame(() => root.querySelector(".loc-row.selected")?.scrollIntoView({ block: "nearest" }));
    },
    mountDetail,
    // Shows the checks of a region (the map's place, when Checks and Map are linked): its province
    // opened and the region filter set. Nothing changes when no check is in that region.
    showRegion(region) {
      if (!region || !world) return;
      const loc = locations.find((l) => regionOfLoc(l) === region);
      if (!loc) return;
      const group = groupOf(loc);
      if (selectedGroup === group && regionFilter.region === region) return;
      selectedGroup = group;
      highlightedGroup = group;
      regionFilter = { group, region };
      showChecks = true;
      render();
    },
    // Checks and Map linked: a check's requirement asked on the map, shown here too (its row
    // highlighted and brought into view); and closed from the map.
    showDetail(name) {
      setFocus(name);
      if (editing && !editing.host && editing.name === name) render();
      else openDetail(name);
      requestAnimationFrame(() => root.querySelector(".loc-row.selected")?.scrollIntoView({ block: "nearest" }));
    },
    closeDetail(name = null) {
      if (!editing || editing.host || (name && editing.name !== name)) return;
      closePopup();
      editing = null;
      render();
    },
    // Closes a check shown under the map.
    unmountDetail() {
      if (editing?.host) editing = null;
      render();
    },
    // Shows a check in the list: its region opened, the check highlighted and scrolled to, and (with
    // open) its requirement panel.
    jumpTo(name, open = false) {
      const loc = locations.find((l) => l.name === name);
      if (!loc) return;
      selectedGroup = groupOf(loc);
      highlightedGroup = selectedGroup;
      showChecks = true;
      setFocus(name);
      if (open) openDetail(name);
      else render();
      requestAnimationFrame(() => root.querySelector(".loc-row.selected")?.scrollIntoView({ block: "center", behavior: "smooth" }));
    },
  };
}

// Keeps only well-formed rules: { location: [route] }, a route being [{ item, n } | { or: [route] }].
// Or groups without options are dropped and one-option groups are merged into their route.
export function normalizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const routes = (list, depth) => list.filter(Array.isArray).map((r) => route(r, depth));
  const route = (r, depth) => r.flatMap((c) => {
    if (c && Array.isArray(c.or) && depth < 6) {
      const options = routes(c.or, depth + 1);
      if (!options.length) return [];
      return options.length === 1 ? options[0] : [{ or: options }];
    }
    return c && typeof c.item === "string" ? [{ item: c.item, n: Math.max(1, Math.min(99, Number(c.n) || 1)) }] : [];
  });
  for (const [loc, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    const clean = routes(list, 0);
    if (clean.length) out[loc] = clean;
  }
  return out;
}
