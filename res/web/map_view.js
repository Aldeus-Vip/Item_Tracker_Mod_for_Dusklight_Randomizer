// Map sub-tab of Locations: the map of the stage Link is in, drawn from the game's own map data
// (/map, read by the mod from the rooms the game has loaded), with Link on it (/map-player).
// The shapes are the game's: triangle strips over each room's x/z vertices, by floor; their type
// picks the color (floor, raised floor, water, lava, ...), as in the game's maps.

import { DUNGEON_ICONS } from "./layout.js";
import yaml from "./vendor/js-yaml.mjs";

const SVG = "http://www.w3.org/2000/svg";
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const PLAYER_MS = 250; // Link's position
const MAP_MS = 3000; // the map itself (switches, visited rooms) besides stage changes
const LEVELS = [1, 2, 4, 8]; // zoom steps; the indicator shows which one is on
const ZOOM_MS = 280;
const LEVEL_KEY = "dusklight-tracker.mapZoom";
const FOLLOW_KEY = "dusklight-tracker.mapFollow";
const FILTER_KEY = "dusklight-tracker.mapCheckFilter";
// The check statuses (the marker left of each check in Checks), as filters above the map.
const CHECK_STATUSES = [["reachable", "Reachable"], ["blocked", "Not reachable"], ["unknown", "Unknown"], ["checked", "Checked"], ["obtained", "Obtained"], ["excluded", "Excluded"]];
const FIELD_MS = 2000; // asking for the overworld map until the mod has read it
const VISITED_MS = 3000;
// The game's region numbers (field.dat): the provinces, as the map screen names them.
const PROVINCES = { 1: "Ordona Province", 2: "Faron Province", 3: "Eldin Province", 4: "Lanayru Province", 5: "Gerudo Desert", 6: "Snowpeak Province" };

// The map cursor: a ring of four ticks turning around a dot, like the game's map cursor (original).
const RETICLE = `<svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="map-reticle-ring" fill="none" stroke-linecap="round">
<circle r="13" stroke="#0a3a48" stroke-width="4" stroke-dasharray="12 8.42" stroke-dashoffset="6" opacity="0.6"/>
<circle r="13" stroke="#62e8ff" stroke-width="2.2" stroke-dasharray="12 8.42" stroke-dashoffset="6"/>
<path d="M0 -17v4M17 0h-4M0 17v-4M-17 0h4" stroke="#bff6ff" stroke-width="2.4"/></g>
<circle r="2.2" fill="#e8fdff"/></svg>`;

// The zoom arrows: a cream arrowhead with a notched back, pointing down (the up one is turned).
const ARROW = `<svg viewBox="0 0 24 20" aria-hidden="true"><defs><linearGradient id="map-zoom-arrow-fill" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fffbea"/><stop offset="0.6" stop-color="#f1e3bd"/><stop offset="1" stop-color="#cdb98a"/></linearGradient></defs>
<path d="M2 2.5 L12 18 L22 2.5 L12 7.5 Z" fill="url(#map-zoom-arrow-fill)" stroke="#3b2f18" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

// Door marks, drawn in a 24-unit box around the door (original art). Locks: a silver padlock for
// small key doors, a heavier one with a thick frame and gold trim for the big key door; each has
// a plain version for when the map is small. A barred door gets a red "no entry" sign.
const DOOR_DEFS = `<linearGradient id="mv-silver" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#d9dee4"/><stop offset="0.6" stop-color="#9aa4ae"/><stop offset="1" stop-color="#e3e7ec"/></linearGradient>
<linearGradient id="mv-shackle" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#8d969f"/><stop offset="0.45" stop-color="#f4f6f8"/><stop offset="1" stop-color="#7c858e"/></linearGradient>
<linearGradient id="mv-iron" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#f2f4f6"/><stop offset="0.4" stop-color="#b9c1c9"/><stop offset="0.7" stop-color="#6f7882"/><stop offset="1" stop-color="#c9cfd5"/></linearGradient>
<linearGradient id="mv-gold" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#fff2b0"/><stop offset="0.5" stop-color="#d9a93a"/><stop offset="1" stop-color="#8a5a12"/></linearGradient>`;
const LOCK_SMALL = {
  high: `<path d="M7.5 11V7.6a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="#2b3036" stroke-width="3.6"/>
<path d="M7.5 11V7.6a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="url(#mv-shackle)" stroke-width="2"/>
<rect x="4.5" y="10" width="15" height="11" rx="2.2" fill="url(#mv-silver)" stroke="#2b3036" stroke-width="1.2"/>
<path d="M6 11.6h12" stroke="#ffffff" stroke-width="0.8" opacity="0.8"/>
<circle cx="12" cy="14.6" r="1.7" fill="#2b3036"/><path d="M11.2 15.4h1.6l0.4 3h-2.4z" fill="#2b3036"/>`,
  low: `<path d="M7.5 11V7.4a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="#2b3036" stroke-width="4.4"/>
<path d="M7.5 11V7.4a4.5 4.5 0 0 1 9 0V11" fill="none" stroke="#e9edf1" stroke-width="2.4"/>
<rect x="4" y="10" width="16" height="11.5" rx="2" fill="#dfe4e9" stroke="#2b3036" stroke-width="1.8"/>
<rect x="10.6" y="13" width="2.8" height="5" rx="1" fill="#2b3036"/>`,
};
const LOCK_BIG = {
  high: `<path d="M6.8 10.5V6.8a5.2 5.2 0 0 1 10.4 0v3.7" fill="none" stroke="#1e2226" stroke-width="5"/>
<path d="M6.8 10.5V6.8a5.2 5.2 0 0 1 10.4 0v3.7" fill="none" stroke="url(#mv-shackle)" stroke-width="3"/>
<path d="M2.5 10.5h19l-1 11.5h-17z" fill="#1e2226"/>
<path d="M3.6 11.5h16.8l-0.9 9.6H4.5z" fill="url(#mv-gold)"/>
<path d="M5.4 12.9h13.2l-0.7 6.9H6.1z" fill="url(#mv-iron)" stroke="#1e2226" stroke-width="0.6"/>
<path d="M12 8.4l1.3 2.1h-2.6z" fill="url(#mv-gold)" stroke="#1e2226" stroke-width="0.5"/>
<circle cx="4.6" cy="12.5" r="0.8" fill="#fff2b0"/><circle cx="19.4" cy="12.5" r="0.8" fill="#fff2b0"/>
<circle cx="5.2" cy="20.3" r="0.8" fill="#fff2b0"/><circle cx="18.8" cy="20.3" r="0.8" fill="#fff2b0"/>
<path d="M12 13.9l1.6 1.6-1.6 1.6-1.6-1.6z" fill="#1e2226"/><path d="M11.4 16.6h1.2l0.4 2.2h-2z" fill="#1e2226"/>`,
  low: `<path d="M6.8 10.5V6.8a5.2 5.2 0 0 1 10.4 0v3.7" fill="none" stroke="#1e2226" stroke-width="5.4"/>
<path d="M6.8 10.5V6.8a5.2 5.2 0 0 1 10.4 0v3.7" fill="none" stroke="#e3e7ec" stroke-width="3"/>
<path d="M2.5 10h19l-1 12h-17z" fill="#1e2226"/>
<path d="M4 11.4h16l-0.8 9.2H4.8z" fill="#e2b546"/>
<path d="M6.2 13.2h11.6l-0.6 5.6H6.8z" fill="#dfe4e9"/>
<rect x="10.8" y="14" width="2.4" height="4.2" rx="0.8" fill="#1e2226"/>`,
};
const NO_ENTRY = `<circle cx="12" cy="12" r="9.5" fill="#fff4f0" stroke="#3a0c08" stroke-width="1.2"/>
<circle cx="12" cy="12" r="7.6" fill="none" stroke="#d8261b" stroke-width="3"/>
<path d="M6.8 17.2 L17.2 6.8" stroke="#d8261b" stroke-width="3" stroke-linecap="butt"/>`;
const DOOR_SIZE = 600; // the game's door square: 100 units scaled by 6

// Fill colors by shape type (the low 6 bits). Overworld maps are teal, dungeon maps green; a
// dungeon room is brighter while Link is in it; type 2 (pits and the like) and rooms not yet
// opened are black, as in the game.
const FIELD = { 0: "#2f8572", 1: "#56b39a", 2: "#3f9a84", 5: "#2f86e6", 8: "#7c2116" };
const DUNGEON = {
  on: { 0: "#1d7a2b", 1: "#3daa45", 2: "#0c0f0c", 5: "#2d6fd8", 8: "#5e0f0c" },
  stay: { 0: "#2ea83d", 1: "#68d863", 2: "#0c0f0c", 5: "#4a98ff", 8: "#82170f" },
  off: { 0: "#121612", 1: "#161c16", 2: "#0c0f0c", 5: "#111a26", 8: "#1c0d0b" },
};
const OUTLINE = { field: "#a6f0d8", dungeon: "#b8f5b0" };

// The check name an actor gives (as the mod's check_places.cpp reads them from the game files).
function actorCheckKey(stage, name, prm) {
  if (name.startsWith("tboxEL")) return `chest:${stage}:${(prm >>> 16) & 0xff}`;
  if (name.startsWith("tbox")) return `chest:${stage}:${(prm >>> 6) & 0x3f}`;
  if (["item", "witem", "htPiece", "htCase", "itemKey"].includes(name)) {
    const bit = (prm >>> 8) & 0xff;
    return bit === 0xff ? null : `freestanding:${stage}:${bit}`;
  }
  if (name === "E_hp" || name === "E_po") {
    const sw = (prm >>> 8) & 0xff;
    return sw === 0xff ? null : `poe:${stage}:${sw}`;
  }
  return null;
}

// The dungeon map screen's icons, by dTres type: [icon name, label].
const MAP_ICONS = {
  2: ["Map_Small_Key", "Small key"], 9: ["Map_Monkey", "Monkey"], 11: ["Map_Iron_Ball", "Iron ball"], 12: ["Map_Sol", "Sol"],
  13: ["Map_Yeto", "Yeto"], 14: ["Map_Yeta", "Yeta"], 15: ["Map_Statue", "Statue"], 16: ["Map_Ooccoo", "Ooccoo"],
};

// People by their actor names (d_stage.cpp's object table), for the map's markers.
const NPC_NAMES = {
  ins: "Agitha", Pouya: "Jovani", Doc: "Borville (doctor)", GWolf: "Golden wolf", Kn: "Hero's Shade", The: "Telma", TheB: "Telma",
  Seira: "Sera", Seira2: "Sera", Bou: "Bo", BouS: "Bo", Moi: "Rusl", MoiR: "Rusl", Uri: "Uli", Taro: "Talo", Maro: "Malo",
  sMaro: "Malo", Besu: "Beth", Kolin: "Colin", Kolinb: "Colin", Yelia: "Ilia", Zelda: "Zelda", Zant: "Zant", Rafrel: "Auru",
  Shad: "Shad", Ash: "Ashei", AshB: "Ashei", Saru: "Monkey", Post: "Postman", Hanjo: "Hanch", Jagar: "Jaggle", Gnd: "Ganondorf",
  Len: "Renado", Lud: "Luda", Bans: "Barnes", impal: "Impaz", Henna: "Hena", Henna0: "Hena", ykM: "Yeto", ykW: "Yeta",
  Seirei: "Light Spirit", FSeirei: "Great Fairy", Fairy: "Fairy", Shop0: "Shopkeeper", Coach: "Gengle",
  grA: "Goron", grC: "Goron", grD: "Goron", grD1: "Goron", grM: "Goron", grMC: "Goron", grO: "Goron", grR: "Goron", grS: "Goron", grZ: "Goron",
  zrA: "Zora", zrC: "Zora", zrD: "Zora", zrR: "Zora", zrS: "Zora", zrSP: "Zora", zrSPA: "Zora", zrWF: "Zora", zrZ: "Zora",
};
// Original glyphs for people and golden wolves on the map.
const PERSON_GLYPH = `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="6.5" r="3.4" fill="currentColor"/><path d="M3.5 18c0-4.2 2.9-7 6.5-7s6.5 2.8 6.5 7z" fill="currentColor"/></svg>`;
const WOLF_GLYPH = `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 3l3.5 4L10 5.5 13.5 7 17 3l-.6 7.2L10 18 3.6 10.2z" fill="currentColor"/><circle cx="7.6" cy="10" r="1" fill="#000"/><circle cx="12.4" cy="10" r="1" fill="#000"/></svg>`;

// The dungeons in the order of the story, with the land each is in (shown under the name).
const DUNGEON_STAGES = [
  ["Forest Temple", "D_MN05", "Faron Woods"],
  ["Goron Mines", "D_MN04", "Death Mountain"],
  ["Lakebed Temple", "D_MN01", "Lake Hylia"],
  ["Arbiters Grounds", "D_MN10", "Gerudo Desert"],
  ["Snowpeak Ruins", "D_MN11", "Snowpeak"],
  ["Temple of Time", "D_MN06", "Sacred Grove"],
  ["City in the Sky", "D_MN07", "Above Lake Hylia"],
  ["Palace of Twilight", "D_MN08", "Twilight Realm"],
  ["Hyrule Castle", "D_MN09", "Castle Town"],
];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

// A small gold emblem in the manner of the Twili markings (original art).
const EMBLEM = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1 23 12 12 23 1 12Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 6 18 12 12 18 6 12Z" fill="currentColor" opacity=".85"/><path d="M12 9.5 14.5 12 12 14.5 9.5 12Z" fill="#000" opacity=".55"/></svg>`;

// The twilight's drifting black squares over a list (a few, rising and fading).
function twilightMotes() {
  const box = el("div", { className: "twilight-motes", "aria-hidden": "true" });
  for (let i = 0; i < 16; i++) {
    const m = el("span", { className: "twilight-mote" });
    const size = 4 + ((i * 7) % 9);
    m.style.cssText = `left:${(i * 37) % 100}%; width:${size}px; height:${size}px; animation-delay:${-((i * 1.7) % 12)}s; animation-duration:${10 + ((i * 3) % 8)}s`;
    box.append(m);
  }
  return box;
}

const floorLabel = (n) => (n >= 0 ? `${n + 1}F` : `B${-n}`);

// A triangle strip as one path of triangles.
function stripPath(v, strip) {
  let d = "";
  for (let i = 2; i < strip.length; i++) {
    const a = strip[i - 2] * 2;
    const b = strip[i - 1] * 2;
    const c = strip[i] * 2;
    d += `M${v[a]} ${v[a + 1]}L${v[b]} ${v[b + 1]}L${v[c]} ${v[c + 1]}Z`;
  }
  return d;
}
// The area of a triangle strip.
function stripArea(v, strip) {
  let sum = 0;
  for (let i = 2; i < strip.length; i++) {
    const [a, b, c] = [strip[i - 2] * 2, strip[i - 1] * 2, strip[i] * 2];
    sum += Math.abs((v[b] - v[a]) * (v[c + 1] - v[a + 1]) - (v[c] - v[a]) * (v[b + 1] - v[a + 1])) / 2;
  }
  return sum;
}
const linePath = (v, strip) => strip.map((i, n) => `${n ? "L" : "M"}${v[i * 2]} ${v[i * 2 + 1]}`).join("");

/**
 * @param root    container element
 * @param options.getState     () => last state from the mod (for inGame)
 * @param options.regionName   (stage, room) => logic region name or null (the map's title)
 * @param options.roomName     (stage, room) => an interior's, cave's or grotto's name, or null
 * @param options.makeIcon     (name, className, fallbackText) => <img> of a tracker icon (follows the
 *                             icon settings; right-click opens the icon editor via data-icon)
 */
export function createMapView(root, { getState, regionName, roomName = null, makeIcon, checks: checkSource = null, onPlaces = null, provinceOf = () => null }) {
  let visible = false;
  let map = null; // last /map
  let player = null; // last /map-player
  let mapTime = 0;
  let mapText = "";
  let mapVersion = 0;
  let pickedFloor = null; // a floor chosen by hand, until Link changes floor or stage
  let lastStayFloor = null;
  let timer = null;
  let busy = false;
  // What is drawn: rebuilt only when this key changes; Link's arrow moves without a rebuild, so
  // clicks on the floor buttons are not lost to a redraw.
  let sceneKey = "";
  let scene = null; // { svg, link, frame, base, size, floor, rooms, doors, boss, dots, ... }
  // Zoom: a step of LEVELS, kept across stages (and page loads). The view (center and zoom) moves
  // smoothly toward its target; it follows the room Link is in.
  let level = loadLevel();
  let view = null; // { x, y, zoom } as drawn
  let anim = null;
  let viewStage = "";
  let followRoom = null; // the room the view was last centered on
  let lastPos = null; // Link's position when the view last followed him
  let manual = false; // moved or zoomed by hand since then
  let pressing = false; // a mouse button is down on the map
  // Following Link (the option beside the title): the view slides and zooms to his room, and when
  // he moves the map goes back to his floor and stage from any other one being looked at.
  let followOn = loadFollow();
  let seenPos = null; // Link's position at the last update
  // Zooming out of an overworld stage shows its province, then all of Hyrule (the game's map
  // screen), from /field-map: every field stage placed where the map screen puts it.
  let mode = "stage"; // "stage" | "region" | "world"
  let field = null; // /field-map once read
  let fieldTime = 0;
  let visited = null; // /field-map-visited
  let visitedTime = 0;
  // Checks on the map: which statuses are shown (the boxes above the map), and the check whose
  // requirement is shown under it.
  let checkFilter = loadCheckFilter();
  let reqName = null;
  // Where every check is (/check-places: read from the game files by the mod, once).
  let places = null;
  let placesTime = 0;
  let placeIndex = new Map(); // key -> { stage, room, x, y, z }
  const stageMaps = new Map(); // stage -> /stage-map/<stage> (or "loading" / "missing")
  let selectFilter = ""; // the Other tab's search
  // The randomizer's changes to the game's actors (object_patches.yaml): items it adds, and items
  // whose flag it changes (their check name changes with it). stage -> [{ room, from, key, x, y, z }]
  let patches = new Map();
  let patchesLoaded = false;
  let notice = null; // { text, until }

  function loadCheckFilter() {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY));
      if (Array.isArray(saved)) {
        const out = new Set(saved);
        if (!out.has("noicons")) out.add("icons");
        if (!out.has("nonpcs")) out.add("npcs");
        return out;
      }
    } catch { /* default */ }
    return new Set(["reachable", "blocked", "unknown", "icons", "npcs"]);
  }

  function loadFollow() {
    try { return localStorage.getItem(FOLLOW_KEY) !== "0"; } catch { return true; }
  }

  function loadLevel() {
    try {
      const n = Number(localStorage.getItem(LEVEL_KEY));
      return Number.isInteger(n) && n >= 0 && n < LEVELS.length ? n : 0;
    } catch {
      return 0;
    }
  }
  function saveLevel() {
    try { localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* not kept */ }
  }

  async function tick() {
    timer = null;
    if (!visible) return;
    if (!busy && getState()?.inGame) {
      busy = true;
      try {
        player = await (await fetch("map-player", { cache: "no-store" })).json();
        if (!player.loading && (!map || map.stage !== player.stage || Date.now() - mapTime > MAP_MS)) {
          const text = await (await fetch("map", { cache: "no-store" })).text();
          mapTime = Date.now();
          // Redrawn only when it changed (a switch, a visited room, a new stage).
          if (text !== mapText) {
            const next = JSON.parse(text);
            if (next.exists || !map || map.stage !== player.stage) {
              map = next;
              mapText = text;
              mapVersion++;
            }
          }
        }
        await fetchField();
        await fetchPlaces();
        if (player.stayFloor !== undefined && player.stayFloor !== lastStayFloor) {
          lastStayFloor = player.stayFloor;
          pickedFloor = null;
        }
        // Link moved while another floor, the province or Hyrule is shown: back to his map.
        const p = player.player;
        const movedNow = p && seenPos && Math.hypot(p.x - seenPos.x, p.z - seenPos.z) > 30;
        if (p) seenPos = { x: p.x, z: p.z };
        if (followOn && movedNow) {
          if (pickedFloor !== null) pickedFloor = null;
          if (mode !== "stage" && !anim) switchStage();
        }
        render();
      } catch {
        // The game is not running (or the mod is older): try again later.
      } finally {
        busy = false;
      }
    } else if (!getState()?.inGame) {
      render();
    }
    timer = setTimeout(tick, PLAYER_MS);
  }

  async function fetchField() {
    const now = Date.now();
    if (!field?.ready && !field?.error && now - fieldTime > FIELD_MS) {
      fieldTime = now;
      field = await (await fetch("field-map", { cache: "no-store" })).json();
    }
    if (field?.ready && (!visited || now - visitedTime > VISITED_MS)) {
      visitedTime = now;
      visited = await (await fetch("field-map-visited", { cache: "no-store" })).json();
    }
  }

  async function fetchPatches() {
    if (patchesLoaded) return;
    patchesLoaded = true;
    try {
      const res = await fetch("rando/object_patches.yaml", { cache: "no-store" });
      if (!res.ok) return;
      const data = yaml.load(await res.text()) ?? {};
      const out = new Map();
      for (const [stage, rooms] of Object.entries(data)) {
        for (const [room, actors] of Object.entries(rooms ?? {})) {
          for (const a of actors ?? []) {
            if (!a?.name || (a.action !== "add" && a.action !== "patch")) continue;
            const prm = Number(a.parameters);
            const from = a.action === "patch" ? actorCheckKey(stage, a.name, prm) : null;
            // A patch can turn an actor into another (golden bugs become heart-piece-like items).
            const key = a.action === "patch" ? actorCheckKey(stage, a.patch?.name ?? a.name, Number(a.patch?.parameters ?? prm)) : actorCheckKey(stage, a.name, prm);
            if (!key && !from) continue;
            const pos = a.patch?.position ?? a.position ?? {};
            if (!out.has(stage)) out.set(stage, []);
            out.get(stage).push({ room: Number(room), from, key, x: Number(pos.x), y: Number(pos.y), z: Number(pos.z) });
          }
        }
      }
      patches = out;
      sceneKey = "";
    } catch {
      // Without them, the game files' places are used as they are.
    }
  }

  // A stage's check places with the randomizer's changes: renamed ones take their new name, added
  // ones are added (their floor is the one of the place they replace, or unknown).
  function patchedChecks(stage, list) {
    const changes = patches.get(stage);
    if (!changes) return list;
    const out = list.map((c) => ({ ...c }));
    for (const ch of changes) {
      const old = ch.from ? out.find((c) => c.key === ch.from && c.room === ch.room) ?? out.find((c) => c.key === ch.from) : null;
      if (old) {
        if (ch.key) old.key = ch.key;
        else out.splice(out.indexOf(old), 1);
      } else if (ch.key && !out.some((c) => c.key === ch.key)) {
        out.push({ key: ch.key, room: ch.room, x: ch.x, z: ch.z, floor: undefined });
      }
    }
    return out;
  }

  // Checks placed on the map by hand (NPCs, golden wolves, events: no place in the game files):
  // the mod's presets (map_presets.json), and those placed in the page, kept in its settings
  // ({ [check name]: { stage, room, x, z, floor } }), which win. A preset can give its place in the
  // room's extent (u, v from 0 to 1, left to right and top to bottom) instead of x, z.
  let presets = {};
  fetch("map_presets.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      presets = j?.places ?? {};
      sceneKey = "";
      if (visible) render();
    })
    .catch(() => {});
  function userPlaces() {
    return checkSource?.manualPlaces?.() ?? {};
  }
  // A preset's x, z from its room's extent (once the stage's rooms are known).
  function resolvePreset(p) {
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) return p;
    const known = stageMaps.get(p.stage);
    const rooms = map?.stage === p.stage ? map.rooms : typeof known === "object" ? known?.rooms : null;
    const room = rooms?.find((r) => r.no === p.room);
    const b = room && roomBoxes([room], p.floor ?? 0).get(room.no);
    if (!b) return { ...p, x: undefined, z: undefined };
    return { ...p, x: b.x + (p.u - 0.5) * b.w, z: b.y + (p.v - 0.5) * b.h };
  }
  function manualPlaces() {
    const out = {};
    for (const [name, p] of Object.entries(presets)) out[name] = resolvePreset(p);
    return Object.assign(out, userPlaces());
  }
  function manualChecks(stage) {
    return Object.entries(manualPlaces()).filter(([, p]) => p.stage === stage && Number.isFinite(p.x))
      .map(([name, p]) => ({ key: `manual:${name}`, name, room: p.room ?? -1, x: p.x, z: p.z, floor: p.floor ?? 0 }));
  }
  // Whether the game files place a check (shops, golden wolves, people and events: not).
  function hasGamePlace(key) {
    if (placeIndex.has(key)) return true;
    for (const list of patches.values()) if (list.some((ch) => ch.key === key)) return true;
    return false;
  }
  // Where a check is: found in the game files or placed by hand.
  function placeFor(key, name = key.startsWith("manual:") ? key.slice(7) : null) {
    const game = placeIndex.get(key);
    if (game) return game;
    const p = name ? manualPlaces()[name] : null;
    return p ? { ...p, key } : null;
  }
  // A stage's checks: those of the game files (with the randomizer's changes) and those placed by
  // hand.
  function stageChecks(stage, list) {
    return [...patchedChecks(stage, list ?? []), ...manualChecks(stage)];
  }

  // The check being placed by hand: the next click on a map places it.
  let placing = null;
  function placeAt(at) {
    if (!placing || !scene || (scene.kind !== "stage" && scene.kind !== "area")) return false;
    const stage = scene.kind === "area" ? areaPlace?.name : map?.stage;
    if (!stage) return false;
    // Its room: the smallest drawn room around the point (none in a dungeon: floors tell them apart).
    let room = -1;
    if (!stage.startsWith("D_")) {
      let best = Infinity;
      for (const [no, b] of scene.rooms) {
        if (Math.abs(at.x - b.x) <= b.w / 2 && Math.abs(at.y - b.y) <= b.h / 2 && b.w * b.h < best) {
          best = b.w * b.h;
          room = no;
        }
      }
    }
    checkSource.setPlace(placing, { stage, room, x: Math.round(at.x), z: Math.round(at.y), floor: scene.floor ?? 0 });
    placing = null;
    sceneKey = "";
    render();
    updatePick(true);
    return true;
  }

  async function fetchPlaces() {
    await fetchPatches();
    if (places?.done || Date.now() - placesTime < FIELD_MS) return;
    placesTime = Date.now();
    places = await (await fetch("check-places", { cache: "no-store" })).json();
    if (places.done) {
      placeIndex = new Map();
      for (const [stage, list] of Object.entries(places.stages ?? {})) {
        for (const p of list) placeIndex.set(p.key, { stage, ...p });
      }
      // The check list can group by area now; the map's area views get their checks.
      onPlaces?.();
      if (scene?.kind === "area") sceneKey = "";
    }
    updateProgress();
  }

  // While the mod reads the game files for the checks' places: a bar over the map.
  function progressBar() {
    const bar = el("div", { className: "map-progress", hidden: true }, el("span", { className: "map-progress-fill" }), el("span", { className: "map-progress-text" }));
    return bar;
  }
  function updateProgress() {
    const bar = root.querySelector(".map-progress");
    if (!bar) return;
    const reading = places && !places.done && places.total > 0;
    bar.hidden = !reading;
    if (!reading) return;
    bar.querySelector(".map-progress-fill").style.width = `${Math.round((places.read / places.total) * 100)}%`;
    bar.querySelector(".map-progress-text").textContent = `Finding the checks in the game files… ${places.read} / ${places.total}`;
  }

  // Shows a check of the check list on the map (double-click in Checks): its map, centered on it,
  // highlighted, with its details under the map.
  function showCheck(name) {
    const info = checkSource?.list().find((c) => c.name === name);
    if (!info) return;
    const known = placeFor(info.key, info.name);
    const byHand = !placeIndex.has(info.key) && !!manualPlaces()[info.name];
    const stageName = byHand ? known.stage : info.key.startsWith("manual:") ? null : info.key.split(":")[1];
    reqName = name;
    checkSource.setFocused(name);
    const center = (x, z) => {
      level = Math.max(level, 2);
      saveLevel();
      manual = true;
      goTo({ zoom: LEVELS[level], x, y: z });
    };
    if (!stageName) {
      updatePick(true);
      showReq();
      return;
    }
    const here = map?.exists && map.stage === stageName ? stageChecks(map.stage, map.checks).find((c) => (c.name ? c.name === info.name : c.key === info.key)) : null;
    // A house of the stage Link is in, but not his: shown on its own.
    const otherRoom = here && isInterior(stageName) && here.room >= 0 && here.room !== player?.stayRoom;
    if (map?.exists && map.stage === stageName && !otherRoom) {
      if (mode !== "stage") switchStage();
      const p = here;
      if (p && map.stage.startsWith("D_") && p.floor !== undefined) pickedFloor = p.floor === player?.stayFloor ? null : p.floor;
      render();
      if (p) center(p.x, p.z);
      updatePick(true);
      showReq();
      return;
    }
    if (here === null && byHand && map?.exists && map.stage === stageName && !isInterior(stageName)) {
      if (mode !== "stage") switchStage();
      render();
      updatePick(true);
      showReq();
      return;
    }
    // Another place: its map from the overworld map data, when it is there.
    const p = known;
    let found = null;
    for (const region of field?.regions ?? []) {
      for (const stage of region.stages) {
        if (stage.name !== stageName) continue;
        if (!found || (p && stage.rooms.some((r) => r.no === p.room))) found = { region, stage };
      }
    }
    const pick = () => {
      updatePick(true);
      showReq();
    };
    if (found && p) {
      openRemote({ region: found.region, stage: found.stage, back: "region" });
      center(p.x, p.z);
      return pick();
    }
    if (p && (places?.maps ?? []).includes(stageName)) {
      const one = isInterior(stageName) && p.room >= 0;
      openRemote({ name: stageName, back: DUNGEON_STAGES.some(([, st]) => st === stageName) ? "dungeons" : "other",
        ...(one ? { rooms: [p.room], title: roomTitle(stageName, p.room) } : {}) });
      if (stageName.startsWith("D_") && p.floor !== undefined) {
        areaFloor = p.floor;
        sceneKey = "";
        render();
      }
      // The map may still be loading: center once it is drawn.
      let tries = 0;
      const later = () => {
        const now = byHand ? placeFor(info.key, info.name) : p;
        if (scene?.kind === "area" && Number.isFinite(now?.x)) return center(now.x, now.z);
        if (++tries < 25) setTimeout(later, 200);
      };
      later();
      return pick();
    }
    pick();
    showNotice(`${name} is in another place (${stageName}); its map shows here when Link is there.`);
  }

  function setVisible(on) {
    visible = on;
    if (on && !timer) tick();
    if (on && scene) requestAnimationFrame(() => scene && applyView());
  }

  // Rooms the game would draw: every room on the overworld; in a dungeon the visited ones, Link's,
  // and all of them once the dungeon map is found.
  // As the game's map (renderingDAmap_c::isDrawRoom): Link's room; in a dungeon also every room
  // once its map is found; and visited rooms, except on stages whose map shows one room at a time
  // (Lake Hylia, Lanayru Spring...).
  function drawnRooms(dungeon) {
    return map.rooms.filter((r) => r.no === player?.stayRoom || (dungeon && map.hasMap) || (!map.singleRoom && r.visited));
  }

  function message(text) {
    sceneKey = "";
    scene = null;
    root.replaceChildren(el("p", { className: "empty", textContent: text }));
  }

  function render() {
    if (!visible) return;
    if (!getState()?.inGame) return message("Waiting for a save file…");
    if (!map || !player) return message("Loading the map…");
    if (mode === "dungeons" || mode === "other") return renderSelect();
    if (mode === "area" && areaPlace) return renderArea();
    if (mode === "world" || mode === "region") {
      if (field?.ready) return renderField();
      mode = "stage";
    }
    if (!map.exists) return message("This place has no map.");
    const dungeon = map.stage.startsWith("D_");
    let rooms = drawnRooms(dungeon);
    let extent = map.rooms;
    // The overworld: only the rooms of the place Link is in, as the map screen splits them (Hyrule
    // Field by province; Lake Hylia and Lanayru Spring, one stage with two places).
    if (!dungeon && map.singleRoom) extent = rooms;
    // Houses, caves, grottos: one stage holds many of them in the same coordinates, so only the
    // room Link is in.
    const interior = !dungeon && isInterior(map.stage);
    if (interior) {
      const mine = map.rooms.filter((r) => r.no === player.stayRoom);
      if (mine.length) rooms = extent = mine;
    }
    if (!dungeon && !interior && !map.singleRoom) {
      const place = fieldPlace();
      const nos = place && new Set(place.stage.rooms.map((r) => r.no));
      const mine = nos ? map.rooms.filter((r) => nos.has(r.no)) : [];
      if (mine.length) {
        rooms = rooms.filter((r) => nos.has(r.no));
        extent = mine;
      }
    }
    const floors = [...new Set(rooms.flatMap((r) => r.floors.map((f) => f.no)))].sort((a, b) => b - a);
    const floor = pickedFloor ?? player.stayFloor ?? floors[floors.length - 1] ?? 0;
    const title = (isInterior(map.stage) ? roomTitle(map.stage, map.stayRoom) : regionName(map.stage, map.stayRoom)) ?? map.stage;
    const d = dungeon ? findDungeon(title) : null;
    const items = getState()?.items ?? {};
    const key = JSON.stringify(["stage", mapVersion, map.stage, floor, player.stayRoom, player.stayFloor, player.wolf, title,
      d, d?.name === "Goron Mines" ? items["Goron Mines Key Shard"] : 0]);
    if (key !== sceneKey) {
      sceneKey = key;
      if (viewStage !== map.stage) {
        viewStage = map.stage;
        view = null;
        followRoom = null;
        lastPos = null;
      } else if (scene && scene.kind !== "stage") {
        view = null;
      }
      build(dungeon, rooms, floors, floor, title, d, extent, mapCaption(map.stage, interior ? [player.stayRoom] : rooms.map((r) => r.no)));
    }
    placeLink();
    updateDoors();
    updateChecks();
    follow();
  }

  // Whether a stage is a house, a cave, a grotto...: neither a dungeon nor on the overworld.
  function isInterior(stage) {
    if (stage.startsWith("D_")) return false;
    if (field?.ready) return !field.regions.some((r) => r.stages.some((st) => st.name === stage));
    return !stage.startsWith("F_");
  }

  // The map loaded, for people (under the map): its stage and rooms.
  function mapCaption(stage, rooms) {
    const nos = [...new Set(rooms)].filter((n) => n >= 0).sort((a, b) => a - b);
    if (!nos.length) return `Map: ${stage}`;
    if (nos.length > 4) return `Map: ${stage} · ${nos.length} rooms`;
    return `Map: ${stage} · room${nos.length > 1 ? "s" : ""} ${nos.join(", ")}`;
  }

  // Each room's extent on the floor shown (or on any floor when it has nothing there).
  function roomBoxes(rooms, floor) {
    const boxes = new Map();
    for (const room of rooms) {
      const v = room.vertices;
      const measure = (onFloor) => {
        const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
        for (const f of room.floors) {
          if (onFloor && f.no !== floor) continue;
          for (const g of f.groups) {
            if (!g.shown) continue;
            for (const p of g.polys) {
              if (p.type & 0x80) continue;
              for (const i of p.strip) {
                b.minX = Math.min(b.minX, v[i * 2]); b.maxX = Math.max(b.maxX, v[i * 2]);
                b.minZ = Math.min(b.minZ, v[i * 2 + 1]); b.maxZ = Math.max(b.maxZ, v[i * 2 + 1]);
              }
            }
          }
        }
        return b.minX === Infinity ? null : b;
      };
      const b = measure(true) ?? measure(false);
      if (b) boxes.set(room.no, { x: (b.minX + b.maxX) / 2, y: (b.minZ + b.maxZ) / 2, w: b.maxX - b.minX, h: b.maxZ - b.minZ });
    }
    return boxes;
  }

  function build(dungeon, rooms, floors, floor, title, d, extent = rooms, caption = null) {
    // Frame the whole stage (every room and floor, also those not visited yet), so the map keeps
    // its scale as rooms are found and floors change.
    const remote = !!map.area;
    const linkFloor = remote ? null : player.stayFloor;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const room of extent) {
      const v = room.vertices;
      for (const f of room.floors) for (const g of f.groups) {
        if (!g.shown) continue;
        for (const p of g.polys) {
          if (p.type & 0x80) continue;
          for (const i of p.strip) {
            minX = Math.min(minX, v[i * 2]); maxX = Math.max(maxX, v[i * 2]);
            minZ = Math.min(minZ, v[i * 2 + 1]); maxZ = Math.max(maxZ, v[i * 2 + 1]);
          }
        }
      }
    }
    if (minX === Infinity) ({ minX, maxX, minZ, maxZ } = map.bounds);
    const size = Math.max(maxX - minX, maxZ - minZ, 1);
    const pad = size * 0.06;
    const base = { x: minX - pad, y: minZ - pad, w: maxX - minX + pad * 2, h: maxZ - minZ + pad * 2 };

    const drawing = svg("svg", { class: "map-svg", preserveAspectRatio: "xMidYMid meet" });
    const defs = svg("defs");
    defs.innerHTML = DOOR_DEFS;
    const shapes = svg("g", { class: "map-shapes" });
    const stay = svg("g", { class: "map-shapes map-stay" });
    const outlines = svg("g", { class: "map-outlines" });
    for (const room of rooms) {
      const v = room.vertices;
      const here = !remote && room.no === player.stayRoom;
      const palette = dungeon ? DUNGEON[here ? "stay" : room.visited ? "on" : "off"] : FIELD;
      for (const f of room.floors) {
        if (f.no !== floor) continue;
        for (const g of f.groups) {
          if (!g.shown) continue;
          for (const p of g.polys) {
            if (p.type & 0x80) continue;
            const color = palette[p.type & 0x3f] ?? palette[0];
            (here && dungeon ? stay : shapes).append(svg("path", { d: stripPath(v, p.strip), fill: color, stroke: color, "stroke-width": size / 600, "stroke-linejoin": "round" }));
          }
          for (const l of g.lines) {
            // Only the outlines the game draws at its normal zoom (width 1-2).
            if (l.type & 0x80 || l.width < 1 || l.width > 2) continue;
            outlines.append(svg("path", { d: linePath(v, l.strip), class: `map-line w${l.width}`, stroke: OUTLINE[dungeon ? "dungeon" : "field"] }));
          }
        }
      }
    }
    const doors = dungeon ? buildDoors(rooms, floor) : [];
    // Squares first, then every door's signs above all squares (and below Link).
    const doorLayer = svg("g", { class: "map-doors" });
    doorLayer.append(...doors.map((x) => x.node));
    const doorMarks = svg("g", { class: "map-doors map-door-marks" });
    doorMarks.append(...doors.map((x) => x.markNode));
    const link = svg("polygon", { class: "map-link" });
    drawing.append(defs, shapes, stay, outlines, doorLayer, doorMarks, link);

    // Floors, top first, as in the game: Link's face (or the wolf's) beside his floor, outside the
    // button so every floor label lines up.
    const linkIcon = player.wolf ? ["Map_Wolf", "Wolf Link (map)"] : ["Map_Link", "Link (map)"];
    const floorButtons = dungeon && floors.length > 1 ? el("div", { className: "map-floors" + (floors.length >= 4 ? " compact" : "") },
      ...floors.map((n) => el("div", { className: "map-floor-row" },
        el("span", { className: "map-floor-marker" }, n === linkFloor ? iconSlot(...linkIcon, "map-floor-face", "◆") : null),
        el("button", {
          type: "button",
          className: "map-floor" + (n === floor ? " selected" : ""),
          title: n === linkFloor ? "Link is on this floor" : `Show ${floorLabel(n)}`,
          textContent: floorLabel(n),
          onclick: () => {
            if (remote) {
              areaFloor = n;
              sceneKey = "";
            } else {
              pickedFloor = n === player.stayFloor ? null : n;
            }
            render();
          },
        })))) : null;
    const reticle = el("div", { className: "map-reticle", hidden: true });
    reticle.innerHTML = RETICLE;
    const overlay = el("div", { className: "map-overlay" });
    const boss = d ? bossMark(d, rooms, floor) : null;
    if (boss) overlay.append(boss.node);
    const checks = buildChecks(dungeon && floors.length > 1 ? floor : null, new Set(rooms.map((r) => r.no)));
    const icons = buildIcons(rooms, dungeon && floors.length > 1 ? floor : null);
    overlay.append(...icons.map((c) => c.node), ...checks.map((c) => c.node));
    const frame = el("div", { className: "map-frame " + (dungeon ? "parchment" : "field"), title: "Click: zoom in · Right-click: zoom out · Drag: move" }, drawing, overlay, reticle);
    const zoomBar = zoomIndicator();
    scene = { kind: "stage", svg: drawing, link, frame, base, size, floor, rooms: roomBoxes(rooms, floor), doors, boss, checks, icons, zoomBar, offset: { x: 0, z: 0 } };
    bindFrame(frame, reticle);
    root.replaceChildren(el("div", { className: "map-pane" + (floorButtons ? " has-floors" : "") + (d ? " has-items" : "") },
      ...paneTop(title),
      el("div", { className: "map-layout" },
        floorButtons,
        el("div", { className: "map-stage" }, frame, zoomBar.node, detailPop()),
        d ? dungeonItems(d) : null),
      caption ? el("div", { className: "map-caption", textContent: caption }) : null,
      checkSource ? checkNote() : null,
      noticeBox()));
    if (view) view = clampView(view);
    applyView();
    updateProgress();
    updatePick(true);
  }

  // ---- Above the map: the title, the progress of reading the game files, the check picked on the
  // map, and the tabs (Field, Dungeons, Other) and the check filter ----

  function paneTop(title) {
    return [titleBar(title), progressBar(), checkSource ? pickSlot() : null, toolbar()];
  }

  // The tab of what is shown: the overworld, a dungeon, or another place (houses, caves, grottos).
  function currentTab() {
    if (mode === "dungeons") return "dungeons";
    if (mode === "other") return "other";
    if (mode === "world" || mode === "region") return "field";
    const stage = mode === "area" ? areaPlace?.name ?? areaPlace?.stage?.name : map?.stage;
    if (!stage) return "field";
    if (DUNGEON_STAGES.some(([, s]) => s === stage)) return "dungeons";
    const onField = field?.regions?.some((r) => r.stages.some((st) => st.name === stage));
    return onField ? "field" : "other";
  }

  function toolbar() {
    const tab = currentTab();
    const button = (id, label, title, go) => el("button", {
      type: "button", className: "map-tab" + (tab === id ? " selected" : ""), textContent: label, title,
      onclick: () => {
        if (tab === id && (mode === "world" || mode === id)) return;
        go();
      },
    });
    const tabs = el("div", { className: "map-tabs", role: "tablist" },
      button("field", "Field", "Hyrule and its provinces", () => {
        if (!field?.ready) return showNotice(field?.error ? `The overworld map could not be read: ${field.error}` : "Reading the overworld map from the game…");
        areaPlace = null;
        switchField("world");
      }),
      button("dungeons", "Dungeons", "Every dungeon's map", () => openSelect("dungeons")),
      button("other", "Other", "Houses, caves, grottos and other places", () => openSelect("other")));
    return el("div", { className: "map-toolbar" }, tabs, checkSource ? filterMenu() : null);
  }

  function openSelect(kind) {
    mode = kind;
    areaPlace = null;
    sceneKey = "";
    render();
  }

  // The check filter: which statuses show on the map, in a drop-down like Reachable Regions.
  function filterMenu() {
    const pop = el("div", { className: "map-filter-pop", hidden: true },
      ...CHECK_STATUSES.map(([status, label]) => el("label", { className: `map-filter-item ${status}` },
        el("input", { type: "checkbox", checked: checkFilter.has(status), onchange: (e) => {
          if (e.target.checked) checkFilter.add(status);
          else checkFilter.delete(status);
          try { localStorage.setItem(FILTER_KEY, JSON.stringify([...checkFilter])); } catch { /* not kept */ }
          updateChecks();
        } }),
        el("span", { className: "map-check " + status }, el("span", { className: "loc-dot" })), label)),
      ...[["icons", "Map icons (monkeys, Sols...)"], ["npcs", "People and golden wolves"]].map(([kind, label]) =>
        el("label", { className: "map-filter-item icons" },
          el("input", { type: "checkbox", checked: checkFilter.has(kind), onchange: (e) => {
            if (e.target.checked) {
              checkFilter.add(kind);
              checkFilter.delete("no" + kind);
            } else {
              checkFilter.delete(kind);
              checkFilter.add("no" + kind);
            }
            try { localStorage.setItem(FILTER_KEY, JSON.stringify([...checkFilter])); } catch { /* not kept */ }
            sceneKey = "";
            render();
          } }), label)));
    const menu = el("div", { className: "map-filter-menu" });
    const button = el("button", { type: "button", className: "map-tab map-filter-button", textContent: "Checks Filter ▾", ariaExpanded: "false",
      onclick: (e) => {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
        button.ariaExpanded = String(!pop.hidden);
        if (!pop.hidden) {
          const close = (ev) => {
            if (menu.contains(ev.target)) return;
            pop.hidden = true;
            button.ariaExpanded = "false";
            document.removeEventListener("pointerdown", close, true);
          };
          document.addEventListener("pointerdown", close, true);
        }
      } });
    menu.append(button, pop);
    return menu;
  }

  // The check picked on the map, as its row of the check list (empty until one is picked).
  // Click the row: its requirement over the map; right-click: unpick.
  function pickSlot() {
    return el("div", { className: "map-pick" });
  }

  let pickShown = null;
  function updatePick(force = false) {
    const slot = root.querySelector(".map-pick");
    if (!slot || !checkSource) return;
    let row = reqName ? checkSource.row(reqName) : null;
    if (!row) {
      reqName = null;
      row = el("div", { className: "loc-row plate map-pick-empty", textContent: "No check picked — click a check on the map" });
    } else {
      row.classList.add("selected");
      row.title = "Click: requirement · Right-click: unpick · Double-click: show in Checks";
      row.onclick = () => showReq();
      row.oncontextmenu = (e) => {
        e.preventDefault();
        unpick();
      };
      row.ondblclick = () => checkSource.jump(reqName);
    }
    // A check without a place in the game files (NPCs, golden wolves, events) is placed by hand.
    const info = reqName ? checkSource.list().find((c) => c.name === reqName) : null;
    let actions = null;
    if (info && (info.key.startsWith("manual:") || (places?.done && !hasGamePlace(info.key)))) {
      const name = reqName;
      const placed = !!manualPlaces()[name];
      const mine = !!userPlaces()[name];
      const preset = !!presets[name];
      const now = placing === name;
      actions = el("div", { className: "map-pick-actions" },
        el("button", { type: "button", className: "map-place" + (now ? " active" : ""),
          textContent: now ? "Click the map to place it (cancel)" : placed ? "Move on map" : "Place on map",
          title: "Checks given by people, golden wolves and events have no place in the game files: put it where it is",
          onclick: () => { placing = now ? null : name; updatePick(true); } }),
        mine ? el("button", { type: "button", className: "map-place", textContent: preset ? "Back to preset" : "Remove place",
          onclick: () => { checkSource.setPlace(name, null); placing = null; sceneKey = ""; render(); updatePick(true); } }) : null,
        Object.keys(userPlaces()).length ? el("button", { type: "button", className: "map-place", textContent: "Copy my places",
          title: "Copy every check you placed (JSON), to send for the mod's presets",
          onclick: (e) => copyPlaces(e.currentTarget) }) : null);
    }
    if (placing && placing !== reqName) placing = null;
    root.querySelector(".map-frame")?.classList.toggle("placing", !!placing);
    // Redrawn only when it changed (statuses update a few times a second).
    const html = row.outerHTML + (actions?.outerHTML ?? "");
    if (!force && html === pickShown) return;
    pickShown = html;
    slot.replaceChildren(row, ...(actions ? [actions] : []));
  }

  // Every check placed in the page, as JSON for the mod's presets (map_presets.json).
  function copyPlaces(button) {
    const text = JSON.stringify({ places: userPlaces() }, null, 1);
    const done = (ok) => {
      button.textContent = ok ? "Copied!" : "Could not copy";
      setTimeout(() => updatePick(true), 1500);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => fallback());
    else fallback();
    function fallback() {
      const area = el("textarea", { value: text });
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* not allowed */ }
      area.remove();
      done(ok);
    }
  }

  function unpick() {
    if (reqName && checkSource.focused() === reqName) checkSource.setFocused(null);
    reqName = null;
    checkSource.unmount();
    updatePick(true);
    updateChecks();
  }

  // The requirement of the picked check, over the map (see-through).
  function detailPop() {
    return el("div", { className: "map-detail-pop", hidden: true });
  }

  // ---- Doors and the boss ----

  // The doors the game marks on this floor (as renderingPlusDoor_c: a door shows when a room on
  // either side is drawn and the door is on the floor shown).
  function buildDoors(rooms, floor) {
    const drawn = new Set(rooms.map((r) => r.no));
    const out = [];
    (map.doors ?? []).forEach((door, index) => {
      if (!door.rooms.some((r) => drawn.has(r))) return;
      if (!door.floors.includes(floor)) return;
      const here = door.rooms.includes(player.stayRoom);
      const node = svg("g", { class: `map-door ${door.kind}` + (here ? " here" : "") });
      const square = svg("rect", { class: "map-door-square", x: -50, y: -50, width: 100, height: 100 });
      const marks = [];
      node.append(square);
      // The signs: a group of their own at the same place, drawn above every door's square.
      const markNode = svg("g", { class: `map-door ${door.kind}` + (here ? " here" : "") });
      if (door.kind === "key" || door.kind === "boss") {
        const lock = door.kind === "boss" ? LOCK_BIG : LOCK_SMALL;
        const mark = svg("g", { class: "map-door-mark map-door-lock" });
        mark.innerHTML = `<g class="detail-high">${lock.high}</g><g class="detail-low">${lock.low}</g>`;
        markNode.append(mark);
        marks.push(mark);
      }
      // Any door can be barred (a room that shuts behind Link): the sign is there, shown when so.
      const bar = svg("g", { class: "map-door-mark map-door-bar" });
      bar.innerHTML = NO_ENTRY;
      markNode.append(bar);
      marks.push(bar);
      // A door shut from one side only (it closes behind Link, or opens from one side): the sign on
      // that side's edge of the square; the front faces the door's facing.
      const edges = ["front", "back"].map((side) => {
        const mark = svg("g", { class: `map-door-mark map-door-edge ${side}` });
        mark.innerHTML = NO_ENTRY;
        markNode.append(mark);
        return mark;
      });
      node.setAttribute("transform", `translate(${door.x} ${door.z})`);
      markNode.setAttribute("transform", `translate(${door.x} ${door.z})`);
      square.setAttribute("transform", `rotate(${(door.angle / 65536) * 360})`);
      const title = svg("title");
      node.prepend(title);
      const item = { node, markNode, square, marks, edges, angle: (door.angle / 65536) * Math.PI * 2, index, kind: door.kind, state: "", title,
        label: `${door.name} · ${door.kind} · rooms ${door.rooms[0]} (front) / ${door.rooms[1]} (back)` };
      setDoorState(item, door.state ?? (door.closed ? "C" : door.locked === true ? "L" : door.locked === false ? "U" : "O"));
      out.push(item);
    });
    return out;
  }

  // A door's state letter from the mod (L locked, U unlocked, C barred, F / B / D shut from the
  // front / back / both sides, O open, ? unknown: the last known state stays).
  function setDoorState(door, letter) {
    if (letter === "?" && door.state) return;
    let state = { L: "locked", U: "unlocked", C: "barred", O: "open", F: "shut-front", B: "shut-back", D: "shut-both" }[letter]
      ?? (door.kind === "key" || door.kind === "boss" ? "locked" : "open");
    if (state === "open" && (door.kind === "key" || door.kind === "boss")) state = "unlocked";
    if (state === door.state) return;
    for (const n of [door.node, door.markNode]) {
      n.classList.remove(door.state || "none");
      n.classList.add(state);
    }
    door.state = state;
    door.title.textContent = `${door.label} · ${state}${letter === "?" ? " (state unknown)" : ""}`;
  }

  // Door states change often (keys used, bars dropping behind Link): taken from /map-player.
  function updateDoors() {
    if (!scene?.doors?.length || typeof player.doors !== "string" || player.doors.length !== (map.doors?.length ?? -1)) return;
    for (const door of scene.doors) setDoorState(door, player.doors[door.index]);
  }

  // The dungeon's boss icon (the one set in the Dungeons tab) in the middle of the boss's room.
  function bossMark(d, rooms, floor) {
    const icon = DUNGEON_ICONS.bosses[d.name];
    if (!map.boss || !icon || map.boss.floor !== floor) return null;
    const box = roomBoxes(rooms.filter((r) => r.no === map.boss.room), floor).get(map.boss.room);
    const at = box ? { x: box.x, y: box.y } : { x: map.boss.x, y: map.boss.z };
    const node = el("div", { className: "map-boss" + (d.bossDefeated ? " defeated" : ""), title: d.bossDefeated ? `${icon} (defeated)` : icon },
      iconSlot(icon, icon, "map-boss-icon", el("span", { className: "map-boss-fallback", textContent: "☠" })));
    return { node, at };
  }

  // Door marks and the boss icon keep a readable size on screen: never smaller than about 13 px,
  // and the locks switch to their plain look when small.
  function placeMarks(k, rect, vb) {
    if (!scene) return;
    const squarePx = DOOR_SIZE / k;
    const squareScale = Math.max(DOOR_SIZE, 6 * k) / 100;
    const markPx = Math.max(squarePx, 13);
    const markScale = (markPx * k) / 24;
    scene.svg.classList.toggle("detail-low", markPx < 20);
    for (const door of scene.doors) {
      door.square.setAttribute("transform", door.square.getAttribute("transform").replace(/ scale\([^)]*\)/, "") + ` scale(${squareScale})`);
      for (const mark of door.marks) mark.setAttribute("transform", `scale(${markScale}) translate(-12 -12)`);
      // Edge signs: on the middle of the front / back edge, a little smaller.
      const half = (squareScale * 100) / 2;
      door.edges.forEach((mark, i) => {
        const d = i === 0 ? half : -half;
        mark.setAttribute("transform", `translate(${Math.sin(door.angle) * d} ${Math.cos(door.angle) * d}) scale(${markScale * 0.75}) translate(-12 -12)`);
      });
    }
    // HTML marks over the map: the boss and the checks.
    const fr = scene.frame.getBoundingClientRect();
    const off = rect.left - fr.left - scene.frame.clientLeft;
    const offY = rect.top - fr.top - scene.frame.clientTop;
    // Marks outside the map's drawing area (the frame's border) are cut off, as the map is.
    const overlay = scene.frame.querySelector(".map-overlay");
    if (overlay) {
      const right = scene.frame.clientWidth - off - rect.width;
      const bottom = scene.frame.clientHeight - offY - rect.height;
      overlay.style.clipPath = `inset(${offY}px ${right}px ${bottom}px ${off}px)`;
    }
    const place = (node, at, px) => {
      let x = (at.x - vb.x) / k + (rect.width - vb.width / k) / 2;
      if (mirrored()) x = rect.width - x;
      const y = (at.y - vb.y) / k + (rect.height - vb.height / k) / 2;
      Object.assign(node.style, { width: `${px}px`, height: `${px}px`, transform: `translate(${off + x - px / 2}px, ${offY + y - px / 2}px)` });
    };
    if (scene.boss) place(scene.boss.node, scene.boss.at, 26 + 4 * Math.log2(view.zoom));
    const checkPx = 16 + 2 * Math.log2(view.zoom);
    for (const c of scene.checks ?? []) place(c.node, c.at, checkPx);
    for (const c of scene.icons ?? []) place(c.node, c.at, checkPx + 6);
  }

  // Link: a yellow arrowhead toward where he faces (angle 0 = +z), on Link's floor only.
  function placeLink() {
    if (!scene) return;
    const shown = player.player && (scene.kind !== "stage" ? scene.linkShown : player.stayFloor === undefined || player.stayFloor === scene.floor);
    scene.link.style.display = shown ? "" : "none";
    if (!shown) return;
    const a = (player.player.angle / 65536) * Math.PI * 2;
    const s = (scene.size * 0.022) / Math.sqrt(view?.zoom ?? 1);
    const x = player.player.x + scene.offset.x;
    const z = player.player.z + scene.offset.z;
    const pt = (ang, r) => `${x + Math.sin(ang) * r},${z + Math.cos(ang) * r}`;
    scene.link.setAttribute("points", `${pt(a, s * 1.5)} ${pt(a + 2.45, s)} ${pt(a - 2.45, s)}`);
    scene.link.setAttribute("stroke-width", s * 0.18);
  }

  // ---- The view: zoom, drag, and following Link ----

  const mirrored = () => !!player?.mirror;
  const mirrorSign = () => (mirrored() ? -1 : 1);
  const baseCenter = () => ({ x: scene.base.x + scene.base.w / 2, y: scene.base.y + scene.base.h / 2 });

  // Keep the view on the map.
  function clampView(v) {
    const { base } = scene;
    const w = base.w / v.zoom;
    const h = base.h / v.zoom;
    // (A view wider than the map, while zooming between maps, is left as it is.)
    return {
      zoom: v.zoom,
      x: w > base.w ? v.x : Math.min(Math.max(v.x, base.x + w / 2), base.x + base.w - w / 2),
      y: h > base.h ? v.y : Math.min(Math.max(v.y, base.y + h / 2), base.y + base.h - h / 2),
    };
  }

  function applyView() {
    if (!scene) return;
    // Mirror Mode: the map is flipped left to right, as the game shows it.
    scene.svg.style.transform = mirrored() ? "scaleX(-1)" : "";
    if (!view) view = clampView({ ...baseCenter(), zoom: LEVELS[level] });
    const { base } = scene;
    const w = base.w / view.zoom;
    const h = base.h / view.zoom;
    const vb = { x: view.x - w / 2, y: view.y - h / 2, width: w, height: h };
    scene.svg.setAttribute("viewBox", `${vb.x} ${vb.y} ${w} ${h}`);
    scene.frame.classList.toggle("zoomed", view.zoom > 1.001);
    const rect = scene.svg.getBoundingClientRect();
    if (rect.width > 0) placeMarks(Math.max(w / rect.width, h / rect.height), rect, vb);
    placeLink();
    scene.zoomBar.update();
  }

  // Move the view to a target, smoothly unless told not to.
  function goTo(target, smooth = true, done = null) {
    target = clampView(target);
    if (anim) cancelAnimationFrame(anim.frame);
    anim = null;
    if (!smooth || !view || !visible) {
      view = target;
      applyView();
      done?.();
      return;
    }
    const from = { ...view };
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / ZOOM_MS);
      const e = 1 - Math.pow(1 - t, 3);
      // Zoom in even steps of scale; the center so that a fixed point stays put while zooming.
      const zoom = from.zoom * Math.pow(target.zoom / from.zoom, e);
      const f = from.zoom === target.zoom ? e : (1 / zoom - 1 / from.zoom) / (1 / target.zoom - 1 / from.zoom);
      view = { zoom, x: from.x + (target.x - from.x) * f, y: from.y + (target.y - from.y) * f };
      applyView();
      if (t < 1) anim.frame = requestAnimationFrame(step);
      else {
        anim = null;
        done?.();
      }
    };
    anim = { frame: requestAnimationFrame(step) };
  }

  const targetView = () => (anim ? null : view);

  // Zoom to a level, keeping a map point (the clicked one, or the middle) where it is on screen.
  function zoomTo(next, at) {
    next = Math.min(LEVELS.length - 1, Math.max(0, next));
    if (next === level && !anim) return;
    const cur = targetView() ?? view;
    const p = at ?? { x: cur.x, y: cur.y };
    const z = LEVELS[next];
    level = next;
    saveLevel();
    manual = true;
    goTo({ zoom: z, x: p.x - (p.x - cur.x) * (cur.zoom / z), y: p.y - (p.y - cur.y) * (cur.zoom / z) });
  }

  // Center the room Link is in when he enters another room, or when he moves after the view was
  // moved by hand; zoom out when the room does not fit.
  function follow() {
    if (!followOn || !scene || scene.kind !== "stage" || !player.player || pressing || anim) return;
    if (player.stayFloor !== undefined && player.stayFloor !== scene.floor) return;
    const box = scene.rooms.get(player.stayRoom);
    if (!box) return;
    const pos = { x: player.player.x, y: player.player.z };
    const moved = !lastPos || Math.hypot(pos.x - lastPos.x, pos.y - lastPos.y) > 8;
    const roomChanged = followRoom !== player.stayRoom;
    const first = followRoom === null;
    const dungeon = map.stage.startsWith("D_");
    const fits = (z) => Math.max(box.w, box.h) <= span(scene.base, z) * 0.92;
    if (dungeon || fits(LEVELS[level])) {
      // The room fits (or a dungeon room, zoomed out until it does): keep it in the middle.
      if (!roomChanged && !(manual && moved)) {
        if (moved) lastPos = pos;
        return;
      }
      let next = level;
      while (next > 0 && !fits(LEVELS[next])) next--;
      if (next !== level) {
        level = next;
        saveLevel();
      }
      followRoom = player.stayRoom;
      lastPos = pos;
      manual = false;
      return goTo({ zoom: LEVELS[level], x: box.x, y: box.y }, !first);
    }
    // An overworld area larger than the view: the zoom stays, and the view slides to keep Link
    // near the middle (a margin around it, as his position comes a few times a second).
    if (moved) lastPos = pos;
    const near = span(scene.base, view.zoom) * 0.18;
    const away = Math.abs(pos.x - view.x) > near || Math.abs(pos.y - view.y) > near;
    // Only when Link moves: a view slid by hand stays until he does.
    if (!moved) return;
    if (!roomChanged && !manual && !away) return;
    followRoom = player.stayRoom;
    manual = false;
    goTo({ zoom: LEVELS[level], x: pos.x, y: pos.y }, !first);
  }

  // The title, with the option to follow Link.
  function titleBar(title) {
    return el("div", { className: "loc-banner map-title" },
      el("span", { className: "loc-banner-title", textContent: title }),
      el("label", { className: "map-follow", title: "Keep the map on Link: slide and zoom to his room, and go back to his floor and map when he moves" },
        el("input", { type: "checkbox", checked: followOn, onchange: (e) => {
          followOn = e.target.checked;
          try { localStorage.setItem(FOLLOW_KEY, followOn ? "1" : "0"); } catch { /* not kept */ }
          if (followOn) {
            // Back on Link right away.
            followRoom = null;
            lastPos = null;
            pickedFloor = null;
            if (mode !== "stage") switchStage();
            else render();
          }
        } }), "Follow Link"));
  }

  // The dungeon map screen's icons (monkeys, iron balls, statues, Sols, Ooccoo, small keys...) of
  // the rooms drawn, on the floor shown. Shown with the "Map icons" filter; right-click to change
  // one's picture.
  function buildIcons(rooms, floor) {
    const drawn = new Set(rooms.map((r) => r.no));
    const out = [];
    // People and golden wolves where the game places them (their actors in the room files).
    if (checkFilter.has("npcs")) {
      for (const c of map.checks ?? []) {
        if (!c.key.startsWith("npc:")) continue;
        if ((floor !== null && c.floor !== undefined && c.floor !== floor) || (c.room >= 0 && !drawn.has(c.room))) continue;
        const actor = c.key.split(":")[1];
        const who = NPC_NAMES[actor] ?? "Someone";
        const node = el("div", { className: "map-npc-mark" + (actor === "GWolf" ? " wolf" : ""), title: `${who} (${actor})` });
        node.innerHTML = actor === "GWolf" ? WOLF_GLYPH : PERSON_GLYPH;
        node.addEventListener("pointerdown", (e) => e.stopPropagation());
        out.push({ node, at: { x: c.x, y: c.z } });
      }
    }
    if (!checkFilter.has("icons")) return out;
    for (const i of map.icons ?? []) {
      const kind = MAP_ICONS[i.type];
      if (!kind || (floor !== null && i.floor !== floor) || (i.room >= 0 && !drawn.has(i.room))) continue;
      const node = el("div", { className: "map-icon-mark", title: kind[1] }, iconSlot(kind[0], kind[1], "map-icon-img", el("span", { className: "map-icon-fallback", textContent: kind[1][0] })));
      node.addEventListener("pointerdown", (e) => e.stopPropagation());
      out.push({ node, at: { x: i.x, y: i.z } });
    }
    return out;
  }

  // ---- Checks on the map ----

  // Markers for the checks the mod found in this stage's rooms, with the status of their marker
  // in Checks; only those on the floor shown (floor null: every one).
  function buildChecks(floor, drawnRooms = null) {
    if (!checkSource) return [];
    const all = checkSource.list();
    const byKey = new Map(all.map((c) => [c.key, c]));
    const byName = new Map(all.map((c) => [c.name, c]));
    // Only rooms of this map: a stage's other rooms can be another map in the same coordinates
    // (Lanayru Spring in Lake Hylia's stage).
    const drawn = drawnRooms ?? new Set(map.rooms.map((r) => r.no));
    const out = [];
    for (const place of stageChecks(map.stage, map.checks)) {
      const info = place.name ? byName.get(place.name) : byKey.get(place.key);
      if (!info || (floor !== null && place.floor !== undefined && place.floor !== floor)) continue;
      if (place.room >= 0 && !drawn.has(place.room)) continue;
      const node = el("button", { type: "button", className: `map-check ${info.status}`,
        title: `${info.name}\nClick: details under the map · Right-click: highlight · Double-click: show in Checks` },
        el("span", { className: "loc-dot" }));
      node.addEventListener("pointerdown", (e) => e.stopPropagation());
      node.addEventListener("pointerup", (e) => e.stopPropagation());
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (reqName !== info.name) checkSource.unmount();
        reqName = info.name;
        checkSource.setFocused(info.name);
        updatePick(true);
        updateChecks();
      });
      node.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (reqName === info.name) return unpick();
        checkSource.setFocused(checkSource.focused() === info.name ? null : info.name);
        updateChecks();
      });
      node.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        checkSource.jump(info.name);
      });
      node.hidden = !checkFilter.has(info.status);
      out.push({ node, at: { x: place.x, y: place.z }, name: info.name, status: info.status });
    }
    return out;
  }

  // How many of this place's checks (those the check list knows by a key: chests, items lying
  // around, poes) the mod has found in its rooms; the rest are named on hover.
  function checkNote() {
    const placed = new Map(patchedChecks(map.stage, map.checks ?? []).map((c) => [c.key, c]));
    const shown = new Set((scene?.checks ?? []).map((c) => c.name));
    const drawn = new Set(map.rooms.map((r) => r.no));
    let mine = checkSource.list().filter((c) => c.key.split(":")[1] === map.stage);
    // A house, cave or grotto: only the checks of the room shown (a shop's room is in its key).
    if (isInterior(map.stage)) {
      mine = mine.filter((c) => {
        const p = placed.get(c.key);
        const room = p ? p.room : c.key.startsWith("shop:") ? Number(c.key.split(":")[2]) : null;
        return shown.has(c.name) || (room !== null && (room < 0 || drawn.has(room)));
      });
    }
    if (!mine.length) return null;
    const groups = { here: [], room: [], floor: [], missing: [] };
    for (const c of mine) {
      const p = placed.get(c.key);
      if (shown.has(c.name)) groups.here.push(c);
      else if (!p) groups.missing.push(c);
      else if (p.room >= 0 && !drawn.has(p.room)) groups.room.push({ ...c, why: `room ${p.room}` });
      else groups.floor.push({ ...c, why: p.floor !== undefined ? floorLabel(p.floor) : "" });
    }
    if (groups.here.length === mine.length) return null;
    const list = (title, items) => (items.length ? `${title}:\n${items.map((c) => `  ${c.name}${c.why ? ` (${c.why})` : ""}`).join("\n")}\n` : "");
    const parts = [`${groups.here.length} of ${mine.length} checks of this place on this map`];
    if (groups.floor.length) parts.push(`${groups.floor.length} on another floor`);
    if (groups.room.length) parts.push(`${groups.room.length} in another part of this place`);
    if (groups.missing.length) parts.push(`${groups.missing.length} not found${map.checksAll ? "" : " yet (the game files are being read)"}`);
    return el("p", { className: "map-check-note",
      title: list("On another floor", groups.floor) + list("In another part of this place (another room's map)", groups.room) + list("Not found in the game files", groups.missing),
      textContent: `${parts.join(" · ")}. Hover for which.` });
  }

  // Statuses change as items come in: the markers follow, and the filter hides or shows them.
  function updateChecks() {
    if (!scene?.checks?.length) return updatePick();
    const status = new Map(checkSource.list().map((c) => [c.name, c.status]));
    for (const c of scene.checks) {
      const now = status.get(c.name) ?? "unknown";
      if (now !== c.status) {
        c.node.classList.replace(c.status, now);
        c.status = now;
      }
      c.node.hidden = !checkFilter.has(c.status);
    }
    const focusedName = checkSource.focused();
    for (const c of scene.checks) c.node.classList.toggle("selected", c.name === focusedName || c.name === reqName);
    updatePick();
  }

  // The picked check's requirement over the map (its panel from the check list, with its buttons).
  function showReq() {
    const box = root.querySelector(".map-detail-pop");
    if (!box || !checkSource || !reqName) return;
    checkSource.mount(box, reqName, { row: false });
  }

  // A short message under the map (why it cannot zoom out yet).
  function noticeBox() {
    return el("p", { className: "map-notice", hidden: true });
  }
  function showNotice(text) {
    const box = root.querySelector(".map-notice");
    if (!box) return;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => { box.hidden = true; }, 5000);
  }

  // ---- Zooming out to the province and to Hyrule ----

  // Where this stage sits on the overworld map: the province and stage entry that hold Link's room.
  function fieldPlace() {
    if (!field?.ready || !map?.exists || map.stage.startsWith("D_")) return null;
    let found = null;
    for (const region of field.regions) {
      for (const stage of region.stages) {
        if (stage.name !== map.stage) continue;
        const place = { region, stage, x: region.x + stage.x, z: region.z + stage.z };
        if (stage.rooms.some((r) => r.no === player?.stayRoom)) return place;
        found ??= place;
      }
    }
    return found;
  }

  // The span of the map a view shows (the larger side, as the frame is square).
  const span = (base, zoom) => Math.max(base.w, base.h) / zoom;

  function zoomIn(at) {
    if (!scene || scene.kind === "stage" || scene.kind === "area") return zoomTo(level + 1, at);
    if (anim) return;
    if (scene.kind === "world") {
      // Into the lit province (the one clicked), or Link's.
      const region = scene.hover?.region ?? (at && regionAt(at)) ?? fieldPlace()?.region;
      return switchField("region", region);
    }
    // The lit place: another one opens from the field map data; Link's own goes back to his map.
    const place = fieldPlace();
    if (scene.hover && scene.hover.stage !== place?.stage) return openArea(scene.hover);
    const b = place && scene.stageBoxes.get(place.stage);
    if (!b) return switchStage();
    goTo({ x: b.x, y: b.y, zoom: span(scene.base, 1) / Math.max(b.w, b.h) }, true, switchStage);
  }

  function zoomOut(at) {
    if (scene?.kind === "area") {
      if (level > 0) return zoomTo(level - 1, at);
      if (anim) return;
      const back = areaPlace?.back ?? "region";
      if (back === "region" && scene.areaRegion) {
        mode = "region";
        return switchField("region", scene.areaRegion);
      }
      return openSelect(back === "region" ? "other" : back);
    }
    if (!scene || scene.kind === "stage") {
      if (level > 0) return zoomTo(level - 1, at);
      if (anim) return;
      if (fieldPlace()) return switchField("region", fieldPlace().region);
      // A dungeon or another place (a house, a cave): the list of them.
      if (map?.exists && (map.stage.startsWith("D_") || field?.ready)) return openSelect(currentTab() === "dungeons" ? "dungeons" : "other");
      // Say why the province cannot be shown (yet).
      if (field?.error) showNotice(`The overworld map could not be read: ${field.error}`);
      else if (field?.ready) showNotice(`This place (${map.stage}, room ${player.stayRoom}) is not on the overworld map.`);
      else if (field?.reading && field.stages) showNotice(`Reading the overworld map from the game… (${field.stage} / ${field.stages} places)`);
      else showNotice("Reading the overworld map from the game…");
      return;
    }
    if (scene.kind === "region" && !anim) switchField("world");
  }

  function switchStage() {
    mode = "stage";
    areaPlace = null;
    level = 0;
    saveLevel();
    sceneKey = "";
    followRoom = null;
    render();
  }

  // Shows the province (or Hyrule), zooming out from what is on screen now.
  function switchField(kind, region) {
    const from = scene && view ? { x: view.x + scene.offset.x, y: view.y + scene.offset.z, span: span(scene.base, view.zoom) } : null;
    mode = kind;
    fieldRegion = region?.no ?? null;
    fieldStage = map?.stage ?? null;
    sceneKey = "";
    renderField(from);
  }

  let fieldRegion = null;
  let fieldStage = null;

  function regionAt(p) {
    for (const [region, b] of scene.regionBoxes ?? []) {
      if (Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2) return region;
    }
    return null;
  }

  // Stages the map screen shows: those with a visited room, and the one Link is in.
  function shownStage(stage) {
    return stage.name === map.stage || (visited?.stages?.[stage.name]?.length ?? 0) > 0;
  }

  function renderField(from = null) {
    const place = fieldPlace();
    // A new stage: its own province.
    if (fieldStage !== map.stage) {
      fieldStage = map.stage;
      if (mode === "region" && place) fieldRegion = place.region.no;
    }
    if (mode === "region" && fieldRegion === null) fieldRegion = place?.region.no ?? null;
    if (mode === "region" && fieldRegion === null) mode = "world";
    const regions = mode === "world" ? field.regions : field.regions.filter((r) => r.no === fieldRegion);
    const key = JSON.stringify([mode, fieldRegion, map.stage, player.stayRoom, visited?.stages]);
    if (key !== sceneKey || from) {
      sceneKey = key;
      buildField(regions, place, from);
    }
    placeLink();
  }

  function buildField(regions, place, from) {
    const drawing = svg("svg", { class: "map-svg field-select", preserveAspectRatio: "xMidYMid meet" });
    const shapes = svg("g", { class: "map-shapes" });
    const outlines = svg("g", { class: "map-outlines" });
    const all = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    const stageBoxes = new Map();
    const regionBoxes = new Map();
    const areas = []; // { node, region, stage }
    const grow = (b, x, z) => {
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
      b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    };
    for (const region of regions) {
      const rb = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (const stage of region.stages) {
        const ox = region.x + stage.x;
        const oz = region.z + stage.z;
        const shown = shownStage(stage);
        // Every stage counts for the extent (the whole map, as in the game, even where Link has not
        // been); only the visited ones are drawn.
        const area = shown ? svg("g", { class: "map-area" + (place?.stage === stage ? " here" : "") }) : null;
        const sb = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
        let water = 0;
        const waterPaths = [];
        for (const room of stage.rooms) {
          const v = room.vertices.map((n, i) => n + (i % 2 ? oz : ox));
          for (const f of room.floors) for (const g of f.groups) {
            if (!g.shown) continue;
            for (const p of g.polys) {
              if (p.type & 0x80) continue;
              for (const i of p.strip) grow(sb, v[i * 2], v[i * 2 + 1]);
              if (!area) continue;
              const color = FIELD[p.type & 0x3f] ?? FIELD[0];
              const path = svg("path", { d: stripPath(v, p.strip), fill: color, stroke: color, "stroke-width": 40, "stroke-linejoin": "round" });
              area.append(path);
              if ((p.type & 0x3f) === 5) {
                water += stripArea(v, p.strip);
                let cx = 0, cz = 0;
                for (const i of p.strip) { cx += v[i * 2]; cz += v[i * 2 + 1]; }
                waterPaths.push({ path, x: cx / p.strip.length, z: cz / p.strip.length });
              }
            }
            if (!area) continue;
            for (const l of g.lines) {
              if (l.type & 0x80 || l.width < 1 || l.width > 2) continue;
              outlines.append(svg("path", { d: linePath(v, l.strip), class: `map-line w${l.width}`, stroke: OUTLINE.field }));
            }
          }
        }
        if (sb.minX === Infinity) continue;
        if (area) {
          shapes.append(area);
          areas.push({ node: area, region, stage, water, waterPaths, box: sb });
          stageBoxes.set(stage, { x: (sb.minX + sb.maxX) / 2, y: (sb.minZ + sb.maxZ) / 2, w: sb.maxX - sb.minX, h: sb.maxZ - sb.minZ });
        }
        grow(rb, sb.minX, sb.minZ); grow(rb, sb.maxX, sb.maxZ);
        grow(all, sb.minX, sb.minZ); grow(all, sb.maxX, sb.maxZ);
      }
      if (rb.minX !== Infinity) regionBoxes.set(region, { x: (rb.minX + rb.maxX) / 2, y: (rb.minZ + rb.maxZ) / 2, w: rb.maxX - rb.minX, h: rb.maxZ - rb.minZ });
    }
    // A small place under a larger one (Lake Hylia under Hyrule Field's Great Bridge of Hylia): the
    // larger one's water over the small place belongs to the small place, so the lake is its water
    // and the bridge the rest, for lighting and picking alike.
    const boxArea = (b) => (b.maxX - b.minX) * (b.maxZ - b.minZ);
    for (const big of areas) {
      for (const small of areas) {
        if (big === small || boxArea(small.box) >= boxArea(big.box) * 0.5) continue;
        const inside = (w) => w.x >= small.box.minX && w.x <= small.box.maxX && w.z >= small.box.minZ && w.z <= small.box.maxZ;
        const moving = big.waterPaths.filter(inside);
        if (!moving.length) continue;
        for (const w of moving) small.node.prepend(w.path);
        big.waterPaths = big.waterPaths.filter((w) => !inside(w));
      }
    }
    if (all.minX === Infinity || !areas.length) {
      mode = "stage";
      return switchStage();
    }
    const size = Math.max(all.maxX - all.minX, all.maxZ - all.minZ, 1);
    const pad = size * 0.05;
    const base = { x: all.minX - pad, y: all.minZ - pad, w: all.maxX - all.minX + pad * 2, h: all.maxZ - all.minZ + pad * 2 };
    const link = svg("polygon", { class: "map-link" });
    drawing.append(shapes, outlines, link);
    const reticle = el("div", { className: "map-reticle", hidden: true });
    reticle.innerHTML = RETICLE;
    const hint = mode === "world" ? "Click: zoom into the lit province" : "Click: open the lit place's map · Right-click: all of Hyrule";
    const frame = el("div", { className: "map-frame field", title: hint }, drawing, el("div", { className: "map-overlay" }), reticle);
    const zoomBar = zoomIndicator();
    const regionNo = mode === "region" ? fieldRegion : null;
    const title = mode === "world" ? "Hyrule" : PROVINCES[regionNo] ?? `Region ${regionNo}`;
    const caption = null;
    scene = { kind: mode, svg: drawing, link, frame, base, size, floor: null, rooms: new Map(), doors: [], boss: null, zoomBar,
      offset: place ? { x: place.x, z: place.z } : { x: 0, z: 0 }, linkShown: !!place && (mode === "world" || place.region.no === regionNo),
      stageBoxes, regionBoxes, areas, hover: null };
    bindFrame(frame, reticle);
    root.replaceChildren(el("div", { className: "map-pane" },
      ...paneTop(title),
      el("div", { className: "map-layout" }, el("div", { className: "map-stage" }, frame, zoomBar.node, detailPop())),
      noticeBox()));
    updateProgress();
    updatePick(true);
    // Lit at first: Link's province (Hyrule) or Link's place (a province), as in the game.
    const start = place && areas.find((a) => (mode === "world" ? a.region === place.region : a.stage === place.stage));
    setHover(start ?? areas[0]);
    const whole = { ...{ x: base.x + base.w / 2, y: base.y + base.h / 2 }, zoom: 1 };
    if (from) {
      // Start where the last map was on screen, then zoom out to the whole province or Hyrule.
      view = { x: from.x, y: from.y, zoom: span(base, 1) / from.span };
      applyView();
      goTo(whole);
    } else {
      view = whole;
      applyView();
    }
  }

  // The lit part of the province or Hyrule view: the place (a province) or the province (Hyrule)
  // under the cursor; the rest is dark, as on the game's map screen.
  function setHover(area) {
    if (!scene?.areas || !area) return;
    const same = (a) => (scene.kind === "world" ? a.region === area.region : a.stage === area.stage);
    if (scene.hover && same(scene.hover)) return;
    scene.hover = area;
    for (const a of scene.areas) a.node.classList.toggle("lit", same(a));
    const name = scene.kind === "world" ? PROVINCES[area.region.no] ?? `Region ${area.region.no}`
      : regionName(area.stage.name, area.stage.rooms[0]?.no ?? 0) ?? area.stage.name;
    // The title names the lit place (or province), as the game's map screen does.
    const titleEl = root.querySelector(".map-title .loc-banner-title");
    if (titleEl) titleEl.textContent = name;
  }

  function hoverAt(e) {
    // Where places overlap (Hyrule's Great Bridge over Lake Hylia), water picks the place below:
    // the lake's water is the lake, the rest the bridge.
    const node = e.target?.closest?.(".map-area");
    const area = node && scene.areas.find((a) => a.node === node);
    if (area) setHover(area);
  }

  // A place of the province opened from its map (shapes from the field map data): zoomable, without
  // Link, doors or checks. Zooming out goes back to the province.
  let areaPlace = null; // { region, stage }

  function openArea(area) {
    const b = scene.stageBoxes.get(area.stage);
    const enter = () => openRemote({ region: area.region, stage: area.stage, back: "region" });
    if (!b) return enter();
    goTo({ x: b.x, y: b.y, zoom: span(scene.base, 1) / Math.max(b.w, b.h) }, true, enter);
  }

  // Another place's map: a place of a province (from the overworld map data), or a whole stage
  // (a dungeon, a house, a cave: read from the game files). Zooming out goes back to where it was
  // opened from (the province, the Dungeons or the Other list).
  let areaFloor = null;
  function openRemote(place) {
    areaPlace = { ...place, name: place.name ?? place.stage?.name };
    areaFloor = null;
    mode = "area";
    level = 0;
    view = null;
    sceneKey = "";
    render();
  }

  // A stage's map from the mod (/stage-map), fetched once.
  function stageMap(name) {
    const known = stageMaps.get(name);
    if (known) return typeof known === "string" ? null : known;
    stageMaps.set(name, "loading");
    fetch(`stage-map/${name}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        stageMaps.set(name, m ?? "missing");
        if (m && areaPlace?.name === name) {
          sceneKey = "";
          render();
        }
      })
      .catch(() => stageMaps.set(name, "missing"));
    return null;
  }

  function renderArea() {
    const { region, stage, name, rooms: onlyRooms } = areaPlace;
    let rooms = stage?.rooms ?? null;
    if (!rooms) {
      const m = stageMap(name);
      if (!m) {
        const missing = stageMaps.get(name) === "missing";
        sceneKey = "";
        scene = null;
        root.replaceChildren(el("div", { className: "map-pane" }, ...paneTop(placeTitle(name)),
          el("p", { className: "empty", textContent: missing ? "This place's map is not known yet (the game files are still being read)." : "Loading the map…" })));
        return;
      }
      rooms = m.rooms;
      // One house / cave of a stage holding several.
      if (onlyRooms) {
        const mine = rooms.filter((r) => onlyRooms.includes(r.no));
        if (mine.length) rooms = mine;
      }
    }
    const key = JSON.stringify(["area", region?.no ?? null, name, onlyRooms ?? null, areaFloor, !!places?.done]);
    if (key === sceneKey) {
      updateChecks();
      return;
    }
    sceneKey = key;
    const real = map;
    const dungeon = name.startsWith("D_") && !stage;
    const remoteMap = stage ? null : stageMap(name);
    map = { stage: name, stayRoom: -1, exists: true, area: true, doors: [], checksAll: !!places?.done, icons: remoteMap?.icons ?? [],
      checks: (places?.stages?.[name] ?? []).map((p) => ({ key: p.key, room: p.room, x: p.x, z: p.z, floor: p.floor ?? 0 })),
      rooms: rooms.map((r) => ({ ...r, layer: 0, visited: true })), bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } };
    try {
      const floors = [...new Set(map.rooms.flatMap((r) => r.floors.map((f) => f.no)))].sort((a, b) => b - a);
      const floor = areaFloor ?? (floors.includes(0) ? 0 : floors[floors.length - 1] ?? 0);
      if (!dungeon) for (const c of map.checks) c.floor = floor;
      const d = dungeon ? findDungeon(placeTitle(name)) : null;
      build(dungeon, map.rooms, floors, floor, areaPlace.title ?? placeTitle(name), d, map.rooms,
        mapCaption(name, map.rooms.map((r) => r.no)));
    } finally {
      map = real;
    }
    scene.kind = "area";
    scene.linkShown = false;
    scene.offset = region && stage ? { x: region.x + stage.x, z: region.z + stage.z } : { x: 0, z: 0 };
    scene.areaRegion = region ?? null;
    scene.zoomBar.update();
    placeLink();
  }

  // A room's name for people: the place it is (an interior, cave or grotto, from the randomizer's
  // entrances), else what the names of its checks share ("Lanayru Spring Back Room"), else the
  // logic region.
  function roomTitle(stage, room) {
    return roomName?.(stage, room) ?? checksTitle(stage, room) ?? regionName(stage, room) ?? placeTitle(stage);
  }
  function checksTitle(stage, room) {
    if (!checkSource || room < 0) return null;
    const keys = new Set((places?.stages?.[stage] ?? []).filter((p) => p.room === room).map((p) => p.key));
    const names = checkSource.list().filter((c) => keys.has(c.key)).map((c) => c.name.split(" "));
    for (const [name, p] of Object.entries(manualPlaces())) if (p.stage === stage && p.room === room) names.push(name.split(" "));
    if (!names.length) return null;
    let n = 0;
    while (names.every((w) => w.length > n + 1 && w[n] === names[0][n])) n++;
    return n >= 2 ? names[0].slice(0, n).join(" ") : null;
  }

  // A stage's name for people: the dungeon, or the logic region of its first room.
  function placeTitle(name) {
    const dungeon = DUNGEON_STAGES.find(([, s]) => s === name);
    if (dungeon) return dungeon[0];
    const stage = field?.regions?.flatMap((r) => r.stages).find((st) => st.name === name);
    return regionName(name, stage?.rooms[0]?.no ?? 0) ?? name;
  }

  // The Dungeons and Other tabs: lists of places whose map can be opened.
  function renderSelect() {
    const key = JSON.stringify(["select", mode, !!places?.done, (places?.maps ?? []).length]);
    if (key === sceneKey) return;
    sceneKey = key;
    scene = null;
    const known = new Set(places?.maps ?? []);
    const body = el("div", { className: "map-frame map-select twilight" + (mode === "dungeons" ? " centered" : "") });
    body.append(twilightMotes());
    const heading = (text) => el("div", { className: "twilight-heading" }, el("span", { textContent: text }));
    if (mode === "dungeons") {
      body.append(heading("Choose a dungeon"), el("div", { className: "map-dungeon-list" }, ...DUNGEON_STAGES.map(([label, stage, land], i) => {
        const b = el("button", {
          type: "button", className: "plate twilight-plate map-dungeon-button", disabled: !known.has(stage),
          title: known.has(stage) ? `Open ${label}'s map` : "Its map is known once the game files are read",
          onclick: () => openRemote({ name: stage, back: "dungeons" }),
        },
          el("span", { className: "twilight-no", textContent: ROMAN[i] }),
          el("span", { className: "twilight-emblem" }),
          el("span", { className: "twilight-text" },
            el("span", { className: "twilight-name", textContent: label }),
            el("span", { className: "twilight-sub", textContent: land })));
        b.querySelector(".twilight-emblem").innerHTML = EMBLEM;
        return b;
      })));
    } else {
      // Every other stage with a map: houses, caves, grottos, ... by province, with a search.
      const onField = new Set((field?.regions ?? []).flatMap((r) => r.stages.map((st) => st.name)));
      const dungeons = new Set(DUNGEON_STAGES.map(([, st]) => st));
      // A stage of houses holds one house a room: one entry a place (rooms with the same name
      // together).
      const list = [...known].filter((st) => !onField.has(st) && !dungeons.has(st))
        .flatMap((st) => {
          const roomNos = places?.mapRooms?.[st] ?? [];
          const byTitle = new Map();
          for (const no of roomNos) {
            const title = roomTitle(st, no);
            if (!byTitle.has(title)) byTitle.set(title, []);
            byTitle.get(title).push(no);
          }
          if (!byTitle.size) byTitle.set(placeTitle(st), null);
          const whole = byTitle.size === 1;
          return [...byTitle].map(([title, rooms]) => {
            const region = regionName(st, rooms?.[0] ?? 0) ?? placeTitle(st);
            return { stage: st, title, rooms: whole ? null : rooms, province: provinceOf(region) ?? provinceOf(title) ?? (st.startsWith("D_") ? "Dungeons" : "Other") };
          });
        })
        .sort((a, b) => a.province.localeCompare(b.province) || a.title.localeCompare(b.title));
      const groups = new Map();
      for (const item of list) {
        if (!groups.has(item.province)) groups.set(item.province, []);
        groups.get(item.province).push(item);
      }
      const results = el("div", { className: "map-other-list" });
      for (const [province, items] of groups) {
        results.append(el("div", { className: "map-other-group" },
          el("h4", { className: "twilight-heading" }, el("span", { textContent: province })),
          ...items.map((it) => {
            const b = el("button", { type: "button", className: "plate twilight-plate map-other-button", title: it.rooms ? `${it.stage} · room ${it.rooms.join(", ")}` : it.stage, textContent: it.title,
              onclick: () => openRemote({ name: it.stage, rooms: it.rooms, title: it.title, back: "other" }) });
            b.dataset.search = `${it.title} ${it.stage}`.toLowerCase();
            return b;
          })));
      }
      const filter = () => {
        const q = selectFilter.trim().toLowerCase();
        for (const g of results.querySelectorAll(".map-other-group")) {
          let any = false;
          for (const b of g.querySelectorAll(".map-other-button")) {
            b.hidden = q !== "" && !b.dataset.search.includes(q);
            any = any || !b.hidden;
          }
          g.hidden = !any;
        }
      };
      const search = el("input", { type: "search", className: "plate map-other-search", placeholder: "Search places…", value: selectFilter,
        oninput: (e) => { selectFilter = e.target.value; filter(); } });
      body.append(search, list.length ? results : el("p", { className: "empty", textContent: "The places are known once the game files are read." }));
      filter();
    }
    root.replaceChildren(el("div", { className: "map-pane" }, ...paneTop(mode === "dungeons" ? "Dungeons" : "Other places"),
      el("div", { className: "map-layout" }, el("div", { className: "map-stage" }, body)), noticeBox()));
    updateProgress();
    updatePick(true);
  }

  // A point of the frame (client px) in map units.
  function toMap(e) {
    const r = scene.svg.getBoundingClientRect();
    const vb = scene.svg.viewBox.baseVal;
    const k = Math.max(vb.width / r.width, vb.height / r.height); // "meet" scale
    return { x: vb.x + vb.width / 2 + (e.clientX - (r.left + r.width / 2)) * k * mirrorSign(), y: vb.y + vb.height / 2 + (e.clientY - (r.top + r.height / 2)) * k, k };
  }

  function bindFrame(frame, reticle) {
    let press = null;
    frame.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY, view: null, dragged: false };
      pressing = true;
      frame.setPointerCapture(e.pointerId);
    });
    frame.addEventListener("pointermove", (e) => {
      const r = frame.getBoundingClientRect();
      reticle.hidden = false;
      reticle.style.transform = `translate(${e.clientX - r.left}px, ${e.clientY - r.top}px)`;
      if (!press && scene?.areas) hoverAt(e);
      if (!press) return;
      const dx = e.clientX - press.x;
      const dy = e.clientY - press.y;
      if (!press.dragged && Math.hypot(dx, dy) < 5) return;
      if (!press.dragged) {
        press.dragged = true;
        if (anim) cancelAnimationFrame(anim.frame);
        anim = null;
        press.view = { ...view };
      }
      if (view.zoom <= 1.001) return;
      const { k } = toMap(e);
      manual = true;
      view = clampView({ zoom: press.view.zoom, x: press.view.x - dx * k * mirrorSign(), y: press.view.y - dy * k });
      applyView();
      frame.classList.add("dragging");
    });
    const release = (e) => {
      if (!press) return;
      const wasDrag = press.dragged;
      press = null;
      pressing = false;
      frame.classList.remove("dragging");
      if (!wasDrag && e.type === "pointerup" && !placeAt(toMap(e))) zoomIn(toMap(e));
    };
    frame.addEventListener("pointerup", release);
    frame.addEventListener("pointercancel", release);
    frame.addEventListener("pointerleave", () => { reticle.hidden = true; });
    frame.addEventListener("contextmenu", (e) => {
      // A right click on the boss icon opens the icon editor instead.
      if (e.target.closest?.("[data-icon]")) return;
      e.preventDefault();
      zoomOut(toMap(e));
    });
  }

  // The zoom indicator beside the map: four glowing dots, the top one the closest zoom, between
  // an up arrow (zoom in) and a down arrow (zoom out).
  function zoomIndicator() {
    const arrow = (dir, label, delta) => {
      const b = el("button", { type: "button", className: `map-zoom-arrow ${dir}`, title: label, ariaLabel: label, onclick: () => (delta > 0 ? zoomIn() : zoomOut()) });
      b.innerHTML = ARROW;
      return b;
    };
    const up = arrow("up", "Zoom in", 1);
    const down = arrow("down", "Zoom out", -1);
    const dots = LEVELS.map((z, i) => el("span", { className: `map-zoom-dot l${i}`, title: `×${z}` })).reverse();
    const node = el("div", { className: "map-zoom", role: "group", ariaLabel: "Zoom" }, up, el("div", { className: "map-zoom-dots" }, ...dots), down);
    return {
      node,
      update() {
        const stage = scene?.kind === "stage" || scene?.kind === "area";
        dots.forEach((dot, n) => dot.classList.toggle("on", stage && LEVELS.length - 1 - n === level));
        up.disabled = stage && level >= LEVELS.length - 1;
        down.disabled = scene?.kind === "world";
        down.title = stage && level <= 0 ? "Zoom out to the province" : scene?.kind === "region" ? "Zoom out to Hyrule" : "Zoom out";
      },
    };
  }

  // An icon that can be changed with a right click (data-icon, as in the Items and Dungeons tabs).
  function iconSlot(icon, label, className, fallback) {
    const span = el("span", { className: "map-icon" });
    Object.assign(span.dataset, { icon, iconLabel: label, iconItem: "" });
    span.append(makeIcon(icon, className, fallback));
    return span;
  }

  // The dungeon state of the map's title (Goron Mines, ...), if it is one.
  function findDungeon(title) {
    const key = (n) => String(n).toLowerCase().replace(/[^a-z]/g, "");
    return getState()?.dungeons?.find((x) => key(x.name) === key(title)) ?? null;
  }

  // The dungeon's keys, map and compass in item frames, like the game's dungeon map screen.
  function dungeonItems(d) {
    const items = getState()?.items ?? {};
    const slot = (on, icon, label, badge, short) => el("div", { className: "slot" + (on ? " on" : ""), title: label },
      el("div", { className: "frame" }, iconSlot(icon, label, "icon", el("span", { className: "fallback", textContent: short ?? label })),
        badge ? el("span", { className: "badge" + (badge.full ? " full" : ""), textContent: badge.text }) : null));
    const slots = [
      slot(d.smallKeys > 0, "Small_Key", `Small Keys ${d.smallKeys}/${d.maxSmallKeys} (holding ${d.smallKeysHeld})`,
        { text: `${d.smallKeysHeld}`, full: d.smallKeys >= d.maxSmallKeys }, "Small Key"),
    ];
    if (d.name === "Goron Mines") {
      const shards = items["Goron Mines Key Shard"] ?? 0;
      const shardSlot = slot(shards > 0, ["GBK0", "GBK1", "GBK3"][Math.max(0, shards - 1)], `Key Shards ${shards}/3`, { text: `${shards}/3`, full: shards >= 3 }, "Key Shards");
      shardSlot.querySelector("[data-icon]").dataset.iconSet = "keyShards";
      slots.push(shardSlot);
    } else if (d.hasBigKey) {
      const icon = d.name === "Snowpeak Ruins" ? "Bedroom_Key" : d.name === "Hyrule Castle" ? "Boss_KeyHC" : "Boss_Key";
      slots.push(slot(d.bigKey, icon, d.name === "Snowpeak Ruins" ? "Bedroom Key" : "Big Key"));
    }
    slots.push(slot(d.map, "Dungeon_Map", "Dungeon Map", null, "Map"), slot(d.compass, "Compass", "Compass"));
    return el("div", { className: "map-items" }, ...slots);
  }

  return {
    setVisible,
    render,
    showCheck,
    // Where the game places a check (stage and room), once the game files are read.
    placeOf: (key) => placeFor(key),
  };
}
