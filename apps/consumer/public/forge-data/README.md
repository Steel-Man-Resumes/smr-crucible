# Forge location list

`us-places-2020.v1.json` feeds the "Where are you located?" suggestions in the Forge.
The browser loads it only when that field is focused, and every search runs on the
person's own device (`apps/consumer/lib/location-search.ts`). No query is sent anywhere.

## Source

US Census Bureau, public domain. Vintage: **2020 Census geography**.

| File | URL |
|---|---|
| 2020 Gazetteer, places | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_place_national.zip |
| 2020 ZCTA5 to place relationship | https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt |
| 2020 ZCTA5 to county relationship | https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt |

The SHA-256 of each file the current build came from is pinned in the build script,
which stops if a download does not match.

## Rebuild

```
python3 -I scripts/census-places/build_places.py \
  --raw-dir /some/new/empty/folder \
  --out apps/consumer/public/forge-data/us-places-2020.v1.json
```

Only the compact output is committed, never the raw downloads.

## What is in it

- `places`: "Name|ST", most likely first. Census descriptions ("city", "CDP") are dropped.
  Ranked by how many ZIP areas a place covers, then incorporated places, then land area.
- `counties`: "Name County|ST".
- `zips`: ZIP Code Tabulation Areas (sorted, stored as gaps), each with the place it is
  labeled by (an incorporated place first, then the most shared land) and its main county.

A ZCTA is the Census Bureau's area version of a ZIP code. It is close to the postal ZIP,
not identical, which is why the field always accepts free text too.

## Saved format

Place: `Milwaukee, WI`. ZIP: `Milwaukee, WI 53202`. County: `Lincoln County, MT`.
The analyze route reads the state with `lib/location-state.ts`.
