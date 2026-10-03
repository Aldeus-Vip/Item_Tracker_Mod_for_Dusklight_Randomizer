#include "web_server.hpp"

#include <mods/svc/log.hpp>
#include <mods/svc/net.hpp>
#include <mods/svc/resource.h>

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <span>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace tracker::web {
namespace {

// Request size limits: header block, JSON bodies (layout/settings), background image uploads.
constexpr size_t kMaxHeaderBytes = 16 * 1024;
// Settings carry the custom location rules, which can be a few hundred KB when imported.
constexpr size_t kMaxJsonBytes = 2 * 1024 * 1024;
constexpr size_t kMaxImageBytes = 8 * 1024 * 1024;

// Files kept in the mod's data directory.
constexpr std::string_view kLayoutFile = "layout.json";
constexpr std::string_view kSettingsFile = "settings.json";
constexpr std::string_view kBackgroundFile = "background";
// NetService allows 32 streams per mod; keep headroom for page asset requests.
constexpr size_t kMaxClients = 24;

struct Client {
    mods::net::Socket socket;
    std::string request;
    bool eventStream = false;
    size_t expectedBytes = 0;  // headers + body, known once the headers are parsed
};

mods::net::Socket g_listener;
int g_port = 0;
std::unordered_map<NetHandle, std::unique_ptr<Client>> g_clients;
std::string g_state = R"({"protocol":1,"inGame":false})";
std::filesystem::path g_iconDir;
std::filesystem::path g_dataDir;
RandoFileResolver g_randoResolver = nullptr;
GameIconProvider g_gameIcons = nullptr;
TextureListProvider g_textureList = nullptr;
TextureProvider g_texture = nullptr;
std::filesystem::path g_randoSettingsFile;
std::filesystem::path g_seedsDir;  // the randomizer's seeds/<hash>/ folders
FoundSink g_foundSink = nullptr;
MapProvider g_mapSource = nullptr;

// Icons are at most a few hundred KB; anything larger is not an icon.
constexpr std::uintmax_t kMaxIconBytes = 4 * 1024 * 1024;

void send_text(Client& client, std::string_view text) {
    client.socket.send(std::as_bytes(std::span{text.data(), text.size()}));
}

void send_response(Client& client, std::string_view status, std::string_view contentType,
    std::string_view body, std::string_view cacheControl = "no-cache") {
    std::string head;
    head.reserve(256);
    head += "HTTP/1.1 ";
    head += status;
    head += "\r\nContent-Type: ";
    head += contentType;
    head += "\r\nContent-Length: ";
    head += std::to_string(body.size());
    head += "\r\nCache-Control: ";
    head += cacheControl;
    head += "\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n";
    send_text(client, head);
    send_text(client, body);
}

void send_error(Client& client, std::string_view status) {
    send_response(client, status, "text/plain; charset=utf-8", status);
}

std::string_view content_type_for(std::string_view path) {
    const auto dot = path.rfind('.');
    const std::string_view ext = dot == std::string_view::npos ? "" : path.substr(dot + 1);
    if (ext == "html") return "text/html; charset=utf-8";
    if (ext == "js" || ext == "mjs") return "text/javascript; charset=utf-8";
    if (ext == "css") return "text/css; charset=utf-8";
    if (ext == "json") return "application/json; charset=utf-8";
    if (ext == "svg") return "image/svg+xml";
    if (ext == "png") return "image/png";
    if (ext == "webp") return "image/webp";
    if (ext == "ico") return "image/x-icon";
    if (ext == "ttf") return "font/ttf";
    if (ext == "woff2") return "font/woff2";
    return "application/octet-stream";
}

// Only plain relative paths inside res/web are served.
bool is_safe_asset_path(std::string_view path) {
    if (path.empty() || path.front() == '/' || path.find("..") != std::string_view::npos) {
        return false;
    }
    return std::all_of(path.begin(), path.end(), [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_' || c == '-' || c == '/';
    });
}

std::string lowercase(std::string_view s) {
    std::string out{s};
    std::transform(out.begin(), out.end(), out.begin(),
        [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

std::string_view trim(std::string_view s) {
    while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.remove_prefix(1);
    while (!s.empty() && (s.back() == ' ' || s.back() == '\t' || s.back() == '\r')) s.remove_suffix(1);
    return s;
}

// Rejects requests whose Host header is not a loopback name. This blocks DNS-rebinding pages
// from reading the tracker through the browser.
bool is_loopback_host(std::string_view host) {
    std::string h = lowercase(trim(host));
    const std::string portSuffix = ":" + std::to_string(g_port);
    if (h.size() > portSuffix.size() && h.ends_with(portSuffix)) {
        h.resize(h.size() - portSuffix.size());
    }
    return h == "127.0.0.1" || h == "localhost" || h == "[::1]";
}

std::string format_state_event(std::string_view json) {
    std::string event;
    event.reserve(json.size() + 32);
    event += "event: state\ndata: ";
    event += json;
    event += "\n\n";
    return event;
}

void serve_asset(Client& client, std::string_view path) {
    if (!is_safe_asset_path(path)) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::string resPath = "web/" + std::string{path};
    ResourceBuffer buffer = RESOURCE_BUFFER_INIT;
    if (svc_resource->load(mod_ctx, resPath.c_str(), &buffer) != MOD_OK) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", content_type_for(path),
        std::string_view{static_cast<const char*>(buffer.data), buffer.size});
    svc_resource->free(mod_ctx, &buffer);
}

// Decodes %XX escapes. Returns false on a malformed escape.
bool percent_decode(std::string_view in, std::string& out) {
    out.clear();
    for (size_t i = 0; i < in.size(); ++i) {
        if (in[i] != '%') {
            out += in[i];
            continue;
        }
        if (i + 2 >= in.size() || !std::isxdigit(static_cast<unsigned char>(in[i + 1])) ||
            !std::isxdigit(static_cast<unsigned char>(in[i + 2]))) {
            return false;
        }
        out += static_cast<char>(std::stoi(std::string{in.substr(i + 1, 2)}, nullptr, 16));
        i += 2;
    }
    return true;
}

// Icon names are flat file names such as "Auru's_Memo.png" (no directories).
bool is_safe_icon_name(std::string_view name) {
    if (name.empty() || name.front() == '.' || !name.ends_with(".png")) {
        return false;
    }
    return std::all_of(name.begin(), name.end(), [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_' || c == '-' || c == '\'';
    });
}

std::string_view image_type(std::string_view data);

// /game-icons/<item number>.png: icon built from the game's own item icon archive.
void serve_game_icon(Client& client, std::string_view name) {
    int itemNo = -1;
    if (name.ends_with(".png")) {
        const std::string_view digits = name.substr(0, name.size() - 4);
        if (!digits.empty() && digits.size() <= 3 &&
            std::all_of(digits.begin(), digits.end(), [](char c) { return c >= '0' && c <= '9'; })) {
            itemNo = std::stoi(std::string{digits});
        }
    }
    const std::string body = g_gameIcons && itemNo >= 0 && itemNo < 255 ? g_gameIcons(itemNo) : std::string{};
    if (body.empty()) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", "image/png", body, "max-age=3600");
}

// /game-textures/<archive>/          -> JSON list of the archive's textures
// /game-textures/<archive>/<name>.png -> one texture ("<file>.bti" or "#<index>") as PNG
void serve_game_texture(Client& client, std::string_view rest) {
    const size_t slash = rest.find('/');
    std::string archive{rest.substr(0, slash)};
    const bool archiveOk = !archive.empty() && archive.size() <= 16 &&
        std::all_of(archive.begin(), archive.end(), [](char c) { return c >= 'a' && c <= 'z' || c >= '0' && c <= '9'; });
    if (slash == std::string_view::npos || !archiveOk || g_textureList == nullptr || g_texture == nullptr) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::string_view file = rest.substr(slash + 1);
    if (file.empty()) {
        const std::string list = g_textureList(archive);
        if (list.empty()) send_error(client, "404 Not Found");
        else send_response(client, "200 OK", "application/json; charset=utf-8", list);
        return;
    }
    std::string name;
    if (!file.ends_with(".png") || !percent_decode(file.substr(0, file.size() - 4), name) || name.size() > 64 ||
        !std::all_of(name.begin(), name.end(), [](char c) { return std::isalnum(static_cast<unsigned char>(c)) || c == '_' || c == '.' || c == '-' || c == '#'; })) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::string png = g_texture(archive, name);
    if (png.empty()) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", "image/png", png, "max-age=3600");
}

void serve_icon(Client& client, std::string_view encodedName) {
    std::string name;
    if (g_iconDir.empty() || !percent_decode(encodedName, name) || !is_safe_icon_name(name)) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::filesystem::path file = g_iconDir / name;
    std::error_code ec;
    const auto size = std::filesystem::file_size(file, ec);
    if (ec || size > kMaxIconBytes) {
        send_error(client, "404 Not Found");
        return;
    }
    std::ifstream in{file, std::ios::binary};
    if (!in) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::string body{std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{}};
    const std::string_view type = image_type(body);
    if (type.empty()) {
        send_error(client, "404 Not Found");
        return;
    }
    // The page adds ?rev=<n> after each upload, so the browser may keep icons for a while.
    send_response(client, "200 OK", type, body, "max-age=3600");
}

struct Request {
    std::string_view method;
    std::string_view target;
    std::string_view host;
    std::string_view origin;
    std::string_view contentType;
    size_t contentLength = 0;
    size_t headerBytes = 0;  // Request line + headers + blank line
    std::string_view body;
};

// Parses the request line and headers. Returns false if the request line is malformed.
// Requires the header block to be complete ("\r\n\r\n" present).
bool parse_request(std::string_view req, Request& out) {
    const auto headerEnd = req.find("\r\n\r\n");
    out.headerBytes = headerEnd + 4;
    const auto lineEnd = req.find("\r\n");
    const std::string_view requestLine = req.substr(0, lineEnd);

    // Request line: METHOD SP TARGET SP VERSION
    const auto sp1 = requestLine.find(' ');
    const auto sp2 = sp1 == std::string_view::npos ? sp1 : requestLine.find(' ', sp1 + 1);
    if (sp2 == std::string_view::npos) {
        return false;
    }
    out.method = requestLine.substr(0, sp1);
    out.target = requestLine.substr(sp1 + 1, sp2 - sp1 - 1);
    if (const auto q = out.target.find('?'); q != std::string_view::npos) {
        out.target = out.target.substr(0, q);
    }

    size_t pos = lineEnd + 2;
    while (pos < headerEnd) {
        const auto end = req.find("\r\n", pos);
        const std::string_view line = req.substr(pos, end - pos);
        const auto colon = line.find(':');
        if (colon != std::string_view::npos) {
            const std::string name = lowercase(line.substr(0, colon));
            const std::string_view value = trim(line.substr(colon + 1));
            if (name == "host") {
                out.host = value;
            } else if (name == "origin") {
                out.origin = value;
            } else if (name == "content-type") {
                out.contentType = value;
            } else if (name == "content-length") {
                out.contentLength = std::strtoull(std::string{value}.c_str(), nullptr, 10);
            }
        }
        pos = end + 2;
    }
    return true;
}

// A page served by this mod sends its own origin; anything else is a cross-site request.
bool is_own_origin(std::string_view origin) {
    if (origin.empty()) {
        return true;  // Non-browser clients (curl) do not send Origin.
    }
    constexpr std::string_view kScheme = "http://";
    if (!origin.starts_with(kScheme)) {
        return false;
    }
    return is_loopback_host(origin.substr(kScheme.size()));
}

// ---- Saved configuration (layout, settings, background image) ----

std::filesystem::path config_path(std::string_view name) {
    return g_dataDir.empty() ? std::filesystem::path{} : g_dataDir / std::string{name};
}

bool read_file(const std::filesystem::path& path, std::string& out) {
    std::error_code ec;
    if (path.empty() || !std::filesystem::is_regular_file(path, ec)) {
        return false;
    }
    std::ifstream in{path, std::ios::binary};
    out.assign(std::istreambuf_iterator<char>{in}, std::istreambuf_iterator<char>{});
    return static_cast<bool>(in) || in.eof();
}

// Writes via a temporary file so a crash never leaves a truncated file behind.
bool write_file(const std::filesystem::path& path, std::string_view data) {
    std::filesystem::path tmp = path;
    tmp += ".tmp";
    {
        std::ofstream out{tmp, std::ios::binary | std::ios::trunc};
        out.write(data.data(), static_cast<std::streamsize>(data.size()));
        if (!out) {
            return false;
        }
    }
    std::error_code ec;
    std::filesystem::rename(tmp, path, ec);
    if (ec) {
        mods::log::warn("tracker: cannot write {}: {}", path.string(), ec.message());
        return false;
    }
    return true;
}

// Tells every open page to re-read the saved configuration.
void broadcast_config_changed() {
    for (auto& [handle, client] : g_clients) {
        if (client->eventStream) {
            send_text(*client, "event: config\ndata: {}\n\n");
        }
    }
}

void serve_json_file(Client& client, std::string_view name) {
    std::string body;
    if (!read_file(config_path(name), body)) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", "application/json; charset=utf-8", body);
}

// Writes are accepted only from the tracker page itself. A JSON or image content type forces a
// CORS preflight for cross-site pages, which this server never approves; the Origin check covers
// the rest.
bool check_write_allowed(Client& client, const Request& req, std::string_view requiredType) {
    if (g_dataDir.empty()) {
        send_error(client, "503 Service Unavailable");
        return false;
    }
    if (!is_own_origin(req.origin) || !req.contentType.starts_with(requiredType)) {
        send_error(client, "403 Forbidden");
        return false;
    }
    return true;
}

void save_json_file(Client& client, const Request& req, std::string_view name) {
    if (!check_write_allowed(client, req, "application/json")) {
        return;
    }
    const std::string_view body = trim(req.body);
    if (body.empty() || body.front() != '{' || body.back() != '}') {
        send_error(client, "400 Bad Request");
        return;
    }
    if (!write_file(config_path(name), body)) {
        send_error(client, "500 Internal Server Error");
        return;
    }
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
    broadcast_config_changed();
}

// Identifies an uploaded image by its magic bytes (the stored file has no extension).
std::string_view image_type(std::string_view data) {
    if (data.starts_with("\x89PNG\r\n\x1a\n")) return "image/png";
    if (data.starts_with("\xff\xd8\xff")) return "image/jpeg";
    if (data.starts_with("GIF8")) return "image/gif";
    if (data.size() >= 12 && data.starts_with("RIFF") && data.substr(8, 4) == "WEBP") return "image/webp";
    return {};
}

void serve_background(Client& client) {
    std::string body;
    if (!read_file(config_path(kBackgroundFile), body) || image_type(body).empty()) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", image_type(body), body);
}

void save_background(Client& client, const Request& req) {
    if (!check_write_allowed(client, req, "image/")) {
        return;
    }
    if (image_type(req.body).empty()) {
        send_error(client, "415 Unsupported Media Type");
        return;
    }
    if (!write_file(config_path(kBackgroundFile), req.body)) {
        send_error(client, "500 Internal Server Error");
        return;
    }
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
    broadcast_config_changed();
}

void delete_background(Client& client, const Request& req) {
    if (g_dataDir.empty() || !is_own_origin(req.origin)) {
        send_error(client, "403 Forbidden");
        return;
    }
    std::error_code ec;
    std::filesystem::remove(config_path(kBackgroundFile), ec);
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
    broadcast_config_changed();
}

// POST /icons/<name>.png: a custom icon uploaded on the tracker page, stored in the icon folder
// under the icon's name (whatever the uploaded file was called).
void save_icon(Client& client, const Request& req, std::string_view encodedName) {
    std::string name;
    if (g_iconDir.empty() || !percent_decode(encodedName, name) || !is_safe_icon_name(name)) {
        send_error(client, "404 Not Found");
        return;
    }
    if (!check_write_allowed(client, req, "image/")) {
        return;
    }
    if (image_type(req.body).empty()) {
        send_error(client, "415 Unsupported Media Type");
        return;
    }
    std::error_code ec;
    std::filesystem::create_directories(g_iconDir, ec);
    if (!write_file(g_iconDir / name, req.body)) {
        send_error(client, "500 Internal Server Error");
        return;
    }
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
}

void delete_icon(Client& client, const Request& req, std::string_view encodedName) {
    std::string name;
    if (g_iconDir.empty() || !percent_decode(encodedName, name) || !is_safe_icon_name(name)) {
        send_error(client, "404 Not Found");
        return;
    }
    if (!is_own_origin(req.origin)) {
        send_error(client, "403 Forbidden");
        return;
    }
    std::error_code ec;
    std::filesystem::remove(g_iconDir / name, ec);
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
}

void serve_yaml_file(Client& client, const std::filesystem::path& path) {
    std::string body;
    if (!read_file(path, body)) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", "text/yaml; charset=utf-8", body);
}

void serve_rando_file(Client& client, std::string_view encodedPath) {
    std::string relative;
    if (g_randoResolver == nullptr || !percent_decode(encodedPath, relative)) {
        send_error(client, "404 Not Found");
        return;
    }
    const std::string file = g_randoResolver(relative);  // only known data files resolve
    if (file.empty()) {
        send_error(client, "404 Not Found");
        return;
    }
    serve_yaml_file(client, file);
}

// Seed hashes are three words ("Epona Lantern Goron"); anything else is not a seed folder.
bool is_safe_seed_hash(std::string_view hash) {
    return !hash.empty() && hash.size() <= 100 && hash.find("..") == std::string_view::npos &&
        std::all_of(hash.begin(), hash.end(), [](char c) {
            return std::isalnum(static_cast<unsigned char>(c)) || c == ' ' || c == '-' || c == '_' || c == '\'';
        });
}

std::filesystem::path spoiler_path(const std::string& hash) {
    return g_seedsDir / hash / (hash + " Spoiler Log.txt");
}

// /rando-seeds/ -> JSON array of the generated seeds, newest first: [{"hash", "spoiler": bool}]
void serve_seed_list(Client& client) {
    struct Seed {
        std::string hash;
        std::filesystem::file_time_type time;
        bool spoiler;
    };
    std::vector<Seed> seeds;
    std::error_code ec;
    if (!g_seedsDir.empty()) {
        for (const auto& entry : std::filesystem::directory_iterator(g_seedsDir, ec)) {
            if (!entry.is_directory(ec)) continue;
            const std::string hash = entry.path().filename().string();
            if (!is_safe_seed_hash(hash)) continue;
            const auto seedFile = entry.path() / "seed.dat";
            const auto time = std::filesystem::last_write_time(std::filesystem::exists(seedFile, ec) ? seedFile : entry.path(), ec);
            seeds.push_back({hash, time, std::filesystem::exists(spoiler_path(hash), ec)});
        }
    }
    std::sort(seeds.begin(), seeds.end(), [](const Seed& a, const Seed& b) { return a.time > b.time; });
    std::string body = "[";
    for (const Seed& s : seeds) {
        if (body.size() > 1) body += ',';
        body += R"({"hash":")" + s.hash + R"(","spoiler":)" + (s.spoiler ? "true" : "false") + "}";
    }
    body += "]";
    send_response(client, "200 OK", "application/json; charset=utf-8", body, "no-store");
}

// /rando-seeds/<hash> -> that seed's spoiler log (the page shows only what the player has found)
void serve_seed_spoiler(Client& client, std::string_view encodedHash) {
    std::string hash;
    std::string body;
    if (g_seedsDir.empty() || !percent_decode(encodedHash, hash) || !is_safe_seed_hash(hash) ||
        !read_file(spoiler_path(hash), body)) {
        send_error(client, "404 Not Found");
        return;
    }
    send_response(client, "200 OK", "text/plain; charset=utf-8", body, "no-store");
}

// POST /found: checks the page learned about (shops entered), kept with the save by the mod.
void add_found(Client& client, const Request& req) {
    if (g_foundSink == nullptr || !is_own_origin(req.origin) || !req.contentType.starts_with("text/plain")) {
        send_error(client, "403 Forbidden");
        return;
    }
    g_foundSink(std::string{req.body});
    send_response(client, "200 OK", "application/json; charset=utf-8", "{\"ok\":true}");
}

// Largest request body accepted for a target.
size_t max_body_bytes(std::string_view target) {
    if (target.starts_with("/icons/")) return kMaxIconBytes;
    return target == "/background" ? kMaxImageBytes : kMaxJsonBytes;
}

// Handles one complete request. Returns true if the connection should stay open (event stream).
bool handle_request(Client& client, const Request& req) {
    if (!is_loopback_host(req.host)) {
        send_error(client, "403 Forbidden");
        return false;
    }
    const std::string_view target = req.target;

    if (req.method == "POST") {
        if (target == "/layout") {
            save_json_file(client, req, kLayoutFile);
        } else if (target == "/settings") {
            save_json_file(client, req, kSettingsFile);
        } else if (target == "/background") {
            save_background(client, req);
        } else if (target.starts_with("/icons/")) {
            save_icon(client, req, target.substr(7));
        } else if (target == "/found") {
            add_found(client, req);
        } else {
            send_error(client, "404 Not Found");
        }
        return false;
    }
    if (req.method == "DELETE" && target == "/background") {
        delete_background(client, req);
        return false;
    }
    if (req.method == "DELETE" && target.starts_with("/icons/")) {
        delete_icon(client, req, target.substr(7));
        return false;
    }
    if (req.method != "GET") {
        send_error(client, "405 Method Not Allowed");
        return false;
    }

    if (target == "/events") {
        send_text(client,
            "HTTP/1.1 200 OK\r\n"
            "Content-Type: text/event-stream\r\n"
            "Cache-Control: no-cache\r\n"
            "Connection: keep-alive\r\n\r\n"
            "retry: 2000\n\n");
        send_text(client, format_state_event(g_state));
        client.eventStream = true;
        return true;
    }
    if (target == "/state") {
        send_response(client, "200 OK", "application/json; charset=utf-8", g_state);
        return false;
    }
    if (target == "/map") {
        if (g_mapSource == nullptr) send_error(client, "404 Not Found");
        else send_response(client, "200 OK", "application/json; charset=utf-8", g_mapSource());
        return false;
    }
    if (target == "/layout") {
        serve_json_file(client, kLayoutFile);
        return false;
    }
    if (target == "/settings") {
        serve_json_file(client, kSettingsFile);
        return false;
    }
    if (target == "/background") {
        serve_background(client);
        return false;
    }
    if (target == "/") {
        serve_asset(client, "index.html");
        return false;
    }
    if (target.starts_with("/game-textures/")) {
        serve_game_texture(client, target.substr(15));
        return false;
    }
    if (target.starts_with("/game-icons/")) {
        serve_game_icon(client, target.substr(12));
        return false;
    }
    if (target.starts_with("/icons/")) {
        serve_icon(client, target.substr(7));
        return false;
    }
    if (target.starts_with("/rando/")) {
        serve_rando_file(client, target.substr(7));
        return false;
    }
    if (target == "/rando-seeds/") {
        serve_seed_list(client);
        return false;
    }
    if (target.starts_with("/rando-seeds/")) {
        serve_seed_spoiler(client, target.substr(13));
        return false;
    }
    if (target == "/rando-settings.yaml") {
        serve_yaml_file(client, g_randoSettingsFile);
        return false;
    }
    serve_asset(client, target.substr(1));
    return false;
}

void close_client(NetHandle handle) {
    // Socket::close() flushes queued data before closing (NetService close timeout).
    g_clients.erase(handle);
}

}  // namespace

bool start(int port) {
    stop();
    mods::net::BindOutcome bound;
    const std::string bind = "tcp://127.0.0.1:" + std::to_string(port);
    g_listener = mods::net::listen(bind, &bound);
    if (!g_listener) {
        mods::log::error("tracker: failed to listen on {} (net error {})", bind,
            static_cast<int>(bound.error));
        return false;
    }
    g_port = port;
    mods::log::info("tracker: open http://127.0.0.1:{}/ in a browser", port);
    return true;
}

void stop() {
    g_clients.clear();
    g_listener.close();
    g_port = 0;
}

bool running() {
    return static_cast<bool>(g_listener);
}

int port() {
    return g_port;
}

void poll() {
    mods::net::Event event;
    while (mods::net::poll(event)) {
        switch (event.type) {
        case NET_EVENT_ACCEPTED: {
            mods::net::Socket socket = mods::net::adopt(event.accepted);
            if (!socket || g_clients.size() >= kMaxClients) {
                break;  // Dropping the socket closes it.
            }
            auto client = std::make_unique<Client>();
            client->socket = std::move(socket);
            g_clients.emplace(event.accepted, std::move(client));
            break;
        }
        case NET_EVENT_STREAM_DATA: {
            auto it = g_clients.find(event.handle);
            if (it == g_clients.end()) break;
            Client& client = *it->second;
            if (client.eventStream) break;  // Nothing is expected from an open event stream.
            client.request.append(reinterpret_cast<const char*>(event.data.data()), event.data.size());
            // Once the headers are parsed, only wait for the announced body length; this avoids
            // rescanning a large upload on every chunk.
            if (client.expectedBytes != 0 && client.request.size() < client.expectedBytes) {
                break;
            }
            if (client.expectedBytes == 0) {
                if (client.request.find("\r\n\r\n") == std::string::npos) {
                    if (client.request.size() > kMaxHeaderBytes) {
                        send_error(client, "431 Request Header Fields Too Large");
                        close_client(event.handle);
                    }
                    break;  // Headers still arriving.
                }
            }
            Request req;
            if (!parse_request(client.request, req)) {
                send_error(client, "400 Bad Request");
                close_client(event.handle);
                break;
            }
            if (req.contentLength > max_body_bytes(req.target)) {
                send_error(client, "413 Content Too Large");
                close_client(event.handle);
                break;
            }
            client.expectedBytes = req.headerBytes + req.contentLength;
            if (client.request.size() < client.expectedBytes) {
                break;  // Body still arriving.
            }
            req.body = std::string_view{client.request}.substr(req.headerBytes, req.contentLength);
            if (!handle_request(client, req)) {
                close_client(event.handle);
            }
            break;
        }
        case NET_EVENT_CLOSED: {
            if (event.handle == g_listener.handle()) {
                mods::log::error("tracker: listener closed: {}", event.message);
                g_listener.detach();
                g_listener = {};
                break;
            }
            auto it = g_clients.find(event.handle);
            if (it != g_clients.end()) {
                it->second->socket.detach();  // The handle is already invalid.
                g_clients.erase(it);
            }
            break;
        }
        default:
            break;
        }
    }
}

void publish_state(const std::string& json) {
    g_state = json;
    const std::string event = format_state_event(json);
    for (auto& [handle, client] : g_clients) {
        if (client->eventStream) {
            send_text(*client, event);
        }
    }
}

void send_keepalive() {
    for (auto& [handle, client] : g_clients) {
        if (client->eventStream) {
            send_text(*client, ": keepalive\n\n");
        }
    }
}

void set_icon_dir(std::string dir) {
    g_iconDir = std::filesystem::path{std::move(dir)};
}

void set_game_icons(GameIconProvider provider) {
    g_gameIcons = provider;
}

void set_game_textures(TextureListProvider list, TextureProvider texture) {
    g_textureList = list;
    g_texture = texture;
}

void set_found_sink(FoundSink sink) {
    g_foundSink = sink;
}

void set_map_source(MapProvider provider) {
    g_mapSource = provider;
}

void set_seeds_dir(std::string dir) {
    g_seedsDir = std::filesystem::path{std::move(dir)};
}

void set_rando_files(RandoFileResolver resolver, std::string settingsFile) {
    g_randoResolver = resolver;
    g_randoSettingsFile = std::filesystem::path{std::move(settingsFile)};
}

void set_data_dir(std::string dir) {
    g_dataDir = std::filesystem::path{std::move(dir)};
}

int stream_count() {
    return static_cast<int>(std::count_if(g_clients.begin(), g_clients.end(),
        [](const auto& entry) { return entry.second->eventStream; }));
}

}  // namespace tracker::web
