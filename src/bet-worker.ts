// ============================================================
// CLOUDBET BET WORKER V5.4
// DRY RUN — TEST BETTING PIPELINE
// REAL BETTING DISABLED
//
// V5.4
// - V5.3 MATCHER/CLOUDBET LOGIC PRESERVED
// - D1 HUNTER ARCHIVE PRESERVED
// - READY HUNTER MATCHES ARCHIVED
// - IDEMPOTENT ARCHIVE
// - BATCH ARCHIVE WRITES
// - /archive
// - TRACKER 1 CALL
// - MATCHER 1 CALL
// - CLOUDBET /live 1 CALL
// - MATCHER + CLOUDBET PARALLEL
// - REDUCED DUPLICATED PROCESSING
//
// NEW V5.4
// - DRY_RUN BETTING PIPELINE
// - READY -> BET_CANDIDATE
// - MARKET: 1H Total Goals
// - SELECTION: OVER 0.5
// - STAKE: EUR 10
// - ODDS READ ONLY FROM CLOUDBET /live
// - NO ODDS INVENTION
// - NO POST BET REQUEST
// - BETTING_ENABLED HARD FALSE
// - BET_PLACED ALWAYS FALSE
// - TEST BET CANDIDATES COUNTED
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

const VERSION = "V5.4";
const MODE = "DRY_RUN";

const BETTING_ENABLED = false;
const DRY_RUN = true;

const BET_STAKE_EUR = 10;

const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

const MATCHER_THRESHOLD = 0.20;
const STRONG_MATCHER_SCORE = 0.20;
const MIN_MATCHER_SCORE = 0.20;

const TEAM_MATCH_MIN_SCORE = 0.70;
const CHARACTER_SIMILARITY_MIN_SCORE = 0.70;
const CONTAINMENT_MIN_SCORE = 0.75;
const EXACT_TEAM_SCORE = 1.00;
const TOKEN_MATCH_MIN_SCORE = 0.75;
const TOKEN_MIN_COMMON = 1;

const DIRECT_CLOUDBET_MIN_SCORE = TEAM_MATCH_MIN_SCORE;

const REQUIRED_MATCH_CLASSIFICATION = "CONFIDENT_MATCH";

const ALLOWED_SIGNAL_TYPE = "HUNTER_ENTRY";

const TARGET_SPORT = "SOCCER";
const TARGET_PERIOD = "FIRST_HALF";
const TARGET_OUTCOME = "OVER";
const TARGET_LINE = 0.5;

const ARCHIVE_TABLE = "hunter_bet_archive";

// ============================================================
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES: Record<string, string> = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "man u": "manchester united",
  "manchester utd": "manchester united",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "inter": "inter milan",
  "inter milano": "inter milan",
  "internazionale": "inter milan",
  "fc internazionale": "inter milan",
  "atletico": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "sporting cp": "sporting lisbon",
  "sporting lisboa": "sporting lisbon",
  "red star": "crvena zvezda",
  "red star belgrade": "crvena zvezda",
  "psv eindhoven": "psv",
  "bayern munchen": "bayern munich",
  "utd": "united",
  "ath": "athletic",
  "dep": "deportivo",
  "depor": "deportivo"
};

const GENERIC_WORDS = new Set([
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
// RESPONSE
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
      expires: "0"
    }
  });
}

// ============================================================
// BASIC HELPERS
// ============================================================

function safeString(v: any): string {
  return String(v ?? "").trim();
}

function normalizeText(v: any): string {
  return safeString(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyAliases(v: string): string {
  let r = normalizeText(v);

  if (!r) return "";

  for (const alias of Object.keys(TEAM_ALIASES)) {
    const escaped = alias.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    r = r.replace(
      new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"),
      `$1${TEAM_ALIASES[alias]}`
    );
  }

  return r.replace(/\s+/g, " ").trim();
}

function normalizeTeam(v: any): string {
  return applyAliases(safeString(v))
    .split(" ")
    .filter(Boolean)
    .filter(x => !GENERIC_WORDS.has(x))
    .filter(x => !/^\d+$/.test(x))
    .join(" ")
    .trim();
}

function teamTokens(v: any): string[] {
  return normalizeTeam(v)
    .split(" ")
    .filter(x => x.length >= 3);
}

function splitMatchName(v: any): {
  home: string | null;
  away: string | null;
} {
  const text = safeString(v);

  for (const sep of [" - ", " v ", " vs ", " VS ", " @ "]) {
    const i = text.indexOf(sep);

    if (i >= 0) {
      return {
        home: text.slice(0, i).trim(),
        away: text.slice(i + sep.length).trim()
      };
    }
  }

  return {
    home: null,
    away: null
  };
}

// ============================================================
// MATCH EXTRACTION
// ============================================================

function extractHome(m: AnyObj): string {
  if (!m) return "";

  const values = [
    m?.v27?.home,
    m?.v27?.homeTeam,
    m?.v27?.home_name,
    m?.home,
    m?.homeTeam,
    m?.home_name,
    m?.home?.name,
    m?.home_team?.name,
    m?.teams?.home?.name
  ];

  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return splitMatchName(
    m?.match ??
    m?.name ??
    m?.event_name ??
    ""
  ).home ?? "";
}

function extractAway(m: AnyObj): string {
  if (!m) return "";

  const values = [
    m?.v27?.away,
    m?.v27?.awayTeam,
    m?.v27?.away_name,
    m?.away,
    m?.awayTeam,
    m?.away_name,
    m?.away?.name,
    m?.away_team?.name,
    m?.teams?.away?.name
  ];

  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return splitMatchName(
    m?.match ??
    m?.name ??
    m?.event_name ??
    ""
  ).away ?? "";
}

function displayMatch(m: AnyObj): string {
  const direct = safeString(
    m?.match ??
    m?.name ??
    m?.event_name
  );

  return direct || `${extractHome(m)} - ${extractAway(m)}`;
}

function extractMatchId(m: AnyObj): string {
  return safeString(
    m?.id ??
    m?.match_id ??
    m?.matchId ??
    m?.key ??
    m?.event_id ??
    m?.eventId
  );
}

function teamsPresent(
  home: any,
  away: any
): boolean {
  return (
    !!normalizeTeam(home) &&
    !!normalizeTeam(away)
  );
}

// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(
  a: string,
  b: string
): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  let curr = new Array<number>(
    b.length + 1
  );

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost =
        a[i - 1] === b[j - 1]
          ? 0
          : 1;

      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }

    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function characterSimilarity(
  a: any,
  b: any
): number {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  return Math.max(
    0,
    1 -
      levenshtein(A, B) /
      Math.max(A.length, B.length)
  );
}

// ============================================================
// TEAM MATCH
// ============================================================

function teamMatchScore(
  a: any,
  b: any
): AnyObj {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) {
    return {
      score: 0,
      method: "EMPTY",
      exact: false,
      accepted: false
    };
  }

  if (A === B) {
    return {
      score: EXACT_TEAM_SCORE,
      method: "EXACT",
      exact: true,
      accepted: true
    };
  }

  if (
    A.includes(B) ||
    B.includes(A)
  ) {
    const score = Math.max(
      CONTAINMENT_MIN_SCORE,
      Math.min(A.length, B.length) /
        Math.max(A.length, B.length)
    );

    return {
      score,
      method: "CONTAINMENT",
      exact: false,
      accepted:
        score >= CONTAINMENT_MIN_SCORE
    };
  }

  const tokensA = teamTokens(A);
  const tokensB = teamTokens(B);

  const common = tokensA.filter(
    x => tokensB.includes(x)
  );

  if (common.length >= TOKEN_MIN_COMMON) {
    const score =
      common.length /
      Math.max(
        tokensA.length,
        tokensB.length
      );

    if (
      score >= TOKEN_MATCH_MIN_SCORE
    ) {
      return {
        score,
        method: "TOKEN_STRONG",
        exact: false,
        accepted: true,
        common_tokens: common
      };
    }
  }

  const score =
    characterSimilarity(A, B);

  return {
    score,
    method: "CHARACTER_SIMILARITY",
    exact: false,
    accepted:
      score >=
      CHARACTER_SIMILARITY_MIN_SCORE
  };
}

function twoSidedTeamScore(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): AnyObj {
  const nH = teamMatchScore(homeA, homeB);
  const nA = teamMatchScore(awayA, awayB);

  const rH = teamMatchScore(homeA, awayB);
  const rA = teamMatchScore(awayA, homeB);

  const normalScore =
    Math.min(nH.score, nA.score);

  const reversedScore =
    Math.min(rH.score, rA.score);

  const normalValid =
    nH.accepted &&
    nA.accepted &&
    nH.score >= TEAM_MATCH_MIN_SCORE &&
    nA.score >= TEAM_MATCH_MIN_SCORE;

  const reversedValid =
    rH.accepted &&
    rA.accepted &&
    rH.score >= TEAM_MATCH_MIN_SCORE &&
    rA.score >= TEAM_MATCH_MIN_SCORE;

  if (
    normalValid &&
    normalScore >= reversedScore
  ) {
    return {
      matched: true,
      direction: "NORMAL",
      home_score: nH.score,
      away_score: nA.score,
      combined_score: normalScore,
      both_teams_pass: true,
      home_method: nH.method,
      away_method: nA.method,
      home_accepted: nH.accepted,
      away_accepted: nA.accepted
    };
  }

  if (reversedValid) {
    return {
      matched: true,
      direction: "REVERSED",
      home_score: rH.score,
      away_score: rA.score,
      combined_score: reversedScore,
      both_teams_pass: true,
      home_method: rH.method,
      away_method: rA.method,
      home_accepted: rH.accepted,
      away_accepted: rA.accepted
    };
  }

  const normal =
    normalScore >= reversedScore;

  return {
    matched: false,
    direction:
      normal
        ? "NORMAL"
        : "REVERSED",
    home_score:
      normal
        ? nH.score
        : rH.score,
    away_score:
      normal
        ? nA.score
        : rA.score,
    combined_score:
      Math.max(
        normalScore,
        reversedScore
      ),
    both_teams_pass: false,
    home_method:
      normal
        ? nH.method
        : rH.method,
    away_method:
      normal
        ? nA.method
        : rA.method,
    home_accepted:
      normal
        ? nH.accepted
        : rH.accepted,
    away_accepted:
      normal
        ? nA.accepted
        : rA.accepted
  };
}

// ============================================================
// SERVICE FETCH
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  options: RequestInit = {}
): Promise<AnyObj> {
  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method:
            options.method ?? "GET",
          headers: {
            accept:
              "application/json",
            ...(options.headers ?? {})
          },
          body: options.body
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
// TRACKER
// ============================================================

function extractSignals(
  data: AnyObj
): AnyObj[] {
  if (Array.isArray(data?.signals)) {
    return data.signals;
  }

  if (Array.isArray(data?.entries)) {
    return data.entries;
  }

  if (Array.isArray(data?.hunter_entries)) {
    return data.hunter_entries;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}

function isHunterEntry(
  signal: AnyObj
): boolean {
  return safeString(
    signal?.type ??
    signal?.signal_type ??
    signal?.signalType
  ).toUpperCase() ===
    ALLOWED_SIGNAL_TYPE;
}

function signalMatchId(
  s: AnyObj
): string {
  return safeString(
    s?.match_id ??
    s?.matchId ??
    s?.id ??
    s?.v27?.id
  );
}

function signalMatchName(
  s: AnyObj
): string {
  return safeString(
    s?.match ??
    s?.name ??
    s?.v27?.match
  );
}

function signalHome(
  s: AnyObj
): string {
  return typeof s?.v27?.home === "string"
    ? s.v27.home.trim()
    : extractHome(s);
}

function signalAway(
  s: AnyObj
): string {
  return typeof s?.v27?.away === "string"
    ? s.v27.away.trim()
    : extractAway(s);
}

// ============================================================
// MATCHER
// ============================================================

function extractMatcherMatches(
  data: AnyObj
): AnyObj[] {
  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  if (Array.isArray(data?.results)) {
    return data.results;
  }

  if (Array.isArray(data?.matched)) {
    return data.matched;
  }

  if (Array.isArray(data?.candidates)) {
    return data.candidates;
  }

  return [];
}

function getMatcherScore(
  item: AnyObj
): number {
  const s =
    item?.scoring ??
    item?.matcher_scoring ??
    item?.score_details ??
    {};

  const score = Number(
    s?.total ??
    s?.score ??
    item?.matcher_score ??
    item?.match_score ??
    item?.score ??
    0
  );

  return Number.isFinite(score)
    ? score
    : 0;
}

function getClassification(
  item: AnyObj
): string {
  return safeString(
    item?.classification ??
    item?.match_classification ??
    item?.security?.classification
  ).toUpperCase();
}

function getMatchMethod(
  item: AnyObj
): string {
  return safeString(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method
  ).toUpperCase();
}

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

function extractV27FromMatcher(
  item: AnyObj
): AnyObj {
  return (
    item?.v27 ??
    item?.source ??
    item
  );
}

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
// MATCHER VALIDATION
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

  const base = {
    classification,
    method,
    matcher_score: matcherScore,
    secure_flag: secureFlag
  };

  if (scoreOnly) {
    return {
      accepted: false,
      reason:
        "SCORE_ONLY_MATCH_REJECTED",
      ...base
    };
  }

  if (!teamsPresent(vHome, vAway)) {
    return {
      accepted: false,
      reason:
        "V27_TEAMS_EMPTY",
      ...base
    };
  }

  if (!teamsPresent(sHome, sAway)) {
    return {
      accepted: false,
      reason:
        "SIGNAL_TEAMS_EMPTY",
      ...base
    };
  }

  const teamScore =
    twoSidedTeamScore(
      sHome,
      sAway,
      vHome,
      vAway
    );

  if (!teamScore.matched) {
    return {
      accepted: false,
      reason:
        "STRICT_SIGNAL_TEAMS_MISMATCH",
      ...base,
      team_scores: teamScore
    };
  }

  if (
    method === "EXACT_ID" &&
    matcherScore <= 0
  ) {
    return {
      accepted: false,
      reason:
        "EXACT_ID_WITH_ZERO_SCORE_REJECTED",
      ...base,
      team_scores: teamScore
    };
  }

  if (
    matcherScore <
    MIN_MATCHER_SCORE
  ) {
    return {
      accepted: false,
      reason:
        "MATCHER_SCORE_TOO_LOW",
      ...base,
      team_scores: teamScore
    };
  }

  const confident =
    classification ===
    REQUIRED_MATCH_CLASSIFICATION;

  const strongScore =
    matcherScore >=
    STRONG_MATCHER_SCORE;

  if (!confident && !strongScore) {
    return {
      accepted: false,
      reason:
        "NOT_CONFIDENT_AND_SCORE_NOT_STRONG",
      ...base,
      team_scores: teamScore
    };
  }

  return {
    accepted: true,

    reason:
      confident
        ? "CONFIDENT_MATCH_ACCEPTED"
        : "V51_STRICT_TWO_SIDED_MATCH_ACCEPTED",

    classification:
      classification || null,

    method:
      method || null,

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

  for (const item of matches) {
    const result =
      validateMatcherCandidate(
        signal,
        item
      );

    if (result.accepted) {
      if (
        !best ||
        result.matcher_score >
          best.matcher_score
      ) {
        best = result;
      }

      continue;
    }

    const reason =
      result.reason ??
      "UNKNOWN";

    rejectionReasons[reason] =
      (rejectionReasons[reason] ?? 0) + 1;
  }

  if (!best) {
    return {
      found: false,
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

  return {
    found: true,
    source: "MATCHER",
    ...best,

    diagnostics: {
      candidates_checked:
        matches.length,

      rejection_reasons:
        rejectionReasons
    }
  };
}

// ============================================================
// CLOUDBET
// ============================================================

function extractCloudbetMatches(
  data: AnyObj
): AnyObj[] {
  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  if (
    Array.isArray(
      data?.live_matches
    )
  ) {
    return data.live_matches;
  }

  if (Array.isArray(data?.events)) {
    return data.events;
  }

  if (Array.isArray(data?.data)) {
    return data.data;
  }

  return [];
}

function isCloudbetLive(
  m: AnyObj
): boolean {
  const status =
    safeString(
      m?.status
    ).toUpperCase();

  return (
    status === "TRADING_LIVE" ||
    m?.live === true ||
    safeString(
      m?.state
    ).toUpperCase() === "LIVE"
  );
}

// ============================================================
// ODDS EXTRACTION — V5.4
//
// IMPORTANT:
// Odds are NEVER invented.
// If /live does not expose a usable decimal price,
// odds = null.
// ============================================================

function extractOdds(
  m: AnyObj
): number | null {
  const values = [
    m?.odds,
    m?.price,
    m?.decimal_odds,
    m?.decimalOdds,

    m?.markets?.["1H Total Goals"]?.odds,
    m?.markets?.["1H Total Goals"]?.over_0_5,

    m?.markets?.first_half_total_goals?.over_0_5,

    m?.market?.odds
  ];

  for (const value of values) {
    const n = Number(value);

    if (
      Number.isFinite(n) &&
      n > 1
    ) {
      return n;
    }
  }

  return null;
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

  if (!teamsPresent(sHome, sAway)) {
    return {
      found: false,
      reason:
        "SIGNAL_TEAMS_EMPTY",
      candidates_checked:
        cloudbetMatches.length
    };
  }

  let best:
    AnyObj | null = null;

  const rejected: AnyObj[] = [];
  const topCandidates: AnyObj[] = [];

  for (const cb of cloudbetMatches) {
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

    const info = {
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

    topCandidates.push(info);

    if (!scored.matched) {
      rejected.push({
        ...info,
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
        ...info,
        rejection:
          "TEAM_SCORE_BELOW_STRICT_MINIMUM"
      });

      continue;
    }

    const candidate = {
      match: cb,

      direction:
        scored.direction,

      home_score:
        scored.home_score,

      away_score:
        scored.away_score,

      combined_score:
        scored.combined_score,

      exact_id:
        !!signalMatchId(signal) &&
        !!extractMatchId(cb) &&
        signalMatchId(signal) ===
          extractMatchId(cb)
    };

    if (
      !best ||
      candidate.combined_score >
        best.combined_score
    ) {
      best = candidate;
    }
  }

  topCandidates.sort(
    (a, b) =>
      b.combined_score -
      a.combined_score
  );

  if (!best) {
    return {
      found: false,

      reason:
        "DIRECT_CLOUDBET_STRICT_TEAMS_NOT_CONFIRMED",

      candidates_checked:
        cloudbetMatches.length,

      best_candidates:
        topCandidates.slice(0, 10),

      rejected_candidates:
        rejected.slice(0, 10)
    };
  }

  return {
    found: true,

    source:
      "DIRECT_CLOUDBET_FALLBACK",

    reason:
      "DIRECT_CLOUDBET_STRICT_TWO_SIDED_TEAM_MATCH",

    ...best,

    candidates_checked:
      cloudbetMatches.length
  };
}

// ============================================================
// SECOND CLOUDBET VERIFICATION
// ============================================================

function verifyCloudbetMatch(
  secureMatcher: AnyObj,
  cloudbetMatches: AnyObj[]
): AnyObj {
  const target =
    secureMatcher?.cloudbet;

  if (!target) {
    return {
      verified: false,
      reason:
        "MATCHER_DID_NOT_RETURN_CLOUDBET_MATCH"
    };
  }

  const targetId =
    safeString(target?.id);

  const targetHome =
    normalizeTeam(target?.home);

  const targetAway =
    normalizeTeam(target?.away);

  if (!targetHome || !targetAway) {
    return {
      verified: false,
      reason:
        "MATCHER_CLOUDBET_TEAMS_EMPTY"
    };
  }

  if (targetId) {
    for (const cb of cloudbetMatches) {
      if (
        extractMatchId(cb) !==
        targetId
      ) {
        continue;
      }

      const score =
        twoSidedTeamScore(
          targetHome,
          targetAway,
          extractHome(cb),
          extractAway(cb)
        );

      if (
        score.matched &&
        score.home_score >=
          DIRECT_CLOUDBET_MIN_SCORE &&
        score.away_score >=
          DIRECT_CLOUDBET_MIN_SCORE
      ) {
        return {
          verified: true,

          method:
            "CLOUDBET_ID_AND_STRICT_TEAMS",

          direction:
            score.direction,

          home_score:
            score.home_score,

          away_score:
            score.away_score,

          combined_score:
            score.combined_score,

          match:
            cb
        };
      }
    }
  }

  let best:
    AnyObj | null = null;

  for (const cb of cloudbetMatches) {
    const score =
      twoSidedTeamScore(
        targetHome,
        targetAway,
        extractHome(cb),
        extractAway(cb)
      );

    if (
      !score.matched ||
      score.home_score <
        DIRECT_CLOUDBET_MIN_SCORE ||
      score.away_score <
        DIRECT_CLOUDBET_MIN_SCORE
    ) {
      continue;
    }

    if (
      !best ||
      score.combined_score >
        best.combined_score
    ) {
      best = {
        match: cb,

        direction:
          score.direction,

        home_score:
          score.home_score,

        away_score:
          score.away_score,

        combined_score:
          score.combined_score
      };
    }
  }

  if (best) {
    return {
      verified: true,

      method:
        "CLOUDBET_STRICT_TWO_SIDED_TEAMS",

      ...best
    };
  }

  return {
    verified: false,

    reason:
      "CLOUDBET_STRICT_TEAM_MATCH_NOT_CONFIRMED"
  };
}

// ============================================================
// PREPARED BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  matcher: AnyObj,
  verification: AnyObj
): AnyObj {
  const cb =
    verification.match;

  return {
    status: "READY",

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
        null,

      odds:
        extractOdds(cb)
    },

    matcher: {
      source:
        matcher.source,

      classification:
        matcher.classification ??
        null,

      match_method:
        matcher.method ??
        null,

      matcher_score:
        matcher.matcher_score ??
        null,

      reason:
        matcher.reason,

      fallback:
        matcher.source ===
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
        matcher.classification ===
        REQUIRED_MATCH_CLASSIFICATION,

      strong_matcher_score:
        matcher.matcher_score != null &&
        matcher.matcher_score >=
          STRONG_MATCHER_SCORE,

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
        verification.method,

      cloudbet_team_direction:
        verification.direction ??
        null,

      cloudbet_combined_score:
        verification.combined_score ??
        null,

      test_mode:
        true
    },

    action:
      "NO_BET_V5_4_DRY_RUN"
  };
}

// ============================================================
// DRY RUN BET CANDIDATE
// ============================================================

function buildDryRunCandidate(
  bet: AnyObj
): AnyObj {
  const odds =
    extractOdds(
      bet?.cloudbet
    );

  const oddsAvailable =
    odds !== null;

  return {
    status:
      "BET_CANDIDATE",

    mode:
      "DRY_RUN",

    betting_enabled:
      false,

    dry_run:
      true,

    bet_placed:
      false,

    bet_action:
      "NOT_PLACED",

    simulated:
      true,

    simulated_result:
      "TEST_BET_REGISTERED",

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    stake_eur:
      BET_STAKE_EUR,

    odds,

    odds_available:
      oddsAvailable,

    candidate_complete:
      oddsAvailable,

    signal: {
      match:
        bet?.signal?.match ??
        null,

      match_id:
        bet?.signal?.match_id ??
        null,

      home:
        bet?.signal?.home ??
        null,

      away:
        bet?.signal?.away ??
        null,

      entry_minute:
        bet?.signal?.entry_minute ??
        null,

      hunter_score:
        bet?.signal?.hunter_score ??
        null
    },

    matcher: {
      score:
        bet?.matcher?.matcher_score ??
        null,

      source:
        bet?.matcher?.source ??
        null,

      classification:
        bet?.matcher?.classification ??
        null,

      match_method:
        bet?.matcher?.match_method ??
        null
    },

    cloudbet: {
      verified:
        bet?.security?.cloudbet_verified ??
        false,

      id:
        bet?.cloudbet?.id ??
        null,

      key:
        bet?.cloudbet?.key ??
        null,

      match:
        bet?.cloudbet?.match ??
        null,

      home:
        bet?.cloudbet?.home ??
        null,

      away:
        bet?.cloudbet?.away ??
        null,

      status:
        bet?.cloudbet?.status ??
        null,

      live:
        bet?.cloudbet?.live ??
        null,

      score:
        bet?.cloudbet?.score ??
        null,

      minute:
        bet?.cloudbet?.minute ??
        null,

      odds
    },

    security: {
      dry_run:
        true,

      betting_disabled:
        true,

      real_bet_allowed:
        false,

      odds_from_cloudbet_only:
        true,

      odds_invented:
        false,

      real_post_executed:
        false
    }
  };
}

// ============================================================
// ARCHIVE KEY
// ============================================================

function archiveKey(
  bet: AnyObj
): string {
  const id =
    safeString(
      bet?.signal?.match_id
    );

  if (id) {
    return `id:${id}`;
  }

  const home =
    normalizeTeam(
      bet?.signal?.home
    );

  const away =
    normalizeTeam(
      bet?.signal?.away
    );

  return `teams:${home}:${away}`;
}

// ============================================================
// ARCHIVE BATCH
//
// One D1 batch instead of one DB request per READY match.
// INSERT OR IGNORE keeps execution idempotent.
// ============================================================

async function archiveReadyBets(
  env: Env,
  bets: AnyObj[]
): Promise<{
  inserted: number;
  duplicates: number;
}> {
  if (!bets.length) {
    return {
      inserted: 0,
      duplicates: 0
    };
  }

  const now =
    new Date().toISOString();

  const statements =
    bets.map(bet => {
      return env.DB
        .prepare(`
          INSERT OR IGNORE INTO hunter_bet_archive (
            archive_key,
            match_id,
            match,
            home,
            away,
            entry_minute,
            hunter_score,
            cloudbet_id,
            cloudbet_match,
            matcher_source,
            matcher_score,
            cloudbet_combined_score,
            direction,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bind(
          archiveKey(bet),

          bet.signal.match_id ??
            null,

          bet.signal.match ??
            null,

          bet.signal.home ??
            null,

          bet.signal.away ??
            null,

          bet.signal.entry_minute ??
            null,

          bet.signal.hunter_score ??
            null,

          bet.cloudbet.id ??
            null,

          bet.cloudbet.match ??
            null,

          bet.matcher.source ??
            null,

          bet.matcher.matcher_score ??
            null,

          bet.security
            .cloudbet_combined_score ??
            null,

          bet.security
            .cloudbet_team_direction ??
            null,

          now
        );
    });

  const results =
    await env.DB.batch(
      statements
    );

  let inserted = 0;

  for (const result of results) {
    inserted +=
      Number(
        result?.meta?.changes ??
        0
      );
  }

  return {
    inserted,

    duplicates:
      Math.max(
        0,
        bets.length - inserted
      )
  };
}

// ============================================================
// /ARCHIVE
// ============================================================

async function archiveResponse(
  env: Env
): Promise<Response> {
  const count =
    await env.DB
      .prepare(`
        SELECT COUNT(*) AS total
        FROM hunter_bet_archive
      `)
      .first<{
        total: number;
      }>();

  const recent =
    await env.DB
      .prepare(`
        SELECT
          id,
          match_id,
          match,
          home,
          away,
          entry_minute,
          hunter_score,
          cloudbet_id,
          matcher_source,
          matcher_score,
          cloudbet_combined_score,
          direction,
          created_at
        FROM hunter_bet_archive
        ORDER BY id DESC
        LIMIT 20
      `)
      .all();

  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    archive: {
      table:
        ARCHIVE_TABLE,

      total_confirmed_hunter_matches:
        Number(
          count?.total ??
          0
        ),

      recent_count:
        recent.results?.length ??
        0,

      recent:
        recent.results ??
        []
    },

    database: {
      binding:
        "DB",

      status:
        "OK"
    },

    timestamp:
      new Date().toISOString()
  });
}

// ============================================================
// NO MATCH
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
      "NO_BET_V5_4_DRY_RUN",

    reason
  };
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
    Date.now() - started;

  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",

    bindings: {
      TRACKER: true,
      MATCHER: true,
      CLOUDBET: true,
      DB: true
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

    dry_run: {
      enabled:
        true,

      betting_enabled:
        false,

      candidates:
        0,

      complete_candidates:
        0,

      incomplete_candidates:
        0,

      bets_placed:
        0,

      bets_not_placed:
        0,

      simulated_bets:
        0,

      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION
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

    archive: {
      table:
        ARCHIVE_TABLE,

      called:
        false,

      archived:
        0,

      duplicates:
        0
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

      bets_ready:
        0,

      bet_candidates:
        0,

      complete_bet_candidates:
        0,

      incomplete_bet_candidates:
        0,

      simulated_bets:
        0,

      no_match:
        0,

      archive_inserted:
        0,

      archive_duplicates:
        0,

      processing_ms:
        totalMs
    },

    prepared_bets: [],

    bet_candidates: [],

    no_match: [],

    message:
      "V5.4 DRY RUN. No active Hunter entries.",

    timestamp:
      new Date().toISOString()
  });
}

// ============================================================
// RUN V5.4
// ============================================================

async function runV54(
  env: Env,
  request: Request
): Promise<Response> {
  const started =
    Date.now();

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

  if (!hunterEntries.length) {
    return emptyResponse(
      allSignals,
      started,
      trackerMs
    );
  }

  // ==========================================================
  // MATCHER + CLOUDBET — PARALLEL
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
    ).then(data => ({
      data,

      ms:
        Date.now() -
        matcherStarted
    }));

  const cloudbetPromise =
    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    ).then(data => ({
      data,

      ms:
        Date.now() -
        cloudbetStarted
    }));

  const [
    matcherResult,
    cloudbetResult
  ] =
    await Promise.all([
      matcherPromise,
      cloudbetPromise
    ]);

  const parallelExternalMs =
    Date.now() -
    parallelStarted;

  const matcherData =
    matcherResult.data;

  const cloudbetData =
    cloudbetResult.data;

  const matcherMs =
    matcherResult.ms;

  const cloudbetMs =
    cloudbetResult.ms;

  const matcherMatches =
    extractMatcherMatches(
      matcherData
    );

  const liveCloudbet =
    extractCloudbetMatches(
      cloudbetData
    ).filter(
      isCloudbetLive
    );

  // ==========================================================
  // LOCAL PROCESSING
  // ==========================================================

  const localStarted =
    Date.now();

  const preparedBets:
    AnyObj[] = [];

  const dryRunCandidates:
    AnyObj[] = [];

  const noMatch:
    AnyObj[] = [];

  const signalDiagnostics:
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
  // PROCESS HUNTER ENTRIES
  // ==========================================================

  for (const signal of hunterEntries) {
    const diagnostic: AnyObj = {
      signal:
        signalMatchName(signal),

      match_id:
        signalMatchId(signal) ||
        null,

      matcher:
        null,

      cloudbet:
        null,

      betting:
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
        matcherResult
          .diagnostics
          ?.candidates_checked ??
        matcherMatches.length,

      rejection_reasons:
        matcherResult
          .diagnostics
          ?.rejection_reasons ??
        {},

      selected:
        matcherResult.found
          ? {
              match:
                matcherResult
                  .v27?.match ??
                null,

              home:
                matcherResult
                  .v27?.home ??
                null,

              away:
                matcherResult
                  .v27?.away ??
                null,

              matcher_score:
                matcherResult
                  .matcher_score ??
                null,

              classification:
                matcherResult
                  .classification ??
                null,

              method:
                matcherResult
                  .method ??
                null,

              team_scores:
                matcherResult
                  .team_scores ??
                null
            }
          : null
    };

    // ========================================================
    // MATCHER ACCEPTED
    // ========================================================

    if (matcherResult.found) {
      matcherSecureMatches++;

      const verification =
        verifyCloudbetMatch(
          matcherResult,
          liveCloudbet
        );

      diagnostic.cloudbet = {
        verification:
          verification.verified,

        reason:
          verification.reason ??
          null,

        method:
          verification.method ??
          null,

        direction:
          verification.direction ??
          null,

        combined_score:
          verification.combined_score ??
          null,

        match:
          verification.match
            ? displayMatch(
                verification.match
              )
            : null
      };

      if (verification.verified) {
        cloudbetVerifiedMatches++;

        const bet =
          buildPreparedBet(
            signal,
            matcherResult,
            verification
          );

        preparedBets.push(
          bet
        );

        const candidate =
          buildDryRunCandidate(
            bet
          );

        dryRunCandidates.push(
          candidate
        );

        diagnostic.betting = {
          result:
            "BET_CANDIDATE",

          mode:
            "DRY_RUN",

          odds:
            candidate.odds,

          candidate_complete:
            candidate.candidate_complete,

          bet_placed:
            false
        };

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

      if (fallback.found) {
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

        const bet =
          buildPreparedBet(
            signal,
            fallbackMatcher,
            directVerification
          );

        preparedBets.push(
          bet
        );

        const candidate =
          buildDryRunCandidate(
            bet
          );

        dryRunCandidates.push(
          candidate
        );

        diagnostic.betting = {
          result:
            "BET_CANDIDATE",

          mode:
            "DRY_RUN",

          odds:
            candidate.odds,

          candidate_complete:
            candidate.candidate_complete,

          bet_placed:
            false
        };

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
      // MATCHER ACCEPTED BUT CLOUDBET FAILED
      // ======================================================

      const reason =
        verification.reason ??
        "CLOUDBET_STRICT_MATCH_NOT_CONFIRMED";

      rejectionReasons[reason] =
        (rejectionReasons[reason] ?? 0) +
        1;

      noMatch.push(
        buildNoMatch(
          signal,
          reason,
          {
            matcher_source:
              "MATCHER",

            classification:
              matcherResult
                .classification,

            match_method:
              matcherResult
                .method,

            matcher_score:
              matcherResult
                .matcher_score,

            matcher_reason:
              matcherResult
                .reason,

            v27:
              matcherResult
                .v27,

            cloudbet_target:
              matcherResult
                .cloudbet,

            cloudbet_verification:
              verification,

            direct_fallback: {
              attempted:
                true,

              found:
                false
            }
          }
        )
      );

      diagnostic.betting = {
        result:
          "NOT_A_CANDIDATE",

        reason
      };

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
    // MATCHER FAILED → DIRECT CLOUDBET
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

    if (fallback.found) {
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

      const bet =
        buildPreparedBet(
          signal,
          fallbackMatcher,
          directVerification
        );

      preparedBets.push(
        bet
      );

      const candidate =
        buildDryRunCandidate(
          bet
        );

      dryRunCandidates.push(
        candidate
      );

      diagnostic.betting = {
        result:
          "BET_CANDIDATE",

        mode:
          "DRY_RUN",

        odds:
          candidate.odds,

        candidate_complete:
          candidate.candidate_complete,

        bet_placed:
          false
      };

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
      (rejectionReasons[reason] ?? 0) +
      1;

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
              matcherResult
                .reason ??
              null
          },

          direct_cloudbet_fallback: {
            attempted:
              true,

            found:
              false,

            candidates_checked:
              fallback.candidates_checked ??
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

    diagnostic.betting = {
      result:
        "NOT_A_CANDIDATE",

      reason
    };

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
  // ARCHIVE — ONE D1 BATCH
  // ==========================================================

  const archiveStarted =
    Date.now();

  const archiveResult =
    await archiveReadyBets(
      env,
      preparedBets
    );

  const archiveMs =
    Date.now() -
    archiveStarted;

  const archiveInserted =
    archiveResult.inserted;

  const archiveDuplicates =
    archiveResult.duplicates;

  // ==========================================================
  // DRY RUN STATS
  // ==========================================================

  const completeBetCandidates =
    dryRunCandidates.filter(
      candidate =>
        candidate.candidate_complete ===
        true
    ).length;

  const incompleteBetCandidates =
    dryRunCandidates.filter(
      candidate =>
        candidate.candidate_complete !==
        true
    ).length;

  const simulatedBets =
    dryRunCandidates.length;

  // ==========================================================
  // TIMING
  // ==========================================================

  const localProcessingMs =
    Date.now() -
    localStarted;

  const totalMs =
    Date.now() -
    started;

  const sequentialEstimateMs =
    trackerMs +
    matcherMs +
    cloudbetMs;

  const parallelSavingEstimateMs =
    Math.max(
      0,
      sequentialEstimateMs -
        totalMs
    );

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

    dry_run: {
      enabled:
        DRY_RUN,

      betting_enabled:
        BETTING_ENABLED,

      real_bet_execution:
        false,

      candidates:
        dryRunCandidates.length,

      complete_candidates:
        completeBetCandidates,

      incomplete_candidates:
        incompleteBetCandidates,

      simulated_bets:
        simulatedBets,

      bets_placed:
        0,

      bets_not_placed:
        dryRunCandidates.length,

      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      odds_source:
        "CLOUDBET /live ONLY",

      odds_invented:
        false,

      test_result:
        "TEST_BET_REGISTERED"
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
        matcherData?.success ===
        true,

      version:
        matcherData?.version ??
        null,

      candidates_detected:
        matcherData
          ?.candidates_detected ??
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
        extractCloudbetMatches(
          cloudbetData
        ).length,

      live_matches:
        liveCloudbet.length,

      verified_matches:
        cloudbetVerifiedMatches
    },

    archive: {
      table:
        ARCHIVE_TABLE,

      binding:
        "DB",

      ready_received:
        preparedBets.length,

      inserted:
        archiveInserted,

      duplicates:
        archiveDuplicates,

      batch:
        true,

      idempotent:
        true,

      db_ms:
        archiveMs
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

      archive_ms:
        archiveMs,

      total_ms:
        totalMs,

      sequential_estimate_ms:
        sequentialEstimateMs,

      parallel_saving_estimate_ms:
        parallelSavingEstimateMs,

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

      bet_candidates:
        dryRunCandidates.length,

      complete_bet_candidates:
        completeBetCandidates,

      incomplete_bet_candidates:
        incompleteBetCandidates,

      simulated_bets:
        simulatedBets,

      bets_placed:
        0,

      bets_not_placed:
        dryRunCandidates.length,

      no_match:
        noMatch.length,

      matcher_candidates:
        matcherMatches.length,

      archive_inserted:
        archiveInserted,

      archive_duplicates:
        archiveDuplicates,

      processing_ms:
        totalMs
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
        Math.max(
          0,
          hunterEntries.length -
            cloudbetVerifiedMatches
        ),

      signal_flow:
        signalDiagnostics,

      v54_rules: {
        archive:
          "D1 hunter_bet_archive",

        archive_binding:
          "DB",

        archive_duplicate_protection:
          "INSERT OR IGNORE",

        archive_write_mode:
          "D1 BATCH",

        archive_key:
          "MATCH_ID OR NORMALIZED_HOME_AWAY",

        betting:
          "DISABLED",

        mode:
          "DRY_RUN",

        market:
          BET_MARKET,

        selection:
          BET_SELECTION,

        stake_eur:
          BET_STAKE_EUR,

        betting_enabled:
          false,

        real_bet_execution:
          false,

        post_bet_request:
          "NEVER",

        test_bet_registration:
          "ENABLED",

        odds:
          "READ FROM CLOUDBET /live ONLY",

        odds_missing:
          "NULL",

        odds_invented:
          false,

        matcher:
          "PRIMARY MATCH SOURCE",

        matcher_discovery_threshold:
          MATCHER_THRESHOLD,

        matcher_accept_min_score:
          MIN_MATCHER_SCORE,

        matcher_confident:
          "NOT REQUIRED",

        matcher_score:
          "DISCOVERY / ASSOCIATION ONLY",

        matcher_score_is_team_validation:
          false,

        team_validation:
          "STRICT TWO SIDED",

        team_minimum:
          TEAM_MATCH_MIN_SCORE,

        character_similarity_minimum:
          CHARACTER_SIMILARITY_MIN_SCORE,

        containment_minimum:
          CONTAINMENT_MIN_SCORE,

        token_minimum:
          TOKEN_MATCH_MIN_SCORE,

        score_only:
          "ALWAYS REJECT",

        exact_id:
          "NEVER ACCEPTED ALONE",

        exact_id_zero_score:
          "ALWAYS REJECT",

        direct_cloudbet_fallback:
          "ENABLED",

        direct_team_requirement:
          "BOTH HOME AND AWAY MUST PASS STRICT THRESHOLD",

        direction:
          "NORMAL OR REVERSED",

        cloudbet:
          "INDEPENDENT STRICT TWO SIDED VERIFICATION",

        cloudbet_fetch:
          "ONE /live CALL PER EXECUTION",

        matcher_cloudbet_execution:
          "PARALLEL"
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
        true,

      archive_batch:
        true,

      archive_writes:
        preparedBets.length,

      archive_database_calls:
        preparedBets.length
          ? 1
          : 0,

      duplicate_archive_writes_prevented:
        true,

      dry_run_bet_execution:
        false,

      real_bet_execution:
        false,

      test_bet_candidates_generated:
        dryRunCandidates.length
    },

    prepared_bets:
      preparedBets,

    bet_candidates:
      dryRunCandidates,

    no_match:
      noMatch,

    message:
      "V5.4 DRY RUN. READY Hunter matches become simulated BET_CANDIDATE records. No real bet is placed. Odds are read only from Cloudbet /live and are never invented.",

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

    dry_run: {
      enabled:
        DRY_RUN,

      betting_enabled:
        BETTING_ENABLED,

      real_bet_execution:
        false,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      stake_eur:
        BET_STAKE_EUR,

      bet_placed:
        false,

      test_bet_registration:
        true,

      odds_source:
        "CLOUDBET /live ONLY",

      odds_invented:
        false
    },

    v54: {
      archive_table:
        ARCHIVE_TABLE,

      archive_binding:
        "DB",

      archive_enabled:
        true,

      archive_idempotent:
        true,

      archive_batch:
        true,

      betting_enabled:
        false,

      dry_run:
        true,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      stake_eur:
        BET_STAKE_EUR,

      real_bet_execution:
        false
    },

    security: {
      matcher_threshold:
        MATCHER_THRESHOLD,

      matcher_accept_min_score:
        MIN_MATCHER_SCORE,

      team_minimum:
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

      score_only_rejected:
        true,

      exact_id_alone:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      cloudbet_second_verification:
        true,

      direct_cloudbet_fallback:
        true
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
        true,

      archive_batch:
        true,

      archive_duplicate_protection:
        true,

      dry_run_betting:
        true,

      real_betting:
        false
    },

    endpoints: [
      "/",
      "/health",
      "/match",
      "/live",
      "/bet",
      "/diagnostic",
      "/diagnostics",
      "/archive"
    ],

    message:
      "V5.4 DRY RUN worker is healthy. Real betting is permanently disabled.",

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
      new URL(request.url);

    const path =
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";

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
      // ARCHIVE
      // ------------------------------------------------------

      if (
        path === "/archive"
      ) {
        return archiveResponse(
          env
        );
      }

      // ------------------------------------------------------
      // MAIN V5.4 EXECUTION
      // ------------------------------------------------------

      if (
        path === "/match" ||
        path === "/live" ||
        path === "/bet" ||
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {
        return runV54(
          env,
          request
        );
      }

      // ------------------------------------------------------
      // UNKNOWN ENDPOINT
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
            "/diagnostic",
            "/diagnostics",
            "/archive"
          ]
        },
        404
      );

    } catch (error: any) {
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

          dry_run:
            true,

          real_bet_execution:
            false,

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
