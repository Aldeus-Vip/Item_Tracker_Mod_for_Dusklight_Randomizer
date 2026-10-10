// The map data editor (editor.html): the mod's fixed map data edited on the tracker's own maps —
// checks' places, the Areas checks are listed under, entrances moved / added / removed — and the
// items seen without the line-of-sight test. Nothing is saved in the mod: the two files are
// downloaded (map_presets.json, seen_without_sight.txt) to replace the mod's.
import { createLocationsView } from "./locations_view.js";
import { createMapView } from "./map_view.js";
import { GAME_ICON_IDS } from "./layout.js";

const PROTOCOL_VERSION = 1;
const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

// ---- The files ----

let presets = emptyPresets();
let sightText = ""; // seen_without_sight.txt as loaded (its comments are kept)
let sight = new Set(); // its check keys
let changes = 0;

function emptyPresets() {
  return { _comment: "", places: {}, checkAreas: {}, entranceFixes: { moved: {}, added: [], hidden: [] }, placeFixes: {} };
}
function readPresets(raw) {
  const out = emptyPresets();
  if (!raw || typeof raw !== "object") return out;
  out._comment = typeof raw._comment === "string" ? raw._comment : "";
  if (raw.places && typeof raw.places === "object") out.places = raw.places;
  if (raw.checkAreas && typeof raw.checkAreas === "object") out.checkAreas = raw.checkAreas;
  const ef = raw.entranceFixes ?? {};
  out.entranceFixes = {
    moved: ef.moved && typeof ef.moved === "object" ? ef.moved : {},
    added: Array.isArray(ef.added) ? ef.added : [],
    hidden: Array.isArray(ef.hidden) ? ef.hidden : [],
  };
  if (raw.placeFixes && typeof raw.placeFixes === "object") out.placeFixes = raw.placeFixes;
  return out;
}
function readSight(text) {
  sightText = text;
  sight = new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")));
}
// The list again: the lines of keys taken out go (with the "# name" line just above them), the
// keys put in are added at the end, each under its check's name.
function writeSight() {
  const out = [];
  const kept = new Set();
  for (const line of sightText.split(/\r?\n/)) {
    const key = line.trim();
    if (key && !key.startsWith("#")) {
      if (!sight.has(key)) {
        if (out.length && out[out.length - 1].startsWith("# ") && (out.length < 2 || out[out.length - 2].trim() === "")) out.pop();
        continue;
      }
      kept.add(key);
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  const names = new Map(checks().map((c) => [c.key, c.name]));
  for (const key of sight) {
    if (kept.has(key)) continue;
    out.push("", `# ${names.get(key) ?? key}`, key);
  }
  return out.join("\n") + "\n";
}

function changed() {
  changes++;
  showStatus();
  mapView.redraw();
  renderList();
  renderDetail();
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  el("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function loadFiles() {
  try {
    const r = await fetch("map_presets.json", { cache: "no-store" });
    if (r.ok) presets = readPresets(await r.json());
  } catch { /* opened by hand */ }
  try {
    const r = await fetch("seen_without_sight.txt", { cache: "no-store" });
    if (r.ok) readSight(await r.text());
  } catch { /* opened by hand */ }
  mapView.redraw();
  renderList();
  renderDetail();
}

$("open-presets").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    presets = readPresets(JSON.parse(await file.text()));
    changes = 0;
    showStatus(`Opened ${file.name}`);
    mapView.redraw();
    renderList();
    renderDetail();
  } catch (err) {
    showStatus(`${file.name}: ${err.message}`);
  }
});
$("open-sight").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  readSight(await file.text());
  showStatus(`Opened ${file.name}`);
  renderList();
  renderDetail();
});
$("save-presets").addEventListener("click", () => {
  const { _comment, places, checkAreas, entranceFixes, placeFixes } = presets;
  download("map_presets.json", JSON.stringify({ _comment, places, checkAreas, entranceFixes, placeFixes }, null, 1) + "\n", "application/json");
});
$("save-sight").addEventListener("click", () => download("seen_without_sight.txt", writeSight(), "text/plain"));
window.addEventListener("beforeunload", (e) => {
  if (changes) e.preventDefault();
});

// ---- The game ----

let state = null;
function showStatus(note = "") {
  const game = !state ? "Connecting…" : !state.inGame ? "Load a save in the game to see the maps" : "Live";
  $("status").replaceChildren(
    note ? `${note} · ` : "",
    game,
    changes ? el("span", { className: "ed-changed", textContent: ` · ${changes} change${changes > 1 ? "s" : ""} not downloaded` }) : "");
}

// The tracker's own views: the check list (hidden: its data, logic and requirements) and the map.
const hiddenList = el("div", { hidden: true });
document.body.append(hiddenList);
const locationsView = createLocationsView(hiddenList, {
  getOverrides: () => ({}),
  getPresetOverrides: async () => ({}),
  saveOverrides: async () => {},
  getLogic: () => true,
  saveLogic: async () => {},
  saveEntries: async () => {},
  getLayoutSections: () => [],
  makeIcon: () => el("span"),
  getSeedView: () => ({ hash: null, show: false }),
  saveSeedView: async () => {},
  setStatus: () => {},
  placeOf: (key) => mapView?.placeOf(key) ?? null,
  getCheckAreas: () => presets.checkAreas,
});

function gameIcon(name, className, fallback) {
  const id = GAME_ICON_IDS[name];
  const src = typeof id === "number" ? `game-icons/${id}.png` : typeof id === "string" && id.startsWith("art/") ? id : null;
  if (!src) return fallback ?? "";
  const img = el("img", { className, alt: "", src, draggable: false });
  img.addEventListener("error", () => img.replaceWith(fallback ?? ""));
  return img;
}

const mapRoot = $("map");
const mapView = createMapView(mapRoot, {
  getState: () => state,
  regionName: (stage, room) => locationsView.regionName(stage, room),
  roomName: (stage, room) => locationsView.roomName(stage, room),
  roomVariants: (stage, room) => locationsView.roomVariants(stage, room),
  areaChecks: (area) => locationsView.areaChecks(area),
  checkRegion: (name) => locationsView.checkRegion(name),
  areaRegion: (area) => locationsView.areaRegion(area),
  roomKind: (stage, room) => locationsView.roomKind(stage, room),
  entrances: () => locationsView.entrances(),
  provinceOrder: () => locationsView.provinceOrder(),
  makeIcon: (name, className, fallback) => gameIcon(name, className, fallback),
  checks: {
    list: () => locationsView.mapChecks(),
    mount: (host, name, opts) => locationsView.mountDetail(host, name, opts),
    row: (name) => locationsView.rowFor(name),
    unmount: () => locationsView.unmountDetail(),
    focused: () => selected,
    setFocused: (name) => select(name, false),
    linked: () => false,
    clickMode: () => "left-highlight",
    listedRegion: (name) => locationsView.listedRegion(name),
    reqView: (name) => locationsView.requirementView(name),
    showDetail: () => {},
    closeDetail: () => {},
    bothShown: () => false,
    presetPlaces: () => presets.places,
    placeFixes: () => presets.placeFixes,
    entranceFixes: () => presets.entranceFixes,
    jump: (name) => select(name, false),
  },
  onPlaces: () => {
    locationsView.refresh();
    renderList();
    renderDetail();
  },
  provinceOf: (region) => locationsView.provinceOf(region),
  editor: {
    armed: () => !!armed,
    click: mapClick,
    entrance: entranceMenu,
  },
});
mapView.setVisible(true);

function connect() {
  const source = new EventSource("events");
  source.addEventListener("state", (e) => {
    try {
      const next = JSON.parse(e.data);
      if (next.protocol !== PROTOCOL_VERSION) return;
      const first = !state;
      state = next;
      locationsView.setState(state);
      mapView.render();
      if (first) showStatus();
    } catch (err) {
      console.error("bad state event", err);
    }
  });
  source.addEventListener("open", () => {
    if (!loaded) {
      loaded = true;
      locationsView.load().then(() => renderList());
    }
    showStatus();
  });
  source.addEventListener("error", () => $("status").textContent = "Game not running — retrying…");
}
let loaded = false;

// ---- Checks ----

let selected = null;
const checks = () => locationsView.mapChecks();
const placeText = (p) => (p ? `${p.stage}${p.variant ? ` (${p.variant})` : ""} · ${(p.room ?? -1) < 0 ? "any room" : `room ${p.room}`} · ${Math.round(p.x ?? 0)}, ${Math.round(p.z ?? 0)} · floor ${p.floor ?? 0}` : "");

let listKey = "";
function renderList(force = true) {
  const all = checks();
  const q = $("search").value.trim().toLowerCase();
  const onlyNone = $("only-unplaced").checked;
  const onlyEdited = $("only-edited").checked;
  const ready = mapView.placesReady();
  const key = `${all.length}|${q}|${onlyNone}|${onlyEdited}|${ready}|${selected}|${changes}`;
  if (!force && key === listKey) return;
  listKey = key;
  const rows = [];
  for (const c of all) {
    const place = mapView.checkPlace(c.name);
    const preset = !!presets.places[c.name];
    const area = presets.checkAreas[c.name];
    const seen = sight.has(c.key);
    if (onlyNone && (!ready || place)) continue;
    if (onlyEdited && !preset && !area && !seen) continue;
    if (q && !`${c.name} ${c.key} ${place?.stage ?? ""} ${area ?? ""}`.toLowerCase().includes(q)) continue;
    rows.push(el("button", { type: "button", className: "ed-row" + (c.name === selected ? " selected" : ""), onclick: () => select(c.name, true) },
      el("span", { textContent: c.name }),
      el("span", { className: "ed-tags" },
        preset ? el("span", { className: "ed-tag preset", textContent: "place", title: "Placed by the presets" }) : null,
        area ? el("span", { className: "ed-tag area", textContent: "area", title: `Listed under ${area}` }) : null,
        seen ? el("span", { className: "ed-tag sight", textContent: "no sight", title: "Seen without the line-of-sight test" }) : null,
        ready && !place ? el("span", { className: "ed-tag none", textContent: "no place" }) : null),
      el("span", { className: "ed-where", textContent: place ? placeText(place) : c.key })));
  }
  const list = $("list");
  const top = list.scrollTop;
  list.replaceChildren(...(rows.length ? rows : [el("p", { className: "ed-help", textContent: all.length ? "No check matches." : "Loading the checks…" })]));
  list.scrollTop = top;
}
for (const id of ["search", "only-unplaced", "only-edited"]) $(id).addEventListener("input", () => renderList());
// (The checks and their places come in while the game files are read.)
setInterval(() => renderList(false), 1500);

// Picks a check: in the list, its details, and (fromList) on the map.
function select(name, fromList) {
  if (name === selected && !fromList) return;
  selected = name;
  if (armed?.kind === "check") setArmed(null);
  renderList();
  renderDetail();
  if (name && fromList && mapView.checkPlace(name)) mapView.showCheck(name, false);
  if (name && !fromList) requestAnimationFrame(() => $("list").querySelector(".ed-row.selected")?.scrollIntoView({ block: "nearest" }));
}

function numberInput(value, title, cls = "") {
  return el("input", { type: "number", value: value ?? "", title, className: cls, step: "1" });
}

function renderDetail() {
  const box = $("detail");
  const c = selected && checks().find((x) => x.name === selected);
  if (!c) return box.replaceChildren();
  const now = mapView.checkPlace(c.name);
  const preset = presets.places[c.name];
  // (A preset given across its room's extent (u, v): its x, z as the map draws it.)
  const base = preset && Number.isFinite(preset.x) ? preset : now ?? preset ?? {};
  const f = {
    stage: el("input", { type: "text", value: base.stage ?? "", title: "Map (stage)", className: "ed-wide", placeholder: "stage" }),
    room: numberInput(base.room ?? 0, "Room"),
    x: numberInput(Number.isFinite(base.x) ? Math.round(base.x) : "", "x (map units)"),
    z: numberInput(Number.isFinite(base.z) ? Math.round(base.z) : "", "z (map units)"),
    floor: numberInput(base.floor ?? 0, "Floor"),
  };
  const apply = () => {
    const p = { stage: f.stage.value.trim().toUpperCase(), room: Number(f.room.value), x: Number(f.x.value), z: Number(f.z.value), floor: Number(f.floor.value) || 0 };
    if (!/^[A-Z]_[A-Z0-9_]+$/.test(p.stage) || ![p.room, p.x, p.z].every((n) => Number.isFinite(n) && f.x.value !== "" && f.z.value !== "")) {
      showStatus("Place: give a stage, a room, x and z");
      return;
    }
    if (preset?.variant) p.variant = preset.variant;
    presets.places[c.name] = p;
    changed();
  };

  // Area: the region it is listed under (empty: its logic region's).
  const logic = locationsView.checkRegion(c.name);
  const area = el("select", { title: "The region Checks lists it under",
    onchange: (e) => {
      if (e.target.value) presets.checkAreas[c.name] = e.target.value;
      else delete presets.checkAreas[c.name];
      changed();
    } },
  el("option", { value: "", textContent: `— its logic region${logic ? ` (${logic})` : ""} —` }),
  ...locationsView.regionGroups().map((g) => {
    const og = el("optgroup", { label: g.title });
    og.append(...g.regions.map((r) => el("option", { value: r, textContent: r, selected: presets.checkAreas[c.name] === r })));
    return og;
  }));
  const current = presets.checkAreas[c.name];
  if (current && !locationsView.regionGroups().some((g) => g.regions.includes(current))) {
    area.append(el("option", { value: current, textContent: current, selected: true }));
  }

  const freestanding = c.key.startsWith("freestanding:");
  const seen = el("input", { type: "checkbox", checked: sight.has(c.key), disabled: !freestanding,
    onchange: (e) => {
      if (e.target.checked) sight.add(c.key);
      else sight.delete(c.key);
      changed();
    } });

  const placing = armed?.kind === "check" && armed.name === c.name;
  box.replaceChildren(
    el("h2", { textContent: c.name }),
    el("div", { className: "ed-key", textContent: c.key }),
    el("div", { className: "ed-line" }, el("span", { className: "ed-label", textContent: "Now" }),
      el("span", { textContent: now ? `${placeText(now)} (${now.from})` : mapView.placesReady() ? "No place on the map" : "The game files are being read…" })),
    el("div", { className: "ed-line" }, el("span", { className: "ed-label", textContent: "Place" }), f.stage, "room", f.room),
    el("div", { className: "ed-line" }, el("span", { className: "ed-label" }), "x", f.x, "z", f.z, "floor", f.floor,
      el("button", { type: "button", className: "tool", textContent: "Set", title: "Place it here (presets)", onclick: apply })),
    el("div", { className: "ed-line" },
      el("button", { type: "button", className: "tool" + (placing ? " active" : ""), textContent: placing ? "Click on the map… (cancel)" : "Place on map",
        title: "Then click where it is on the map shown", onclick: () => setArmed(placing ? null : { kind: "check", name: c.name }) }),
      el("button", { type: "button", className: "tool", textContent: "Show on map", disabled: !now, onclick: () => mapView.showCheck(c.name, false) }),
      preset ? el("button", { type: "button", className: "tool", textContent: "Remove place", title: "Back to the game files' place (or none)",
        onclick: () => {
          delete presets.places[c.name];
          changed();
        } }) : null),
    el("div", { className: "ed-line" }, el("span", { className: "ed-label", textContent: "Area" }), area),
    el("label", { className: "ed-line", title: freestanding ? "Counted as seen when near and on screen, even if something blocks the line to it" : "Only items lying around (freestanding) are watched" },
      seen, "Seen without line of sight", freestanding ? null : el("span", { className: "ed-key", textContent: "(items lying around only)" })));
}

// ---- The map ----

let armed = null; // { kind: "check", name } | { kind: "move", key, added } | { kind: "add" }
function setArmed(next) {
  armed = next;
  $("add-entrance").classList.toggle("active", armed?.kind === "add");
  $("hint").textContent = !armed ? "" : armed.kind === "check" ? `Click where “${armed.name}” is` : armed.kind === "move" ? "Click where the entrance is" : "Click where the new entrance is";
  renderDetail();
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && armed) setArmed(null);
});

function mapClick(at) {
  const task = armed;
  setArmed(null);
  if (!task) return;
  if (task.kind === "check") {
    presets.places[task.name] = { stage: at.stage, room: at.room, x: at.x, z: at.z, floor: at.floor, ...(at.variant ? { variant: at.variant } : {}) };
    changed();
  } else if (task.kind === "move") {
    if (task.added) Object.assign(task.added, { x: at.x, z: at.z });
    else presets.entranceFixes.moved[task.key] = { x: at.x, z: at.z };
    changed();
    $("entrance").replaceChildren();
  } else if (task.kind === "add") {
    destinationForm(null, null, (to, toArea) => {
      presets.entranceFixes.added.push({ id: Date.now().toString(36), stage: at.stage, room: at.room, x: at.x, z: at.z, floor: at.entranceFloor,
        ...(at.variant ? { atArea: at.variant } : {}), to, ...(toArea ? { toArea } : {}) });
      changed();
    });
  }
}
$("add-entrance").addEventListener("click", () => setArmed(armed?.kind === "add" ? null : { kind: "add" }));

// An entrance's menu (right-click on it): move it, put it back, change where an added one leads,
// remove it or bring it back.
function entranceMenu(info) {
  const fixes = presets.entranceFixes;
  const button = (label, title, go) => el("button", { type: "button", className: "tool", textContent: label, title, onclick: go });
  const done = () => {
    $("entrance").replaceChildren();
    changed();
  };
  const added = info.added ? fixes.added.find((a) => a.id === info.added.id) : null;
  $("entrance").replaceChildren(
    el("h2", { textContent: `Entrance to ${info.title}` }),
    el("div", { className: "ed-key", textContent: info.key + (info.hidden ? " · removed" : info.moved ? " · moved" : added ? " · added" : "") }),
    el("div", { className: "ed-line" },
      info.hidden ? button("Bring back", "Show this entrance again", () => {
        fixes.hidden = fixes.hidden.filter((k) => k !== info.key);
        done();
      }) : button("Move", "Then click where it is on the map", () => setArmed({ kind: "move", key: info.key, added })),
      info.moved && !added ? button("Reset place", "Back where the game files put it", () => {
        delete fixes.moved[info.key];
        done();
      }) : null,
      added ? button("Leads to…", "Choose the place it leads to", () => destinationForm(added.to, added.toArea, (to, toArea) => {
        added.to = to;
        if (toArea) added.toArea = toArea;
        else delete added.toArea;
        changed();
      })) : null,
      !info.hidden ? button("Remove", added ? "Delete this added entrance" : "Take it off the maps (shown faded here)", () => {
        if (added) fixes.added = fixes.added.filter((a) => a !== added);
        else if (!fixes.hidden.includes(info.key)) fixes.hidden.push(info.key);
        delete fixes.moved[info.key];
        done();
      }) : null,
      button("Close", "", () => $("entrance").replaceChildren())));
}

// Where an added entrance leads: every place a map opens.
function destinationForm(current, currentArea, save) {
  const list = mapView.destinations();
  const groups = [...new Set(list.map((d) => d.group))];
  const pick = el("select", {},
    ...groups.map((g) => {
      const og = el("optgroup", { label: g });
      og.append(...list.map((d, i) => [d, i]).filter(([d]) => d.group === g).map(([d, i]) => el("option", { value: String(i), textContent: d.title,
        selected: !!current && d.to.stage === current.stage && (d.to.room === current.room || d.to.room < 0) && (d.toArea ?? null) === (currentArea ?? null) })));
      return og;
    }));
  $("entrance").replaceChildren(
    el("h2", { textContent: "Where does it lead?" }),
    el("div", { className: "ed-line" }, pick,
      el("button", { type: "button", className: "tool primary", textContent: "Save", onclick: () => {
        const d = list[Number(pick.value)];
        $("entrance").replaceChildren();
        if (d) save(d.to, d.toArea ?? null);
      } }),
      el("button", { type: "button", className: "tool", textContent: "Cancel", onclick: () => $("entrance").replaceChildren() })));
  pick.focus();
}

function openStage() {
  const text = $("stage-id").value;
  if (!text.trim()) return;
  if (!mapView.openStageId(text)) showStatus(`No map known for “${text.trim()}” (yet: the game files may still be being read)`);
}
$("open-stage").addEventListener("click", openStage);
$("stage-id").addEventListener("keydown", (e) => {
  if (e.key === "Enter") openStage();
});
$("follow-link").addEventListener("click", () => mapView.followLink());

showStatus();
connect();
loadFiles();
