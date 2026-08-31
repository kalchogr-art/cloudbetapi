// ============================================================
// CLOUDBET BET WORKER V4.6
// READ ONLY — BETTING DISABLED
//
// TRACKER -> MATCHER -> CLOUDBET
//                     \-> DIRECT CLOUDBET FALLBACK
//
// V4.6 CHANGE:
//
// 1. V7 MATCHER IS STILL PRIMARY.
// 2. IF MATCHER HAS NO ACCEPTABLE CANDIDATE FOR A SIGNAL,
//    V4.6 DIRECTLY SEARCHES THE ALREADY LOADED CLOUDBET /live
//    MATCHES.
// 3. CLOUDBET /live IS STILL CALLED ONLY ONCE.
// 4. DIRECT FALLBACK REQUIRES TWO-SIDED TEAM VALIDATION.
// 5. NORMAL AND REVERSED HOME/AWAY DIRECTION ARE ALLOWED.
// 6. EXACT TEAM MATCH IS ACCEPTED.
// 7. TOKEN / CONTAINMENT / CHARACTER SIMILARITY CAN BE USED,
//    BUT BOTH TEAMS MUST PASS.
// 8. SCORE-ONLY MATCHES ARE NEVER ACCEPTED.
// 9. EXACT ID ALONE IS NEVER ACCEPTED.
// 10. EXACT_ID WITH ZERO SCORE IS NEVER ACCEPTED.
// 11. secure_match=false FROM MATCHER IS NOT A HARD REJECTION.
// 12. BETTING REMAINS DISABLED.
//
// IMPORTANT:
// - READ ONLY
// - NO BET IS PLACED
// - CLOUDBET /live = ONE CALL
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

const VERSION = "V4.6";

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
// EXTRACT HOME
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
    typeof match?.home?.name ===
    "string"
  ) {
    return match.home.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
      ""
    ).home ?? ""
  );
}


// ============================================================
// EXTRACT AWAY
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
    typeof match?.away?.name ===
    "string"
  ) {
    return match.away.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
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
      match?.name
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
    match?.key
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
// TOKEN / CONTAINMENT TEAM SCORE
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


  if (A === B) {
    return 1;
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


    return Math.max(
      0.75,
      shorter /
        longer
    );
  }


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
      DIRECT_CLOUDBET_MIN_SCORE
    ) {

      return tokenScore;
    }
  }


  return characterSimilarity(
    A,
    B
  );
}


// ============================================================
// TWO-SIDED DIRECTIONAL SCORE
//
// Returns the BEST of normal / reversed direction,
// but BOTH sides must pass the minimum.
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


  const normalValid =
    normalHome >=
      DIRECT_CLOUDBET_MIN_SCORE &&
    normalAway >=
      DIRECT_CLOUDBET_MIN_SCORE;


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
// SIMPLE TEAM PRESENCE
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
// EXACT TWO-SIDED TEAM MATCH
// ============================================================

function teamsMatchEitherDirection(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): boolean {

  const normal =
    normalizeTeam(homeA) ===
      normalizeTeam(homeB) &&
    normalizeTeam(awayA) ===
      normalizeTeam(awayB);


  if (normal) {
    return true;
  }


  return (
    normalizeTeam(homeA) ===
      normalizeTeam(awayB) &&
    normalizeTeam(awayA) ===
      normalizeTeam(homeB)
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
    signal?.id
  );
}


function signalMatchName(
  signal: AnyObj
): string {

  return safeString(
    signal?.match ??
    signal?.name
  );
}


function signalHome(
  signal: AnyObj
): string {

  return extractHome(
    signal
  );
}


function signalAway(
  signal: AnyObj
): string {

  return extractAway(
    signal
  );
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
// EXTRACT V27
// ============================================================

function extractV27FromMatcher(
  item: AnyObj
): AnyObj {

  return (
    item?.v27 ??
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
      accepted: false,
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
      accepted: false,
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
      accepted: false,
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
  // SIGNAL -> V27 TWO SIDED
  // ----------------------------------------------------------

  if (
    sHome &&
    sAway
  ) {

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
  // WEAK SCORE = HARD REJECT
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


  return false;
}


// ============================================================
// DIRECT CLOUDBET FALLBACK
//
// IMPORTANT:
// This function DOES NOT call Cloudbet.
// It searches the already loaded /live array.
//
// BOTH TEAMS MUST MATCH.
// Normal or reversed direction allowed.
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


    // --------------------------------------------------------
    // EXACT ID CAN HELP ONLY IF IT IS ALSO TEAM VALIDATED.
    // It is never used alone.
    // --------------------------------------------------------

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


  if (!best) {

    return {

      found:
        false,

      reason:
        "DIRECT_CLOUDBET_TEAMS_NOT_CONFIRMED",

      candidates_checked:
        cloudbetMatches.length
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
// CLOUDBET SECOND VERIFICATION FOR MATCHER RESULT
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


  // ----------------------------------------------------------
  // FIRST: EXACT CLOUDBET ID + TWO-SIDED TEAMS
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
  // SECOND: TWO-SIDED TEAMS
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
      "NO_BET_IN_V4_6",

    reason
  };
}


// ============================================================
// RUN V4.6
// ============================================================

async function runV46(
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

        v46_direct_cloudbet_fallback:
          true
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


      optimization: {

        version:
          VERSION,

        tracker_calls:
          1,

        matcher_calls:
          0,

        cloudbet_live_calls:
          0,

        cloudbet_reused_for_all_signals:
          false,

        sequential_cloudbet_calls_per_signal:
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
  // PROCESS EVERY HUNTER SIGNAL
  // ==========================================================

  for (
    const signal
    of hunterEntries
  ) {

    // --------------------------------------------------------
    // PRIMARY: MATCHER
    // --------------------------------------------------------

    const matcherResult =
      findBestMatcherCandidate(
        signal,
        matcherData
      );


    // ========================================================
    // MATCHER ACCEPTED
    // ========================================================

    if (
      matcherResult.found
    ) {

      matcherSecureMatches++;


      // ------------------------------------------------------
      // INDEPENDENT CLOUDBET VERIFICATION
      // ------------------------------------------------------

      const cloudbetVerification =
        verifyCloudbetMatch(
          matcherResult,
          liveCloudbet
        );


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
      // MATCHER FOUND IT BUT CLOUDBET DID NOT CONFIRM IT
      //
      // We DO NOT blindly accept it.
      // We can still attempt the direct fallback using
      // the signal itself.
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
      // BOTH MATCHER AND DIRECT CLOUDBET FAILED
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

            direct_fallback:
              {

                attempted:
                  true,

                found:
                  false
              }
          }
        ),

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


    // ========================================================
    // MATCHER FAILED
    //
    // V4.6 NEW:
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
    // COMPLETE FAILURE
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
              null
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

      v46_direct_cloudbet_fallback:
        true,

      v46_secure_flag_not_hard_rejection:
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

      v46_rules: {

        matcher:
          "PRIMARY MATCH SOURCE",

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
      "V4.6 READ ONLY. Matcher remains primary. When Matcher has no acceptable candidate, the worker directly searches the single already-loaded Cloudbet /live dataset using two-sided team matching. Score-only and zero-score EXACT_ID matches remain blocked. Betting remains disabled.",


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


    v46: {

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
      "V4.6 optimized READ ONLY worker is healthy. Direct Cloudbet fallback is enabled.",


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

        return runV46(
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

        return runV46(
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
