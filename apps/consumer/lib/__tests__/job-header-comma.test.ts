import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsIn } from "@crucible/core/src/jobResolver";
import { jobHeaderReview, ownJobHeaderForFix } from "../finish-gate";
const source = "WORK HISTORY\nWarehouse Associate, North Valley Supply, Kalispell MT, March 2021 - July 2024\nLoaded delivery trucks.\nStock Clerk, Mountain Hardware Store, Libby MT, August 2018 - February 2021\nStocked shelves.";
const header = "Warehouse Associate | North Valley Supply | Kalispell, MT | March 2021 - July 2024";
const page = (h: string) => `SAM EXAMPLE\nWORK HISTORY\n${h}\nLoaded delivery trucks.`;
test("long comma headers resolve and punctuation is not a changed place", () => {
 assert.equal(jobsIn(source, { own: true }).length, 2);
 assert.deepEqual(jobHeaderReview(header, source, page(header)).changes, []);
});
test("changed city and month still require correction with an unambiguous restore", () => {
 const changed = header.replace("Kalispell", "Missoula").replace("March 2021", "April 2021");
 assert.deepEqual(jobHeaderReview(changed, source, page(changed)).changes, ["Missoula, MT", "April 2021"]);
 assert.equal(ownJobHeaderForFix(changed, page(changed), source), source.split("\n")[1]);
});
test("repeated stints cannot be silently combined or restored", () => {
 const twice = `${source}\nWarehouse Associate, North Valley Supply, Kalispell MT, March 2015 - July 2017\nLoaded trucks.`;
 const merged = header.replace("March 2021", "March 2015");
 assert.ok(jobHeaderReview(merged, twice, page(merged)).dates);
 assert.equal(ownJobHeaderForFix(merged, page(merged), twice), undefined);
});
