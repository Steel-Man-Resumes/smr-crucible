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

  it("accepted miss: a city inside the company name is kept", () => {
    const src = "Machinist, Waukesha Metal Products, 2015 - 2019";
    assert.equal(stripUnsupportedJobCities("MACHINIST | Waukesha Metal Products | Waukesha, WI | 2015 - 2019", src).text, "MACHINIST | Waukesha Metal Products | Waukesha, WI | 2015 - 2019");
  });
});

describe("employer blocks and states", () => {
  it("accepted miss: a neighbor job's city is left to the truth check", () => {
    const src = "Picker, Lakeshore Distribution, 2011 - 2013\nForklift operator, Midwest Pallet Supply, Grand Rapids MI, 2013 - 2018";
    assert.equal(stripUnsupportedJobCities("PICKER | Lakeshore Distribution | Grand Rapids, MI | 2011 - 2013", src).text, "PICKER | Lakeshore Distribution | Grand Rapids, MI | 2011 - 2013");
  });

  it("accepted miss: a state mismatch is left to the truth check", () => {
    const src = "Driver, Heartland Freight, Kansas City MO, 2018 - 2022";
    assert.equal(stripUnsupportedJobCities("DRIVER | Heartland Freight | Kansas City, KS | 2018 - 2022", src).text, "DRIVER | Heartland Freight | Kansas City, KS | 2018 - 2022");
  });
});

describe("employer cities, review cases", () => {
  it("a lowercase word after the city is not a state", () => {
    const src = "Driver, Heartland Freight, Kansas City to Omaha routes, 2018 - 2022";
    const line = "DRIVER | Heartland Freight | Kansas City, MO | 2018 - 2022";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("a two-letter word that is not a state code is not a state", () => {
    const src = "Cook, Harbor Street Grill, Kansas City, KC area, 2019 - present";
    const line = "COOK | Harbor Street Grill | Kansas City, MO | 2019 - Present";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("finds the city on a bullet under the job's dates", () => {
    const src = "Acme Fabrication\n2016 - 2020\n- Welded trailer frames at the St. Louis MO plant";
    const line = "WELDER | Acme Fabrication | Saint Louis, MO | 2016 - 2020";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("finds the city on the line before the employer", () => {
    const src = "Kansas City MO\nHeartland Freight\n2018 - 2022";
    const line = "DRIVER | Heartland Freight | Kansas City, MO | 2018 - 2022";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("matches a company with an apostrophe", () => {
    const src = "Crew member, McDonald's, Racine WI, 2010 - 2012";
    const line = "CREW MEMBER | McDonalds | Racine, WI | 2010 - 2012";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });

  it("keeps the city when the employer is not in the person's words at all", () => {
    const src = "I worked at a stamping plant for three years.";
    const line = "MACHINE OPERATOR | Badger Stamping | Waukesha, WI | 2014 - 2017";
    assert.equal(stripUnsupportedJobCities(line, src).text, line);
  });
});

describe("employer cities, second review", () => {
  const keep = (src: string, line: string) => assert.equal(stripUnsupportedJobCities(line, src).text, line);
  it("Dallas-Fort Worth keeps Dallas", () =>
    keep("Driver, Heartland Freight, Dallas-Fort Worth area, 2018 - 2022", "DRIVER | Heartland Freight | Dallas, TX | 2018 - 2022"));
  it("Dallas-Fort Worth keeps Fort Worth", () =>
    keep("Driver, Heartland Freight, Dallas-Fort Worth area, 2018 - 2022", "DRIVER | Heartland Freight | Fort Worth, TX | 2018 - 2022"));
  it("Minneapolis-St. Paul keeps Saint Paul", () =>
    keep("Picker at Uline in Minneapolis-St. Paul, 2018 - 2022", "PICKER | Uline | Saint Paul, MN | 2018 - 2022"));
  it("Milwaukee-based keeps Milwaukee", () =>
    keep("Machine Operator, Badger Stamping, a Milwaukee-based shop, 2014 - 2017", "MACHINE OPERATOR | Badger Stamping | Milwaukee, WI | 2014 - 2017"));
  it("Winston Salem matches Winston-Salem", () =>
    keep("Cook, Harbor Street Grill, Winston Salem NC, 2019 - 2021", "COOK | Harbor Street Grill | Winston-Salem, NC | 2019 - 2021"));
  it("accepted miss: next job's city past this job's dates", () =>
    keep("Machine Operator\nBadger Stamping\n2014 - 2017\nForklift Driver\nUline\nKenosha, WI\n2017 - 2019",
      "MACHINE OPERATOR | Badger Stamping | Kenosha, WI | 2014 - 2017"));
  it("accepted miss: next job's city in a four-line layout", () =>
    keep("Machine Operator\nBadger Stamping\nWaukesha, WI\n2014 - 2017\nForklift Driver\nUline\nKenosha, WI\n2017 - 2019",
      "MACHINE OPERATOR | Badger Stamping | Kenosha, WI | 2014 - 2017"));
  it("accepted miss: previous job's city line", () =>
    keep("Badger Stamping, 2014 - 2017\nWaukesha, WI\nUline, 2017 - 2019", "FORKLIFT DRIVER | Uline | Waukesha, WI | 2017 - 2019"));
  it("a city line right after this job's dates is this job's", () =>
    keep("Acme Fabrication\n2016 - 2020\nSt. Louis, MO", "WELDER | Acme Fabrication | Saint Louis, MO | 2016 - 2020"));
  it("all caps: IN is not read as a state", () =>
    keep("DRIVER FOR HEARTLAND FREIGHT IN KANSAS CITY IN 2018 TO 2022", "DRIVER | Heartland Freight | Kansas City, MO | 2018 - 2022"));
  it("company hyphen still matches", () =>
    keep("Cashier, Wal-Mart, Racine WI, 2010 - 2012", "CASHIER | Walmart | Racine, WI | 2010 - 2012"));
});

describe("employer cities, contact lines only", () => {
  const drop = (src: string, line: string) => assert.notEqual(stripUnsupportedJobCities(line, src).text, line);
  const keep = (src: string, line: string) => assert.equal(stripUnsupportedJobCities(line, src).text, line);
  it("removes a home city from a street-address line", () =>
    drop("Dana Reyes\n412 N Main St, Racine WI 53403\n(262) 555-0144\nCook, Harbor Street Grill, 2019 - present", "COOK | Harbor Street Grill | Racine, WI | 2019 - Present"));
  it("removes a home city from a header city line next to an email", () =>
    drop("Dana Reyes\nRacine, WI\ndana.reyes@example.com\n\nCook, Harbor Street Grill, 2019 - present", "COOK | Harbor Street Grill | Racine, WI | 2019 - Present"));
  it("keeps a home city the person also gave for the job", () =>
    keep("Dana Reyes\nRacine, WI | dana.reyes@example.com\nCook, Harbor Street Grill, Racine WI, 2019 - present", "COOK | Harbor Street Grill | Racine, WI | 2019 - Present"));
  it("keeps a city named in the person's story", () =>
    keep("Racine WI | dana.reyes@example.com\nCook, Harbor Street Grill, 2019 - present\n\nI cooked at Harbor Street Grill in Racine for years.", "COOK | Harbor Street Grill | Racine, WI | 2019 - Present"));
  it("keeps a city on an employer's address line", () =>
    keep("Picker, Uline, 12575 Uline Dr, Pleasant Prairie WI, 2018 - 2022", "PICKER | Uline | Pleasant Prairie, WI | 2018 - 2022"));
  it("keeps a job city with a ZIP", () =>
    keep("Forklift Driver\nUline\n2017 - 2019\nKenosha, WI 53144", "FORKLIFT DRIVER | Uline | Kenosha, WI | 2017 - 2019"));
});
