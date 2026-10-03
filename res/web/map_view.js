// Map sub-tab of Locations: the map of the stage Link is in, drawn from the game's own map data
// (/map, read by the mod from the rooms the game has loaded), with Link on it (/map-player).
// The shapes are the game's: triangle strips over each room's x/z vertices, by floor; their type
// picks the color (floor, raised floor, water, lava, ...), as in the game's maps.

import { DUNGEON_ICONS } from "./layout.js";

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
const linePath = (v, strip) => strip.map((i, n) => `${n ? "L" : "M"}${v[i * 2]} ${v[i * 2 + 1]}`).join("");

/**
 * @param root    container element
 * @param options.getState     () => last state from the mod (for inGame)
 * @param options.regionName   (stage, room) => logic region name or null (the map's title)
 * @param options.makeIcon     (name, className, fallbackText) => <img> of a tracker icon (follows the
 *                             icon settings; right-click opens the icon editor via data-icon)
 */
export function createMapView(root, { getState, regionName, makeIcon, checks: checkSource = null }) {
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
  let notice = null; // { text, until }

  function loadCheckFilter() {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY));
      if (Array.isArray(saved)) return new Set(saved);
    } catch { /* default */ }
    return new Set(["reachable", "blocked", "unknown"]);
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
        if (player.stayFloor !== undefined && player.stayFloor !== lastStayFloor) {
          lastStayFloor = player.stayFloor;
          pickedFloor = null;
        }
        // Link moved while another floor, the province or Hyrule is shown: back to his map.
        const p = player.player;
        const movedNow = p && seenPos && Math.hypot(p.x - seenPos.x, p.z - seenPos.z) > 8;
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

  function setVisible(on) {
    visible = on;
    if (on && !timer) tick();
    if (on && scene) requestAnimationFrame(() => scene && applyView());
  }

  // Rooms the game would draw: every room on the overworld; in a dungeon the visited ones, Link's,
  // and all of them once the dungeon map is found.
  function drawnRooms(dungeon) {
    return map.rooms.filter((r) => !dungeon || map.hasMap || r.visited || r.no === player?.stayRoom);
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
    if (mode !== "stage") {
      if (fieldPlace()) return renderField();
      mode = "stage";
    }
    if (!map.exists) return message("This place has no map.");
    const dungeon = map.stage.startsWith("D_");
    const rooms = drawnRooms(dungeon);
    const floors = [...new Set(rooms.flatMap((r) => r.floors.map((f) => f.no)))].sort((a, b) => b - a);
    const floor = pickedFloor ?? player.stayFloor ?? floors[floors.length - 1] ?? 0;
    const title = regionName(map.stage, map.stayRoom) ?? map.stage;
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
      build(dungeon, rooms, floors, floor, title, d);
    }
    placeLink();
    updateDoors();
    updateChecks();
    follow();
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

  function build(dungeon, rooms, floors, floor, title, d) {
    // Frame the whole stage (every floor), so changing floors keeps the map still.
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const room of rooms) {
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
      const here = room.no === player.stayRoom;
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
    const doorLayer = svg("g", { class: "map-doors" });
    doorLayer.append(...doors.map((x) => x.node));
    const link = svg("polygon", { class: "map-link" });
    drawing.append(defs, shapes, stay, outlines, doorLayer, link);

    // Floors, top first, as in the game: Link's face (or the wolf's) beside his floor, outside the
    // button so every floor label lines up.
    const linkIcon = player.wolf ? ["Map_Wolf", "Wolf Link (map)"] : ["Map_Link", "Link (map)"];
    const floorButtons = dungeon && floors.length > 1 ? el("div", { className: "map-floors" },
      ...floors.map((n) => el("div", { className: "map-floor-row" },
        el("span", { className: "map-floor-marker" }, n === player.stayFloor ? iconSlot(...linkIcon, "map-floor-face", "◆") : null),
        el("button", {
          type: "button",
          className: "map-floor" + (n === floor ? " selected" : ""),
          title: n === player.stayFloor ? "Link is on this floor" : `Show ${floorLabel(n)}`,
          textContent: floorLabel(n),
          onclick: () => {
            pickedFloor = n === player.stayFloor ? null : n;
            render();
          },
        })))) : null;
    const reticle = el("div", { className: "map-reticle", hidden: true });
    reticle.innerHTML = RETICLE;
    const overlay = el("div", { className: "map-overlay" });
    const boss = d ? bossMark(d, rooms, floor) : null;
    if (boss) overlay.append(boss.node);
    const checks = buildChecks(floors.length > 1 ? floor : null);
    overlay.append(...checks.map((c) => c.node));
    const frame = el("div", { className: "map-frame " + (dungeon ? "parchment" : "field"), title: "Click: zoom in · Right-click: zoom out · Drag: move" }, drawing, overlay, reticle);
    const zoomBar = zoomIndicator();
    scene = { kind: "stage", svg: drawing, link, frame, base, size, floor, rooms: roomBoxes(rooms, floor), doors, boss, checks, zoomBar, offset: { x: 0, z: 0 } };
    bindFrame(frame, reticle);
    root.replaceChildren(el("div", { className: "map-pane" + (floorButtons ? " has-floors" : "") },
      titleBar(title),
      checkSource ? filterBar() : null,
      checkSource && !checks.length && !checksElsewhere() ? el("p", { className: "map-check-note", textContent: map.checks?.length
        ? "None of the checks found in this place's rooms is in the check list."
        : `No checks found in this place's rooms yet (${map.checkRooms ?? 0} room files read; more are read as rooms load).` }) : null,
      el("div", { className: "map-layout" },
        floorButtons,
        el("div", { className: "map-stage" }, frame, zoomBar.node),
        d ? dungeonItems(d) : null),
      noticeBox(),
      reqPanel()));
    if (view) view = clampView(view);
    applyView();
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
      if (door.kind === "key" || door.kind === "boss") {
        const lock = door.kind === "boss" ? LOCK_BIG : LOCK_SMALL;
        const mark = svg("g", { class: "map-door-mark map-door-lock" });
        mark.innerHTML = `<g class="detail-high">${lock.high}</g><g class="detail-low">${lock.low}</g>`;
        node.append(mark);
        marks.push(mark);
      }
      // Any door can be barred (a room that shuts behind Link): the sign is there, shown when so.
      const bar = svg("g", { class: "map-door-mark map-door-bar" });
      bar.innerHTML = NO_ENTRY;
      node.append(bar);
      marks.push(bar);
      node.setAttribute("transform", `translate(${door.x} ${door.z})`);
      square.setAttribute("transform", `rotate(${(door.angle / 65536) * 360})`);
      const title = svg("title");
      node.prepend(title);
      const item = { node, square, marks, index, kind: door.kind, state: "", title, label: `${door.name} · ${door.kind} · rooms ${door.rooms[0]} / ${door.rooms[1]}` };
      setDoorState(item, door.closed ? "C" : door.locked === true ? "L" : door.locked === false ? "U" : "O");
      out.push(item);
    });
    return out;
  }

  // A door's state letter from the mod (L locked, U unlocked, C barred, O open, ? unknown).
  function setDoorState(door, letter) {
    let state = { L: "locked", U: "unlocked", C: "barred", O: "open" }[letter] ?? (door.kind === "key" || door.kind === "boss" ? "locked" : "open");
    if (state === "open" && (door.kind === "key" || door.kind === "boss")) state = "unlocked";
    if (state === door.state) return;
    door.node.classList.remove(door.state || "none");
    door.node.classList.add(state);
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
    }
    // HTML marks over the map: the boss and the checks.
    const fr = scene.frame.getBoundingClientRect();
    const off = rect.left - fr.left - scene.frame.clientLeft;
    const offY = rect.top - fr.top - scene.frame.clientTop;
    const place = (node, at, px) => {
      const x = (at.x - vb.x) / k + (rect.width - vb.width / k) / 2;
      const y = (at.y - vb.y) / k + (rect.height - vb.height / k) / 2;
      Object.assign(node.style, { width: `${px}px`, height: `${px}px`, transform: `translate(${off + x - px / 2}px, ${offY + y - px / 2}px)` });
    };
    if (scene.boss) place(scene.boss.node, scene.boss.at, 26 + 4 * Math.log2(view.zoom));
    const checkPx = 16 + 2 * Math.log2(view.zoom);
    for (const c of scene.checks ?? []) place(c.node, c.at, checkPx);
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

  // ---- Checks on the map ----

  // Markers for the checks the mod found in this stage's rooms, with the status of their marker
  // in Checks; only those on the floor shown (floor null: every one).
  function buildChecks(floor) {
    if (!checkSource || !map.checks?.length) return [];
    const byKey = new Map(checkSource.list().map((c) => [c.key, c]));
    const out = [];
    for (const place of map.checks) {
      const info = byKey.get(place.key);
      if (!info || (floor !== null && place.floor !== floor)) continue;
      const node = el("button", { type: "button", className: `map-check ${info.status}`, title: `${info.name}\nClick: requirement · Right-click: show in Checks` },
        el("span", { className: "loc-dot" }));
      node.addEventListener("pointerdown", (e) => e.stopPropagation());
      node.addEventListener("pointerup", (e) => e.stopPropagation());
      node.addEventListener("click", (e) => {
        e.stopPropagation();
        if (checkSource.bothShown()) checkSource.jump(info.name);
        else {
          reqName = reqName === info.name ? null : info.name;
          showReq();
        }
      });
      node.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        checkSource.jump(info.name);
      });
      node.hidden = !checkFilter.has(info.status);
      out.push({ node, at: { x: place.x, y: place.z }, name: info.name, status: info.status });
    }
    return out;
  }

  // Whether some check of this place is in the check list (on another floor than the one shown).
  function checksElsewhere() {
    if (!map.checks?.length) return false;
    const keys = new Set(checkSource.list().map((c) => c.key));
    return map.checks.some((c) => keys.has(c.key));
  }

  // Statuses change as items come in: the markers follow, and the filter hides or shows them.
  function updateChecks() {
    if (!scene?.checks?.length) return;
    const status = new Map(checkSource.list().map((c) => [c.name, c.status]));
    for (const c of scene.checks) {
      const now = status.get(c.name) ?? "unknown";
      if (now !== c.status) {
        c.node.classList.replace(c.status, now);
        c.status = now;
      }
      c.node.hidden = !checkFilter.has(c.status);
    }
    if (reqName) showReq(false);
  }

  function filterBar() {
    return el("div", { className: "map-filter", role: "group", ariaLabel: "Checks shown on the map" },
      el("span", { className: "map-filter-label", textContent: "Checks:" }),
      ...CHECK_STATUSES.map(([status, label]) => el("label", { className: `map-filter-item ${status}` },
        el("input", { type: "checkbox", checked: checkFilter.has(status), onchange: (e) => {
          if (e.target.checked) checkFilter.add(status);
          else checkFilter.delete(status);
          try { localStorage.setItem(FILTER_KEY, JSON.stringify([...checkFilter])); } catch { /* not kept */ }
          updateChecks();
        } }),
        el("span", { className: "map-check " + status }, el("span", { className: "loc-dot" })), label)));
  }

  // The requirement of the check clicked on the map, under it.
  function reqPanel() {
    return el("div", { className: "map-req", hidden: true });
  }

  let reqShown = "";
  function showReq(force = true) {
    const box = root.querySelector(".map-req");
    if (!box) return;
    const body = reqName ? checkSource?.requirement(reqName) : null;
    if (!body) {
      box.hidden = true;
      box.replaceChildren();
      reqShown = "";
      return;
    }
    // Redrawn only when its content changes (statuses update a few times a second).
    const html = body.outerHTML;
    if (!force && html === reqShown) return;
    reqShown = html;
    box.hidden = false;
    box.replaceChildren(body, el("button", { type: "button", className: "tool map-req-close", textContent: "Close", onclick: () => { reqName = null; showReq(); } }));
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
    if (!scene || scene.kind === "stage") return zoomTo(level + 1, at);
    if (anim) return;
    if (scene.kind === "world") {
      // Into the province clicked, or Link's.
      const region = (at && regionAt(at)) ?? fieldPlace()?.region;
      return switchField("region", region);
    }
    // Back to the stage Link is in: zoom onto it, then show its own map.
    const place = fieldPlace();
    const b = place && scene.stageBoxes.get(place.stage);
    if (!b) return switchStage();
    goTo({ x: b.x, y: b.y, zoom: span(scene.base, 1) / Math.max(b.w, b.h) }, true, switchStage);
  }

  function zoomOut(at) {
    if (!scene || scene.kind === "stage") {
      if (level > 0) return zoomTo(level - 1, at);
      if (anim) return;
      if (fieldPlace()) return switchField("region", fieldPlace().region);
      if (map?.stage.startsWith("D_")) return;
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
    const regions = mode === "world" ? field.regions : field.regions.filter((r) => r.no === fieldRegion);
    const key = JSON.stringify([mode, fieldRegion, map.stage, player.stayRoom, visited?.stages]);
    if (key !== sceneKey || from) {
      sceneKey = key;
      buildField(regions, place, from);
    }
    placeLink();
  }

  function buildField(regions, place, from) {
    const drawing = svg("svg", { class: "map-svg", preserveAspectRatio: "xMidYMid meet" });
    const shapes = svg("g", { class: "map-shapes" });
    const stay = svg("g", { class: "map-shapes map-stay" });
    const outlines = svg("g", { class: "map-outlines" });
    const all = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    const stageBoxes = new Map();
    const regionBoxes = new Map();
    for (const region of regions) {
      const rb = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
      for (const stage of region.stages) {
        if (!shownStage(stage)) continue;
        const ox = region.x + stage.x;
        const oz = region.z + stage.z;
        const here = place?.stage === stage;
        const sb = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
        for (const room of stage.rooms) {
          const v = room.vertices.map((n, i) => n + (i % 2 ? oz : ox));
          for (const f of room.floors) for (const g of f.groups) {
            if (!g.shown) continue;
            for (const p of g.polys) {
              if (p.type & 0x80) continue;
              const color = FIELD[p.type & 0x3f] ?? FIELD[0];
              (here ? stay : shapes).append(svg("path", { d: stripPath(v, p.strip), fill: color, stroke: color, "stroke-width": 40, "stroke-linejoin": "round" }));
              for (const i of p.strip) {
                sb.minX = Math.min(sb.minX, v[i * 2]); sb.maxX = Math.max(sb.maxX, v[i * 2]);
                sb.minZ = Math.min(sb.minZ, v[i * 2 + 1]); sb.maxZ = Math.max(sb.maxZ, v[i * 2 + 1]);
              }
            }
            for (const l of g.lines) {
              if (l.type & 0x80 || l.width < 1 || l.width > 2) continue;
              outlines.append(svg("path", { d: linePath(v, l.strip), class: `map-line w${l.width}`, stroke: OUTLINE.field }));
            }
          }
        }
        if (sb.minX === Infinity) continue;
        stageBoxes.set(stage, { x: (sb.minX + sb.maxX) / 2, y: (sb.minZ + sb.maxZ) / 2, w: sb.maxX - sb.minX, h: sb.maxZ - sb.minZ });
        for (const k of ["minX", "minZ"]) { rb[k] = Math.min(rb[k], sb[k]); all[k] = Math.min(all[k], sb[k]); }
        for (const k of ["maxX", "maxZ"]) { rb[k] = Math.max(rb[k], sb[k]); all[k] = Math.max(all[k], sb[k]); }
      }
      if (rb.minX !== Infinity) regionBoxes.set(region, { x: (rb.minX + rb.maxX) / 2, y: (rb.minZ + rb.maxZ) / 2, w: rb.maxX - rb.minX, h: rb.maxZ - rb.minZ });
    }
    if (all.minX === Infinity) {
      mode = "stage";
      return switchStage();
    }
    const size = Math.max(all.maxX - all.minX, all.maxZ - all.minZ, 1);
    const pad = size * 0.05;
    const base = { x: all.minX - pad, y: all.minZ - pad, w: all.maxX - all.minX + pad * 2, h: all.maxZ - all.minZ + pad * 2 };
    const link = svg("polygon", { class: "map-link" });
    drawing.append(shapes, stay, outlines, link);
    const reticle = el("div", { className: "map-reticle", hidden: true });
    reticle.innerHTML = RETICLE;
    const hint = mode === "world" ? "Click: zoom into a province" : "Click: back to this place · Right-click: all of Hyrule";
    const frame = el("div", { className: "map-frame field", title: hint }, drawing, el("div", { className: "map-overlay" }), reticle);
    const zoomBar = zoomIndicator();
    const regionNo = mode === "region" ? fieldRegion : null;
    const title = mode === "world" ? "Hyrule" : PROVINCES[regionNo] ?? `Region ${regionNo}`;
    scene = { kind: mode, svg: drawing, link, frame, base, size, floor: null, rooms: new Map(), doors: [], boss: null, zoomBar,
      offset: place ? { x: place.x, z: place.z } : { x: 0, z: 0 }, linkShown: !!place && (mode === "world" || place.region.no === regionNo),
      stageBoxes, regionBoxes };
    bindFrame(frame, reticle);
    root.replaceChildren(el("div", { className: "map-pane" },
      titleBar(title),
      el("div", { className: "map-layout" }, el("div", { className: "map-stage" }, frame, zoomBar.node))));
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

  // A point of the frame (client px) in map units.
  function toMap(e) {
    const r = scene.svg.getBoundingClientRect();
    const vb = scene.svg.viewBox.baseVal;
    const k = Math.max(vb.width / r.width, vb.height / r.height); // "meet" scale
    return { x: vb.x + vb.width / 2 + (e.clientX - (r.left + r.width / 2)) * k, y: vb.y + vb.height / 2 + (e.clientY - (r.top + r.height / 2)) * k, k };
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
      view = clampView({ zoom: press.view.zoom, x: press.view.x - dx * k, y: press.view.y - dy * k });
      applyView();
      frame.classList.add("dragging");
    });
    const release = (e) => {
      if (!press) return;
      const wasDrag = press.dragged;
      press = null;
      pressing = false;
      frame.classList.remove("dragging");
      if (!wasDrag && e.type === "pointerup") zoomIn(toMap(e));
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
        const stage = scene?.kind === "stage";
        dots.forEach((dot, n) => dot.classList.toggle("on", stage && LEVELS.length - 1 - n === level));
        up.disabled = stage && level >= LEVELS.length - 1;
        down.disabled = stage ? level <= 0 && map?.stage.startsWith("D_") : scene?.kind === "world";
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

  return { setVisible, render };
}
