#!/bin/sh

# Installs a Toph AppImage for the current user and registers it with the desktop:
#   $XDG_DATA_HOME/toph/Toph.AppImage              (the in-app updater replaces this file)
#   $XDG_DATA_HOME/applications/<DESKTOP_NAME>     (launcher entry)
#   $XDG_DATA_HOME/icons/hicolor/NxN/apps/Toph.png (launcher icons)
#   ~/.local/bin/toph                              (terminal shortcut)
# DESKTOP_NAME and StartupWMClass must match desktopName in apps/desktop/package.json.

set -eu

DESKTOP_NAME='studio.yourtechbud.toph.desktop'
WM_CLASS='studio.yourtechbud.toph'
ICON_NAME='Toph'
ICON_SIZES='16 24 32 48 64 128 256 512'
MANAGED_MARKER='X-Toph-Managed=true'

usage() {
  printf '%s\n' "Usage: install-toph-linux.sh APPIMAGE" "" \
    "Install the given Toph AppImage for the current user and register it in the application menu." \
    "Run it again with a newer AppImage to update."
}

fail() {
  printf 'install-toph-linux.sh: %s\n' "$1" >&2
  exit 1
}

reject_controls() {
  value_without_controls=$(printf '%s' "$2" | LC_ALL=C tr -d '\001-\037\177')
  [ "$value_without_controls" = "$2" ] || fail "$1 cannot contain ASCII control characters."
}

case ${1-} in
  --help|-h)
    [ "$#" -eq 1 ] || fail '--help does not accept additional arguments.'
    usage
    exit 0
    ;;
  -*) fail "unknown option: $1" ;;
esac
[ "$#" -eq 1 ] || { usage >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || fail 'refusing to install as root; run as your normal user.'
[ "$(uname -s)" = 'Linux' ] || fail 'the Toph AppImage installer requires Linux.'
case $(uname -m) in
  x86_64|amd64) ;;
  *) fail 'the Toph AppImage installer requires an x86-64 host.' ;;
esac

[ -n "${HOME-}" ] || fail 'HOME must be set.'
case $HOME in /*) ;; *) fail 'HOME must be an absolute path.' ;; esac

source_appimage=$1
reject_controls 'AppImage path' "$source_appimage"
case $source_appimage in
  /*) ;;
  *) source_appimage=$(CDPATH= cd -- "$(dirname -- "$source_appimage")" && pwd -P)/$(basename -- "$source_appimage") ;;
esac
[ ! -L "$source_appimage" ] || fail "AppImage is a symlink: $source_appimage"
[ -f "$source_appimage" ] || fail "AppImage is not a regular file: $source_appimage"

elf_magic=$(od -An -v -t x1 -N 4 "$source_appimage" | tr -d ' \n')
[ "$elf_magic" = '7f454c46' ] || fail 'AppImage does not have ELF magic.'
elf_machine=$(dd if="$source_appimage" bs=1 skip=18 count=2 2>/dev/null | od -An -v -t x1 | tr -d ' \n')
[ "$elf_machine" = '3e00' ] || fail 'AppImage is not an x86-64 executable.'

if [ -n "${XDG_DATA_HOME-}" ]; then
  data_home=$XDG_DATA_HOME
else
  data_home=$HOME/.local/share
fi
case $data_home in /*) ;; *) fail 'XDG_DATA_HOME must be an absolute path.' ;; esac
reject_controls 'XDG_DATA_HOME' "$data_home"

assert_owned_directory() {
  [ ! -L "$1" ] || fail "managed directory is a symlink: $1"
  [ -d "$1" ] || fail "managed path is not a directory: $1"
  [ -O "$1" ] || fail "managed directory is not owned by you: $1"
}

ensure_directory() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    assert_owned_directory "$1"
  else
    mkdir -p "$1"
  fi
}

assert_replaceable_file() {
  if [ -e "$1" ] || [ -L "$1" ]; then
    [ ! -L "$1" ] || fail "managed file is a symlink: $1"
    [ -f "$1" ] || fail "managed path is not a regular file: $1"
    [ -O "$1" ] || fail "managed file is not owned by you: $1"
  fi
}

# Validate the AppImage's embedded desktop entry and icons before touching the
# install location, so a wrong or broken download leaves the current install intact.
extract_parent=$(mktemp -d "${TMPDIR:-/tmp}/toph-appimage-extract.XXXXXX") || fail 'could not create an extraction directory.'
newline='
'
staged_files=''
cleanup() {
  if [ -n "$staged_files" ]; then
    old_ifs=$IFS
    IFS=$newline
    for staged_file in $staged_files; do rm -f "$staged_file"; done
    IFS=$old_ifs
  fi
  rm -rf "$extract_parent"
}
trap cleanup EXIT HUP INT TERM

validation_appimage=$extract_parent/Toph.AppImage
cp "$source_appimage" "$validation_appimage"
chmod 0755 "$validation_appimage"
(CDPATH= cd -- "$extract_parent" && "$validation_appimage" --appimage-extract >/dev/null) ||
  fail 'AppImage extraction failed; use an official Toph Linux release.'
extracted_root=$extract_parent/squashfs-root

embedded_desktop=$extracted_root/$DESKTOP_NAME
[ -f "$embedded_desktop" ] && [ ! -L "$embedded_desktop" ] ||
  fail "AppImage is missing $DESKTOP_NAME; this installer needs a newer Toph release."
grep -Fqx 'Name=Toph' "$embedded_desktop" || fail 'AppImage desktop entry does not identify Toph.'
grep -Fqx "Icon=$ICON_NAME" "$embedded_desktop" || fail "AppImage desktop entry does not use the $ICON_NAME icon."
grep -Fqx "StartupWMClass=$WM_CLASS" "$embedded_desktop" || fail "AppImage desktop entry does not use the $WM_CLASS window class."
for size in $ICON_SIZES; do
  embedded_icon=$extracted_root/usr/share/icons/hicolor/${size}x${size}/apps/$ICON_NAME.png
  [ -f "$embedded_icon" ] && [ ! -L "$embedded_icon" ] || fail "AppImage is missing the ${size}x${size} Toph icon."
done

# Check every destination before replacing anything, so a filesystem conflict
# fails with the previous installation untouched.
app_directory=$data_home/toph
applications_directory=$data_home/applications
icons_root=$data_home/icons/hicolor
app_destination=$app_directory/Toph.AppImage
desktop_destination=$applications_directory/$DESKTOP_NAME

ensure_directory "$data_home"
ensure_directory "$app_directory"
ensure_directory "$applications_directory"
assert_replaceable_file "$app_destination"
assert_replaceable_file "$desktop_destination"
if [ -f "$desktop_destination" ] && ! grep -Fqx "$MANAGED_MARKER" "$desktop_destination"; then
  fail "refusing to replace an application entry not created by this installer: $desktop_destination"
fi
for size in $ICON_SIZES; do
  icon_directory=$icons_root/${size}x${size}/apps
  ensure_directory "$icon_directory"
  assert_replaceable_file "$icon_directory/$ICON_NAME.png"
done

# The terminal shortcut is a convenience, so a conflict there skips it rather
# than failing the install.
bin_directory=$HOME/.local/bin
bin_link=$bin_directory/toph
link_bin=true
if [ -e "$bin_link" ] && [ ! -L "$bin_link" ]; then
  printf 'Skipping %s because a file that is not a symlink already exists there.\n' "$bin_link"
  link_bin=false
elif ! mkdir -p "$bin_directory" 2>/dev/null || [ ! -w "$bin_directory" ]; then
  printf 'Skipping %s because %s is not a writable directory.\n' "$bin_link" "$bin_directory"
  link_bin=false
fi

# Stage every file beside its destination, then rename them all into place so a
# running Toph or launcher never sees a partially written file.
stage_file() {
  staged_file=$(mktemp "$(dirname -- "$2")/.$(basename -- "$2").XXXXXX") || fail "could not stage $2."
  staged_files=${staged_files:+$staged_files$newline}$staged_file
  cp "$1" "$staged_file"
  chmod "$3" "$staged_file"
}

stage_file "$validation_appimage" "$app_destination" 0755
staged_appimage=$staged_file

staged_icons=''
for size in $ICON_SIZES; do
  stage_file "$extracted_root/usr/share/icons/hicolor/${size}x${size}/apps/$ICON_NAME.png" \
    "$icons_root/${size}x${size}/apps/$ICON_NAME.png" 0644
  staged_icons=${staged_icons:+$staged_icons$newline}$staged_file
done

# Desktop Entry Exec values need quoting and escaping for paths with spaces or
# reserved characters, then a second backslash pass for the string value type.
exec_quoted=$(printf '%s' "$app_destination" | sed 's/\\/\\\\/g; s/"/\\"/g; s/`/\\`/g; s/\$/\\$/g; s/%/%%/g')
exec_value=$(printf '%s' "$exec_quoted" | sed 's/\\/\\\\/g')
desktop_source=$extract_parent/$DESKTOP_NAME
{
  printf '%s\n' '[Desktop Entry]' 'Version=1.0' 'Type=Application' 'Name=Toph'
  printf '%s\n' 'Comment=Toph is a modern dictation software'
  printf 'Exec="%s"\n' "$exec_value"
  printf '%s\n' "Icon=$ICON_NAME" 'Categories=Utility;' 'Terminal=false' "StartupWMClass=$WM_CLASS" "$MANAGED_MARKER"
} >"$desktop_source"
stage_file "$desktop_source" "$desktop_destination" 0644
staged_desktop=$staged_file

mv -f "$staged_appimage" "$app_destination"
old_ifs=$IFS
IFS=$newline
for staged_icon in $staged_icons; do
  mv -f "$staged_icon" "$(dirname -- "$staged_icon")/$ICON_NAME.png"
done
IFS=$old_ifs
# The launcher entry goes last so it never points at a missing AppImage or icon.
mv -f "$staged_desktop" "$desktop_destination"
staged_files=''

# Earlier install steps wrote toph.desktop without an icon or window class. Remove
# it so the launcher does not show two Toph entries.
legacy_desktop=$applications_directory/toph.desktop
if [ -f "$legacy_desktop" ] && [ ! -L "$legacy_desktop" ] &&
  grep -Fqx 'Name=Toph' "$legacy_desktop" && grep -q '^Exec=.*\.local/bin/toph' "$legacy_desktop"; then
  rm -f "$legacy_desktop"
  printf 'Removed the old launcher entry at %s\n' "$legacy_desktop"
fi

if [ "$link_bin" = true ]; then
  ln -sfn "$app_destination" "$bin_link"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$applications_directory" 2>/dev/null || true
fi

printf 'Toph installed at %s\n' "$app_destination"
