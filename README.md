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
  shards, map, compass, boss and dungeon items.
- **Locations**: every randomizer check, grouped by region and marked as obtained, reachable or
  not yet reachable.
  - Reachability follows the randomizer's own logic and settings.
  - You can give any check your own requirement.
  - Turn the logic off when it doesn't fit your seed (e.g. entrance randomizer); the tab then
    shows only obtained and not obtained.
- **Icons from your game**: the mod builds item icons from your own game data while the game
  runs. The mod ships no game images.
- **Customizable**: rearrange tiles, pick a theme or a background image, and change any icon.
  Every open page (browser and OBS) shows the same settings.

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
| Items | **Edit** | Rearrange tiles: click two slots or drag one onto another to swap them, add or remove rows, then **Confirm** |
| Any tab | **Theme** | Choose Twilight, Midna, Hyrule or Shadow, or upload a background image |
| Locations | Click a region | Show its checks. In a narrow window the region list and the check list are shown one at a time; use **‹ Back** to return |
| Locations | Click a check | Show its requirement: parts joined by "and" side by side, alternatives stacked, met parts outlined |
| Locations | **Customize** / **Edit** | Replace the randomizer logic for that check with your own routes (items or logic expressions) |
| Locations | Right-click | Highlight a check or region |
| Locations | **Logic ON/OFF** | Turn reachability on or off |
| Locations | **Rules ▾** | Export or import your custom requirements as JSON |

### Icon editor

Every icon defaults to the game's own icon. When a tile can show several icons (sword levels,
bottle contents, bomb types, quiver marks, …), a dropdown picks which one to edit; tiles that
share an icon (all bottles, all bomb bags) share the change. For each icon you can choose:

- **From the game**: the default icon.
- **From a game texture**: any texture from the game's 2D archives, picked in a browser with
  previews.
- **From image file**: an image you upload. The mod stores it under the icon's name.

You can also put a game texture **behind** an icon, for example a field behind a field key.

The game has no 2D icon for the Shadow Crystal, Fused Shadow, Mirror Shard or the bosses. These
show as text until you set an icon.

### OBS

Add a Browser Source with the tracker URL. These URL options can be combined:

| Option | Effect |
|---|---|
| `?view=items`, `?view=dungeons`, `?view=locations` | Show one tab |
| `?header=0` | Hide the tab bar |
| `?transparent=1` | Transparent background |
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
| Tag (e.g. `v0.1.0`) | All 8 platforms, merged into one `.dusk` and attached to a GitHub release |
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
