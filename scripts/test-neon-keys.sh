#!/bin/bash
# Try every NEON* env var found in known env files against the Neon API.
# Prints variable NAMES and API status only -- never values.
for f in ~/.secrets/api-keys.env ~/repos/mke-reentry-hub/.env.local ~/repos/prospect-machine/.env.local; do
  [ -f "$f" ] || continue
  for name in $(grep -o '^[A-Z_]*NEON[A-Z_]*' "$f" | sort -u); do
    val=$(grep -m1 "^$name=" "$f" | cut -d= -f2- | tr -d '"' | tr -d "'")
    [ -n "$val" ] || continue
    status=$(curl -s -H "Authorization: Bearer $val" https://console.neon.tech/api/v2/projects | head -c 60)
    echo "$f :: $name :: ${status:0:60}"
  done
done
