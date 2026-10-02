# Changelog

## 1.1.0 — 2026-10-02

### New
- **Map tab**: every logic region by province, where Link is (the map follows him), the regions
  next to each region (click to go there), its checks (click to open them in Locations), a
  reachable mark per region with **All on / All off**, and a ★ mark and a note per region.
- **Sort** the check list by reachable first.
- **Mark checked** by hand (✓): for checks you will not take; they count as done.

### Changed
- Region reachable marks, checked marks and notes are kept with the game save, so every save and
  seed has its own (they used to be shared by all saves).
- Found items show as they look when only seen: "Small Key" for any small or field key, maps,
  compasses and big keys without their dungeon, and a foolish item as the item it is disguised as.
  Collecting it shows the real item.
- An item is seen only when Link can see it, not under a boulder or behind a wall.
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
