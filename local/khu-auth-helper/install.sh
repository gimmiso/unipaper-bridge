#!/bin/sh
set -eu

helper_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
app_dir="$helper_dir/build/UniPaper KHU Helper.app"
executable="$app_dir/Contents/MacOS/khu-keychain-helper"

build_helper() {
  swift build --package-path "$helper_dir" -c release
  mkdir -p "$app_dir/Contents/MacOS"
  mkdir -p "$app_dir/Contents/Resources"
  cp "$helper_dir/.build/release/khu-keychain-helper" "$executable"
  cp "$helper_dir/Info.plist" "$app_dir/Contents/Info.plist"
  chmod 755 "$executable"
  xattr -cr "$app_dir"
  codesign --force --sign - \
    --identifier com.gimmiso.unipaper.khu-helper \
    "$app_dir"
  # File Provider can attach empty Finder metadata while the bundle is created.
  # Removing it after signing preserves the signature and avoids Gatekeeper's
  # "resource fork ... not allowed" rejection.
  verify_attempt=1
  while [ "$verify_attempt" -le 5 ]; do
    xattr -cr "$app_dir"
    if codesign --verify --deep --strict "$app_dir" >/dev/null 2>&1; then
      return 0
    fi
    verify_attempt=$((verify_attempt + 1))
    sleep 1
  done
  codesign --verify --deep --strict "$app_dir"
}

action=${1:-build}
case "$action" in
  build)
    build_helper
    ;;
  setup)
    shift
    build_helper
    "$executable" setup "$@"
    ;;
  status)
    build_helper
    "$executable" status
    ;;
  remove)
    build_helper
    "$executable" remove --yes
    ;;
  *)
    printf '%s\n' 'Usage: install.sh [build|setup|status|remove]' >&2
    exit 64
    ;;
esac
