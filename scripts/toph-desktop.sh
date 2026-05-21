#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

MAIN_ENTRY="$ROOT_DIR/apps/desktop/out/main/index.js"
DESKTOP_ELECTRON_DIR="$ROOT_DIR/apps/desktop/node_modules/electron"
ROOT_ELECTRON_DIR="$ROOT_DIR/node_modules/electron"

resolve_electron_bin() {
  electron_dir=$1
  electron_path_file="$electron_dir/path.txt"

  if [ -f "$electron_path_file" ]; then
    electron_relative_path=$(sed -n '1p' "$electron_path_file")
    electron_bin="$electron_dir/dist/$electron_relative_path"
    if [ -x "$electron_bin" ]; then
      printf '%s\n' "$electron_bin"
      return 0
    fi
  fi

  electron_bin="$electron_dir/dist/electron"
  if [ -x "$electron_bin" ]; then
    printf '%s\n' "$electron_bin"
    return 0
  fi

  return 1
}

if [ ! -f "$MAIN_ENTRY" ]; then
  printf '%s\n' "Toph desktop build is missing. Run 'pnpm build' first." >&2
  exit 1
fi

if ELECTRON_BIN=$(resolve_electron_bin "$DESKTOP_ELECTRON_DIR"); then
  :
elif ELECTRON_BIN=$(resolve_electron_bin "$ROOT_ELECTRON_DIR"); then
  :
else
  printf '%s\n' "Electron binary is missing. Run 'pnpm install' first." >&2
  exit 1
fi

export ELECTRON_DISABLE_SANDBOX=1
export TOPH_DATA_DIRECTORY=${TOPH_DATA_DIRECTORY:-"$ROOT_DIR/.toph"}

exec "$ELECTRON_BIN" --no-sandbox "$MAIN_ENTRY" "$@"
