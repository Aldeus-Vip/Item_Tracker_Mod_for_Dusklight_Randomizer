#include "found_checks.hpp"

#include "json_writer.hpp"
#include "tracker_state.hpp"

#include <mods/svc/hook.hpp>
#include <mods/items.h>
#include <mods/svc/item.h>
#include <mods/svc/log.hpp>
#include <mods/svc/save.h>

#include "JSystem/JMessage/control.h"
#include "d/d_bg_s_lin_chk.h"
#include "d/d_com_inf_game.h"
#include "f_op/f_op_actor_mng.h"
#include "f_op/f_op_camera_mng.h"

#include <cstdio>
#include <cstring>
#include <set>
#include <string>
#include <string_view>
#include <vector>

namespace tracker::found {
namespace {

// Save blob: "seed\t<hash>\n" then one entry per line.
constexpr const char* kBlobName = "found";
constexpr size_t kMaxEntries = 3000;
constexpr size_t kMaxEntryBytes = 600;
// A freestanding item counts as seen once Link is this close (game units, about centimeters) and it
// is in sight.
constexpr float kSeeDistance = 3000.0f;

std::string g_watchDebug = "[]";  // the items being watched and why they are not seen yet
std::set<std::string> g_entries;  // known now (saved + learned since the last save)
std::string g_seed;               // seed hash the page is showing for this save

// Freestanding item checks whose actor exists in the current stage, not yet seen.
struct Watched {
    std::string check;
    fpc_ProcID actor;
    uint8_t vanillaItem;
};
std::vector<Watched> g_watched;
std::string g_watchedStage;

void add(std::string entry) {
    if (entry.empty() || entry.size() > kMaxEntryBytes || g_entries.size() >= kMaxEntries) return;
    g_entries.insert(std::move(entry));
}

// Removes every entry that is `key` or starts with `key` + tab (an entry with a value).
void remove(const std::string& key) {
    std::erase_if(g_entries, [&](const std::string& e) {
        return e == key || (e.size() > key.size() && e.starts_with(key) && e[key.size()] == '\t');
    });
}

// "check:<name>" entries also carry the item the check looks like ("\t<hex item>"), which is not
// the item for foolish items (they look like a real item) and keys (all small keys look alike).
bool has_check(const std::string& name) {
    const std::string key = "check:" + name;
    const auto it = g_entries.lower_bound(key);
    return it != g_entries.end() && (*it == key || (it->starts_with(key) && (*it)[key.size()] == '\t'));
}

// ---- Save data ----

void clear() {
    g_entries.clear();
    g_seed.clear();
    g_watched.clear();
}

void load_blob() {
    clear();
    size_t size = 0;
    if (svc_save->get_blob(mod_ctx, kBlobName, nullptr, &size) != MOD_OK || size == 0) return;
    std::string text(size, '\0');
    if (svc_save->get_blob(mod_ctx, kBlobName, text.data(), &size) != MOD_OK) return;
    text.resize(size);
    size_t pos = 0;
    while (pos < text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string::npos) end = text.size();
        std::string line = text.substr(pos, end - pos);
        pos = end + 1;
        if (line.starts_with("seed\t")) g_seed = line.substr(5);
        else add(std::move(line));
    }
}

void write_blob() {
    std::string text = "seed\t" + g_seed + "\n";
    for (const std::string& e : g_entries) text += e + "\n";
    if (svc_save->set_blob(mod_ctx, kBlobName, text.data(), text.size()) != MOD_OK) {
        mods::log::warn("found checks: could not store {} entries with the save", g_entries.size());
    }
}

// Loading a save shows what was known when it was saved; learning since then is dropped.
void on_save_loaded(ModContext*, uint32_t, void*) { load_blob(); }
void on_new_save(ModContext*, uint32_t, void*) { clear(); }
// Runs before this mod's save data is flushed with the game save.
void on_save_written(ModContext*, uint32_t, void*) { write_blob(); }

// ---- Freestanding items ----

// Watches every item check as it is resolved (never changes the result): an item actor lying in
// the world resolves its check when it is created, which is when it can first be seen.
bool on_check_resolved(ModContext*, const ItemCheckInfo* info, ItemCheckResolution*, void*) {
    if (info == nullptr || info->name == nullptr || info->giver_actor == nullptr) return false;
    const std::string_view name{info->name};
    if (!name.starts_with(ITEM_CHECK_FREESTANDING_PREFIX) && !name.starts_with(ITEM_CHECK_BOSS_PREFIX)) return false;
    if (has_check(std::string{name})) return false;
    const fpc_ProcID id = fopAcM_GetID(info->giver_actor);
    for (const Watched& w : g_watched) {
        if (w.actor == id) return false;
    }
    g_watched.push_back({std::string{name}, id, info->vanilla_item});
    return false;
}

// True when level or object collision lies between the two points.
bool blocked(cXyz from, cXyz to, fopAc_ac_c* self) {
    dBgS_LinChk line;
    line.Set(&from, &to, self);
    return dComIfG_Bgsp().LineCross(&line);
}

// "\t<hex>" with the item the check is drawn as, when the item service can tell.
std::string display_suffix(const Watched& w) {
    if (!SERVICE_HAS(svc_item, ItemService, resolve_check_full)) return "";
    ItemCheckResolution res{};
    res.display_item = 0xFF;
    if (svc_item->resolve_check_full(mod_ctx, w.check.c_str(), w.vanillaItem, &res) != MOD_OK) return "";
    const uint8_t shown = res.display_item != 0xFF ? res.display_item : res.item;
    char hex[8];
    std::snprintf(hex, sizeof hex, "\t%02x", shown);
    return hex;
}

void check_watched() {
    // A new stage: forget the last one's items (the stage name changes before the new stage's
    // items are created, so they are kept).
    const char* stage = dComIfGp_getStartStageName();
    if (stage == nullptr || g_watchedStage != stage) {
        g_watched.clear();
        g_watchedStage = stage != nullptr ? stage : "";
        return;
    }
    // Loading, leaving the stage or resetting: Link may be gone. The watched items are kept and
    // looked up by id, which is safe.
    if (!tracker::is_playing()) return;
    fopAc_ac_c* link = dComIfGp_getPlayer(0);
    if (link == nullptr || g_watched.empty()) return;
    camera_process_class* camera = dComIfGp_getCamera(0);
    const cXyz cameraEye = camera != nullptr ? cXyz(camera->view.lookat.eye) : cXyz(link->eyePos);
    const cXyz cameraAt = camera != nullptr ? cXyz(camera->view.lookat.center) : cXyz(link->eyePos);
    tracker::JsonWriter debug;
    debug.beginArray();
    std::erase_if(g_watched, [&](const Watched& w) {
        fopAc_ac_c* actor = fopAcM_SearchByID(w.actor);
        if (actor == nullptr) return true;  // collected or unloaded
        const f32 distance = fopAcM_searchActorDistance(actor, link);
        const cXyz base = actor->current.pos;
        // Seen means on the screen: in front of the camera, within its view, and with a clear line
        // from the camera to the item (hidden under a boulder or behind a wall: not seen yet). The
        // camera, not Link's eyes: standing at the foot of a cliff, Link cannot see over its edge
        // but the camera above him shows the golden bug on the tree behind it.
        // A few points on the item: a little above it, higher up, and drawn toward the camera (an
        // item on a tree trunk or a wall sits in its surface, where a line to its center stops
        // short).
        auto toward = [&base](const cXyz& eye, f32 by) {
            cXyz d = eye - base;
            const f32 len = d.abs();
            if (len > 1.0f) d *= by / len;
            return base + d;
        };
        cXyz look = cameraAt - cameraEye;
        cXyz to = base - cameraEye;
        const f32 lookLen = look.abs();
        const f32 toLen = to.abs();
        // Within about 50 degrees of where the camera looks.
        const bool inView = camera == nullptr || lookLen < 1.0f || toLen < 1.0f ||
                            (look.x * to.x + look.y * to.y + look.z * to.z) / (lookLen * toLen) > 0.64f;
        const cXyz probes[] = {base + cXyz(0.0f, 20.0f, 0.0f), base + cXyz(0.0f, 50.0f, 0.0f),
                               toward(cameraEye, 40.0f), toward(cameraEye, 90.0f) + cXyz(0.0f, 20.0f, 0.0f)};
        std::string clear;
        bool seen = false;
        for (const cXyz& target : probes) {
            const bool ok = !blocked(cameraEye, target, link);
            clear += ok ? '1' : '0';
            seen = seen || ok;
        }
        seen = seen && inView && distance <= kSeeDistance;
        debug.beginObject();
        debug.member("check", w.check);
        debug.member("distance", static_cast<int>(distance));
        debug.member("inView", inView);
        debug.member("clear", clear);
        debug.member("seen", seen);
        debug.endObject();
        if (!seen) return false;
        add("check:" + w.check + display_suffix(w));
        return true;
    });
    debug.endArray();
    g_watchDebug = debug.str();
}

}  // namespace

const std::string& watch_debug() { return g_watchDebug; }

namespace {

// ---- Hints ----

// Decodes a message's text (single-byte, with 0x1A control codes) and returns the parts drawn in
// red, which is how the randomizer marks the location in a hint. Only "They say that ..." hints
// are read.
std::vector<std::string> red_parts(const char* text) {
    std::vector<std::string> parts;
    std::string plain;
    std::string current;
    bool red = false;
    const auto finish = [&] {
        while (!current.empty() && current.back() == ' ') current.pop_back();
        if (!current.empty()) parts.push_back(current);
        current.clear();
    };
    for (size_t i = 0; text[i] != '\0' && i < 4096;) {
        const auto c = static_cast<unsigned char>(text[i]);
        if (c == 0x1A) {
            const auto length = static_cast<unsigned char>(text[i + 1]);
            if (length < 2) break;
            // Text color: 1A 06 FF 00 00 <color>, red = 1.
            if (length == 6 && static_cast<unsigned char>(text[i + 2]) == 0xFF && text[i + 3] == 0 && text[i + 4] == 0) {
                const bool nowRed = text[i + 5] == 1;
                if (red && !nowRed) finish();
                red = nowRed;
            }
            i += length;
            continue;
        }
        char out = c == '\n' ? ' ' : static_cast<char>(c);
        std::string utf8;
        if (c >= 0x80) {  // Windows-1252 letters as UTF-8
            utf8 += static_cast<char>(0xC0 | (c >> 6));
            utf8 += static_cast<char>(0x80 | (c & 0x3F));
        } else {
            utf8 += out;
        }
        plain += utf8;
        if (red && !(current.empty() && out == ' ')) current += utf8;
        ++i;
    }
    finish();
    if (plain.find("They say that") == std::string::npos) parts.clear();
    return parts;
}

DEFINE_HOOK(&JMessage::TControl::setMessageCode_inSequence_, MessageSet);

void on_message_set(ModContext*, void* args, void* retval, void*) {
    if (retval == nullptr || !*static_cast<bool*>(retval)) return;
    const auto* control = mods::arg<JMessage::TControl*>(args, 0);
    const char* text = control != nullptr ? control->getMessageText_begin() : nullptr;
    if (text == nullptr) return;
    for (std::string& part : red_parts(text)) {
        if (part.starts_with("the ")) part.erase(0, 4);
        add("hint:" + part);
    }
}

}  // namespace

void init() {
    if (svc_save != nullptr) {
        svc_save->observe_saves(mod_ctx, on_new_save, on_save_loaded, on_save_written, nullptr, nullptr);
    }
    if (svc_item != nullptr) {
        svc_item->set_check_resolver(mod_ctx, nullptr, on_check_resolved, nullptr, nullptr);
    }
    if (mods::hook::add_post<MessageSet>(on_message_set) != MOD_OK) {
        mods::log::warn("found checks: message hook unavailable; hints are not tracked");
    }
}

void update() { check_watched(); }

void add_from_page(const std::string& body) {
    size_t pos = 0;
    bool first = true;
    while (pos < body.size()) {
        size_t end = body.find('\n', pos);
        if (end == std::string::npos) end = body.size();
        std::string line = body.substr(pos, end - pos);
        pos = end + 1;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (first && line.starts_with("seed\t")) {
            std::string seed = line.substr(5);
            if (seed.size() <= 100) g_seed = std::move(seed);
        } else if (line.starts_with("-")) {
            // Removal: "-<kind>:<key>" (map, mark and note entries are the page's to change).
            const std::string key = line.substr(1);
            if (key.starts_with("map:") || key.starts_with("mark:") || key.starts_with("note:")) remove(key);
        } else if (line.starts_with("loc:") || line.starts_with("told:") || line.starts_with("map:") ||
                   line.starts_with("mark:")) {
            add(std::move(line));
        } else if (line.starts_with("note:")) {
            // "note:<key>\t<text>" replaces the note of that key.
            const size_t tab = line.find('\t');
            if (tab != std::string::npos) {
                remove(line.substr(0, tab));
                if (tab + 1 < line.size()) add(std::move(line));
            }
        }
        first = false;
    }
}

void write_json(tracker::JsonWriter& w) {
    w.key("found").beginObject();
    w.member("seed", g_seed);
    w.key("entries").beginArray();
    for (const std::string& e : g_entries) w.value(e);
    w.endArray();
    w.endObject();
}


}  // namespace tracker::found
