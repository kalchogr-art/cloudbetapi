// ============================================================
// CLOUDBET BET WORKER V4.7
// READ ONLY — BETTING DISABLED
//
// TRACKER -> MATCHER -> CLOUDBET
//                     \-> DIRECT CLOUDBET FALLBACK
//
// V4.7 FIX:
//
// 1. ROBUST TEAM EXTRACTION.
// 2. SUPPORTS:
//      home / away
//      homeTeam / awayTeam
//      home_team / away_team
//      home_name / away_name
//      home.name / away.name
//      teams.home / teams.away
//      teams.home.name / teams.away.name
//      event.home / event.away
//      event.home_team / event.away_team
//      match string / name string
// 3. IF SIGNAL HAS V27 DATA, USE V27 HOME/AWAY DIRECTLY.
// 4. MATCHER CANDIDATES ALSO USE ROBUST TEAM EXTRACTION.
// 5. EXACT NORMALIZED TEAM MATCH HAS PRIORITY.
// 6. FC/CF/SC/etc. ARE REMOVED BEFORE MATCHING.
// 7. TOKEN / CONTAINMENT / CHARACTER SIMILARITY REMAIN.
// 8. BOTH TEAMS MUST PASS.
// 9. NORMAL AND REVERSED DIRECTION ALLOWED.
// 10. SCORE-ONLY MATCHES ALWAYS REJECTED.
// 11. EXACT ID ALONE NEVER ACCEPTED.
// 12. CLOUDBET /live CALLED ONLY ONCE.
// 13. BETTING REMAINS DISABLED.
//
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

const VERSION = "V4.7";

const MODE = "READ_ONLY";

const BETTING_ENABLED = false;

const MATCHER_THRESHOLD = 0.45;

const TOKEN_TEAM_MIN_SCORE = 0.45;

const STRONG_MATCHER_SCORE = 0.45;

const MIN_MATCHER_SCORE = 0.45;

const DIRECT_CLOUDBET_MIN_SCORE = 0.45;

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const REQUIRED_SECURE_MATCH = true;

const ALLOWED_SIGNAL_TYPE =
  "HUNTER_ENTRY";

const TARGET_SPORT =
  "SOCCER";

const TARGET_PERIOD =
  "FIRST_HALF";

const TARGET_OUTCOME =
  "OVER";

const TARGET_LINE =
  0.5;


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

  if (
    typeof value === "string"
  ) {
    return value.trim();
  }

  if (
    typeof value === "number"
  ) {
    return String(value);
  }

  return "";
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

  "utd":
    "united",

  "ath":
    "athletic",

  "dep":
    "deportivo",

  "depor":
    "deportivo"
};


// ============================================================
// GENERIC WORDS
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
    "football",
    "soccer",
    "team"
  ]);


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
// MATCH NAME SPLITTER
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
    " @ ",
    " – ",
    " — "
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
// EXTRACT TEAM NAME FROM VALUE
// ============================================================

function extractTeamValue(
  value: any
): string {

  if (
    typeof value === "string"
  ) {
    return value.trim();
  }


  if (
    typeof value === "number"
  ) {
    return String(value);
  }


  if (
    value &&
    typeof value === "object"
  ) {

    const fields = [
      "name",
      "team_name",
      "teamName",
      "display_name",
      "displayName",
      "short_name",
      "shortName",
      "title"
    ];


    for (
      const field
      of fields
    ) {

      const result =
        safeString(
          value?.[field]
        );


      if (result) {
        return result;
      }
    }
  }


  return "";
}


// ============================================================
// EXTRACT HOME
// ============================================================

function extractHome(
  match: AnyObj
): string {

  if (!match) {
    return "";
  }


  // ----------------------------------------------------------
  // FLAT
  // ----------------------------------------------------------

  const flatFields = [
    "home",
    "homeTeam",
    "home_team",
    "home_name",
    "homeName"
  ];


  for (
    const field
    of flatFields
  ) {

    const value =
      extractTeamValue(
        match?.[field]
      );


    if (value) {
      return value;
    }
  }


  // ----------------------------------------------------------
  // TEAMS OBJECT
  // ----------------------------------------------------------

  const teamsHome =
    extractTeamValue(
      match?.teams?.home
    );


  if (teamsHome) {
    return teamsHome;
  }


  const nestedTeamsHome =
    extractTeamValue(
      match?.teams?.home_team
    );


  if (nestedTeamsHome) {
    return nestedTeamsHome;
  }


  // ----------------------------------------------------------
  // EVENT OBJECT
  // ----------------------------------------------------------

  const eventHome =
    extractTeamValue(
      match?.event?.home
    );


  if (eventHome) {
    return eventHome;
  }


  const eventHomeTeam =
    extractTeamValue(
      match?.event?.home_team
    );


  if (eventHomeTeam) {
    return eventHomeTeam;
  }


  const eventTeamsHome =
    extractTeamValue(
      match?.event?.teams?.home
    );


  if (eventTeamsHome) {
    return eventTeamsHome;
  }


  // ----------------------------------------------------------
  // OPPONENTS / COMPETITORS
  // ----------------------------------------------------------

  if (
    Array.isArray(
      match?.competitors
    )
  ) {

    const homeCompetitor =
      match.competitors.find(
        (x: AnyObj) =>
          safeString(
            x?.qualifier ??
            x?.side
          ).toLowerCase() ===
          "home"
      );


    const value =
      extractTeamValue(
        homeCompetitor
      );


    if (value) {
      return value;
    }
  }


  // ----------------------------------------------------------
  // MATCH STRING
  // ----------------------------------------------------------

  const split =
    splitMatchName(
      match?.match ??
      match?.name ??
      match?.event_name ??
      match?.eventName ??
      ""
    );


  return split.home ?? "";
}


// ============================================================
// EXTRACT AWAY
// ============================================================

function extractAway(
  match: AnyObj
): string {

  if (!match) {
    return "";
  }


  // ----------------------------------------------------------
  // FLAT
  // ----------------------------------------------------------

  const flatFields = [
    "away",
    "awayTeam",
    "away_team",
    "away_name",
    "awayName"
  ];


  for (
    const field
    of flatFields
  ) {

    const value =
      extractTeamValue(
        match?.[field]
      );


    if (value) {
      return value;
    }
  }


  // ----------------------------------------------------------
  // TEAMS OBJECT
  // ----------------------------------------------------------

  const teamsAway =
    extractTeamValue(
      match?.teams?.away
    );


  if (teamsAway) {
    return teamsAway;
  }


  const nestedTeamsAway =
    extractTeamValue(
      match?.teams?.away_team
    );


  if (nestedTeamsAway) {
    return nestedTeamsAway;
  }


  // ----------------------------------------------------------
  // EVENT OBJECT
  // ----------------------------------------------------------

  const eventAway =
    extractTeamValue(
      match?.event?.away
    );


  if (eventAway) {
    return eventAway;
  }


  const eventAwayTeam =
    extractTeamValue(
      match?.event?.away_team
    );


  if (eventAwayTeam) {
    return eventAwayTeam;
  }


  const eventTeamsAway =
    extractTeamValue(
      match?.event?.teams?.away
    );


  if (eventTeamsAway) {
    return eventTeamsAway;
  }


  // ----------------------------------------------------------
  // OPPONENTS / COMPETITORS
  // ----------------------------------------------------------

  if (
    Array.isArray(
      match?.competitors
    )
  ) {

    const awayCompetitor =
      match.competitors.find(
        (x: AnyObj) =>
          safeString(
            x?.qualifier ??
            x?.side
          ).toLowerCase() ===
          "away"
      );


    const value =
      extractTeamValue(
        awayCompetitor
      );


    if (value) {
      return value;
    }
  }


  // ----------------------------------------------------------
  // MATCH STRING
  // ----------------------------------------------------------

  const split =
    splitMatchName(
      match?.match ??
      match?.name ??
      match?.event_name ??
      match?.eventName ??
      ""
    );


  return split.away ?? "";
}


// ============================================================
// DISPLAY MATCH
// ============================================================

function displayMatch(
  match: AnyObj
): string {

  const directFields = [
    "match",
    "name",
    "event_name",
    "eventName"
  ];


  for (
    const field
    of directFields
  ) {

    const value =
      safeString(
        match?.[field]
      );


    if (value) {
      return value;
    }
  }


  return `${extractHome(match)} - ${extractAway(match)}`;
}


// ============================================================
// MATCH ID
// ============================================================

function extractMatchId(
  match: AnyObj
): string {

  if (!match) {
    return "";
  }


  const fields = [
    "id",
    "match_id",
    "matchId",
    "event_id",
    "eventId",
    "key"
  ];


  for (
    const field
    of fields
  ) {

    const value =
      safeString(
        match?.[field]
      );


    if (value) {
      return value;
    }
  }


  return "";
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
    .filter(
      token =>
        token.length >= 2
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


  let prev =
    new Array(
      b.length + 1
    );


  let curr =
    new Array(
      b.length + 1
    );


  for (
    let j = 0;
    j <= b.length;
    j++
  ) {
    prev[j] = j;
  }


  for (
    let i = 1;
    i <= a.length;
    i++
  ) {

    curr[0] = i;


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


      curr[j] =
        Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
    }


    const temp =
      prev;

    prev =
      curr;

    curr =
      temp;
  }


  return prev[b.length];
}


// ============================================================
// CHARACTER SIMILARITY
// ============================================================

function characterSimilarity(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);


  if (!A || !B) {
    return 0;
  }


  if (A === B) {
    return 1;
  }


  const distance =
    levenshtein(
      A,
      B
    );


  const maxLength =
    Math.max(
      A.length,
      B.length
    );


  if (!maxLength) {
    return 0;
  }


  return Math.max(
    0,
    1 -
      distance /
      maxLength
  );
}


// ============================================================
// TEAM SCORE
// ============================================================

function teamMatchScore(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);


  if (!A || !B) {
    return 0;
  }


  // EXACT NORMALIZED MATCH
  if (A === B) {
    return 1;
  }


  // CONTAINMENT
  if (
    A.includes(B) ||
    B.includes(A)
  ) {

    const shorter =
      Math.min(
        A.length,
        B.length
      );

    const longer =
      Math.max(
        A.length,
        B.length
      );


    return Math.max(
      0.75,
      shorter /
        longer
    );
  }


  // TOKEN MATCH
  const tokensA =
    teamTokens(A);

  const tokensB =
    teamTokens(B);


  if (
    tokensA.length &&
    tokensB.length
  ) {

    let common = 0;


    for (
      const token
      of tokensA
    ) {

      if (
        tokensB.includes(token)
      ) {
        common++;
      }
    }


    const tokenScore =
      common /
      Math.max(
        tokensA.length,
        tokensB.length
      );


    if (
      tokenScore >=
      TOKEN_TEAM_MIN_SCORE
    ) {

      return tokenScore;
    }
  }


  // CHARACTER SIMILARITY
  return characterSimilarity(
    A,
    B
  );
}


// ============================================================
// TWO-SIDED SCORE
// ============================================================

function twoSidedTeamScore(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): AnyObj {

  const normalHome =
    teamMatchScore(
      homeA,
      homeB
    );

  const normalAway =
    teamMatchScore(
      awayA,
      awayB
    );


  const reversedHome =
    teamMatchScore(
      homeA,
      awayB
    );

  const reversedAway =
    teamMatchScore(
      awayA,
      homeB
    );


  const normalValid =
    normalHome >=
      DIRECT_CLOUDBET_MIN_SCORE &&
    normalAway >=
      DIRECT_CLOUDBET_MIN_SCORE;


  const reversedValid =
    reversedHome >=
      DIRECT_CLOUDBET_MIN_SCORE &&
    reversedAway >=
      DIRECT_CLOUDBET_MIN_SCORE;


  const normalScore =
    Math.min(
      normalHome,
      normalAway
    );


  const reversedScore =
    Math.min(
      reversedHome,
      reversedAway
    );


  if (
    normalValid &&
    normalScore >=
      reversedScore
  ) {

    return {

      matched:
        true,

      direction:
        "NORMAL",

      home_score:
        normalHome,

      away_score:
        normalAway,

      combined_score:
        normalScore
    };
  }


  if (reversedValid) {

    return {

      matched:
        true,

      direction:
        "REVERSED",

      home_score:
        reversedHome,

      away_score:
        reversedAway,

      combined_score:
        reversedScore
    };
  }


  return {

    matched:
      false,

    direction:
      null,

    home_score:
      Math.max(
        normalHome,
        reversedHome
      ),

    away_score:
      Math.max(
        normalAway,
        reversedAway
      ),

    combined_score:
      Math.max(
        normalScore,
        reversedScore
      )
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
// SIGNAL TEAM EXTRACTION
//
// IMPORTANT:
// V27 DATA HAS PRIORITY.
//
// Example:
//
// signal.v27.home = "Maccabi Tel Aviv"
// signal.v27.away = "Maccabi Haifa"
// ============================================================

function signalHome(
  signal: AnyObj
): string {

  const v27Home =
    extractTeamValue(
      signal?.v27?.home
    );


  if (v27Home) {
    return v27Home;
  }


  const sourceHome =
    extractTeamValue(
      signal?.source?.home
    );


  if (sourceHome) {
    return sourceHome;
  }


  return extractHome(signal);
}


function signalAway(
  signal: AnyObj
): string {

  const v27Away =
    extractTeamValue(
      signal?.v27?.away
    );


  if (v27Away) {
    return v27Away;
  }


  const sourceAway =
    extractTeamValue(
      signal?.source?.away
    );


  if (sourceAway) {
    return sourceAway;
  }


  return extractAway(signal);
}


// ============================================================
// SIGNAL MATCH ID
// ============================================================

function signalMatchId(
  signal: AnyObj
): string {

  return safeString(
    signal?.match_id ??
    signal?.matchId ??
    signal?.v27?.id ??
    signal?.id
  );
}


// ============================================================
// SIGNAL MATCH NAME
// ============================================================

function signalMatchName(
  signal: AnyObj
): string {

  return safeString(
    signal?.match ??
    signal?.name ??
    signal?.v27?.match
  ) ||
    `${signalHome(signal)} - ${signalAway(signal)}`;
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractSignals(
  data: any
): AnyObj[] {

  const possible = [
    data?.signals,
    data?.entries,
    data?.hunter_entries,
    data?.data
  ];


  for (
    const value
    of possible
  ) {

    if (
      Array.isArray(value)
    ) {
      return value;
    }
  }


  return [];
}


// ============================================================
// HUNTER ENTRY
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
// MATCHER EXTRACTION
// ============================================================

function extractMatcherMatches(
  data: any
): AnyObj[] {

  const possible = [
    data?.matches,
    data?.results,
    data?.matched,
    data?.candidates,
    data?.data
  ];


  for (
    const value
    of possible
  ) {

    if (
      Array.isArray(value)
    ) {
      return value;
    }
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
    item?.matcher ??
    {};


  const score =
    Number(
      scoring?.total ??
      scoring?.score ??
      item?.matcher_score ??
      item?.match_score ??
      item?.score ??
      0
    );


  return Number.isFinite(score)
    ? score
    : 0;
}


// ============================================================
// CLASSIFICATION
// ============================================================

function getClassification(
  item: AnyObj
): string {

  return safeString(
    item?.classification ??
    item?.match_classification ??
    item?.security?.classification ??
    item?.matcher?.classification
  ).toUpperCase();
}


// ============================================================
// METHOD
// ============================================================

function getMatchMethod(
  item: AnyObj
): string {

  return safeString(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method ??
    item?.matcher?.method
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
    item?.secure_match === true ||
    item?.matcher?.secure_match === true
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
    item?.score_only_match === true ||
    item?.matcher?.score_only_match === true
  );
}


// ============================================================
// EXTRACT V27 FROM MATCHER
// ============================================================

function extractV27FromMatcher(
  item: AnyObj
): AnyObj {

  return (
    item?.v27 ??
    item?.source?.v27 ??
    item?.source ??
    item
  );
}


// ============================================================
// EXTRACT CLOUDBET TARGET
// ============================================================

function extractCloudbetFromMatcher(
  item: AnyObj
): AnyObj | null {

  return (
    item?.cloudbet ??
    item?.matched ??
    item?.target ??
    item?.cloudbet_match ??
    item?.target_match ??
    null
  );
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
  // SCORE ONLY = HARD REJECT
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
  // SIGNAL -> V27
  //
  // THIS IS THE IMPORTANT FIX.
  // ----------------------------------------------------------

  const teamScore =
    twoSidedTeamScore(
      sHome,
      sAway,
      vHome,
      vAway
    );


  if (
    !teamScore.matched
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

      team_scores:
        teamScore,

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
      }
    };
  }


  // ----------------------------------------------------------
  // CLOUDBET TARGET IS OPTIONAL FOR TEAM VALIDATION.
  //
  // Some matcher responses can return V27 candidate first
  // and Cloudbet target separately.
  //
  // We do NOT reject the candidate merely because the target
  // object is missing. Cloudbet will independently verify it.
  // ----------------------------------------------------------

  if (
    cloudbet &&
    teamsPresent(
      cHome,
      cAway
    )
  ) {

    const cloudbetTeamScore =
      twoSidedTeamScore(
        sHome,
        sAway,
        cHome,
        cAway
      );


    if (
      !cloudbetTeamScore.matched
    ) {

      return {

        accepted:
          false,

        reason:
          "MATCHER_CLOUDBET_TEAMS_MISMATCH",

        classification,

        method,

        matcher_score:
          matcherScore,

        secure_flag:
          secureFlag,

        team_scores:
          cloudbetTeamScore
      };
    }
  }


  // ----------------------------------------------------------
  // EXACT ID WITH ZERO SCORE = HARD REJECT
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
  // SCORE TOO LOW
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
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // CONFIDENT OR STRONG SCORE
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
        secureFlag
    };
  }


  // ----------------------------------------------------------
  // ACCEPT
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

    team_direction:
      teamScore.direction,

    signal_team_scores:
      teamScore,

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

    cloudbet:
      cloudbet &&
      teamsPresent(
        cHome,
        cAway
      )
        ? {

            id:
              extractMatchId(
                cloudbet
              ),

            match:
              displayMatch(
                cloudbet
              ),

            home:
              cHome,

            away:
              cAway
          }
        : null,

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

      source:
        "MATCHER",

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

  const possible = [
    data?.matches,
    data?.live_matches,
    data?.events,
    data?.data
  ];


  for (
    const value
    of possible
  ) {

    if (
      Array.isArray(value)
    ) {
      return value;
    }
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
    match?.live === true
  ) {
    return true;
  }


  // Some Cloudbet structures expose state instead.
  const state =
    safeString(
      match?.state ??
      match?.event_state
    ).toUpperCase();


  if (
    state ===
    "LIVE"
  ) {
    return true;
  }


  return false;
}


// ============================================================
// DIRECT CLOUDBET FALLBACK
//
// NO NETWORK CALL HERE.
//
// Searches already loaded Cloudbet /live.
//
// BOTH TEAMS MUST MATCH.
// ============================================================

function findDirectCloudbetFallback(
  signal: AnyObj,
  cloudbetMatches: AnyObj[]
): AnyObj {

  const sHome =
    signalHome(signal);

  const sAway =
    signalAway(signal);


  if (
    !teamsPresent(
      sHome,
      sAway
    )
  ) {

    return {

      found:
        false,

      reason:
        "SIGNAL_TEAMS_EMPTY",

      candidates_checked:
        cloudbetMatches.length
    };
  }


  let best:
    AnyObj | null = null;


  for (
    const cb
    of cloudbetMatches
  ) {

    const cbHome =
      extractHome(cb);

    const cbAway =
      extractAway(cb);


    if (
      !teamsPresent(
        cbHome,
        cbAway
      )
    ) {
      continue;
    }


    const scored =
      twoSidedTeamScore(
        sHome,
        sAway,
        cbHome,
        cbAway
      );


    if (
      !scored.matched
    ) {
      continue;
    }


    const signalId =
      signalMatchId(signal);

    const cloudbetId =
      extractMatchId(cb);


    const exactId =
      Boolean(
        signalId &&
        cloudbetId &&
        signalId === cloudbetId
      );


    const candidate = {

      match:
        cb,

      direction:
        scored.direction,

      home_score:
        scored.home_score,

      away_score:
        scored.away_score,

      combined_score:
        scored.combined_score,

      exact_id:
        exactId
    };


    // Exact team match wins over fuzzy match.
    const exactTeamMatch =
      candidate.home_score === 1 &&
      candidate.away_score === 1;


    const bestExact =
      best &&
      best.home_score === 1 &&
      best.away_score === 1;


    if (
      !best
    ) {

      best =
        candidate;

    } else if (
      exactTeamMatch &&
      !bestExact
    ) {

      best =
        candidate;

    } else if (
      exactTeamMatch ===
        bestExact &&
      candidate.combined_score >
        best.combined_score
    ) {

      best =
        candidate;
    }
  }


  if (!best) {

    return {

      found:
        false,

      reason:
        "DIRECT_CLOUDBET_TEAMS_NOT_CONFIRMED",

      candidates_checked:
        cloudbetMatches.length,

      signal: {

        home:
          sHome,

        away:
          sAway,

        normalized_home:
          normalizeTeam(sHome),

        normalized_away:
          normalizeTeam(sAway)
      }
    };
  }


  return {

    found:
      true,

    source:
      "DIRECT_CLOUDBET_FALLBACK",

    reason:
      "DIRECT_CLOUDBET_TWO_SIDED_TEAM_MATCH",

    match:
      best.match,

    direction:
      best.direction,

    home_score:
      best.home_score,

    away_score:
      best.away_score,

    combined_score:
      best.combined_score,

    exact_id:
      best.exact_id
  };
}


// ============================================================
// CLOUDBET SECOND VERIFICATION
// ============================================================

function verifyCloudbetMatch(
  secureMatcher: AnyObj,
  cloudbetMatches: AnyObj[]
): AnyObj {

  const target =
    secureMatcher?.cloudbet;


  if (
    !target
  ) {

    return {

      verified:
        false,

      reason:
        "MATCHER_DID_NOT_RETURN_CLOUDBET_MATCH"
    };
  }


  const targetId =
    extractMatchId(target);


  const targetHome =
    extractHome(target);

  const targetAway =
    extractAway(target);


  if (
    !teamsPresent(
      targetHome,
      targetAway
    )
  ) {

    return {

      verified:
        false,

      reason:
        "MATCHER_CLOUDBET_TEAMS_EMPTY"
    };
  }


  // ----------------------------------------------------------
  // EXACT ID + TWO SIDED TEAMS
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

        const teamScore =
          twoSidedTeamScore(
            targetHome,
            targetAway,
            extractHome(cb),
            extractAway(cb)
          );


        if (
          teamScore.matched
        ) {

          return {

            verified:
              true,

            method:
              "CLOUDBET_ID_AND_TEAMS",

            direction:
              teamScore.direction,

            home_score:
              teamScore.home_score,

            away_score:
              teamScore.away_score,

            combined_score:
              teamScore.combined_score,

            match:
              cb
          };
        }
      }
    }
  }


  // ----------------------------------------------------------
  // TWO-SIDED TEAM VERIFICATION
  // ----------------------------------------------------------

  let best:
    AnyObj | null = null;


  for (
    const cb
    of cloudbetMatches
  ) {

    const teamScore =
      twoSidedTeamScore(
        targetHome,
        targetAway,
        extractHome(cb),
        extractAway(cb)
      );


    if (
      !teamScore.matched
    ) {
      continue;
    }


    if (
      !best ||
      teamScore.combined_score >
      best.combined_score
    ) {

      best = {

        match:
          cb,

        direction:
          teamScore.direction,

        home_score:
          teamScore.home_score,

        away_score:
          teamScore.away_score,

        combined_score:
          teamScore.combined_score
      };
    }
  }


  if (best) {

    return {

      verified:
        true,

      method:
        "CLOUDBET_TWO_SIDED_TEAMS",

      direction:
        best.direction,

      home_score:
        best.home_score,

      away_score:
        best.away_score,

      combined_score:
        best.combined_score,

      match:
        best.match
    };
  }


  return {

    verified:
      false,

    reason:
      "CLOUDBET_MATCH_NOT_CONFIRMED"
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
        signal?.v27?.minute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        signal?.v27?.score ??
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

      source:
        secureMatcher.source,

      classification:
        secureMatcher.classification ??
        null,

      match_method:
        secureMatcher.method ??
        null,

      matcher_score:
        secureMatcher.matcher_score ??
        null,

      reason:
        secureMatcher.reason,

      fallback:
        secureMatcher.source ===
        "DIRECT_CLOUDBET_FALLBACK"
    },


    security: {

      secure_match:
        true,

      score_only_match:
        false,

      exact_id_alone_is_not_secure:
        true,

      exact_id_requires_positive_matcher_score:
        true,

      matcher_confident:
        secureMatcher.classification ===
        REQUIRED_MATCH_CLASSIFICATION,

      strong_matcher_score:
        secureMatcher.matcher_score != null
          ? secureMatcher.matcher_score >=
            STRONG_MATCHER_SCORE
          : false,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_verified:
        true,

      cloudbet_verification_method:
        cloudbetVerification.method,

      cloudbet_team_direction:
        cloudbetVerification.direction ??
        null,

      cloudbet_combined_score:
        cloudbetVerification.combined_score ??
        null,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    action:
      "NO_BET_IN_V4_READY"
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
        signal?.v27?.minute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        signal?.v27?.score ??
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
      "NO_BET_IN_V4_7",

    reason
  };
}


// ============================================================
// RUN V4.7
// ============================================================

async function runV47(
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

      tracker: {

        endpoint:
          "/entries",

        total_signals:
          allSignals.length,

        hunter_entries:
          0
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

        direct_cloudbet_fallback_matches:
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
  // RESULTS
  // ==========================================================

  const preparedBets:
    AnyObj[] = [];


  const noMatch:
    AnyObj[] = [];


  let matcherSecureMatches =
    0;


  let directFallbackMatches =
    0;


  let cloudbetVerifiedMatches =
    0;


  const rejectionReasons:
    Record<string, number> = {};


  // ==========================================================
  // PROCESS EVERY SIGNAL
  // ==========================================================

  for (
    const signal
    of hunterEntries
  ) {

    // --------------------------------------------------------
    // PRIMARY MATCHER
    // --------------------------------------------------------

    const matcherResult =
      findBestMatcherCandidate(
        signal,
        matcherData
      );


    // ========================================================
    // MATCHER SUCCESS
    // ========================================================

    if (
      matcherResult.found
    ) {

      matcherSecureMatches++;


      const cloudbetVerification =
        verifyCloudbetMatch(
          matcherResult,
          liveCloudbet
        );


      // ------------------------------------------------------
      // CLOUDBET VERIFIED
      // ------------------------------------------------------

      if (
        cloudbetVerification.verified
      ) {

        cloudbetVerifiedMatches++;


        preparedBets.push(
          buildPreparedBet(
            signal,
            matcherResult,
            cloudbetVerification
          )
        );


        continue;
      }


      // ------------------------------------------------------
      // MATCHER FOUND MATCH BUT CLOUDBET DID NOT VERIFY
      //
      // DIRECT FALLBACK
      // ------------------------------------------------------

      const fallback =
        findDirectCloudbetFallback(
          signal,
          liveCloudbet
        );


      if (
        fallback.found
      ) {

        directFallbackMatches++;

        cloudbetVerifiedMatches++;


        const fallbackMatcher = {

          source:
            "DIRECT_CLOUDBET_FALLBACK",

          classification:
            null,

          method:
            "DIRECT_TEAM_MATCH",

          matcher_score:
            fallback.combined_score,

          reason:
            "MATCHER_CLOUDBET_VERIFICATION_FAILED_DIRECT_FALLBACK",

          cloudbet: {

            id:
              extractMatchId(
                fallback.match
              ),

            match:
              displayMatch(
                fallback.match
              ),

            home:
              extractHome(
                fallback.match
              ),

            away:
              extractAway(
                fallback.match
              )
          }
        };


        const directVerification = {

          verified:
            true,

          method:
            "DIRECT_CLOUDBET_TWO_SIDED_TEAMS",

          direction:
            fallback.direction,

          home_score:
            fallback.home_score,

          away_score:
            fallback.away_score,

          combined_score:
            fallback.combined_score,

          match:
            fallback.match
        };


        preparedBets.push(
          buildPreparedBet(
            signal,
            fallbackMatcher,
            directVerification
          )
        );


        continue;
      }


      // ------------------------------------------------------
      // COMPLETE FAILURE
      // ------------------------------------------------------

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

            matcher_source:
              "MATCHER",

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

            cloudbet_verification:
              cloudbetVerification,

            direct_fallback: {

              attempted:
                true,

              found:
                false
            }
          }
        ),

        security: {

          secure_match:
            false,

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


    // ========================================================
    // MATCHER FAILED
    //
    // DIRECT CLOUDBET FALLBACK
    // ========================================================

    const fallback =
      findDirectCloudbetFallback(
        signal,
        liveCloudbet
      );


    // --------------------------------------------------------
    // FALLBACK SUCCESS
    // --------------------------------------------------------

    if (
      fallback.found
    ) {

      directFallbackMatches++;

      cloudbetVerifiedMatches++;


      const fallbackMatcher = {

        source:
          "DIRECT_CLOUDBET_FALLBACK",

        classification:
          null,

        method:
          "DIRECT_TEAM_MATCH",

        matcher_score:
          fallback.combined_score,

        reason:
          "MATCHER_NO_ACCEPTABLE_CANDIDATE_DIRECT_CLOUDBET_ACCEPTED",

        cloudbet: {

          id:
            extractMatchId(
              fallback.match
            ),

          match:
            displayMatch(
              fallback.match
            ),

          home:
            extractHome(
              fallback.match
            ),

          away:
            extractAway(
              fallback.match
            )
        }
      };


      const directVerification = {

        verified:
          true,

        method:
          "DIRECT_CLOUDBET_TWO_SIDED_TEAMS",

        direction:
          fallback.direction,

        home_score:
          fallback.home_score,

        away_score:
          fallback.away_score,

        combined_score:
          fallback.combined_score,

        match:
          fallback.match
      };


      preparedBets.push(
        buildPreparedBet(
          signal,
          fallbackMatcher,
          directVerification
        )
      );


      continue;
    }


    // --------------------------------------------------------
    // COMPLETE NO MATCH
    // --------------------------------------------------------

    const reason =
      "NO_ACCEPTABLE_MATCHER_OR_DIRECT_CLOUDBET_MATCH";


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

          matcher: {

            candidates_checked:
              matcherResult
                .diagnostics
                ?.candidates_checked ??
              0,

            rejection_reasons:
              matcherResult
                .diagnostics
                ?.rejection_reasons ??
              {},

            matcher_reason:
              matcherResult.reason ??
              null
          },

          direct_cloudbet_fallback: {

            attempted:
              true,

            found:
              false,

            candidates_checked:
              fallback
                .candidates_checked ??
              liveCloudbet.length,

            reason:
              fallback.reason ??
              null,

            signal_teams:
              {

                home:
                  signalHome(signal),

                away:
                  signalAway(signal),

                normalized_home:
                  normalizeTeam(
                    signalHome(signal)
                  ),

                normalized_away:
                  normalizeTeam(
                    signalAway(signal)
                  )
              }
          }
        }
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

      v47_robust_team_extraction:
        true,

      v47_v27_priority:
        true,

      v47_direct_cloudbet_fallback:
        true,

      v47_secure_flag_not_hard_rejection:
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

      direct_cloudbet_fallback_matches:
        directFallbackMatches,

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

      signals_with_direct_fallback:
        directFallbackMatches,

      signals_with_cloudbet_failure:
        hunterEntries.length -
        cloudbetVerifiedMatches,


      v47_rules: {

        matcher:
          "PRIMARY MATCH SOURCE",

        v27:
          "SIGNAL.V27 HOME/AWAY HAVE PRIORITY",

        team_extraction:
          "ROBUST NESTED + FLAT EXTRACTION",

        matcher_confident:
          "ACCEPT",

        matcher_strong_score:
          `ACCEPT >= ${STRONG_MATCHER_SCORE}`,

        secure_match_false:
          "NOT AUTOMATICALLY REJECTED",

        score_only:
          "ALWAYS REJECT",

        exact_id:
          "NEVER ACCEPTED ALONE",

        exact_id_zero_score:
          "ALWAYS REJECT",

        matcher_team_validation:
          "TWO SIDED",

        direct_cloudbet_fallback:
          "ENABLED",

        direct_team_matching:
          "EXACT + TOKEN + CONTAINMENT + CHARACTER SIMILARITY",

        direct_team_requirement:
          "BOTH HOME AND AWAY MUST PASS",

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
        false,

      direct_fallback_uses_existing_live_data:
        true
    },


    prepared_bets:
      preparedBets,


    no_match:
      noMatch,


    message:
      "V4.7 READ ONLY. Robust V27/Matcher/Cloudbet team extraction enabled. V27 signal teams have priority. Matcher remains primary and direct Cloudbet fallback uses the single already-loaded /live dataset. Betting remains disabled.",


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
        false
    },


    v47: {

      robust_team_extraction:
        true,

      v27_signal_priority:
        true,

      supported_home_fields: [
        "home",
        "homeTeam",
        "home_team",
        "home_name",
        "homeName",
        "teams.home",
        "event.home",
        "event.home_team",
        "competitors[home]"
      ],

      supported_away_fields: [
        "away",
        "awayTeam",
        "away_team",
        "away_name",
        "awayName",
        "teams.away",
        "event.away",
        "event.away_team",
        "competitors[away]"
      ],

      direct_cloudbet_fallback:
        true,

      direct_cloudbet_min_score:
        DIRECT_CLOUDBET_MIN_SCORE,

      both_teams_required:
        true,

      normal_direction:
        true,

      reversed_direction:
        true,

      exact_matching:
        true,

      token_matching:
        true,

      containment_matching:
        true,

      character_similarity:
        true
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

      direct_fallback_uses_existing_live_data:
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
        "PRIMARY MATCH SOURCE",

      matcher_confident:
        "ACCEPT",

      matcher_score:
        `STRONG SCORE >= ${STRONG_MATCHER_SCORE}`,

      secure_flag:
        "secure_match=false is not automatic rejection",

      score_only:
        "ALWAYS REJECT",

      exact_id:
        "EXACT_ID alone is never sufficient",

      exact_id_zero_score:
        "ALWAYS REJECT",

      matcher_teams:
        "Both signal teams must match V27 teams",

      direct_fallback:
        "If Matcher fails, search Cloudbet /live directly",

      direct_teams:
        "Both signal teams must match Cloudbet teams",

      direction:
        "Normal or reversed accepted",

      direct_score:
        `Both team scores must be >= ${DIRECT_CLOUDBET_MIN_SCORE}`,

      cloudbet:
        "Cloudbet live event must be independently verified",

      cloudbet_fetch:
        "Cloudbet /live is called once per worker execution",

      betting:
        "DISABLED"
    },


    message:
      "V4.7 optimized READ ONLY worker is healthy. Robust team extraction and V27-priority matching are enabled.",


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

        return runV47(
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

        return runV47(
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
