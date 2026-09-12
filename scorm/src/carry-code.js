/**
 * THE CARRY CODE
 *
 * The only thing that crosses the wall.
 *
 * WHY THIS EXISTS
 * The in-facility intake makes zero network calls, so nothing it collects can
 * be sent anywhere. The LMS holds a copy in cmi.suspend_data, but that copy
 * only reaches Steel Man Resumes if an institutional export pipeline exists,
 * and no such pipeline can be promised to anyone today.
 *
 * So the person carries it. Every fixed-choice answer in the intake is an
 * index or a bitmask. Packed together they are 43 bits. With a 7 bit CRC that
 * is exactly 50 bits, which is exactly 10 characters of base32. A person can
 * write ten characters on the back of a release paper.
 *
 * The result: the structured intake survives the wall with no integration,
 * no vendor cooperation, no server, and no network. The free text does not
 * fit and is not carried here. It rides in suspend_data, and if that copy
 * never arrives, the two free-text questions are re-asked outside in under a
 * minute. Nothing important is lost.
 *
 * ---------------------------------------------------------------------------
 * WHAT RIDES IN THE CODE, AND WHAT DOES NOT
 * ---------------------------------------------------------------------------
 * Version 2 adds the work history skeleton, and the reason is one field:
 * THE YEARS.
 *
 * A person spends ten minutes on the narrowing ladder working out that they
 * started at Miller Brothers in about 2018. That number was genuinely hard to
 * recover and it is four characters of code. Losing it would mean doing the
 * hardest part of the recall twice.
 *
 * What deliberately does NOT ride: the bullets themselves, employer names, and
 * the free text. Those are prose, they would multiply the code length several
 * times over, and the person is writing them on paper anyway. The write-down
 * sheet carries the words; the code carries everything that is an index, a
 * flag or a number.
 *
 * So the two exits are complementary by design rather than redundant. Neither
 * one alone is the plan.
 *
 * BIT LAYOUT, VERSION 1 (MSB first, total 50 bits)
 *
 *   bits  0-3   version         4 bits   value 1
 *   bits  4-5   readiness       2 bits   index into TABLES.READINESS
 *   bits  6-11  goals           6 bits   bitmask over TABLES.GOALS
 *   bits 12-20  challenges      9 bits   bitmask over TABLES.CHALLENGES
 *   bits 21-22  work_type       2 bits   index into TABLES.WORK_TYPE
 *   bits 23-36  skills         14 bits   bitmask over TABLES.SKILLS
 *   bits 37-42  state           6 bits   index into TABLES.STATES, 0 = none
 *   bits 43-49  checksum        7 bits   CRC-7 over bits 0-42
 *
 * Bit 0 of a bitmask is the FIRST entry in its table.
 *
 * BIT LAYOUT, VERSION 2 (MSB first, 53 + 12n bits for n jobs)
 *
 *   bits  0-3   version         4 bits   value 2
 *   bits  4-42  the same 39 bits of intake as version 1
 *   bits 43-45  job count       3 bits   0 to 7
 *   then, per job, 12 bits:
 *                 kind          4 bits   index into TABLES.WORK_KINDS
 *                 year          7 bits   0 = not known, else 1959 + value
 *                 approximate   1 bit    the year came from a range
 *   last 7 bits  checksum       7 bits   CRC-7 over everything before it
 *
 * The length is therefore a checksum in its own right: a code whose character
 * count does not match its declared job count is rejected before the CRC is
 * even consulted.
 *
 * VERSION 1 CODES STILL DECODE, FOREVER. Somebody may have written one on a
 * piece of paper. decode() dispatches on the version nibble and the version 1
 * path below is frozen.
 *
 * ALPHABET
 * The same 32 characters the online Mini Forge already uses for import codes:
 * 23456789ABCDEFGHJKLMNPQRSTUVWXYZ. Zero, one, I and O are excluded because
 * they are the characters people misread from their own handwriting.
 *
 * This file has no dependencies and runs unchanged in a browser and in Node.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tables.v1.js"));
  } else {
    root.CarryCode = factory(root.TABLES_V1);
  }
})(typeof self !== "undefined" ? self : this, function (TABLES) {
  "use strict";

  var ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  var CODE_LENGTH = 10;          // version 1, intake only
  var PAYLOAD_BITS = 43;         // version 1 payload
  var CHECK_BITS = 7;

  var VERSION = 2;
  var INTAKE_BITS = 43;          // version, readiness, goals, challenges, work, skills, state
  var COUNT_BITS = 3;            // up to 7 jobs
  var JOB_BITS = 12;             // kind 4, year 7, approx 1
  var MAX_JOBS = 7;
  var YEAR_BASE = 1959;          // year field 1..127 maps to 1960..2086
  var YEAR_MAX_OFFSET = 127;

  var LAYOUT = [
    { key: "version", bits: 4 },
    { key: "readiness", bits: 2 },
    { key: "goals", bits: 6 },
    { key: "challenges", bits: 9 },
    { key: "work_type", bits: 2 },
    { key: "skills", bits: 14 },
    { key: "state", bits: 6 }
  ];

  // ---------------------------------------------------------------- bit io

  function BitWriter() {
    this.bits = [];
  }
  BitWriter.prototype.write = function (value, width) {
    if (value < 0 || value >= Math.pow(2, width)) {
      throw new Error("carry-code: value " + value + " does not fit in " + width + " bits");
    }
    for (var i = width - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  };

  function readBits(bits, offset, width) {
    var value = 0;
    for (var i = 0; i < width; i++) {
      value = (value << 1) | bits[offset + i];
    }
    return value;
  }

  /**
   * CRC-7, polynomial x^7 + x^3 + 1 (0x09). Chosen because it is seven lines
   * long and a reviewer can confirm it by eye. It catches every single bit
   * error and every burst shorter than eight bits, which covers essentially
   * all handwriting transcription mistakes.
   */
  function crc7(bits) {
    var reg = 0;
    for (var i = 0; i < bits.length; i++) {
      var topBit = (reg >> 6) & 1;
      reg = ((reg << 1) & 0x7f) | bits[i];
      if (topBit) reg ^= 0x09;
    }
    return reg & 0x7f;
  }

  // ------------------------------------------------------------- bitmasks

  function maskFromIds(table, ids) {
    var mask = 0;
    if (!ids) return 0;
    for (var i = 0; i < ids.length; i++) {
      var index = indexOfId(table, ids[i]);
      if (index >= 0) mask |= 1 << index;
    }
    return mask;
  }

  function idsFromMask(table, mask) {
    var out = [];
    for (var i = 0; i < table.length; i++) {
      if (mask & (1 << i)) out.push(table[i].id);
    }
    return out;
  }

  function indexOfId(table, id) {
    for (var i = 0; i < table.length; i++) {
      if (table[i].id === id) return i;
    }
    return -1;
  }

  // -------------------------------------------------------------- encoding

  /**
   * @param {object} intake Field ids matching the online Mini Forge intake.
   * @returns {string} A ten character code, grouped as XXXX-XXXX-XX.
   */
  function encode(intake) {
    intake = intake || {};

    var readiness = indexOfId(TABLES.READINESS, intake.readiness_stage);
    var workType = indexOfId(TABLES.WORK_TYPE, intake.work_type);
    var state = indexOfId(TABLES.STATES, intake.state || "");

    var w = new BitWriter();
    w.write(TABLES.VERSION, 4);
    w.write(readiness < 0 ? 0 : readiness, 2);
    w.write(maskFromIds(TABLES.GOALS, intake.goals), 6);
    w.write(maskFromIds(TABLES.CHALLENGES, intake.challenges), 9);
    w.write(workType < 0 ? 0 : workType, 2);
    w.write(maskFromIds(TABLES.SKILLS, intake.skills), 14);
    w.write(state < 0 ? 0 : state, 6);

    if (w.bits.length !== PAYLOAD_BITS) {
      throw new Error("carry-code: payload is " + w.bits.length + " bits, expected " + PAYLOAD_BITS);
    }

    var check = crc7(w.bits);
    for (var i = CHECK_BITS - 1; i >= 0; i--) w.bits.push((check >> i) & 1);

    var code = "";
    for (var b = 0; b < w.bits.length; b += 5) {
      code += ALPHABET.charAt(readBits(w.bits, b, 5));
    }
    return code;
  }

  /**
   * Version 2. The intake plus the work history skeleton.
   *
   * @param {object} intake  the same fields encode() takes
   * @param {Array}  jobs    [{ kind, year_started, year_approx }]
   */
  function encodeFull(intake, jobs) {
    intake = intake || {};
    jobs = (jobs || []).slice(0, MAX_JOBS);

    var readiness = indexOfId(TABLES.READINESS, intake.readiness_stage);
    var workType = indexOfId(TABLES.WORK_TYPE, intake.work_type);
    var state = indexOfId(TABLES.STATES, intake.state || "");

    var w = new BitWriter();
    w.write(VERSION, 4);
    w.write(readiness < 0 ? 0 : readiness, 2);
    w.write(maskFromIds(TABLES.GOALS, intake.goals), 6);
    w.write(maskFromIds(TABLES.CHALLENGES, intake.challenges), 9);
    w.write(workType < 0 ? 0 : workType, 2);
    w.write(maskFromIds(TABLES.SKILLS, intake.skills), 14);
    w.write(state < 0 ? 0 : state, 6);
    w.write(jobs.length, COUNT_BITS);

    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i] || {};
      var kind = indexOfId(TABLES.WORK_KINDS, job.kind);
      w.write(kind < 0 ? 0 : kind, 4);
      w.write(yearToField(job.year_started), 7);
      w.write(job.year_approx ? 1 : 0, 1);
    }

    var expected = INTAKE_BITS + COUNT_BITS + JOB_BITS * jobs.length;
    if (w.bits.length !== expected) {
      throw new Error("carry-code: payload is " + w.bits.length + " bits, expected " + expected);
    }

    var check = crc7(w.bits);
    for (var c = CHECK_BITS - 1; c >= 0; c--) w.bits.push((check >> c) & 1);

    // Pad to a whole number of characters with zeros. The decoder knows the
    // real length from the job count, so padding is unambiguous.
    while (w.bits.length % 5 !== 0) w.bits.push(0);

    var code = "";
    for (var b = 0; b < w.bits.length; b += 5) {
      code += ALPHABET.charAt(readBits(w.bits, b, 5));
    }
    return code;
  }

  /** A year to its 7 bit field. 0 means the person could not place it. */
  function yearToField(year) {
    if (typeof year !== "number" || !isFinite(year)) return 0;
    var offset = year - YEAR_BASE;
    if (offset < 1 || offset > YEAR_MAX_OFFSET) return 0;
    return offset;
  }

  function fieldToYear(field) {
    return field === 0 ? null : YEAR_BASE + field;
  }

  /** How many characters a version 2 code with n jobs must be. */
  function lengthForJobs(n) {
    var bits = INTAKE_BITS + COUNT_BITS + JOB_BITS * n + CHECK_BITS;
    return Math.ceil(bits / 5);
  }

  /**
   * Groups of five, which is how people copy things down without losing their
   * place. Works for any length.
   */
  function format(code) {
    var out = [];
    for (var i = 0; i < code.length; i += 5) out.push(code.slice(i, i + 5));
    return out.join("-");
  }

  // -------------------------------------------------------------- decoding

  /**
   * Forgiving on formatting, strict on content.
   * @returns {{ok:true, intake:object}|{ok:false, error:string, message:string}}
   */
  function decode(input) {
    var raw = String(input || "").toUpperCase().replace(/[\s\-_.]/g, "");

    if (raw.length === 0) {
      return fail("empty", "Enter your code.");
    }
    for (var i = 0; i < raw.length; i++) {
      if (ALPHABET.indexOf(raw.charAt(i)) === -1) {
        return fail(
          "bad_character",
          'The character "' + raw.charAt(i) + '" is not used in these codes. ' +
          "Codes never contain the letter O, the letter I, the number zero, or the number one."
        );
      }
    }
    var bits = [];
    for (var c = 0; c < raw.length; c++) {
      var v = ALPHABET.indexOf(raw.charAt(c));
      for (var k = 4; k >= 0; k--) bits.push((v >> k) & 1);
    }

    // Length before version. A five character typo would otherwise read its
    // version nibble out of the first character, land on a version nobody has
    // ever issued, and tell the person their code came from a different tool.
    // "You are missing characters" is both true and actionable; "wrong
    // version" is neither.
    if (raw.length < CODE_LENGTH) {
      return fail(
        "bad_length",
        "That code is too short. The shortest one we make is " + CODE_LENGTH +
        " characters and you entered " + raw.length + "."
      );
    }

    var version = readBits(bits, 0, 4);

    // Version 1 codes may be sitting on somebody's paperwork. They decode
    // forever, unchanged.
    if (version === 1) return decodeV1(raw, bits);
    if (version === VERSION) return decodeV2(raw, bits);
    return fail("version", "That code was made by a different version of this tool.");
  }

  function decodeV1(raw, bits) {
    if (raw.length !== CODE_LENGTH) {
      return fail(
        "bad_length",
        "Codes like that one are " + CODE_LENGTH + " characters. You entered " + raw.length + "."
      );
    }

    var payload = bits.slice(0, PAYLOAD_BITS);
    var given = readBits(bits, PAYLOAD_BITS, CHECK_BITS);
    if (crc7(payload) !== given) {
      return fail("checksum", "That code did not check out. Look for a character that is easy to mix up and try again.");
    }

    // STATES is the one field whose bit width (6 bits, 64 values) is wider
    // than its table (52 entries), so a corrupt code that happens to pass CRC
    // could index past the end. Everything else is exactly sized.
    var stateEntry = TABLES.STATES[readBits(payload, 37, 6)];
    if (!stateEntry) {
      return fail("checksum", "That code did not check out. Check each character and try again.");
    }

    return {
      ok: true,
      jobs: [],
      intake: {
        carry_code_version: 1,
        readiness_stage: TABLES.READINESS[readBits(payload, 4, 2)].id,
        goals: idsFromMask(TABLES.GOALS, readBits(payload, 6, 6)),
        challenges: idsFromMask(TABLES.CHALLENGES, readBits(payload, 12, 9)),
        work_type: TABLES.WORK_TYPE[readBits(payload, 21, 2)].id,
        skills: idsFromMask(TABLES.SKILLS, readBits(payload, 23, 14)),
        state: stateEntry.id
      }
    };
  }

  /**
   * Version 2. The length is checked against the declared job count BEFORE the
   * CRC, because a length mismatch tells the person something useful ("you are
   * missing characters") where a checksum failure only tells them something is
   * wrong somewhere.
   */
  function decodeV2(raw, bits) {
    if (bits.length < INTAKE_BITS + COUNT_BITS + CHECK_BITS) {
      return fail("bad_length", "That code is missing characters. Check you copied all of it.");
    }

    var jobCount = readBits(bits, INTAKE_BITS, COUNT_BITS);
    var expected = lengthForJobs(jobCount);
    if (raw.length !== expected) {
      return fail(
        "bad_length",
        "That code should be " + expected + " characters and you entered " + raw.length + ". " +
        "Check for a missing character rather than a wrong one."
      );
    }

    var payloadBits = INTAKE_BITS + COUNT_BITS + JOB_BITS * jobCount;
    var payload = bits.slice(0, payloadBits);
    var given = readBits(bits, payloadBits, CHECK_BITS);
    if (crc7(payload) !== given) {
      return fail("checksum", "That code did not check out. Look for a character that is easy to mix up and try again.");
    }

    var stateEntry = TABLES.STATES[readBits(payload, 37, 6)];
    if (!stateEntry) {
      return fail("checksum", "That code did not check out. Check each character and try again.");
    }

    var jobs = [];
    for (var i = 0; i < jobCount; i++) {
      var at = INTAKE_BITS + COUNT_BITS + JOB_BITS * i;
      var kindEntry = TABLES.WORK_KINDS[readBits(payload, at, 4)];
      if (!kindEntry) {
        return fail("checksum", "That code did not check out. Check each character and try again.");
      }
      jobs.push({
        kind: kindEntry.id,
        year_started: fieldToYear(readBits(payload, at + 4, 7)),
        year_approx: readBits(payload, at + 11, 1) === 1
      });
    }

    return {
      ok: true,
      jobs: jobs,
      intake: {
        carry_code_version: 2,
        readiness_stage: TABLES.READINESS[readBits(payload, 4, 2)].id,
        goals: idsFromMask(TABLES.GOALS, readBits(payload, 6, 6)),
        challenges: idsFromMask(TABLES.CHALLENGES, readBits(payload, 12, 9)),
        work_type: TABLES.WORK_TYPE[readBits(payload, 21, 2)].id,
        skills: idsFromMask(TABLES.SKILLS, readBits(payload, 23, 14)),
        state: stateEntry.id
      }
    };
  }

  function fail(error, message) {
    return { ok: false, error: error, message: message };
  }

  return {
    ALPHABET: ALPHABET,
    CODE_LENGTH: CODE_LENGTH,
    VERSION: VERSION,
    MAX_JOBS: MAX_JOBS,
    LAYOUT: LAYOUT,
    encode: encode,
    encodeFull: encodeFull,
    decode: decode,
    format: format,
    lengthForJobs: lengthForJobs
  };
});
