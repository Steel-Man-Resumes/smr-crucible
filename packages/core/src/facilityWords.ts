/**
 * Word lists for the facility matcher (creativeLaneShared, review s2r3
 * N3-H1). Pure data, safe in the browser.
 *
 * A hidden facility name is split into words. Some words say what KIND of
 * place it is (generic), some say WHERE it is (state and big-city names,
 * place prefixes like "San" or "Fort"), and the rest say WHICH place it is
 * (distinctive). Combined review rulings: a distinctive word alone is only
 * ASKED about (one tap, the page is a draft until answered), in any field.
 * It is held when it sits within four words of a facility word or an
 * incarceration phrase, or in a run of two naming words ("San Quentin").
 *
 * These lists are a hint, not a gazetteer. COMMON_WORDS is kept as a record
 * of words known to name other things too; it no longer changes the tier.
 */

const set = (s: string) => new Set(s.trim().split(/\s+/));

/** Words that say what KIND of place a facility is, not WHICH one. */
export const FACILITY_GENERIC_WORDS: ReadonlySet<string> = set(`
  state county federal city department dept division bureau office
  correctional correction corrections prison prisons jail jails penitentiary penitentiaries pen
  facility facilities institution institutions institute center centers centre centres
  detention unit units camp camps complex annex yard yards house houses hall
  reformatory reception diagnostic classification medical regional community adult adults
  youth juvenile women womens men mens female male minimum medium maximum security
  treatment rehabilitation rehabilitative transition transitional prerelease release work
  honor farm colony program programs residential reentry halfway
  fci fcc fpc fdc usp mcc mdc smu cf ci cc ccf sci mci doc cdcr tdcj bop dc cdc
  north south east west northern southern eastern western northeast northwest southeast southwest central
  upper lower old the
  college colleges university universities school schools academy
`);

/** A word that names a kind of facility. A word of a hidden name within three words of one holds the line ("Folsom prison"). */
export const FACILITY_NEAR_WORDS: ReadonlySet<string> = set(`
  prison prisons correctional correction corrections jail jails institution institutions facility facilities
  penitentiary penitentiaries unit units camp camps yard yards detention
  fci fcc fpc fdc usp mcc mdc sci mci ci cf cc ccf
`);

/**
 * Words and phrases that say someone was held somewhere (combined review
 * C-H2). A kept-off name's word within four words of one of these, or of a
 * facility word, is held outright: "I served time at Folsom", "inmates at
 * Attica". Each phrase is matched word by word, case and punctuation aside.
 */
export const INCARCERATION_PHRASES: readonly string[] = [
  "served time", "did time", "doing time", "do time", "inmate", "inmates", "incarcerated", "incarceration",
  "prisoner", "prisoners", "locked up", "behind bars", "while inside", "on the inside", "the yard", "my bid",
  "state time", "county time", "federal time",
];

/**
 * Release and custody wording (combined review r2, C2-H1): a kept-off word
 * within four words of one of these is held until the person answers (one
 * tap; "No" puts it back), never a fixed hold, because "released from Cook
 * County Hospital" can be a true fact.
 */
export const RELEASE_PHRASES: readonly string[] = [
  "released from", "paroled", "parole", "sentenced to", "transferred to", "transferred from", "in custody",
  "booked into", "held at", "did my time", "came home from",
  // Combined review r3 (R3-L1): how people say it on a phone.
  "got out of", "got out", "yrs at", "years at", "time at", "months at", "did time at",
];

/** US state names (each word), and the two-letter codes. Never distinctive. */
export const STATE_WORDS: ReadonlySet<string> = set(`
  alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho
  illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota
  mississippi missouri montana nebraska nevada hampshire jersey mexico york carolina dakota ohio oklahoma
  oregon pennsylvania rhode island tennessee texas utah vermont virginia washington wisconsin wyoming
  columbia puerto rico guam
  al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd
  oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc pr
`);

/** Two-letter state codes and full state names, for spotting a place ("Folsom, CA"). */
export const STATE_CODES: ReadonlySet<string> = set(`
  al ak az ar ca co ct de fl ga hi id il in ia ks ky la me md ma mi mn ms mo mt ne nv nh nj nm ny nc nd
  oh ok or pa ri sc sd tn tx ut vt va wa wv wi wy dc pr
`);

/** Full US state names, for spotting a place ("Folsom, California"). */
export const STATE_NAMES: readonly string[] = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia",
  "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland",
  "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
  "West Virginia", "Wisconsin", "Wyoming", "Puerto Rico",
];

/**
 * Words that start or shape a town's name ("San", "New", "Fort", "Township").
 * Never distinctive on their own. Landscape words ("Valley", "Bay", "Creek")
 * are NOT here: in a facility's name they help pick it out, so they count in
 * runs ("Valley State Prison") and, alone, are only asked about.
 */
export const PLACE_WORDS: ReadonlySet<string> = set(`
  san santa santo saint sainte st ste new fort ft mount mt port los las la el del de des le
  town township village parish borough
`);

/**
 * Big US cities (and a few world ones), each word. Never distinctive: a
 * facility named for one ("Huntsville Unit") is held by its full name, a
 * nearby facility word ("Huntsville prison") or a nickname the person adds.
 */
export const BIG_CITY_WORDS: ReadonlySet<string> = set(`
  chicago houston phoenix philadelphia antonio diego dallas jose austin jacksonville worth columbus
  charlotte francisco indianapolis seattle denver boston paso nashville detroit portland vegas memphis
  louisville baltimore milwaukee albuquerque tucson fresno mesa sacramento atlanta omaha raleigh miami
  oakland minneapolis tulsa tampa arlington orleans wichita bakersfield cleveland aurora anaheim honolulu
  riverside corpus christi lexington henderson stockton paul cincinnati louis pittsburgh greensboro lincoln
  anchorage plano orlando irvine newark durham chula vista toledo wayne petersburg laredo chandler madison
  lubbock scottsdale reno buffalo gilbert glendale winston salem chesapeake norfolk garland irving hialeah
  fremont boise richmond baton rouge spokane moines tacoma bernardino modesto fontana clarita birmingham
  oxnard fayetteville moreno rochester huntington rapids amarillo yonkers montgomery akron shreveport
  augusta overland tallahassee mobile knoxville worcester providence jackson huntsville springfield peoria
  joliet salt angeles dublin london paris toronto
`);

/**
 * Distinctive words that also commonly name something else: a town where a
 * prison sits, a person, or a plain word. Alone, one is asked about (one
 * tap), never held.
 */
export const COMMON_WORDS: ReadonlySet<string> = set(`
  valley valleys bay creek lake lakes river rivers island isle beach springs falls heights hills park point
  harbor harbour grove mountain mountains
  green haven great meadow meadows view coffee coyote ridge pine pines oak oaks cedar cedars elm elms willow
  willows rock rocks stone stones red white black blue gray grey golden gold silver sun sunset sunrise star
  eagle hawk wolf bear deer elk fox buffalo pelican falcon raven crow badger lion tiger bull horse moose
  brook brooks field fields wood woods forest prairie plains desert canyon garden gardens orchard ranch
  hill crest summit peak rose hope liberty freedom independence union unity victory pleasant fair sing
  cross bridge mill mills well wells spring fork forks gap glen dale vale shade shady maple birch ash
  hickory cypress magnolia laurel ivy holly sand sandy clay iron copper coal salt lime marble granite
  arrow arrowhead shield anchor bell bells church chapel temple castle tower gate gates wall walls
  harbor beacon light lights hope hopes grace mercy charity faith trinity heritage pioneer frontier
  sterling diamond crystal pearl jade ruby echo summit vista horizon dawn twin twins three seven
  lee jackson johnson williams smith brown davis miller wilson moore taylor anderson thomas white harris
  martin thompson garcia martinez robinson clark lewis walker hall allen young king wright scott baker
  adams nelson campbell mitchell roberts carter phillips evans turner parker collins edwards stewart
  morris murphy cook rogers morgan cooper peterson reed bailey kelly howard ward cox richardson watson
  brooks bennett gray james hughes price sanders long foster ross butler powell perry russell sullivan
  bell coleman jenkins barnes fisher henderson graham wallace hayes ford hamilton marshall grant
  washington jefferson madison monroe lincoln franklin hamilton kennedy roosevelt truman wayne boone
  crockett houston austin travis bowie lamar polk tyler pierce hayes garfield arthur cleveland harrison
  mckinley hoover clinton bush reagan nixon johnson carter
  john james robert michael william david richard joseph charles thomas christopher daniel matthew
  anthony mark donald steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason
  jeffrey ryan jacob gary nicholas eric jonathan stephen larry justin scott brandon benjamin samuel
  mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty margaret
  sandra ashley kimberly emily donna michelle carol amanda dorothy melissa deborah stephanie rebecca
  sharon laura cynthia kathleen amy angela shirley anna brenda pamela emma nicole helen samantha
  katherine christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia
  folsom soledad corcoran chino norco vacaville tracy delano avenal coalinga ione susanville blythe
  calipatria tehachapi wasco lancaster chowchilla lompoc atwater ossining dannemora attica auburn elmira
  marion leavenworth florence beaumont butner hazelton allenwood lewisburg otisville danbury pontiac
  menard dixon waupun stillwater walla shelton pendleton canon hutchinson concord walpole bridgewater
  framingham somers enfield cheshire livingston gatesville angola parchman raiford starke reidsville
  atmore wetumpka moundsville lucasville chillicothe marysville mansfield lebanon ionia coldwater
  marquette trenton rahway graterford huntingdon waymart comstock malone fishkill coxsackie marcy
  collins albion bedford woodbourne wallkill napanoch lorton jessup hagerstown cumberland waynesburg
  frackville mahanoy somerset rockview muncy sterling limon ely carson lovelock orofino cottonwood
  billings sheridan rawlins torrington riverton glendive shelby lodge terre haute oshkosh lansing
  ellsworth eldorado norwalk greenville bennettsville ridgeland columbia pikeville eddyville lagrange
  ashland fairton yazoo pollock oakdale talladega edgefield estill jesup coleman sumterville tallahassee
  marianna aliceville montgomery bastrop seagoville sandstone waseca oxford pekin thomson greenville
  yankton duluth englewood safford tucson victorville herlong terminal mendota sheridan dublin
`);
