// Map sub-tab of Locations: the map of the stage Link is in, drawn from the game's own map data
// (/map, read by the mod from the rooms the game has loaded), with Link on it (/map-player).
// The shapes are the game's: triangle strips over each room's x/z vertices, by floor; their type
// picks the color (floor, raised floor, water, lava, ...), as in the game's maps.

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
const MAX_ZOOM = 8;

// The map cursor: a ring of four ticks turning around a dot, like the game's map cursor (original).
const RETICLE = `<svg viewBox="-20 -20 40 40" aria-hidden="true"><g class="map-reticle-ring" fill="none" stroke-linecap="round">
<circle r="13" stroke="#0a3a48" stroke-width="4" stroke-dasharray="12 8.42" stroke-dashoffset="6" opacity="0.6"/>
<circle r="13" stroke="#62e8ff" stroke-width="2.2" stroke-dasharray="12 8.42" stroke-dashoffset="6"/>
<path d="M0 -17v4M17 0h-4M0 17v-4M-17 0h4" stroke="#bff6ff" stroke-width="2.4"/></g>
<circle r="2.2" fill="#e8fdff"/></svg>`;
const MAP_MS = 3000; // the map itself (switches, visited rooms) besides stage changes

// Fill colors by shape type (the low 6 bits). Overworld maps are teal, dungeon maps green; a
// dungeon room is brighter while Link is in it and dull until visited.
const FIELD = { 0: "#2f8572", 1: "#56b39a", 2: "#3f9a84", 5: "#2f86e6", 8: "#7c2116" };
const DUNGEON = {
  on: { 0: "#1d7a2b", 1: "#3daa45", 2: "#2a9a7c", 5: "#2d6fd8", 8: "#5e0f0c" },
  stay: { 0: "#2ea83d", 1: "#68d863", 2: "#3cc2a0", 5: "#4a98ff", 8: "#82170f" },
  off: { 0: "#2c4a31", 1: "#3c5f40", 2: "#355a52", 5: "#2f4a78", 8: "#3e1715" },
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
export function createMapView(root, { getState, regionName, makeIcon }) {
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
  let scene = null; // { svg, link, frame, base: {x, y, w, h}, size, floor }
  // Zoom (1 = whole stage) and the point at the middle of the view, kept while on one stage.
  let zoom = 1;
  let center = null;
  let zoomStage = "";

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
        if (player.stayFloor !== undefined && player.stayFloor !== lastStayFloor) {
          lastStayFloor = player.stayFloor;
          pickedFloor = null;
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

  function setVisible(on) {
    visible = on;
    if (on && !timer) tick();
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
    if (!map.exists) return message("This place has no map.");
    const dungeon = map.stage.startsWith("D_");
    const rooms = drawnRooms(dungeon);
    const floors = [...new Set(rooms.flatMap((r) => r.floors.map((f) => f.no)))].sort((a, b) => b - a);
    const floor = pickedFloor ?? player.stayFloor ?? floors[floors.length - 1] ?? 0;
    const title = regionName(map.stage, map.stayRoom) ?? map.stage;
    const d = dungeon ? findDungeon(title) : null;
    const items = getState()?.items ?? {};
    const key = JSON.stringify([mapVersion, map.stage, floor, player.stayRoom, player.stayFloor, player.wolf, title,
      d, d?.name === "Goron Mines" ? items["Goron Mines Key Shard"] : 0]);
    if (key !== sceneKey) {
      sceneKey = key;
      if (zoomStage !== map.stage) {
        zoomStage = map.stage;
        zoom = 1;
        center = null;
      }
      build(dungeon, rooms, floors, floor, title, d);
    }
    placeLink();
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
    const link = svg("polygon", { class: "map-link" });
    drawing.append(shapes, stay, outlines, link);

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
    const frame = el("div", { className: "map-frame " + (dungeon ? "parchment" : "field"), title: "Click: zoom in · Right-click: zoom out · Drag: move" }, drawing, reticle);
    scene = { svg: drawing, link, frame, base, size, floor };
    applyView();
    bindFrame(frame, reticle);
    const below = floorButtons || d ? el("div", { className: "map-below" }, floorButtons, d ? dungeonItems(d) : null) : null;
    root.replaceChildren(el("div", { className: "map-pane" },
      el("div", { className: "loc-banner map-title" }, el("span", { className: "loc-banner-title", textContent: title })),
      frame, below));
  }

  // Link: a yellow arrowhead toward where he faces (angle 0 = +z), on Link's floor only.
  function placeLink() {
    if (!scene) return;
    const shown = player.player && (player.stayFloor === undefined || player.stayFloor === scene.floor);
    scene.link.style.display = shown ? "" : "none";
    if (!shown) return;
    const a = (player.player.angle / 65536) * Math.PI * 2;
    const s = (scene.size * 0.022) / Math.sqrt(zoom);
    const { x, z } = player.player;
    const pt = (ang, r) => `${x + Math.sin(ang) * r},${z + Math.cos(ang) * r}`;
    scene.link.setAttribute("points", `${pt(a, s * 1.5)} ${pt(a + 2.45, s)} ${pt(a - 2.45, s)}`);
    scene.link.setAttribute("stroke-width", s * 0.18);
  }

  // ---- Zoom and drag ----

  function applyView() {
    const { base } = scene;
    const w = base.w / zoom;
    const h = base.h / zoom;
    const c = center ?? { x: base.x + base.w / 2, y: base.y + base.h / 2 };
    // Keep the view on the map.
    const cx = Math.min(Math.max(c.x, base.x + w / 2), base.x + base.w - w / 2);
    const cy = Math.min(Math.max(c.y, base.y + h / 2), base.y + base.h - h / 2);
    center = zoom > 1 ? { x: cx, y: cy } : null;
    scene.svg.setAttribute("viewBox", `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
    scene.frame.classList.toggle("zoomed", zoom > 1);
  }

  // A point of the frame (client px) in map units.
  function toMap(e) {
    const r = scene.svg.getBoundingClientRect();
    const vb = scene.svg.viewBox.baseVal;
    const k = Math.max(vb.width / r.width, vb.height / r.height); // "meet" scale
    return { x: vb.x + vb.width / 2 + (e.clientX - (r.left + r.width / 2)) * k, y: vb.y + vb.height / 2 + (e.clientY - (r.top + r.height / 2)) * k, k };
  }

  function zoomAt(e, factor) {
    const next = Math.min(MAX_ZOOM, Math.max(1, zoom * factor));
    if (next === zoom) return;
    const p = toMap(e);
    const c = center ?? { x: scene.base.x + scene.base.w / 2, y: scene.base.y + scene.base.h / 2 };
    // Keep the clicked point under the cursor.
    center = { x: p.x - (p.x - c.x) * (zoom / next), y: p.y - (p.y - c.y) * (zoom / next) };
    zoom = next;
    applyView();
    placeLink();
  }

  function bindFrame(frame, reticle) {
    let press = null;
    frame.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      press = { x: e.clientX, y: e.clientY, center: center && { ...center }, dragged: false, id: e.pointerId };
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
      press.dragged = true;
      if (zoom <= 1) return;
      const { k } = toMap(e);
      const c = press.center ?? { x: scene.base.x + scene.base.w / 2, y: scene.base.y + scene.base.h / 2 };
      center = { x: c.x - dx * k, y: c.y - dy * k };
      applyView();
      frame.classList.add("dragging");
    });
    const release = (e) => {
      if (!press) return;
      const wasDrag = press.dragged;
      press = null;
      frame.classList.remove("dragging");
      if (!wasDrag && e.type === "pointerup") zoomAt(e, 2);
    };
    frame.addEventListener("pointerup", release);
    frame.addEventListener("pointercancel", release);
    frame.addEventListener("pointerleave", () => { reticle.hidden = true; });
    frame.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      zoomAt(e, 0.5);
    });
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
