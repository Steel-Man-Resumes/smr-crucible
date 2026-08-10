#!/bin/bash
# One-shot: run the core migration runner with DATABASE_URL from apps/consumer/.env.local
set -e
cd ~/repos/smr-crucible
source ~/.nvm/nvm.sh >/dev/null 2>&1
nvm use 20 >/dev/null 2>&1
export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/consumer/.env.local | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
npm run migrate -w packages/core
