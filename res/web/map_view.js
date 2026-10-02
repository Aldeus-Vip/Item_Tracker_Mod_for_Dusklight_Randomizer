// Map tab: the logic regions of the world, where Link is, which regions are marked reachable (kept
// with the game save), and notes. A region's card shows it with the regions next to it (click one
// to go there) and the checks inside it (click one to open it in the Locations tab).

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
};
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children.filter(Boolean));
  return node;
};

const NOTE_MAX = 400;

/**
 * @param root     container element
 * @param options.getData      () => locations view mapData(): { world, mapGroups, locations, results, roomRegion, mapFlags } or null
 * @param options.getState     () => last state from the mod
 * @param options.toggleMap    (region) => Promise; switches a region's reachable mark
 * @param options.saveEntries  (lines) => Promise; per-save entries ("map:", "note:")
 * @param options.showCheck    (location) => void; opens a check in the Locations tab
 * @param options.refresh      () => void; evaluates the checks again (and redraws this tab)
 */
export function createMapView(root, { getData, getState, toggleMap, saveEntries, showCheck, refresh }) {
  let viewRegion = null; // region shown; null follows Link
  let lastLinkRegion = null;
  let cache = { world: null }; // derived from the world: region of each area, neighbors, checks
  let openGroups = new Set();

  try {
    viewRegion = localStorage.getItem("tracker.mapRegion") || null;
    openGroups = new Set(JSON.parse(localStorage.getItem("tracker.mapOpen") ?? "[]"));
  } catch {}

  const remember = (key, value) => {
    try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch {}
  };

  // Regions of areas (an interior has none: it takes the region of the area its door leads to),
  // the regions each region has exits to, and the checks in each region.
  function derive(data) {
    if (cache.world === data.world && cache.locations === data.locations) return cache;
    const { world } = data;
    const regionOf = new Map();
    for (const [name, area] of world.areas) if (area.region && area.region !== "None") regionOf.set(name, area.region);
    // Interiors: nearest area with a region through exits (a few passes settle chains of rooms).
    for (let pass = 0; pass < 6; pass++) {
      for (const [name, area] of world.areas) {
        if (regionOf.has(name)) continue;
        const near = area.exits.map((e) => regionOf.get(e.to)).find(Boolean);
        if (near) regionOf.set(name, near);
      }
    }
    const neighbors = new Map();
    for (const [name, area] of world.areas) {
      const from = regionOf.get(name);
      if (!from) continue;
      for (const exit of area.exits) {
        const to = regionOf.get(exit.to);
        if (!to || to === from) continue;
        if (!neighbors.has(from)) neighbors.set(from, new Set());
        if (!neighbors.has(to)) neighbors.set(to, new Set());
        neighbors.get(from).add(to);
        neighbors.get(to).add(from);
      }
    }
    const checks = new Map();
    for (const loc of data.locations) {
      const area = world.locationAccess.get(loc.name)?.[0]?.area;
      const region = area && regionOf.get(area);
      if (!region) continue;
      if (!checks.has(region)) checks.set(region, []);
      checks.get(region).push(loc.name);
    }
    cache = { world, locations: data.locations, regionOf, neighbors, checks };
    return cache;
  }

  const entriesOf = (kind) => (getState()?.found?.entries ?? []).filter((e) => e.startsWith(`${kind}:`)).map((e) => e.slice(kind.length + 1));
  const notes = () => new Map(entriesOf("note").map((e) => {
    const tab = e.indexOf("\t");
    return [e.slice(0, tab), e.slice(tab + 1)];
  }));

  function linkRegion(data) {
    const state = getState();
    return state?.inGame ? data.roomRegion(state.stage, state.room) : null;
  }

  function counts(data, region) {
    let reachable = 0;
    let remaining = 0;
    for (const name of cache.checks.get(region) ?? []) {
      const r = data.results.get(name);
      if (r === "reachable") reachable++;
      if (r === "reachable" || r === "blocked" || r === "unknown") remaining++;
    }
    return { reachable, remaining };
  }

  function go(region) {
    viewRegion = region;
    remember("tracker.mapRegion", region);
    render();
  }

  function render() {
    if (root.hidden) return;
    // Not while a note is being written (state updates arrive every few seconds).
    if (document.activeElement?.matches?.(".map-note") && root.contains(document.activeElement)) return;
    const data = getData();
    if (!data) {
      root.replaceChildren(el("p", { className: "empty", textContent: "Loading logic data…" }));
      return;
    }
    derive(data);
    const state = getState();
    const here = linkRegion(data);
    // Link moved to another region: the map follows him.
    if (here && here !== lastLinkRegion) {
      lastLinkRegion = here;
      viewRegion = null;
      remember("tracker.mapRegion", null);
    }
    const shown = viewRegion ?? here ?? data.mapGroups[0]?.regions[0];
    const marked = new Set(data.mapFlags);
    const pins = new Set(entriesOf("note").filter((e) => e.startsWith("pin/")).map((e) => e.slice(4, e.indexOf("\t"))));

    const toolbar = el("div", { className: "map-toolbar" },
      el("span", { className: "map-where" }, here ? "Link: " : state?.inGame ? "Link: unknown room" : "Waiting for a save file…",
        here ? el("b", { textContent: here }) : null),
      el("button", {
        type: "button",
        className: "tool" + (viewRegion && here ? " primary" : ""),
        textContent: "Current position",
        disabled: !here,
        title: "Show the region Link is in (the map follows Link when he changes region)",
        onclick: () => go(null),
      }),
      el("span", { className: "loc-note", textContent: "Reachable marks and notes are kept with the game save." }));

    // Left: every region by province, with its reachable mark.
    const list = el("div", { className: "map-groups" });
    for (const g of data.mapGroups) {
      const open = openGroups.has(g.title) || g.regions.includes(shown);
      const on = g.regions.filter((r) => marked.has(r)).length;
      const head = el("div", { className: "map-group-head" },
        el("button", {
          type: "button",
          className: "map-group-title",
          textContent: `${open ? "▾" : "▸"} ${g.title}`,
          onclick: () => {
            if (openGroups.has(g.title) || g.regions.includes(shown)) openGroups.delete(g.title);
            else openGroups.add(g.title);
            remember("tracker.mapOpen", JSON.stringify([...openGroups]));
            render();
          },
        }),
        el("span", { className: "loc-count", textContent: `${on} / ${g.regions.length}` }),
        el("button", {
          type: "button",
          className: "tool rule-small",
          textContent: on === g.regions.length ? "All off" : "All on",
          disabled: !state?.inGame,
          title: "Mark every region of this group reachable / not reachable",
          onclick: () => {
            const all = on === g.regions.length;
            saveEntries(g.regions.filter((r) => marked.has(r) === all).map((r) => (all ? `-map:${r}` : `map:${r}`)))
              .then(refresh);
          },
        }));
      const rows = open ? g.regions.map((r) => {
        const c = counts(data, r);
        return el("div", { className: "map-row" + (r === shown ? " selected" : "") + (r === here ? " here" : "") },
          el("label", { className: "loc-toggle", title: "Marked reachable" },
            el("input", { type: "checkbox", checked: marked.has(r), disabled: !state?.inGame, onchange: () => toggleMap(r) })),
          el("button", { type: "button", className: "map-row-name", onclick: () => go(r) },
            r === here ? el("span", { className: "map-link", textContent: "◆", title: "Link is here" }) : null,
            pins.has(r) ? el("span", { className: "map-pin", textContent: "★", title: "Marked" }) : null,
            r),
          el("span", { className: "loc-count" }, el("b", { className: "reach", textContent: String(c.reachable) }), ` / ${c.remaining}`));
      }) : [];
      list.append(el("section", { className: "map-group" }, head, ...rows));
    }

    root.replaceChildren(toolbar, el("div", { className: "map-body" }, list, renderCard(data, shown, here, marked, pins)));
  }

  // The shown region: its neighbors around it, its checks, its mark and its note.
  function renderCard(data, region, here, marked, pins) {
    const state = getState();
    const near = [...(cache.neighbors.get(region) ?? [])].sort((a, b) => a.localeCompare(b));
    const card = el("div", { className: "map-card" });
    card.append(el("div", { className: "loc-banner" },
      el("span", { className: "loc-banner-title", textContent: region ?? "" }),
      region === here ? el("span", { className: "map-here-tag", textContent: "Link is here" }) : null));

    // Diagram: the region in the middle, the regions it has exits to around it.
    const W = 560;
    const H = Math.max(260, 120 + near.length * 18);
    const cx = W / 2;
    const cy = H / 2;
    const rx = W / 2 - 110;
    const ry = H / 2 - 40;
    const map = svg("svg", { class: "map-diagram", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `${region} and the regions next to it` });
    const node = (name, x, y, center) => {
      const on = marked.has(name);
      const g = svg("g", { class: "map-node" + (center ? " center" : "") + (on ? " on" : "") + (name === here ? " here" : ""), tabindex: center ? -1 : 0 });
      const width = Math.min(200, 26 + name.length * 7.2);
      g.append(svg("rect", { x: x - width / 2, y: y - 15, width, height: 30, rx: 4 }),
        svg("text", { x, y: y + 5, "text-anchor": "middle" }, name));
      if (name === here) g.append(svg("text", { class: "map-node-link", x: x - width / 2 - 12, y: y + 6, "text-anchor": "middle" }, "◆"));
      if (!center) {
        g.addEventListener("click", () => go(name));
        g.addEventListener("keydown", (e) => { if (e.key === "Enter") go(name); });
        g.append(svg("title", {}, `Go to ${name}`));
      }
      return g;
    };
    near.forEach((n, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(1, near.length)) * Math.PI * 2;
      const x = cx + Math.cos(angle) * rx;
      const y = cy + Math.sin(angle) * ry;
      map.append(svg("line", { class: "map-edge" + (marked.has(n) ? " on" : ""), x1: cx, y1: cy, x2: x, y2: y }));
    });
    near.forEach((n, i) => {
      const angle = -Math.PI / 2 + (i / Math.max(1, near.length)) * Math.PI * 2;
      map.append(node(n, cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry, false));
    });
    if (region) map.append(node(region, cx, cy, true));
    card.append(map);

    const note = notes().get(`region/${region}`) ?? "";
    const pinned = pins.has(region);
    card.append(el("div", { className: "map-actions" },
      el("label", { className: "loc-toggle" },
        el("input", { type: "checkbox", checked: marked.has(region), disabled: !state?.inGame, onchange: () => toggleMap(region) }),
        " Reachable"),
      el("label", { className: "loc-toggle" },
        el("input", { type: "checkbox", checked: pinned, disabled: !state?.inGame,
          onchange: () => saveEntries([pinned ? `-note:pin/${region}` : `note:pin/${region}\t1`]).then(render) }),
        " Mark ★")));

    const text = el("textarea", { className: "map-note", maxLength: NOTE_MAX, rows: 3, value: note, disabled: !state?.inGame,
      placeholder: state?.inGame ? "Note for this region (e.g. what an entrance leads to)…" : "Load a save to write notes" });
    const saveNote = () => {
      const value = text.value.replace(/[\t\r\n]+/g, " ").trim().slice(0, NOTE_MAX);
      if (value !== note) saveEntries([value ? `note:region/${region}\t${value}` : `-note:region/${region}`]);
    };
    text.addEventListener("blur", saveNote);
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        text.blur();
      }
    });
    card.append(text);

    const checks = cache.checks.get(region) ?? [];
    const c = counts(data, region);
    card.append(el("h4", { className: "map-checks-title" }, `Checks (${c.reachable} reachable / ${c.remaining} left)`));
    const rows = el("div", { className: "loc-list map-checks" });
    for (const name of checks) {
      const r = data.results.get(name) ?? "unknown";
      rows.append(el("button", { type: "button", className: `loc-row plate ${r}`, title: "Open in the Locations tab", onclick: () => showCheck(name) },
        el("span", { className: "loc-dot" }), el("span", { className: "loc-name", textContent: name })));
    }
    if (!checks.length) rows.append(el("p", { className: "empty", textContent: "No checks in this region." }));
    card.append(rows);
    return card;
  }

  return { render };
}
