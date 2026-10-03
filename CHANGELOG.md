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
  zoom stays and the map slides to keep Link near the middle, only as he moves).
- Map: zoom out of an overworld map to see its whole province, and once more for all of Hyrule,
  as on the game's map screen (the places you have been, read from the game's field map data);
  click to zoom back in.
- **Checks on the map**: chests, items lying around and poes are placed where they are in the
  stage (read from the game's room files, also from rooms as they load), with the marker of the check list (reachable, not
  reachable, checked, ...). Boxes above the map choose which statuses are shown. Click a check
  for its requirement under the map; right-click to show it in Checks. With Checks + Map, a
  click shows it in the check list next to the map.
- When the overworld map cannot be shown yet, zooming out says why (still being read, or what
  went wrong).
- Dungeon maps show the doors as the game does (white squares), a silver padlock on locked doors
  (a heavier one on the big key door, grayed out once opened), a "no entry" sign on barred doors,
  and the boss icon from the Dungeons tab in the boss's room. Doors update a few times a second,
  including bars that drop behind Link until a room is cleared; hover a door for what the mod
  knows about it. Pits and rooms not yet opened are
  black, as in the game.

### Fixed
- Crashes on reset, on loading a save and on some stage changes: the map data and the seen-item
  check read game memory that is not valid while a stage loads or the game resets. They now read
  it only while the game is plainly playing, and the map is served from a copy made then.
- Floor buttons on the map could ignore clicks (the map was redrawn several times a second); the
  map is now redrawn only when it changes.

### Changed
- Map: when the pane is narrow, floors and the dungeon's items sit below the map, which uses the
  full width; when wide, the floors are left of the map and the items in a row under it.
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
