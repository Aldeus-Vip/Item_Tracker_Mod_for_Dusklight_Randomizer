// Location logic for the tracker: a JavaScript port of the Dusklight Randomizer's logic search
// (TwilitRealm/dusklight-randomizer, generator/logic: requirement.cpp, search.cpp, world.cpp).
//
// The randomizer's data files (world graph, macros, items, settings list) are downloaded by the mod
// and passed in here as parsed YAML. Given the player's current items, `search()` returns which
// locations are reachable, following the same rules as the randomizer's accessible-location search:
// areas are explored through exits, and each area tracks which Link form / time of day
// combinations ("form times") can reach it.

// ---- Form / time flags (requirement.hpp FormTime) ----

export const FT = {
  NONE: 0,
  HUMAN_DAY: 0b0001,
  HUMAN_NIGHT: 0b0010,
  WOLF_DAY: 0b0100,
  WOLF_NIGHT: 0b1000,
  HUMAN: 0b0011,
  WOLF: 0b1100,
  DAY: 0b0101,
  NIGHT: 0b1010,
  ALL: 0b1111,
  TWILIGHT: 0b10000,
};
const ALL_FORM_TIMES = [FT.HUMAN_DAY, FT.HUMAN_NIGHT, FT.WOLF_DAY, FT.WOLF_NIGHT];
const ALL_FORM_TIMES_AND_TWILIGHT = [...ALL_FORM_TIMES, FT.TWILIGHT];

const DUNGEON_COMPLETION_EVENTS = [
  "Can Complete Forest Temple",
  "Can Complete Goron Mines",
  "Can Complete Lakebed Temple",
  "Can Complete Arbiters Grounds",
  "Can Complete Snowpeak Ruins",
  "Can Complete Temple of Time",
  "Can Complete City in the Sky",
  "Can Complete Palace of Twilight",
];

const NOTHING = { t: "nothing" };
const IMPOSSIBLE = { t: "impossible" };

// ---- Settings ----

// settings_list.yaml -> { name: [option, ...] } with "a-b" ranges expanded.
function parseSettingsList(list) {
  const options = new Map();
  const defaults = new Map();
  for (const entry of list ?? []) {
    if (!entry?.Name) continue;
    const opts = [];
    for (const opt of entry.Options ?? []) {
      const key = typeof opt === "string" ? opt : Object.keys(opt)[0];
      const range = /^(\d+)-(\d+)$/.exec(String(key));
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) opts.push(String(i));
      } else {
        opts.push(String(key));
      }
    }
    options.set(entry.Name, opts);
    if (entry["Default Option"] !== undefined) defaults.set(entry.Name, String(entry["Default Option"]));
  }
  return { options, defaults };
}

// ---- The world ----

export class World {
  /**
   * @param data.worldFiles   parsed world/*.yaml files (arrays of areas)
   * @param data.macros       parsed macros.yaml
   * @param data.items        parsed items.yaml
   * @param data.settingsList parsed settings_list.yaml
   * @param data.settings     parsed randomizer settings.yaml (the user's options), may be empty
   */
  constructor(data) {
    const { options, defaults } = parseSettingsList(data.settingsList);
    this.settingOptions = options;
    this.settings = new Map(defaults);
    for (const [k, v] of Object.entries(data.settings ?? {})) {
      if (options.has(k)) this.settings.set(k, String(v));
    }
    this.errors = [];
    this.itemNames = new Set((data.items ?? []).map((i) => i?.Name).filter(Boolean));
    // Macros are parsed in file order and may only refer to macros defined above them, so a macro
    // named like an item (e.g. "Lantern: Lantern and ...") refers to the item (world.cpp LoadMacros).
    this.macros = new Map(); // name -> parsed requirement
    this.areas = new Map();
    this.locationAccess = new Map(); // location name -> [{ area, req, source }]
    this.eventNames = new Set();
    this.originalItems = new Map((data.locations ?? []).map((l) => [l.Name, l["Original Item"] ?? ""]));
    for (const [name, reqStr] of Object.entries(data.macros ?? {})) {
      this.macros.set(name, this.safeParse(String(reqStr), `macro ${name}`));
    }
    for (const file of data.worldFiles ?? []) {
      for (const node of file ?? []) this.addArea(node);
    }
  }

  setting(name) {
    return this.settings.get(name);
  }

  settingIndex(name, option) {
    return (this.settingOptions.get(name) ?? []).indexOf(option);
  }

  macro(name) {
    return this.macros.get(name) ?? IMPOSSIBLE;
  }

  addArea(node) {
    if (!node?.Name) return;
    const name = node.Name;
    const area = {
      name,
      region: regionTitle(node.Region ?? ""),
      canChangeTime: node["Can Change Time"] === true,
      canTransform: true,
      twilightMacro: null,
      events: [],
      locations: [],
      exits: [],
    };
    const transform = node["Can Transform"] ?? "Always";
    area.canTransform =
      transform === "Always" || (transform === "If Transform Anywhere" && this.setting("Logic Transform Anywhere") === "On");
    const twilight = node.Twilight ?? "";
    if (twilight && this.setting(`${twilight} Twilight Cleared`) === "Off") {
      area.twilightMacro = `Can Complete ${twilight} Twilight`;
    }

    const events = new Map(Object.entries(node.Events ?? {}).map(([k, v]) => [k, String(v)]));
    events.set(`Can Access ${name}`, "Nothing");
    if (node["Can Warp"] === true) events.set("Can Warp", "Nothing");
    if (node["Map Sector"]) events.set(`${node["Map Sector"]} Map Sector`, "Nothing");
    for (const [eventName, reqStr] of events) {
      this.eventNames.add(eventName);
      area.events.push({ name: eventName, req: this.safeParse(reqStr, `event ${eventName}`) });
    }

    for (const [locName, rawReq] of Object.entries(node.Locations ?? {})) {
      let reqStr = String(rawReq);
      // Locations in twilight need normal (non-twilight) access, except the Twilit Insects.
      if (twilight && !(this.originalItems.get(locName) ?? "").endsWith("Twilight Tear")) {
        reqStr = `Not_Twilight and (${reqStr})`;
      }
      const access = { area: name, req: this.safeParse(reqStr, `location ${locName}`), source: String(rawReq) };
      area.locations.push({ name: locName, ...access });
      if (!this.locationAccess.has(locName)) this.locationAccess.set(locName, []);
      this.locationAccess.get(locName).push(access);
    }

    for (const [to, reqStr] of Object.entries(node.Exits ?? {})) {
      area.exits.push({ from: name, to, req: this.safeParse(String(reqStr), `exit ${name} -> ${to}`) });
    }
    this.areas.set(name, area);
  }

  safeParse(str, what) {
    try {
      return this.parse(str);
    } catch (err) {
      this.errors.push(`${what}: ${err.message}`);
      return IMPOSSIBLE;
    }
  }

  // ---- Requirement parser (requirement.cpp ParseRequirementString) ----

  parse(reqStr) {
    if (reqStr === undefined) throw new Error("missing requirement");
    let s = String(reqStr).trim();
    // Replace spaces at the top nesting level with a delimiter, then split on it. Parts around a
    // comparison operator are glued back together ("A == B" -> "A==B").
    let level = 1;
    let marked = "";
    for (const ch of s) {
      if (ch === "(") level++;
      else if (ch === ")") level--;
      marked += level === 1 && ch === " " ? "+" : ch;
    }
    if (level !== 1) throw new Error(`unbalanced parentheses in "${reqStr}"`);
    const parts = [];
    let rest = marked;
    let pos;
    while ((pos = rest.indexOf("+")) !== -1) {
      const before = rest[pos - 1];
      const after = rest[pos + 1];
      if ("!=><".includes(before) || "!=><".includes(after)) {
        rest = rest.slice(0, pos) + rest.slice(pos + 1);
      } else {
        parts.push(rest.slice(0, pos));
        rest = rest.slice(pos + 1);
      }
    }
    parts.push(rest);
    const tokens = parts.filter((p) => p !== "");

    if (tokens.length === 1) return this.parseAtom(tokens[0], reqStr);
    if (tokens.length === 2) throw new Error(`unrecognized 2 part expression "${reqStr}"`);

    const hasAnd = tokens.includes("and");
    const hasOr = tokens.includes("or");
    if (hasAnd && hasOr) throw new Error(`"and" and "or" at the same level in "${reqStr}"`);
    if (!hasAnd && !hasOr) throw new Error(`no operator in "${reqStr}"`);
    const args = tokens
      .filter((t) => t !== "and" && t !== "or")
      .map((t) => this.parse(t.startsWith("(") && t.endsWith(")") ? t.slice(1, -1) : t));
    return { t: hasAnd ? "and" : "or", args };
  }

  parseAtom(token, original) {
    // A whole expression wrapped in parentheses
    if (token.startsWith("(") && token.endsWith(")")) return this.parse(token.slice(1, -1));
    const arg = token.replaceAll("_", " ");
    if (arg === "Nothing") return NOTHING;
    if (arg === "Human Link") return { t: "human" };
    if (arg === "Wolf Link") return { t: "wolf" };
    if (arg === "Twilight") return { t: "twilight" };
    if (arg.startsWith("'")) {
      const name = arg.slice(1, -1);
      this.eventNames.add(name);
      return { t: "event", name };
    }
    // Macros are checked before items: some macros share an item's name.
    if (this.macros.has(arg)) return { t: "macro", name: arg };
    if (this.itemNames.has(arg)) return { t: "item", name: arg };
    const cmp = /^(.*?)(==|!=|>=|<=)(.*)$/.exec(arg);
    if (cmp) return this.compareSetting(cmp[1].trim(), cmp[2], cmp[3].trim()) ? NOTHING : IMPOSSIBLE;
    const fn = /^([a-z ]+)\((.*)\)$/.exec(arg);
    if (fn) {
      const [, func, argsStr] = fn;
      const args = argsStr.split(", ");
      const number = (v) => {
        const fromSetting = this.settings.get(v);
        return Number(fromSetting !== undefined ? fromSetting : v);
      };
      if (func === "count") return { t: "count", name: args[0], n: number(args[1]) };
      if (func === "hearts") return { t: "hearts", n: number(args[0]) };
      if (func === "golden bugs") return { t: "bugs", n: number(args[0]) };
      if (func === "dungeons completed") return { t: "dungeons", n: number(args[0]) };
    }
    if (arg === "Day") return { t: "day" };
    if (arg === "Night") return { t: "night" };
    if (arg === "Impossible") return IMPOSSIBLE;
    throw new Error(`unrecognized logic symbol "${token}" in "${original}"`);
  }

  compareSetting(name, op, option) {
    const value = this.settings.get(name);
    if (value === undefined) throw new Error(`unknown setting "${name}"`);
    if (op === "==") return value === option;
    if (op === "!=") return value !== option;
    const a = this.settingIndex(name, value);
    const b = this.settingIndex(name, option);
    if (b === -1) throw new Error(`"${option}" is not an option of "${name}"`);
    return op === ">=" ? a >= b : a <= b;
  }
}

// ---- Search (search.cpp, tracker / accessible-locations mode) ----

export class Search {
  /**
   * @param world  World
   * @param items  Map<item name, count> of what the player owns
   * @param hearts current max hearts
   * @param goldenBugs number of golden bugs owned
   */
  constructor(world, { items, hearts = 3, goldenBugs = 0 }) {
    this.world = world;
    this.items = items;
    this.hearts = hearts;
    this.goldenBugs = goldenBugs;
    this.events = new Set();
    this.formTime = new Map(); // area name -> form time flags
    this.visited = new Set();
    this.eventsToTry = [];
    this.exitsToTry = [];
    this.successfulExits = new Set();
  }

  has(name, n = 1) {
    return (this.items.get(name) ?? 0) >= n;
  }

  eval(req, ft) {
    switch (req.t) {
      case "nothing": return true;
      case "impossible": return false;
      case "or": return req.args.some((r) => this.eval(r, ft));
      case "and": return req.args.every((r) => this.eval(r, ft));
      case "item": return this.has(req.name);
      case "count": return this.has(req.name, req.n);
      case "event": return this.events.has(req.name);
      case "macro": return this.eval(this.world.macro(req.name), ft);
      case "day": return (ft & FT.DAY) !== 0;
      case "night": return (ft & FT.NIGHT) !== 0;
      case "human": return (ft & FT.HUMAN) !== 0;
      case "wolf": return (ft & FT.WOLF) !== 0;
      case "twilight": return (ft & FT.TWILIGHT) !== 0;
      case "bugs": return this.goldenBugs >= req.n;
      case "hearts": return this.hearts >= req.n;
      case "dungeons": return DUNGEON_COMPLETION_EVENTS.filter((e) => this.events.has(e)).length >= req.n;
      default: return false;
    }
  }

  twilightCleared(area) {
    return !area.twilightMacro || this.eval(this.world.macro(area.twilightMacro), FT.ALL);
  }

  expandFormTimes(area) {
    let ft = this.formTime.get(area.name) ?? FT.NONE;
    const cleared = this.twilightCleared(area);
    const crystal = this.has("Shadow Crystal");
    if (area.canChangeTime && area.canTransform && crystal && cleared) {
      ft |= FT.ALL;
    } else if (area.canChangeTime && cleared) {
      if (ft & FT.WOLF) ft |= FT.WOLF;
      else if (ft & FT.HUMAN) ft |= FT.HUMAN;
    } else if (area.canTransform && crystal && cleared) {
      if (ft & FT.NIGHT) ft |= FT.NIGHT;
      if (ft & FT.DAY) ft |= FT.DAY;
    }
    this.formTime.set(area.name, ft);
  }

  // Returns "none" | "partial" | "complete"
  evalExit(exit) {
    const to = this.world.areas.get(exit.to);
    if (!to) return "none";
    let parentFt = this.formTime.get(exit.from) ?? FT.NONE;
    let connectedFt = this.formTime.get(exit.to) ?? FT.NONE;
    let potential = FT.ALL;
    const cleared = this.twilightCleared(to);
    if (!cleared) {
      parentFt |= FT.TWILIGHT;
      potential |= FT.TWILIGHT;
    }
    const spread = ~connectedFt & (parentFt & potential);
    if (spread === FT.NONE) return "none";

    let result = "none";
    for (const ft of cleared ? ALL_FORM_TIMES : ALL_FORM_TIMES_AND_TWILIGHT) {
      if (!(ft & spread) || !this.eval(exit.req, ft)) continue;
      if (!cleared) {
        if (~connectedFt & FT.TWILIGHT) {
          connectedFt |= FT.TWILIGHT;
          result = "partial";
        }
      } else if (ft !== FT.TWILIGHT) {
        connectedFt |= ft;
        result = "partial";
      }
    }
    this.formTime.set(exit.to, connectedFt);
    if (result !== "none") this.expandFormTimes(to);
    if (cleared && ((this.formTime.get(exit.to) & potential) === potential)) result = "complete";
    return result;
  }

  explore(area) {
    this.eventsToTry.push(...area.events.map((e) => ({ ...e, area })));
    for (const exit of area.exits) {
      const result = this.evalExit(exit);
      if (result === "complete") this.successfulExits.add(exit);
      this.exitsToTry.push(exit);
      if (result !== "none" && !this.visited.has(exit.to)) {
        this.visited.add(exit.to);
        this.explore(this.world.areas.get(exit.to));
      }
    }
  }

  run() {
    const root = this.world.areas.get("Root");
    if (!root) return this;
    this.visited.add("Root");
    this.formTime.set("Root", FT.ALL);
    this.eventsToTry.push(...root.events.map((e) => ({ ...e, area: root })));
    this.exitsToTry.push(...root.exits);

    let changed = true;
    while (changed) {
      changed = false;
      for (const ev of this.eventsToTry) {
        if (this.events.has(ev.name)) continue;
        if (this.eval(ev.req, this.formTime.get(ev.area.name) ?? FT.NONE)) {
          this.events.add(ev.name);
          changed = true;
        }
      }
      // exitsToTry grows while exploring; iterate by index so new exits are included.
      for (let i = 0; i < this.exitsToTry.length; i++) {
        const exit = this.exitsToTry[i];
        if (this.successfulExits.has(exit)) continue;
        const result = this.evalExit(exit);
        if (result === "none") continue;
        if (result === "complete") this.successfulExits.add(exit);
        changed = true;
        if (!this.visited.has(exit.to)) {
          this.visited.add(exit.to);
          this.explore(this.world.areas.get(exit.to));
        }
      }
    }
    return this;
  }

  // Whether the named location can be reached with the items the search was given.
  canReach(locationName) {
    for (const access of this.world.locationAccess.get(locationName) ?? []) {
      if (!this.visited.has(access.area)) continue;
      if (this.eval(access.req, this.formTime.get(access.area) ?? FT.NONE)) return true;
    }
    return false;
  }
}

// ---- Items from the tracker state ----

const DUNGEON_ITEM_NAMES = {
  "Snowpeak Ruins": { bigKey: "Snowpeak Ruins Bedroom Key" },
};

// Builds the logic item multiset from the mod's state (mirrors the randomizer's getSaveItemPool).
export function itemsFromState(state) {
  const items = new Map();
  for (const [name, count] of Object.entries(state.items ?? {})) {
    if (typeof count === "number" && count > 0) items.set(name, count);
  }
  for (const d of state.dungeons ?? []) {
    if (d.smallKeys > 0) items.set(`${d.name} Small Key`, d.smallKeys);
    if (d.bigKey) items.set(DUNGEON_ITEM_NAMES[d.name]?.bigKey ?? `${d.name} Big Key`, 1);
    if (d.map) items.set(`${d.name} Dungeon Map`, 1);
    if (d.compass) items.set(`${d.name} Compass`, 1);
  }
  return {
    items,
    hearts: Math.floor((state.maxLife ?? 15) / 5),
    goldenBugs: state.items?.["Golden Bug"] ?? 0,
  };
}

// ---- Custom routes ----

// An entry of a custom route is an item name with a count, or randomizer logic: an event
// ('Can_Complete_Forest_Temple'), a macro (Can_Complete_Prologue) or a setting comparison
// (Faron_Woods_Logic == Open). Logic entries use the results of a finished search.
// Route entries that are not items or logic: "time:Day" / "time:Night" (the in-game clock),
// "flag:<name>" (a randomizer on/off setting or game state such as a cleared twilight, or
// "flag:<setting> = <option>"), "map:<region>" (a region marked reachable, by hand or by entering
// it), "boss:<dungeon>" (its boss defeated) and "cond:<name>" (a seed condition such as the Hyrule
// barrier being dispelled). The tracker page decides them through ctx.test.
export function trackerEntry(item) {
  const m = /^(time|flag|map|boss|cond):(.+)$/.exec(item);
  return m ? { kind: m[1], name: m[1] === "map" ? regionTitle(m[2]) : m[2] } : null;
}

// Regions shown under another name than the randomizer's (the same name as the province and its
// map). Names saved before (map marks, Areas set by hand, rules) are read as the new one.
export const REGION_TITLES = { "Snowpeak Mountain": "Snowpeak" };
export function regionTitle(region) {
  return REGION_TITLES[region] ?? region;
}

// Dungeon -> its boss, in vanilla clear order.
export const BOSS_NAMES = {
  "Forest Temple": "Diababa", "Goron Mines": "Fyrus", "Lakebed Temple": "Morpheel",
  "Arbiters Grounds": "Stallord", "Snowpeak Ruins": "Blizzeta", "Temple of Time": "Armogohma",
  "City in the Sky": "Argorok", "Palace of Twilight": "Zant", "Hyrule Castle": "Ganondorf",
};

// A route entry is { item, n } or a nested group { or: [route, ...] } (any one of its routes).
// ctx: { test(entry) => boolean } for tracker entries, or { all: true } to treat them as met.
export function routeEntrySatisfied(search, entry, ctx = {}) {
  if (Array.isArray(entry.or)) return entry.or.some((r) => routeSatisfied(search, r, ctx));
  const { item, n = 1 } = entry;
  const special = trackerEntry(item);
  if (special) return ctx.all === true || Boolean(ctx.test?.(special));
  const world = search.world;
  if (world.itemNames.has(item)) return search.has(item, n || 1);
  world.routeExprs ??= new Map();
  if (!world.routeExprs.has(item)) {
    let req = IMPOSSIBLE;
    try {
      req = world.parse(item);
    } catch {}
    world.routeExprs.set(item, req);
  }
  return search.eval(world.routeExprs.get(item), FT.ALL);
}

export function routeSatisfied(search, route, ctx = {}) {
  return route.every((entry) => routeEntrySatisfied(search, entry, ctx));
}

// Display name of a route entry: logic entries without quotes and underscores.
export function routeEntryLabel(item) {
  const special = trackerEntry(item);
  if (special) {
    const { kind, name } = special;
    if (kind === "time") return `Time: ${name}`;
    if (kind === "map") return `Map: ${name}`;
    if (kind === "boss") return `${BOSS_NAMES[name] ?? "Boss"} Defeated`;
    return name.replace(" = ", ": ");
  }
  return item.replaceAll("'", "").replaceAll("_", " ");
}

// ---- Display ----

// Parses a logic string into a tree for display, keeping every atom as written:
// { t: "and" | "or", args: [...] } or { t: "atom", text }. Nested groups with the same operator
// are flattened ("A and (B and C)" -> and[A, B, C]).
export function parseDisplay(reqStr) {
  const s = String(reqStr).replace(/\s+/g, " ").trim();
  let level = 0;
  const tokens = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") level++;
    else if (ch === ")") level--;
    if (ch === " " && level === 0) {
      // Keep comparisons together: "A == B"
      const prev = cur.slice(-1);
      const next = s[i + 1];
      if ("!=><".includes(prev) || "!=><".includes(next)) continue;
      if (cur) tokens.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  if (tokens.includes("and") && tokens.includes("or")) {
    // Mixed operators: "and" binds tighter ("A and B or C" = (A and B) or C).
    const groups = [[]];
    for (const tok of tokens) {
      if (tok === "or") groups.push([]);
      else groups.at(-1).push(tok);
    }
    return { t: "or", args: groups.map((g) => parseDisplay(g.join(" "))) };
  }
  const op = tokens.includes("and") ? "and" : tokens.includes("or") ? "or" : null;
  if (!op) {
    const only = tokens.length === 1 ? tokens[0] : s;
    if (only.startsWith("(") && only.endsWith(")") && balanced(only.slice(1, -1))) return parseDisplay(only.slice(1, -1));
    return { t: "atom", text: only };
  }
  const args = [];
  for (const tok of tokens.filter((x) => x !== op)) {
    const child = parseDisplay(tok);
    if (child.t === op) args.push(...child.args);
    else args.push(child);
  }
  return { t: op, args };
}

function balanced(str) {
  let level = 0;
  for (const ch of str) {
    if (ch === "(") level++;
    else if (ch === ")" && --level < 0) return false;
  }
  return level === 0;
}

// Display name of a logic atom: "count(Progressive_Sword, 2)" -> "Progressive Sword ×2".
export function atomLabel(text) {
  const count = /^count\((.*), *(\w+)\)$/.exec(text);
  if (count) return `${routeEntryLabel(count[1])} ×${count[2].replaceAll("_", " ")}`;
  const fn = /^([a-z ]+)\((.*)\)$/.exec(text);
  if (fn) return `${fn[1][0].toUpperCase()}${fn[1].slice(1)} ${routeEntryLabel(fn[2])}`;
  const cmp = /^(.*?) *(==|!=|>=|<=) *(.*)$/.exec(text);
  if (cmp) return `${routeEntryLabel(cmp[1])} ${{ "==": "=", "!=": "≠", ">=": "≥", "<=": "≤" }[cmp[2]]} ${routeEntryLabel(cmp[3])}`;
  return routeEntryLabel(text);
}
