#!/bin/sh
# Installs the static BtbN ffmpeg build of one release series (default 8.1, the version
# development is done with) for CI, verified against BtbN's checksum list. Reuses an
# already unpacked build with the same checksum (CI cache). Adds its bin/ to GITHUB_PATH.
set -eu

SERIES="${FFMPEG_SERIES:-8.1}"
NAME="ffmpeg-n${SERIES}-latest-linux64-gpl-${SERIES}"
BASE="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"
DIR="${FFMPEG_DIR:-$HOME/.cache/ffmpeg}"

mkdir -p "$DIR"
cd "$DIR"
curl -fsSL -o checksums.sha256 "$BASE/checksums.sha256"
expected="$(awk -v f="$NAME.tar.xz" '$2 == f { print $1 }' checksums.sha256)"
if [ -z "$expected" ]; then
  echo "No $NAME.tar.xz in BtbN's checksum list" >&2
  exit 1
fi

if [ -x "$NAME/bin/ffmpeg" ] && [ "$(cat "$NAME.sha256" 2>/dev/null || true)" = "$expected" ]; then
  echo "Using cached $NAME"
else
  echo "Downloading $NAME"
  rm -rf "$NAME" "$NAME.tar.xz"
  curl -fsSL -o "$NAME.tar.xz" "$BASE/$NAME.tar.xz"
  echo "$expected  $NAME.tar.xz" | sha256sum -c -
  tar -xJf "$NAME.tar.xz"
  rm "$NAME.tar.xz"
  echo "$expected" > "$NAME.sha256"
fi

"$DIR/$NAME/bin/ffmpeg" -hide_banner -version | head -1
if [ -n "${GITHUB_PATH:-}" ]; then echo "$DIR/$NAME/bin" >> "$GITHUB_PATH"; fi
