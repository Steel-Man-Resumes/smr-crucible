#!/usr/bin/env python3
"""
Build the Forge location list from public US Census files.

What it makes: one compact JSON file the Forge loads in the browser when the
"Where are you located?" field is focused. Search runs on the person's own
device, so what they type never leaves it.

Sources (US Census Bureau, public domain, 2020 Census geography):
  1. 2020 Gazetteer, places (every incorporated place and CDP, with state)
  2. 2020 ZCTA-to-place relationship file (ZIP Code Tabulation Area to place)
  3. 2020 ZCTA-to-county relationship file (ZCTA to county, for ZIPs outside any place)

A ZCTA is the Census Bureau's area version of a ZIP code. It is close to the
postal ZIP, not identical, so a ZIP suggestion is labeled with the place it
mostly covers and the person can still type anything they like.

Usage (downloads are untrusted data: keep them in their own empty folder, and
run this with `python3 -I` from somewhere else):

  python3 -I scripts/census-places/build_places.py \
      --raw-dir /path/to/empty/census-raw \
      --out apps/consumer/public/forge-data/us-places-2020.v1.json

It downloads any file missing from --raw-dir, checks each file's SHA-256
against the pinned value below and its header against the expected columns,
and refuses to build from anything that does not match.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import sys
import unicodedata
import urllib.request
import zipfile

BASE = "https://www2.census.gov/geo/docs/maps-data/data"
SOURCES = {
    "places": {
        "url": f"{BASE}/gazetteer/2020_Gazetteer/2020_Gaz_place_national.zip",
        "file": "2020_Gaz_place_national.zip",
    },
    "zcta_place": {
        "url": f"{BASE}/rel2020/zcta520/tab20_zcta520_place20_natl.txt",
        "file": "tab20_zcta520_place20_natl.txt",
    },
    "zcta_county": {
        "url": f"{BASE}/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
        "file": "tab20_zcta520_county20_natl.txt",
    },
}

# Pinned checksums of the files this build was made from. A Census re-release
# changes the hash; the build then stops so a person can look before shipping.
PINNED = {
    "places": "6e5745b3e1adf7a1e024a988301d484697e2a0f25b3cf10114eef676f09d5c18",
    "zcta_place": "698a5dad71ed419411677d0ffd8ecd9331067f59c472cdd239b92c12f698285d",
    "zcta_county": "3ed41278d637dc249e0323306f68be8a6c234e3090f4de88ef328dee71aeaaaf",
}

PLACE_HEADER = ["USPS", "GEOID", "ANSICODE", "NAME", "LSAD", "FUNCSTAT", "ALAND", "AWATER",
                "ALAND_SQMI", "AWATER_SQMI", "INTPTLAT", "INTPTLONG"]
ZCTA_PLACE_COLS = ["GEOID_ZCTA5_20", "GEOID_PLACE_20", "NAMELSAD_PLACE_20", "AREALAND_PART"]
ZCTA_COUNTY_COLS = ["GEOID_ZCTA5_20", "GEOID_COUNTY_20", "NAMELSAD_COUNTY_20", "AREALAND_PART"]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(raw_dir: str, key: str) -> str:
    src = SOURCES[key]
    path = os.path.join(raw_dir, src["file"])
    if not os.path.exists(path):
        print(f"downloading {src['url']}", file=sys.stderr)
        req = urllib.request.Request(src["url"], headers={"User-Agent": "smr-forge-places-build"})
        with urllib.request.urlopen(req, timeout=120) as r, open(path + ".part", "wb") as out:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                out.write(chunk)
        os.replace(path + ".part", path)
    digest = sha256(path)
    pinned = PINNED.get(key, "")
    if pinned and not pinned.startswith("PIN_") and digest != pinned:
        sys.exit(f"{src['file']}: SHA-256 {digest} does not match the pinned {pinned}. Stopping.")
    print(f"{src['file']}  sha256={digest}", file=sys.stderr)
    return path


def decode(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


def read_places(path: str):
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".txt")]
        if len(names) != 1:
            sys.exit(f"places zip: expected one .txt inside, found {names}")
        text = decode(z.read(names[0]))
    rows = list(csv.reader(io.StringIO(text), delimiter="\t"))
    header = [h.strip() for h in rows[0]]
    if header != PLACE_HEADER:
        sys.exit(f"places header changed: {header}")
    out = []
    for r in rows[1:]:
        if len(r) < len(PLACE_HEADER):
            continue
        rec = dict(zip(PLACE_HEADER, [c.strip() for c in r]))
        out.append(rec)
    if not (28000 <= len(out) <= 36000):
        sys.exit(f"places: {len(out)} rows is outside the expected range; not the real file?")
    return out


def read_rel(path: str, cols: list[str]):
    with open(path, "rb") as f:
        text = decode(f.read())
    reader = csv.reader(io.StringIO(text), delimiter="|")
    header = next(reader)
    for c in cols:
        if c not in header:
            sys.exit(f"{os.path.basename(path)}: column {c} missing; header is {header}")
    idx = {c: header.index(c) for c in cols}
    out = []
    for r in reader:
        if len(r) < len(header):
            continue
        out.append({c: r[i].strip() for c, i in idx.items()})
    if len(out) < 30000:
        sys.exit(f"{os.path.basename(path)}: only {len(out)} rows; not the real file?")
    return out


# Census place names end in a legal/statistical description ("Milwaukee city",
# "Ruby Valley CDP", "Nashville-Davidson metropolitan government (balance)").
# People never type those, so the trailing description is dropped: every
# trailing token that is all lowercase, a "(balance)" note, or "CDP".
def clean_place_name(name: str) -> str:
    tokens = name.split()
    while len(tokens) > 1:
        t = tokens[-1]
        if t == "CDP" or (t.startswith("(") and t.endswith(")")) or (t == t.lower() and any(ch.isalpha() for ch in t)):
            tokens.pop()
            continue
        break
    return " ".join(tokens)


def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw-dir", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    os.makedirs(args.raw_dir, exist_ok=True)

    places_raw = read_places(fetch(args.raw_dir, "places"))
    zp = read_rel(fetch(args.raw_dir, "zcta_place"), ZCTA_PLACE_COLS)
    zc = read_rel(fetch(args.raw_dir, "zcta_county"), ZCTA_COUNTY_COLS)

    # State FIPS (first two digits of any GEOID) to USPS code, from the places file.
    fips_to_usps: dict[str, str] = {}
    places: dict[str, dict] = {}
    for p in places_raw:
        fips_to_usps[p["GEOID"][:2]] = p["USPS"]
        places[p["GEOID"]] = {
            "name": clean_place_name(p["NAME"]),
            "st": p["USPS"],
            "incorporated": p["FUNCSTAT"] == "A",
            "aland": int(p["ALAND"] or 0),
            "weight": 0.0,
        }

    # Each ZCTA's land area, and its biggest place and county by shared land.
    # A ZIP is labeled with an incorporated place (a city, town or village)
    # when one overlaps it, ahead of a CDP: a rural ZIP that mostly covers open
    # land and a small unincorporated community is usually known by its town.
    # Among equals, the one sharing the most land wins.
    zcta_land: dict[str, int] = {}
    best_place: dict[str, tuple[tuple[bool, int], str]] = {}
    for r in zp:
        z, g = r["GEOID_ZCTA5_20"], r["GEOID_PLACE_20"]
        part = int(r["AREALAND_PART"] or 0)
        if not z:
            continue
        zcta_land[z] = zcta_land.get(z, 0) + part
        if g and g in places:
            rank = (places[g]["incorporated"], part)
            if z not in best_place or rank > best_place[z][0]:
                best_place[z] = (rank, g)
    counties: dict[str, dict] = {}
    best_county: dict[str, tuple[int, str]] = {}
    county_land: dict[str, int] = {}
    for r in zc:
        z, g = r["GEOID_ZCTA5_20"], r["GEOID_COUNTY_20"]
        part = int(r["AREALAND_PART"] or 0)
        if not z or not g:
            continue
        county_land[z] = county_land.get(z, 0) + part
        if g not in counties:
            st = fips_to_usps.get(g[:2])
            if not st:
                continue
            counties[g] = {"name": r["NAMELSAD_COUNTY_20"], "st": st}
        if part > best_county.get(z, (-1, ""))[0]:
            best_county[z] = (part, g)

    # Rank places by how many ZCTAs they cover (share of each ZCTA's land), a
    # stand-in for size that needs no extra source. Ties: incorporated places
    # first, then larger land area.
    for r in zp:
        z, g = r["GEOID_ZCTA5_20"], r["GEOID_PLACE_20"]
        if g in places and zcta_land.get(z):
            places[g]["weight"] += int(r["AREALAND_PART"] or 0) / zcta_land[z]

    ordered = sorted(
        places.items(),
        key=lambda kv: (-round(kv[1]["weight"], 3), not kv[1]["incorporated"], -kv[1]["aland"], kv[1]["name"]),
    )
    place_list: list[str] = []
    place_index: dict[str, int] = {}
    seen: dict[tuple[str, str], int] = {}
    for geoid, p in ordered:
        key = (fold(p["name"]), p["st"])
        if key in seen:  # same name twice in one state (a city and a CDP): keep the higher-ranked one
            place_index[geoid] = seen[key]
            continue
        seen[key] = len(place_list)
        place_index[geoid] = len(place_list)
        place_list.append(f"{p['name']}|{p['st']}")

    county_ids = sorted(counties, key=lambda g: (counties[g]["st"], counties[g]["name"]))
    county_index = {g: i for i, g in enumerate(county_ids)}
    county_list = [f"{counties[g]['name']}|{counties[g]['st']}" for g in county_ids]

    all_zctas = sorted(set(best_place) | set(best_county), key=int)
    deltas, zp_idx, zc_idx = [], [], []
    prev = 0
    for z in all_zctas:
        n = int(z)
        deltas.append(n - prev)
        prev = n
        zp_idx.append(place_index[best_place[z][1]] if z in best_place else -1)
        zc_idx.append(county_index[best_county[z][1]] if z in best_county else -1)

    out = {
        "v": 1,
        "vintage": "2020 Census geography",
        "source": "US Census Bureau: 2020 Gazetteer places; 2020 ZCTA5-to-place and ZCTA5-to-county relationship files",
        "places": place_list,
        "counties": county_list,
        "zips": {"delta": deltas, "place": zp_idx, "county": zc_idx},
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(
        f"wrote {args.out}: {len(place_list)} places, {len(county_list)} counties, {len(all_zctas)} ZCTAs",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
