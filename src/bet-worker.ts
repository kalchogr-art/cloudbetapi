// ============================================================
// CLOUDBET BET WORKER V4.5
// READ ONLY — SECURE SIGNAL -> MATCHER -> CLOUDBET
//
// V4.5 TEAM MATCHING FIX
//
// CHANGES FROM V4.4:
//
// 1. SECURE_MATCH=false НЕ Е автоматичен отказ.
//
// 2. CONFIDENT_MATCH се приема.
//
// 3. Силен положителен matcher score >= 0.45 се приема,
//    ако двустранната проверка на отборите е валидна.
//
// 4. SCORE_ONLY_MATCH остава винаги BLOCKED.
//
// 5. EXACT_ID с matcher score 0 остава BLOCKED.
//
// 6. EXACT_ID с положителен matcher score е разрешен.
//
// 7. SIGNAL <-> V27 TEAM VALIDATION:
//      - normal direction
//      - reversed direction
//      - exact normalized names
//      - token containment
//      - token similarity
//      - abbreviation / alias support
//
// 8. TWO-SIDED TEAM VALIDATION остава задължителна.
//
// 9. НЕ се приема само един отбор.
//
// 10. CLOUDBET /live се извиква САМО ВЕДНЪЖ.
//
// 11. Cloudbet се проверява независимо след Matcher.
//
// 12. Добавена е подробна диагностика за team matching.
//
// IMPORTANT:
// - READ ONLY
// - BETTING DISABLED
// - NO BET IS PLACED
// ============================================================


interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
}


type AnyObj = Record<string, any>;


// ============================================================
// CONFIG
// ============================================================

const VERSION = "V4.5";

const MODE = "READ_ONLY";

const BETTING_ENABLED = false;

const MATCHER_THRESHOLD = 0.45;

const TOKEN_TEAM_MIN_SCORE = 0.45;

const REQUIRED_MATCH_CLASSIFICATION = "CONFIDENT_MATCH";

const REQUIRED_SECURE_MATCH = true;

const ALLOWED_SIGNAL_TYPE = "HUNTER_ENTRY";

const TARGET_SPORT = "SOCCER";

const TARGET_PERIOD = "FIRST_HALF";

const TARGET_OUTCOME = "OVER";

const TARGET_LINE = 0.5;


// ============================================================
// V4.5 MATCH ACCEPTANCE
// ============================================================

const STRONG_MATCHER_SCORE = 0.45;

const MIN_MATCHER_SCORE = 0.45;


// ============================================================
// V4.5 TEAM MATCH SETTINGS
// ============================================================

const TEAM_EXACT_SCORE = 1.0;

const TEAM_TOKEN_SCORE = 0.85;

const TEAM_PARTIAL_SCORE = 0.75;

const TEAM_MIN_ACCEPT_SCORE = 0.75;


// ============================================================
// JSON
// ============================================================

function json(
  data: any,
  status = 200
): Response {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",

        "cache-control":
          "no-store, no-cache, must-revalidate",

        "pragma":
          "no-cache",

        "expires":
          "0"
      }
    }
  );
}


// ============================================================
// SERVICE FETCH
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  options: RequestInit = {}
): Promise<any> {

  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method:
            options.method ??
            "GET",

          headers: {
            "accept":
              "application/json",

            ...(options.headers ?? {})
          },

          body:
            options.body
        }
      )
    );


  const text =
    await response.text();


  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status} ${path}: ${text.slice(0, 500)}`
    );
  }


  if (!text.trim()) {
    return {};
  }


  try {

    return JSON.parse(text);

  } catch {

    throw new Error(
      `Invalid JSON from ${path}`
    );
  }
}


// ============================================================
// SAFE STRING
// ============================================================

function safeString(
  value: any
): string {

  return String(
    value ?? ""
  ).trim();
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeText(
  value: any
): string {

  return safeString(value)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /['’`]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// TEAM EXTRACTION
// ============================================================

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {

  const text =
    safeString(value);


  if (!text) {

    return {
      home: null,
      away: null
    };
  }


  const separators = [
    " - ",
    " v ",
    " vs ",
    " VS ",
    " @ "
  ];


  for (
    const separator
    of separators
  ) {

    const index =
      text.indexOf(
        separator
      );


    if (index >= 0) {

      return {

        home:
          text
            .slice(
              0,
              index
            )
            .trim(),

        away:
          text
            .slice(
              index +
              separator.length
            )
            .trim()
      };
    }
  }


  return {
    home: null,
    away: null
  };
}


// ============================================================
// HOME
// ============================================================

function extractHome(
  match: AnyObj
): string {

  if (
    typeof match?.home ===
    "string"
  ) {

    return match.home.trim();
  }


  if (
    typeof match?.homeTeam ===
    "string"
  ) {

    return match.homeTeam.trim();
  }


  if (
    typeof match?.home_name ===
    "string"
  ) {

    return match.home_name.trim();
  }


  if (
    typeof match?.home_team ===
    "string"
  ) {

    return match.home_team.trim();
  }


  if (
    typeof match?.home?.name ===
    "string"
  ) {

    return match.home.name.trim();
  }


  if (
    typeof match?.teams?.home?.name ===
    "string"
  ) {

    return match.teams.home.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
      match?.event ??
      ""
    ).home ?? ""
  );
}


// ============================================================
// AWAY
// ============================================================

function extractAway(
  match: AnyObj
): string {

  if (
    typeof match?.away ===
    "string"
  ) {

    return match.away.trim();
  }


  if (
    typeof match?.awayTeam ===
    "string"
  ) {

    return match.awayTeam.trim();
  }


  if (
    typeof match?.away_name ===
    "string"
  ) {

    return match.away_name.trim();
  }


  if (
    typeof match?.away_team ===
    "string"
  ) {

    return match.away_team.trim();
  }


  if (
    typeof match?.away?.name ===
    "string"
  ) {

    return match.away.name.trim();
  }


  if (
    typeof match?.teams?.away?.name ===
    "string"
  ) {

    return match.teams.away.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
      match?.event ??
      ""
    ).away ?? ""
  );
}


// ============================================================
// DISPLAY MATCH
// ============================================================

function displayMatch(
  match: AnyObj
): string {

  const direct =
    safeString(
      match?.match ??
      match?.name ??
      match?.event
    );


  if (direct) {
    return direct;
  }


  const home =
    extractHome(match);


  const away =
    extractAway(match);


  return `${home} - ${away}`;
}


// ============================================================
// MATCH ID
// ============================================================

function extractMatchId(
  match: AnyObj
): string {

  return safeString(
    match?.id ??
    match?.match_id ??
    match?.matchId ??
    match?.event_id ??
    match?.eventId ??
    match?.key
  );
}


// ============================================================
// GENERIC TEAM WORDS
// ============================================================

const GENERIC_WORDS =
  new Set([
    "fc",
    "cf",
    "sc",
    "ac",
    "afc",
    "ca",
    "cd",
    "sd",
    "ss",
    "as",
    "us",
    "ud",
    "aa",
    "ad",
    "rc",
    "fk",
    "sk",
    "ks",
    "sv",
    "vfb",
    "vfl",
    "club",
    "calcio",
    "spa",
    "srl",
    "football",
    "soccer",
    "team",
    "women",
    "woman",
    "men",
    "u18",
    "u19",
    "u20",
    "u21",
    "u23",
    "reserves",
    "reserve"
  ]);


// ============================================================
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES:
  Record<string, string> = {

  "man city":
    "manchester city",

  "man utd":
    "manchester united",

  "man united":
    "manchester united",

  "man u":
    "manchester united",

  "manchester utd":
    "manchester united",

  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  "inter":
    "inter milan",

  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "fc internazionale":
    "inter milan",

  "atletico":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid",

  "sporting cp":
    "sporting lisbon",

  "sporting lisboa":
    "sporting lisbon",

  "red star":
    "crvena zvezda",

  "red star belgrade":
    "crvena zvezda",

  "psv eindhoven":
    "psv",

  "bayern munchen":
    "bayern munich",

  "bayern munchen fc":
    "bayern munich",

  "utd":
    "united",

  "ath":
    "athletic",

  "dep":
    "deportivo",

  "depor":
    "deportivo",

  "sparta":
    "sparta prague",

  "sparta praha":
    "sparta prague",

  "cska moscow":
    "cska moskva",

  "cska sofia":
    "cska",

  "lokomotiv moskva":
    "lokomotiv moscow",

  "lokomotiv sofia":
    "lokomotiv",

  "rapid wien":
    "rapid vienna",

  "dinamo zagreb":
    "dinamo",

  "fc porto":
    "porto",

  "benfica lisbon":
    "benfica",

  "sport lisboa e benfica":
    "benfica",

  "real madrid cf":
    "real madrid",

  "barcelona fc":
    "barcelona",

  "barca":
    "barcelona"
};


// ============================================================
// APPLY ALIASES
// ============================================================

function applyAliases(
  value: string
): string {

  let result =
    normalizeText(value);


  if (!result) {
    return "";
  }


  const aliases =
    Object.keys(
      TEAM_ALIASES
    ).sort(
      (a, b) =>
        b.length -
        a.length
    );


  for (
    const alias
    of aliases
  ) {

    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );


    const regex =
      new RegExp(
        `(^|\\s)${escaped}(?=\\s|$)`,
        "g"
      );


    result =
      result.replace(
        regex,
        `$1${TEAM_ALIASES[alias]}`
      );
  }


  return result
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// NORMALIZE TEAM
// ============================================================

function normalizeTeam(
  value: any
): string {

  const normalized =
    applyAliases(
      safeString(value)
    );


  if (!normalized) {
    return "";
  }


  return normalized
    .split(" ")
    .filter(Boolean)
    .filter(
      word =>
        !GENERIC_WORDS.has(word)
    )
    .filter(
      word =>
        !/^\d+$/.test(word)
    )
    .join(" ")
    .trim();
}


// ============================================================
// TEAM TOKENS
// ============================================================

function teamTokens(
  value: any
): string[] {

  const normalized =
    normalizeTeam(value);


  if (!normalized) {
    return [];
  }


  return normalized
    .split(" ")
    .filter(Boolean);
}


// ============================================================
// JACCARD TOKEN SCORE
// ============================================================

function tokenSimilarity(
  a: any,
  b: any
): number {

  const A =
    new Set(
      teamTokens(a)
    );


  const B =
    new Set(
      teamTokens(b)
    );


  if (
    A.size === 0 ||
    B.size === 0
  ) {

    return 0;
  }


  let intersection =
    0;


  for (
    const token
    of A
  ) {

    if (
      B.has(token)
    ) {

      intersection++;
    }
  }


  const union =
    new Set([
      ...A,
      ...B
    ]).size;


  if (!union) {
    return 0;
  }


  return (
    intersection /
    union
  );
}


// ============================================================
// CHARACTER SIMILARITY
// ============================================================

function characterSimilarity(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(a)
      .replace(/\s/g, "");


  const B =
    normalizeTeam(b)
      .replace(/\s/g, "");


  if (
    !A ||
    !B
  ) {

    return 0;
  }


  if (A === B) {
    return 1;
  }


  const maxLength =
    Math.max(
      A.length,
      B.length
    );


  const distance =
    levenshtein(
      A,
      B
    );


  if (!maxLength) {
    return 0;
  }


  return (
    1 -
    distance /
    maxLength
  );
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(
  a: string,
  b: string
): number {

  if (a === b) {
    return 0;
  }


  if (!a.length) {
    return b.length;
  }


  if (!b.length) {
    return a.length;
  }


  let previous =
    new Array(
      b.length + 1
    );


  let current =
    new Array(
      b.length + 1
    );


  for (
    let j = 0;
    j <= b.length;
    j++
  ) {

    previous[j] = j;
  }


  for (
    let i = 1;
    i <= a.length;
    i++
  ) {

    current[0] = i;


    for (
      let j = 1;
      j <= b.length;
      j++
    ) {

      const cost =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;


      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );
    }


    const temp =
      previous;


    previous =
      current;


    current =
      temp;
  }


  return previous[b.length];
}


// ============================================================
// ONE TEAM MATCH
//
// IMPORTANT:
// This is NOT score-only matching.
//
// We still require the actual team identity to be compatible.
// ============================================================

function compareTeams(
  a: any,
  b: any
): AnyObj {

  const rawA =
    safeString(a);


  const rawB =
    safeString(b);


  const A =
    normalizeTeam(rawA);


  const B =
    normalizeTeam(rawB);


  if (
    !A ||
    !B
  ) {

    return {

      matched:
        false,

      score:
        0,

      method:
        "EMPTY_TEAM",

      a:
        rawA,

      b:
        rawB
    };
  }


  // ----------------------------------------------------------
  // EXACT NORMALIZED
  // ----------------------------------------------------------

  if (A === B) {

    return {

      matched:
        true,

      score:
        TEAM_EXACT_SCORE,

      method:
        "EXACT_NORMALIZED",

      a:
        rawA,

      b:
        rawB,

      normalized_a:
        A,

      normalized_b:
        B
    };
  }


  // ----------------------------------------------------------
  // TOKEN SET
  // ----------------------------------------------------------

  const tokenScore =
    tokenSimilarity(
      A,
      B
    );


  if (
    tokenScore >=
    TEAM_TOKEN_SCORE
  ) {

    return {

      matched:
        true,

      score:
        tokenScore,

      method:
        "TOKEN_SIMILARITY",

      a:
        rawA,

      b:
        rawB,

      normalized_a:
        A,

      normalized_b:
        B
    };
  }


  // ----------------------------------------------------------
  // CONTAINMENT
  // ----------------------------------------------------------

  const compactA =
    A.replace(
      /\s/g,
      ""
    );


  const compactB =
    B.replace(
      /\s/g,
      ""
    );


  if (
    compactA.length >= 4 &&
    compactB.length >= 4 &&
    (
      compactA.includes(compactB) ||
      compactB.includes(compactA)
    )
  ) {

    return {

      matched:
        true,

      score:
        TEAM_PARTIAL_SCORE,

      method:
        "TOKEN_CONTAINMENT",

      a:
        rawA,

      b:
        rawB,

      normalized_a:
        A,

      normalized_b:
        B
    };
  }


  // ----------------------------------------------------------
  // CHARACTER SIMILARITY
  // ----------------------------------------------------------

  const charScore =
    characterSimilarity(
      A,
      B
    );


  if (
    charScore >=
    0.90
  ) {

    return {

      matched:
        true,

      score:
        charScore,

      method:
        "CHARACTER_SIMILARITY",

      a:
        rawA,

      b:
        rawB,

      normalized_a:
        A,

      normalized_b:
        B
    };
  }


  return {

    matched:
      false,

    score:
      Math.max(
        tokenScore,
        charScore
      ),

    method:
      "TEAM_MISMATCH",

    a:
      rawA,

    b:
      rawB,

    normalized_a:
      A,

    normalized_b:
      B
  };
}


// ============================================================
// TWO-SIDED TEAM MATCH
//
// NORMAL:
//   signal home -> candidate home
//   signal away -> candidate away
//
// REVERSED:
//   signal home -> candidate away
//   signal away -> candidate home
//
// BOTH SIDES MUST MATCH.
// ============================================================

function teamsMatchEitherDirection(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): AnyObj {

  const normalHome =
    compareTeams(
      homeA,
      homeB
    );


  const normalAway =
    compareTeams(
      awayA,
      awayB
    );


  const normal =
    normalHome.matched &&
    normalAway.matched;


  if (normal) {

    return {

      matched:
        true,

      direction:
        "NORMAL",

      score:
        (
          normalHome.score +
          normalAway.score
        ) / 2,

      home:
        normalHome,

      away:
        normalAway
    };
  }


  const reversedHome =
    compareTeams(
      homeA,
      awayB
    );


  const reversedAway =
    compareTeams(
      awayA,
      homeB
    );


  const reversed =
    reversedHome.matched &&
    reversedAway.matched;


  if (reversed) {

    return {

      matched:
        true,

      direction:
        "REVERSED",

      score:
        (
          reversedHome.score +
          reversedAway.score
        ) / 2,

      home:
        reversedHome,

      away:
        reversedAway
    };
  }


  return {

    matched:
      false,

    direction:
      null,

    score:
      Math.max(
        (
          normalHome.score +
          normalAway.score
        ) / 2,

        (
          reversedHome.score +
          reversedAway.score
        ) / 2
      ),

    normal: {

      home:
        normalHome,

      away:
        normalAway
    },

    reversed: {

      home:
        reversedHome,

      away:
        reversedAway
    }
  };
}


// ============================================================
// TEAMS PRESENT
// ============================================================

function teamsPresent(
  home: any,
  away: any
): boolean {

  return (
    normalizeTeam(home).length > 0 &&
    normalizeTeam(away).length > 0
  );
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractSignals(
  data: any
): AnyObj[] {

  if (
    Array.isArray(
      data?.signals
    )
  ) {

    return data.signals;
  }


  if (
    Array.isArray(
      data?.entries
    )
  ) {

    return data.entries;
  }


  if (
    Array.isArray(
      data?.hunter_entries
    )
  ) {

    return data.hunter_entries;
  }


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;
  }


  return [];
}


// ============================================================
// HUNTER ENTRY FILTER
// ============================================================

function isHunterEntry(
  signal: AnyObj
): boolean {

  const type =
    safeString(
      signal?.type ??
      signal?.signal_type ??
      signal?.signalType
    ).toUpperCase();


  return (
    type ===
    ALLOWED_SIGNAL_TYPE
  );
}


// ============================================================
// SIGNAL ID
// ============================================================

function signalMatchId(
  signal: AnyObj
): string {

  return safeString(
    signal?.match_id ??
    signal?.matchId ??
    signal?.id
  );
}


// ============================================================
// SIGNAL NAME
// ============================================================

function signalMatchName(
  signal: AnyObj
): string {

  return safeString(
    signal?.match ??
    signal?.name
  );
}


// ============================================================
// SIGNAL HOME
// ============================================================

function signalHome(
  signal: AnyObj
): string {

  return extractHome(
    signal
  );
}


// ============================================================
// SIGNAL AWAY
// ============================================================

function signalAway(
  signal: AnyObj
): string {

  return extractAway(
    signal
  );
}


// ============================================================
// MATCHER RESPONSE
// ============================================================

function extractMatcherMatches(
  data: any
): AnyObj[] {

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;
  }


  if (
    Array.isArray(
      data?.results
    )
  ) {

    return data.results;
  }


  if (
    Array.isArray(
      data?.matched
    )
  ) {

    return data.matched;
  }


  if (
    Array.isArray(
      data?.candidates
    )
  ) {

    return data.candidates;
  }


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;
  }


  return [];
}


// ============================================================
// MATCHER SCORE
// ============================================================

function getMatcherScore(
  item: AnyObj
): number {

  const scoring =
    item?.scoring ??
    item?.matcher_scoring ??
    {};


  const rawScore =
    scoring?.total ??
    scoring?.score ??
    item?.matcher_score ??
    item?.match_score ??
    item?.score ??
    0;


  const score =
    Number(
      rawScore
    );


  return Number.isFinite(score)
    ? score
    : 0;
}


// ============================================================
// MATCHER CLASSIFICATION
// ============================================================

function getClassification(
  item: AnyObj
): string {

  return safeString(
    item?.classification ??
    item?.match_classification ??
    item?.security?.classification
  ).toUpperCase();
}


// ============================================================
// MATCH METHOD
// ============================================================

function getMatchMethod(
  item: AnyObj
): string {

  return safeString(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method
  ).toUpperCase();
}


// ============================================================
// SECURITY FLAG
// ============================================================

function getSecureFlag(
  item: AnyObj
): boolean {

  return (
    item?.security?.secure_match === true ||
    item?.secure_match === true
  );
}


// ============================================================
// SCORE ONLY
// ============================================================

function getScoreOnlyFlag(
  item: AnyObj
): boolean {

  return (
    item?.security?.score_only_match === true ||
    item?.score_only_match === true
  );
}


// ============================================================
// V27 EXTRACTION
// ============================================================

function extractV27FromMatcher(
  item: AnyObj
): AnyObj {

  return (
    item?.v27 ??
    item?.source ??
    item?.v27_match ??
    item?.source_match ??
    item
  );
}


// ============================================================
// CLOUDBET EXTRACTION
// ============================================================

function extractCloudbetFromMatcher(
  item: AnyObj
): AnyObj | null {

  const candidates = [
    item?.cloudbet,
    item?.cloudbet_match,
    item?.cloudbet_event,
    item?.matched_cloudbet,
    item?.target,
    item?.matched
  ];


  for (
    const candidate
    of candidates
  ) {

    if (
      candidate &&
      typeof candidate ===
      "object"
    ) {

      const home =
        extractHome(candidate);


      const away =
        extractAway(candidate);


      if (
        teamsPresent(
          home,
          away
        )
      ) {

        return candidate;
      }
    }
  }


  return null;
}


// ============================================================
// VALIDATE MATCHER CANDIDATE
// ============================================================

function validateMatcherCandidate(
  signal: AnyObj,
  item: AnyObj
): AnyObj {

  const v27 =
    extractV27FromMatcher(item);


  const cloudbet =
    extractCloudbetFromMatcher(item);


  const classification =
    getClassification(item);


  const method =
    getMatchMethod(item);


  const matcherScore =
    getMatcherScore(item);


  const secureFlag =
    getSecureFlag(item);


  const scoreOnly =
    getScoreOnlyFlag(item);


  const vHome =
    extractHome(v27);


  const vAway =
    extractAway(v27);


  const cHome =
    cloudbet
      ? extractHome(cloudbet)
      : "";


  const cAway =
    cloudbet
      ? extractAway(cloudbet)
      : "";


  const sHome =
    signalHome(signal);


  const sAway =
    signalAway(signal);


  // ----------------------------------------------------------
  // SCORE ONLY — HARD REJECT
  // ----------------------------------------------------------

  if (scoreOnly) {

    return {

      accepted:
        false,

      reason:
        "SCORE_ONLY_MATCH_REJECTED",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // V27 TEAMS
  // ----------------------------------------------------------

  if (
    !teamsPresent(
      vHome,
      vAway
    )
  ) {

    return {

      accepted:
        false,

      reason:
        "V27_TEAMS_EMPTY",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // CLOUDBET TARGET
  // ----------------------------------------------------------

  if (
    !cloudbet ||
    !teamsPresent(
      cHome,
      cAway
    )
  ) {

    return {

      accepted:
        false,

      reason:
        "MATCHER_CLOUDBET_TARGET_EMPTY",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // SIGNAL <-> V27 TWO-SIDED VALIDATION
  // ----------------------------------------------------------

  let teamValidation:
    AnyObj | null = null;


  if (
    sHome &&
    sAway
  ) {

    teamValidation =
      teamsMatchEitherDirection(
        sHome,
        sAway,
        vHome,
        vAway
      );


    if (
      !teamValidation.matched
    ) {

      return {

        accepted:
          false,

        reason:
          "SIGNAL_TEAMS_MISMATCH",

        classification,

        method,

        matcher_score:
          matcherScore,

        secure_flag:
          secureFlag,

        signal: {

          home:
            sHome,

          away:
            sAway
        },

        v27: {

          home:
            vHome,

          away:
            vAway
        },

        team_validation:
          teamValidation
      };
    }
  }


  // ----------------------------------------------------------
  // EXACT ID
  // ----------------------------------------------------------

  if (
    method ===
    "EXACT_ID" &&
    matcherScore <= 0
  ) {

    return {

      accepted:
        false,

      reason:
        "EXACT_ID_WITH_ZERO_SCORE_REJECTED",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // MATCHER SCORE
  // ----------------------------------------------------------

  if (
    matcherScore <
    MIN_MATCHER_SCORE
  ) {

    return {

      accepted:
        false,

      reason:
        "MATCHER_SCORE_TOO_LOW",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag,

      team_validation:
        teamValidation
    };
  }


  // ----------------------------------------------------------
  // ACCEPTANCE
  // ----------------------------------------------------------

  const confident =
    classification ===
    REQUIRED_MATCH_CLASSIFICATION;


  const strongScore =
    matcherScore >=
    STRONG_MATCHER_SCORE;


  if (
    !confident &&
    !strongScore
  ) {

    return {

      accepted:
        false,

      reason:
        "NOT_CONFIDENT_AND_SCORE_NOT_STRONG",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag,

      team_validation:
        teamValidation
    };
  }


  // ----------------------------------------------------------
  // ACCEPT
  //
  // secure_match=false is NOT a hard rejection.
  //
  // BUT:
  // - score_only is blocked
  // - teams must match both sides
  // - matcher score must be >= 0.45
  // - Cloudbet target must exist
  // ----------------------------------------------------------

  return {

    accepted:
      true,

    reason:
      confident
        ? "CONFIDENT_MATCH_ACCEPTED"
        : "STRONG_MATCHER_SCORE_ACCEPTED",

    classification:
      classification ||
      null,

    method:
      method ||
      null,

    matcher_score:
      matcherScore,

    secure_match:
      secureFlag,

    score_only_match:
      false,

    team_validation:
      teamValidation,

    v27: {

      id:
        extractMatchId(v27),

      match:
        displayMatch(v27),

      home:
        vHome,

      away:
        vAway
    },

    cloudbet: {

      id:
        extractMatchId(cloudbet),

      match:
        displayMatch(cloudbet),

      home:
        cHome,

      away:
        cAway
    },

    item
  };
}


// ============================================================
// FIND BEST MATCHER CANDIDATE
// ============================================================

function findBestMatcherCandidate(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj {

  const matches =
    extractMatcherMatches(
      matcherData
    );


  const rejectionReasons:
    Record<string, number> = {};


  let best:
    AnyObj | null = null;


  for (
    const item
    of matches
  ) {

    const result =
      validateMatcherCandidate(
        signal,
        item
      );


    if (
      result.accepted
    ) {

      if (
        !best ||
        result.matcher_score >
        best.matcher_score
      ) {

        best =
          result;
      }


      continue;
    }


    const reason =
      result.reason ??
      "UNKNOWN";


    rejectionReasons[reason] =
      (
        rejectionReasons[reason] ??
        0
      ) + 1;
  }


  if (best) {

    return {

      found:
        true,

      ...best,

      diagnostics: {

        candidates_checked:
          matches.length,

        rejection_reasons:
          rejectionReasons
      }
    };
  }


  return {

    found:
      false,

    reason:
      "NO_ACCEPTABLE_MATCHER_CANDIDATE",

    diagnostics: {

      candidates_checked:
        matches.length,

      rejection_reasons:
        rejectionReasons
    }
  };
}


// ============================================================
// CLOUDBET MATCH EXTRACTION
// ============================================================

function extractCloudbetMatches(
  data: any
): AnyObj[] {

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;
  }


  if (
    Array.isArray(
      data?.live_matches
    )
  ) {

    return data.live_matches;
  }


  if (
    Array.isArray(
      data?.events
    )
  ) {

    return data.events;
  }


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;
  }


  return [];
}


// ============================================================
// CLOUDBET LIVE
// ============================================================

function isCloudbetLive(
  match: AnyObj
): boolean {

  const status =
    safeString(
      match?.status
    ).toUpperCase();


  if (
    status ===
    "TRADING_LIVE"
  ) {

    return true;
  }


  if (
    status ===
    "LIVE"
  ) {

    return true;
  }


  if (
    match?.live === true
  ) {

    return true;
  }


  return false;
}


// ============================================================
// CLOUDBET SECURE VERIFICATION
//
// Cloudbet is checked independently.
// No additional network request.
// ============================================================

function verifyCloudbetMatch(
  secureMatcher: AnyObj,
  cloudbetMatches: AnyObj[]
): AnyObj {

  const target =
    secureMatcher?.cloudbet;


  if (!target) {

    return {

      verified:
        false,

      reason:
        "MATCHER_DID_NOT_RETURN_CLOUDBET_MATCH"
    };
  }


  const targetId =
    extractMatchId(
      target
    );


  const targetHome =
    normalizeTeam(
      extractHome(target)
    );


  const targetAway =
    normalizeTeam(
      extractAway(target)
    );


  if (
    !targetHome ||
    !targetAway
  ) {

    return {

      verified:
        false,

      reason:
        "MATCHER_CLOUDBET_TEAMS_EMPTY"
    };
  }


  // ----------------------------------------------------------
  // EXACT CLOUDBET ID + TWO-SIDED TEAM VALIDATION
  // ----------------------------------------------------------

  if (targetId) {

    for (
      const cb
      of cloudbetMatches
    ) {

      const cbId =
        extractMatchId(cb);


      if (
        cbId &&
        cbId === targetId
      ) {

        const cbHome =
          extractHome(cb);


        const cbAway =
          extractAway(cb);


        const validation =
          teamsMatchEitherDirection(
            targetHome,
            targetAway,
            cbHome,
            cbAway
          );


        if (
          validation.matched
        ) {

          return {

            verified:
              true,

            method:
              "CLOUDBET_ID_AND_TWO_SIDED_TEAMS",

            direction:
              validation.direction,

            team_score:
              validation.score,

            team_validation:
              validation,

            match:
              cb
          };
        }
      }
    }
  }


  // ----------------------------------------------------------
  // EXACT TWO-SIDED TEAM VERIFICATION
  // ----------------------------------------------------------

  for (
    const cb
    of cloudbetMatches
  ) {

    const cbHome =
      extractHome(cb);


    const cbAway =
      extractAway(cb);


    const validation =
      teamsMatchEitherDirection(
        targetHome,
        targetAway,
        cbHome,
        cbAway
      );


    if (
      validation.matched
    ) {

      return {

        verified:
          true,

        method:
          "CLOUDBET_TWO_SIDED_TEAMS",

        direction:
          validation.direction,

        team_score:
          validation.score,

        team_validation:
          validation,

        match:
          cb
      };
    }
  }


  return {

    verified:
      false,

    reason:
      "CLOUDBET_MATCH_NOT_CONFIRMED",

    target: {

      id:
        targetId,

      home:
        targetHome,

      away:
        targetAway
    }
  };
}


// ============================================================
// BUILD READY BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  secureMatcher: AnyObj,
  cloudbetVerification: AnyObj
): AnyObj {

  const cb =
    cloudbetVerification.match;


  return {

    status:
      "READY",

    betting:
      BETTING_ENABLED
        ? "ENABLED"
        : "DISABLED",

    sport:
      TARGET_SPORT,

    period:
      TARGET_PERIOD,

    outcome:
      TARGET_OUTCOME,

    line:
      TARGET_LINE,


    signal: {

      type:
        safeString(
          signal?.type ??
          signal?.signal_type
        ),

      match:
        signalMatchName(signal),

      match_id:
        signalMatchId(signal) ||
        null,

      home:
        signalHome(signal) ||
        null,

      away:
        signalAway(signal) ||
        null,

      entry_minute:
        signal?.entry_minute ??
        signal?.entryMinute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        null
    },


    cloudbet: {

      id:
        extractMatchId(cb) ||
        null,

      key:
        cb?.key ??
        null,

      match:
        displayMatch(cb),

      home:
        extractHome(cb),

      away:
        extractAway(cb),

      status:
        cb?.status ??
        null,

      live:
        cb?.live ??
        null,

      score:
        cb?.score ??
        null,

      minute:
        cb?.minute ??
        null,

      competition:
        cb?.competition ??
        null
    },


    matcher: {

      classification:
        secureMatcher.classification,

      match_method:
        secureMatcher.method,

      matcher_score:
        secureMatcher.matcher_score,

      reason:
        secureMatcher.reason,

      team_validation:
        secureMatcher.team_validation
    },


    security: {

      secure_match:
        true,

      score_only_match:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      matcher_confident:
        secureMatcher.classification ===
        REQUIRED_MATCH_CLASSIFICATION,

      strong_matcher_score:
        secureMatcher.matcher_score >=
        STRONG_MATCHER_SCORE,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_verified:
        true,

      cloudbet_verification_method:
        cloudbetVerification.method,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    action:
      "NO_BET_IN_V45_READY"
  };
}


// ============================================================
// BUILD NO MATCH
// ============================================================

function buildNoMatch(
  signal: AnyObj,
  reason: string,
  matcherInfo: AnyObj | null = null
): AnyObj {

  return {

    status:
      "NO_MATCH",

    betting:
      "DISABLED",

    sport:
      TARGET_SPORT,

    period:
      TARGET_PERIOD,

    outcome:
      TARGET_OUTCOME,

    line:
      TARGET_LINE,


    signal: {

      type:
        safeString(
          signal?.type ??
          signal?.signal_type
        ),

      match:
        signalMatchName(signal),

      match_id:
        signalMatchId(signal) ||
        null,

      home:
        signalHome(signal) ||
        null,

      away:
        signalAway(signal) ||
        null,

      entry_minute:
        signal?.entry_minute ??
        signal?.entryMinute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        null
    },


    matcher:
      matcherInfo,


    security: {

      secure_match:
        false,

      score_only_match:
        false,

      cloudbet_verified:
        false,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    action:
      "NO_BET_IN_V4_5",

    reason
  };
}


// ============================================================
// PROCESS V4.5
// ============================================================

async function runV45(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();


  // ==========================================================
  // TRACKER — ONE CALL
  // ==========================================================

  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );


  const allSignals =
    extractSignals(
      trackerData
    );


  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );


  // ==========================================================
  // NO ACTIVE SIGNALS
  // ==========================================================

  if (
    hunterEntries.length === 0
  ) {

    return json({

      success:
        true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      mode:
        MODE,

      betting:
        "DISABLED",


      bindings: {

        TRACKER:
          true,

        MATCHER:
          true,

        CLOUDBET:
          true
      },


      target: {

        sport:
          TARGET_SPORT,

        period:
          TARGET_PERIOD,

        outcome:
          TARGET_OUTCOME,

        line:
          TARGET_LINE
      },


      security: {

        secure_matching:
          true,

        score_only_matching:
          false,

        token_team_min_score:
          TOKEN_TEAM_MIN_SCORE,

        exact_id_alone_is_not_secure:
          true,

        exact_id_requires_positive_matcher_score:
          true,

        required_match_classification:
          REQUIRED_MATCH_CLASSIFICATION,

        required_secure_match:
          REQUIRED_SECURE_MATCH,

        two_sided_team_validation:
          true,

        reversed_direction_allowed:
          true,

        cloudbet_second_verification:
          true,

        v45_team_matching:
          true,

        v45_secure_flag_not_hard_rejection:
          true
      },


      tracker: {

        endpoint:
          "/entries",

        total_signals:
          allSignals.length,

        hunter_entries:
          0,

        active_signals:
          false
      },


      matcher: {

        called:
          false,

        reason:
          "NO_ACTIVE_HUNTER_ENTRIES"
      },


      cloudbet: {

        called:
          false,

        reason:
          "NO_ACTIVE_HUNTER_ENTRIES"
      },


      stats: {

        signals_received:
          allSignals.length,

        hunter_entries:
          0,

        matcher_secure_matches:
          0,

        cloudbet_verified_matches:
          0,

        bets_ready:
          0,

        no_match:
          0,

        processing_ms:
          Date.now() -
          started
      },


      prepared_bets:
        [],

      no_match:
        [],


      optimization: {

        tracker_calls:
          1,

        matcher_calls:
          0,

        cloudbet_live_calls:
          0,

        cloudbet_reused_for_all_signals:
          false
      },


      timestamp:
        new Date().toISOString()
    });
  }


  // ==========================================================
  // MATCHER — ONE CALL
  // ==========================================================

  const matcherData =
    await fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    );


  const matcherMatches =
    extractMatcherMatches(
      matcherData
    );


  // ==========================================================
  // CLOUDBET — ONE CALL
  // ==========================================================

  const cloudbetData =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );


  const rawCloudbet =
    extractCloudbetMatches(
      cloudbetData
    );


  const liveCloudbet =
    rawCloudbet.filter(
      isCloudbetLive
    );


  // ==========================================================
  // RESULT ARRAYS
  // ==========================================================

  const preparedBets:
    AnyObj[] = [];


  const noMatch:
    AnyObj[] = [];


  let matcherSecureMatches =
    0;


  let cloudbetVerifiedMatches =
    0;


  const rejectionReasons:
    Record<string, number> = {};


  // ==========================================================
  // PROCESS EVERY HUNTER SIGNAL
  // ==========================================================

  for (
    const signal
    of hunterEntries
  ) {

    const matcherResult =
      findBestMatcherCandidate(
        signal,
        matcherData
      );


    // --------------------------------------------------------
    // MATCHER FAILED
    // --------------------------------------------------------

    if (
      !matcherResult.found
    ) {

      const reason =
        matcherResult.reason ??
        "NO_ACCEPTABLE_MATCHER_CANDIDATE";


      rejectionReasons[reason] =
        (
          rejectionReasons[reason] ??
          0
        ) + 1;


      noMatch.push(
        buildNoMatch(
          signal,
          reason,
          {
            candidates_checked:
              matcherResult.diagnostics
                ?.candidates_checked ??
              0,

            rejection_reasons:
              matcherResult.diagnostics
                ?.rejection_reasons ??
              {}
          }
        )
      );


      continue;
    }


    // --------------------------------------------------------
    // MATCHER ACCEPTED
    // --------------------------------------------------------

    matcherSecureMatches++;


    // --------------------------------------------------------
    // CLOUDBET VERIFICATION
    //
    // NO NETWORK REQUEST HERE.
    // Uses the single /live response.
    // --------------------------------------------------------

    const cloudbetVerification =
      verifyCloudbetMatch(
        matcherResult,
        liveCloudbet
      );


    // --------------------------------------------------------
    // CLOUDBET FAILED
    // --------------------------------------------------------

    if (
      !cloudbetVerification.verified
    ) {

      const reason =
        cloudbetVerification.reason ??
        "CLOUDBET_MATCH_NOT_CONFIRMED";


      rejectionReasons[reason] =
        (
          rejectionReasons[reason] ??
          0
        ) + 1;


      noMatch.push({

        ...buildNoMatch(
          signal,
          reason,
          {

            classification:
              matcherResult.classification,

            match_method:
              matcherResult.method,

            matcher_score:
              matcherResult.matcher_score,

            matcher_reason:
              matcherResult.reason,

            v27:
              matcherResult.v27,

            cloudbet_target:
              matcherResult.cloudbet,

            team_validation:
              matcherResult.team_validation,

            cloudbet_diagnostics:
              cloudbetVerification
        }),

        security: {

          secure_match:
            true,

          score_only_match:
            false,

          cloudbet_verified:
            false,

          minimum_score_for_token_match:
            TOKEN_TEAM_MIN_SCORE
        }
      });


      continue;
    }


    // --------------------------------------------------------
    // CLOUDBET VERIFIED
    // --------------------------------------------------------

    cloudbetVerifiedMatches++;


    // --------------------------------------------------------
    // READY
    // --------------------------------------------------------

    preparedBets.push(
      buildPreparedBet(
        signal,
        matcherResult,
        cloudbetVerification
      )
    );
  }


  // ==========================================================
  // RESPONSE
  // ==========================================================

  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",


    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET:
        true
    },


    target: {

      sport:
        TARGET_SPORT,

      period:
        TARGET_PERIOD,

      outcome:
        TARGET_OUTCOME,

      line:
        TARGET_LINE
    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        TOKEN_TEAM_MIN_SCORE,

      exact_id_alone_is_not_secure:
        true,

      exact_id_requires_positive_matcher_score:
        true,

      required_match_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      required_secure_match:
        REQUIRED_SECURE_MATCH,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_second_verification:
        true,

      v45_team_matching:
        true,

      v45_secure_flag_not_hard_rejection:
        true
    },


    tracker: {

      endpoint:
        "/entries",

      total_signals:
        allSignals.length,

      hunter_entries:
        hunterEntries.length
    },


    matcher: {

      called:
        true,

      success:
        matcherData?.success === true,

      version:
        matcherData?.version ??
        null,

      confident_matched:
        matcherData?.confident_matched ??
        matcherData?.confidentMatches ??
        null,

      candidates_detected:
        matcherData?.candidates_detected ??
        matcherMatches.length,

      secure_matches:
        matcherSecureMatches,

      candidates_available:
        matcherMatches.length
    },


    cloudbet: {

      called:
        true,

      raw_matches:
        rawCloudbet.length,

      live_matches:
        liveCloudbet.length,

      verified_matches:
        cloudbetVerifiedMatches
    },


    stats: {

      signals_received:
        allSignals.length,

      hunter_entries:
        hunterEntries.length,

      matcher_secure_matches:
        matcherSecureMatches,

      cloudbet_verified_matches:
        cloudbetVerifiedMatches,

      bets_ready:
        preparedBets.length,

      no_match:
        noMatch.length,

      matcher_candidates:
        matcherMatches.length,

      processing_ms:
        Date.now() -
        started
    },


    diagnostics: {

      rejection_reasons:
        rejectionReasons,

      signals_with_matcher_failure:
        hunterEntries.length -
        matcherSecureMatches,

      signals_with_cloudbet_failure:
        matcherSecureMatches -
        cloudbetVerifiedMatches,

      v45_rules: {

        confident_match:
          "ACCEPT",

        strong_positive_score:
          `ACCEPT >= ${STRONG_MATCHER_SCORE}`,

        secure_match_false:
          "NO LONGER AUTOMATIC REJECTION",

        score_only:
          "ALWAYS REJECT",

        exact_id_zero_score:
          "ALWAYS REJECT",

        team_validation:
          "TWO SIDED",

        team_matching:
          "EXACT + TOKEN + CONTAINMENT + CHARACTER SIMILARITY",

        direction:
          "NORMAL OR REVERSED",

        cloudbet:
          "INDEPENDENT TWO SIDED VERIFICATION",

        cloudbet_fetch:
          "ONE /live CALL PER EXECUTION"
      }
    },


    optimization: {

      version:
        VERSION,

      tracker_calls:
        1,

      matcher_calls:
        1,

      cloudbet_live_calls:
        1,

      cloudbet_reused_for_all_signals:
        true,

      sequential_cloudbet_calls_per_signal:
        false
    },


    prepared_bets:
      preparedBets,


    no_match:
      noMatch,


    message:
      "V4.5 READ ONLY. Improved two-sided team matching with exact, token, containment and character similarity. Score-only and zero-score EXACT_ID matches remain blocked. Cloudbet is independently verified once.",


    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// HEALTH
// ============================================================

function health(): Response {

  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",


    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET:
        true
    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      exact_id_alone_is_secure:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      required_match_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_second_verification:
        true,

      strong_matcher_score:
        STRONG_MATCHER_SCORE,

      secure_flag_false_hard_rejection:
        false,

      v45_team_matching:
        true
    },


    team_matching: {

      exact_normalized:
        TEAM_EXACT_SCORE,

      token_similarity:
        TEAM_TOKEN_SCORE,

      containment:
        TEAM_PARTIAL_SCORE,

      character_similarity:
        0.90,

      minimum_team_match:
        TEAM_MIN_ACCEPT_SCORE
    },


    optimization: {

      version:
        VERSION,

      tracker_calls:
        1,

      matcher_calls:
        1,

      cloudbet_live_calls:
        1,

      cloudbet_reused_for_all_signals:
        true
    },


    endpoints: {

      tracker:
        "/entries",

      matcher:
        "/match",

      cloudbet:
        "/live"
    },


    rules: {

      no_active_signals:
        "NO MATCHER CALL / NO CLOUDBET CALL / NO BET",

      matcher:
        "CONFIDENT_MATCH preferred; strong positive matcher score accepted",

      exact_id:
        "EXACT_ID alone is not sufficient",

      matcher_score:
        "EXACT_ID with matcher score 0 is rejected",

      score_only:
        "score_only_match is always rejected",

      teams:
        "Both home and away must be present and compatible",

      team_matching:
        "Exact normalized, token similarity, containment or character similarity",

      direction:
        "Normal or reversed home/away direction accepted",

      secure_flag:
        "secure_match=false is not an automatic rejection in V4.5",

      cloudbet:
        "Cloudbet live event must be independently verified",

      cloudbet_fetch:
        "Cloudbet /live is called once per worker execution",

      betting:
        "DISABLED"
    },


    message:
      "V4.5 optimized READ ONLY secure preparation worker is healthy.",


    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(
        request.url
      );


    const path =
      url.pathname
        .replace(
          /\/+$/,
          ""
        ) ||
      "/";


    try {

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        path === "/" ||
        path === "/health"
      ) {

        return health();
      }


      // ------------------------------------------------------
      // MATCH / PREPARE
      // ------------------------------------------------------

      if (
        path === "/match" ||
        path === "/live" ||
        path === "/bet"
      ) {

        return runV45(
          env,
          request
        );
      }


      // ------------------------------------------------------
      // DIAGNOSTIC
      // ------------------------------------------------------

      if (
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {

        return runV45(
          env,
          request
        );
      }


      // ------------------------------------------------------
      // UNKNOWN
      // ------------------------------------------------------

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          mode:
            MODE,

          error:
            "Unknown endpoint",

          available_endpoints: [

            "/",

            "/health",

            "/match",

            "/live",

            "/bet",

            "/diagnostic"
          ]
        },

        404
      );

    } catch (
      error: any
    ) {

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          mode:
            MODE,

          betting:
            "DISABLED",

          error:
            error?.message ??
            String(error),

          timestamp:
            new Date().toISOString()
        },

        500
      );
    }
  }
};
