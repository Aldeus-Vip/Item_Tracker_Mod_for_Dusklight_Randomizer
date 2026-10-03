#pragma once

#include <cstdint>
#include <cstdio>
#include <string>
#include <string_view>

namespace tracker {

// Minimal streaming JSON writer. Callers are responsible for well-formed nesting;
// commas between members/elements are inserted automatically.
class JsonWriter {
public:
    const std::string& str() const { return mOut; }

    JsonWriter& beginObject() { value_prefix(); mOut += '{'; mFirst = true; return *this; }
    JsonWriter& endObject() { mOut += '}'; mFirst = false; return *this; }
    JsonWriter& beginArray() { value_prefix(); mOut += '['; mFirst = true; return *this; }
    JsonWriter& endArray() { mOut += ']'; mFirst = false; return *this; }

    JsonWriter& key(std::string_view name) {
        if (!mFirst) {
            mOut += ',';
        }
        write_string(name);
        mOut += ':';
        mAfterKey = true;
        return *this;
    }

    JsonWriter& value(std::string_view v) { value_prefix(); write_string(v); return *this; }
    JsonWriter& value(const char* v) { return value(std::string_view{v}); }
    JsonWriter& value(bool v) { value_prefix(); mOut += v ? "true" : "false"; return *this; }
    JsonWriter& value(int64_t v) {
        value_prefix();
        char buf[24];
        std::snprintf(buf, sizeof(buf), "%lld", static_cast<long long>(v));
        mOut += buf;
        return *this;
    }
    JsonWriter& value(int v) { return value(static_cast<int64_t>(v)); }
    // A non-integer number, rounded to `decimals` places (non-finite values become 0).
    JsonWriter& number(double v, int decimals = 1) {
        value_prefix();
        char buf[40];
        std::snprintf(buf, sizeof(buf), "%.*f", decimals, v == v && v < 1e30 && v > -1e30 ? v : 0.0);
        mOut += buf;
        return *this;
    }

    template <typename T>
    JsonWriter& member(std::string_view name, T v) {
        key(name);
        return value(v);
    }

private:
    void value_prefix() {
        if (mAfterKey) {
            mAfterKey = false;
        } else if (!mFirst) {
            mOut += ',';
        }
        mFirst = false;
    }

    void write_string(std::string_view s) {
        mOut += '"';
        for (char c : s) {
            switch (c) {
            case '"': mOut += "\\\""; break;
            case '\\': mOut += "\\\\"; break;
            case '\n': mOut += "\\n"; break;
            case '\r': mOut += "\\r"; break;
            case '\t': mOut += "\\t"; break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", c);
                    mOut += buf;
                } else {
                    mOut += c;
                }
            }
        }
        mOut += '"';
    }

    std::string mOut;
    bool mFirst = true;
    bool mAfterKey = false;
};

}  // namespace tracker
