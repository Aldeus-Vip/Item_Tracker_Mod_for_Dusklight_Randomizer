// Host-side test for src/rando_data.cpp: downloads go through a fake HttpService that enforces
// Dusklight's limit of 16 concurrent requests per mod, and completes them one at a time.
// Build and run with tests/run.sh.

#include "../src/rando_data.hpp"

#include <mods/service.hpp>
#include <mods/svc/http.h>
#include <mods/svc/log.h>

#include <cstdio>
#include <deque>
#include <filesystem>
#include <fstream>
#include <string>

extern "C" {
ModContext* mod_ctx = nullptr;
const HttpService* svc_http = nullptr;
const LogService* svc_log = nullptr;
}

namespace {

constexpr size_t kHostLimit = 16;  // MaxRequestsPerMod in Dusklight's http.cpp

struct InFlight {
    HttpRequestHandle handle;
    HttpCompleteFn fn;
    void* userData;
    std::string downloadPath;
    std::string url;
};
std::deque<InFlight> g_inFlight;
HttpRequestHandle g_next = 1;
size_t g_peak = 0;
int g_rejected = 0;

ModResult fake_request(ModContext*, const HttpRequestDesc* desc, HttpCompleteFn fn, void* userData,
    HttpRequestHandle* out) {
    if (g_inFlight.size() >= kHostLimit) {
        ++g_rejected;
        return MOD_CONFLICT;
    }
    *out = g_next++;
    g_inFlight.push_back({*out, fn, userData, desc->download_path ? desc->download_path : "", desc->url});
    g_peak = std::max(g_peak, g_inFlight.size());
    return MOD_OK;
}
ModResult fake_progress(ModContext*, HttpRequestHandle, HttpProgress*) { return MOD_OK; }
ModResult fake_cancel(ModContext*, HttpRequestHandle) { return MOD_OK; }

HttpService g_http = [] {
    HttpService s{};
    s.request = fake_request;
    s.progress = fake_progress;
    s.cancel = fake_cancel;
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

// Completes the oldest request: writes the download file and reports HTTP 200.
void complete_one() {
    InFlight r = g_inFlight.front();
    g_inFlight.pop_front();
    std::ofstream(r.downloadPath) << "# " << r.url << "\n";
    HttpResult result{};
    result.struct_size = sizeof(result);
    result.error = HTTP_ERROR_NONE;
    result.error_message = "";
    result.status_code = 200;
    result.download_path = r.downloadPath.c_str();
    r.fn(mod_ctx, r.handle, &result, r.userData);
}

int g_failures = 0;
void check(bool ok, const std::string& what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what.c_str());
    if (!ok) ++g_failures;
}

}  // namespace

int main() {
    svc_http = &g_http;
    svc_log = &g_log;
    const auto dir = std::filesystem::temp_directory_path() / "shadowq_rando_data_test" / "mod";
    std::filesystem::remove_all(dir.parent_path());
    std::filesystem::create_directories(dir);

    tracker::rando::init(dir.string());
    tracker::rando::download("main", /*force=*/false);
    check(!g_inFlight.empty() && g_inFlight.size() <= 4, "at most 4 downloads start at once");

    while (!g_inFlight.empty()) complete_one();
    check(g_rejected == 0, "no request is rejected by the host limit");
    check(g_peak <= 4, "never more than 4 requests in flight (peak " + std::to_string(g_peak) + ")");
    check(tracker::rando::status() == "Logic data ready", "status: " + tracker::rando::status());

    const std::string tot = tracker::rando::data_file("world/dungeons/Temple of Time.yaml");
    check(!tot.empty() && std::filesystem::exists(tot), "Temple of Time.yaml downloaded");
    std::ifstream in(tot);
    std::string line;
    std::getline(in, line);
    check(line.find("Temple%20of%20Time.yaml") != std::string::npos, "URL encodes spaces: " + line);
    check(tracker::rando::data_file("../secret").empty(), "unknown paths do not resolve");

    // A forced update re-downloads everything, still within the limit.
    tracker::rando::download("main", /*force=*/true);
    while (!g_inFlight.empty()) complete_one();
    check(g_rejected == 0 && g_peak <= 4, "forced update stays within the limit");

    std::filesystem::remove_all(dir.parent_path());
    std::printf("%s (%d failure%s)\n", g_failures ? "FAILED" : "PASSED", g_failures, g_failures == 1 ? "" : "s");
    return g_failures ? 1 : 0;
}
