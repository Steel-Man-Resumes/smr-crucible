/**
 * JOB TITLES -- VERSION 1
 *
 * ---------------------------------------------------------------------------
 * WHY A TITLE IS NOT THE SAME AS A KIND OF WORK
 * ---------------------------------------------------------------------------
 * Until now the resume printed the work KIND as the job title: "Warehouse or
 * shipping". That is how the person describes their work to us. It is not how
 * a resume says it, and it is not what an applicant tracking system is looking
 * for. Every job on a capable resume carries a title a hiring manager and a
 * parser both recognise: Warehouse Associate, Line Cook, Custodian, Groundskeeper.
 *
 * So the kind of work chooses the questions, and the title goes on the page.
 *
 * ---------------------------------------------------------------------------
 * HOW THESE WERE CHOSEN
 * ---------------------------------------------------------------------------
 * REAL TITLES, THE ONES POSTINGS USE. Each one is a phrase that appears in job
 * postings and in the O*NET-style vocabulary parsers are trained on. A title
 * nobody advertises for is worth nothing in a keyword match.
 *
 * A LADDER INSIDE EVERY LIST. Each trade carries an entry-level title, the
 * ordinary title, one or two specific ones, and a lead title. Most people will
 * not reach for the lead title about themselves, and for some of them it is
 * the truest thing on the page, so it has to be visible to be recognised.
 *
 * NOTHING HERE CLAIMS A LICENCE. A person picks what was true. The list offers
 * titles, never credentials -- what somebody is certified in is a separate
 * question with its own answer, in credentials.v1.js, because a title on a
 * resume that implies a licence the person does not hold is the one kind of
 * error that ends an interview badly.
 *
 * EIGHT PER TRADE, DELIBERATELY. Four options is the rule on a recall screen,
 * where the person is producing a memory. This is recognition, not recall: the
 * title is on the list or it is not, and a short list forces people into a
 * title that is not theirs. The screen paginates rather than truncating.
 *
 * FROZEN, like tables.v1.js. A title index rides out on a carry code and may
 * be redeemed eighteen months later. Labels can be corrected for wording.
 * Order and position cannot change, ever.
 */

/* eslint-disable */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TITLES_V1 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /**
   * Keyed by WORK_KINDS id. Position in the array is the wire value: the code
   * stores index + 1, so 0 stays free to mean "typed their own, or none".
   */
  var TITLES = {
    warehouse: [
      "Warehouse Associate",
      "Material Handler",
      "Forklift Operator",
      "Shipping and Receiving Clerk",
      "Order Picker and Packer",
      "Inventory Control Clerk",
      "Loader and Unloader",
      "Warehouse Lead"
    ],
    construction: [
      "Construction Laborer",
      "General Laborer",
      "Carpenter Helper",
      "Concrete Finisher",
      "Drywall Installer",
      "Framer",
      "Demolition Laborer",
      "Crew Foreman"
    ],
    kitchen: [
      "Line Cook",
      "Prep Cook",
      "Dishwasher",
      "Food Prep Worker",
      "Short Order Cook",
      "Expediter",
      "Head Cook",
      "Kitchen Supervisor"
    ],
    cleaning: [
      "Custodian",
      "Janitor",
      "Housekeeper",
      "Floor Technician",
      "Building Maintenance Worker",
      "Sanitation Worker",
      "Custodial Lead",
      "Cleaning Crew Supervisor"
    ],
    driving: [
      "Delivery Driver",
      "Route Driver",
      "Truck Driver",
      "Courier",
      "Driver Helper",
      "Shuttle Driver",
      "Dispatcher",
      "Lead Driver"
    ],
    production: [
      "Production Associate",
      "Machine Operator",
      "Assembler",
      "Packaging Operator",
      "Press Operator",
      "Quality Inspector",
      "Maintenance Helper",
      "Production Lead"
    ],
    grounds: [
      "Groundskeeper",
      "Landscaper",
      "Lawn Care Technician",
      "Grounds Maintenance Worker",
      "Tree Trimmer",
      "Irrigation Technician",
      "Snow Removal Operator",
      "Grounds Crew Lead"
    ],
    retail: [
      "Sales Associate",
      "Cashier",
      "Stock Associate",
      "Customer Service Representative",
      "Merchandiser",
      "Store Clerk",
      "Department Lead",
      "Shift Supervisor"
    ],
    auto: [
      "Automotive Technician",
      "Mechanic Helper",
      "Tire Technician",
      "Lube and Oil Technician",
      "Auto Detailer",
      "Parts Counter Associate",
      "Diesel Mechanic",
      "Shop Lead"
    ],
    care: [
      "Caregiver",
      "Personal Care Assistant",
      "Direct Support Professional",
      "Home Health Aide",
      "Resident Assistant",
      "Dietary Aide",
      "Companion Caregiver",
      "Care Team Lead"
    ],
    office: [
      "Administrative Assistant",
      "Data Entry Clerk",
      "Receptionist",
      "Office Assistant",
      "File and Records Clerk",
      "Customer Service Representative",
      "Scheduler",
      "Office Coordinator"
    ],
    security: [
      "Security Officer",
      "Security Guard",
      "Gate Attendant",
      "Access Control Officer",
      "Loss Prevention Associate",
      "Patrol Officer",
      "Front Desk Officer",
      "Security Shift Lead"
    ],
    personal: [
      "Barber",
      "Barber Apprentice",
      "Hairstylist",
      "Braider and Loctician",
      "Nail Technician",
      "Shop Assistant",
      "Salon Receptionist",
      "Shop Manager"
    ],
    farm: [
      "Farm Worker",
      "Ranch Hand",
      "Field Laborer",
      "Livestock Handler",
      "Harvest Crew Member",
      "Dairy Worker",
      "Farm Equipment Operator",
      "Crew Lead"
    ],
    teaching: [
      "Tutor",
      "Teacher Aide",
      "Classroom Assistant",
      "Instructor",
      "Program Facilitator",
      "Peer Educator",
      "Mentor",
      "Coach"
    ],
    other_work: [
      "General Laborer",
      "Crew Member",
      "Team Member",
      "Helper",
      "Operator",
      "Technician",
      "Assistant",
      "Shift Lead"
    ]
  };

  /** How many bits a title index needs. 0 = typed or none, 1-8 = the list. */
  var TITLE_BITS = 4;

  function forKind(kindId) {
    return TITLES[kindId] || TITLES.other_work;
  }

  /**
   * The wire value for a title. Returns 0 when the person typed their own or
   * picked nothing, which is exactly what 0 means on the way back out.
   */
  function indexOf(kindId, title) {
    var list = forKind(kindId);
    for (var i = 0; i < list.length; i++) {
      if (list[i] === title) return i + 1;
    }
    return 0;
  }

  /** @returns {string} "" when the value is 0 or out of range. */
  function fromIndex(kindId, value) {
    if (!value) return "";
    var list = forKind(kindId);
    return list[value - 1] || "";
  }

  return {
    TITLES: TITLES,
    TITLE_BITS: TITLE_BITS,
    forKind: forKind,
    indexOf: indexOf,
    fromIndex: fromIndex
  };
});
