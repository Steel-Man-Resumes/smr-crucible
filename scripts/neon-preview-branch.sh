#!/bin/bash
# Phase 1D: create a schema-only "preview" Neon branch for the crucible DB.
# Reads NEON_API_KEY_MAIN from ~/.secrets/api-keys.env. Never prints the key.
set -e
source ~/.secrets/api-keys.env
KEY="$NEON_API_KEY_MAIN"
H="Authorization: Bearer $KEY"

case "$1" in
  projects)
    curl -s -H "$H" https://console.neon.tech/api/v2/projects | \
      python3 -c "import sys,json; [print(p['id'], p['name'], p.get('region_id','')) for p in json.load(sys.stdin)['projects']]"
    ;;
  endpoints)
    curl -s -H "$H" "https://console.neon.tech/api/v2/projects/$2/endpoints" | \
      python3 -c "import sys,json; [print(e['id'], e['host'], e['branch_id']) for e in json.load(sys.stdin)['endpoints']]"
    ;;
  branches)
    curl -s -H "$H" "https://console.neon.tech/api/v2/projects/$2/branches" | \
      python3 -c "import sys,json; [print(b['id'], b['name'], b.get('init_source','')) for b in json.load(sys.stdin)['branches']]"
    ;;
  create)
    # schema-only preview branch with its own read-write endpoint
    curl -s -X POST -H "$H" -H "Content-Type: application/json" \
      "https://console.neon.tech/api/v2/projects/$2/branches" \
      -d '{"branch":{"name":"preview","init_source":"schema-only"},"endpoints":[{"type":"read_write"}]}' | \
      python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({k:d[k] for k in d if k in ('branch','endpoints')}, default=str)[:600])"
    ;;
  uri)
    curl -s -H "$H" "https://console.neon.tech/api/v2/projects/$2/connection_uri?branch_id=$3&database_name=$4&role_name=$5&pooled=true" | \
      python3 -c "import sys,json; print(json.load(sys.stdin).get('uri','ERROR')[:30] + '...REDACTED')"
    ;;
esac
