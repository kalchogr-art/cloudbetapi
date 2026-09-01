// ============================================================
// CLOUDBET BET WORKER V5.3
// READ ONLY — TEST MODE
// BETTING DISABLED
//
// PURPOSE:
// SECURE MATCHING + PERFORMANCE DIAGNOSTICS + HUNTER ARCHIVE
//
// V5.3 CHANGES:
// 1. V5.2 MATCHER LOGIC PRESERVED
// 2. V5.2 CLOUDBET LOGIC PRESERVED
// 3. V5.2 PARALLEL MATCHER + CLOUDBET PRESERVED
// 4. NEW D1 bet_archive TABLE
// 5. EVERY HUNTER_ENTRY IS ARCHIVED
// 6. READY / NO_MATCH ARE STORED AS SEPARATE ROWS
// 7. DUPLICATE SAME MATCH + SAME RESULT IS IGNORED
// 8. /archive RETURNS ARCHIVE STATISTICS + MATCHES
// 9. /archive/clear CLEARS ONLY bet_archive
//
// IMPORTANT:
// NO BETS ARE PLACED.
// ============================================================


interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}


type AnyObj = Record<string, any>;


// ============================================================
// CONFIG
// ============================================================

const VERSION = "V5.3";

const MODE = "READ_ONLY_TEST";

const BETTING_ENABLED = false;


// ============================================================
// MATCHER
// ============================================================

const MATCHER_THRESHOLD = 0.20;

const STRONG_MATCHER_SCORE = 0.20;

const MIN_MATCHER_SCORE = 0.20;


// ============================================================
// STRICT TEAM MATCHING
// ============================================================

const TEAM_MATCH_MIN_SCORE = 0.70;

const CHARACTER_SIMILARITY_MIN_SCORE = 0.70;

const CONTAINMENT_MIN_SCORE = 0.75;

const EXACT_TEAM_SCORE = 1.00;

const TOKEN_MATCH_MIN_SCORE = 0.75;

const TOKEN_MIN_COMMON = 1;


// ============================================================
// DIRECT CLOUDBET
// ============================================================

const DIRECT_CLOUDBET_MIN_SCORE =
  TEAM_MATCH_MIN_SCORE;

const DIRECT_CLOUDBET_STRONG_TEAM_SCORE =
  0.85;

const DIRECT_CLOUDBET_EXACT_TEAM_SCORE =
  1.00;


// ============================================================
// MATCH CLASSIFICATION
// ============================================================

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const REQUIRED_SECURE_MATCH = false;


// ============================================================
// TARGET
// ============================================================

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
    "soccer"
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
// HOME EXTRACTION
// ============================================================

function extractHome(
  match: AnyObj
): string {

  if (!match) {
    return "";
  }


  if (
    typeof match?.v27?.home ===
    "string"
  ) {
    return match.v27.home.trim();
  }


  if (
    typeof match?.v27?.homeTeam ===
    "string"
  ) {
    return match.v27.homeTeam.trim();
  }


  if (
    typeof match?.v27?.home_name ===
    "string"
  ) {
    return match.v27.home_name.trim();
  }


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
    typeof match?.home?.name ===
    "string"
  ) {
    return match.home.name.trim();
  }


  if (
    typeof match?.home_team?.name ===
    "string"
  ) {
    return match.home_team.name.trim();
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
      match?.event_name ??
      ""
    ).home ?? ""
  );
}


// ============================================================
// AWAY EXTRACTION
// ============================================================

function extractAway(
  match: AnyObj
): string {

  if (!match) {
    return "";
  }


  if (
    typeof match?.v27?.away ===
    "string"
  ) {
    return match.v27.away.trim();
  }


  if (
    typeof match?.v27?.awayTeam ===
    "string"
  ) {
    return match.v27.awayTeam.trim();
  }


  if (
    typeof match?.v27?.away_name ===
    "string"
  ) {
    return match.v27.away_name.trim();
  }


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
    typeof match?.away?.name ===
    "string"
  ) {
    return match.away.name.trim();
  }


  if (
    typeof match?.away_team?.name ===
    "string"
  ) {
    return match.away_team.name.trim();
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
      match?.event_name ??
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
      match?.event_name
    );


  if (direct) {
    return direct;
  }


  return `${extractHome(match)} - ${extractAway(match)}`;
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
    match?.key ??
    match?.event_id ??
    match?.eventId
  );
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
    .filter(Boolean)
    .filter(
      token =>
        token.length >= 3
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
// STRICT TEAM MATCH SCORE
// ============================================================

function teamMatchScore(
  a: any,
  b: any
): AnyObj {

  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);


  if (!A || !B) {

    return {

      score: 0,

      method:
        "EMPTY",

      exact:
        false,

      accepted:
        false
    };
  }


  if (A === B) {

    return {

      score:
        EXACT_TEAM_SCORE,

      method:
        "EXACT",

      exact:
        true,

      accepted:
        true
    };
  }


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


    const containmentScore =
      shorter /
      longer;


    const score =
      Math.max(
        0.75,
        containmentScore
      );


    return {

      score,

      method:
        "CONTAINMENT",

      exact:
        false,

      accepted:
        score >=
        CONTAINMENT_MIN_SCORE
    };
  }


  const tokensA =
    teamTokens(A);

  const tokensB =
    teamTokens(B);


  let commonTokens:
    string[] = [];


  for (
    const token
    of tokensA
  ) {

    if (
      tokensB.includes(token)
    ) {

      commonTokens.push(
        token
      );
    }
  }


  if (
    commonTokens.length >=
    TOKEN_MIN_COMMON
  ) {

    const tokenScore =
      commonTokens.length /
      Math.max(
        tokensA.length,
        tokensB.length
      );


    if (
      tokenScore >=
      TOKEN_MATCH_MIN_SCORE
    ) {

      return {

        score:
          tokenScore,

        method:
          "TOKEN_STRONG",

        exact:
          false,

        accepted:
          true,

        common_tokens:
          commonTokens
      };
    }
  }


  const characterScore =
    characterSimilarity(
      A,
      B
    );


  return {

    score:
      characterScore,

    method:
      "CHARACTER_SIMILARITY",

    exact:
      false,

    accepted:
      characterScore >=
      CHARACTER_SIMILARITY_MIN_SCORE
  };
}


// ============================================================
// TWO-SIDED STRICT TEAM SCORE
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
    normalHome.accepted &&
    normalAway.accepted &&
    normalHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    normalAway.score >=
      TEAM_MATCH_MIN_SCORE;


  const reversedValid =
    reversedHome.accepted &&
    reversedAway.accepted &&
    reversedHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    reversedAway.score >=
      TEAM_MATCH_MIN_SCORE;


  const normalScore =
    Math.min(
      normalHome.score,
      normalAway.score
    );


  const reversedScore =
    Math.min(
      reversedHome.score,
      reversedAway.score
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
        normalHome.score,

      away_score:
        normalAway.score,

      combined_score:
        normalScore,

      both_teams_pass:
        true,

      home_method:
        normalHome.method,

      away_method:
        normalAway.method,

      home_accepted:
        normalHome.accepted,

      away_accepted:
        normalAway.accepted
    };
  }


  if (reversedValid) {

    return {

      matched:
        true,

      direction:
        "REVERSED",

      home_score:
        reversedHome.score,

      away_score:
        reversedAway.score,

      combined_score:
        reversedScore,

      both_teams_pass:
        true,

      home_method:
        reversedHome.method,

      away_method:
        reversedAway.method,

      home_accepted:
        reversedHome.accepted,

      away_accepted:
        reversedAway.accepted
    };
  }


  const bestDirection =
    normalScore >=
    reversedScore
      ? "NORMAL"
      : "REVERSED";


  const bestHome =
    normalScore >=
    reversedScore
      ? normalHome
      : reversedHome;


  const bestAway =
    normalScore >=
    reversedScore
      ? normalAway
      : reversedAway;


  return {

    matched:
      false,

    direction:
      bestDirection,

    home_score:
      bestHome.score,

    away_score:
      bestAway.score,

    combined_score:
      Math.max(
        normalScore,
        reversedScore
      ),

    both_teams_pass:
      false,

    home_method:
      bestHome.method,

    away_method:
      bestAway.method,

    home_accepted:
      bestHome.accepted,

    away_accepted:
      bestAway.accepted,

    normal: {

      home_score:
        normalHome.score,

      away_score:
        normalAway.score,

      home_method:
        normalHome.method,

      away_method:
        normalAway.method,

      valid:
        normalValid
    },

    reversed: {

      home_score:
        reversedHome.score,

      away_score:
        reversedAway.score,

      home_method:
        reversedHome.method,

      away_method:
        reversedAway.method,

      valid:
        reversedValid
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
// SIGNAL HELPERS
// ============================================================

function signalMatchId(
  signal: AnyObj
): string {

  return safeString(
    signal?.match_id ??
    signal?.matchId ??
    signal?.id ??
    signal?.v27?.id
  );
}


function signalMatchName(
  signal: AnyObj
): string {

  return safeString(
    signal?.match ??
    signal?.name ??
    signal?.v27?.match
  );
}


function signalHome(
  signal: AnyObj
): string {

  if (
    typeof signal?.v27?.home ===
    "string"
  ) {
    return signal.v27.home.trim();
  }


  return extractHome(signal);
}


function signalAway(
  signal: AnyObj
): string {

  if (
    typeof signal?.v27?.away ===
    "string"
  ) {
    return signal.v27.away.trim();
  }


  return extractAway(signal);
}


// ============================================================
// MATCHER EXTRACTION
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
    item?.score_details ??
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
    item?.security?.classification
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
    item?.security?.match_method
  ).toUpperCase();
}


// ============================================================
// SECURITY
// ============================================================

function getSecureFlag(
  item: AnyObj
): boolean {

  return (
    item?.security?.secure_match === true ||
    item?.secure_match === true
  );
}


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

  if (
    item?.v27
  ) {
    return item.v27;
  }


  if (
    item?.source
  ) {
    return item.source;
  }


  return item;
}


// ============================================================
// CLOUDBET EXTRACTION
// ============================================================

function extractCloudbetFromMatcher(
  item: AnyObj
): AnyObj | null {

  return (
    item?.cloudbet ??
    item?.target ??
    item?.matched_cloudbet ??
    null
  );
}


// ============================================================
// MATCHER CANDIDATE VALIDATION
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

  const sHome =
    signalHome(signal);

  const sAway =
    signalAway(signal);


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


  if (
    !teamsPresent(
      sHome,
      sAway
    )
  ) {

    return {

      accepted:
        false,

      reason:
        "SIGNAL_TEAMS_EMPTY",

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_flag:
        secureFlag
    };
  }


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
        "STRICT_SIGNAL_TEAMS_MISMATCH",

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
          sAway,

        normalized_home:
          normalizeTeam(sHome),

        normalized_away:
          normalizeTeam(sAway)
      },

      v27: {

        home:
          vHome,

        away:
          vAway,

        normalized_home:
          normalizeTeam(vHome),

        normalized_away:
          normalizeTeam(vAway)
      }
    };
  }


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
        secureFlag,

      team_scores:
        teamScore
    };
  }


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

      team_scores:
        teamScore
    };
  }


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

      team_scores:
        teamScore
    };
  }


  return {

    accepted:
      true,

    reason:
      confident
        ? "CONFIDENT_MATCH_ACCEPTED"
        : "V51_STRICT_TWO_SIDED_MATCH_ACCEPTED",

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

    team_scores:
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
      cloudbet
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
              extractHome(
                cloudbet
              ),

            away:
              extractAway(
                cloudbet
              )
          }
        : null,

    item
  };
}


// ============================================================
// FIND BEST MATCHER
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
    match?.live === true
  ) {
    return true;
  }


  const state =
    safeString(
      match?.state
    ).toUpperCase();


  return (
    state ===
    "LIVE"
  );
}


// ============================================================
// DIRECT CLOUDBET FALLBACK
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


  const rejected:
    AnyObj[] = [];


  const topCandidates:
    AnyObj[] = [];


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


    const candidateInfo = {

      match:
        displayMatch(cb),

      id:
        extractMatchId(cb),

      home:
        cbHome,

      away:
        cbAway,

      home_score:
        scored.home_score,

      away_score:
        scored.away_score,

      combined_score:
        scored.combined_score,

      matched:
        scored.matched,

      direction:
        scored.direction,

      both_teams_pass:
        scored.both_teams_pass,

      home_method:
        scored.home_method,

      away_method:
        scored.away_method
    };


    topCandidates.push(
      candidateInfo
    );


    if (
      !scored.matched
    ) {

      rejected.push({

        ...candidateInfo,

        rejection:
          "STRICT_TWO_SIDED_TEAM_VALIDATION_FAILED"
      });

      continue;
    }


    if (
      scored.home_score <
      DIRECT_CLOUDBET_MIN_SCORE ||
      scored.away_score <
      DIRECT_CLOUDBET_MIN_SCORE
    ) {

      rejected.push({

        ...candidateInfo,

        rejection:
          "TEAM_SCORE_BELOW_STRICT_MINIMUM"
      });

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


    if (
      !best ||
      candidate.combined_score >
        best.combined_score
    ) {

      best =
        candidate;
    }
  }


  topCandidates.sort(
    (a, b) =>
      b.combined_score -
      a.combined_score
  );


  if (!best) {

    return {

      found:
        false,

      reason:
        "DIRECT_CLOUDBET_STRICT_TEAMS_NOT_CONFIRMED",

      candidates_checked:
        cloudbetMatches.length,

      signal_teams: {

        home:
          sHome,

        away:
          sAway,

        normalized_home:
          normalizeTeam(sHome),

        normalized_away:
          normalizeTeam(sAway)
      },

      strict_rules: {

        minimum_team_score:
          DIRECT_CLOUDBET_MIN_SCORE,

        both_teams_required:
          true,

        normal_allowed:
          true,

        reversed_allowed:
          true
      },

      best_candidates:
        topCandidates.slice(
          0,
          10
        ),

      rejected_candidates:
        rejected.slice(
          0,
          10
        )
    };
  }


  return {

    found:
      true,

    source:
      "DIRECT_CLOUDBET_FALLBACK",

    reason:
      "DIRECT_CLOUDBET_STRICT_TWO_SIDED_TEAM_MATCH",

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
      best.exact_id,

    candidates_checked:
      cloudbetMatches.length
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


  if (!target) {

    return {

      verified:
        false,

      reason:
        "MATCHER_DID_NOT_RETURN_CLOUDBET_MATCH"
    };
  }


  const targetId =
    safeString(
      target?.id
    );


  const targetHome =
    normalizeTeam(
      target?.home
    );

  const targetAway =
    normalizeTeam(
      target?.away
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
          teamScore.matched &&
          teamScore.home_score >=
            DIRECT_CLOUDBET_MIN_SCORE &&
          teamScore.away_score >=
            DIRECT_CLOUDBET_MIN_SCORE
        ) {

          return {

            verified:
              true,

            method:
              "CLOUDBET_ID_AND_STRICT_TEAMS",

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
      teamScore.home_score <
      DIRECT_CLOUDBET_MIN_SCORE ||
      teamScore.away_score <
      DIRECT_CLOUDBET_MIN_SCORE
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
        "CLOUDBET_STRICT_TWO_SIDED_TEAMS",

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
      "CLOUDBET_STRICT_TEAM_MATCH_NOT_CONFIRMED"
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

      matcher_discovery_threshold:
        MATCHER_THRESHOLD,

      matcher_accept_min_score:
        MIN_MATCHER_SCORE,

      matcher_score_is_team_validation:
        false,

      strict_two_sided_team_validation:
        true,

      team_minimum_score:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_minimum:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_minimum:
        CONTAINMENT_MIN_SCORE,

      token_minimum:
        TOKEN_MATCH_MIN_SCORE,

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

      test_mode:
        true
    },


    action:
      "NO_BET_V5_3_TEST"
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

      normalized_home:
        normalizeTeam(
          signalHome(signal)
        ),

      normalized_away:
        normalizeTeam(
          signalAway(signal)
        ),

      entry_minute:
        signal?.entry_minute ??
        signal?.entryMinute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
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

      strict_two_sided_team_validation:
        true,

      team_minimum_score:
        TEAM_MATCH_MIN_SCORE,

      test_mode:
        true
    },


    action:
      "NO_BET_V5_3_TEST",

    reason
  };
}


// ============================================================
// ARCHIVE HELPERS
// ============================================================

function newExecutionId(): string {

  return (
    `${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
  );
}


function nullableNumber(
  value: any
): number | null {

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


function archiveMatchId(
  item: AnyObj
): string {

  return safeString(
    item?.signal?.match_id ??
    item?.match_id ??
    ""
  );
}


function archiveMatchName(
  item: AnyObj
): string {

  return safeString(
    item?.signal?.match ??
    item?.match ??
    ""
  );
}


function archiveHome(
  item: AnyObj
): string {

  return safeString(
    item?.signal?.home ??
    item?.home ??
    ""
  );
}


function archiveAway(
  item: AnyObj
): string {

  return safeString(
    item?.signal?.away ??
    item?.away ??
    ""
  );
}


function archiveEntryMinute(
  item: AnyObj
): number | null {

  return nullableNumber(
    item?.signal?.entry_minute ??
    item?.entry_minute
  );
}


function archiveHunterScore(
  item: AnyObj
): number | null {

  return nullableNumber(
    item?.signal?.hunter_score ??
    item?.hunter_score
  );
}


function archiveMatcherScore(
  item: AnyObj
): number | null {

  return nullableNumber(
    item?.matcher?.matcher_score ??
    item?.matcher_score
  );
}


function archiveMatcherSource(
  item: AnyObj
): string | null {

  const source =
    safeString(
      item?.matcher?.source ??
      item?.source ??
      ""
    );

  return source || null;
}


function archiveCloudbetVerified(
  item: AnyObj
): number {

  return (
    item?.security?.cloudbet_verified === true ||
    item?.cloudbet_verified === true
  )
    ? 1
    : 0;
}


function archiveReason(
  item: AnyObj
): string | null {

  const reason =
    safeString(
      item?.reason ??
      item?.matcher?.reason ??
      ""
    );

  return reason || null;
}


function archiveCloudbetMatchId(
  item: AnyObj
): string | null {

  const id =
    safeString(
      item?.cloudbet?.id ??
      item?.cloudbet_match_id ??
      ""
    );

  return id || null;
}


function archiveCloudbetMatchName(
  item: AnyObj
): string | null {

  const name =
    safeString(
      item?.cloudbet?.match ??
      item?.cloudbet_match_name ??
      ""
    );

  return name || null;
}


// ============================================================
// ARCHIVE ONE RESULT
//
// IMPORTANT:
// INSERT OR IGNORE means:
//
// same match + same result
// = no duplicate.
//
// READY and NO_MATCH are allowed as separate results.
// ============================================================

async function archiveResult(
  db: D1Database,
  executionId: string,
  timestamp: string,
  item: AnyObj
): Promise<boolean> {

  const matchId =
    archiveMatchId(item);


  if (!matchId) {
    return false;
  }


  const result =
    safeString(
      item?.status
    ).toUpperCase();


  if (
    result !== "READY" &&
    result !== "NO_MATCH"
  ) {
    return false;
  }


  await db.prepare(`
    INSERT OR IGNORE INTO bet_archive (
      execution_id,
      timestamp,
      match_id,
      match_name,
      home,
      away,
      entry_minute,
      hunter_score,
      matcher_score,
      matcher_source,
      cloudbet_verified,
      result,
      reason,
      cloudbet_match_id,
      cloudbet_match_name
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      executionId,
      timestamp,
      matchId,
      archiveMatchName(item) || null,
      archiveHome(item) || null,
      archiveAway(item) || null,
      archiveEntryMinute(item),
      archiveHunterScore(item),
      archiveMatcherScore(item),
      archiveMatcherSource(item),
      archiveCloudbetVerified(item),
      result,
      archiveReason(item),
      archiveCloudbetMatchId(item),
      archiveCloudbetMatchName(item)
    )
    .run();


  return true;
}


// ============================================================
// ARCHIVE ALL RESULTS
// ============================================================

async function archiveResults(
  db: D1Database,
  executionId: string,
  timestamp: string,
  preparedBets: AnyObj[],
  noMatch: AnyObj[]
): Promise<AnyObj> {

  let attempted = 0;
  let archived = 0;


  for (
    const item
    of preparedBets
  ) {

    attempted++;

    try {

      if (
        await archiveResult(
          db,
          executionId,
          timestamp,
          item
        )
      ) {
        archived++;
      }

    } catch {
      // Archive failure must never stop Matcher/Cloudbet result.
    }
  }


  for (
    const item
    of noMatch
  ) {

    attempted++;

    try {

      if (
        await archiveResult(
          db,
          executionId,
          timestamp,
          item
        )
      ) {
        archived++;
      }

    } catch {
      // Archive failure must never stop Matcher/Cloudbet result.
    }
  }


  return {

    attempted,

    archived
  };
}


// ============================================================
// ARCHIVE ENDPOINT
// ============================================================

async function getArchive(
  db: D1Database
): Promise<Response> {

  const countResult =
    await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN result = 'READY'
            THEN 1
            ELSE 0
          END
        ) AS ready,
        SUM(
          CASE
            WHEN result = 'NO_MATCH'
            THEN 1
            ELSE 0
          END
        ) AS no_match,
        SUM(
          CASE
            WHEN cloudbet_verified = 1
            THEN 1
            ELSE 0
          END
        ) AS cloudbet_verified,
        SUM(
          CASE
            WHEN matcher_source = 'DIRECT_CLOUDBET_FALLBACK'
            THEN 1
            ELSE 0
          END
        ) AS fallback_matches
      FROM bet_archive
    `)
    .first();


  const rows =
    await db.prepare(`
      SELECT
        id,
        execution_id,
        timestamp,
        match_id,
        match_name,
        home,
        away,
        entry_minute,
        hunter_score,
        matcher_score,
        matcher_source,
        cloudbet_verified,
        result,
        reason,
        cloudbet_match_id,
        cloudbet_match_name
      FROM bet_archive
      ORDER BY timestamp DESC, id DESC
    `)
    .all();


  const total =
    Number(
      countResult?.total ?? 0
    );

  const ready =
    Number(
      countResult?.ready ?? 0
    );

  const noMatch =
    Number(
      countResult?.no_match ?? 0
    );

  const cloudbetVerified =
    Number(
      countResult?.cloudbet_verified ?? 0
    );

  const fallbackMatches =
    Number(
      countResult?.fallback_matches ?? 0
    );


  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    archive:
      "bet_archive",

    statistics: {

      total_hunter_entries:
        total,

      ready,

      no_match:
        noMatch,

      cloudbet_verified:
        cloudbetVerified,

      fallback_matches:
        fallbackMatches
    },


    // Telegram-friendly summary
    summary: [
      "ARCHIVE",
      "",
      `Total Hunter entries: ${total}`,
      `READY: ${ready}`,
      `NO_MATCH: ${noMatch}`,
      `Cloudbet verified: ${cloudbetVerified}`,
      `Fallback matches: ${fallbackMatches}`
    ].join("\n"),


    matches:
      rows.results ?? [],


    count:
      rows.results?.length ?? 0,

    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// ARCHIVE CLEAR
//
// IMPORTANT:
// ONLY bet_archive IS TOUCHED.
// TRACKER / MATCHER / CLOUDBET ARE NOT CALLED.
// ============================================================

async function clearArchive(
  db: D1Database
): Promise<Response> {

  const before =
    await db.prepare(`
      SELECT COUNT(*) AS total
      FROM bet_archive
    `)
    .first();


  const deleted =
    Number(
      before?.total ?? 0
    );


  await db.prepare(`
    DELETE FROM bet_archive
  `)
  .run();


  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    action:
      "ARCHIVE_CLEAR",

    archive:
      "bet_archive",

    deleted,

    tracker:
      "NOT TOUCHED",

    matcher:
      "NOT TOUCHED",

    cloudbet:
      "NOT TOUCHED",

    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// EMPTY RESPONSE
// ============================================================

function emptyResponse(
  allSignals: AnyObj[],
  started: number,
  trackerMs: number
): Response {

  const totalMs =
    Date.now() -
    started;


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
        true,

      DB:
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


    timing: {

      tracker_ms:
        trackerMs,

      matcher_ms:
        0,

      cloudbet_ms:
        0,

      parallel_external_ms:
        0,

      local_processing_ms:
        0,

      total_ms:
        totalMs
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
        totalMs
    },


    archive: {

      attempted:
        0,

      archived:
        0
    },


    prepared_bets:
      [],

    no_match:
      [],


    message:
      "V5.3 TEST READ ONLY. No active Hunter entries.",

    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// RUN V5.3
// ============================================================

async function runV53(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();


  const executionId =
    newExecutionId();


  const executionTimestamp =
    new Date().toISOString();


  // ==========================================================
  // TRACKER — ONE CALL
  // ==========================================================

  const trackerStarted =
    Date.now();


  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );


  const trackerMs =
    Date.now() -
    trackerStarted;


  const allSignals =
    extractSignals(
      trackerData
    );


  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );


  if (
    hunterEntries.length === 0
  ) {

    return emptyResponse(
      allSignals,
      started,
      trackerMs
    );
  }


  // ==========================================================
  // MATCHER + CLOUDBET
  //
  // V5.2 LOGIC PRESERVED.
  // ==========================================================

  const parallelStarted =
    Date.now();


  const matcherStarted =
    Date.now();

  const cloudbetStarted =
    Date.now();


  const matcherPromise =
    fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    ).then(
      data => ({
        data,
        ms:
          Date.now() -
          matcherStarted
      })
    );


  const cloudbetPromise =
    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    ).then(
      data => ({
        data,
        ms:
          Date.now() -
          cloudbetStarted
      })
    );


  const [
    matcherResultData,
    cloudbetResultData
  ] =
    await Promise.all([
      matcherPromise,
      cloudbetPromise
    ]);


  const parallelExternalMs =
    Date.now() -
    parallelStarted;


  const matcherData =
    matcherResultData.data;

  const matcherMs =
    matcherResultData.ms;


  const cloudbetData =
    cloudbetResultData.data;

  const cloudbetMs =
    cloudbetResultData.ms;


  const matcherMatches =
    extractMatcherMatches(
      matcherData
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

  const localProcessingStarted =
    Date.now();


  const preparedBets:
    AnyObj[] = [];

  const noMatch:
    AnyObj[] = [];

  const signalDiagnostics:
    AnyObj[] = [];


  let matcherSecureMatches = 0;

  let directFallbackMatches = 0;

  let cloudbetVerifiedMatches = 0;


  const rejectionReasons:
    Record<string, number> = {};


  // ==========================================================
  // PROCESS EVERY HUNTER ENTRY
  // ==========================================================

  for (
    const signal
    of hunterEntries
  ) {

    const diagnostic:
      AnyObj = {

      signal:
        signalMatchName(signal),

      match_id:
        signalMatchId(signal) ||
        null,

      signal_teams: {

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
      },

      matcher:
        null,

      cloudbet:
        null,

      final:
        null
    };


    // ========================================================
    // PRIMARY MATCHER
    // ========================================================

    const matcherResult =
      findBestMatcherCandidate(
        signal,
        matcherData
      );


    diagnostic.matcher = {

      found:
        matcherResult.found,

      reason:
        matcherResult.reason ??
        null,

      candidates_checked:
        matcherResult.diagnostics
          ?.candidates_checked ??
        matcherMatches.length,

      rejection_reasons:
        matcherResult.diagnostics
          ?.rejection_reasons ??
        {},

      selected:
        matcherResult.found
          ? {

              match:
                matcherResult.v27
                  ?.match ??
                null,

              home:
                matcherResult.v27
                  ?.home ??
                null,

              away:
                matcherResult.v27
                  ?.away ??
                null,

              matcher_score:
                matcherResult.matcher_score ??
                null,

              classification:
                matcherResult.classification ??
                null,

              method:
                matcherResult.method ??
                null,

              team_scores:
                matcherResult.team_scores ??
                null
            }
          : null
    };


    // ========================================================
    // MATCHER ACCEPTED
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


      diagnostic.cloudbet = {

        verification:
          cloudbetVerification.verified,

        reason:
          cloudbetVerification.reason ??
          null,

        method:
          cloudbetVerification.method ??
          null,

        direction:
          cloudbetVerification.direction ??
          null,

        combined_score:
          cloudbetVerification.combined_score ??
          null,

        match:
          cloudbetVerification.match
            ? displayMatch(
                cloudbetVerification.match
              )
            : null
      };


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


        diagnostic.final = {

          result:
            "READY",

          source:
            "MATCHER",

          reason:
            "MATCHER_AND_CLOUDBET_STRICTLY_CONFIRMED"
        };


        signalDiagnostics.push(
          diagnostic
        );


        continue;
      }


      // ======================================================
      // DIRECT FALLBACK
      // ======================================================

      const fallback =
        findDirectCloudbetFallback(
          signal,
          liveCloudbet
        );


      diagnostic.cloudbet.direct_fallback =
        fallback;


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
            "DIRECT_STRICT_TEAM_MATCH",

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
            "DIRECT_CLOUDBET_STRICT_TWO_SIDED_TEAMS",

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


        diagnostic.final = {

          result:
            "READY",

          source:
            "DIRECT_CLOUDBET_FALLBACK",

          reason:
            "DIRECT_CLOUDBET_STRICTLY_CONFIRMED"
        };


        signalDiagnostics.push(
          diagnostic
        );


        continue;
      }


      // ======================================================
      // COMPLETE FAILURE
      // ======================================================

      const reason =
        cloudbetVerification.reason ??
        "CLOUDBET_STRICT_MATCH_NOT_CONFIRMED";


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

            direct_fallback:
              {
                attempted:
                  true,

                found:
                  false
              }
          }
        )
      );


      diagnostic.final = {

        result:
          "NO_MATCH",

        reason
      };


      signalDiagnostics.push(
        diagnostic
      );


      continue;
    }


    // ========================================================
    // MATCHER FAILED
    // DIRECT CLOUDBET FALLBACK
    // ========================================================

    const fallback =
      findDirectCloudbetFallback(
        signal,
        liveCloudbet
      );


    diagnostic.cloudbet = {

      direct_fallback:
        fallback
    };


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
          "DIRECT_STRICT_TEAM_MATCH",

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
          "DIRECT_CLOUDBET_STRICT_TWO_SIDED_TEAMS",

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


      diagnostic.final = {

        result:
          "READY",

        source:
          "DIRECT_CLOUDBET_FALLBACK",

        reason:
          "MATCHER_FAILED_BUT_DIRECT_CLOUDBET_STRICTLY_CONFIRMED"
      };


      signalDiagnostics.push(
        diagnostic
      );


      continue;
    }


    // ========================================================
    // COMPLETE FAILURE
    // ========================================================

    const reason =
      "NO_ACCEPTABLE_MATCHER_OR_STRICT_CLOUDBET_MATCH";


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

            best_candidates:
              fallback.best_candidates ??
              [],

            rejected_candidates:
              fallback.rejected_candidates ??
              []
          }
        }
      )
    );


    diagnostic.final = {

      result:
        "NO_MATCH",

      reason
    };


    signalDiagnostics.push(
      diagnostic
    );
  }


  // ==========================================================
  // LOCAL PROCESSING TIMING
  // ==========================================================

  const localProcessingMs =
    Date.now() -
    localProcessingStarted;


  // ==========================================================
  // V5.3 ARCHIVE
  //
  // IMPORTANT:
  // Archive is AFTER all matching is complete.
  //
  // It does NOT change the matching decision.
  // ==========================================================

  const archive =
    await archiveResults(
      env.DB,
      executionId,
      executionTimestamp,
      preparedBets,
      noMatch
    );


  const totalMs =
    Date.now() -
    started;


  // ==========================================================
  // FINAL RESPONSE
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


    execution_id:
      executionId,


    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET:
        true,

      DB:
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

      test_mode:
        true,

      matcher_discovery_threshold:
        MATCHER_THRESHOLD,

      matcher_accept_min_score:
        MIN_MATCHER_SCORE,

      matcher_score_is_team_validation:
        false,

      matcher_team_minimum:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_minimum:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_minimum:
        CONTAINMENT_MIN_SCORE,

      token_minimum:
        TOKEN_MATCH_MIN_SCORE,

      confident_match_required:
        false,

      score_only_matching:
        false,

      exact_id_alone_is_not_secure:
        true,

      exact_id_requires_positive_matcher_score:
        true,

      two_sided_team_validation:
        true,

      strict_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_second_verification:
        true,

      direct_cloudbet_fallback:
        true,

      secure_flag_false_hard_rejection:
        false
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


    timing: {

      tracker_ms:
        trackerMs,

      matcher_ms:
        matcherMs,

      cloudbet_ms:
        cloudbetMs,

      parallel_external_ms:
        parallelExternalMs,

      local_processing_ms:
        localProcessingMs,

      total_ms:
        totalMs,

      sequential_estimate_ms:
        trackerMs +
        matcherMs +
        cloudbetMs,

      parallel_saving_estimate_ms:
        Math.max(
          0,
          (
            trackerMs +
            matcherMs +
            cloudbetMs
          ) -
          totalMs
        ),

      matcher_cloudbet_overlap:
        true
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
        totalMs
    },


    archive: {

      table:
        "bet_archive",

      execution_id:
        executionId,

      attempted:
        archive.attempted,

      archived:
        archive.archived,

      duplicate_policy:
        "SAME MATCH + SAME RESULT = IGNORE",

      results:
        "READY + NO_MATCH"
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


      signal_flow:
        signalDiagnostics,


      v53_rules: {

        archive:
          "D1 bet_archive",

        archive_ready:
          true,

        archive_no_match:
          true,

        archive_duplicate_policy:
          "UNIQUE MATCH_ID + RESULT",

        archive_clear:
          "ONLY bet_archive",

        matcher:
          "PRIMARY MATCH SOURCE",

        direct_cloudbet_fallback:
          "ENABLED",

        cloudbet:
          "INDEPENDENT STRICT TWO SIDED VERIFICATION",

        matcher_cloudbet_execution:
          "PARALLEL",

        betting:
          "DISABLED"
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

      matcher_cloudbet_parallel:
        true,

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
      "V5.3 TEST READ ONLY. V5.2 Matcher/Cloudbet logic preserved. Hunter results are archived in D1 bet_archive.",


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
        true,

      DB:
        true
    },


    security: {

      test_mode:
        true,

      matcher_discovery_threshold:
        MATCHER_THRESHOLD,

      matcher_accept_min_score:
        MIN_MATCHER_SCORE,

      matcher_team_minimum:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_minimum:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_minimum:
        CONTAINMENT_MIN_SCORE,

      token_minimum:
        TOKEN_MATCH_MIN_SCORE,

      confident_match_required:
        false,

      matcher_score_is_team_validation:
        false,

      secure_flag_false_hard_rejection:
        false,

      score_only:
        true,

      exact_id_alone:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      two_sided_team_validation:
        true,

      strict_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_second_verification:
        true,

      direct_cloudbet_fallback:
        true,

      strong_matcher_score:
        STRONG_MATCHER_SCORE
    },


    v53: {

      mode:
        "TEST",

      matcher_threshold:
        MATCHER_THRESHOLD,

      matcher_accept_min_score:
        MIN_MATCHER_SCORE,

      confident_match_required:
        false,

      matcher_score_is_team_validation:
        false,

      team_match_min_score:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_min_score:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_min_score:
        CONTAINMENT_MIN_SCORE,

      token_match_min_score:
        TOKEN_MATCH_MIN_SCORE,

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
        true,

      score_only:
        false,

      exact_id_alone:
        false,

      archive:
        "D1 bet_archive",

      archive_duplicate_policy:
        "UNIQUE MATCH_ID + RESULT",

      archive_clear:
        "ONLY bet_archive"
    },


    optimization: {

      tracker_calls:
        1,

      matcher_calls:
        1,

      cloudbet_live_calls:
        1,

      matcher_cloudbet_parallel:
        true,

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
        "/live",

      archive:
        "/archive",

      archive_clear:
        "/archive/clear"
    },


    rules: {

      no_active_signals:
        "NO MATCHER CALL / NO CLOUDBET CALL / NO BET",

      matcher:
        "PRIMARY MATCH SOURCE",

      matcher_confident:
        "NOT REQUIRED IN V5.3 TEST",

      matcher_score:
        `DISCOVERY SCORE >= ${STRONG_MATCHER_SCORE}`,

      matcher_score_alone:
        "NEVER SUFFICIENT",

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

      strict_team_threshold:
        `BOTH TEAMS >= ${TEAM_MATCH_MIN_SCORE}`,

      weak_team_match:
        "0.20-0.69 IS REJECTED",

      direct_fallback:
        "If Matcher fails, search Cloudbet /live directly",

      direct_teams:
        "Both signal teams must match Cloudbet teams",

      direct_minimum:
        `HOME >= ${DIRECT_CLOUDBET_MIN_SCORE} AND AWAY >= ${DIRECT_CLOUDBET_MIN_SCORE}`,

      direction:
        "Normal or reversed accepted",

      cloudbet:
        "Cloudbet live event must be independently verified",

      cloudbet_fetch:
        "Cloudbet /live is called once per worker execution",

      matcher_cloudbet:
        "RUN IN PARALLEL",

      archive:
        "Every HUNTER_ENTRY is archived",

      archive_duplicate:
        "Same match + same result is ignored",

      archive_clear:
        "Only bet_archive is deleted",

      timing:
        "ENABLED",

      betting:
        "DISABLED"
    },


    message:
      "V5.3 TEST worker is healthy. Matcher and Cloudbet logic are preserved. D1 Hunter archive is enabled.",


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

      // ======================================================
      // HEALTH
      // ======================================================

      if (
        path === "/" ||
        path === "/health"
      ) {

        return health();
      }


      // ======================================================
      // ARCHIVE
      // ======================================================

      if (
        path === "/archive"
      ) {

        return getArchive(
          env.DB
        );
      }


      // ======================================================
      // ARCHIVE CLEAR
      // ======================================================

      if (
        path === "/archive/clear"
      ) {

        return clearArchive(
          env.DB
        );
      }


      // ======================================================
      // MATCH / LIVE / BET
      // ======================================================

      if (
        path === "/match" ||
        path === "/live" ||
        path === "/bet"
      ) {

        return runV53(
          env,
          request
        );
      }


      // ======================================================
      // DIAGNOSTICS
      // ======================================================

      if (
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {

        return runV53(
          env,
          request
        );
      }


      // ======================================================
      // UNKNOWN ENDPOINT
      // ======================================================

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

            "/diagnostic",

            "/diagnostics",

            "/archive",

            "/archive/clear"
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
