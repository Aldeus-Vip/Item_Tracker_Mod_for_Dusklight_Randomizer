#include "mods/service.hpp"
#include "mods/svc/config.h"
#include "mods/svc/host.h"
#include "mods/svc/http.hpp"
#include "mods/svc/item.h"
#include "mods/svc/log.hpp"
#include "mods/svc/net.hpp"
#include "mods/svc/resource.h"
#include "mods/svc/ui.h"

#include "game_icons.hpp"
#include "game_textures.hpp"
#include "rando_data.hpp"
#include "tracker_state.hpp"
#include "web_server.hpp"

#include <filesystem>
#include <string>

DEFINE_MOD();

IMPORT_SERVICE(LogService, svc_log);
IMPORT_SERVICE(NetService, svc_net);
IMPORT_SERVICE(ResourceService, svc_resource);
IMPORT_SERVICE(ConfigService, svc_config);
IMPORT_SERVICE(UiService, svc_ui);
IMPORT_SERVICE(HostService, svc_host);
IMPORT_SERVICE(HttpService, svc_http);
IMPORT_OPTIONAL_SERVICE(ItemService, svc_item);

namespace {

constexpr int64_t kDefaultPort = 38100;
// Save data is re-read on this interval; an item grant forces an earlier read.
constexpr int kPollIntervalFrames = 15;
constexpr int kKeepaliveIntervalFrames = 60 * 15;

ConfigVarHandle g_portVar = 0;
ConfigVarHandle g_logicRefVar = 0;
UiElementHandle g_logicStatusText = 0;
ItemGiveHandle g_giveObserver = 0;
UiElementHandle g_statusText = 0;
UiElementHandle g_urlText = 0;
std::string g_portText;  // backing string for the port input

std::string g_iconDir;
std::string g_lastState;
int g_framesUntilPoll = 0;
int g_framesUntilKeepalive = kKeepaliveIntervalFrames;
bool g_restartServer = false;

int configured_port() {
    int64_t port = kDefaultPort;
    svc_config->get_int(mod_ctx, g_portVar, &port);
    if (port < 1024 || port > 65535) {
        port = kDefaultPort;
    }
    return static_cast<int>(port);
}

std::string tracker_url() {
    return "http://127.0.0.1:" + std::to_string(configured_port()) + "/";
}

std::string status_text() {
    if (!tracker::web::running()) {
        return "Server stopped (port " + std::to_string(configured_port()) + " unavailable?)";
    }
    return "Running - " + std::to_string(tracker::web::stream_count()) + " tracker page(s) connected";
}

void on_item_given(ModContext*, const ItemGiveInfo*, void*) {
    // Inventory changes are applied right after the grant; re-read on the next frame.
    g_framesUntilPoll = 1;
}

void on_port_changed(ModContext*, ConfigVarHandle, const ConfigVarValue*, const ConfigVarValue*, void*) {
    g_restartServer = true;
}

void copy_url(ModContext*, void*) {
    svc_ui->set_clipboard_text(mod_ctx, tracker_url().c_str());
}

// Branch, tag or commit of TwilitRealm/dusklight-randomizer to take the logic data from.
std::string logic_data_ref() {
    char buf[128] = {};
    size_t length = 0;
    svc_config->get_string(mod_ctx, g_logicRefVar, buf, sizeof(buf) - 1, &length);
    std::string ref = buf;
    const bool valid = !ref.empty() && ref.find_first_not_of(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-") == std::string::npos;
    return valid ? ref : "main";
}

void update_logic_data(ModContext*, void*) {
    tracker::rando::download(logic_data_ref(), /*force=*/true);
}

// Port input: plain text so the number can be typed; invalid input keeps the current port.
void get_port_text(ModContext*, void*, UiControlValue* out) {
    g_portText = std::to_string(configured_port());
    out->string_value = g_portText.c_str();
}

void set_port_text(ModContext*, void*, const UiControlValue* value) {
    const std::string text = value->string_value ? value->string_value : "";
    if (text.empty() || text.size() > 5 || text.find_first_not_of("0123456789") != std::string::npos) {
        return;
    }
    const int port = std::stoi(text);
    if (port >= 1024 && port <= 65535 && port != configured_port()) {
        svc_config->set_int(mod_ctx, g_portVar, port);
    }
}

// Creates <data dir>/icons, where icons uploaded on the tracker page are stored, and stores the
// page's custom layout next to it (shared by every browser / OBS source).
void init_data_dir() {
    const char* dataDir = nullptr;
    if (svc_host->data_dir(mod_ctx, &dataDir) != MOD_OK || dataDir == nullptr) {
        mods::log::warn("tracker: no data directory; icons and saved layout/theme disabled");
        return;
    }
    tracker::web::set_data_dir(dataDir);
    tracker::rando::init(dataDir);
    tracker::web::set_game_icons(
        [](int itemNo) { return tracker::icons::item_icon_png(static_cast<uint8_t>(itemNo)); });
    tracker::web::set_game_textures(
        [](const std::string& archive) { return tracker::textures::list_json(archive); },
        [](const std::string& archive, const std::string& name) { return tracker::textures::texture_png(archive, name); });
    tracker::web::set_rando_files(
        [](const std::string& relative) { return tracker::rando::data_file(relative); },
        tracker::rando::settings_file());
    // Next to the randomizer's settings.yaml: seeds/<hash>/ with seed.dat and the spoiler log.
    tracker::web::set_seeds_dir(
        (std::filesystem::path{tracker::rando::settings_file()}.parent_path() / "seeds").string());

    const std::filesystem::path dir = std::filesystem::path{dataDir} / "icons";
    std::error_code ec;
    std::filesystem::create_directories(dir, ec);
    if (ec) {
        mods::log::warn("tracker: cannot create icon folder {}: {}", dir.string(), ec.message());
        return;
    }
    g_iconDir = dir.string();
    tracker::web::set_icon_dir(g_iconDir);
    mods::log::info("tracker: icon folder {}", g_iconDir);
}

ModResult build_panel(ModContext*, UiElementHandle panel, void*, ModError*) {
    svc_ui->pane_add_section(mod_ctx, panel, "Item Tracker");
    svc_ui->pane_add_text(mod_ctx, panel,
        "Open the tracker page in a web browser or an OBS Browser Source. "
        "No separate application is needed.", nullptr);
    svc_ui->pane_add_text(mod_ctx, panel, tracker_url().c_str(), &g_urlText);

    UiControlDesc port = UI_CONTROL_DESC_INIT;
    port.kind = UI_CONTROL_STRING;
    port.label = "Port";
    port.binding = UI_BINDING_CALLBACKS;
    port.get = get_port_text;
    port.set = set_port_text;
    port.max_length = 5;
    port.tooltip = "1024-65535. The server restarts on the new port.";
    svc_ui->pane_add_control(mod_ctx, panel, &port, nullptr);

    UiControlDesc copy = UI_CONTROL_DESC_INIT;
    copy.kind = UI_CONTROL_BUTTON;
    copy.label = "Copy tracker URL";
    copy.on_pressed = copy_url;
    svc_ui->pane_add_control(mod_ctx, panel, &copy, nullptr);

    svc_ui->pane_add_text(mod_ctx, panel,
        "Item icons are built from your game data. Right-click an icon on the tracker page to "
        "use your own image instead.", nullptr);

    svc_ui->pane_add_section(mod_ctx, panel, "Location tracker");
    svc_ui->pane_add_text(mod_ctx, panel,
        "Check lists and logic are downloaded from the randomizer's public repository "
        "(TwilitRealm/dusklight-randomizer) and stored locally.", nullptr);
    svc_ui->pane_add_text(mod_ctx, panel, tracker::rando::status().c_str(), &g_logicStatusText);
    UiControlDesc refresh = UI_CONTROL_DESC_INIT;
    refresh.kind = UI_CONTROL_BUTTON;
    refresh.label = "Update logic data";
    refresh.on_pressed = update_logic_data;
    svc_ui->pane_add_control(mod_ctx, panel, &refresh, nullptr);
    UiControlDesc ref = UI_CONTROL_DESC_INIT;
    ref.kind = UI_CONTROL_STRING;
    ref.label = "Logic data version (branch or commit)";
    ref.binding = UI_BINDING_CONFIG_VAR;
    ref.config_var = g_logicRefVar;
    ref.max_length = 64;
    svc_ui->pane_add_control(mod_ctx, panel, &ref, nullptr);

    svc_ui->pane_add_section(mod_ctx, panel, "Status");
    svc_ui->pane_add_text(mod_ctx, panel, status_text().c_str(), &g_statusText);

    return MOD_OK;
}

ModResult update_panel(ModContext*, void*, ModError*) {
    if (g_urlText != 0) {
        svc_ui->elem_set_text(mod_ctx, g_urlText, tracker_url().c_str());
    }
    if (g_statusText != 0) {
        svc_ui->elem_set_text(mod_ctx, g_statusText, status_text().c_str());
    }
    if (g_logicStatusText != 0) {
        svc_ui->elem_set_text(mod_ctx, g_logicStatusText, tracker::rando::status().c_str());
    }
    return MOD_OK;
}

}  // namespace

extern "C" {
MOD_EXPORT ModResult mod_initialize(ModError* error) {
    ConfigVarDesc portDesc = CONFIG_VAR_DESC_INIT;
    portDesc.name = "port";
    portDesc.type = CONFIG_VAR_INT;
    portDesc.default_int = kDefaultPort;
    if (svc_config->register_var(mod_ctx, &portDesc, &g_portVar) != MOD_OK) {
        return mods::set_error(error, MOD_ERROR, "failed to register the port setting");
    }
    svc_config->subscribe(mod_ctx, g_portVar, on_port_changed, nullptr, nullptr);

    if (svc_item != nullptr) {
        svc_item->observe_gives(mod_ctx, on_item_given, nullptr, &g_giveObserver);
    }

    UiModsPanelDesc panel = UI_MODS_PANEL_DESC_INIT;
    panel.build = build_panel;
    panel.update = update_panel;
    svc_ui->register_mods_panel(mod_ctx, &panel);

    ConfigVarDesc refDesc = CONFIG_VAR_DESC_INIT;
    refDesc.name = "logicDataRef";
    refDesc.type = CONFIG_VAR_STRING;
    refDesc.default_string = "main";
    svc_config->register_var(mod_ctx, &refDesc, &g_logicRefVar);

    init_data_dir();
    tracker::rando::download(logic_data_ref(), /*force=*/false);

    // A busy port is not fatal: the panel reports it and a port change retries.
    tracker::web::start(configured_port());
    return MOD_OK;
}

MOD_EXPORT ModResult mod_update(ModError*) {
    if (g_restartServer) {
        g_restartServer = false;
        tracker::web::start(configured_port());
    }

    tracker::web::poll();

    if (--g_framesUntilPoll <= 0) {
        g_framesUntilPoll = kPollIntervalFrames;
        std::string state = tracker::build_state_json();
        if (state != g_lastState) {
            g_lastState = std::move(state);
            tracker::web::publish_state(g_lastState);
        }
    }

    if (--g_framesUntilKeepalive <= 0) {
        g_framesUntilKeepalive = kKeepaliveIntervalFrames;
        tracker::web::send_keepalive();
    }
    return MOD_OK;
}

MOD_EXPORT ModResult mod_shutdown(ModError*) {
    tracker::web::stop();
    return MOD_OK;
}
}
