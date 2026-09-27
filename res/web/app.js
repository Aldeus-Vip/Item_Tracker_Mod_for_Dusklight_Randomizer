import { COLUMNS, DEFAULT_LAYOUT, DUNGEON_EXTRAS, DUNGEON_ICONS, GAME_ICON_BACKGROUNDS, GAME_ICON_IDS, TILES, normalizeLayout } from "./layout.js";
import { createLocationsView, normalizeOverrides } from "./locations_view.js";

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
showView(initialView || "items");

function setStatus(kind, text) {
  statusEl.dataset.state = kind;
  statusText.textContent = text;
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

// The game's default for an icon: an item number (/game-icons/) or a texture reference.
function gameIconUrl(name, itemId) {
  const id = itemId !== undefined && itemId !== "" ? itemId : GAME_ICON_IDS[name];
  if (id === undefined) return null;
  return typeof id === "string" ? textureUrl(id) : `game-icons/${id}.png`;
}

function iconSources(name, itemId) {
  const custom = settings.iconOverrides[name];
  const first = custom?.source === "file" ? `icons/${encodeURIComponent(name)}.png?rev=${custom.rev}`
    : custom?.source === "texture" && custom.texture ? textureUrl(custom.texture) : null;
  return [first, gameIconUrl(name, itemId)].filter(Boolean);
}

// Texture drawn behind an icon (e.g. the field behind a field key), or null.
function iconBackground(name) {
  const custom = settings.iconOverrides[name];
  const ref = custom && "background" in custom ? custom.background : GAME_ICON_BACKGROUNDS[name];
  return ref ? textureUrl(ref) : null;
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
  // Without any source the fallback runs after the caller has attached the image.
  if (sources.length) tryNext();
  else queueMicrotask(tryNext);
  return img;
}

// ---- Items view ----

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
  if (!editing) return;
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
  // Icons changed in the icon editor: { [icon name]: { source: "file" | "game", rev } }. rev
  // changes on every upload so browsers fetch the new image.
  iconOverrides: {},
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
  const textureRef = (v) => (typeof v === "string" && /^[a-z0-9]{1,16}\/[\w.#-]{1,64}$/.test(v) ? v : undefined);
  for (const [name, o] of Object.entries(raw?.iconOverrides ?? {})) {
    if (/^[\w.'-]+$/.test(name) && o && typeof o === "object") {
      const entry = { source: ["file", "texture"].includes(o.source) ? o.source : "game", rev: Number(o.rev) || 0 };
      if (textureRef(o.texture)) entry.texture = o.texture;
      // null = no background (overrides a default background); absent = default.
      if (o.background === null || textureRef(o.background)) entry.background = o.background;
      out.iconOverrides[name] = entry;
    }
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

async function loadSettings() {
  try {
    const res = await fetch("settings", { cache: "no-store" });
    if (res.ok) settings = normalizeSettings(await res.json());
  } catch {}
  applySettings();
  locationsView.refresh();
}

themeButton.addEventListener("click", () => {
  themeBar.hidden = !themeBar.hidden;
});
document.getElementById("theme-close").addEventListener("click", () => (themeBar.hidden = true));
themeBar.addEventListener("click", (e) => {
  const swatch = e.target.closest(".swatch");
  if (!swatch) return;
  settings.theme = swatch.dataset.choice;
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
  const isDefault = next.source === "game" && !next.rev && !next.texture && !("background" in next);
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
  const background = "background" in custom ? custom.background : GAME_ICON_BACKGROUNDS[name] ?? null;

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
    picker,
    h("div", { className: "icon-previews" },
      previewBox(gameUrl, "From the game"),
      previewBox(custom.texture ? textureUrl(custom.texture) : null, "Game texture"),
      previewBox(hasFile ? `icons/${encodeURIComponent(name)}.png?rev=${custom.rev}` : null, "Image file")),
    h("div", { className: "icon-choices" },
      radio("game", gameUrl ? "From the game" : "From the game (none: shown as text)", true),
      radio("texture", "From a game texture", Boolean(custom.texture)),
      radio("file", "From image file", hasFile)),
    h("div", { className: "icon-actions" },
      h("button", { className: "tool", type: "button", textContent: custom.texture ? "Change texture…" : "Choose texture…",
        onclick: () => openTextureBrowser(async (ref) => { await updateIconOverride(name, { source: "texture", texture: ref }); reopen(); }) }),
      h("label", { className: "tool" }, hasFile ? "Replace image…" : "Upload image…", upload),
      hasFile && h("button", { className: "tool", type: "button", textContent: "Delete image", onclick: deleteFile })),
    h("div", { className: "icon-background" },
      h("span", { className: "label", textContent: "Background" }),
      background ? h("img", { src: textureUrl(background), alt: "", className: "icon-bg-preview" }) : h("span", { className: "loc-note", textContent: "none" }),
      h("button", { className: "tool", type: "button", textContent: "Choose…",
        onclick: () => openTextureBrowser(async (ref) => { await updateIconOverride(name, { background: ref }); reopen(); }) }),
      background && h("button", { className: "tool", type: "button", textContent: "Clear",
        onclick: async () => { await updateIconOverride(name, { background: null }); reopen(); } }),
      "background" in custom && h("button", { className: "tool", type: "button", textContent: "Default",
        onclick: async () => {
          const next = { ...custom };
          delete next.background;
          settings.iconOverrides[name] = next;
          await updateIconOverride(name, {});
          reopen();
        } })),
  );
  iconEditor.hidden = false;
}

// ---- Game texture browser ----

const TEXTURE_ARCHIVES = [
  ["itemicon", "Item icons"], ["collect", "Collection"], ["fmap", "Field map"],
  ["dmap", "Dungeon map"], ["ring", "Item wheel"], ["main2d", "HUD"],
];
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

for (const view of [views.items, views.dungeons]) {
  view.addEventListener("contextmenu", (e) => {
    const target = e.target.closest("[data-icon]");
    if (!target) return;
    e.preventDefault();
    const variants = [...(TILES[target.dataset.tile]?.variants ?? [])];
    if (!variants.some((v) => v.icon === target.dataset.icon)) {
      variants.unshift({ icon: target.dataset.icon, label: target.dataset.iconLabel || target.dataset.icon, item: target.dataset.iconItem });
    }
    openIconEditor(target.dataset.icon, target.dataset.iconLabel || target.dataset.icon, target.dataset.iconItem, variants);
  });
}

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

function renderDungeons(dungeons) {
  const items = state?.items ?? {};
  const table = document.createElement("table");
  table.className = "dungeons";
  const head = table.createTHead().insertRow();
  for (const label of ["Dungeon", "Small Keys", "Big Key", "Map", "Compass", "Boss", "Other"]) {
    const th = document.createElement("th");
    th.textContent = label;
    head.append(th);
  }
  const body = table.createTBody();
  for (const d of dungeons) {
    const row = body.insertRow();
    if (d.bossDefeated) row.className = "cleared";

    row.insertCell().textContent = d.name;

    const keys = row.insertCell();
    keys.className = "keys" + (d.smallKeys >= d.maxSmallKeys ? " complete" : "");
    keys.textContent = `${d.smallKeys} / ${d.maxSmallKeys}`;
    keys.title = `Holding ${d.smallKeysHeld}`;

    const bigKey = row.insertCell();
    if (d.name === "Goron Mines") {
      // Key shards replace the big key: show the assembled pieces.
      const shards = items["Goron Mines Key Shard"] ?? 0;
      bigKey.append(mark(shards > 0, `Key Shards ${shards}/3`, DUNGEON_ICONS.keyShards[Math.max(0, shards - 1)]));
      const n = document.createElement("span");
      n.className = "shards" + (shards >= 3 ? " complete" : "");
      n.textContent = `${shards}/3`;
      bigKey.append(n);
    } else if (d.hasBigKey) {
      bigKey.append(mark(d.bigKey, "Big Key", DUNGEON_ICONS.bigKeys[d.name] ?? DUNGEON_ICONS.bigKey));
    } else {
      bigKey.className = "na";
      bigKey.textContent = "—";
    }
    row.insertCell().append(mark(d.map, "Map", DUNGEON_ICONS.map));
    row.insertCell().append(mark(d.compass, "Compass", DUNGEON_ICONS.compass));
    // Boss icon when one is set in the icon editor, otherwise a circle.
    const bossIcon = DUNGEON_ICONS.bosses[d.name];
    const bossCell = row.insertCell();
    const bossMark = mark(d.bossDefeated, "Boss defeated");
    if (bossIcon) {
      bossMark.textContent = "";
      Object.assign(bossMark.dataset, { icon: bossIcon, iconLabel: bossIcon, iconItem: "" });
      bossMark.append(iconImg(bossIcon, "boss-icon", (img) => img.replaceWith(d.bossDefeated ? "●" : "○")));
    }
    bossCell.append(bossMark);

    const other = row.insertCell();
    other.className = "other";
    for (const extra of DUNGEON_EXTRAS[d.name] ?? []) {
      other.append(mark((items[extra.id] ?? 0) > 0, extra.label, extra.icon));
    }
  }
  views.dungeons.replaceChildren(table);
}

// ---- Locations view ----

const locationsView = createLocationsView(views.locations, {
  getOverrides: () => settings.logicOverrides,
  saveOverrides: async (overrides) => {
    settings.logicOverrides = overrides;
    await saveSettings();
  },
  getLogic: () => settings.logic,
  saveLogic: async (enabled) => {
    settings.logic = enabled;
    await saveSettings();
  },
  setStatus,
});
let locationsLoaded = false;

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
