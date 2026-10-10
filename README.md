# Dusklight Item Tracker

An automatic item and location tracker for the
[Dusklight](https://github.com/TwilitRealm/dusklight) Randomizer.

The tracker is a Dusklight mod. It reads your inventory and progress from the running game and
serves a tracker page at `http://127.0.0.1:38100/`, which you open in a browser or add to OBS as
a Browser Source. You don't need to install any separate application.

日本語: [README.ja.md](README.ja.md)

## Features

- **Items**: a Twilight Princess–style grid that updates as you play. It shows:
  - ammo, oil and rupee counts
  - bomb bag and bottle contents
  - quiver and bomb bag upgrades
  - Sky Book characters, Hidden Skills, Poe Souls, Golden Bugs, Fused Shadows and Mirror Shards
- **Dungeons**: for each dungeon, small keys (including keys already used), the big key or key
  shards, map, compass, boss and dungeon items, on twilight plates with the dungeon's emblem.
- **Locations**: every randomizer check, grouped by province and region and marked as obtained,
  reachable or not yet reachable.
  - Reachability follows the randomizer's own logic and settings.
  - You can give any check your own requirement.
  - Turn the logic off when it doesn't fit your seed (e.g. entrance randomizer); the tab then
    shows only obtained and not obtained.
- **Map**: the map of where Link is, drawn from the game's own map data, with every check,
  entrance and dungeon door on it (see [Map](#map)). Checks and Map can be shown side by side and
  follow each other.
- **Icons from your game**: the mod builds item icons, map icons and dungeon emblems from your own
  game data while the game runs. The mod ships no game images.
- **Fitted names**: long item names in the Items tab shrink to fit their tile.
- **Customizable**: rearrange tiles; pick a theme, a background image, the item background and
  glow, a font (or upload your own); change any icon. **Simple** display shows the main things
  only, **Advanced** every tool (writing a check's own requirement and the map's details). Every open page (browser and OBS) shows the same settings.

## Installing

1. Copy `dusklight_item_tracker.dusk` into the Dusklight mods folder:
   - Windows: `%APPDATA%\TwilitRealm\Dusklight\mods`
   - Linux: `~/.local/share/TwilitRealm/Dusklight/mods`
   - macOS: `~/Library/Application Support/TwilitRealm/Dusklight/mods`
2. Enable **Dusklight Item Tracker** in the in-game mod manager. Its panel shows:
   - the tracker URL, with a port input and a copy button
   - the number of connected pages
   - the status of the randomizer logic data
3. Open the URL in a browser or in an OBS Browser Source.

On first start the mod downloads the randomizer's check list and logic from the public
[dusklight-randomizer](https://github.com/TwilitRealm/dusklight-randomizer) repository and keeps
them locally. The Locations tab needs them; the rest of the tracker works offline.

## Using the tracker

| Where | Action | Effect |
|---|---|---|
| Items / Dungeons | Right-click an icon | Open the icon editor (see below) |
| Items | Click **Golden Bugs** | Show every golden bug (male and female of each kind, as on the game's insect screen), with Agitha's butterfly on the bugs given to her; right-click a bug or the butterfly to change its icon |
| Items | **Edit** | Rearrange tiles: click two slots or drag one onto another to swap them, add or remove rows, then **Confirm** |
| Any tab | **Options** | Display (Simple / Advanced, Link Checks and Map, Clicks on a check, font), Theme (Twilight, Midna, Hyrule, Shadow), Background image, Item Background (color, opacity, glow), Map (backdrop, ground opacity). Click the button again or outside to close |
| Locations | Click a region | Show its checks. In a narrow window the region list and the check list are shown one at a time; use **‹ Back** to return |
| Locations | Click a check | Show its requirement: parts joined by "and" side by side, alternatives stacked, met parts outlined (Options › Clicks on a check can swap click and right-click) |
| Locations | Rest the pointer on a check | Its requirement beside it |
| Locations | **Customize** / **Edit** | Replace the randomizer logic for that check with your own routes (see below) |
| Locations | Click a **Map** entry in a requirement | Mark that region reachable, or unmark it, for every check |
| Locations | Select a check, **Ctrl+C**; select another, **Ctrl+V** | Copy a custom requirement to another check. A popup shows it first; OK has the focus, so **Enter** pastes and **Esc** cancels |
| Locations | Right-click | Highlight a check or region |
| Locations | **Logic ON/OFF** | Turn reachability on or off |
| Locations | **Checks / Map / Checks + Map** | Switch between the check list, the map of where Link is, or both side by side (needs a window at least 900 px wide) |
| Map | Click / right-click / drag | Zoom in, zoom out, move; see [Map](#map) |
| Locations | **Reachable Regions ▾** | The logic regions by province, each marked reachable or not (marked when Link enters it). Switch one, or a whole province with **All on / All off**. Used by Map entries of custom requirements; kept with the game save |
| Locations | **Requirements ▾** | **Export / Import Custom Requirements** as JSON, **Load Preset Custom Requirements**, or **Use Randomizer Logic for All** (removes every custom requirement) |
| Locations | **Seed ▾** | Pick the seed whose spoiler log is used for found items; **Reload Data** reads the seeds and the logic data again |
| Locations | **Show found items** | Off by default. Show what a found check held (see below). Nothing else of the seed is shown |
| Locations | **Sort** | Game order, or reachable checks first |
| Locations | Click the marker left of a check | Mark a check you will not take (a shop item not worth buying, an item you can see but not reach): it shows a sold-out sign and counts as done. Click again to undo; kept with the game save |

### Map

**Locations › Map** (or **Checks + Map**, side by side) shows the map of the stage Link is in, as
the game's map screen draws it.

- **Following Link**: his position and facing, the room he is in glowing; the map follows him
  between rooms and floors. **Follow Link** beside the title switches this off.
- **Zoom**: click (or the arrows beside the map) to zoom in, right-click to zoom out, drag to
  move. Zooming out of the overworld shows the province, then all of Hyrule.
- **Other places**: **Field / Dungeons / Other** above the map open any province, dungeon, house,
  cave or grotto.
- **Dungeons**: doors, locks (open once used), barred doors, the boss's room, the map screen's
  icons, and the dungeon's keys, map and compass beside the map.
- **Checks**: every check on its map — chests, items lying around and poes where the game files
  put them; people, golden wolves, shops and events where the mod's map data places them — with
  the check list's markers (**Checks Filter ▾** chooses which). Rest the pointer on one for its
  name (on a dungeon's map, without the dungeon's name); click / right-click as set in Options;
  double-click to find it in Checks. In Advanced, the picked check's map, room, coordinates and
  floor show above the map, and the map's name and rooms under it.
- **Entrances**: an icon where each entrance is, with *reachable / left* checks of the place it
  leads to (for an overworld place, also its houses, caves and grottos). Hover for its name; click
  for its map (right-click there to come back).
- **Grottos** sharing one map show only the checks of the grotto Link is in.
- **Link Checks and Map** (Options): the region and the check picked on one side are shown on the
  other.
- With Mirror Mode on, the map is flipped like the game's.

The mod reads the game files once to find every check and entrance (a bar shows the progress); the
result is kept in its data folder. What the game files do not give — where people, shops and
events give their checks, the area each check is listed under, entrances the randomizer data does
not place — comes with the mod (`res/web/map_presets.json`) and is the same for everyone.

### Icon editor

Every icon starts with its default (see the table below). When a tile can show several icons (sword levels,
bottle contents, bomb types, quiver marks, …), a dropdown picks which one to edit; tiles that
share an icon (all bottles, all bomb bags) share the change. For each icon you can choose:

- **Default**: the icon described below.
- **From a game texture**: a texture from the game's **Item icons** or **Dungeon map** archive,
  picked in a browser with previews.
- **From image file**: an image you upload. The mod stores it under the icon's name.

Default icons:

| Icon | Default |
|---|---|
| Most items | Built from your game's item icons |
| Shadow Crystal, Fused Shadow, Mirror Shard | Original art made for this mod (the game has no 2D icon for them) |
| Field keys (Faron, Coro, Gate, Bulblin Camp) | The game's key icon on an original abstract background |
| Bosses | The field map's boss mark. You can set an icon for each boss in the editor |

## Credits

The Shadow Crystal, Fused Shadow and Mirror Shard icons, the field key backgrounds, the Day and
Night icons and Agitha's butterfly mark in
`res/web/art/` are original art made by the author for this mod. They contain no game images.

The menu ornaments in `res/web/art/ui/` (gold corners, banner scroll ends, textures) are original
art made for this mod, in the style of Twilight Princess menus.

The page font is [Nunito](https://github.com/googlefonts/nunito) by Vernon Adams et al., under the
SIL Open Font License 1.1 (`res/web/fonts/Nunito-OFL.txt`). The Old English font (Options › Font) is
[UnifrakturMaguntia](https://github.com/google/fonts/tree/main/ofl/unifrakturmaguntia), also under the SIL Open Font License 1.1
(`res/web/fonts/UnifrakturMaguntia-OFL.txt`).

### Custom requirements

The mod comes with preset custom requirements for 575 checks. A new install starts with them;
**Requirements ▾ > Load Preset Custom Requirements** loads them again, either replacing yours or only filling in the checks
you have not customized (export yours first to keep a copy).

**Customize** opens the requirement editor in its own window (in OBS, where windows can't open,
it opens in the panel). The window closes when you press **Save**.

- The top frame shows the requirement as it will look when saved, one row per route. Every part
  of a route is needed; any one route is enough. Click a route to add to it.
- Drag a part to move it (within a route or into another route or option), and drag a route's
  or option's label to reorder them.
- **+ Or group** adds a part met by any one of its options, so a route can say `A and (B or C)`
  or `(A or B) and (C or D)`. Options can hold Or groups of their own. Click an option to add to
  it; the picker's heading shows where new conditions go.
- Below it, pick conditions from six tabs. Each tab is a two-column list of check boxes: a checked
  row is in the selected route, and clicking a row adds or removes it. Items the pool holds more
  than one of have a count box on their row (`1 / 4`), limited to that number. Items follow the Items tab's
  sections and order and show its icons; Map regions are grouped by province. Type in the search
  box to filter; **Enter** adds the best match.

| Tab | Conditions | Met when |
|---|---|---|
| Items | Randomizer items, with a count | You have them |
| Dungeon | Dungeon keys; bosses; entrances (Goron Mines Entrance Opened, the dungeon requirement settings, Door to the Past Opened, Mirror of Twilight Repaired, Hyrule Barrier Dispelled), each in vanilla clear order | You have the keys / the boss is defeated / the setting is on, or the seed's condition for it is met with your items (or the game has already opened it) |
| Portals | Gerudo Desert, Mirror Chamber, Snowpeak, Sacred Grove, Bridge of Eldin and Upper Zoras River portals | The portal is open in the game |
| Time | Day, Night | The game's clock shows that time (night is 19:00–6:00) |
| Rand Settings | On/off settings such as Faron Twilight Cleared or Open Door of Time | The setting is on. The three twilights are also read from your save, so a twilight you cleared counts |
| Map Reachable | Regions of the randomizer logic (Faron Woods, North Eldin, …) | The region is marked reachable. It is marked when you enter it in the game; switch it in **Reachable Regions ▾** or by clicking a Map entry in a check's requirement. Marks are kept with the game save, so each save (and seed) has its own |

### Found items

With **Show found items** on, a check shows what it holds once you have found it:

| Found by | When |
|---|---|
| Collecting it | The check is obtained |
| A hint | You read a "They say that the reward for … is …" hint about it |
| Seeing it | A freestanding item (or a boss's heart container) is near Link and in his sight (not under a boulder or behind a wall) |
| A shop | You entered the shop |
| An NPC | Charlo names his reward when you enter Castle Town West |

An item you only saw lying around is shown as it looks: any small key (and the field keys, which
look the same) shows as "Small Key", maps, compasses and big keys without their dungeon. Shops,
hints and Charlo name the item, so those show it. A foolish item shows as the item it is disguised
as wherever you found it, until you collect it. The Castle
Town Goron selling arrows shows with the Goron shop, where he is reached.

The placements come from the seed's spoiler log in the randomizer's seeds folder, so the seed must
have one. What you found is kept with your game save: it is saved when the game saves, and
loading a save shows what was known at that save (quick saves are not supported). The save also
remembers its seed; a new save uses the newest seed, or the one picked in **Seed ▾**.

### OBS

Add a Browser Source with the tracker URL. These URL options can be combined:

| Option | Effect |
|---|---|
| `?view=items`, `?view=dungeons`, `?view=locations` | Show one tab |
| `?mode=simple`, `?mode=advanced` | Simple or advanced display (else as set in Options) |
| `?header=0` | Hide the tab bar |
| `?transparent=1` | Transparent background (with Options › Map › Map backdrop off, the map can lie over the game) |
| `?size=<px>` | Tile size (default 64) |

## Building

```sh
cmake -B build
cmake --build build
```

The result is `build/mods/dusklight_item_tracker.dusk`, which works on your own platform only. The
first configure downloads the Dusklight sources.

### GitHub Actions

| Trigger | Builds |
|---|---|
| Pull request | Linux x86_64 (plus the host tests) and Windows x64; the Windows `.dusk` is attached to the run |
| Tag (e.g. `v1.0.0`), or a release published on GitHub with a new tag | All 8 platforms, merged into one `.dusk` and attached to that GitHub release |
| Manual (Actions → Build → Run workflow) | `full` (all platforms and the merged `.dusk`) or `quick` (the pull request check) |

### Mod manager images

The mod manager and the mod website show `res/icon.png` (square) and `res/banner.png` (about
3.5:1). To make them with your game's icons:

1. Run the game with a save loaded and open `http://127.0.0.1:38100/promo.html`.
2. Capture the `#icon` and `#banner` elements with your browser's DevTools, using "Capture node
   screenshot".

## Tests

```sh
tests/run.sh
```

builds and runs the host-side tests with in-memory fakes for the Dusklight services:

| Test | Covers |
|---|---|
| `tests/web_server_test.cpp` | The HTTP server |
| `tests/rando_data_test.cpp` | The logic data downloads |
| `tests/gx_texture_test.cpp` | Texture decoding and PNG output |

Run `cmake -B build` once first, and set `FMT_INCLUDE` if fmt was not fetched into
`build/_deps`.

```sh
node tests/logic_check.mjs <dusklight-randomizer>/generator/data [rules.json]
```

checks the JavaScript logic port against the randomizer's data files. If you pass a file saved
with "Export rules", it also checks that file's custom requirements.

## Developing the page without the game

```sh
node tools/mock_server.mjs
```

serves `res/web/` on the same port and streams a scripted playthrough, so you can work on the page
without running Dusklight. Optional environment variables:

| Variable | Use |
|---|---|
| `RANDO_DATA` | A randomizer checkout's `generator/data` folder, for the Locations tab |
| `ICON_DIR` | A folder of PNGs that stands in for the game's icon archive |
| `GAME_ICON_DIR` | A folder of `<item number>.png` that stands in for the game-built icons |

The state and event format is described in [docs/protocol.md](docs/protocol.md).

## License

MIT — see [LICENSE](LICENSE). The Nunito and UnifrakturMaguntia fonts are under the SIL Open Font License 1.1.
Changes are listed in [CHANGELOG.md](CHANGELOG.md).
