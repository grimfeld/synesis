#!/usr/bin/env bash
# One-shot developer setup for Synesis: installs the toolchain, fetches
# dependencies, verifies the build, then starts `npm run tauri dev`.
#
# Usage:
#   scripts/dev.sh              # set up, then start the dev app
#   scripts/dev.sh --no-start   # set up only (CI, first clone, new machine)
#   scripts/dev.sh --skip-tests # set up and start without running engine tests
#
# Re-running is safe: every step checks before it installs.
#
# What "started" means: `npm run tauri dev` runs Vite on http://localhost:1420,
# opens the Tauri window, and (debug builds only) serves the engine over the
# HTTP dev bridge on 127.0.0.1:4321 so a plain browser or scripts/ui-smoke.mjs
# can drive the UI without the Tauri window.

set -euo pipefail

MIN_NODE_MAJOR=22          # scripts/ui-smoke.mjs uses the built-in WebSocket (Node 22+)
VITE_PORT=1420
BRIDGE_PORT=4321

START=1
RUN_TESTS=1
for arg in "$@"; do
  case "$arg" in
    --no-start)   START=0 ;;
    --skip-tests) RUN_TESTS=0 ;;
    -h|--help)    sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ✓ \033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m ! \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m ✗ \033[0m %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"

# ---------------------------------------------------------------- platform deps
log "Platform prerequisites ($OS)"
case "$OS" in
  Darwin)
    if xcode-select -p >/dev/null 2>&1; then
      ok "Xcode Command Line Tools"
    else
      warn "Xcode Command Line Tools missing; launching the installer."
      xcode-select --install || true
      die "Finish the Command Line Tools installation, then re-run this script."
    fi
    ;;
  Linux)
    # Tauri 2 system libraries: https://v2.tauri.app/start/prerequisites/#linux
    if have apt-get; then
      sudo apt-get update -qq
      sudo apt-get install -y -qq libwebkit2gtk-4.1-dev build-essential curl wget file \
        libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
    elif have dnf; then
      sudo dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file \
        libappindicator-gtk3-devel librsvg2-devel libxdo-devel
      sudo dnf group install -y "C Development Tools and Libraries"
    elif have pacman; then
      sudo pacman -S --needed --noconfirm webkit2gtk-4.1 base-devel curl wget file \
        openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool
    else
      warn "Unknown Linux distribution; install the Tauri prerequisites manually:"
      warn "https://v2.tauri.app/start/prerequisites/#linux"
    fi
    ok "Tauri system libraries"
    ;;
  *)
    die "Unsupported OS '$OS'. On Windows, run this from WSL or follow https://v2.tauri.app/start/prerequisites/"
    ;;
esac

# ------------------------------------------------------------------------ Rust
log "Rust toolchain"
if ! have rustup; then
  warn "rustup not found; installing stable Rust via rustup.rs"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
# shellcheck disable=SC1091
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
have cargo || die "cargo is still not on PATH; open a new shell and re-run."
rustup toolchain list | grep -q '^stable' || rustup toolchain install stable --profile minimal
ok "$(rustc -V)"

# ------------------------------------------------------------------------ Node
log "Node.js >= $MIN_NODE_MAJOR"
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if ! have node || [ "$(node_major)" -lt "$MIN_NODE_MAJOR" ]; then
  if have fnm; then
    fnm install "$MIN_NODE_MAJOR" && fnm use "$MIN_NODE_MAJOR"
  elif have nvm; then
    nvm install "$MIN_NODE_MAJOR" && nvm use "$MIN_NODE_MAJOR"
  elif [ "$OS" = Darwin ] && have brew; then
    brew install node
  else
    warn "Installing fnm (Fast Node Manager) to provide Node $MIN_NODE_MAJOR"
    curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
    export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
    eval "$(fnm env)"
    fnm install "$MIN_NODE_MAJOR" && fnm use "$MIN_NODE_MAJOR"
  fi
fi
have node || die "node is still not on PATH; open a new shell and re-run."
[ "$(node_major)" -ge "$MIN_NODE_MAJOR" ] || die "Node $(node -v) is too old; need >= $MIN_NODE_MAJOR."
ok "node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- dependencies
log "npm dependencies"
if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
ok "node_modules"

log "Cargo dependencies"
cargo fetch --quiet
ok "crates fetched"

# ---------------------------------------------------------------------- verify
log "Verifying the build"
npm run --silent typecheck
ok "UI typechecks"
if [ "$RUN_TESTS" = 1 ]; then
  cargo test -p engine --quiet
  ok "engine tests pass"
else
  cargo build -p engine --quiet
  ok "engine builds (tests skipped)"
fi

# --------------------------------------------------------------------- optional
if [ "$OS" = Darwin ] && [ -d "/Applications/Google Chrome.app" ]; then
  ok "Google Chrome found (needed only by scripts/ui-smoke.mjs)"
elif ! have google-chrome && ! have chromium; then
  warn "Google Chrome not found; scripts/ui-smoke.mjs will not work until it is installed."
fi

# ----------------------------------------------------------------------- start
[ "$START" = 1 ] || { log "Setup complete. Start the app with: npm run tauri dev"; exit 0; }

port_busy() {
  if have lsof; then lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; fi
}
for p in "$VITE_PORT" "$BRIDGE_PORT"; do
  if port_busy "$p"; then
    die "Port $p is already in use. A dev app is probably running; stop it or open http://localhost:$VITE_PORT."
  fi
done

log "Starting the dev app"
echo "    Vite UI:     http://localhost:$VITE_PORT   (also usable in a plain browser)"
echo "    Dev bridge:  http://127.0.0.1:$BRIDGE_PORT  (engine over HTTP, debug builds only)"
echo "    Smoke tests: node scripts/ui-smoke.mjs '<steps>'"
echo "    Stop with Ctrl-C."
exec npm run tauri dev
