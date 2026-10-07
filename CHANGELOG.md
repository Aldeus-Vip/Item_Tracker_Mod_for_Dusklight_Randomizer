# Changelog

## Unreleased

### New
- **Options** (was Theme): every setting in one place, each part in a frame of its own — Display
  (Simple / Advanced, linking Checks and Map, the font), Theme, Background, Item Background.
- **Simple display** (the default): the main things only. Custom requirements, Reachable Regions,
  seeds, By area, the region filter, placing checks by hand, renaming places and the map's details
  are under Advanced.
- **Item Background**: the theme's fill or a color of one's own, its opacity (down to fully
  transparent, for a background image or a transparent OBS source), and how bright the obtained
  items' green glow is.
- **Font**: standard, Old English (UnifrakturMaguntia, SIL OFL) or a font of one's own uploaded (a
  Hylian font, ...), for the titles or all text.
- **Link Checks and Map** (Options › Display, on by default): picking a region in Checks opens its
  map, and the place the map shows sets Checks to its region.
- Resting the pointer on a check shows its requirement beside it (no click needed).
- Options opens as a window over the page: its button opens and closes it, and so does a click
  outside it (or Escape).
- **Clicks on a check** (Options › Display), the same in Checks and on the map: click shows its
  requirement and right-click highlights it (the default), or the other way round. A
  double-click (to the map, or to Checks) only shows and highlights the check, without its
  requirement.
- With Checks and Map linked, a check is highlighted on both sides. Checks: right-click highlights
  it and the map goes to its place (centered, zoomed in), left-click also shows its requirement
  over the map. Map: clicking a check highlights it in Checks (no requirement); clicking the picked
  check above the map shows its requirement on both sides. Closing the requirement or the
  highlight on one side closes it on the other.
- Debug page: **Map data of a stage**, what the mod knows of a stage's map (rooms, shapes, doors by
  floor, what was found of an overworld room's ground, the overworld map's rooms), to copy and send.
- Map entrances: an icon on the entrance's point (the dungeon entrance icon from the game's map
  screen) with its count of checks above; on hover, a plate like the game's place names (a dark
  olive bar edged in gold with a gold scroll) with the place's name and count. A plate moves with
  right-click › Move; **+ Entrance** (Advanced) adds one where the randomizer data has none,
  leading to a place of the mod's maps. An overworld place's count includes the houses, caves and
  grottos entered from it. An entrance whose other end is on the same map (even a room not
  visited yet) has no plate. The other parts of an overworld stage the map shows apart (Hyrule
  Field by province) have a plate each, with their count.
- Link's House is one place: the house 1F, its basement B1.
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
- Items lying around are noted as seen from farther away (3000; it was 1500).
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
- Houses, caves and grottos are named after the place (from the randomizer's entrances: Agitha's
  House, Jovani's House, Doctor's Office, ...; else what their checks' names share), in the Other
  list (one entry each, only that room and its checks) and as the map's title.
- **People and golden wolves on the map**: where the game files place them (Agitha, Jovani,
  Borville, golden wolves, ...; hover for who). The check places are read again once for them.
  "People and golden wolves" in Checks Filter.
- Checks placed with the mod (presets): Agitha's 24 rewards across her house in the golden bugs'
  order, Jovani's 20 and 60 Poe Soul rewards in his house. Your own places win over them
  (**Back to preset** undoes yours); **Copy my places** copies yours as JSON for the presets.
- **Dungeons tab** in the same twilight design: a plate a dungeon (one line each, items in columns
  under titles) with its emblem,
  the land it is in, and right-aligned the small keys found (used ones too), big key or key shards, map, compass,
  boss and extras. Click a dungeon to open its map. The Map's Dungeons list shows the same counts.
- Dungeon emblems are the game's own dungeon map parchments, read from the game files when first
  shown (the original diamond until then).
- Lake Hylia and Lanayru Spring (one stage whose map shows a room at a time) are separate places
  in Lanayru Province: Lanayru Spring can be picked and opened with its checks without going there.
- Checks given by people (Sera, Barnes, Talo, Malo, Telma, ...) and golden wolves are placed where
  the game files put that person or wolf (the one in the check's region). Presets and your own
  places win.
- Other: grottos built alike (one map for several) are one entry each, showing only that grotto's
  checks (and keeping the checks you place there apart); a cave is one entry with all its rooms;
  dungeon boss rooms are no longer listed (they show when Link is there). Each entry's name and
  province can be changed (✎); Renado's Sanctuary's basement is in Eldin Province.
- Checks: a region filter beside the province's title.
- debug.html: the dungeon map backgrounds as read from the game, and the items lying around being
  watched for "seen" (distance, in view, clear line), to find out what goes wrong.
- Entrances show on both ends (a house's way out to the field too), one plate per place they lead
  to, none between two parts of the map shown; their counts are of the checks of the map they open
  (its rooms). Right-click on a map opened from an entrance goes back where it was opened.
- The Sacred Grove's rooms the game has no map for (Lost Woods, Past Sacred Grove, the Master
  Sword's pedestal) are drawn from their ground (the rooms' collision), with Link on them; they
  are in Other › Other areas.
- The Dungeons and Other lists scroll on their own: the tabs above stay in view.
- **Entrances on the maps**: where each entrance of the randomizer's list is (the spawn point its
  way back uses), a small plate with the kind of place it leads to (dungeon, house, cave, grotto,
  field) and, of the checks there not checked yet, how many are reachable (reachable / left).
  Click it for that place's map; hover for its name. "Entrances" in Checks Filter.
- Boss and miniboss rooms (stages of their own) share the dungeon's map: their checks show on the
  dungeon's map and the dungeon's on theirs, zooming out of a boss room shows the dungeon, and a
  boss room's check opens the dungeon's map.
- Key shutters (doors locked by a small key or the big key that are actors, as in Lakebed Temple)
  show as locked doors, in the dungeon and from the Dungeons list.
- Other: entries can be hidden (✎ › Hide); Castle Town's streets are left out (Field tab).
- Dungeon maps opened from the Dungeons list show their doors (read from the game files) with
  locks shut or open as the save has them, and the boss's room.
- The dungeon emblems are cut from the game's dungeon map parchments and drawn in the theme's gold.
- Other: each province's places by kind (houses and interiors, caves, grottos), in the game's
  order; coming back from a place keeps the list where it was scrolled.
- The Checks region filter lists the regions in the game's order.
- Overworld places can be renamed with ✎ beside the map's title; some are named by the mod
  (Mirror Chamber, Gerudo Desert, Faron Field, Eldin Field, Lanayru Field, West/South/East of Castle Town). The map's room
  numbers are listed under it.
- In a cave or dungeon, the map is framed on the whole place from the start (also the parts not
  shown yet).
- Under the map, "Which ones ▾" lists the checks on another floor, in another part or not found,
  with why (no chest with that box number in the stage's files, a shop item, given by a person,
  ...); click one to pick it and place it by hand.
- Any check can be moved by hand (its place from the game files is then left; **Back to the
  game's place** undoes it).
- Checks: the area a check is listed under (By area, the region filter) can be set in its panel
  (people's and events' checks otherwise go to "Elsewhere").
- Maps opened from Other or a province show every part of the place (also those the game shows
  once a switch is set, as a cave's far rooms), and provinces show the places not visited yet
  (dimmed), so checks can be found and placed before going there.
- The Dungeons and Other lists look like the game's menus: a dark twilight panel with drifting
  black squares, gold-ruled headings, and plates that light up with gold corners under the
  cursor. Dungeons are numbered in story order with the land they are in (the per-dungeon colors
  are gone).

### Fixed
- Dungeon maps opened from the Dungeons list (Forest Temple) missed doors: a door's floor is now
  kept within its room's floors, as the game does.
- The Sacred Grove's, Past Sacred Grove's and Lost Woods' maps: their rooms keep their collision
  as KCL (room.kcl), not room.dzb; their ground is read from it now. They also show when the
  overworld map data or the room's own map has no shapes.
- A map asked for while the game files were still being read (Forest Temple from the Dungeons
  list) stayed "not known yet": it is asked again.
- Zooming out of an overworld place opened by an entrance goes to its province again (back to
  where the jump was made only for houses, caves, grottos and dungeons).
- Forest Temple's doors and small keys did not show from outside: doors and map icons kept for
  one story stage only (layer chunks) are read too.
- Overworld places opened from a province lost their water and showed a stray square: they are
  drawn from the field map data again, with the save's switches.
- Snowpeak Ruins' pumpkin and cheese in the Dungeons tab sit left of the keys, so the columns line
  up.
- A check in another room of a stage whose map shows one room at a time (Lanayru Spring from Lake
  Hylia) was said to be "on another floor".
- A chest whose box number comes back in another room of its stage was put in the wrong room
  (Lanayru Spring Underwater Left Chest in Lake Hylia, Snowpeak Ruins West Cannon Room Central
  Chest): the room the game's map marks it in is taken (the check places are read again once).
- Dungeon map backgrounds (over 1 MiB) could not be sent to the page: the server sends up to 8 MiB.
- Clicking a check in Checks opens its requirement a moment later, so a double-click (the check on
  the map) is not taken by the panel opening over it.
- Items the game hides behind an invisible wall (Faron Field's Female Beetle) count as seen when
  near and in view, without the line-of-sight test: they are listed in the mod's
  seen_without_sight.txt.
- Items seen from below (a golden bug on a tree beyond a cliff's edge, as Faron Field's Female
  Beetle) were not noted: seen now means on the screen, with a clear line from the camera (not
  from Link's eyes, which cannot see over the edge).
- Lanayru Spring and Upper Zoras River showed their checks only with Link there: overworld places
  opened from a province are drawn from the stage's own map (the checks' coordinates), and checks
  the randomizer adds are moved by their room's offset.
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
