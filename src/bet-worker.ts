// ============================================================
// CLOUDBET BET WORKER V4.4
// READ ONLY — SECURE SIGNAL -> MATCHER -> CLOUDBET
//
// V4.4 MATCHER ACCEPTANCE FIX
//
// CHANGES FROM V4.3:
//
// 1. SECURE_MATCH=false NO LONGER AUTOMATICALLY REJECTS
//    A STRONG VALID MATCHER CANDIDATE.
//
// 2. CONFIDENT_MATCH IS STILL PREFERRED.
//    If classification is missing but matcher score is strong,
//    the candidate can be accepted.
//
// 3. SCORE_ONLY_MATCH IS STILL ALWAYS REJECTED.
//
// 4. EXACT_ID ALONE IS STILL NOT ENOUGH.
//
// 5. EXACT_ID WITH POSITIVE MATCHER SCORE IS ALLOWED.
//
// 6. SIGNAL <-> V27 TEAM VALIDATION now accepts BOTH:
//       HOME -> HOME / AWAY -> AWAY
//    OR
//       HOME -> AWAY / AWAY -> HOME
//
// 7. CLOUDBET IS STILL VERIFIED INDEPENDENTLY.
//
// 8. CLOUDBET /live IS CALLED ONLY ONCE.
//
// 9. TWO-SIDED TEAM VALIDATION REMAINS REQUIRED.
//
// 10. DETAILED REJECTION REASONS ARE RETURNED.
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

const VERSION = "V4.4";

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
// V4.4 ACCEPTANCE SETTINGS
// ============================================================

// Strong matcher score can compensate for missing secure flag.
const STRONG_MATCHER_SCORE = 0.45;

// Score below this is never enough by itself.
const MIN_MATCHER_SCORE = 0.45;


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
    match?.key
  );
}


// ============================================================
// TEAM NORMALIZATION
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
    "soccer"
  ]);


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
// TEAM VALIDATION
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


function sameNormalizedTeam(
  a: any,
  b: any
): boolean {

  const A =
    normalizeTeam(a);


  const B =
    normalizeTeam(b);


  if (!A || !B) {
    return false;
  }


  return A === B;
}


// ============================================================
// TWO-SIDED TEAM MATCH
//
// V4.4:
// NORMAL direction OR REVERSED direction.
//
// This fixes cases where one source presents the fixture
// in the opposite home/away direction.
// ============================================================

function teamsMatchEitherDirection(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): boolean {

  const normal =
    sameNormalizedTeam(
      homeA,
      homeB
    ) &&
    sameNormalizedTeam(
      awayA,
      awayB
    );


  if (normal) {
    return true;
  }


  const reversed =
    sameNormalizedTeam(
      homeA,
      awayB
    ) &&
    sameNormalizedTeam(
      awayA,
      homeB
    );


  return reversed;
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
// EXTRACT V27 FROM MATCHER CANDIDATE
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
// EXTRACT CLOUDBET FROM MATCHER CANDIDATE
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
//
// V4.4:
//
// HARD REJECTIONS:
// - score_only
// - no teams
// - no Cloudbet target
// - signal teams incompatible
// - weak matcher score
//
// SOFT REJECTION:
// - secure_match=false
// - classification missing
//
// ACCEPT:
// - CONFIDENT_MATCH + valid teams
// - OR strong positive matcher score + valid teams
//
// EXACT_ID:
// - requires positive matcher score
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
  // SCORE ONLY
  // ----------------------------------------------------------

  if (scoreOnly) {

    return {
      accepted: false,
      reason: "SCORE_ONLY_MATCH_REJECTED",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
    };
  }


  // ----------------------------------------------------------
  // TEAMS
  // ----------------------------------------------------------

  if (
    !teamsPresent(
      vHome,
      vAway
    )
  ) {

    return {
      accepted: false,
      reason: "V27_TEAMS_EMPTY",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
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
      reason: "MATCHER_CLOUDBET_TARGET_EMPTY",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
    };
  }


  // ----------------------------------------------------------
  // SIGNAL TEAM VALIDATION
  // ----------------------------------------------------------

  if (
    sHome &&
    sAway
  ) {

    const compatible =
      teamsMatchEitherDirection(
        sHome,
        sAway,
        vHome,
        vAway
      );


    if (!compatible) {

      return {
        accepted: false,
        reason: "SIGNAL_TEAMS_MISMATCH",
        classification,
        method,
        matcher_score: matcherScore,
        secure_flag: secureFlag,

        signal: {
          home: sHome,
          away: sAway
        },

        v27: {
          home: vHome,
          away: vAway
        }
      };
    }
  }


  // ----------------------------------------------------------
  // EXACT ID SECURITY
  // ----------------------------------------------------------

  if (
    method ===
    "EXACT_ID" &&
    matcherScore <= 0
  ) {

    return {
      accepted: false,
      reason: "EXACT_ID_WITH_ZERO_SCORE_REJECTED",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
    };
  }


  // ----------------------------------------------------------
  // SCORE
  // ----------------------------------------------------------

  if (
    matcherScore <
    MIN_MATCHER_SCORE
  ) {

    return {
      accepted: false,
      reason: "MATCHER_SCORE_TOO_LOW",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
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
      accepted: false,
      reason: "NOT_CONFIDENT_AND_SCORE_NOT_STRONG",
      classification,
      method,
      matcher_score: matcherScore,
      secure_flag: secureFlag
    };
  }


  // ----------------------------------------------------------
  // ACCEPT
  //
  // secure_match=false is no longer a hard rejection.
  // Team validation + matcher score + non-score-only remain.
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
// FIND BEST MATCHER CANDIDATE FOR SIGNAL
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


  const rejectedCandidates:
    AnyObj[] = [];


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


    rejectedCandidates.push({
      reason,
      matcher_score:
        result.matcher_score,
      classification:
        result.classification,
      method:
        result.method
    });
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
// CLOUDBET SECURE VERIFICATION
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


  // ==========================================================
  // FIRST:
  // EXACT CLOUDBET ID + TWO-SIDED TEAMS
  // ==========================================================

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
          normalizeTeam(
            extractHome(cb)
          );


        const cbAway =
          normalizeTeam(
            extractAway(cb)
          );


        if (
          teamsMatchEitherDirection(
            targetHome,
            targetAway,
            cbHome,
            cbAway
          )
        ) {

          return {

            verified:
              true,

            method:
              "CLOUDBET_ID_AND_TEAMS",

            match:
              cb
          };
        }
      }
    }
  }


  // ==========================================================
  // SECOND:
  // EXACT TWO-SIDED TEAMS
  // ==========================================================

  for (
    const cb
    of cloudbetMatches
  ) {

    const cbHome =
      normalizeTeam(
        extractHome(cb)
      );


    const cbAway =
      normalizeTeam(
        extractAway(cb)
      );


    if (
      teamsMatchEitherDirection(
        targetHome,
        targetAway,
        cbHome,
        cbAway
      )
    ) {

      return {

        verified:
          true,

        method:
          "CLOUDBET_TWO_SIDED_TEAMS",

        match:
          cb
      };
    }
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


  const signalId =
    signalMatchId(signal);


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
        signalId ||
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
        secureMatcher.reason
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
      "NO_BET_IN_V4_4",


    reason
  };
}


// ============================================================
// PROCESS
// ============================================================

async function runV44(
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
          0
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

    // --------------------------------------------------------
    // FIND BEST MATCHER CANDIDATE
    // --------------------------------------------------------

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
              matcherResult.cloudbet
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

      v44_strong_score_acceptance:
        true,

      v44_secure_flag_not_hard_rejection:
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

      v44_rules: {

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

        direction:
          "NORMAL OR REVERSED",

        cloudbet:
          "INDEPENDENT TWO SIDED VERIFICATION"
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
      "V4.4 READ ONLY matcher acceptance fix. Strong valid matcher candidates are accepted even when secure_match is false. Score-only matches and zero-score EXACT_ID matches remain blocked. Cloudbet is independently verified once.",


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

      direction:
        "Normal or reversed home/away direction accepted",

      secure_flag:
        "secure_match=false is not an automatic rejection in V4.4",

      cloudbet:
        "Cloudbet live event must be independently verified",

      cloudbet_fetch:
        "Cloudbet /live is called once per worker execution",

      betting:
        "DISABLED"
    },


    message:
      "V4.4 optimized READ ONLY secure preparation worker is healthy.",


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

        return runV44(
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

        return runV44(
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
