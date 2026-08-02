#!/bin/bash
# Run DB migrations using DATABASE_URL from apps/consumer/.env.local.
# (Values there can contain spaces/quotes, so we extract just this one key.)
set -e
source ~/.nvm/nvm.sh >/dev/null 2>&1
cd "$(dirname "$0")/.."
DATABASE_URL="$(grep -E '^DATABASE_URL=' apps/consumer/.env.local | cut -d= -f2- | tr -d '"')"
export DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL not found in apps/consumer/.env.local" >&2
  exit 1
fi
npm run migrate -w packages/core
