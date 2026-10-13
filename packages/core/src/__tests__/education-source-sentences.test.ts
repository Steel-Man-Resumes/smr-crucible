import { test } from "node:test";
import assert from "node:assert/strict";
import { credentialsToAsk } from "../credentialMentions";

const source = "EDUCATION\nHigh school diploma | Example High School | 2020";

test("a supplied school credential stays supplied in a plain narrative sentence", () => {
  for (const text of [
    "I hold a high school diploma from Example High School.",
    "Earned a high school diploma in 2020.",
    "I packed orders. I hold a high school diploma from Example High School. I answered phones.",
  ]) assert.equal(credentialsToAsk(`Dear Hiring Manager,\n${text}`, source).length, 0, text);
});

test("school sentence proof preserves type, school, year, and completion status", () => {
  for (const text of [
    "I hold a GED from Example High School.",
    "I hold a high school diploma from Another School.",
    "I earned a high school diploma in 2021.",
    "I earned a high school diploma with honors.",
    "I hold a high school diploma from Example High School and a nursing license.",
    "I earned a high school diploma in 2020. My diploma includes honors.",
  ]) assert.ok(credentialsToAsk(`Dear Hiring Manager,\n${text}`, source).length > 0, text);
  for (const own of [
    "High school diploma | Example High School | in progress",
    "I did not finish my high school diploma.",
    "High school diploma | Example High School | expected 2020",
    "High school diploma | Example High School | Anticipated 2027",
    "High school diploma | Example High School | Due 2027",
    "High school diploma | Example High School | 2020 | No diploma awarded",
    "High school diploma | Example High School no diploma awarded | 2020",
    "High school diploma | Example High School unfinished | 2020",
    "High school diploma | Example High School anticipated | 2027",
    "Attended Example High School | 2020",
    "GED | Example High School | 2020",
  ]) assert.ok(credentialsToAsk("Dear Hiring Manager,\nI hold a high school diploma from Example High School.", `EDUCATION\n${own}`).length > 0, own);
});
