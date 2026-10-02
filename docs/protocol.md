# Tracker Protocol (v1)

The mod serves everything from `http://127.0.0.1:<port>/` (default port **38100**, configurable in
the mod's panel). Only loopback clients can connect, and requests whose `Host` header is not
`127.0.0.1`, `localhost` or `[::1]` are rejected (DNS-rebinding protection).

## Endpoints

| Method | Path | Response |
|---|---|---|
| GET | `/` | `res/web/index.html` |
| GET | `/<file>` | `res/web/<file>` |
| GET | `/state` | Current state (JSON) |
| GET | `/events` | `text/event-stream` |
| GET / POST / DELETE | `/icons/<name>.png` | Custom icon uploaded in the icon editor, stored as `<mod data dir>/icons/<name>.png` (PNG, JPEG, WebP or GIF, max 4 MB; 404 if absent) |
| GET | `/game-textures/<archive>/` | JSON list of the `.bti` textures in a game archive: `itemicon` (item icons) or `dmap` (dungeon map) (404 before the game has loaded it) |
| GET | `/game-textures/<archive>/<name>.png` | One texture drawn with neutral colors; `<name>` is `<file>.bti` or `#<index>` (percent-encoded) |
| GET | `/game-icons/<n>.png` | Icon of game item number `n`, built from the game's item icon archive (404 before the archive is loaded or when the item has none) |
| GET / POST | `/layout` | Tracker layout (`<mod data dir>/layout.json`, 404 until saved) |
| GET / POST | `/settings` | Page settings: theme, background options and custom location rules, regions marked reachable (`settings.json`, max 2 MB) |
| GET / POST / DELETE | `/background` | Custom background image (PNG, JPEG, WebP or GIF, max 8 MB) |
| GET | `/rando/<path>` | Randomizer data file downloaded by the mod (e.g. `world/Root.yaml`) |
| GET | `/rando-settings.yaml` | The randomizer's current `settings.yaml` (404 if the randomizer never saved one) |
| GET | `/rando-seeds/` | The randomizer's generated seeds, newest first: `[{"hash": "Epona Lantern Goron", "spoiler": true}]` |
| GET | `/rando-seeds/<hash>` | That seed's spoiler log (text). The page shows only placements of checks the player has found |
| POST | `/found` | `text/plain`: an optional first line `seed\t<hash>`, then entry lines: `loc:<location>` (shop seen), `told:<location>` (an NPC named the item), `map:<region>` (marked reachable), `mark:<location>` (marked checked), `note:<key>\t<text>` (replaces that key's note), or `-map:…` / `-mark:…` / `-note:<key>` to remove one. Kept with the game save (see `found` in the state) |

Writes are accepted only from the tracker page's own origin (or without `Origin`, e.g. curl) and
only with `Content-Type: application/json` (layout, settings) or `image/*` (background). These
content types make cross-site pages send a CORS preflight, which the server never approves, so
other websites cannot change the saved configuration. After every write the server sends an
`event: config` on all event streams so other open pages (e.g. OBS) reload it.

## Event stream

On connect the server sends `retry: 2000` and then one `state` event with the full state.
Afterwards, a `state` event is sent whenever the state changes. Every event carries the **full**
state (it is small), so clients never need to merge deltas. A `: keepalive` comment is sent every
~15 seconds.

```
event: state
data: {"protocol":1,"inGame":true,...}
```

## State object

```jsonc
{
  "protocol": 1,          // bumped on incompatible changes; the page refuses other versions
  "inGame": true,         // false on the title screen / file select (no other fields then)
  "stage": "F_SP103",     // current stage name
  "room": 0,              // room Link is in (marks the logic region as reachable)
  "bugsGiven": ["Male Ant"], // golden bugs given to Agitha
  "found": {              // found without collecting, kept with the save: seed hash and entries
    "seed": "Epona Lantern Goron",
    // check: a seen item, with the item id it looks like (hex) when known
    "entries": ["hint:Ordon Sword", "check:freestanding:F_SP103:128\t43", "loc:Sera Shop Slingshot",
                "map:Ordon", "mark:Sera Shop Slingshot", "note:region/Ordon\tPortal leads to Kakariko"]
  },
  "items": {              // counts, keyed by randomizer logic item names
    "Progressive Sword": 1,         // 0-4: Wooden, Ordon, Master, Light
    "Ordon Shield": 0, "Wooden Shield": 0, "Hylian Shield": 0,
    "Zora Armor": 0, "Magic Armor": 0,
    "Progressive Wallet": 0,        // 0 normal, 1 big, 2 giant
    "Progressive Fishing Rod": 1,   // 1 rod, 2 coral earring rod
    "Progressive Bow": 0,           // 1 bow, 2 big quiver, 3 giant quiver
    "Giant Bomb Bag": 0,            // doubles every bag's capacity
    "Progressive Clawshot": 0,      // 1 clawshot, 2 double clawshots
    "Progressive Dominion Rod": 0,  // 1 inert, 2 powered
    "Progressive Sky Book": 0,      // book + sky characters (1-7)
    "Sky Book Characters": 0,       // 0-6, from the randomizer's item wheel counter
    "Slingshot": 1, "Lantern": 0, "Gale Boomerang": 0, "Iron Boots": 0, "Hawkeye": 0,
    "Bomb Bag": 0,                  // number of bomb bags
    "Spinner": 0, "Ball and Chain": 0,
    "Empty Bottle": 0,              // number of bottles (any contents)
    "Aurus Memo": 0, "Asheis Sketch": 0,
    "Renados Letter": 0, "Invoice": 0, "Wooden Statue": 0, "Ilias Charm": 0, "Horse Call": 0,
    "North Faron Woods Gate Key": 0, "Faron Woods Coro Key": 0,   // gate unlocked
    "Gate Keys": 0, "Goron Mines Key Shard": 0, "Ordon Pumpkin": 0, "Ordon Cheese": 0,
    "Gerudo Desert Bulblin Camp Key": 0,
    "Shadow Crystal": 0,
    "Progressive Fused Shadow": 0, "Progressive Mirror Shard": 0,
    "Faron Twilight Tear": 0, "Eldin Twilight Tear": 0, "Lanayru Twilight Tear": 0,
    "Poe Soul": 0, "Golden Bug": 0,
    "Ordon Spring Portal": 0, "...": 0,          // randomizer warp portals (15)
    "Progressive Hidden Skill": 0                 // randomizer hidden skills (0-7)
  },
  "maxLife": 15,          // max life in heart-piece units (5 = one heart), for hearts(n) in logic
  "time": { "hour": 14, "night": false },   // in-game clock; night is 19:00-6:00
  "twilightCleared": { "Faron": true, "Eldin": false, "Lanayru": false },
  "ammo": {
    "seeds": 30, "seedsMax": 50,        // slingshot
    "arrows": 0, "arrowsMax": 30,
    "oil": 16000, "oilMax": 21600,      // lantern
    "rupees": 35, "rupeesMax": 300
  },
  "bombBags": [                         // owned bags only, in slot order
    { "item": 112, "count": 13, "max": 30 }   // item: 80 empty bag, 112 bombs, 113 water bombs, 114 bomblings
  ],
  "bottles": [                          // owned bottles only, in slot order
    { "item": 96, "count": 0 }                // item: contents id (96 = empty); count is meaningful only for bee larvae (118)
  ],
  "flags": {                            // raw save flags for the Locations tab
    "currentStage": 0,                  // save table id of the current stage
    "events": "00ff…",                  // 256 event bytes (hex); flag 0xAABB = byte 0xAA & mask 0xBB
    "stages": [                         // 32 stage save tables, bit n = flag n, bytes in hex
      { "t": "…", "s": "…", "i": "…" }  // t: treasure boxes 0-63, s: switches 0-127, i: item bits 0x80-0xBF
    ],
    "currentItems": "…"                 // current stage item bits 0x00-0xBF (includes temporary ones)
  },
  "dungeons": [
    {
      "name": "Forest Temple",
      "smallKeys": 1,        // keys obtained in total = held + unlocked key doors
      "smallKeysHeld": 1,    // keys currently held
      "maxSmallKeys": 4,
      "hasBigKey": true,     // false for Goron Mines (key shards instead)
      "bigKey": false,
      "map": false,
      "compass": false,
      "bossDefeated": false
    }
    // Goron Mines, Lakebed Temple, Arbiters Grounds, Snowpeak Ruins, Temple of Time,
    // City in the Sky, Palace of Twilight, Hyrule Castle
  ]
}
```

Unknown fields must be ignored by clients so the mod can add data (e.g. check flags for phase 2)
without a protocol bump.
