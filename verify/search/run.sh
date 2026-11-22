#!/usr/bin/env bash
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
jar="$dir/.tools/tla2tools.jar"
url="https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar"
mkdir -p "$dir/.tools"
if [ ! -f "$jar" ]; then
  curl -fsSL -o "$jar" "$url"
fi
mode="${1:-ok}"
if [ "$mode" = "bug" ]; then
  spec="FundSearchBug"
else
  spec="FundSearch"
fi
exec java -XX:+UseParallelGC -jar "$jar" -config "$dir/${spec}.cfg" "$dir/${spec}.tla"
