// Host-side test for src/web_server.cpp. NetService, ResourceService and LogService are replaced
// by in-memory fakes, so the HTTP handling (chunked bodies, uploads, access checks, SSE) can be
// exercised without the game. Build and run with tests/run.sh.

#include "../src/web_server.hpp"

#include <mods/service.hpp>
#include <mods/svc/log.h>
#include <mods/svc/net.h>
#include <mods/svc/resource.h>

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <filesystem>
#include <fstream>
#include <map>
#include <string>

extern "C" {
ModContext* mod_ctx = nullptr;
const NetService* svc_net = nullptr;
const ResourceService* svc_resource = nullptr;
const LogService* svc_log = nullptr;
}

namespace {

// ---- Fake NetService ----

constexpr NetHandle kListener = 1;
NetHandle g_nextHandle = 100;
std::deque<NetEvent> g_events;
std::deque<std::string> g_eventData;  // keeps event payloads alive
std::map<NetHandle, std::string> g_sent;
std::map<NetHandle, bool> g_closed;

ModResult fake_listen(ModContext*, const NetListenDesc*, NetHandle* out, NetEndpoint* local, NetError* err) {
    *out = kListener;
    std::snprintf(local->text, sizeof(local->text), "tcp://127.0.0.1:38100");
    *err = NET_ERROR_NONE;
    return MOD_OK;
}
ModResult fake_poll(ModContext*, NetEvent* out) {
    if (g_events.empty()) {
        *out = NET_EVENT_INIT;
        return MOD_OK;
    }
    *out = g_events.front();
    g_events.pop_front();
    return MOD_OK;
}
ModResult fake_send(ModContext*, NetHandle h, const void* data, size_t size) {
    g_sent[h].append(static_cast<const char*>(data), size);
    return MOD_OK;
}
ModResult fake_close(ModContext*, NetHandle h) {
    g_closed[h] = true;
    return MOD_OK;
}

NetService g_net = [] {
    NetService s{};
    s.listen = fake_listen;
    s.poll_event = fake_poll;
    s.send = fake_send;
    s.close = fake_close;
    return s;
}();

// ---- Fake ResourceService / LogService ----

ModResult fake_load(ModContext*, const char* path, ResourceBuffer* out) {
    static std::string index = "<!doctype html><title>t</title>";
    if (std::strcmp(path, "web/index.html") != 0) return MOD_UNAVAILABLE;
    out->data = index.data();
    out->size = index.size();
    return MOD_OK;
}
void fake_free(ModContext*, ResourceBuffer*) {}
ResourceService g_res = [] {
    ResourceService s{};
    s.load = fake_load;
    s.free = fake_free;
    return s;
}();

void fake_log(ModContext*, LogLevel, const char*) {}
void fake_log1(ModContext*, const char*) {}
LogService g_log = [] {
    LogService s{};
    s.write = fake_log;
    s.trace = s.debug = s.info = s.warn = s.error = fake_log1;
    return s;
}();

// ---- Helpers ----

NetHandle connect_client() {
    NetEvent e = NET_EVENT_INIT;
    e.type = NET_EVENT_ACCEPTED;
    e.handle = kListener;
    e.accepted = ++g_nextHandle;
    g_events.push_back(e);
    tracker::web::poll();
    return e.accepted;
}

void send_data(NetHandle h, const std::string& data) {
    g_eventData.push_back(data);
    NetEvent e = NET_EVENT_INIT;
    e.type = NET_EVENT_STREAM_DATA;
    e.handle = h;
    e.data = g_eventData.back().data();
    e.size = g_eventData.back().size();
    g_events.push_back(e);
    tracker::web::poll();
}

// Sends a request in chunks of `chunk` bytes and returns the raw response.
std::string request(const std::string& raw, size_t chunk = 1 << 30) {
    const NetHandle h = connect_client();
    for (size_t i = 0; i < raw.size(); i += chunk) {
        send_data(h, raw.substr(i, chunk));
    }
    return g_sent[h];
}

std::string http(const std::string& method, const std::string& path, const std::string& body = "",
    const std::string& extraHeaders = "", const std::string& host = "127.0.0.1:38100") {
    std::string r = method + " " + path + " HTTP/1.1\r\nHost: " + host + "\r\n" + extraHeaders;
    if (!body.empty() || method == "POST") {
        r += "Content-Length: " + std::to_string(body.size()) + "\r\n";
    }
    return r + "\r\n" + body;
}

int g_failures = 0;
void check(bool ok, const char* what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) ++g_failures;
}
bool status_is(const std::string& response, const char* status) {
    return response.rfind(std::string{"HTTP/1.1 "} + status, 0) == 0;
}

}  // namespace

int main() {
    svc_net = &g_net;
    svc_resource = &g_res;
    svc_log = &g_log;

    const auto dir = std::filesystem::temp_directory_path() / "shadowq_web_server_test";
    std::filesystem::remove_all(dir);
    std::filesystem::create_directories(dir);
    tracker::web::set_data_dir(dir.string());
    check(tracker::web::start(38100), "server starts");

    const std::string json = "Content-Type: application/json\r\n";
    const std::string own = "Origin: http://127.0.0.1:38100\r\n";

    // Static page and access checks
    check(status_is(request(http("GET", "/")), "200"), "GET / serves index.html");
    check(status_is(request(http("GET", "/", "", "", "evil.example")), "403"), "foreign Host is rejected");
    check(status_is(request(http("GET", "/layout")), "404"), "no layout before saving");

    // Layout: body split across chunks
    const std::string layout = R"({"version":1,"sections":[]})";
    check(status_is(request(http("POST", "/layout", layout, json + own), 7), "200"), "POST /layout in 7-byte chunks");
    const std::string got = request(http("GET", "/layout"));
    check(status_is(got, "200") && got.ends_with(layout), "GET /layout returns the saved JSON");
    check(status_is(request(http("POST", "/layout", layout, json + "Origin: http://evil.example\r\n")), "403"),
        "cross-site layout write is rejected");
    check(status_is(request(http("POST", "/layout", layout, "Content-Type: text/plain\r\n" + own)), "403"),
        "non-JSON layout write is rejected");
    check(status_is(request(http("POST", "/layout", "not json", json + own)), "400"), "invalid layout body is rejected");

    // Settings change notifies open event streams
    const NetHandle stream = connect_client();
    send_data(stream, http("GET", "/events"));
    check(g_sent[stream].find("event: state") != std::string::npos, "event stream gets the state");
    check(status_is(request(http("POST", "/settings", R"({"theme":"midna"})", json + own)), "200"), "POST /settings");
    check(g_sent[stream].find("event: config") != std::string::npos, "settings change broadcasts a config event");
    check(!g_closed[stream], "event stream stays open");
    std::string rules = R"({"logicOverrides":{"a":[[{"item":")";
    rules += std::string(400 * 1024, 'x') + R"(","n":1}]]}})";
    check(status_is(request(http("POST", "/settings", rules, json + own), 64 * 1024), "200"),
        "POST /settings with 400 KiB of location rules");
    check(request(http("GET", "/settings")).ends_with(rules), "GET /settings returns the large settings");

    // Background image: 1 MiB PNG in 64 KiB chunks
    std::string png = "\x89PNG\r\n\x1a\n";
    png.resize(1 << 20, 'x');
    check(status_is(request(http("POST", "/background", png, "Content-Type: image/png\r\n" + own), 64 * 1024), "200"),
        "POST /background (1 MiB in chunks)");
    const std::string bg = request(http("GET", "/background"));
    check(status_is(bg, "200") && bg.find("Content-Type: image/png") != std::string::npos && bg.ends_with(png),
        "GET /background returns the image");
    check(status_is(request(http("POST", "/background", "hello", "Content-Type: image/png\r\n" + own)), "415"),
        "non-image upload is rejected");
    check(status_is(request("POST /background HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: image/png\r\n"
                            "Content-Length: 99999999\r\n\r\n"), "413"),
        "oversized upload is rejected before the body arrives");
    check(status_is(request(http("DELETE", "/background", "", own)), "200"), "DELETE /background");
    check(status_is(request(http("GET", "/background")), "404"), "background is gone after delete");

    // Randomizer data files: only resolver-approved paths are served (spaces are %20-encoded)
    std::filesystem::create_directories(dir / "rando" / "world" / "dungeons");
    { std::ofstream(dir / "rando" / "world" / "dungeons" / "Forest Temple.yaml") << "- Name: X\n"; }
    { std::ofstream(dir / "rando-settings.yaml") << "Logic Rules: Glitchless\n"; }
    static std::filesystem::path s_randoDir;
    s_randoDir = dir / "rando";
    // Custom icons: uploaded on the page, stored under the icon's name
    tracker::web::set_icon_dir((dir / "icons").string());
    const std::string icon = std::string("\x89PNG\r\n\x1a\n") + "icon";
    check(status_is(request(http("POST", "/icons/Auru's_Memo.png", icon, "Content-Type: image/png\r\n" + own)), "200"),
        "POST /icons/<name>.png");
    const std::string gotIcon = request(http("GET", "/icons/Auru's_Memo.png"));
    check(status_is(gotIcon, "200") && gotIcon.ends_with(icon), "GET the uploaded icon");
    check(status_is(request(http("POST", "/icons/X.png", icon, "Content-Type: image/png\r\nOrigin: http://evil.example\r\n")), "403"),
        "cross-site icon upload is rejected");
    check(status_is(request(http("POST", "/icons/X.png", "text", "Content-Type: image/png\r\n" + own)), "415"),
        "non-image icon upload is rejected");
    check(status_is(request(http("POST", "/icons/..%2Fsettings.json", icon, "Content-Type: image/png\r\n" + own)), "404"),
        "icon names cannot leave the icon folder");
    check(status_is(request(http("DELETE", "/icons/Auru's_Memo.png", "", own)), "200"), "DELETE /icons/<name>.png");
    check(status_is(request(http("GET", "/icons/Auru's_Memo.png")), "404"), "icon is gone after delete");

    // Game textures: list and single texture, with archive and name validation
    check(status_is(request(http("GET", "/game-textures/itemicon/")), "404"), "no textures without a provider");
    tracker::web::set_game_textures(
        [](const std::string& a) { return a == "itemicon" ? std::string{"[\"a.bti\"]"} : std::string{}; },
        [](const std::string& a, const std::string& n) { return a == "itemicon" && (n == "a.bti" || n == "#61") ? "\x89PNG-" + n : std::string{}; });
    const std::string list = request(http("GET", "/game-textures/itemicon/"));
    check(status_is(list, "200") && list.ends_with("[\"a.bti\"]"), "GET /game-textures/<archive>/ lists textures");
    check(request(http("GET", "/game-textures/itemicon/a.bti.png")).ends_with("\x89PNG-a.bti"), "GET a texture by name");
    check(request(http("GET", "/game-textures/itemicon/%2361.png")).ends_with("\x89PNG-#61"), "GET a texture by index");
    check(status_is(request(http("GET", "/game-textures/other/")), "404"), "unknown archive is 404");
    check(status_is(request(http("GET", "/game-textures/itemicon/..%2Fx.png")), "404"), "bad texture name is rejected");

    // Game icons: only numeric item names reach the provider
    check(status_is(request(http("GET", "/game-icons/72.png")), "404"), "no game icons without a provider");
    tracker::web::set_game_icons([](int itemNo) { return itemNo == 72 ? std::string{"\x89PNG-lantern"} : std::string{}; });
    const std::string lantern = request(http("GET", "/game-icons/72.png"));
    check(status_is(lantern, "200") && lantern.ends_with("\x89PNG-lantern"), "GET /game-icons/<n>.png");
    check(status_is(request(http("GET", "/game-icons/73.png")), "404"), "missing game icon is 404");
    check(status_is(request(http("GET", "/game-icons/..%2F72.png")), "404"), "non-numeric game icon name is rejected");

    tracker::web::set_rando_files(
        [](const std::string& rel) -> std::string {
            return rel == "world/dungeons/Forest Temple.yaml" ? (s_randoDir / rel).string() : "";
        },
        (dir / "rando-settings.yaml").string());
    const std::string ft = request(http("GET", "/rando/world/dungeons/Forest%20Temple.yaml"));
    check(status_is(ft, "200") && ft.ends_with("- Name: X\n"), "GET /rando/<path> with %20");
    check(status_is(request(http("GET", "/rando/../layout.json")), "404"), "unknown rando path is rejected");
    check(status_is(request(http("GET", "/rando-settings.yaml")), "200"), "GET /rando-settings.yaml");

    tracker::web::stop();
    std::filesystem::remove_all(dir);
    std::printf("%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
