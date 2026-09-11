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
  var CODE_LENGTH = 10;
  var PAYLOAD_BITS = 43;
  var CHECK_BITS = 7;

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

  /** "ABCDEFGHJK" -> "ABCD-EFGH-JK". Display only. */
  function format(code) {
    return code.slice(0, 4) + "-" + code.slice(4, 8) + "-" + code.slice(8, 10);
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
    if (raw.length !== CODE_LENGTH) {
      return fail(
        "bad_length",
        "Codes are " + CODE_LENGTH + " characters. You entered " + raw.length + "."
      );
    }

    var bits = [];
    for (var c = 0; c < raw.length; c++) {
      var v = ALPHABET.indexOf(raw.charAt(c));
      for (var k = 4; k >= 0; k--) bits.push((v >> k) & 1);
    }

    var payload = bits.slice(0, PAYLOAD_BITS);
    var given = readBits(bits, PAYLOAD_BITS, CHECK_BITS);
    if (crc7(payload) !== given) {
      return fail("checksum", "That code did not check out. Look for a character that is easy to mix up and try again.");
    }

    var version = readBits(payload, 0, 4);
    if (version !== TABLES.VERSION) {
      return fail("version", "That code was made by a different version of this tool.");
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
      intake: {
        carry_code_version: version,
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
    LAYOUT: LAYOUT,
    encode: encode,
    decode: decode,
    format: format
  };
});
