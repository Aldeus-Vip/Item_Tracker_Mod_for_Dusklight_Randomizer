#!/usr/bin/env sh
# Builds and runs the host-side tests. Needs the Dusklight checkout (created by the first
# `cmake -B build`) and the fmt headers it fetched into build/_deps.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
fmt_include=$(find "$root/build/_deps" -path '*fmt-src/include' -type d 2>/dev/null | head -n 1)
fmt_include=${fmt_include:-${FMT_INCLUDE:?set FMT_INCLUDE to the fmt include directory}}
build() {
    ${CXX:-c++} -std=c++20 -Wall -Wextra -O1 -DFMT_HEADER_ONLY -DDUSK_MOD_FEATURE_FMT -Wno-attributes \
        -I"$root/dusklight/sdk/include" -I"$fmt_include" "$@"
}
build "$root/tests/web_server_test.cpp" "$root/src/web_server.cpp" -o "$root/build/web_server_test"
build "$root/tests/rando_data_test.cpp" "$root/src/rando_data.cpp" -o "$root/build/rando_data_test"
build "$root/tests/gx_texture_test.cpp" "$root/src/gx_texture.cpp" -o "$root/build/gx_texture_test"
"$root/build/web_server_test"
"$root/build/rando_data_test"
"$root/build/gx_texture_test"
