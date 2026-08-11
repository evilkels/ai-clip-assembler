#!/usr/bin/env bash
#
# AI Clip Assembler install wizard.
#
# Interactive helper for the installed macOS app: show what is installed versus
# what has been released, update to the latest GitHub release, or remove the app
# again. Project folders are never touched — only the app bundle and its own
# application-support data.
#
#   ./scripts/app-wizard.sh            interactive menu
#   ./scripts/app-wizard.sh status     print status and exit
#   ./scripts/app-wizard.sh update     update to the latest release
#   ./scripts/app-wizard.sh uninstall  remove the app
#
set -euo pipefail

REPO="evilkels/ai-clip-assembler"
APP_NAME="AI Clip Assembler"
APP_PATH="/Applications/${APP_NAME}.app"
APP_SUPPORT="${HOME}/Library/Application Support/ai-clip-assembler"
CACHES=(
  "${HOME}/Library/Caches/com.evilkels.ai-clip-assembler"
  "${HOME}/Library/Caches/ai-clip-assembler"
  "${HOME}/Library/Logs/${APP_NAME}"
  "${HOME}/Library/Preferences/com.evilkels.ai-clip-assembler.plist"
  "${HOME}/Library/Saved Application State/com.evilkels.ai-clip-assembler.savedState"
)

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; RESET=''
fi

say()  { printf '%s\n' "$*"; }
info() { printf '%s\n' "${DIM}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}$*${RESET}" >&2; }
fail() { printf '%s\n' "${RED}$*${RESET}" >&2; exit 1; }
ok()   { printf '%s\n' "${GREEN}$*${RESET}"; }

require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || fail "This wizard only manages the macOS app."
}

confirm() {
  local prompt="$1" reply
  read -r -p "${prompt} [y/N] " reply || return 1
  [[ "${reply}" == [yY] || "${reply}" == [yY][eE][sS] ]]
}

installed_version() {
  [[ -d "${APP_PATH}" ]] || return 1
  defaults read "${APP_PATH}/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null
}

# Latest published release tag, without the leading "v".
latest_version() {
  local tag
  if command -v gh >/dev/null 2>&1 && tag=$(gh release view --repo "${REPO}" --json tagName --jq .tagName 2>/dev/null); then
    :
  else
    tag=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/${REPO}/releases/latest" 2>/dev/null |
      sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
  fi
  [[ -n "${tag}" ]] || return 1
  printf '%s\n' "${tag#v}"
}

host_arch() {
  case "$(uname -m)" in
    arm64) printf 'arm64\n' ;;
    x86_64) printf 'x64\n' ;;
    *) fail "Unsupported architecture: $(uname -m)" ;;
  esac
}

# Numeric version compare: prints "older", "same" or "newer" for $1 against $2.
compare_versions() {
  local a="$1" b="$2"
  if [[ "${a}" == "${b}" ]]; then printf 'same\n'; return; fi
  local highest
  highest=$(printf '%s\n%s\n' "${a}" "${b}" | sort -V | tail -1)
  if [[ "${highest}" == "${a}" ]]; then printf 'newer\n'; else printf 'older\n'; fi
}

app_running() {
  pgrep -f "${APP_PATH}/Contents/MacOS/" >/dev/null 2>&1
}

quit_app_if_running() {
  app_running || return 0
  say "${APP_NAME} is running and must quit before the app bundle can be replaced."
  confirm "Quit it now?" || fail "Aborted — quit ${APP_NAME} and run the wizard again."
  osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
  local waited=0
  while app_running && (( waited < 20 )); do
    sleep 1
    waited=$((waited + 1))
  done
  if app_running; then
    fail "${APP_NAME} did not quit. Quit it manually (or force-quit) and try again."
  fi
  ok "Quit ${APP_NAME}."
}

cmd_status() {
  local current latest arch
  arch=$(host_arch)
  say "${BOLD}${APP_NAME}${RESET}"
  if current=$(installed_version); then
    say "  Installed:  ${current}  ${DIM}(${APP_PATH}, ${arch})${RESET}"
  else
    current=''
    say "  Installed:  ${DIM}not installed${RESET}"
  fi

  if latest=$(latest_version); then
    say "  Latest:     ${latest}  ${DIM}(github.com/${REPO}/releases)${RESET}"
  else
    latest=''
    warn "  Latest:     could not be read (offline, or GitHub rate-limited)"
  fi

  if [[ -n "${current}" && -n "${latest}" ]]; then
    case "$(compare_versions "${latest}" "${current}")" in
      newer) say "  ${YELLOW}An update is available.${RESET} Run: $0 update" ;;
      same)  ok  "  Up to date." ;;
      older) say "  ${DIM}Installed build is ahead of the latest release (local build).${RESET}" ;;
    esac
  fi

  if [[ -d "${APP_SUPPORT}" ]]; then
    say "  App data:   ${APP_SUPPORT} ${DIM}($(du -sh "${APP_SUPPORT}" 2>/dev/null | cut -f1))${RESET}"
  else
    say "  App data:   ${DIM}none${RESET}"
  fi
  info "  Project folders live wherever you created them and are never touched by this wizard."
}

download_release_dmg() {
  local version="$1" arch="$2" dest_dir="$3"
  # GitHub replaces spaces in asset names with dots, and the DMG name carries
  # the version electron-builder was built with — match on the arch suffix only.
  local pattern="*-${arch}.dmg"

  if command -v gh >/dev/null 2>&1 &&
     gh release download "v${version}" --repo "${REPO}" --pattern "${pattern}" --dir "${dest_dir}" >&2 2>/dev/null; then
    :
  else
    local url
    url=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
      "https://api.github.com/repos/${REPO}/releases/tags/v${version}" |
      sed -n 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
      grep -- "-${arch}\.dmg$" | head -1)
    [[ -n "${url}" ]] || fail "Release v${version} has no ${arch} DMG asset."
    say "Downloading $(basename "${url}") …" >&2
    curl -fL --progress-bar -o "${dest_dir}/$(basename "${url}")" "${url}" >&2
  fi

  local dmg
  dmg=$(find "${dest_dir}" -maxdepth 1 -name '*.dmg' | head -1)
  [[ -n "${dmg}" ]] || fail "No DMG was downloaded."
  printf '%s\n' "${dmg}"
}

install_from_dmg() {
  local dmg="$1" mount_point
  mount_point=$(mktemp -d "${TMPDIR:-/tmp}/aca-mount.XXXXXX")

  say "Mounting $(basename "${dmg}") …"
  hdiutil attach "${dmg}" -mountpoint "${mount_point}" -nobrowse -quiet
  # shellcheck disable=SC2064  # expand mount_point now, at trap-set time
  trap "hdiutil detach '${mount_point}' -quiet >/dev/null 2>&1 || true" EXIT

  local source_app="${mount_point}/${APP_NAME}.app"
  [[ -d "${source_app}" ]] || fail "The DMG does not contain ${APP_NAME}.app."

  if [[ -d "${APP_PATH}" ]]; then
    local backup="${APP_PATH}.previous"
    rm -rf "${backup}"
    say "Moving the current app aside to $(basename "${backup}") …"
    mv "${APP_PATH}" "${backup}"
    # Restore the old bundle if the copy fails, so /Applications is never left empty.
    if ! ditto "${source_app}" "${APP_PATH}"; then
      rm -rf "${APP_PATH}"
      mv "${backup}" "${APP_PATH}"
      fail "Install failed; the previous version was restored."
    fi
    rm -rf "${backup}"
  else
    say "Copying ${APP_NAME}.app to /Applications …"
    ditto "${source_app}" "${APP_PATH}"
  fi

  hdiutil detach "${mount_point}" -quiet >/dev/null 2>&1 || true
  trap - EXIT
  ok "Installed $(installed_version) to ${APP_PATH}."

  # The releases are not yet signed or notarized, so Gatekeeper blocks a plain
  # double-click. Removing the download quarantine flag is the user's call.
  if xattr -p com.apple.quarantine "${APP_PATH}" >/dev/null 2>&1; then
    say ''
    warn "This build is unsigned, so macOS has quarantined it."
    info "Without clearing that, first launch needs Finder → right-click the app → Open."
    if confirm "Clear the quarantine flag on ${APP_PATH} now?"; then
      xattr -dr com.apple.quarantine "${APP_PATH}"
      ok "Quarantine flag cleared."
    fi
  fi
}

cmd_update() {
  local current latest arch tmp dmg
  arch=$(host_arch)
  latest=$(latest_version) || fail "Could not read the latest release. Check your connection and retry."

  if current=$(installed_version); then
    case "$(compare_versions "${latest}" "${current}")" in
      same)
        ok "Already on ${current} — the latest release."
        confirm "Reinstall ${current} anyway?" || return 0
        ;;
      older)
        warn "Installed ${current} is newer than the latest release ${latest} (a local build)."
        confirm "Replace it with released ${latest}?" || return 0
        ;;
      newer)
        say "Updating ${current} → ${BOLD}${latest}${RESET} (${arch})."
        ;;
    esac
  else
    say "${APP_NAME} is not installed. Installing ${BOLD}${latest}${RESET} (${arch})."
  fi

  quit_app_if_running

  tmp=$(mktemp -d "${TMPDIR:-/tmp}/aca-update.XXXXXX")
  # shellcheck disable=SC2064
  trap "rm -rf '${tmp}'" EXIT
  dmg=$(download_release_dmg "${latest}" "${arch}" "${tmp}")
  install_from_dmg "${dmg}"
  rm -rf "${tmp}"
  trap - EXIT

  say ''
  if confirm "Open ${APP_NAME} now?"; then
    open -a "${APP_PATH}"
  fi
}

cmd_uninstall() {
  local current
  if current=$(installed_version); then
    say "About to remove ${BOLD}${APP_NAME} ${current}${RESET} from /Applications."
  elif [[ ! -d "${APP_SUPPORT}" ]]; then
    ok "Nothing to remove — no app bundle and no app data found."
    return 0
  else
    say "The app bundle is already gone, but app data remains."
  fi
  info "Your project folders (footage, clips, exports) are NOT part of this and stay put."

  confirm "Remove the app bundle?" || { say "Nothing removed."; return 0; }
  quit_app_if_running

  if [[ -d "${APP_PATH}" ]]; then
    rm -rf "${APP_PATH}"
    ok "Removed ${APP_PATH}."
  fi
  rm -rf "${APP_PATH}.previous"

  if [[ -d "${APP_SUPPORT}" ]]; then
    say ''
    say "App data at ${APP_SUPPORT} ${DIM}($(du -sh "${APP_SUPPORT}" 2>/dev/null | cut -f1))${RESET}"
    info "This holds your recent-projects list, update state and the sign-in cache — not your footage."
    if confirm "Remove app data too?"; then
      rm -rf "${APP_SUPPORT}"
      ok "Removed app data."
    else
      info "Kept app data — a reinstall will pick up where you left off."
    fi
  fi

  local path removed_caches=0
  for path in "${CACHES[@]}"; do
    if [[ -e "${path}" ]]; then
      rm -rf "${path}"
      removed_caches=$((removed_caches + 1))
    fi
  done
  (( removed_caches > 0 )) && ok "Removed ${removed_caches} cache/preference item(s)."

  say ''
  ok "Done."
}

menu() {
  cmd_status
  say ''
  say "${BOLD}What would you like to do?${RESET}"
  say "  1) Update to the latest release"
  say "  2) Remove ${APP_NAME}"
  say "  3) Refresh this status"
  say "  q) Quit"
  local choice
  read -r -p "Choice [1/2/3/q] " choice || choice=q
  case "${choice}" in
    1) cmd_update ;;
    2) cmd_uninstall ;;
    3) say ''; menu ;;
    q|Q|'') say "Nothing changed." ;;
    *) warn "Unrecognized choice: ${choice}" ;;
  esac
}

main() {
  require_macos
  case "${1:-menu}" in
    status) cmd_status ;;
    update) cmd_update ;;
    uninstall|remove) cmd_uninstall ;;
    menu) menu ;;
    -h|--help|help)
      sed -n '3,14p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    *) fail "Unknown command: $1 (try: status, update, uninstall)" ;;
  esac
}

main "$@"
