#pragma once

#include <string>

// Loopback-only HTTP server built on NetService (single instance per mod).
//
//   GET /            -> res/web/index.html
//   GET /<file>      -> res/web/<file>
//   GET /state       -> current state JSON
//   GET /events      -> Server-Sent Events stream of "state" events carrying the state JSON
//   GET /icons/<png> -> user-supplied icon from the icon folder (see set_icon_dir)
//   GET /game-icons/<item number>.png -> icon built from the game's data (see set_game_icons)
//   GET /game-textures/<archive>/[<name>.png] -> texture list / one texture (see set_game_textures)
//   GET/POST /layout      -> tracker layout JSON (404 until saved)
//   GET/POST /settings    -> page settings JSON: theme, background options (404 until saved)
//   GET/POST/DELETE /background -> custom background image
//   GET /rando/<path>     -> randomizer logic data file (see set_rando_files)
//   GET /rando-settings.yaml -> the randomizer's current settings.yaml
// Writes are accepted from the tracker page only and trigger an SSE "config" event so every open
// page (browser, OBS) reloads the configuration.
//
// Server-Sent Events are used instead of WebSocket: data only flows Mod -> page, and the
// browser's EventSource reconnects automatically when the game restarts.
namespace tracker::web {

// Binds 127.0.0.1:<port>. Returns false (and logs) if the port cannot be bound.
bool start(int port);
void stop();
bool running();
int port();

// Drains network events. Call once per frame.
void poll();

// Stores the latest state and pushes it to every connected event stream.
void publish_state(const std::string& json);

// Sends an SSE comment so idle streams are not dropped.
void send_keepalive();

int stream_count();

// Folder holding icons uploaded in the icon editor (icons/<icon name>.png). Empty disables
// /icons/.
void set_icon_dir(std::string dir);

// Builds the PNG of a game item icon, or "" when unavailable.
using GameIconProvider = std::string (*)(int itemNo);

// Enables /game-icons/<item number>.png.
void set_game_icons(GameIconProvider provider);

// Lists an archive's textures as a JSON array ("" = unknown archive), and draws one texture as
// PNG ("" = unavailable).
using TextureListProvider = std::string (*)(const std::string& archive);
using TextureProvider = std::string (*)(const std::string& archive, const std::string& name);

// Enables /game-textures/.
void set_game_textures(TextureListProvider list, TextureProvider texture);

// Directory holding layout.json, settings.json and the background image. Empty disables saving.
void set_data_dir(std::string dir);

// Maps a relative randomizer data path (e.g. "world/Root.yaml") to a file on disk, or "" when the
// path is not a known data file.
using RandoFileResolver = std::string (*)(const std::string& relative);

// Enables /rando/<path> and /rando-settings.yaml.
void set_rando_files(RandoFileResolver resolver, std::string settingsFile);

}  // namespace tracker::web
