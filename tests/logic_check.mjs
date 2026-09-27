// Loads the randomizer data from a local checkout and runs the tracker logic on a few inventories.
//   node tests/logic_check.mjs <path to dusklight-randomizer/generator/data> [tracker-rules.json]
// Fails (exit 1) if any logic string does not parse, or if having every item leaves ordinary
// locations unreachable (only twilight-only checks and warp portal pseudo-locations may remain).
// With a rules file (an "Export rules" file), also checks that every route entry is an item
// or valid randomizer logic, and that the rules are met with every item.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "../res/web/vendor/js-yaml.mjs";
import { World, Search, routeSatisfied, trackerEntry } from "../res/web/logic.js";

const dataDir = process.argv[2];
const load = (p) => yaml.load(readFileSync(join(dataDir, p), "utf8"));
const worldFiles = ["world/Root.yaml",
  ...readdirSync(join(dataDir, "world/overworld")).map((f) => `world/overworld/${f}`),
  ...readdirSync(join(dataDir, "world/dungeons")).map((f) => `world/dungeons/${f}`)].map(load);
const world = new World({
  worldFiles, macros: load("macros.yaml"), items: load("items.yaml"),
  settingsList: load("settings_list.yaml"), locations: load("locations.yaml"), settings: {},
});
console.log("areas", world.areas.size, "locations", world.locationAccess.size, "parse errors", world.errors.length);
for (const e of world.errors.slice(0, 10)) console.log("  ", e);

const run = (label, items, extra = {}) => {
  const t0 = performance.now();
  const s = new Search(world, { items: new Map(Object.entries(items)), hearts: 3, goldenBugs: 0, ...extra }).run();
  const reach = [...world.locationAccess.keys()].filter((l) => s.canReach(l));
  console.log(`${label}: ${reach.length} reachable, ${s.visited.size} areas, ${(performance.now() - t0).toFixed(1)} ms`);
  return { s, reach: new Set(reach) };
};
export const results = {
  empty: run("no items", {}),
  early: run("sword+slingshot+lantern", { "Progressive Sword": 2, Slingshot: 1, Lantern: 1, "Progressive Fishing Rod": 1 }),
  mid: run("+crystal, boomerang, clawshot, boots, bombs", { "Progressive Sword": 2, Slingshot: 1, Lantern: 1, "Shadow Crystal": 1,
    "Gale Boomerang": 1, "Progressive Clawshot": 1, "Iron Boots": 1, "Bomb Bag": 1, "Progressive Bow": 1, "Zora Armor": 1,
    "Faron Twilight Tear": 16, "Eldin Twilight Tear": 16, "Lanayru Twilight Tear": 16 }),
};
for (const l of ["Wooden Sword Chest", "Forest Temple Central Chest Behind Stairs", "Lakebed Temple Central Room Chest"]) {
  console.log(l, Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.reach.has(l)])));
}

// Everything: nearly every location must be reachable, otherwise the port is wrong.
const all = Object.fromEntries([...world.itemNames].map((n) => [n, 99]));
const everything = run("all items", all, { hearts: 20, goldenBugs: 24 });
const missing = [...world.locationAccess.keys()].filter((l) => !everything.reach.has(l));
console.log("unreachable with all items:", missing.length, missing.slice(0, 15));
const areasMissing = [...world.areas.keys()].filter((a) => !everything.s.visited.has(a));
console.log("unvisited areas:", areasMissing.length, areasMissing.slice(0, 15));

const unexpected = missing.filter((l) => !/Twilit|Warp Portal/.test(l));
const failures = [];
if (world.errors.length) failures.push(`${world.errors.length} logic parse errors`);
if (unexpected.length) failures.push(`unreachable with all items: ${unexpected.join(", ")}`);
if (!results.empty.reach.has("Wooden Sword Chest")) failures.push("Wooden Sword Chest must be reachable from the start");
const rulesFile = process.argv[3];
if (rulesFile) {
  const { overrides } = JSON.parse(readFileSync(rulesFile, "utf8"));
  const bad = new Set();
  for (const routes of Object.values(overrides)) {
    for (const { item } of routes.flat()) {
      if (world.itemNames.has(item) || trackerEntry(item)) continue;
      try {
        world.parse(item);
      } catch {
        bad.add(item);
      }
    }
  }
  const unmet = Object.entries(overrides).filter(([, routes]) => !routes.some((r) => routeSatisfied(everything.s, r, { all: true })));
  console.log(`rules: ${Object.keys(overrides).length} checks, ${bad.size} invalid entries, ${unmet.length} unmet with all items`);
  for (const [loc] of unmet.slice(0, 15)) console.log("  unmet:", loc);
  if (bad.size) failures.push(`invalid rule entries: ${[...bad].join(", ")}`);
  if (unmet.length) failures.push(`${unmet.length} rules unmet with all items`);
}
console.log(failures.length ? `FAILED: ${failures.join("; ")}` : "PASSED");
process.exitCode = failures.length ? 1 : 0;
