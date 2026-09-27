// Locations tab: every randomizer check grouped by region, marked obtained / reachable / not yet
// reachable, with per-check custom requirements (routes of items) that replace the randomizer
// logic for that check.

import yaml from "./vendor/js-yaml.mjs";
import { World, Search, itemsFromState, routeSatisfied, routeEntrySatisfied, routeEntryLabel, trackerEntry, parseDisplay, atomLabel } from "./logic.js";
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

// On/off conditions offered under "Rand Settings". The twilights are read from the game (cleared by
// playing or by the seed); the others are the randomizer's settings.
const RANDO_FLAGS = [
  "Skip Prologue", "Faron Twilight Cleared", "Eldin Twilight Cleared", "Lanayru Twilight Cleared",
  "Skip Midna's Desperate Hour", "Unlock Map Regions", "Open Door of Time", "Active Goron Mines Magnets",
  "Lower Hyrule Castle Chandelier", "Skip Bridge Donation", "Logic Transform Anywhere",
  "Lakebed Does Not Require Water Bombs", "Arbiters Does Not Require Bulblin Camp",
  "Snowpeak Does Not Require Reekfish Scent", "Sacred Grove Does Not Require Skull Kid",
  "City Does Not Require Filled Skybook",
];
const GAME_TWILIGHTS = { "Faron Twilight Cleared": "Faron", "Eldin Twilight Cleared": "Eldin", "Lanayru Twilight Cleared": "Lanayru" };

// Condition groups of the requirement editor: [key, tab label, search placeholder].
const ENTRY_TABS = [
  ["item", "Items", "Search items…"],
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
 * @param options.saveOverrides (overrides) => Promise
 * @param options.getLogic      () => boolean, whether reachability is evaluated
 * @param options.saveLogic     (enabled) => Promise
 * @param options.getMapFlags   () => [region], the regions marked reachable by hand
 * @param options.saveMapFlags  ([region]) => Promise
 * @param options.setStatus     (kind, text) => void
 */
// Below this width the region list and the check list are shown one at a time.
const NARROW_WIDTH = 560;

export function createLocationsView(root, { getOverrides, saveOverrides, getLogic, saveLogic, getMapFlags, saveMapFlags, setStatus }) {
  let world = null;
  let locations = [];
  let pickableItems = [];
  let mapRegions = [];
  let randoFlags = [];
  let excluded = new Set();
  let settingsNote = "";
  let loadError = "";
  let state = null;
  let results = new Map(); // location -> "obtained" | "reachable" | "blocked" | "excluded" | "unknown"
  let search = null; // last finished logic search
  let selectedGroup = REGION_GROUPS[0].name;
  let hideObtained = false;
  let editing = null; // { name, routes, edit, active, tab } while the detail panel is open
  let popup = null; // separate window the requirement is edited in (null: edited in the panel)
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
      mapRegions = [...new Set([...world.areas.values()].map((a) => a.region).filter((r) => r && r !== "None"))]
        .sort((a, b) => a.localeCompare(b));
      randoFlags = RANDO_FLAGS.filter((f) => GAME_TWILIGHTS[f] || world.settingOptions.get(f)?.includes("On"));
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
        const ok = custom ? custom.some((r) => routeSatisfied(search, r, entryContext())) : search.canReach(loc.name);
        results.set(loc.name, ok ? "reachable" : "blocked");
      }
    }
  }

  // Decides the time / setting / map entries of custom routes.
  function entryContext() {
    return {
      test({ kind, name }) {
        if (kind === "time") return typeof state?.time?.night === "boolean" && state.time.night === (name === "Night");
        if (kind === "map") return getMapFlags().includes(name);
        if (kind === "flag") return flagOn(name);
        return false;
      },
    };
  }

  function flagOn(name) {
    const game = GAME_TWILIGHTS[name];
    if (game && state?.twilightCleared?.[game]) return true;
    return world?.setting(name) === "On";
  }

  function entryMet(entry) {
    return routeEntrySatisfied(search, entry, entryContext());
  }

  async function toggleMap(region) {
    const on = new Set(getMapFlags());
    if (on.has(region)) on.delete(region);
    else on.add(region);
    await saveMapFlags([...on].sort());
    evaluate();
    render();
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
    const searching = document.activeElement?.classList.contains("rule-search") && root.contains(document.activeElement);
    root.replaceChildren(toolbar, body);
    if (editing) root.append(renderDetail());
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
      el("button", { className: "tool", type: "button", textContent: "Close", onclick: () => { closePopup(); editing = null; render(); } })));

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
    Object.assign(editing, { routes, edit: true, active: 0, tab: "item", query: "" });
    popup = openPopup();
    if (popup) renderPopup();
    render();
  }

  function openPopup() {
    let w = null;
    try {
      w = window.open("", "tracker-requirement-editor", "popup,width=760,height=640");
    } catch {}
    if (!w) return null;
    const d = w.document;
    d.open();
    d.write("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"></head><body class=\"rule-window\"></body></html>");
    d.close();
    d.title = `Requirement: ${editing.name}`;
    d.head.append(Object.assign(d.createElement("link"), { rel: "stylesheet", href: new URL("style.css", location.href).href }));
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
  }

  function renderEditor() {
    const { name } = editing;
    const access = world.locationAccess.get(name) ?? [];
    const wrap = el("div", { className: "rule-editor" });
    wrap.append(el("div", { className: "loc-detail-head" },
      el("h3", { textContent: name }),
      el("button", { className: "tool", type: "button", textContent: "Cancel", onclick: cancelEdit })));

    // The requirement as it will look once saved, one framed row per route.
    const current = el("section", { className: "rule-frame rule-current" },
      el("h4", { textContent: "Custom requirement" }),
      el("p", { className: "loc-note", textContent: "Every part of a route is needed; any one route is enough. Click a route to add to it." }));
    editing.routes.forEach((route, ri) => {
      if (ri) current.append(el("div", { className: "req-op req-op-block", textContent: "or" }));
      current.append(renderRoute(route, ri));
    });
    current.append(el("button", { className: "tool", type: "button", textContent: "+ Route (or)",
      onclick: () => { editing.routes.push([]); editing.active = editing.routes.length - 1; redrawEditor(true); } }));

    wrap.append(current, renderPicker(),
      el("div", { className: "loc-custom-actions" },
        el("button", { className: "tool", type: "button", textContent: "Use randomizer logic", onclick: () => save(null) }),
        el("button", { className: "tool", type: "button", textContent: "Cancel", onclick: cancelEdit }),
        el("button", { className: "tool primary", type: "button", textContent: "Save", onclick: () => save(editing.routes) })),
      el("details", { className: "loc-rando" }, el("summary", { textContent: "Randomizer logic" }), ...randomizerReq(access)));
    return wrap;
  }

  function renderRoute(route, ri) {
    const active = ri === editing.active;
    const row = el("div", { className: "rule-route" + (active ? " active" : ""), title: active ? "" : "Click to add to this route",
      onclick: () => { if (editing.active !== ri) { editing.active = ri; redrawEditor(true); } } },
    el("span", { className: "loc-route-label", textContent: `Route ${ri + 1}` }));
    const parts = el("div", { className: "req-and" });
    route.forEach((entry, ci) => {
      if (ci) parts.append(el("span", { className: "req-op", textContent: "and" }));
      const met = search ? entryMet(entry) : null;
      const map = trackerEntry(entry.item)?.kind === "map";
      parts.append(el("span", { className: "req-part" + (met === true ? " met" : met === false ? " unmet" : ""), title: met === false ? "Not met yet" : "" },
        map ? mapCheck(met) : null,
        `${routeEntryLabel(entry.item)}${entry.n > 1 ? ` ×${entry.n}` : ""}`,
        el("button", { type: "button", className: "chip-x", textContent: "×", title: "Remove",
          onclick: (e) => { e.stopPropagation(); route.splice(ci, 1); redrawEditor(); } })));
    });
    if (!route.length) parts.append(el("span", { className: "loc-note", textContent: "(empty: always reachable)" }));
    row.append(parts);
    if (editing.routes.length > 1) {
      row.append(el("button", { type: "button", className: "tool rule-route-remove", textContent: "Remove route",
        onclick: (e) => {
          e.stopPropagation();
          editing.routes.splice(ri, 1);
          editing.active = Math.min(editing.active, editing.routes.length - 1);
          redrawEditor();
        } }));
    }
    return row;
  }

  // Tabs of condition groups, a search box and the matching conditions.
  function candidates(tab) {
    if (tab === "time") return ["Day", "Night"].map((t) => ({ item: `time:${t}`, label: t, on: entryMet({ item: `time:${t}` }) }));
    if (tab === "flag") return randoFlags.map((f) => ({ item: `flag:${f}`, label: f, on: flagOn(f) }));
    if (tab === "map") return mapRegions.map((r) => ({ item: `map:${r}`, label: r, on: getMapFlags().includes(r) }));
    return pickableItems.map((i) => ({ item: i, label: i }));
  }

  function renderPicker() {
    const tab = editing.tab ?? "item";
    const route = editing.routes[editing.active] ?? editing.routes[0];
    const box = el("section", { className: "rule-frame rule-picker" },
      el("h4", { textContent: `Add to Route ${editing.active + 1}` }));
    box.append(el("div", { className: "rule-tabs", role: "tablist" }, ...ENTRY_TABS.map(([key, label]) => el("button", {
      type: "button", role: "tab", className: "rule-tab" + (key === tab ? " selected" : ""), textContent: label,
      ariaSelected: String(key === tab),
      onclick: () => { editing.tab = key; editing.query = ""; redrawEditor(true); },
    }))));
    const placeholder = ENTRY_TABS.find(([key]) => key === tab)[2];
    // The typed text survives redraws (e.g. a state update while the editor is in the panel).
    const input = el("input", { type: "search", className: "rule-search", placeholder, autocomplete: "off", spellcheck: false, value: editing.query ?? "" });
    const count = tab === "item" ? el("input", { type: "number", min: 1, max: 99, value: 1, className: "loc-item-count", title: "Count" }) : null;
    const list = el("div", { className: "rule-candidates" });
    const all = candidates(tab);
    const add = (c) => {
      route.push({ item: c.item, n: count ? Math.max(1, Math.min(99, Number(count.value) || 1)) : 1 });
      editing.query = "";
      redrawEditor(true);
    };
    let shown = [];
    const draw = () => {
      const words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      const used = new Set(route.map((e) => e.item));
      const query = words.join(" ");
      // Best matches first: the exact name, then names starting with the text, then word starts.
      const rank = (label) => {
        const l = label.toLowerCase();
        if (l === query) return 0;
        if (l.startsWith(query)) return 1;
        return words.every((w) => l.split(/[\s'-]+/).some((part) => part.startsWith(w))) ? 2 : 3;
      };
      shown = all.filter((c) => !used.has(c.item) && words.every((w) => c.label.toLowerCase().includes(w)));
      if (words.length) shown = shown.map((c) => [rank(c.label), c]).sort((x, y) => x[0] - y[0]).map(([, c]) => c);
      list.replaceChildren(...shown.slice(0, 80).map((c) => el("button", {
        type: "button", className: "rule-candidate" + (c.on === true ? " on" : c.on === false ? " off" : ""),
        title: c.on === undefined ? "" : c.on ? "Currently on" : "Currently off",
        onclick: () => add(c),
      }, c.label)));
      if (!shown.length) list.append(el("span", { className: "loc-note", textContent: "No match." }));
    };
    input.addEventListener("input", () => { editing.query = input.value; draw(); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && shown.length) {
        e.preventDefault();
        add(shown[0]);
      }
    });
    draw();
    box.append(el("div", { className: "rule-search-row" }, input, count), list);
    if (tab === "map") box.append(el("p", { className: "loc-note", textContent: "Map regions are marked reachable by hand: click a Map entry in a check's requirement to switch it for every check." }));
    if (tab === "time") box.append(el("p", { className: "loc-note", textContent: "Met when the game's clock shows that time (night is 19:00–6:00)." }));
    return box;
  }

  function cancelEdit() {
    closePopup();
    openDetail(editing.name);
  }

  async function save(routes) {
    const next = { ...getOverrides() };
    if (routes) next[editing.name] = routes.map((r) => r.map(({ item, n }) => ({ item, n: n || 1 })));
    else delete next[editing.name];
    await saveOverrides(next);
    closePopup();
    const name = editing.name;
    editing = null;
    evaluate();
    openDetail(name);
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
