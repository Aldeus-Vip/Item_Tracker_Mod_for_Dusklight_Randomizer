#!/usr/bin/env node
// Development stand-in for the mod's HTTP server: serves res/web and streams a fake,
// slowly progressing playthrough over /events so the page can be built without the game.
//
//   node tools/mock_server.mjs [port]      (default 38100)
//
// Icons: set ICON_DIR to a folder of icon PNGs (default ./icons, which is git-ignored), and
// GAME_ICON_DIR to a folder of <item number>.png standing in for the icons the mod builds from the
// game data (/game-icons/, 404 when unset).
// Locations tab: set RANDO_DATA to a dusklight-randomizer checkout's generator/data folder
// (optionally RANDO_SETTINGS to a randomizer settings.yaml, and SEEDS_DIR to a folder of
// <hash>/<hash> Spoiler Log.txt standing in for the randomizer's seeds).

import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 38100);
const webRoot = fileURLToPath(new URL("../res/web/", import.meta.url));
const iconRoot = process.env.ICON_DIR ?? fileURLToPath(new URL("../icons/", import.meta.url));
const gameIconRoot = process.env.GAME_ICON_DIR;
const uploadedIcons = {};
const randoRoot = process.env.RANDO_DATA;
const randoSettings = process.env.RANDO_SETTINGS;
const seedsRoot = process.env.SEEDS_DIR;

// Raw save flags in the mod's format (docs/protocol.md): 32 stage tables + events.
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
const flagBytes = {
  events: new Array(256).fill(0),
  stages: Array.from({ length: 32 }, () => ({ t: new Array(8).fill(0), s: new Array(16).fill(0), i: new Array(8).fill(0) })),
};
const setBit = (arr, n) => (arr[n >> 3] |= 1 << (n & 7));
function flagsJson() {
  return {
    currentStage: 0,
    events: hex(flagBytes.events),
    stages: flagBytes.stages.map((st) => ({ t: hex(st.t), s: hex(st.s), i: hex(st.i) })),
    currentItems: hex(new Array(24).fill(0)),
  };
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const DUNGEONS = [
  ["Forest Temple", 4, true],
  ["Goron Mines", 3, false],
  ["Lakebed Temple", 3, true],
  ["Arbiters Grounds", 5, true],
  ["Snowpeak Ruins", 4, true],
  ["Temple of Time", 3, true],
  ["City in the Sky", 1, true],
  ["Palace of Twilight", 7, true],
  ["Hyrule Castle", 3, true],
];

const state = {
  protocol: 1,
  inGame: true,
  stage: "F_SP103",
  room: 0,
  maxLife: 15,
  // What was found without collecting it (the mod keeps this with the save).
  found: { seed: "", entries: [] },
  time: { hour: 14, night: false },
  twilightCleared: { Faron: true, Eldin: false, Lanayru: false },
  items: {
    "Progressive Sword": 1,
    "Ordon Shield": 1,
    "Progressive Fishing Rod": 1,
    Slingshot: 1,
    "Progressive Wallet": 0,
  },
  ammo: { seeds: 30, seedsMax: 50, arrows: 0, arrowsMax: 30, oil: 0, oilMax: 21600, rupees: 35, rupeesMax: 300 },
  bombBags: [],
  bottles: [],
  dungeons: DUNGEONS.map(([name, maxSmallKeys, hasBigKey]) => ({
    name,
    smallKeys: 0,
    smallKeysHeld: 0,
    maxSmallKeys,
    hasBigKey,
    bigKey: false,
    map: false,
    compass: false,
    bossDefeated: false,
  })),
};

// Scripted progression, one step per tick.
const script = [
  () => Object.assign(state.items, { Lantern: 1 }) && Object.assign(state.ammo, { oil: 16000 }),
  () => (state.items["Shadow Crystal"] = 1),
  () => state.bottles.push({ item: 0x64, count: 0 }),
  () => Object.assign(state.dungeons[0], { smallKeys: 1, smallKeysHeld: 1, map: true }),
  () => (state.items["Gale Boomerang"] = 1),
  () => (state.time = { hour: 21, night: true }),
  () => state.found.entries.push("hint:Ordon Sword"), // read a hint sign
  () => Object.assign(state.items, { "Male Ant": 1, "Female Beetle": 1, "Golden Bug": 2 }),
  () => state.found.entries.push("check:freestanding:F_SP103:128"), // walked past Ordon Bo Cliff Rupee
  () => Object.assign(state, { stage: "R_SP01", room: 1 }), // Sera's shop
  () => Object.assign(state, { stage: "F_SP108", room: 0 }), // South Faron Woods
  () => (state.items["North Faron Woods Gate Key"] = 1),
  // Wooden Sword Chest (stage 65 -> save table 0, treasure box 4) and Links Basement Chest (box 1)
  () => setBit(flagBytes.stages[0].t, 4) && setBit(flagBytes.stages[0].t, 1),
  () => Object.assign(state.items, { "Faron Woods Coro Key": 1 }),
  () => Object.assign(state.dungeons[0], { smallKeys: 4, smallKeysHeld: 0, bigKey: true, compass: true }),
  () => {
    state.dungeons[0].bossDefeated = true;
    state.items["Progressive Fused Shadow"] = 1;
  },
  () => state.bombBags.push({ item: 0x70, count: 13, max: 30 }),
  () => (state.items["Iron Boots"] = 1),
  () => Object.assign(state.items, { "Progressive Sky Book": 3, "Sky Book Characters": 2 }),
  () => {
    state.items["Progressive Bow"] = 2;
    Object.assign(state.ammo, { arrows: 60, arrowsMax: 60 });
  },
  () => state.bottles.push({ item: 0x76, count: 5 }),
  () => state.bombBags.push({ item: 0x50, count: 0, max: 0 }) && (state.items["Giant Bomb Bag"] = 1),
  () => (state.items["Progressive Clawshot"] = 1),
  () => Object.assign(state.items, { "Progressive Wallet": 1, "Poe Soul": 7, "Goron Mines Key Shard": 2, "Progressive Hidden Skill": 3 }) && (state.ammo.rupees = 412),
  () => Object.assign(state.items, { "Progressive Clawshot": 2, "Ordon Pumpkin": 1, "Wooden Shield": 1 }),
];
let step = 0;

const streams = new Set();
const saved = {}; // path -> { type, body }: stand-in for layout.json / settings.json / background
const event = () => `event: state\ndata: ${JSON.stringify({ ...state, flags: flagsJson() })}\n\n`;

setInterval(() => {
  if (step < script.length) {
    script[step++]();
    for (const res of streams) res.write(event());
  }
}, Number(process.env.TICK_MS ?? 3000));

createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write("retry: 2000\n\n" + event());
    streams.add(res);
    req.on("close", () => streams.delete(res));
    return;
  }
  // Saved configuration, kept in memory (the mod stores these in its data directory).
  if (path === "/layout" || path === "/settings" || path === "/background") {
    if (req.method === "POST" || req.method === "DELETE") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      saved[path] = req.method === "DELETE" ? null : { type: req.headers["content-type"], body: Buffer.concat(chunks) };
      for (const stream of streams) stream.write("event: config\ndata: {}\n\n");
      res.writeHead(200, { "Content-Type": TYPES[".json"] });
      return res.end('{"ok":true}');
    }
    if (!saved[path]) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": saved[path].type });
    return res.end(saved[path].body);
  }
  if (path.startsWith("/rando/") || path === "/rando-settings.yaml") {
    const file = path === "/rando-settings.yaml" ? randoSettings : randoRoot && join(randoRoot, normalize(decodeURIComponent(path.slice(7))));
    try {
      if (!file || file.includes("..")) throw new Error("not found");
      const body = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[".yaml"] });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (path === "/found" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    for (const [i, line] of body.split("\n").entries()) {
      if (i === 0 && line.startsWith("seed\t")) state.found.seed = line.slice(5);
      else if (line.startsWith("loc:") && !state.found.entries.includes(line)) state.found.entries.push(line);
    }
    res.writeHead(200, { "Content-Type": TYPES[".json"] });
    return res.end('{"ok":true}');
  }
  if (path.startsWith("/rando-seeds/")) {
    // SEEDS_DIR stands in for the randomizer's seeds folder (seeds/<hash>/<hash> Spoiler Log.txt).
    const hash = decodeURIComponent(path.slice(13));
    try {
      if (!seedsRoot || hash.includes("/") || hash.includes("..")) throw new Error("not found");
      if (hash === "") {
        const list = [];
        for (const d of await readdir(seedsRoot, { withFileTypes: true })) {
          if (!d.isDirectory()) continue;
          const spoiler = await readFile(join(seedsRoot, d.name, `${d.name} Spoiler Log.txt`)).then(() => true, () => false);
          list.push({ hash: d.name, spoiler });
        }
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        return res.end(JSON.stringify(list));
      }
      const body = await readFile(join(seedsRoot, hash, `${hash} Spoiler Log.txt`));
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (path === "/state") {
    res.writeHead(200, { "Content-Type": TYPES[".json"] });
    res.end(JSON.stringify(state));
    return;
  }
  if (path.startsWith("/game-textures/itemicon/")) {
    // Stand-in for the game's item icon archive: the PNGs in ICON_DIR as "<name>.bti".
    const rest = decodeURIComponent(path.slice(24));
    try {
      if (rest === "") {
        const names = (await readdir(iconRoot)).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ".bti"));
        res.writeHead(200, { "Content-Type": TYPES[".json"] });
        return res.end(JSON.stringify(names));
      }
      const file = rest === "#61.png" ? "Hidden_Skill.png" : rest.replace(/\.bti\.png$/, ".png");
      if (!/^[\w.'-]+\.png$/.test(file)) return res.writeHead(404).end();
      const body = await readFile(join(iconRoot, file));
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (path.startsWith("/game-icons/")) {
    const name = path.slice(12);
    if (!gameIconRoot || !/^\d{1,3}\.png$/.test(name)) return res.writeHead(404).end();
    try {
      const body = await readFile(join(gameIconRoot, name));
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  if (path.startsWith("/icons/") && req.method !== "GET") {
    // Icon uploads and deletes from the icon editor, kept in memory.
    const name = decodeURIComponent(path.slice(7));
    if (req.method === "DELETE") delete uploadedIcons[name];
    else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      uploadedIcons[name] = Buffer.concat(chunks);
    }
    res.writeHead(200, { "Content-Type": TYPES[".json"] });
    return res.end('{"ok":true}');
  }
  if (path.startsWith("/icons/") && uploadedIcons[decodeURIComponent(path.slice(7))]) {
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(uploadedIcons[decodeURIComponent(path.slice(7))]);
  }
  if (path.startsWith("/icons/")) {
    const name = decodeURIComponent(path.slice(7));
    if (!/^[\w.'-]+\.png$/.test(name)) return res.writeHead(404).end();
    try {
      const body = await readFile(join(iconRoot, name));
      res.writeHead(200, { "Content-Type": "image/png" });
      return res.end(body);
    } catch {
      return res.writeHead(404).end();
    }
  }
  const file = normalize(path === "/" ? "index.html" : path.slice(1));
  if (file.startsWith("..")) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(join(webRoot, file));
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("404 Not Found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`mock tracker server: http://127.0.0.1:${port}/`);
});
