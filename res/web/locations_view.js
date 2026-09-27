// Locations tab: every randomizer check grouped by region, marked obtained / reachable / not yet
// reachable, with per-check custom requirements (routes of items) that replace the randomizer
// logic for that check.

import yaml from "./vendor/js-yaml.mjs";
import { World, Search, itemsFromState, routeSatisfied, routeEntrySatisfied, routeEntryLabel, parseDisplay, atomLabel } from "./logic.js";
import { REGION_GROUPS, FlagReader, buildLocationList, isObtained } from "./locations.js";

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

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};

/**
 * @param root      container element
 * @param options.getOverrides  () => { [location]: [[{item, n}], ...] }
 * @param options.saveOverrides (overrides) => Promise
 * @param options.getLogic      () => boolean, whether reachability is evaluated
 * @param options.saveLogic     (enabled) => Promise
 * @param options.setStatus     (kind, text) => void
 */
// Below this width the region list and the check list are shown one at a time.
const NARROW_WIDTH = 560;

export function createLocationsView(root, { getOverrides, saveOverrides, getLogic, saveLogic, setStatus }) {
  let world = null;
  let locations = [];
  let pickableItems = [];
  let excluded = new Set();
  let settingsNote = "";
  let loadError = "";
  let state = null;
  let results = new Map(); // location -> "obtained" | "reachable" | "blocked" | "excluded" | "unknown"
  let search = null; // last finished logic search
  let selectedGroup = REGION_GROUPS[0].name;
  let hideObtained = false;
  let editing = null; // { name, routes, edit } while the detail panel is open
  let focused = null; // highlighted check (left click, or right click to toggle)
  let highlightedGroup = null; // the one highlighted region (left or right click)
  let showChecks = false; // narrow layout: the check list of selectedGroup is open

  new ResizeObserver(() => root.classList.toggle("loc-narrow", root.clientWidth > 0 && root.clientWidth < NARROW_WIDTH))
    .observe(root);

  try {
    hideObtained = localStorage.getItem("tracker.hideObtained") === "1";
    selectedGroup = localStorage.getItem("tracker.locGroup") || selectedGroup;
    focused = localStorage.getItem("tracker.locFocus") || null;
    highlightedGroup = localStorage.getItem("tracker.locMark") || null;
  } catch {}

  // ---- Data ----

  async function fetchText(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.text();
  }

  let retryTimer = null;
  let retries = 0;

  async function load() {
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
      let settings = {};
      settingsNote = "";
      try {
        settings = yaml.load(await fetchText("rando-settings.yaml")) ?? {};
      } catch {
        settingsNote = "Randomizer settings not found — using default settings.";
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
      pickableItems = (data["items.yaml"] ?? [])
        .filter((i) => i?.Name && i.Importance !== "Junk")
        .map((i) => i.Name)
        .sort((a, b) => a.localeCompare(b));
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

  // ---- Evaluation ----

  function evaluate() {
    results = new Map();
    search = null;
    if (!world || !state) return;
    const reader = new FlagReader(state.flags);
    if (!getLogic()) {
      // Logic off: only obtained / not obtained (e.g. entrance randomizer seeds).
      for (const loc of locations) {
        if (reader.ok && isObtained(loc, reader)) results.set(loc.name, "obtained");
        else results.set(loc.name, excluded.has(loc.name) ? "excluded" : "unknown");
      }
      return;
    }
    const inv = itemsFromState(state);
    search = new Search(world, inv).run();
    const overrides = getOverrides();
    for (const loc of locations) {
      if (reader.ok && isObtained(loc, reader)) results.set(loc.name, "obtained");
      else if (excluded.has(loc.name)) results.set(loc.name, "excluded");
      else {
        const custom = overrides[loc.name];
        const ok = custom ? custom.some((r) => routeSatisfied(search, r)) : search.canReach(loc.name);
        results.set(loc.name, ok ? "reachable" : "blocked");
      }
    }
  }

  // ---- Rendering ----

  function counts(group) {
    let reachable = 0;
    let remaining = 0;
    let obtained = 0;
    for (const loc of locations) {
      if (group && loc.group !== group) continue;
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
    const total = counts(null);
    const hide = el("label", { className: "loc-toggle" },
      el("input", { type: "checkbox", checked: hideObtained, onchange: (e) => {
        hideObtained = e.target.checked;
        try { localStorage.setItem("tracker.hideObtained", hideObtained ? "1" : "0"); } catch {}
        render();
      } }), " Hide obtained");
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
    const menu = el("details", { className: "loc-menu" }, el("summary", { className: "tool", textContent: "Rules ▾" }),
      el("div", { className: "loc-menu-items" },
        el("button", { className: "tool", type: "button", textContent: "Export rules", onclick: exportOverrides }),
        el("label", { className: "tool" }, "Import rules", el("input", { type: "file", accept: "application/json,.json", hidden: true, onchange: importOverrides })),
        el("button", { className: "tool", type: "button", textContent: "Reload data", onclick: load })));
    toolbar.append(
      el("span", { className: "loc-summary" }, ...(logic
        ? [el("b", { className: "reach", textContent: String(total.reachable) }), " reachable · "]
        : [el("b", { textContent: String(total.obtained) }), " obtained · "]),
      el("b", { textContent: String(total.remaining) }), " remaining"),
      el("span", { className: "loc-actions" }, logicSwitch, hide, menu),
    );
    if (settingsNote && logic) toolbar.append(el("span", { className: "loc-note", textContent: settingsNote }));
    if (!state) toolbar.append(el("span", { className: "loc-note", textContent: "Waiting for the game…" }));

    const groups = el("div", { className: "loc-groups" });
    for (const g of REGION_GROUPS) {
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
    for (const loc of locations.filter((l) => l.group === selectedGroup)) {
      const r = results.get(loc.name) ?? "unknown";
      if (hideObtained && r === "obtained") continue;
      list.append(el("button", {
        type: "button",
        className: `loc-row plate ${r}` + (loc.name === focused ? " selected" : ""),
        title: { obtained: "Obtained", reachable: "Reachable now", blocked: "Not reachable yet", excluded: "Excluded location", unknown: "Not obtained" }[r],
        // Left click highlights the check and opens its requirement.
        onclick: () => {
          setFocus(loc.name);
          openDetail(loc.name);
        },
        // Right click only toggles the highlight.
        oncontextmenu: (e) => {
          e.preventDefault();
          setFocus(focused === loc.name ? null : loc.name);
          render();
        },
      }, el("span", { className: "loc-dot" }), el("span", { className: "loc-name", textContent: loc.name }),
      overrides[loc.name] ? el("span", { className: "loc-tag", textContent: "custom" }) : null));
    }
    if (!list.childElementCount) list.append(el("p", { className: "empty", textContent: "Nothing left here." }));

    const banner = el("div", { className: "loc-banner" },
      el("button", { type: "button", className: "loc-back", textContent: "‹ Back", onclick: () => { showChecks = false; render(); } }),
      el("span", { className: "loc-banner-title", textContent: selectedGroup }),
      el("span", { className: "loc-count" }, ...countLabel(counts(selectedGroup))));
    const checks = el("div", { className: "loc-checks" }, banner, list);
    const body = el("div", { className: "loc-body" + (showChecks ? " show-checks" : "") }, groups, checks);
    root.replaceChildren(toolbar, body);
    if (editing) root.append(renderDetail());
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
    const existing = getOverrides()[name];
    editing = { name, routes: existing ? structuredClone(existing) : null, edit: false };
    render();
  }

  // Requirement tree: "and" parts side by side, "or" alternatives stacked, each atom framed.
  function renderReq(node) {
    if (node.t === "atom") {
      const entry = node.entry ?? { item: node.text, n: 1 };
      const met = search ? routeEntrySatisfied(search, entry) : null;
      const label = node.entry ? `${routeEntryLabel(entry.item)}${entry.n > 1 ? ` ×${entry.n}` : ""}` : atomLabel(node.text);
      return el("span", { className: "req-part" + (met === true ? " met" : met === false ? " unmet" : ""), title: met === false ? "Not met yet" : "", textContent: label });
    }
    const group = el("div", { className: `req-${node.t}` });
    node.args.forEach((arg, i) => {
      if (i) group.append(el("span", { className: "req-op", textContent: node.t }));
      group.append(renderReq(arg));
    });
    return group;
  }

  function routesTree(routes) {
    const and = (r) => (r.length === 1 ? { t: "atom", entry: r[0] } : { t: "and", args: r.map((entry) => ({ t: "atom", entry })) });
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

  function renderDetail() {
    const { name } = editing;
    const status = results.get(name) ?? "unknown";
    const access = world.locationAccess.get(name) ?? [];
    const custom = getOverrides()[name];
    const panel = el("div", { className: "loc-detail" });
    panel.append(el("div", { className: "loc-detail-head" },
      el("h3", { textContent: name }),
      el("span", { className: `loc-status ${status}`, textContent: { obtained: "Obtained", reachable: "Reachable", blocked: "Not reachable", excluded: "Excluded", unknown: "Logic off" }[status] }),
      el("button", { className: "tool", type: "button", textContent: "Close", onclick: () => { editing = null; render(); } })));

    const req = el("div", { className: "loc-req" });
    if (editing.edit) {
      req.append(el("h4", { textContent: "Custom requirement" }),
        el("p", { className: "loc-note", textContent: "Every entry of one route is needed; any route is enough." }));
      editing.routes.forEach((route, ri) => req.append(renderRoute(route, ri)));
      req.append(el("div", { className: "loc-custom-actions" },
        el("button", { className: "tool", type: "button", textContent: "+ Route (or)", onclick: () => { editing.routes.push([]); render(); } }),
        el("button", { className: "tool", type: "button", textContent: "Use randomizer logic", onclick: () => save(null) }),
        el("button", { className: "tool", type: "button", textContent: "Cancel", onclick: () => openDetail(name) }),
        el("button", { className: "tool primary", type: "button", textContent: "Save", onclick: () => save(editing.routes) })));
      req.append(el("details", { className: "loc-rando" }, el("summary", { textContent: "Randomizer logic" }), ...randomizerReq(access)));
    } else if (custom) {
      req.append(el("h4", {}, "Requirement ", el("span", { className: "loc-tag", textContent: "custom" })),
        el("div", { className: "req-tree" }, renderReq(routesTree(custom))),
        el("details", { className: "loc-rando" }, el("summary", { textContent: "Randomizer logic" }), ...randomizerReq(access)),
        el("div", { className: "loc-custom-actions" },
          el("button", { className: "tool", type: "button", textContent: "Edit", onclick: () => { editing.edit = true; render(); } }),
          el("button", { className: "tool", type: "button", textContent: "Use randomizer logic", onclick: () => save(null) })));
    } else {
      req.append(el("h4", { textContent: "Requirement" }), ...randomizerReq(access),
        el("div", { className: "loc-custom-actions" },
          el("button", { className: "tool", type: "button", textContent: "Customize", title: "Replace the randomizer logic for this check with your own routes", onclick: () => { editing.routes = [[]]; editing.edit = true; render(); } })));
    }
    panel.append(req);
    return panel;
  }

  function renderRoute(route, ri) {
    const row = el("div", { className: "loc-route" }, el("span", { className: "loc-route-label", textContent: ri === 0 ? "Route" : "or" }));
    route.forEach((chip, ci) => {
      const have = !search || routeEntrySatisfied(search, chip);
      row.append(el("span", { className: have ? "chip" : "chip missing", title: have ? "" : "Not met yet" }, `${routeEntryLabel(chip.item)}${chip.n > 1 ? ` ×${chip.n}` : ""}`,
        el("button", { type: "button", className: "chip-x", textContent: "×", title: "Remove", onclick: () => { route.splice(ci, 1); render(); } })));
    });
    if (!route.length) row.append(el("span", { className: "loc-note", textContent: "(no items: always reachable)" }));
    const select = el("select", { className: "loc-item-select" }, el("option", { value: "", textContent: "+ Item…" }),
      ...pickableItems.map((n) => el("option", { value: n, textContent: n })));
    const count = el("input", { type: "number", min: 1, max: 99, value: 1, className: "loc-item-count", title: "Count" });
    select.addEventListener("change", () => {
      if (!select.value) return;
      route.push({ item: select.value, n: Math.max(1, Number(count.value) || 1) });
      render();
    });
    row.append(select, count);
    if (editing.routes.length > 1) {
      row.append(el("button", { type: "button", className: "tool", textContent: "Remove route", onclick: () => { editing.routes.splice(ri, 1); render(); } }));
    }
    return row;
  }

  async function save(routes) {
    const next = { ...getOverrides() };
    if (routes) next[editing.name] = routes.map((r) => r.map(({ item, n }) => ({ item, n: n || 1 })));
    else delete next[editing.name];
    await saveOverrides(next);
    editing = null;
    evaluate();
    render();
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
      state = next;
      evaluate();
      render();
    },
    refresh() {
      evaluate();
      render();
    },
  };
}

// Keeps only well-formed rules: { location: [[{ item, n }]] }.
export function normalizeOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [loc, routes] of Object.entries(raw)) {
    if (!Array.isArray(routes)) continue;
    const clean = routes
      .filter(Array.isArray)
      .map((r) => r.filter((c) => c && typeof c.item === "string").map((c) => ({ item: c.item, n: Math.max(1, Math.min(99, Number(c.n) || 1)) })));
    if (clean.length) out[loc] = clean;
  }
  return out;
}
