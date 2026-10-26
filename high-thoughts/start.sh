#!/usr/bin/env bash
# One command to get High Thoughts running on your own machine.
#   ./start.sh
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node is not installed. Get it from nodejs.org (version 20 or newer)."; exit 1; }
[ "$(node -p 'parseInt(process.versions.node)')" -ge 20 ] || { echo "Node $(node -v) is too old — you need 20 or newer."; exit 1; }

[ -d node_modules ] || { echo "Installing dependencies…"; npm install --silent; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  read -rp "Paste your Anthropic API key (sk-ant-…): " key
  # Portable in-place edit: BSD and GNU sed disagree about -i.
  tmp=$(mktemp) && sed "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=${key}|" .env > "$tmp" && mv "$tmp" .env
  chmod 600 .env
fi

# Books are paid for, so give this machine some credit to test with.
if [ ! -f .high-thoughts/credits.json ]; then
  echo
  echo "Giving you 3 book credits to test with:"
  npm run --silent credits -- new 3 "local testing"
fi

echo
echo "Starting. Open http://localhost:8080"
echo "On your phone, same wifi: http://$( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null) | awk '{print $1}' ):8080"
echo
npm run dev
