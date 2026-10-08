# Changelog

## 1.2.0 — 2026-10-08

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
  every house, cave and grotto by province and kind, with a search. Entries can be renamed, moved
  to another province or hidden (✎). Grottos built alike that share one map are one entry each.
- **Dungeon details as in the game**: doors (white squares) with padlocks on locked ones (heavier
  for the big key door), barred doors and doors shut from one side, key shutters, the boss icon in
  the boss's room; boss rooms share the dungeon's map. Door states update live. The dungeon map
  screen's icons (monkeys, iron balls, statues, Sols, Ooccoo, Yeto and Yeta, small keys) show too.
- **Checks on the map**: chests, items lying around, poes, people and golden wolves where the game
  files put them (also where the randomizer adds or moves items), with the check list's markers.
  The mod reads the game files once (a bar shows the progress; the result is kept). **Checks
  Filter ▾** chooses which markers show. Resting the pointer on a check shows its name on a plate (opening inward near the map's
  edges: sideways, and below near the top).
  Under the map: how many of the place's checks are on this map and which are elsewhere, with why.
- **Place checks by hand**: checks the game files do not place (shops, events, some people) — and
  any other check — can be put on the map: pick it, **Place on map** / **Move on map**, click the
  map. The picked check's map, room (selectable), coordinates and floor show above the map; every
  hand-placed check is listed under it (Advanced). Agitha's and Jovani's rewards come placed.
- **Entrances**: an icon where each entrance of the randomizer's list is, with how many of the
  checks there are reachable of those left; on hover, a plate in the style of the game's place
  names. Click it for that place's map (right-click there to come back). An overworld place's count
  includes the houses, caves and grottos entered from it. Plates show on both ends, and to the
  other parts of an overworld stage the map shows apart (Hyrule Field by province). Right-click a
  plate to move or remove it; **+ Entrance** adds one (Advanced).
- **Grottos sharing a map**: in the grotto, opened from the list or reached from a check in
  Checks, only its own checks and name show (in the grotto, the mod reads the story layer the game
  loaded it with).
- Places the mod names or joins: Lake Hylia and Lanayru Spring apart; Link's House with its
  basement as B1; Hyrule Field's parts (Faron / Eldin / Lanayru Field, around Castle Town); the
  Sacred Grove's rooms. Past Sacred Grove and the Lost Woods (drawn from their collision, water
  in Lake Hylia's blue) have maps the game's map screen does not.

### New: Checks
- **Link Checks and Map** (Options, on by default): the region picked in Checks opens its map and
  the map's place sets Checks' region; a check highlighted or opened on one side is on the other
  (the map goes to it), and closing it on one side closes it on both.
- **Clicks on a check** (Options), the same in Checks and on the map: click for its requirement and
  right-click to highlight it, or the other way round. A double-click jumps between Checks and the
  map without opening the requirement.
- **Area** of a check (in its panel): the area it is listed under, by hand. The check then moves to
  that area's province, region filter and By area group.
- **By area** groups a province's checks by the place they are in; a **region filter** beside the
  province's title shows one region (in the game's order).
- Resting the pointer on a check shows its requirement beside it.

### New: Options and look
- **Options** (was Theme) opens as a window over the page (its button or a click outside closes
  it), each part in a frame: Display, Theme, Background, Item Background.
- **Simple / Advanced**: Simple (the default) shows the main things only (the region filter and
  By area included); custom requirements,
  Reachable Regions, seeds, placing checks and entrances, renaming places and the map's details
  are under Advanced.
- **Item Background**: the theme's fill or a color of one's own, its opacity (down to transparent,
  for a background image or OBS), and how bright the obtained items' glow is.
- **Font**: standard, Old English (UnifrakturMaguntia, SIL OFL) or one's own uploaded (a Hylian
  font, ...), for the titles or all text.
- **Export customizations** (Options, Advanced): everything set by hand — checks' places, Areas,
  entrances moved / added / removed, places renamed — as one `map_presets.json`, the file the mod
  ships as its presets. The presets apply to everyone; each person's own changes win over them.
- **Dungeons tab** in the same twilight design: a plate a dungeon with its emblem and land, the
  small keys found (used ones too), big key or key shards, map, compass, boss and extras in
  columns. Click a dungeon to open its map.
- The Goron Mines key shard icon can be changed for every stage (1/3, 2/3, 3/3).

### New: debug page (`/debug.html`)
- Checks with no place on the map (how many, which, why), to find and place the rest.
- A stage's map data as the mod knows it, to copy and send when a map does not show.
- The items lying around being watched for "seen", and the dungeon map backgrounds read.

### Fixed
- A Past Sacred Grove check (F_SP117 room 2) opened the Sacred Grove map (room 1) while Link was
  in the Sacred Grove: a check in another part of the stage than Link's now opens that part's map.
  A place with no room goes to the part its point is in, and a place set by hand takes the room it
  lies in.
- The dungeon map screen's icons (Ooccoo, monkeys, statues, ...) showed on overworld maps too
  (an Ooccoo in the Sacred Grove): they show on dungeon maps only, as in the game.
- Dungeon maps opened from the Dungeons list showed a small key where the boss is, and none of
  the map screen's other icons: the game files' icon types are now turned into the map screen's
  icon groups as the game does (the boss icon from the Dungeons tab shows in the boss's room).
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
