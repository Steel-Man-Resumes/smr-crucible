/**
 * An employer's city comes from the person. Tested with a real sample resume:
 * the person named "Badger Stamping" with no city, and the resume put it in
 * the city from their contact line.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripUnsupportedJobCities } from "../job-line-truth";

const source = [
  "ANTHONY BELL",
  "Waukesha WI | anthony.bell@example.com",
  "Production Supervisor, Kettle Ridge Plastics, 2020 - present",
  "Machine Operator, Badger Stamping, 2014 - 2017",
  "Line Cook, Harbor Street Grill, Kansas City MO, 2019 - present",
].join("\n");

describe("employer cities", () => {
  it("removes a city the person never gave for that employer", () => {
    const r = stripUnsupportedJobCities("MACHINE OPERATOR | Badger Stamping | Waukesha, WI | 2014 - 2017", source);
    assert.equal(r.text, "MACHINE OPERATOR | Badger Stamping | 2014 - 2017");
    assert.equal(r.removed, 1);
  });

  it("keeps a city the person gave on that employer's line", () => {
    const line = "LINE COOK | Harbor Street Grill | Kansas City, MO | 2019 - Present";
    assert.equal(stripUnsupportedJobCities(line, source).text, line);
  });

  it("leaves the contact line and education lines alone", () => {
    const text = "ANTHONY BELL\nWaukesha, WI | anthony.bell@example.com\n\nWaukesha County Technical College, Waukesha, WI | 2019";
    assert.equal(stripUnsupportedJobCities(text, source).text, text);
  });

  it("leaves a job line with no city alone", () => {
    const line = "PRODUCTION SUPERVISOR | Kettle Ridge Plastics | 2020 - Present";
    assert.equal(stripUnsupportedJobCities(line, source).text, line);
  });
});

describe("employer cities, harder layouts", () => {
  it("finds the city on the line after the employer", () => {
    const src = "Welder\nAcme Fabrication Inc.\nSt. Louis, MO\n2016 - 2020";
    const line = "WELDER | Acme Fabrication | Saint Louis, MO | 2016 - 2020";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("keeps a true city when the company is named after it", () => {
    const src = "Machinist, Waukesha Metal Products, Waukesha WI, 2015 - 2019";
    const line = "MACHINIST | Waukesha Metal Products | Waukesha, WI | 2015 - 2019";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("does not count a city that is only part of the company name", () => {
    const src = "Machinist, Waukesha Metal Products, 2015 - 2019";
    const r = stripUnsupportedJobCities("MACHINIST | Waukesha Metal Products | Waukesha, WI | 2015 - 2019", src);
    assert.equal(r.text, "MACHINIST | Waukesha Metal Products | 2015 - 2019");
    assert.deepEqual(r.removedCities, ["Waukesha Metal Products: Waukesha, WI"]);
  });
});

describe("employer blocks and states", () => {
  it("does not borrow the next job's city", () => {
    const src = "Picker, Lakeshore Distribution, 2011 - 2013\nForklift operator, Midwest Pallet Supply, Grand Rapids MI, 2013 - 2018";
    const r = stripUnsupportedJobCities("PICKER | Lakeshore Distribution | Grand Rapids, MI | 2011 - 2013", src);
    assert.equal(r.text, "PICKER | Lakeshore Distribution | 2011 - 2013");
  });

  it("a different state is not the same place", () => {
    const src = "Driver, Heartland Freight, Kansas City MO, 2018 - 2022";
    const r = stripUnsupportedJobCities("DRIVER | Heartland Freight | Kansas City, KS | 2018 - 2022", src);
    assert.equal(r.text, "DRIVER | Heartland Freight | 2018 - 2022");
  });
});
