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
 */
export function createMapView(root, { getState, regionName }) {
  let visible = false;
  let map = null; // last /map
  let player = null; // last /map-player
  let mapTime = 0;
  let pickedFloor = null; // a floor chosen by hand, until Link changes floor or stage
  let lastStayFloor = null;
  let timer = null;
  let busy = false;

  async function tick() {
    timer = null;
    if (!visible) return;
    if (!busy && getState()?.inGame) {
      busy = true;
      try {
        player = await (await fetch("map-player", { cache: "no-store" })).json();
        if (!map || map.stage !== player.stage || Date.now() - mapTime > MAP_MS) {
          map = await (await fetch("map", { cache: "no-store" })).json();
          mapTime = Date.now();
        }
        if (player.stayFloor !== lastStayFloor) {
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

  function render() {
    if (!visible) return;
    if (!getState()?.inGame) {
      root.replaceChildren(el("p", { className: "empty", textContent: "Waiting for a save file…" }));
      return;
    }
    if (!map || !player) {
      root.replaceChildren(el("p", { className: "empty", textContent: "Loading the map…" }));
      return;
    }
    if (!map.exists) {
      root.replaceChildren(el("p", { className: "empty", textContent: "This place has no map." }));
      return;
    }
    const dungeon = map.stage.startsWith("D_");
    const rooms = drawnRooms(dungeon);
    const floors = [...new Set(rooms.flatMap((r) => r.floors.map((f) => f.no)))].sort((a, b) => b - a);
    const floor = pickedFloor ?? player.stayFloor ?? floors[floors.length - 1] ?? 0;

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

    const drawing = svg("svg", { class: "map-svg", viewBox: `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`, preserveAspectRatio: "xMidYMid meet" });
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
    drawing.append(shapes, stay, outlines);

    // Link: a yellow arrowhead toward where he faces (angle 0 = +z), on Link's floor only.
    if (player.player && (player.stayFloor === undefined || player.stayFloor === floor)) {
      const a = (player.player.angle / 65536) * Math.PI * 2;
      const s = size * 0.022;
      const { x, z } = player.player;
      const pt = (ang, r) => `${x + Math.sin(ang) * r},${z + Math.cos(ang) * r}`;
      drawing.append(svg("polygon", { class: "map-link", points: `${pt(a, s * 1.5)} ${pt(a + 2.45, s)} ${pt(a - 2.45, s)}`, "stroke-width": s * 0.18 }));
    }

    const title = regionName(map.stage, map.stayRoom) ?? map.stage;
    const floorButtons = dungeon && floors.length > 1 ? el("div", { className: "map-floors" },
      ...floors.map((n) => el("button", {
        type: "button",
        className: "tool map-floor" + (n === floor ? " selected" : "") + (n === player.stayFloor ? " here" : ""),
        title: n === player.stayFloor ? "Link is on this floor" : "",
        textContent: floorLabel(n),
        onclick: () => {
          pickedFloor = n === player.stayFloor ? null : n;
          render();
        },
      }))) : null;
    root.replaceChildren(el("div", { className: "map-pane" },
      el("div", { className: "loc-banner map-title" }, el("span", { className: "loc-banner-title", textContent: title })),
      el("div", { className: "map-body" + (floorButtons ? " with-floors" : "") }, floorButtons, el("div", { className: "map-frame" }, drawing))));
  }

  return { setVisible, render };
}
