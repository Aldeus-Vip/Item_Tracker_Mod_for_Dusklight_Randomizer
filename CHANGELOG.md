# Changelog

## Unreleased

### New
- **Map** in Locations (sub-tabs Checks / Map / Checks + Map): the map of the stage Link is in,
  drawn from the game's own map data, with Link's position and facing, following him between
  rooms and floors. Overworld maps are teal, dungeon maps green with the room Link is in glowing.
- Dungeon maps on a worn parchment, with the dungeon's small keys, big key (or key shards), map
  and compass in item frames, and floor buttons with Link's or the wolf's face beside his floor;
  the overworld on a dark hand-drawn map (original art). The icons can be changed by right click.

- Map: click to zoom in, right-click to zoom out, drag to move around a zoomed map; a turning
  map cursor like the game's. Zooming is animated, in four steps shown by a glowing indicator
  beside the map whose arrows zoom too. The zoom is kept between stages, and the map follows the
  room Link is in (in a dungeon, zooming out when the room does not fit; on the overworld, the
  zoom stays and the map slides to keep Link near the middle, only as he moves). When Link
  moves while another floor, the province or Hyrule is shown, the map goes back to his. **Follow
  Link** beside the map's title switches all of this off.
- Map: zoom out of an overworld map to see its whole province, and once more for all of Hyrule,
  as on the game's map screen (the places you have been, read from the game's field map data);
  click to zoom back in.
- **Checks on the map**: chests, items lying around (heart pieces, small keys too) and poes are
  placed where they are, with the marker of the check list (reachable, not reachable, checked,
  ...), also where the randomizer adds or moves items. The mod finds them in the game files once
  (a bar shows the progress; the result is kept in its data folder). **Checks Filter ▾** above
  the map chooses which statuses are shown.
  - Click a check to pick it: its row of the check list shows above the map (with its buttons).
    Click the row for its requirement over the map; right-click the row (or the check) to unpick.
    Right-click another check to highlight it. Double-click: the check in the check list.
  - In Checks, double-click a check to see it on the map (its map, centered, picked).
  - **By area** (beside the check list's title) groups the checks by the area they are in.
  - Under the map: how many of the place's checks are on this map, on another floor, in another
    part of the place or not found (hover for which).
- The map, its checks and icons stay inside the map's drawing area (no longer over the frame's
  border when zoomed in or moved).
- The dungeon map screen's icons on the map: monkeys, iron balls, statues, Sols, Ooccoo, Yeto and
  Yeta, small keys lying around (pictures from the game; right-click to change; "Map icons" in
  Checks Filter).
- **Seen item distance** in the mod's settings: how close Link must be to an item lying around
  for the tracker to note what it looks like (3000 by default; it was 1500).
- **Field / Dungeons / Other** tabs above the map: Hyrule and its provinces; every dungeon's map
  (buttons in the dungeons' colors); and every other place with a map (houses, caves, grottos...)
  by province, with a search. Their maps come from the game files; zoom out to go back (also from
  the dungeon or place Link is in, to its list).
- Province and Hyrule views look like the game's map screen: dark, with the place (or province)
  under the cursor lit and named in the title. They are framed on the whole province (or
  Hyrule), also where Link has not been. Clicking another place of a province opens its map (zoom
  in and out on it; zooming out goes back to the province).
- The map says how many of a place's checks were found in its rooms, and names the others on
  hover.
- When the overworld map cannot be shown yet, zooming out says why (still being read, or what
  went wrong).
- Dungeon maps show the doors as the game does (white squares), a silver padlock on locked doors
  (a heavier one on the big key door, grayed out once opened), a "no entry" sign on barred doors,
  and the boss icon from the Dungeons tab in the boss's room. Doors update a few times a second,
  including bars that drop behind Link until a room is cleared and the heavy doors that stay shut
  until a mechanism in the room opens them (Snowpeak Ruins). A door shut from one side only shows
  the sign on that side's edge; hover a door for what the mod
  knows about it. Pits and rooms not yet opened are
  black, as in the game.
- **Mirror Mode**: the map is flipped left to right like the game's when Mirror Mode is on.
- Houses, caves and grottos: a stage holding several shows only the room Link is in, and the
  Other list has one entry a place (rooms with the same name together). Under every map: the map
  loaded (stage and rooms).
- **Place checks by hand**: checks the game files do not place (people, shops, golden wolves,
  events) get **Place on map** under their row when picked; the next click on a map puts them
  there (kept in the page's settings; **Move on map** / **Remove place**).
- Doors opened by a switch are told apart from barred ones.
- The Dungeons and Other lists look like the game's menus: a dark twilight panel with drifting
  black squares, gold-ruled headings, and plates that light up with gold corners under the
  cursor. Dungeons are numbered in story order with the land they are in (the per-dungeon colors
  are gone).

### Fixed
- The mod did not build for Windows, macOS, iOS and Android: Mirror Mode was read from a game
  setting mods cannot link to. It is now told from how the game projects to the screen.
- Checks in rooms placed with an offset in their stage (Snowpeak Ruins' West Cannon Room chest,
  Lanayru Spring, ...) were in the wrong place or missing: rooms are moved by their offset and
  turn as the game's map does (the check cache is read again once).
- Golden bugs and other items the randomizer changes into another kind of item were not noted
  when only seen; seeing an item now also counts when its top or the side toward Link is in view.
- Lake Hylia in its province could only be picked on a small part (or took Zora's River's
  water): see the overlap rule above.
- Crashes on reset, on loading a save and on some stage changes: the map data and the seen-item
  check read game memory that is not valid while a stage loads or the game resets. They now read
  it only while the game is plainly playing, and the map is served from a copy made then.
- Floor buttons on the map could ignore clicks (the map was redrawn several times a second); the
  map is now redrawn only when it changes.

### Changed
- Map: when the pane is narrow, floors and the dungeon's items sit below the map, which uses the
  full width; when wide, the floors are left of the map and the items in a column right of it.
  Many floors get smaller buttons, and with Checks + Map the map pane scrolls on its own.
- Dungeon (and other) maps are framed on all their rooms, also those not visited yet, so the scale
  does not change as rooms are found. Rooms are drawn as the game's map draws them: on stages whose
  map shows one room at a time (Lake Hylia, Lanayru Spring...) only Link's room, elsewhere the
  visited ones (Hyrule Field by province).
- In a province, where a small place lies under a larger one, the larger one's water over the
  small place goes with the small place, for lighting and picking (Lake Hylia's water under the
  Great Bridge of Hylia is Lake Hylia; the bridge and its banks stay the bridge).
- Locations sub-tabs look like tabs (streaked plates), not like the other buttons.
- Dungeons tab: the Goron Mines key shard icon can be changed for every stage (1/3, 2/3, 3/3) in
  the icon editor, not only the one shown.

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
