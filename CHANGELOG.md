# Changelog

## 1.2.2 — unreleased

### New
- Options › Display › **Share highlight between pages**: a check highlighted on one page (on the
  map or in Checks) is highlighted on every page open — another browser, OBS — too.
- Options › Map: **Map backdrop** (off: only the map, to lay it over the game in OBS with
  `?transparent=1`) and **Ground opacity** (a see-through map; checks, entrances and Link stay).

### Fixed
- Hyrule Field: the plate from Kakariko Gorge (Eldin Field) to Faron Field was far from the real
  crossing. A plate between two provinces now sits where the way back is placed.

## 1.2.1 — 2026-10-10

### Fixed
- Checks the mod's map data places (people, shops, events, and checks moved from the game files'
  places) could be missing from the map, or shown where the game files put them: the page asked
  for that data once, and the mod, busy reading the game files on its first start, could fail to
  answer. The page now asks again until it comes.

## 1.2.0 — 2026-10-10

### Upgrading from 1.1.0
- Install over 1.1.0: settings, layout, custom requirements and what each save has found are kept.
- The page opens in **Simple** display: writing a check's own requirement (**Customize** / **Edit**
  in its panel) is under **Advanced** (Options › Display). Requirements ▾ (import, export, preset),
  Seed ▾ and Reachable Regions ▾ are in both.
- On the first start the mod reads the game files for the map (a bar shows the progress).
- 1.1.0's Map tab is now **Locations › Map** (`?view=map` opens it).

### New: Map (Locations › Checks / Map / Checks + Map)
- **The map of where Link is**, drawn from the game's own map data: rooms by floor, Link's position
  and facing, following him between rooms and floors (**Follow Link** switches this off). Dungeons
  on a worn parchment with their small keys, big key (or key shards), map and compass, and floor
  buttons with Link's or the wolf's face beside his floor; the overworld on a dark hand-drawn map
  (original art). With Mirror Mode on, the map is flipped like the game's.
- **Zoom and move**: click to zoom in, right-click to zoom out, drag to move; four animated steps
  shown beside the map. Zooming out of the overworld shows the whole province, then all of Hyrule,
  as on the game's map screen.
- **Field / Dungeons / Other** above the map open any place's map from the game files: Hyrule and
  its provinces (places not visited yet dimmed), every dungeon (a twilight list in story order, with
  emblems cut from the game's dungeon parchments and each dungeon's keys, map and compass), and
  every house, cave and grotto by province and kind, with a search. Grottos built alike that
  share one map are one entry each.
- **Dungeon details as in the game**: doors (white squares) with padlocks on locked ones (heavier
  for the big key door), barred doors and doors shut from one side, key shutters, the boss icon in
  the boss's room; boss and miniboss rooms (stages of their own, as Death Sword's arena) are drawn
  in the dungeon's map. Door states update live. The dungeon map
  screen's icons (monkeys, iron balls, statues, Sols, Ooccoo, Yeto and Yeta, small keys) show too.
- **Every check on the map**, with the check list's markers: chests, items lying around and poes
  where the game files put them (also where the randomizer adds or moves items), read once from
  the game files (a bar shows the progress; the result is kept); people, golden wolves, shops and
  events where the mod's map data puts them (`map_presets.json`, the same for everyone).
  **Checks Filter ▾** chooses which markers show. Resting the pointer on a check shows its name on
  a plate (opening inward near the map's edges; on a dungeon's map without the dungeon's name).
  In Advanced, the picked check's map, room, coordinates and floor show above the map, and the
  map's name and rooms under it.
- **Entrances**: an icon where each entrance of the randomizer's list is, with how many of the
  checks there are reachable of those left; on hover, a plate in the style of the game's place
  names. Click it for that place's map (right-click there to come back). An overworld place's count
  includes the houses, caves and grottos entered from it. Plates show on both ends, and to the
  other parts of an overworld stage the map shows apart (Hyrule Field by province); entrances the
  randomizer data does not place come with the mod's map data.
- **Grottos sharing a map**: in the grotto, opened from the list or reached from a check in
  Checks, only its own checks and name show (in the grotto, the mod reads the story layer the game
  loaded it with).
- Places the mod names or joins: Lake Hylia and Lanayru Spring apart; Link's House with its
  basement as B1; Hyrule Field's parts (Faron / Eldin / Lanayru Field, around Castle Town); the
  Sacred Grove's rooms. Past Sacred Grove and the Lost Woods (drawn from their collision, water
  in Lake Hylia's blue) have maps the game's map screen does not.

### New: Checks
- **Link Checks and Map** (Options, on by default): the region picked in Checks opens the map most
  of its checks are on, and the map's place sets Checks' region (by the checks on it); a check highlighted or opened on one side is on the other
  (the map goes to it), and closing it on one side closes it on both.
- **Clicks on a check** (Options), the same in Checks and on the map: click for its requirement and
  right-click to highlight it, or the other way round. A double-click jumps between Checks and the
  map without opening the requirement.
- Checks the randomizer lists under a far-off region (people, shops, grottos) are listed under the
  area they are in, with that area's province, region filter and By area group.
- **By area** groups a province's checks by the place they are in; a **region filter** beside the
  province's title shows one region (in the game's order).
- Resting the pointer on a check shows its requirement beside it.

### New: Options and look
- **Options** (was Theme) opens as a window over the page (its button or a click outside closes
  it), each part in a frame: Display, Theme, Background, Item Background.
- **Simple / Advanced**: Simple (the default) shows the main things only; writing a check's own
  requirement (Customize / Edit) and the map's details are under Advanced.
- **Item Background**: the theme's fill or a color of one's own, its opacity (down to transparent,
  for a background image or OBS), and how bright the obtained items' glow is.
- **Font**: standard, Old English (UnifrakturMaguntia, SIL OFL) or one's own uploaded (a Hylian
  font, ...), for the titles or all text.
- **Dungeons tab** in the same twilight design: a plate a dungeon with its emblem and land, the
  small keys found (used ones too), big key or key shards, map, compass, boss and extras in
  columns. Click a dungeon to open its map.
- The Goron Mines key shard icon can be changed for every stage (1/3, 2/3, 3/3).

### New: debug page (`/debug.html`)
- Checks with no place on the map (how many, which, why).
- A stage's map data as the mod knows it, to copy and send when a map does not show.
- The items lying around being watched for "seen", and the dungeon map backgrounds read.

### Changed
- The randomizer's Snowpeak Mountain region is shown as Snowpeak, as its province and map are;
  region marks saved under the old name still count.

### Fixed
- Crashes on reset, on loading a save and on some stage changes (game memory read while a stage
  loads): the map and the seen-item check read it only while the game is plainly playing.
- Items behind an invisible wall (Faron Field's Female Beetle) were not noted:
  `seen_without_sight.txt` lists items that need no clear line. Items are noted as seen from
  farther away (3000, was 1500); other items still need a clear line from both Link's eyes and the
  camera (a rupee under a boulder is not seen before the boulder breaks).
- Golden bugs and other items the randomizer changes into another kind were not noted when only
  seen.
- The mod did not build for Windows, macOS, iOS and Android (Mirror Mode read from a setting mods
  cannot link to).
- Images over 1 MiB could not be sent to the page (the server now sends up to 8 MiB).

## 1.1.0 — 2026-10-02

### New
- **Reachable Regions ▾**: the logic regions by province, each marked reachable or not, with
  **All on / All off** per province.
- **Sort** the check list by reachable first.
- **Check off by hand**: click the marker left of a check you will not take; it shows a sold-out
  sign and counts as done.
- **Use Randomizer Logic for All** removes every custom requirement.

### Changed
- The Locations toolbar is three rows: counts and Reachable Regions; Logic, **Requirements ▾**
  (was Rules: Export / Import / Load Preset Custom Requirements) and **Seed ▾** (the seed and
  Reload Data); Sort, Hide obtained and Show found items.
- Region reachable marks and checked marks are kept with the game save, so every save and
  seed has its own (they used to be shared by all saves).
- Found items lying around show as they look: "Small Key" for any small or field key, maps,
  compasses and big keys without their dungeon (shops, hints and Charlo name the item). A foolish
  item shows as the item it is disguised as until collected, wherever it was found.
- Turning Logic off sets Sort back to game order.
- An item is seen only when it is in sight from both Link and the camera, not under a boulder or
  behind a wall (even with Link pressed into the boulder).
- Charlo's reward shows when you enter Castle Town West (he names it); the Castle Town arrow Goron
  shows with the Goron shop, where he is reached.
- The Locations toolbar, region list and check list title stay in view while the list scrolls.
- Drop-down lists use the page colors.

## 1.0.0 — 2026-09-30

First release.

### Item tracker
- Tracks items, ammo, lantern oil, wallet, bomb bags, bottles, field keys, sky characters, hidden
  skills, poe souls, Fused Shadows, Mirror Shards and golden bugs automatically from the game.
- Golden bug panel with every bug as on the game's insect screen, and Agitha's mark on the bugs
  given to her.
- Drag and drop layout editor, icon editor (game textures or your own images).
- Themes (Twilight, Midna, Hyrule, Shadow) and a custom background image.
- Twilight Princess style interface: metal buttons, gold frames, name plates, map-style markers.
- Works in a browser and as an OBS Browser Source (narrow docks included).

### Dungeons
- Small keys, big key, map, compass, boss and dungeon extras for every dungeon.

### Locations
- Every randomized check, grouped by region, with obtained state read from the save.
- Reachability from the randomizer's own logic and settings, with Logic ON/OFF.
- Custom requirements per check (and / or groups, item counts, time of day, randomizer settings,
  portals, bosses, map regions), edited in their own window, with drag and drop and copy / paste.
- Preset custom requirements for 575 checks, applied on a new install and available any time from
  **Rules ▾ > Load preset**.
- Found items from the spoiler log: obtained, read in a hint, seen nearby or in a shop you entered
  (off by default), stored with the game's save.
