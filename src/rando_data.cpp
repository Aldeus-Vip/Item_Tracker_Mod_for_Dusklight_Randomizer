#include "rando_data.hpp"

#include <mods/svc/http.hpp>
#include <mods/svc/log.hpp>

#include <algorithm>
#include <filesystem>
#include <memory>
#include <vector>

namespace tracker::rando {
namespace {

constexpr const char* kRepository = "https://raw.githubusercontent.com/TwilitRealm/dusklight-randomizer/";
constexpr const char* kDataPrefix = "generator/data/";
constexpr size_t kMaxFileBytes = 4 * 1024 * 1024;

// Files the page needs, relative to generator/data/.
constexpr const char* kFiles[] = {
    "locations.yaml",
    "macros.yaml",
    "items.yaml",
    "settings_list.yaml",
    "entrance_shuffle_data.yaml",  // stage/room of each area, to mark the region Link is in
    "object_patches.yaml",         // actors the randomizer adds or changes (where its checks are)
    "world/Root.yaml",
    "world/overworld/Ordona Province.yaml",
    "world/overworld/Faron Province.yaml",
    "world/overworld/Eldin Province.yaml",
    "world/overworld/Lanayru Province.yaml",
    "world/overworld/Gerudo Desert.yaml",
    "world/overworld/Snowpeak Province.yaml",
    "world/dungeons/Forest Temple.yaml",
    "world/dungeons/Goron Mines.yaml",
    "world/dungeons/Lakebed Temple.yaml",
    "world/dungeons/Arbiters Grounds.yaml",
    "world/dungeons/Snowpeak Ruins.yaml",
    "world/dungeons/Temple of Time.yaml",
    "world/dungeons/City in the Sky.yaml",
    "world/dungeons/Palace of Twilight.yaml",
    "world/dungeons/Hyrule Castle.yaml",
};

std::filesystem::path g_dir;           // <data dir>/rando-data
std::filesystem::path g_settingsFile;  // <mod_data>/dev.twilitrealm.randomizer/settings.yaml

std::string url_path(std::string_view path) {
    std::string out;
    for (char c : path) {
        if (c == ' ') out += "%20";
        else out += c;
    }
    return out;
}

// HttpService allows 16 requests per mod at once; stay well below it and queue the rest.
constexpr int kMaxConcurrentDownloads = 4;
std::vector<mods::http::Pending> g_pending;
std::vector<std::string> g_queue;  // files waiting to be requested
std::string g_ref;
int g_active = 0;
int g_failed = 0;
int g_done = 0;

void start_next();

void finish(bool ok) {
    --g_active;
    if (ok) ++g_done;
    else ++g_failed;
    start_next();
}

void start_next() {
    while (g_active < kMaxConcurrentDownloads && !g_queue.empty()) {
        const std::string name = g_queue.front();
        g_queue.erase(g_queue.begin());
        const std::filesystem::path target = g_dir / name;
        std::error_code ec;
        std::filesystem::create_directories(target.parent_path(), ec);
        std::filesystem::path part = target;
        part += ".part";

        mods::http::Request request{
            .url = std::string{kRepository} + g_ref + "/" + kDataPrefix + url_path(name),
            .downloadPath = part.string(),
            .maxBodyBytes = kMaxFileBytes,
        };
        ++g_active;
        g_pending.push_back(mods::http::request(request, [target, part, name](mods::http::Response response) {
            std::error_code err;
            if (!response.ok()) {
                std::filesystem::remove(part, err);
                mods::log::warn("tracker: download of {} failed (HTTP {}, {})", name, response.statusCode,
                    response.errorMessage);
                finish(false);
                return;
            }
            std::filesystem::rename(part, target, err);
            if (err) {
                mods::log::warn("tracker: cannot store {}: {}", name, err.message());
                finish(false);
                return;
            }
            finish(true);
        }));
        if (g_pending.back().result() != MOD_OK) {
            mods::log::warn("tracker: cannot start download of {} ({})", name,
                static_cast<int>(g_pending.back().result()));
            --g_active;
            ++g_failed;
        }
    }
}

bool is_known(std::string_view relative) {
    return std::any_of(std::begin(kFiles), std::end(kFiles), [&](const char* f) { return relative == f; });
}

}  // namespace

void init(const std::string& dataDir) {
    const std::filesystem::path base{dataDir};
    g_dir = base / "rando-data";
    // Every mod's data directory is <config>/mod_data/<mod id>.
    g_settingsFile = base.parent_path() / "dev.twilitrealm.randomizer" / "settings.yaml";
}

void download(const std::string& ref, bool force) {
    if (g_dir.empty() || g_active > 0 || !g_queue.empty()) {
        return;  // No data directory, or a download is already in progress.
    }
    // Drop finished requests from an earlier run.
    std::erase_if(g_pending, [](const mods::http::Pending& p) { return !p; });
    g_ref = ref;
    g_failed = 0;
    g_done = 0;
    for (const char* file : kFiles) {
        std::error_code ec;
        if (!force && std::filesystem::exists(g_dir / file, ec)) {
            ++g_done;
        } else {
            g_queue.emplace_back(file);
        }
    }
    start_next();
}

std::string status() {
    const int total = static_cast<int>(std::size(kFiles));
    if (g_dir.empty()) {
        return "Logic data unavailable (no data directory)";
    }
    if (g_done == total) {
        return "Logic data ready";
    }
    if (g_failed > 0 && g_done + g_failed == total) {
        return "Logic data: " + std::to_string(g_failed) + " file(s) failed to download";
    }
    return "Downloading logic data (" + std::to_string(g_done) + "/" + std::to_string(total) + ")";
}

std::string data_file(const std::string& relative) {
    if (g_dir.empty() || !is_known(relative)) {
        return {};
    }
    return (g_dir / relative).string();
}

std::string settings_file() {
    return g_settingsFile.string();
}

}  // namespace tracker::rando
