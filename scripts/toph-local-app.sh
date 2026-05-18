#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

APP_NAME="Toph(DEV)"
BUNDLE_ID="studio.yourtechbud.toph.dev"
APP_PATH="$ROOT_DIR/apps/desktop/dist/mac-arm64/$APP_NAME.app"
APP_EXECUTABLE="$APP_PATH/Contents/MacOS/$APP_NAME"
TOPH_DEV_DATA_DIR="$HOME/.toph_Dev"
TOPH_DEV_USER_DATA_DIR="$HOME/Library/Application Support/$APP_NAME"

usage() {
  cat <<EOF
Usage: pnpm local:app:<command>

Commands:
  setup              Build Toph(DEV), launch it, open permission panes, wait, then relaunch.
  setup:reset        Same as setup, but reset local macOS permissions first.
  build              Build the local app bundle.
  permissions        Open macOS permission panes for the local app.
  relaunch           Quit stale local processes and launch the local app.
  status             Print local app identity and running processes.

The local bundle id is $BUNDLE_ID.
EOF
}

quit_local_app() {
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  sleep 1

  pids=$(
    ps -axo pid,args |
      awk -v app_path="$APP_PATH/" 'index($0, app_path) > 0 && index($0, "awk") == 0 {print $1}'
  )
  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs kill -9 >/dev/null 2>&1 || true
  fi
}

build_local_app() {
  (
    cd "$ROOT_DIR/apps/desktop"
    TOPH_BAKE_LOCAL_ENV=1 pnpm run build
    pnpm exec electron-builder \
      --mac dir \
      --publish never \
      --config.appId="$BUNDLE_ID" \
      --config.productName="$APP_NAME" \
      --config.mac.notarize=false \
      --config.mac.extendInfo.NSMicrophoneUsageDescription="Toph(DEV) needs microphone access to capture dictation audio." \
      --config.mac.extendInfo.NSAppleEventsUsageDescription="Toph(DEV) uses Apple Events to paste completed dictation into the focused app."
  )
}

launch_local_app() {
  if [ ! -x "$APP_EXECUTABLE" ]; then
    printf '%s\n' "Toph(DEV) is missing. Run: pnpm local:app:build" >&2
    exit 1
  fi

  if open "$APP_PATH"; then
    return
  fi

  sleep 1
  if open "$APP_PATH"; then
    return
  fi

  printf '%s\n' "macOS open failed; launching the app executable directly." >&2
  "$APP_EXECUTABLE" >/dev/null 2>&1 &
}

open_permission_panes() {
  if [ "$(uname -s)" != "Darwin" ]; then
    printf '%s\n' "Permission panes are only available on macOS."
    return
  fi

  open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
  sleep 0.2
  open 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  sleep 0.2
  open 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

reset_local_permissions() {
  if [ "$(uname -s)" != "Darwin" ]; then
    return
  fi

  for service in Microphone Accessibility ScreenCapture; do
    tccutil reset "$service" "$BUNDLE_ID" >/dev/null 2>&1 || true
  done
  printf '%s\n' "Reset Microphone, Accessibility, and Screen Recording for $BUNDLE_ID."
}

print_status() {
  printf '%s\n' "App path: $APP_PATH"
  printf '%s\n' "Toph data: $TOPH_DEV_DATA_DIR"
  printf '%s\n' "Electron userData: $TOPH_DEV_USER_DATA_DIR"
  if [ -d "$APP_PATH" ]; then
    /usr/bin/plutil -p "$APP_PATH/Contents/Info.plist" |
      /usr/bin/grep -E 'CFBundleIdentifier|CFBundleExecutable|CFBundleName|CFBundleDisplayName' ||
      true
  fi

  printf '\n%s\n' "Running processes:"
  ps -axo pid,args |
    awk -v app_path="$APP_PATH/" 'index($0, app_path) > 0 && index($0, "awk") == 0 {print}' ||
    true
}

wait_for_permission_grant_then_relaunch() {
  printf '\n%s\n' "Grant permissions to \"$APP_NAME\" in macOS Settings:"
  printf '%s\n' "  - Microphone"
  printf '%s\n' "  - Accessibility"
  printf '%s\n' "  - Screen Recording"
  printf '\n%s\n' "After granting them, this script will quit and relaunch $APP_NAME so macOS applies the new TCC state."

  if [ -r /dev/tty ]; then
    printf '\n%s' "Press Return after permissions are granted..."
    # Read from the controlling terminal so pnpm/stdin redirection does not skip the prompt.
    read _answer </dev/tty
    quit_local_app
    launch_local_app
    printf '%s\n' "Relaunched $APP_NAME."
    return
  fi

  printf '\n%s\n' "No interactive terminal is available. After granting permissions, run:"
  printf '%s\n' "  pnpm local:app:relaunch"
}

command=${1:-setup}

case "$command" in
  setup)
    build_local_app
    quit_local_app
    if [ "${TOPH_LOCAL_RESET_PERMISSIONS:-0}" = "1" ]; then
      reset_local_permissions
    fi
    launch_local_app
    open_permission_panes
    wait_for_permission_grant_then_relaunch
    ;;
  setup:reset)
    TOPH_LOCAL_RESET_PERMISSIONS=1 "$0" setup
    ;;
  build)
    build_local_app
    ;;
  permissions)
    launch_local_app
    open_permission_panes
    wait_for_permission_grant_then_relaunch
    ;;
  reset-permissions)
    quit_local_app
    reset_local_permissions
    ;;
  relaunch)
    quit_local_app
    launch_local_app
    ;;
  status)
    print_status
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
