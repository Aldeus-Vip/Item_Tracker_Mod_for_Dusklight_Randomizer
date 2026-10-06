import { BUG_SCREEN_ORDER, GOLDEN_BUGS, bugIcon, COLUMNS, DEFAULT_LAYOUT, DUNGEON_EXTRAS, DUNGEON_ICONS, GAME_ICON_BACKGROUNDS, GAME_ICON_IDS, GAME_ICON_TINTS, TILES, normalizeLayout } from "./layout.js";
import { createLocationsView, normalizeOverrides } from "./locations_view.js";
import { createMapView, DUNGEON_STAGES, dungeonEmblem, twilightMotes } from "./map_view.js";

const PROTOCOL_VERSION = 1;
const params = new URLSearchParams(location.search);

// OBS-friendly options: ?view=items|dungeons|locations, ?header=0, ?transparent=1, ?size=<px>
if (params.get("transparent") === "1") document.body.classList.add("transparent");
if (params.get("header") === "0") document.body.classList.add("no-header");
const size = Number(params.get("size"));
if (size >= 32 && size <= 200) document.documentElement.style.setProperty("--tile", `${size}px`);
document.documentElement.style.setProperty("--columns", String(COLUMNS));

const statusEl = document.getElementById("status");
const statusText = document.getElementById("status-text");
const editBar = document.getElementById("edit-bar");
const editButton = document.getElementById("edit");
const views = {
  items: document.getElementById("view-items"),
  dungeons: document.getElementById("view-dungeons"),
  locations: document.getElementById("view-locations"),
};
let mapView = null; // Map sub-tab of Locations (created with it)

let state = null;          // last state from the mod
let lastRendered = {};     // tile id -> signature, to flash changed tiles
let savedLayout = structuredClone(DEFAULT_LAYOUT);
let layout = savedLayout;  // layout being displayed (a copy while editing)
let editing = false;
let selected = null;       // { section, index } picked in edit mode

// ---- View switching ----

function showView(name) {
  if (!views[name]) name = "items";
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  for (const button of document.querySelectorAll(".tabs button")) {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  }
  editButton.hidden = name !== "items" || editing;
  if (name === "items") fitCaptions(views.items);
  if (mapView) showLocTab(locTab); // the map follows Link only while it is shown
  try { localStorage.setItem("tracker.view", name); } catch {}
}


document.querySelector(".tabs").addEventListener("click", (e) => {
  const button = e.target.closest("button[data-view]");
  if (button && !editing) showView(button.dataset.view);
});

let initialView = params.get("view");
if (!initialView) {
  try { initialView = localStorage.getItem("tracker.view"); } catch {}
}
function setStatus(kind, text) {
  statusEl.dataset.state = kind;
  statusText.textContent = text;
  statusEl.title = text; // the text is hidden on a narrow page unless live
}

// ---- Icons ----
// A tile whose icon cannot be loaded keeps its text label visible inside the frame.

// Icon sources, tried in order. By default the game's own icon (built by the mod from the game
// data); an icon switched to "image file" in the icon editor (right click) uses the uploaded image
// first. Icons with neither are drawn as text.
// A game texture reference is "<archive>/<file>.bti" or "<archive>/#<index>".
function textureUrl(ref) {
  const slash = ref.indexOf("/");
  return `game-textures/${ref.slice(0, slash)}/${encodeURIComponent(ref.slice(slash + 1))}.png`;
}

// The default for an icon: an item number (/game-icons/), a game texture reference, or bundled
// original art ("art/<file>").
function gameIconUrl(name, itemId) {
  let id = itemId !== undefined && itemId !== "" ? itemId : GAME_ICON_IDS[name];
  // Item numbers read back from data attributes are strings.
  if (typeof id === "string" && /^\d+$/.test(id)) id = Number(id);
  if (id === undefined) return null;
  if (typeof id !== "string") return `game-icons/${id}.png`;
  return id.startsWith("art/") ? id : textureUrl(id);
}

function iconSources(name, itemId) {
  const custom = settings.iconOverrides[name];
  const first = custom?.source === "file" ? `icons/${encodeURIComponent(name)}.png?rev=${custom.rev}`
    : custom?.source === "texture" && custom.texture ? textureUrl(custom.texture) : null;
  return [first, gameIconUrl(name, itemId)].filter(Boolean);
}

// Bundled art drawn behind a default icon (e.g. the field behind a field key), or null. An icon
// changed in the icon editor is shown without it.
function iconBackground(name) {
  const custom = settings.iconOverrides[name];
  if (custom && custom.source !== "game") return null;
  return GAME_ICON_BACKGROUNDS[name] ?? null;
}

function iconImg(name, className, onMissing, itemId) {
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  const sources = iconSources(name, itemId);
  let next = 0;
  const tryNext = () => {
    if (next < sources.length) img.src = sources[next++];
    else if (onMissing) onMissing(img);
    else img.remove();
  };
  img.addEventListener("error", tryNext);
  // A gray default texture the game colors when drawing it gets that color here.
  const tint = GAME_ICON_TINTS[name];
  if (tint) {
    const gameUrl = gameIconUrl(name, itemId);
    img.addEventListener("load", () => {
      if (img.src !== new URL(gameUrl, location.href).href) return; // custom icon, or already tinted
      const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
      const g = canvas.getContext("2d");
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = "multiply";
      g.fillStyle = tint;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.globalCompositeOperation = "destination-in"; // keep the texture's own transparency
      g.drawImage(img, 0, 0);
      img.src = canvas.toDataURL();
    });
  }
  // Without any source the fallback runs after the caller has attached the image.
  if (sources.length) tryNext();
  else queueMicrotask(tryNext);
  return img;
}

// ---- Items view ----

// Shrinks a caption's text until the whole label fits the tile (down to 55 %), instead of cutting
// it off. Captions are measured after they are in the document.
function fitCaptions(root) {
  for (const caption of root.querySelectorAll(".caption")) {
    // A hidden tab has no width to measure; it is fitted again when shown.
    if (!caption.clientWidth) continue;
    caption.style.fontSize = "";
    const full = parseFloat(getComputedStyle(caption).fontSize);
    // scrollWidth is rounded, so a text a fraction of a pixel too wide still gets an ellipsis;
    // measure the text itself instead.
    const range = document.createRange();
    range.selectNodeContents(caption);
    const fits = () => range.getBoundingClientRect().width <= caption.clientWidth - 1;
    let size = full;
    while (!fits() && size > full * 0.55) {
      size -= 0.5;
      caption.style.fontSize = `${size}px`;
    }
  }
}

// Captions measured with the fallback font are refitted once the page font has loaded.
document.fonts?.ready.then(() => fitCaptions(views.items));

function renderTile(id) {
  const ctx = {
    items: state?.items ?? {},
    ammo: state?.ammo,
    bombBags: state?.bombBags ?? [],
    bottles: state?.bottles ?? [],
  };
  return TILES[id].render(ctx);
}

function buildSlot(tileId, sectionIndex, slotIndex) {
  const slot = document.createElement("div");
  slot.className = "slot";
  slot.dataset.section = String(sectionIndex);
  slot.dataset.index = String(slotIndex);

  const frame = document.createElement("div");
  frame.className = "frame";
  slot.append(frame);

  const caption = document.createElement("div");
  caption.className = "caption";
  slot.append(caption);

  if (!tileId) {
    slot.classList.add("empty");
  } else {
    const t = renderTile(tileId);
    slot.dataset.tile = tileId;
    slot.title = t.label;
    if (t.on) slot.classList.add("on");

    const fallback = document.createElement("span");
    fallback.className = "fallback";
    fallback.textContent = t.label;
    frame.append(fallback);
    if (t.icon) {
      Object.assign(frame.dataset, { icon: t.icon, iconLabel: t.label, iconItem: t.item ?? "", tile: tileId });
      frame.classList.add("has-icon");
      const bg = iconBackground(t.icon);
      if (bg) {
        const back = Object.assign(document.createElement("img"), { className: "icon-bg", alt: "", src: bg, draggable: false });
        back.addEventListener("error", () => back.remove(), { once: true });
        frame.append(back);
      }
      frame.append(iconImg(t.icon, "icon", (img) => {
        img.remove();
        frame.classList.remove("has-icon");
      }, t.item));
    }
    if (t.meter !== undefined) {
      const meter = document.createElement("div");
      meter.className = "meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, t.meter)) * 100)}%`;
      meter.append(fill);
      frame.append(meter);
    }
    if (t.corner) {
      // Upgrade marker: icon from the pack, or a text tag when the pack has none.
      const corner = document.createElement("span");
      corner.className = "corner";
      corner.title = t.corner.title ?? "";
      const tag = () => {
        corner.classList.add("text");
        corner.textContent = t.corner.text;
      };
      if (t.corner.icon) corner.append(iconImg(t.corner.icon, "corner-icon", (img) => { img.remove(); tag(); }));
      else tag();
      frame.append(corner);
    }
    if (t.badge) {
      const badge = document.createElement("span");
      badge.className = "badge" + (t.full ? " full" : "");
      badge.textContent = t.badge;
      frame.append(badge);
    }
    caption.textContent = t.label;

    const signature = `${t.on}|${t.label}|${t.badge ?? ""}|${t.meter ?? ""}|${t.corner?.text ?? ""}`;
    if (lastRendered[tileId] !== undefined && lastRendered[tileId] !== signature && !editing) {
      slot.classList.add("changed");
    }
    lastRendered[tileId] = signature;
  }

  if (editing) {
    slot.draggable = true;
    if (selected && selected.section === sectionIndex && selected.index === slotIndex) {
      slot.classList.add("selected");
    }
  }
  return slot;
}

function renderItems() {
  const frag = document.createDocumentFragment();
  layout.sections.forEach((section, si) => {
    const group = document.createElement("section");
    group.className = "group";

    const head = document.createElement("div");
    head.className = "group-head";
    const h = document.createElement("h2");
    h.textContent = section.title;
    head.append(h);
    if (editing) {
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "+ Row";
      add.addEventListener("click", () => {
        section.slots.push(...Array(COLUMNS).fill(null));
        renderItems();
      });
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "− Row";
      const lastRow = section.slots.slice(-COLUMNS);
      remove.disabled = section.slots.length <= COLUMNS || lastRow.some(Boolean);
      remove.title = remove.disabled ? "Only an empty last row can be removed" : "";
      remove.addEventListener("click", () => {
        section.slots.splice(-COLUMNS, COLUMNS);
        renderItems();
      });
      head.append(add, remove);
    }

    const grid = document.createElement("div");
    grid.className = "grid";
    section.slots.forEach((id, i) => grid.append(buildSlot(id, si, i)));
    group.append(head, grid);
    frag.append(group);
  });
  views.items.replaceChildren(frag);
  fitCaptions(views.items);
  if (bugPanelOpen && !editing) views.items.append(buildBugPanel());
}

// ---- Golden bug panel: every bug, laid out like the game's insect screen ----

let bugPanelOpen = false;

function buildBugPanel() {
  const items = state?.items ?? {};
  const owned = GOLDEN_BUGS.filter((bug) => (items[bug] ?? 0) > 0).length;
  const given = new Set(state?.bugsGiven ?? []);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "tool";
  close.textContent = "Close";
  close.addEventListener("click", () => { bugPanelOpen = false; renderItems(); });
  const head = document.createElement("div");
  head.className = "bug-head";
  const title = document.createElement("h3");
  title.textContent = "Golden Bugs";
  const count = document.createElement("span");
  count.className = "bug-count";
  count.textContent = `${owned} / ${GOLDEN_BUGS.length}`;
  head.append(title, count, close);

  // Three kinds per row, each a male | female pair.
  const grid = document.createElement("div");
  grid.className = "bug-grid";
  for (const kind of BUG_SCREEN_ORDER) {
    const pair = document.createElement("div");
    pair.className = "bug-pair";
    for (const sex of ["Male", "Female"]) {
      const bug = `${sex} ${kind}`;
      const item = 0xc0 + GOLDEN_BUGS.indexOf(bug);
      const cell = document.createElement("div");
      cell.className = "bug-cell" + ((items[bug] ?? 0) > 0 ? " on" : "");
      cell.title = bug;
      // Right click: the icon editor, with every bug in its dropdown.
      Object.assign(cell.dataset, { icon: bugIcon(bug), iconLabel: bug, iconItem: String(item), tile: "goldenBug" });
      const name = document.createElement("span");
      name.className = "bug-name";
      name.textContent = sex === "Male" ? "♂" : "♀";
      cell.append(iconImg(bugIcon(bug), "bug-icon", (img) => img.replaceWith(Object.assign(document.createElement("span"), { className: "bug-text", textContent: kind })), item), name);
      // Given to Agitha: her butterfly mark at the top left, as on the game's insect screen.
      if (given.has(bug)) {
        const mark = document.createElement("span");
        mark.className = "bug-agitha";
        mark.title = `${bug}: given to Agitha`;
        Object.assign(mark.dataset, { icon: "Agitha_Mark", iconLabel: "Agitha's mark", iconItem: "" });
        mark.append(iconImg("Agitha_Mark", "", null));
        cell.append(mark);
      }
      pair.append(cell);
    }
    grid.append(pair);
  }
  const panel = document.createElement("div");
  panel.className = "bug-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Golden Bugs");
  panel.append(head, grid);
  return panel;
}

// ---- Edit mode: click two slots (or drag one onto another) to swap them ----

function swap(a, b) {
  const sa = layout.sections[a.section].slots;
  const sb = layout.sections[b.section].slots;
  [sa[a.index], sb[b.index]] = [sb[b.index], sa[a.index]];
}

function slotRef(el) {
  const slot = el.closest(".slot");
  return slot ? { section: Number(slot.dataset.section), index: Number(slot.dataset.index) } : null;
}

views.items.addEventListener("click", (e) => {
  if (!editing) {
    // Left click on the Golden Bugs tile opens the bug panel; a click outside the panel closes it.
    const onBugTile = e.target.closest(".slot")?.dataset.tile === "goldenBug";
    if (onBugTile || (bugPanelOpen && !e.target.closest(".bug-panel"))) {
      bugPanelOpen = onBugTile ? !bugPanelOpen : false;
      renderItems();
    }
    return;
  }
  const ref = slotRef(e.target);
  if (!ref) return;
  if (!selected) {
    selected = ref;
  } else {
    if (selected.section !== ref.section || selected.index !== ref.index) swap(selected, ref);
    selected = null;
  }
  renderItems();
});

views.items.addEventListener("dragstart", (e) => {
  const ref = editing && slotRef(e.target);
  if (!ref) return;
  e.dataTransfer.setData("text/plain", JSON.stringify(ref));
  e.dataTransfer.effectAllowed = "move";
});
views.items.addEventListener("dragover", (e) => {
  if (editing && slotRef(e.target)) e.preventDefault();
});
views.items.addEventListener("drop", (e) => {
  const to = editing && slotRef(e.target);
  if (!to) return;
  e.preventDefault();
  try {
    swap(JSON.parse(e.dataTransfer.getData("text/plain")), to);
  } catch {
    return;
  }
  selected = null;
  renderItems();
});

function setEditing(on) {
  editing = on;
  selected = null;
  document.body.classList.toggle("editing", on);
  editBar.hidden = !on;
  editButton.hidden = on;
  layout = on ? structuredClone(savedLayout) : savedLayout;
  renderItems();
}

editButton.addEventListener("click", () => setEditing(true));
document.getElementById("edit-cancel").addEventListener("click", () => setEditing(false));
document.getElementById("edit-reset").addEventListener("click", () => {
  layout = structuredClone(DEFAULT_LAYOUT);
  selected = null;
  renderItems();
});
document.getElementById("edit-confirm").addEventListener("click", async () => {
  const next = normalizeLayout(layout);
  try {
    const res = await fetch("layout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setStatus("offline", `Could not save layout (${err.message}) — is the game running?`);
    return;
  }
  savedLayout = next;
  setEditing(false);
});

async function loadLayout() {
  try {
    const res = await fetch("layout", { cache: "no-store" });
    if (res.ok) savedLayout = normalizeLayout(await res.json());
  } catch {}
  if (!editing) layout = savedLayout;
  renderItems();
}

// ---- Theme and background (saved by the mod as settings.json) ----

const THEMES = ["twilight", "midna", "hyrule", "shadow"];
const DEFAULT_SETTINGS = {
  version: 1,
  theme: "twilight",
  background: { enabled: false, fit: "cover", dim: 0.35, rev: 0 },
  logicOverrides: {}, // custom per-check requirements (Locations tab)
  logic: true, // Locations tab evaluates reachability
  // Found items in the Locations tab: seed picked in Rules (null = the save's seed, else the
  // newest) and whether found items are shown (off unless turned on). What was found is kept
  // with the game's save by the mod.
  seedView: { hash: null, show: false },
  // Icons changed in the icon editor: { [icon name]: { source: "file" | "game", rev } }. rev
  // changes on every upload so browsers fetch the new image.
  iconOverrides: {},
  // Checks placed on the map by hand (people, golden wolves, events): { [check name]: { stage,
  // room, x, z, floor } }.
  mapPlaces: {},
  // The Map's Other places renamed or moved to another province: { [entry id]: { title, province } }.
  placeFixes: {},
  // Areas set by hand for checks (By area, the region filter): { [check name]: area }.
  checkAreas: {},
  // Simple (the main things only) or advanced (every tool).
  mode: "simple",
  // The items' frames: the theme's fill or a color of one's own, and how opaque (0 to 1).
  frameFill: { custom: false, color: "#20231a", alpha: 1, glow: 1 },
  // The page's font (Options › Display): standard, Old English, or one uploaded, for the titles or
  // all text; rev changes on every upload.
  font: { family: "default", scope: "titles", rev: 0 },
  // Checks and Map follow each other's region.
  linkMap: true,
  // The Map's entrance plates moved by hand ({ [plate]: { x, z } }) and entrances added by hand.
  entranceFixes: { moved: {}, added: [] },
};
let settings = structuredClone(DEFAULT_SETTINGS);
const themeBar = document.getElementById("theme-bar");
const themeButton = document.getElementById("theme");

function normalizeSettings(raw) {
  const out = structuredClone(DEFAULT_SETTINGS);
  if (raw && THEMES.includes(raw.theme)) out.theme = raw.theme;
  const bg = raw?.background;
  if (bg) {
    out.background.enabled = bg.enabled === true;
    out.background.fit = bg.fit === "tile" ? "tile" : "cover";
    out.background.dim = Math.max(0, Math.min(0.85, Number(bg.dim) || 0));
    out.background.rev = Number(bg.rev) || 0;
  }
  out.logicOverrides = normalizeOverrides(raw?.logicOverrides);
  out.logic = raw?.logic !== false;
  const sv = raw?.seedView;
  if (sv && typeof sv === "object") {
    out.seedView.hash = typeof sv.hash === "string" && sv.hash.length <= 100 ? sv.hash : null;
    out.seedView.show = sv.show === true;
  }
  const textureRef = (v) => (typeof v === "string" && /^[a-z0-9]{1,16}\/[\w.#-]{1,64}$/.test(v) ? v : undefined);
  for (const [name, o] of Object.entries(raw?.iconOverrides ?? {})) {
    if (/^[\w.'-]+$/.test(name) && o && typeof o === "object") {
      const entry = { source: ["file", "texture"].includes(o.source) ? o.source : "game", rev: Number(o.rev) || 0 };
      if (textureRef(o.texture)) entry.texture = o.texture;
      out.iconOverrides[name] = entry;
    }
  }
  for (const [name, p] of Object.entries(raw?.mapPlaces ?? {})) {
    if (name.length > 200 || !p || typeof p !== "object" || typeof p.stage !== "string" || !/^\w{1,8}$/.test(p.stage)) continue;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const room = Number.isInteger(p.room) && p.room >= -1 && p.room < 64 ? p.room : -1;
    out.mapPlaces[name] = { stage: p.stage, room, x: num(p.x), z: num(p.z), floor: Number.isInteger(p.floor) ? p.floor : 0 };
    if (typeof p.variant === "string" && p.variant.length <= 100) out.mapPlaces[name].variant = p.variant;
  }
  out.mode = raw?.mode === "advanced" ? "advanced" : "simple";
  const ff = raw?.frameFill;
  if (ff && typeof ff === "object") {
    out.frameFill.custom = ff.custom === true;
    if (typeof ff.color === "string" && /^#[0-9a-f]{6}$/i.test(ff.color)) out.frameFill.color = ff.color;
    out.frameFill.alpha = Math.max(0, Math.min(1, Number.isFinite(Number(ff.alpha)) ? Number(ff.alpha) : 1));
  }
  if (ff && typeof ff === "object") out.frameFill.glow = Math.max(0, Math.min(1, Number.isFinite(Number(ff.glow)) ? Number(ff.glow) : 1));
  out.linkMap = raw?.linkMap !== false;
  const fo = raw?.font;
  if (fo && typeof fo === "object") {
    out.font.family = ["default", "oldenglish", "custom"].includes(fo.family) ? fo.family : "default";
    out.font.scope = fo.scope === "all" ? "all" : "titles";
    out.font.rev = Number(fo.rev) || 0;
  }
  for (const [name, area] of Object.entries(raw?.checkAreas ?? {})) {
    if (name.length <= 200 && typeof area === "string" && area.length <= 80) out.checkAreas[name] = area;
  }
  const ef = raw?.entranceFixes;
  const stageOk = (v) => typeof v === "string" && /^\w{1,8}$/.test(v);
  const roomOk = (v) => Number.isInteger(v) && v >= -1 && v < 64;
  const areaOk = (v) => typeof v === "string" && v.length <= 100;
  for (const [key, m] of Object.entries(ef?.moved ?? {})) {
    if (key.length <= 200 && m && Number.isFinite(Number(m.x)) && Number.isFinite(Number(m.z))) out.entranceFixes.moved[key] = { x: Number(m.x), z: Number(m.z) };
  }
  for (const a of Array.isArray(ef?.added) ? ef.added.slice(0, 500) : []) {
    if (!a || typeof a.id !== "string" || a.id.length > 20 || !stageOk(a.stage) || !roomOk(a.room) || !stageOk(a.to?.stage) || !roomOk(a.to?.room)) continue;
    const entry = { id: a.id, stage: a.stage, room: a.room, x: Number(a.x) || 0, z: Number(a.z) || 0, floor: Number.isInteger(a.floor) ? a.floor : 0,
      to: { stage: a.to.stage, room: a.to.room } };
    if (areaOk(a.atArea)) entry.atArea = a.atArea;
    if (areaOk(a.toArea)) entry.toArea = a.toArea;
    out.entranceFixes.added.push(entry);
  }
  for (const [id, f] of Object.entries(raw?.placeFixes ?? {})) {
    if (id.length > 140 || !f || typeof f !== "object") continue;
    const fix = {};
    if (typeof f.title === "string" && f.title.length <= 80) fix.title = f.title;
    if (typeof f.province === "string" && f.province.length <= 60) fix.province = f.province;
    if (f.hidden === true) fix.hidden = true;
    if (fix.title || fix.province || fix.hidden) out.placeFixes[id] = fix;
  }
  return out;
}

function applySettings() {
  document.body.dataset.theme = settings.theme;
  const bg = settings.background;
  document.body.classList.toggle("has-bg-image", bg.enabled);
  document.body.classList.toggle("bg-tile", bg.fit === "tile");
  // rev changes on every upload so browsers (and OBS) fetch the new image.
  document.body.style.setProperty("--bg-image", bg.enabled ? `url("background?rev=${bg.rev}")` : "none");
  document.body.style.setProperty("--bg-dim", String(bg.dim));
  for (const b of themeBar.querySelectorAll(".swatch")) {
    b.setAttribute("aria-pressed", String(b.dataset.choice === settings.theme));
  }
  document.getElementById("bg-fit").value = bg.fit;
  const icons = JSON.stringify(settings.iconOverrides);
  if (renderedIcons !== icons) {
    renderedIcons = icons;
    renderItems();
    renderDungeons(state?.dungeons ?? []);
  }
  document.getElementById("bg-dim").value = String(Math.round(bg.dim * 100));
  document.getElementById("bg-remove").disabled = !bg.enabled;
  // Simple / advanced (?mode= in the address wins, for an OBS source).
  const mode = params.get("mode") === "advanced" || params.get("mode") === "simple" ? params.get("mode") : settings.mode;
  document.body.classList.toggle("simple", mode !== "advanced");
  for (const b of themeBar.querySelectorAll(".swatch.mode")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  // Item frames.
  const ff = settings.frameFill;
  document.body.classList.toggle("custom-fill", ff.custom);
  document.body.style.setProperty("--fill", ff.color);
  document.body.style.setProperty("--fill-alpha", String(ff.alpha));
  document.getElementById("fill-mode").value = ff.custom ? "custom" : "theme";
  document.getElementById("fill-color").value = ff.color;
  document.getElementById("fill-color").disabled = !ff.custom;
  document.getElementById("fill-alpha").value = String(Math.round(ff.alpha * 100));
  document.body.style.setProperty("--glow-a", String(ff.glow));
  document.getElementById("glow-alpha").value = String(Math.round(ff.glow * 100));
  // Font.
  const fo = settings.font;
  const face = fo.family === "oldenglish" ? '"TP Old English"' : fo.family === "custom" ? '"TP My Font"' : null;
  if (fo.family === "custom") {
    let style = document.getElementById("my-font");
    if (!style) {
      style = document.createElement("style");
      style.id = "my-font";
      document.head.append(style);
    }
    style.textContent = `@font-face { font-family: "TP My Font"; src: url("font?rev=${fo.rev}"); font-display: swap; }`;
  }
  document.body.style.setProperty("--title-font", face ? `${face}, var(--base-font)` : "var(--base-font)");
  document.body.classList.toggle("font-all", !!face && fo.scope === "all");
  document.body.classList.toggle("font-fancy", !!face);
  document.getElementById("font-family").value = fo.family;
  document.getElementById("font-scope").value = fo.scope;
  document.getElementById("font-scope").disabled = !face;
  document.getElementById("font-upload").hidden = fo.family !== "custom";
  document.getElementById("link-map").checked = settings.linkMap;
}

let renderedIcons = null; // icon source the views were last drawn with

async function saveSettings() {
  try {
    const res = await fetch("settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setStatus("offline", `Could not save theme (${err.message}) — is the game running?`);
  }
}

// Custom requirements bundled with the mod (Requirements > Load Preset Custom Requirements). A new install, whose settings
// have never held custom requirements, starts with them.
async function fetchPresetOverrides() {
  const res = await fetch("preset-rules.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const parsed = await res.json();
  return normalizeOverrides(parsed.overrides ?? parsed);
}

async function loadSettings() {
  try {
    const res = await fetch("settings", { cache: "no-store" });
    let raw = null;
    if (res.ok) raw = await res.json();
    else if (res.status !== 404) throw new Error(`HTTP ${res.status}`);
    settings = normalizeSettings(raw);
    if (!raw || !("logicOverrides" in raw)) {
      settings.logicOverrides = await fetchPresetOverrides();
      await saveSettings();
    }
  } catch {}
  applySettings();
  locationsView.refresh();
}

// Options: a window over the page, opened and closed by its button, closed by a click outside
// it or Escape.
themeButton.addEventListener("click", () => {
  themeBar.hidden = !themeBar.hidden;
  themeButton.setAttribute("aria-expanded", String(!themeBar.hidden));
});
const closeOptions = () => {
  themeBar.hidden = true;
  themeButton.setAttribute("aria-expanded", "false");
};
document.addEventListener("pointerdown", (e) => {
  if (themeBar.hidden || themeBar.contains(e.target) || themeButton.contains(e.target)) return;
  // (A file picker or a color picker opened from Options is not a click outside.)
  if (e.target === document.documentElement) return;
  closeOptions();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !themeBar.hidden) closeOptions();
});
themeBar.addEventListener("click", (e) => {
  const swatch = e.target.closest(".swatch");
  if (!swatch) return;
  if (swatch.dataset.mode) settings.mode = swatch.dataset.mode;
  else settings.theme = swatch.dataset.choice;
  applySettings();
  saveSettings();
});
document.getElementById("fill-mode").addEventListener("change", (e) => {
  settings.frameFill.custom = e.target.value === "custom";
  applySettings();
  saveSettings();
});
const fillColor = document.getElementById("fill-color");
fillColor.addEventListener("input", () => {
  settings.frameFill.color = fillColor.value;
  applySettings();
});
fillColor.addEventListener("change", () => saveSettings());
const fillAlpha = document.getElementById("fill-alpha");
fillAlpha.addEventListener("input", () => {
  settings.frameFill.alpha = Number(fillAlpha.value) / 100;
  applySettings();
});
fillAlpha.addEventListener("change", () => saveSettings());
const glowAlpha = document.getElementById("glow-alpha");
glowAlpha.addEventListener("input", () => {
  settings.frameFill.glow = Number(glowAlpha.value) / 100;
  applySettings();
});
glowAlpha.addEventListener("change", () => saveSettings());
document.getElementById("font-family").addEventListener("change", (e) => {
  settings.font.family = e.target.value;
  applySettings();
  saveSettings();
});
document.getElementById("link-map").addEventListener("change", (e) => {
  settings.linkMap = e.target.checked;
  saveSettings();
});
document.getElementById("font-scope").addEventListener("change", (e) => {
  settings.font.scope = e.target.value;
  applySettings();
  saveSettings();
});
document.getElementById("font-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setStatus("offline", "Font too large (max 8 MB)");
    return;
  }
  try {
    const res = await fetch("font", { method: "POST", headers: { "Content-Type": "font/upload" }, body: file });
    if (!res.ok) throw new Error(res.status === 415 ? "not a TrueType, OpenType or WOFF font" : `HTTP ${res.status}`);
  } catch (err) {
    setStatus("offline", `Could not upload the font (${err.message})`);
    return;
  }
  settings.font.family = "custom";
  settings.font.rev = Date.now();
  applySettings();
  saveSettings();
});
document.getElementById("bg-fit").addEventListener("change", (e) => {
  settings.background.fit = e.target.value;
  applySettings();
  saveSettings();
});
const dimInput = document.getElementById("bg-dim");
dimInput.addEventListener("input", () => {
  settings.background.dim = Number(dimInput.value) / 100;
  applySettings();
});
dimInput.addEventListener("change", () => saveSettings());
document.getElementById("bg-file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    setStatus("offline", "Image too large (max 8 MB)");
    return;
  }
  try {
    const res = await fetch("background", { method: "POST", headers: { "Content-Type": file.type || "image/png" }, body: file });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    setStatus("offline", `Could not upload image (${err.message})`);
    return;
  }
  settings.background.enabled = true;
  settings.background.rev = Date.now();
  applySettings();
  saveSettings();
});
document.getElementById("bg-remove").addEventListener("click", async () => {
  try {
    await fetch("background", { method: "DELETE" });
  } catch {}
  settings.background.enabled = false;
  applySettings();
  saveSettings();
});

// ---- Icon editor (right click on an icon) ----

const iconEditor = document.getElementById("icon-editor");

function h(tag, props = {}, ...kids) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids.filter((k) => k !== null && k !== undefined && k !== false));
  return node;
}

function previewBox(src, caption) {
  const box = h("div", { className: "icon-preview" });
  if (src) {
    const img = h("img", { src, alt: "" });
    img.addEventListener("error", () => img.replaceWith(h("span", { className: "icon-none", textContent: "—" })), { once: true });
    box.append(img);
  } else {
    box.append(h("span", { className: "icon-none", textContent: "—" }));
  }
  box.append(h("span", { textContent: caption }));
  return box;
}

async function updateIconOverride(name, change) {
  const current = settings.iconOverrides[name] ?? { source: "game", rev: 0 };
  const next = { ...current, ...change };
  // Drop entries that no longer differ from the default.
  const isDefault = next.source === "game" && !next.rev && !next.texture;
  if (isDefault) delete settings.iconOverrides[name];
  else settings.iconOverrides[name] = next;
  applySettings();
  await saveSettings();
}

// variants: the icons the tile can show ({ icon, label, item? }); with more than one, a dropdown
// picks which one to edit.
function openIconEditor(name, label, itemId, variants = []) {
  const custom = settings.iconOverrides[name] ?? {};
  const hasFile = Boolean(custom.rev);
  const gameUrl = gameIconUrl(name, itemId);
  const source = custom.source ?? "game";
  const reopen = () => openIconEditor(name, label, itemId, variants);

  const upload = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setStatus("offline", "Icon image too large (max 4 MB)");
      return;
    }
    try {
      const res = await fetch(`icons/${encodeURIComponent(name)}.png`, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await updateIconOverride(name, { source: "file", rev: Date.now() });
      reopen();
    } catch (err) {
      setStatus("offline", `Could not upload the icon (${err.message})`);
    }
  });
  const deleteFile = async () => {
    await fetch(`icons/${encodeURIComponent(name)}.png`, { method: "DELETE" }).catch(() => {});
    await updateIconOverride(name, { source: source === "file" ? "game" : source, rev: 0 });
    reopen();
  };
  const radio = (value, text, enabled) => h("label", { className: "icon-choice" },
    h("input", { type: "radio", name: "icon-source", value, checked: source === value, disabled: !enabled,
      onchange: async () => { await updateIconOverride(name, { source: value }); reopen(); } }),
    ` ${text}`);

  const picker = variants.length > 1 ? h("select", {
    className: "icon-variant",
    "aria-label": "Icon to edit",
    onchange: (e) => {
      const v = variants[Number(e.target.value)];
      openIconEditor(v.icon, v.label, v.item ?? "", variants);
    },
  }, ...variants.map((v, i) => h("option", { value: String(i), textContent: v.label, selected: v.icon === name }))) : null;
  iconEditor.replaceChildren(
    h("div", { className: "icon-editor-head" }, h("h3", { textContent: label }),
      h("button", { className: "tool", type: "button", textContent: "Close", onclick: () => (iconEditor.hidden = true) })),
    ...(picker ? [picker] : []),
    h("div", { className: "icon-previews" },
      previewBox(gameUrl, "Default"),
      previewBox(custom.texture ? textureUrl(custom.texture) : null, "Game texture"),
      previewBox(hasFile ? `icons/${encodeURIComponent(name)}.png?rev=${custom.rev}` : null, "Image file")),
    h("div", { className: "icon-choices" },
      radio("game", gameUrl ? "Default" : "Default (none: shown as text)", true),
      radio("texture", "From a game texture", Boolean(custom.texture)),
      radio("file", "From image file", hasFile)),
    h("div", { className: "icon-actions" },
      h("button", { className: "tool", type: "button", textContent: custom.texture ? "Change texture…" : "Choose texture…",
        onclick: () => openTextureBrowser(async (ref) => { await updateIconOverride(name, { source: "texture", texture: ref }); reopen(); }) }),
      h("label", { className: "tool" }, hasFile ? "Replace image…" : "Upload image…", upload),
      hasFile && h("button", { className: "tool", type: "button", textContent: "Delete image", onclick: deleteFile })),
  );
  iconEditor.hidden = false;
}

// ---- Game texture browser ----

const TEXTURE_ARCHIVES = [["itemicon", "Item icons"], ["dmap", "Dungeon map"]];
const textureBrowser = document.getElementById("texture-browser");
let browserArchive = "itemicon";

async function openTextureBrowser(onPick) {
  const grid = h("div", { className: "texture-grid" });
  const filter = h("input", { type: "search", placeholder: "Filter by name", className: "texture-filter" });
  const tabs = h("div", { className: "texture-tabs" }, ...TEXTURE_ARCHIVES.map(([key, title]) =>
    h("button", { type: "button", className: "tool" + (key === browserArchive ? " primary" : ""), textContent: title,
      onclick: () => { browserArchive = key; openTextureBrowser(onPick); } })));
  textureBrowser.replaceChildren(
    h("div", { className: "icon-editor-head" }, h("h3", { textContent: "Game textures" }),
      h("button", { className: "tool", type: "button", textContent: "Close", onclick: () => (textureBrowser.hidden = true) })),
    tabs, filter, grid);
  textureBrowser.hidden = false;
  let names = [];
  try {
    const res = await fetch(`game-textures/${browserArchive}/`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    names = await res.json();
  } catch {
    grid.append(h("p", { className: "loc-note", textContent: "Textures are available while the game is running." }));
    return;
  }
  const count = h("span", { className: "loc-note" });
  filter.after(count);
  let shown = 0;
  let broken = 0;
  const showCount = () => {
    count.textContent = `${shown} texture${shown === 1 ? "" : "s"}` + (broken ? ` · ${broken} could not be read` : "");
  };
  if (!names.length) {
    grid.append(h("p", { className: "loc-note", textContent: "This archive has no textures." }));
  }
  const draw = () => {
    const q = filter.value.trim().toLowerCase();
    const list = names.filter((n) => !q || n.toLowerCase().includes(q));
    shown = list.length;
    broken = 0;
    showCount();
    grid.replaceChildren(...list.map((n) => {
      const ref = `${browserArchive}/${n}`;
      const img = h("img", { src: textureUrl(ref), alt: "", loading: "lazy" });
      img.addEventListener("error", () => {
        img.closest(".texture-cell")?.classList.add("broken");
        broken++;
        showCount();
      }, { once: true });
      return h("button", { type: "button", className: "texture-cell", title: n,
        onclick: () => { textureBrowser.hidden = true; onPick(ref); } }, img, h("span", { textContent: n.replace(/\.bti$/, "") }));
    }));
  };
  filter.addEventListener("input", draw);
  draw();
}

// Icons that come in stages, editable whichever stage is shown: picked in the editor's dropdown.
const ICON_SETS = {
  keyShards: DUNGEON_ICONS.keyShards.map((icon, i) => ({ icon, label: `Key Shards ${i + 1}/3` })),
};

// Right click on an icon (data-icon) opens the icon editor.
function onIconContextMenu(e) {
  const target = e.target.closest("[data-icon]");
  if (!target) return;
  e.preventDefault();
  const variants = [...(ICON_SETS[target.dataset.iconSet] ?? TILES[target.dataset.tile]?.variants ?? [])];
  if (!variants.some((v) => v.icon === target.dataset.icon)) {
    variants.unshift({ icon: target.dataset.icon, label: target.dataset.iconLabel || target.dataset.icon, item: target.dataset.iconItem });
  }
  const shown = variants.find((v) => v.icon === target.dataset.icon);
  openIconEditor(target.dataset.icon, shown?.label || target.dataset.iconLabel || target.dataset.icon, target.dataset.iconItem, variants);
}
for (const view of [views.items, views.dungeons]) view.addEventListener("contextmenu", onIconContextMenu);

// ---- Dungeons view ----

function mark(on, label, icon) {
  const span = document.createElement("span");
  span.className = "mark" + (on ? " on" : "");
  span.title = label;
  const text = on ? "●" : "○";
  if (icon) Object.assign(span.dataset, { icon, iconLabel: label, iconItem: "" });
  if (icon) span.append(iconImg(icon, "mark-icon", (img) => img.replaceWith(text)));
  else span.textContent = text;
  return span;
}

// The Dungeons tab: each dungeon on a plate of the twilight panel (as the Map's Dungeons list), with
// its emblem, what was found right-aligned (small keys found / in all, big key or key shards,
// map, compass, boss, extras; right-click an icon to change it). Click a dungeon for its map.
let dungeonPanel = null;
function renderDungeons(dungeons) {
  const items = state?.items ?? {};
  if (!dungeonPanel) {
    dungeonPanel = document.createElement("div");
    dungeonPanel.className = "map-select twilight dungeon-panel";
    const heading = document.createElement("div");
    heading.className = "twilight-heading";
    heading.append(Object.assign(document.createElement("span"), { textContent: "Dungeons" }));
    // Column titles over the items, which line up from dungeon to dungeon.
    const head = document.createElement("div");
    head.className = "dungeon-row dungeon-head";
    for (const [cls, text, short] of [["twilight-no", ""], ["twilight-emblem", ""], ["twilight-text", ""], ["dcell dcell-other", "", ""],
      ["dcell", "Keys", "Key"], ["dcell", "Big Key", "BK"], ["dcell", "Map", "Map"], ["dcell", "Compass", "Cmp"], ["dcell", "Boss", "Boss"]]) {
      const label = Object.assign(document.createElement("span"), { className: cls, textContent: text });
      if (short) label.dataset.short = short;
      head.append(label);
    }
    const list = document.createElement("div");
    list.className = "dungeon-rows";
    dungeonPanel.append(twilightMotes(), heading, head, list);
  }
  const key = (n) => String(n).toLowerCase().replace(/[^a-z]/g, "");
  const rows = dungeons.map((d) => {
    const index = DUNGEON_STAGES.findIndex(([label]) => key(label) === key(d.name));
    const [, stage, land] = DUNGEON_STAGES[index] ?? [];
    const row = document.createElement("div");
    row.className = "plate twilight-plate dungeon-row" + (d.bossDefeated ? " cleared" : "");
    const span = (className, text) => Object.assign(document.createElement("span"), { className, textContent: text ?? "" });
    const nameBox = span("twilight-text");
    nameBox.append(span("twilight-name", d.name), span("twilight-sub", land ?? ""));
    row.append(span("twilight-no", index >= 0 ? ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"][index] : ""),
      stage ? dungeonEmblem(stage) : span("twilight-emblem"), nameBox);

    const cell = (...children) => {
      const c = span("dcell");
      c.append(...children);
      return c;
    };
    const keys = span("dcell dungeon-keys" + (d.smallKeys >= d.maxSmallKeys ? " complete" : ""));
    keys.append(mark(d.smallKeys > 0, `Small Keys found ${d.smallKeys}/${d.maxSmallKeys} (holding ${d.smallKeysHeld})`, DUNGEON_ICONS.smallKey ?? "Small_Key"),
      span("dungeon-count", `${d.smallKeys}/${d.maxSmallKeys}`));
    const bigKey = span("dcell dungeon-big");
    if (d.name === "Goron Mines") {
      // Key shards replace the big key: show the assembled pieces.
      const shards = items["Goron Mines Key Shard"] ?? 0;
      const shardMark = mark(shards > 0, `Key Shards ${shards}/3`, DUNGEON_ICONS.keyShards[Math.max(0, shards - 1)]);
      shardMark.dataset.iconSet = "keyShards"; // every stage editable, not only the one shown
      bigKey.append(shardMark, span("dungeon-count" + (shards >= 3 ? " complete" : ""), `${shards}/3`));
    } else if (d.hasBigKey) {
      bigKey.append(mark(d.bigKey, "Big Key", DUNGEON_ICONS.bigKeys[d.name] ?? DUNGEON_ICONS.bigKey));
    }
    const mapCell = cell(mark(d.map, "Map", DUNGEON_ICONS.map));
    const compassCell = cell(mark(d.compass, "Compass", DUNGEON_ICONS.compass));
    // Boss icon: the field map's boss mark unless one is set in the icon editor; a circle when
    // neither can be drawn.
    const bossIcon = DUNGEON_ICONS.bosses[d.name];
    const bossMark = mark(d.bossDefeated, "Boss defeated");
    if (bossIcon) {
      bossMark.textContent = "";
      Object.assign(bossMark.dataset, { icon: bossIcon, iconLabel: bossIcon, iconItem: "" });
      bossMark.append(iconImg(bossIcon, "boss-icon", (img) => img.replaceWith(d.bossDefeated ? "●" : "○")));
    }
    const other = span("dcell dcell-other");
    for (const extra of DUNGEON_EXTRAS[d.name] ?? []) other.append(mark((items[extra.id] ?? 0) > 0, extra.label, extra.icon));
    // The dungeon's own items (Snowpeak's pumpkin and cheese) left of the keys, so the columns
    // line up.
    row.append(other, keys, bigKey, mapCell, compassCell, cell(bossMark));

    if (stage) {
      row.tabIndex = 0;
      row.title = `Open ${d.name}'s map`;
      const open = () => {
        showView("locations");
        if (locTab === "checks") showLocTab("map");
        mapView?.showDungeon(stage);
      };
      row.addEventListener("click", (e) => { if (!editing) open(); });
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    }
    return row;
  });
  dungeonPanel.querySelector(".dungeon-rows").replaceChildren(...rows);
  if (dungeonPanel.parentNode !== views.dungeons) views.dungeons.replaceChildren(dungeonPanel);
}

// ---- Locations view ----

// Locations has sub-tabs: the checks, the map, or both side by side (when the page is wide enough).
const LOC_TABS = [["checks", "Checks"], ["map", "Map"], ["both", "Checks + Map"]];
const BOTH_MIN_WIDTH = 900;
const locChecks = document.createElement("div");
locChecks.className = "loc-checks-pane";
const locMap = document.createElement("div");
locMap.className = "loc-map-pane";
const locSplit = document.createElement("div");
locSplit.className = "loc-split";
locSplit.append(locChecks, locMap);
const locTabBar = document.createElement("nav");
locTabBar.className = "loc-subtabs";
locTabBar.setAttribute("role", "tablist");
views.locations.append(locTabBar, locSplit);
let locTab = "checks";
try { locTab = localStorage.getItem("tracker.locTab") || "checks"; } catch {}

function showLocTab(name) {
  const wide = views.locations.clientWidth === 0 || views.locations.clientWidth >= BOTH_MIN_WIDTH;
  locTab = name;
  try { localStorage.setItem("tracker.locTab", name); } catch {}
  // Both side by side needs the room; a narrow page shows the map alone instead.
  const shown = name === "both" && !wide ? "map" : name;
  locTabBar.replaceChildren(...LOC_TABS.map(([id, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "loc-subtab";
    button.textContent = label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(id === shown));
    if (id === "both" && !wide) {
      button.disabled = true;
      button.title = `Widen the window (at least ${BOTH_MIN_WIDTH}px) to show both`;
    }
    button.addEventListener("click", () => showLocTab(id));
    return button;
  }));
  locSplit.dataset.tab = shown;
  locChecks.hidden = shown === "map";
  locMap.hidden = shown === "checks";
  mapView?.setVisible(!views.locations.hidden && shown !== "checks");
}
new ResizeObserver(() => {
  if (!views.locations.hidden) showLocTab(locTab);
  document.documentElement.style.setProperty("--loc-sub-h", `${locTabBar.offsetHeight}px`);
}).observe(views.locations);

const locationsView = createLocationsView(locChecks, {
  getOverrides: () => settings.logicOverrides,
  getPresetOverrides: fetchPresetOverrides,
  saveOverrides: async (overrides) => {
    settings.logicOverrides = overrides;
    await saveSettings();
  },
  getLogic: () => settings.logic,
  saveLogic: async (enabled) => {
    settings.logic = enabled;
    await saveSettings();
  },
  getSeedView: () => settings.seedView,
  saveSeedView: async (view) => {
    settings.seedView = view;
    await saveSettings();
  },
  getLayoutSections: () => savedLayout.sections,
  makeIcon: (name, itemId) => iconImg(name, "", null, itemId),
  saveEntries,
  setStatus,
  // The map knows where the game places each check (for grouping by area) and shows them.
  placeOf: (key) => mapView?.placeOf(key) ?? null,
  // Checks and Map linked (Options): a region picked in Checks opens its map.
  onRegionPicked(region) {
    if (settings.linkMap) mapView?.showRegion(region);
  },
  // ... and a check highlighted there is the one picked on the map.
  onFocus(name) {
    if (settings.linkMap) mapView?.pickCheck(name);
  },
  // Areas set by hand for checks of the list (By area, region filter).
  getCheckAreas: () => settings.checkAreas,
  saveCheckArea(name, area) {
    if (area) settings.checkAreas[name] = area;
    else delete settings.checkAreas[name];
    saveSettings();
  },
  showOnMap(name) {
    if (locSplit.dataset.tab === "checks") showLocTab("map");
    mapView?.showCheck(name);
  },
});
mapView = createMapView(locMap, {
  getState: () => state,
  regionName: (stage, room) => locationsView.regionName(stage, room),
  roomName: (stage, room) => locationsView.roomName(stage, room),
  roomVariants: (stage, room) => locationsView.roomVariants(stage, room),
  areaChecks: (area) => locationsView.areaChecks(area),
  checkRegion: (name) => locationsView.checkRegion(name),
  areaRegion: (area) => locationsView.areaRegion(area),
  roomKind: (stage, room) => locationsView.roomKind(stage, room),
  entrances: () => locationsView.entrances(),
  // ... and the place the map shows sets Checks to its region.
  onShown(region) {
    if (settings.linkMap) locationsView.showRegion(region);
  },
  provinceOrder: () => locationsView.provinceOrder(),
  makeIcon: (name, className, fallback) => iconImg(name, className, (img) => img.replaceWith(fallback ?? "")),
  // Checks on the map: a right click (or any click with Checks + Map) shows the check in Checks.
  checks: {
    list: () => locationsView.mapChecks(),
    mount: (host, name, opts) => locationsView.mountDetail(host, name, opts),
    row: (name) => locationsView.rowFor(name),
    unmount: () => locationsView.unmountDetail(),
    focused: () => locationsView.focusedName(),
    setFocused: (name) => locationsView.setFocused(name, settings.linkMap),
    bothShown: () => locSplit.dataset.tab === "both",
    manualPlaces: () => settings.mapPlaces,
    // Names and provinces of the Map's Other places changed by hand.
    placeFixes: () => settings.placeFixes,
    setPlaceFix(id, fix) {
      if (fix) settings.placeFixes[id] = fix;
      else delete settings.placeFixes[id];
      saveSettings();
    },
    // Entrances moved or added on the map by hand.
    entranceFixes: () => settings.entranceFixes,
    setEntranceFixes(fixes) {
      settings.entranceFixes = normalizeSettings({ entranceFixes: fixes }).entranceFixes;
      saveSettings();
    },
    setPlace(name, place) {
      if (place) settings.mapPlaces[name] = place;
      else delete settings.mapPlaces[name];
      saveSettings();
      locationsView.refresh();
    },
    jump(name) {
      if (locSplit.dataset.tab !== "both") showLocTab("checks");
      locationsView.jumpTo(name);
    },
  },
  onPlaces: () => locationsView.refresh(),
  provinceOf: (region) => locationsView.provinceOf(region),
});
locMap.addEventListener("contextmenu", onIconContextMenu);
showLocTab(locTab);

showView(initialView || "items");
let locationsLoaded = false;

// Height of the sticky header bar, for the sticky parts of the views below it.
new ResizeObserver(([entry]) => document.documentElement.style.setProperty("--bar-h", `${entry.target.offsetHeight}px`))
  .observe(document.querySelector(".bar"));

// ---- Per-save marks ----
// Regions marked reachable, checks marked checked by hand and notes are kept by the mod with the
// game save, next to the found items (docs/protocol.md): "map:<region>", "mark:<location>",
// "note:<key>\t<text>". Lines starting with "-" remove an entry; a note replaces its key's note.
// The change shows at once; the mod's next state confirms it.
function saveEntries(lines) {
  if (!state?.inGame || !state.found || !lines.length) return Promise.resolve();
  let entries = state.found.entries;
  const drop = (key) => (entries = entries.filter((e) => e !== key && !e.startsWith(`${key}\t`)));
  for (const line of lines) {
    if (line.startsWith("-")) drop(line.slice(1));
    else if (line.startsWith("note:")) {
      const tab = line.indexOf("\t");
      drop(line.slice(0, tab));
      if (tab + 1 < line.length) entries = [...entries, line];
    } else if (!entries.includes(line)) entries = [...entries, line];
  }
  state.found = { ...state.found, entries };
  return fetch("found", { method: "POST", headers: { "Content-Type": "text/plain" }, body: lines.join("\n") }).catch(() => {});
}

// ---- State ----

function applyState(next) {
  if (next.protocol !== PROTOCOL_VERSION) {
    setStatus("offline", `Protocol mismatch (mod ${next.protocol}, page ${PROTOCOL_VERSION}) — update the mod`);
    return;
  }
  if (!next.inGame) {
    // Keep the last known inventory visible while on the title screen.
    setStatus("idle", "Connected — waiting for a save file");
    return;
  }
  state = next;
  setStatus("live", editing ? "Live — editing layout" : "Live");
  renderItems();
  renderDungeons(state.dungeons);
  locationsView.setState(state);
}

function connect() {
  // EventSource reconnects on its own (the mod sends "retry: 2000").
  const source = new EventSource("events");
  source.addEventListener("state", (e) => {
    try {
      applyState(JSON.parse(e.data));
    } catch (err) {
      console.error("bad state event", err);
    }
  });
  source.addEventListener("open", () => {
    loadLayout();
    loadSettings();
    if (!locationsLoaded) {
      locationsLoaded = true;
      locationsView.load();
    }
  });
  // Another page (or OBS) saved a layout/theme: reload it here too.
  source.addEventListener("config", () => {
    if (!editing) loadLayout();
    loadSettings();
  });
  source.addEventListener("error", () => setStatus("offline", "Game not running — retrying…"));
}

applySettings();
renderItems();
renderDungeons([]);
connect();
