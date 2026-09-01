// ============================================================
// CLOUDBET BET WORKER V5.8
// DRY RUN — OPTIMIZED TEST BETTING PIPELINE
//
// V5.8
// - V5.7 LOGIC PRESERVED
// - 1 TRACKER CALL
// - 1 MATCHER CALL
// - 1 CLOUDBET /live CALL
// - MATCHER + CLOUDBET /live PARALLEL
// - RAW CLOUDBET JSON DIAGNOSTIC
// - STRICT TWO-SIDED TEAM MATCH
// - DIRECT CLOUDBET LIVE FALLBACK
// - D1 HUNTER ARCHIVE
// - IDEMPOTENT ARCHIVE
// - BATCH ARCHIVE
// - DRY RUN ONLY
//
// V5.8 FIX:
// If Hunter match is NOT found in /live:
//   1. Request Cloudbet soccer catalogue
//   2. Inspect competitions
//   3. Search by BOTH team names
//   4. Do NOT search by score/result
//   5. Find concrete Cloudbet event
//   6. Request concrete /event?id=...
//   7. Confirm BOTH teams strictly
//   8. Confirm TRADING_LIVE
//   9. Only then continue to READY
//
// SECURITY:
// - score-only match = REJECT
// - one-team match = REJECT
// - result-only match = REJECT
// - non-live event = PRESENT_NOT_LIVE
// - both teams + live = VERIFIED
// - no invented odds
// - no real bet
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

const VERSION = "V5.8";
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

const REQUIRED_MATCH_CLASSIFICATION = "CONFIDENT_MATCH";
const ALLOWED_SIGNAL_TYPE = "HUNTER_ENTRY";

const TARGET_SPORT = "SOCCER";
const TARGET_PERIOD = "FIRST_HALF";
const TARGET_OUTCOME = "OVER";
const TARGET_LINE = 0.5;

const ARCHIVE_TABLE = "hunter_bet_archive";

// Maximum number of competitions inspected during
// catalogue fallback.
//
// This is deliberately higher than the old /live limit.
// The search is based on team names, NOT scores.
const CATALOGUE_COMPETITION_LIMIT = 500;

// Maximum number of event candidates requested in detail
// for one Hunter signal.
const MAX_EVENT_DETAIL_CANDIDATES = 5;

// ============================================================
// ALIASES
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
  "fc", "cf", "sc", "ac", "afc", "ca", "cd", "sd",
  "ss", "as", "us", "ud", "aa", "ad", "rc", "fk",
  "sk", "ks", "sv", "vfb", "vfl", "club", "calcio",
  "football", "soccer"
]);

// ============================================================
// BASIC
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=UTF-8",
        "cache-control":
          "no-store"
      }
    }
  );
}

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

  for (const alias of Object.keys(TEAM_ALIASES)) {
    const escaped = alias.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    r = r.replace(
      new RegExp(
        `(^|\\s)${escaped}(?=\\s|$)`,
        "g"
      ),
      `$1${TEAM_ALIASES[alias]}`
    );
  }

  return r
    .replace(/\s+/g, " ")
    .trim();
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

function splitMatchName(v: any) {
  const text = safeString(v);

  for (
    const sep of [
      " - ",
      " v ",
      " vs ",
      " VS ",
      " @ "
    ]
  ) {
    const i = text.indexOf(sep);

    if (i >= 0) {
      return {
        home:
          text.slice(0, i).trim(),
        away:
          text.slice(
            i + sep.length
          ).trim()
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
    if (
      typeof v === "string" &&
      v.trim()
    ) {
      return v.trim();
    }

    if (
      v &&
      typeof v === "object" &&
      typeof v.name === "string" &&
      v.name.trim()
    ) {
      return v.name.trim();
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
    if (
      typeof v === "string" &&
      v.trim()
    ) {
      return v.trim();
    }

    if (
      v &&
      typeof v === "object" &&
      typeof v.name === "string" &&
      v.name.trim()
    ) {
      return v.name.trim();
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
  return (
    safeString(
      m?.match ??
      m?.name ??
      m?.event_name
    ) ||
    `${extractHome(m)} - ${extractAway(m)}`
  );
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

  let prev =
    Array.from(
      {
        length:
          b.length + 1
      },
      (_, i) => i
    );

  let curr =
    new Array<number>(
      b.length + 1
    );

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
        a[i - 1] === b[j - 1]
          ? 0
          : 1;

      curr[j] =
        Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
    }

    [prev, curr] =
      [curr, prev];
  }

  return prev[b.length];
}

function characterSimilarity(
  a: any,
  b: any
): number {
  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);

  if (!A || !B) return 0;

  if (A === B) return 1;

  return Math.max(
    0,
    1 -
      levenshtein(A, B) /
        Math.max(
          A.length,
          B.length
        )
  );
}

// ============================================================
// TEAM MATCH
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
      method: "EMPTY",
      accepted: false
    };
  }

  if (A === B) {
    return {
      score:
        EXACT_TEAM_SCORE,
      method: "EXACT",
      accepted: true
    };
  }

  if (
    A.includes(B) ||
    B.includes(A)
  ) {
    const score =
      Math.max(
        CONTAINMENT_MIN_SCORE,
        Math.min(
          A.length,
          B.length
        ) /
          Math.max(
            A.length,
            B.length
          )
      );

    return {
      score,
      method:
        "CONTAINMENT",
      accepted:
        score >=
        CONTAINMENT_MIN_SCORE
    };
  }

  const common =
    teamTokens(A).filter(
      x =>
        teamTokens(B)
          .includes(x)
    );

  if (
    common.length >=
    TOKEN_MIN_COMMON
  ) {
    const score =
      common.length /
      Math.max(
        teamTokens(A).length,
        teamTokens(B).length
      );

    if (
      score >=
      TOKEN_MATCH_MIN_SCORE
    ) {
      return {
        score,
        method:
          "TOKEN_STRONG",
        accepted: true,
        common_tokens:
          common
      };
    }
  }

  const score =
    characterSimilarity(
      A,
      B
    );

  return {
    score,
    method:
      "CHARACTER_SIMILARITY",
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
  const nh =
    teamMatchScore(
      homeA,
      homeB
    );

  const na =
    teamMatchScore(
      awayA,
      awayB
    );

  const rh =
    teamMatchScore(
      homeA,
      awayB
    );

  const ra =
    teamMatchScore(
      awayA,
      homeB
    );

  const normalScore =
    Math.min(
      nh.score,
      na.score
    );

  const reversedScore =
    Math.min(
      rh.score,
      ra.score
    );

  const normalValid =
    nh.accepted &&
    na.accepted &&
    nh.score >=
      TEAM_MATCH_MIN_SCORE &&
    na.score >=
      TEAM_MATCH_MIN_SCORE;

  const reversedValid =
    rh.accepted &&
    ra.accepted &&
    rh.score >=
      TEAM_MATCH_MIN_SCORE &&
    ra.score >=
      TEAM_MATCH_MIN_SCORE;

  if (
    normalValid &&
    normalScore >=
      reversedScore
  ) {
    return {
      matched: true,
      direction: "NORMAL",
      home_score:
        nh.score,
      away_score:
        na.score,
      combined_score:
        normalScore,
      both_teams_pass:
        true,
      home_method:
        nh.method,
      away_method:
        na.method
    };
  }

  if (reversedValid) {
    return {
      matched: true,
      direction:
        "REVERSED",
      home_score:
        rh.score,
      away_score:
        ra.score,
      combined_score:
        reversedScore,
      both_teams_pass:
        true,
      home_method:
        rh.method,
      away_method:
        ra.method
    };
  }

  return {
    matched: false,
    direction:
      normalScore >=
      reversedScore
        ? "NORMAL"
        : "REVERSED",
    home_score:
      normalScore >=
      reversedScore
        ? nh.score
        : rh.score,
    away_score:
      normalScore >=
      reversedScore
        ? na.score
        : ra.score,
    combined_score:
      Math.max(
        normalScore,
        reversedScore
      ),
    both_teams_pass:
      false
  };
}

// ============================================================
// SERVICE
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<AnyObj> {
  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method: "GET",
          headers: {
            accept:
              "application/json"
          }
        }
      )
    );

  const text =
    await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${path}: ${text.slice(
        0,
        500
      )}`
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
  return (
    data?.signals ??
    data?.entries ??
    data?.hunter_entries ??
    data?.data ??
    []
  ).filter(
    (x: any) =>
      x &&
      typeof x === "object"
  );
}

function isHunterEntry(
  signal: AnyObj
): boolean {
  return (
    safeString(
      signal?.type ??
      signal?.signal_type ??
      signal?.signalType
    ).toUpperCase() ===
    ALLOWED_SIGNAL_TYPE
  );
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
  return safeString(
    s?.v27?.home ??
    extractHome(s)
  );
}

function signalAway(
  s: AnyObj
): string {
  return safeString(
    s?.v27?.away ??
    extractAway(s)
  );
}

// ============================================================
// MATCHER
// ============================================================

function extractMatcherMatches(
  data: AnyObj
): AnyObj[] {
  return (
    data?.matches ??
    data?.results ??
    data?.matched ??
    data?.candidates ??
    []
  );
}

function getMatcherScore(
  item: AnyObj
): number {
  const s =
    item?.scoring ??
    item?.matcher_scoring ??
    item?.score_details ??
    {};

  const score =
    Number(
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

function validateMatcherCandidate(
  signal: AnyObj,
  item: AnyObj
): AnyObj {
  const v27 =
    extractV27FromMatcher(
      item
    );

  const cloudbet =
    extractCloudbetFromMatcher(
      item
    );

  const classification =
    getClassification(
      item
    );

  const method =
    getMatchMethod(
      item
    );

  const matcherScore =
    getMatcherScore(
      item
    );

  if (
    item?.security
      ?.score_only_match ===
      true ||
    item?.score_only_match ===
      true
  ) {
    return {
      accepted: false,
      reason:
        "SCORE_ONLY_MATCH_REJECTED"
    };
  }

  const sHome =
    signalHome(signal);

  const sAway =
    signalAway(signal);

  const vHome =
    extractHome(v27);

  const vAway =
    extractAway(v27);

  if (
    !teamsPresent(
      sHome,
      sAway
    )
  ) {
    return {
      accepted: false,
      reason:
        "SIGNAL_TEAMS_EMPTY"
    };
  }

  if (
    !teamsPresent(
      vHome,
      vAway
    )
  ) {
    return {
      accepted: false,
      reason:
        "V27_TEAMS_EMPTY"
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
      accepted: false,
      reason:
        "STRICT_SIGNAL_TEAMS_MISMATCH",
      team_scores:
        teamScore
    };
  }

  if (
    method === "EXACT_ID" &&
    matcherScore <= 0
  ) {
    return {
      accepted: false,
      reason:
        "EXACT_ID_WITH_ZERO_SCORE_REJECTED"
    };
  }

  if (
    matcherScore <
    MIN_MATCHER_SCORE
  ) {
    return {
      accepted: false,
      reason:
        "MATCHER_SCORE_TOO_LOW"
    };
  }

  const confident =
    classification ===
    REQUIRED_MATCH_CLASSIFICATION;

  const strong =
    matcherScore >=
    STRONG_MATCHER_SCORE;

  if (
    !confident &&
    !strong
  ) {
    return {
      accepted: false,
      reason:
        "NOT_CONFIDENT_AND_SCORE_NOT_STRONG"
    };
  }

  return {
    accepted: true,

    reason:
      confident
        ? "CONFIDENT_MATCH_ACCEPTED"
        : "STRICT_TWO_SIDED_MATCH_ACCEPTED",

    source:
      "MATCHER",

    classification,

    method,

    matcher_score:
      matcherScore,

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

    team_scores:
      teamScore
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

  let best:
    AnyObj | null = null;

  const rejectionReasons:
    Record<string, number> = {};

  for (
    const item of matches
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
        best = result;
      }
    } else {
      const r =
        result.reason ??
        "UNKNOWN";

      rejectionReasons[r] =
        (rejectionReasons[r] ??
          0) + 1;
    }
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
  return (
    data?.matches ??
    data?.live_matches ??
    data?.events ??
    data?.data ??
    []
  );
}

function isCloudbetLive(
  m: AnyObj
): boolean {
  return (
    safeString(
      m?.status
    ).toUpperCase() ===
      "TRADING_LIVE" ||
    m?.live === true ||
    m?.isLive === true ||
    m?.inPlay === true ||
    m?.in_play === true ||
    safeString(
      m?.state
    ).toUpperCase() ===
      "LIVE" ||
    safeString(
      m?.state
    ).toUpperCase() ===
      "IN_PLAY"
  );
}

function extractOdds(
  m: AnyObj
): number | null {
  const values = [
    m?.odds,
    m?.price,
    m?.decimal_odds,
    m?.decimalOdds,
    m?.markets?.[
      "1H Total Goals"
    ]?.odds,
    m?.markets?.[
      "1H Total Goals"
    ]?.over_0_5,
    m?.markets
      ?.first_half_total_goals
      ?.over_0_5,
    m?.market?.odds
  ];

  for (
    const value of values
  ) {
    const n =
      Number(value);

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
// RAW JSON DIAGNOSTIC
// ============================================================

function findCloudbetRawJsonPresence(
  signal: AnyObj,
  raw: AnyObj[]
): AnyObj {
  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  if (
    !teamsPresent(
      sh,
      sa
    )
  ) {
    return {
      status:
        "CANNOT_CHECK",

      reason:
        "SIGNAL_TEAMS_EMPTY",

      signal_match:
        signalMatchName(
          signal
        ),

      signal_match_id:
        signalMatchId(
          signal
        ) || null
    };
  }

  let best:
    AnyObj | null = null;

  for (
    const cb of raw
  ) {
    const ch =
      extractHome(cb);

    const ca =
      extractAway(cb);

    if (
      !teamsPresent(
        ch,
        ca
      )
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sh,
        sa,
        ch,
        ca
      );

    if (
      !score.matched ||
      score.home_score <
        TEAM_MATCH_MIN_SCORE ||
      score.away_score <
        TEAM_MATCH_MIN_SCORE
    ) {
      continue;
    }

    const candidate = {
      match: cb,

      id:
        extractMatchId(cb),

      home: ch,

      away: ca,

      direction:
        score.direction,

      home_score:
        score.home_score,

      away_score:
        score.away_score,

      combined_score:
        score.combined_score,

      live:
        isCloudbetLive(cb),

      status:
        cb?.status ??
        null,

      state:
        cb?.state ??
        null
    };

    if (
      !best ||
      candidate.combined_score >
        best.combined_score
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      status:
        "MISSING_FROM_LIVE_JSON",

      found: false,

      signal_match:
        signalMatchName(
          signal
        ),

      signal_match_id:
        signalMatchId(
          signal
        ) || null,

      signal_home:
        sh,

      signal_away:
        sa,

      raw_candidates_checked:
        raw.length
    };
  }

  return {
    status:
      best.live
        ? "JSON_PRESENT"
        : "JSON_PRESENT_NOT_LIVE",

    found: true,

    signal_match:
      signalMatchName(
        signal
      ),

    signal_match_id:
      signalMatchId(
        signal
      ) || null,

    cloudbet_match:
      displayMatch(
        best.match
      ),

    cloudbet_id:
      best.id || null,

    cloudbet_home:
      best.home,

    cloudbet_away:
      best.away,

    cloudbet_status:
      best.status,

    cloudbet_state:
      best.state,

    live:
      best.live,

    direction:
      best.direction,

    home_score:
      best.home_score,

    away_score:
      best.away_score,

    combined_score:
      best.combined_score,

    raw_candidates_checked:
      raw.length
  };
}

// ============================================================
// DIRECT CLOUDBET MATCH
// ============================================================

function findDirectCloudbet(
  signal: AnyObj,
  matches: AnyObj[]
): AnyObj {
  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  let best:
    AnyObj | null = null;

  for (
    const cb of matches
  ) {
    const score =
      twoSidedTeamScore(
        sh,
        sa,
        extractHome(cb),
        extractAway(cb)
      );

    if (
      !score.matched ||
      score.home_score <
        TEAM_MATCH_MIN_SCORE ||
      score.away_score <
        TEAM_MATCH_MIN_SCORE
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

  if (!best) {
    return {
      found: false,

      reason:
        "DIRECT_CLOUDBET_STRICT_TEAMS_NOT_CONFIRMED",

      candidates_checked:
        matches.length
    };
  }

  return {
    found: true,

    source:
      "DIRECT_CLOUDBET_FALLBACK",

    ...best
  };
}

// ============================================================
// V5.8 CATALOGUE EXTRACTION
// ============================================================

function extractCatalogueCompetitions(
  data: AnyObj
): AnyObj[] {
  const direct =
    data?.competitions;

  if (
    Array.isArray(direct)
  ) {
    return direct;
  }

  const categories =
    Array.isArray(
      data?.categories
    )
      ? data.categories
      : [];

  const result:
    AnyObj[] = [];

  for (
    const category of categories
  ) {
    const competitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition
      of competitions
    ) {
      result.push(
        competition
      );
    }
  }

  return result;
}

// ============================================================
// V5.8 COMPETITION EVENT EXTRACTION
// ============================================================

function extractCompetitionEvents(
  data: AnyObj
): AnyObj[] {
  return (
    data?.events ??
    data?.matches ??
    data?.data ??
    []
  ).filter(
    (x: any) =>
      x &&
      typeof x === "object"
  );
}

// ============================================================
// V5.8 EVENT CANDIDATE SEARCH
//
// IMPORTANT:
// Searches ONLY team names.
//
// NEVER uses:
// - score
// - result
// - minute
// - odds
// ============================================================

function findCatalogueEventCandidates(
  signal: AnyObj,
  events: AnyObj[]
): AnyObj[] {
  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  if (
    !teamsPresent(
      sh,
      sa
    )
  ) {
    return [];
  }

  const candidates:
    AnyObj[] = [];

  for (
    const event of events
  ) {
    const eh =
      extractHome(event);

    const ea =
      extractAway(event);

    // --------------------------------------------------------
    // HARD SECURITY:
    // Both sides MUST EXIST.
    // --------------------------------------------------------

    if (
      !teamsPresent(
        eh,
        ea
      )
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sh,
        sa,
        eh,
        ea
      );

    // --------------------------------------------------------
    // HARD SECURITY:
    // BOTH teams must pass.
    // --------------------------------------------------------

    if (
      !score.matched ||
      !score.both_teams_pass ||
      score.home_score <
        TEAM_MATCH_MIN_SCORE ||
      score.away_score <
        TEAM_MATCH_MIN_SCORE
    ) {
      continue;
    }

    candidates.push({
      event,

      id:
        extractMatchId(
          event
        ),

      home:
        eh,

      away:
        ea,

      direction:
        score.direction,

      home_score:
        score.home_score,

      away_score:
        score.away_score,

      combined_score:
        score.combined_score
    });
  }

  candidates.sort(
    (a, b) =>
      b.combined_score -
      a.combined_score
  );

  return candidates.slice(
    0,
    MAX_EVENT_DETAIL_CANDIDATES
  );
}

// ============================================================
// V5.8 CONCRETE EVENT VERIFICATION
//
// Request:
//   CLOUDBET /event?id=<EVENT_ID>
//
// The event detail is the final authority for live status.
//
// Security:
// BOTH teams + event identity + live status required.
// ============================================================

async function verifyConcreteCloudbetEvent(
  candidate: AnyObj
): Promise<AnyObj> {
  const eventId =
    safeString(
      candidate?.id
    );

  if (!eventId) {
    return {
      found: false,

      reason:
        "CATALOGUE_EVENT_ID_EMPTY"
    };
  }

  let data:
    AnyObj;

  try {
    data =
      await fetchServiceJSON(
        currentCloudbetService,
        `/event?id=${encodeURIComponent(
          eventId
        )}`
      );
  } catch (error: any) {
    return {
      found: false,

      reason:
        "CLOUDBET_EVENT_REQUEST_FAILED",

      error:
        error?.message ??
        String(error)
    };
  }

  const event =
    data?.event ??
    data?.data ??
    data;

  if (
    !event ||
    typeof event !==
      "object"
  ) {
    return {
      found: false,

      reason:
        "CLOUDBET_EVENT_EMPTY"
    };
  }

  const eventHome =
    extractHome(event);

  const eventAway =
    extractAway(event);

  // ----------------------------------------------------------
  // HARD REJECT:
  // no two-sided teams
  // ----------------------------------------------------------

  if (
    !teamsPresent(
      eventHome,
      eventAway
    )
  ) {
    return {
      found: false,

      reason:
        "EVENT_TWO_SIDED_TEAMS_MISSING",

      event_id:
        eventId
    };
  }

  const teamScore =
    twoSidedTeamScore(
      candidate.home,
      candidate.away,
      eventHome,
      eventAway
    );

  if (
    !teamScore.matched ||
    !teamScore.both_teams_pass ||
    teamScore.home_score <
      TEAM_MATCH_MIN_SCORE ||
    teamScore.away_score <
      TEAM_MATCH_MIN_SCORE
  ) {
    return {
      found: false,

      reason:
        "EVENT_STRICT_TWO_SIDED_TEAM_MISMATCH",

      event_id:
        eventId,

      event_home:
        eventHome,

      event_away:
        eventAway,

      team_scores:
        teamScore
    };
  }

  const live =
    isCloudbetLive(
      event
    );

  if (!live) {
    return {
      found: true,

      verified: false,

      status:
        "PRESENT_NOT_LIVE",

      reason:
        "CLOUDBET_EVENT_FOUND_BUT_NOT_LIVE",

      event_id:
        extractMatchId(
          event
        ) || eventId,

      match:
        displayMatch(
          event
        ),

      home:
        eventHome,

      away:
        eventAway,

      cloudbet_status:
        event?.status ??
        null,

      cloudbet_state:
        event?.state ??
        null,

      team_scores:
        teamScore,

      event
    };
  }

  return {
    found: true,

    verified: true,

    status:
      "LIVE_VERIFIED",

    method:
      "CATALOGUE_EVENT_DETAIL_STRICT_TWO_SIDED_LIVE",

    event_id:
      extractMatchId(
        event
      ) || eventId,

    match:
      event,

    home:
      eventHome,

    away:
      eventAway,

    direction:
      teamScore.direction,

    home_score:
      teamScore.home_score,

    away_score:
      teamScore.away_score,

    combined_score:
      teamScore.combined_score,

    cloudbet_status:
      event?.status ??
      null,

    cloudbet_state:
      event?.state ??
      null
  };
}

// ============================================================
// CURRENT CLOUDBET SERVICE
//
// Used only by the V5.8 concrete event helper.
//
// Assigned immediately before catalogue/event fallback.
// ============================================================

let currentCloudbetService:
  Fetcher;

// ============================================================
// V5.8 CATALOGUE FALLBACK
//
// Flow:
//   /sports/soccer
//       ↓
//   competitions
//       ↓
//   /competitions/{key}
//       ↓
//   search BOTH team names
//       ↓
//   concrete event ID
//       ↓
//   /event?id=...
//       ↓
//   BOTH teams
//       ↓
//   TRADING_LIVE
// ============================================================

async function findCloudbetByCatalogue(
  env: Env,
  signal: AnyObj
): Promise<AnyObj> {
  currentCloudbetService =
    env.CLOUDBET;

  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  if (
    !teamsPresent(
      sh,
      sa
    )
  ) {
    return {
      found: false,

      verified: false,

      status:
        "REJECTED",

      reason:
        "CATALOGUE_SIGNAL_TWO_SIDED_TEAMS_EMPTY"
    };
  }

  // ----------------------------------------------------------
  // CATALOGUE
  // ----------------------------------------------------------

  let catalogue:
    AnyObj;

  try {
    catalogue =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/catalogue"
      );
  } catch (error: any) {
    return {
      found: false,

      verified: false,

      status:
        "CATALOGUE_ERROR",

      reason:
        "CLOUDBET_CATALOGUE_REQUEST_FAILED",

      error:
        error?.message ??
        String(error)
    };
  }

  const allCompetitions =
    extractCatalogueCompetitions(
      catalogue
    );

  const competitions =
    allCompetitions
      .filter(
        c =>
          safeString(
            c?.key
          )
      )
      .filter(
        c =>
          Number(
            c?.eventCount ??
            1
          ) > 0
      )
      .slice(
        0,
        CATALOGUE_COMPETITION_LIMIT
      );

  // ----------------------------------------------------------
  // SEARCH COMPETITIONS
  // ----------------------------------------------------------

  const competitionResults =
    await Promise.all(
      competitions.map(
        async competition => {
          try {
            const data =
              await fetchServiceJSON(
                env.CLOUDBET,
                `/competition?key=${encodeURIComponent(
                  safeString(
                    competition.key
                  )
                )}`
              );

            const events =
              extractCompetitionEvents(
                data
              );

            const candidates =
              findCatalogueEventCandidates(
                signal,
                events
              );

            return {
              competition,
              candidates,
              events_count:
                events.length,
              error:
                null
            };
          } catch (error: any) {
            return {
              competition,
              candidates: [],
              events_count: 0,
              error:
                error?.message ??
                String(error)
            };
          }
        }
      )
    );

  const allCandidates:
    AnyObj[] = [];

  const competitionErrors:
    AnyObj[] = [];

  let competitionsWithTeamCandidate =
    0;

  for (
    const result
    of competitionResults
  ) {
    if (
      result.error
    ) {
      competitionErrors.push({
        key:
          result.competition.key,

        name:
          result.competition.name ??
          null,

        error:
          result.error
      });

      continue;
    }

    if (
      result.candidates.length
    ) {
      competitionsWithTeamCandidate++;

      for (
        const candidate
        of result.candidates
      ) {
        allCandidates.push({
          ...candidate,

          competition: {
            key:
              result.competition.key,

            name:
              result.competition.name ??
              null
          }
        });
      }
    }
  }

  allCandidates.sort(
    (a, b) =>
      b.combined_score -
      a.combined_score
  );

  const uniqueCandidates:
    AnyObj[] = [];

  const seenIds =
    new Set<string>();

  for (
    const candidate
    of allCandidates
  ) {
    const id =
      safeString(
        candidate.id
      );

    if (
      id &&
      seenIds.has(id)
    ) {
      continue;
    }

    if (id) {
      seenIds.add(id);
    }

    uniqueCandidates.push(
      candidate
    );

    if (
      uniqueCandidates.length >=
      MAX_EVENT_DETAIL_CANDIDATES
    ) {
      break;
    }
  }

  // ----------------------------------------------------------
  // NO EVENT FOUND
  // ----------------------------------------------------------

  if (
    !uniqueCandidates.length
  ) {
    return {
      found: false,

      verified: false,

      status:
        "MISSING",

      reason:
        "CLOUDBET_CATALOGUE_BOTH_TEAM_EVENT_NOT_FOUND",

      search: {
        home:
          sh,

        away:
          sa,

        competitions_checked:
          competitions.length,

        competitions_total:
          allCompetitions.length,

        competitions_with_team_candidate:
          competitionsWithTeamCandidate,

        event_candidates:
          0,

        competition_errors:
          competitionErrors.length
      },

      competition_errors:
        competitionErrors
    };
  }

  // ----------------------------------------------------------
  // CONCRETE EVENT DETAIL
  // ----------------------------------------------------------

  const eventChecks:
    AnyObj[] = [];

  for (
    const candidate
    of uniqueCandidates
  ) {
    const verified =
      await verifyConcreteCloudbetEvent(
        candidate
      );

    eventChecks.push({
      candidate: {
        id:
          candidate.id,

        home:
          candidate.home,

        away:
          candidate.away,

        direction:
          candidate.direction,

        home_score:
          candidate.home_score,

        away_score:
          candidate.away_score,

        combined_score:
          candidate.combined_score,

        competition:
          candidate.competition
      },

      verification:
        verified
    });

    if (
      verified.verified
    ) {
      return {
        found: true,

        verified: true,

        status:
          "LIVE_VERIFIED",

        source:
          "CLOUDBET_CATALOGUE_EVENT_SEARCH",

        method:
          "CATALOGUE_TEAMS_THEN_EVENT_DETAIL",

        event_id:
          verified.event_id,

        match:
          verified.match,

        home:
          verified.home,

        away:
          verified.away,

        direction:
          verified.direction,

        home_score:
          verified.home_score,

        away_score:
          verified.away_score,

        combined_score:
          verified.combined_score,

        cloudbet_status:
          verified.cloudbet_status,

        cloudbet_state:
          verified.cloudbet_state,

        search: {
          home:
            sh,

          away:
            sa,

          competitions_checked:
            competitions.length,

          competitions_total:
            allCompetitions.length,

          competitions_with_team_candidate:
            competitionsWithTeamCandidate,

          event_candidates:
            uniqueCandidates.length
        },

        event_checks:
          eventChecks
      };
    }
  }

  // ----------------------------------------------------------
  // PRESENT BUT NOT LIVE
  // ----------------------------------------------------------

  const notLive =
    eventChecks.find(
      x =>
        x?.verification
          ?.status ===
        "PRESENT_NOT_LIVE"
    );

  if (notLive) {
    const v =
      notLive.verification;

    return {
      found: true,

      verified: false,

      status:
        "PRESENT_NOT_LIVE",

      reason:
        "CLOUDBET_EVENT_FOUND_BUT_NOT_LIVE",

      event_id:
        v.event_id ??
        null,

      match:
        v.match ??
        null,

      home:
        v.home ??
        null,

      away:
        v.away ??
        null,

      cloudbet_status:
        v.cloudbet_status ??
        null,

      cloudbet_state:
        v.cloudbet_state ??
        null,

      direction:
        v.team_scores
          ?.direction ??
        null,

      combined_score:
        v.team_scores
          ?.combined_score ??
        null,

      search: {
        home:
          sh,

        away:
          sa,

        competitions_checked:
          competitions.length,

        competitions_total:
          allCompetitions.length,

        competitions_with_team_candidate:
          competitionsWithTeamCandidate,

        event_candidates:
          uniqueCandidates.length
      },

      event_checks:
        eventChecks
    };
  }

  // ----------------------------------------------------------
  // FOUND CANDIDATES BUT NONE VERIFIED
  // ----------------------------------------------------------

  return {
    found: true,

    verified: false,

    status:
      "REJECTED",

    reason:
      "CLOUDBET_EVENT_CANDIDATES_FAILED_FINAL_STRICT_VALIDATION",

    search: {
      home:
        sh,

      away:
        sa,

      competitions_checked:
        competitions.length,

      competitions_total:
        allCompetitions.length,

      competitions_with_team_candidate:
        competitionsWithTeamCandidate,

      event_candidates:
        uniqueCandidates.length
    },

    event_checks:
      eventChecks
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
        signalMatchName(
          signal
        ),

      match_id:
        signalMatchId(
          signal
        ) || null,

      home:
        signalHome(
          signal
        ) || null,

      away:
        signalAway(
          signal
        ) || null,

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
        isCloudbetLive(cb),

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
        matcher.source ??
        null,

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
        matcher.reason ??
        null,

      fallback:
        matcher.source ===
          "DIRECT_CLOUDBET_FALLBACK" ||
        matcher.source ===
          "CLOUDBET_CATALOGUE_EVENT_SEARCH"
    },

    security: {
      secure_match:
        true,

      score_only_match:
        false,

      strict_two_sided_team_validation:
        true,

      team_minimum_score:
        TEAM_MATCH_MIN_SCORE,

      cloudbet_verified:
        true,

      cloudbet_verification_method:
        verification.method ??
        null,

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
      "NO_BET_V5_8_DRY_RUN"
  };
}

// ============================================================
// DRY RUN
// ============================================================

function buildDryRunCandidate(
  bet: AnyObj
): AnyObj {
  const odds =
    extractOdds(
      bet.cloudbet
    );

  return {
    status:
      "BET_CANDIDATE",

    mode:
      MODE,

    betting_enabled:
      BETTING_ENABLED,

    dry_run:
      DRY_RUN,

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
      odds !== null,

    candidate_complete:
      odds !== null,

    signal:
      bet.signal,

    matcher:
      bet.matcher,

    cloudbet: {
      ...bet.cloudbet,
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
// ARCHIVE
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

  return `teams:${normalizeTeam(
    bet?.signal?.home
  )}:${normalizeTeam(
    bet?.signal?.away
  )}`;
}

async function archiveReadyBets(
  env: Env,
  bets: AnyObj[]
) {
  if (!bets.length) {
    return {
      inserted: 0,
      duplicates: 0
    };
  }

  const now =
    new Date().toISOString();

  const statements =
    bets.map(
      bet =>
        env.DB.prepare(`
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
        `).bind(
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
        )
    );

  const results =
    await env.DB.batch(
      statements
    );

  const inserted =
    results.reduce(
      (sum, r) =>
        sum +
        Number(
          r?.meta?.changes ??
          0
        ),
      0
    );

  return {
    inserted,

    duplicates:
      Math.max(
        0,
        bets.length -
          inserted
      )
  };
}

// ============================================================
// ARCHIVE RESPONSE
// ============================================================

async function archiveResponse(
  env: Env
): Promise<Response> {
  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM hunter_bet_archive
    `).first<any>();

  const recent =
    await env.DB.prepare(`
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
    `).all();

  return json({
    success:
      true,

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

      recent:
        recent.results ??
        []
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
  matcher: AnyObj | null = null
): AnyObj {
  return {
    status:
      "NO_MATCH",

    betting:
      "DISABLED",

    signal: {
      match:
        signalMatchName(
          signal
        ),

      match_id:
        signalMatchId(
          signal
        ) || null,

      home:
        signalHome(
          signal
        ) || null,

      away:
        signalAway(
          signal
        ) || null,

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

    matcher,

    security: {
      secure_match:
        false,

      cloudbet_verified:
        false,

      strict_two_sided_team_validation:
        true,

      test_mode:
        true
    },

    action:
      "NO_BET_V5_8_DRY_RUN",

    reason
  };
}

// ============================================================
// MAIN
// ============================================================

async function runV58(
  env: Env
): Promise<Response> {
  const started =
    Date.now();

  // ----------------------------------------------------------
  // TRACKER — 1 CALL
  // ----------------------------------------------------------

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
    !hunterEntries.length
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

      tracker: {
        calls: 1,

        total_signals:
          allSignals.length,

        hunter_entries:
          0,

        ms:
          trackerMs
      },

      matcher: {
        called:
          false
      },

      cloudbet: {
        called:
          false
      },

      archive: {
        inserted:
          0,

        duplicates:
          0
      },

      bet_candidates:
        [],

      message:
        "V5.8 DRY RUN. No active Hunter entries.",

      timestamp:
        new Date().toISOString()
    });
  }

  // ----------------------------------------------------------
  // MATCHER + CLOUDBET /live — PARALLEL
  // ----------------------------------------------------------

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

  const matcherMatches =
    extractMatcherMatches(
      matcherData
    );

  // ----------------------------------------------------------
  // CLOUDBET RAW / LIVE
  // ----------------------------------------------------------

  const rawCloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const liveCloudbet =
    rawCloudbetMatches.filter(
      isCloudbetLive
    );

  // ----------------------------------------------------------
  // RAW DIAGNOSTIC
  // ----------------------------------------------------------

  const diagnosticMap =
    new Map<
      string,
      AnyObj
    >();

  const cloudbetJsonDiagnostic:
    AnyObj[] = [];

  for (
    const signal
    of hunterEntries
  ) {
    const diagnostic =
      findCloudbetRawJsonPresence(
        signal,
        rawCloudbetMatches
      );

    const key =
      signalMatchId(
        signal
      ) ||
      signalMatchName(
        signal
      );

    diagnosticMap.set(
      key,
      diagnostic
    );

    cloudbetJsonDiagnostic.push(
      diagnostic
    );
  }

  const jsonPresent =
    cloudbetJsonDiagnostic.filter(
      x =>
        x.status ===
        "JSON_PRESENT"
    );

  const jsonPresentNotLive =
    cloudbetJsonDiagnostic.filter(
      x =>
        x.status ===
        "JSON_PRESENT_NOT_LIVE"
    );

  const missing =
    cloudbetJsonDiagnostic.filter(
      x =>
        x.status ===
        "MISSING_FROM_LIVE_JSON"
    );

  // ----------------------------------------------------------
  // PROCESS
  // ----------------------------------------------------------

  const preparedBets:
    AnyObj[] = [];

  const candidates:
    AnyObj[] = [];

  const noMatch:
    AnyObj[] = [];

  const flow:
    AnyObj[] = [];

  let matcherMatchesCount =
    0;

  let directFallbackMatches =
    0;

  let catalogueFallbackMatches =
    0;

  let cataloguePresentNotLive =
    0;

  let cloudbetVerified =
    0;

  const rejectionReasons:
    Record<string, number> = {};

  const catalogueDiagnostics:
    AnyObj[] = [];

  // ----------------------------------------------------------
  // PER HUNTER SIGNAL
  // ----------------------------------------------------------

  for (
    const signal
    of hunterEntries
  ) {
    const key =
      signalMatchId(
        signal
      ) ||
      signalMatchName(
        signal
      );

    const rawDiagnostic =
      diagnosticMap.get(
        key
      ) ?? null;

    const matcher =
      findBestMatcherCandidate(
        signal,
        matcherData
      );

    matcherMatchesCount +=
      matcher.found
        ? 1
        : 0;

    let verification:
      AnyObj = {
        verified:
          false,

        reason:
          "NO_MATCHER_CANDIDATE"
      };

    let source =
      "NONE";

    // --------------------------------------------------------
    // 1. MATCHER FIRST
    // --------------------------------------------------------

    if (
      matcher.found
    ) {
      verification =
        verifyCloudbet(
          matcher,
          liveCloudbet
        );

      if (
        verification.verified
      ) {
        source =
          "MATCHER";
      }
    }

    // --------------------------------------------------------
    // 2. DIRECT LIVE CLOUDBET FALLBACK
    // --------------------------------------------------------

    if (
      !verification.verified
    ) {
      const fallback =
        findDirectCloudbet(
          signal,
          liveCloudbet
        );

      if (
        fallback.found
      ) {
        directFallbackMatches++;

        verification = {
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

        source =
          "DIRECT_CLOUDBET_FALLBACK";
      }
    }

    // --------------------------------------------------------
    // 3. V5.8 REAL CATALOGUE EVENT SEARCH
    //
    // IMPORTANT:
    // This is NOT another /live request.
    //
    // It searches:
    // catalogue -> competitions -> event -> live status
    //
    // Search key:
    // BOTH TEAM NAMES.
    //
    // NOT:
    // score
    // result
    // minute
    // odds
    // --------------------------------------------------------

    if (
      !verification.verified
    ) {
      const catalogueFallback =
        await findCloudbetByCatalogue(
          env,
          signal
        );

      catalogueDiagnostics.push({
        signal:
          signalMatchName(
            signal
          ),

        match_id:
          signalMatchId(
            signal
          ) || null,

        result:
          catalogueFallback
      });

      if (
        catalogueFallback.verified
      ) {
        catalogueFallbackMatches++;

        verification = {
          verified:
            true,

          method:
            "CLOUDBET_CATALOGUE_EVENT_SEARCH",

          direction:
            catalogueFallback.direction,

          home_score:
            catalogueFallback.home_score,

          away_score:
            catalogueFallback.away_score,

          combined_score:
            catalogueFallback.combined_score,

          match:
            catalogueFallback.match,

          event_id:
            catalogueFallback.event_id,

          cloudbet_status:
            catalogueFallback.cloudbet_status,

          cloudbet_state:
            catalogueFallback.cloudbet_state,

          search:
            catalogueFallback.search,

          event_checks:
            catalogueFallback.event_checks
        };

        source =
          "CLOUDBET_CATALOGUE_EVENT_SEARCH";
      } else if (
        catalogueFallback.status ===
        "PRESENT_NOT_LIVE"
      ) {
        cataloguePresentNotLive++;
      }
    }

    // --------------------------------------------------------
    // READY
    // --------------------------------------------------------

    if (
      verification.verified
    ) {
      cloudbetVerified++;

      let matcherForBet:
        AnyObj;

      if (
        source ===
        "MATCHER"
      ) {
        matcherForBet =
          matcher;
      } else if (
        source ===
        "DIRECT_CLOUDBET_FALLBACK"
      ) {
        matcherForBet = {
          source:
            "DIRECT_CLOUDBET_FALLBACK",

          classification:
            null,

          method:
            "DIRECT_STRICT_TEAM_MATCH",

          matcher_score:
            verification.combined_score,

          reason:
            "DIRECT_CLOUDBET_STRICTLY_CONFIRMED",

          cloudbet: {
            id:
              extractMatchId(
                verification.match
              ),

            match:
              displayMatch(
                verification.match
              ),

            home:
              extractHome(
                verification.match
              ),

            away:
              extractAway(
                verification.match
              )
          }
        };
      } else {
        matcherForBet = {
          source:
            "CLOUDBET_CATALOGUE_EVENT_SEARCH",

          classification:
            null,

          method:
            "CATALOGUE_TEAMS_THEN_EVENT_DETAIL",

          matcher_score:
            verification.combined_score,

          reason:
            "CLOUDBET_CATALOGUE_EVENT_LIVE_CONFIRMED",

          cloudbet: {
            id:
              extractMatchId(
                verification.match
              ),

            match:
              displayMatch(
                verification.match
              ),

            home:
              extractHome(
                verification.match
              ),

            away:
              extractAway(
                verification.match
              )
          }
        };
      }

      const bet =
        buildPreparedBet(
          signal,
          matcherForBet,
          verification
        );

      const candidate =
        buildDryRunCandidate(
          bet
        );

      preparedBets.push(
        bet
      );

      candidates.push(
        candidate
      );

      flow.push({
        signal:
          signalMatchName(
            signal
          ),

        match_id:
          signalMatchId(
            signal
          ) || null,

        cloudbet_json:
          rawDiagnostic,

        result:
          "READY",

        source,

        cloudbet_match:
          displayMatch(
            verification.match
          ),

        cloudbet_live:
          isCloudbetLive(
            verification.match
          ),

        team_direction:
          verification.direction,

        team_score:
          verification.combined_score,

        odds:
          candidate.odds,

        candidate_complete:
          candidate.candidate_complete,

        catalogue_event_id:
          verification.event_id ??
          null
      });

      continue;
    }

    // --------------------------------------------------------
    // NO MATCH
    // --------------------------------------------------------

    const reason =
      verification.reason ??
      "NO_ACCEPTABLE_MATCHER_OR_CLOUDBET_MATCH";

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
          found:
            matcher.found,

          matcher_reason:
            matcher.reason ??
            null,

          matcher_score:
            matcher.matcher_score ??
            null,

          classification:
            matcher.classification ??
            null,

          cloudbet_verification:
            verification,

          cloudbet_json:
            rawDiagnostic
        }
      )
    );

    flow.push({
      signal:
        signalMatchName(
          signal
        ),

      match_id:
        signalMatchId(
          signal
        ) || null,

      cloudbet_json:
        rawDiagnostic,

      result:
        "NO_MATCH",

      reason,

      catalogue_search:
        "EXECUTED_IF_LIVE_NOT_FOUND"
    });
  }

  // ----------------------------------------------------------
  // ARCHIVE — 1 BATCH
  // ----------------------------------------------------------

  const archiveStarted =
    Date.now();

  const archive =
    await archiveReadyBets(
      env,
      preparedBets
    );

  const archiveMs =
    Date.now() -
    archiveStarted;

  // ----------------------------------------------------------
  // STATS
  // ----------------------------------------------------------

  const complete =
    candidates.filter(
      x =>
        x.candidate_complete ===
        true
    ).length;

  const incomplete =
    candidates.length -
    complete;

  const totalMs =
    Date.now() -
    started;

  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

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

    calls: {
      tracker:
        1,

      matcher:
        1,

      cloudbet_live:
        1,

      matcher_cloudbet_parallel:
        true,

      additional_cloudbet_live_request:
        false,

      catalogue_fallback:
        true,

      competition_search:
        true,

      concrete_event_search:
        true
    },

    tracker: {
      total_signals:
        allSignals.length,

      hunter_entries:
        hunterEntries.length,

      ms:
        trackerMs
    },

    matcher: {
      success:
        matcherData?.success ===
        true,

      candidates:
        matcherMatches.length,

      accepted:
        matcherMatchesCount,

      ms:
        matcherResult.ms
    },

    cloudbet: {
      raw_matches:
        rawCloudbetMatches.length,

      live_matches:
        liveCloudbet.length,

      verified_matches:
        cloudbetVerified,

      direct_live_fallback:
        directFallbackMatches,

      catalogue_event_fallback:
        catalogueFallbackMatches,

      catalogue_present_not_live:
        cataloguePresentNotLive,

      ms:
        cloudbetResult.ms
    },

    // --------------------------------------------------------
    // RAW LIVE DIAGNOSTIC
    // --------------------------------------------------------

    cloudbet_json_diagnostic: {
      source:
        "CLOUDBET /live RAW JSON",

      checked_before_live_filter:
        true,

      hunter_matches_checked:
        hunterEntries.length,

      json_present:
        jsonPresent.length,

      json_present_not_live:
        jsonPresentNotLive.length,

      missing_from_live_json:
        missing.length,

      missing,

      present:
        jsonPresent,

      present_not_live:
        jsonPresentNotLive,

      all:
        cloudbetJsonDiagnostic
    },

    // --------------------------------------------------------
    // V5.8 CATALOGUE DIAGNOSTIC
    // --------------------------------------------------------

    cloudbet_catalogue_diagnostic: {
      enabled:
        true,

      search_method:
        "TEAM_NAMES_ONLY",

      score_search:
        false,

      result_search:
        false,

      minute_search:
        false,

      odds_search:
        false,

      strict_two_sided:
        true,

      team_minimum:
        TEAM_MATCH_MIN_SCORE,

      event_detail_verification:
        true,

      live_status_required:
        true,

      present_not_live_count:
        cataloguePresentNotLive,

      fallback_matches:
        catalogueFallbackMatches,

      details:
        catalogueDiagnostics
    },

    // --------------------------------------------------------
    // DRY RUN
    // --------------------------------------------------------

    dry_run: {
      enabled:
        DRY_RUN,

      betting_enabled:
        BETTING_ENABLED,

      real_bet_execution:
        false,

      candidates:
        candidates.length,

      complete_candidates:
        complete,

      incomplete_candidates:
        incomplete,

      bets_placed:
        0,

      bets_not_placed:
        candidates.length,

      simulated_bets:
        candidates.length,

      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      odds_source:
        "CLOUDBET ONLY",

      odds_invented:
        false
    },

    // --------------------------------------------------------
    // ARCHIVE
    // --------------------------------------------------------

    archive: {
      table:
        ARCHIVE_TABLE,

      ready:
        preparedBets.length,

      inserted:
        archive.inserted,

      duplicates:
        archive.duplicates,

      batch:
        true,

      idempotent:
        true,

      ms:
        archiveMs
    },

    // --------------------------------------------------------
    // STATS
    // --------------------------------------------------------

    stats: {
      signals_received:
        allSignals.length,

      hunter_entries:
        hunterEntries.length,

      matcher_accepted:
        matcherMatchesCount,

      direct_fallback:
        directFallbackMatches,

      catalogue_fallback:
        catalogueFallbackMatches,

      catalogue_present_not_live:
        cataloguePresentNotLive,

      cloudbet_verified:
        cloudbetVerified,

      bets_ready:
        preparedBets.length,

      bet_candidates:
        candidates.length,

      complete_candidates:
        complete,

      incomplete_candidates:
        incomplete,

      no_match:
        noMatch.length,

      archive_inserted:
        archive.inserted,

      archive_duplicates:
        archive.duplicates,

      cloudbet_json_present:
        jsonPresent.length,

      cloudbet_json_present_not_live:
        jsonPresentNotLive.length,

      cloudbet_json_missing:
        missing.length
    },

    // --------------------------------------------------------
    // DIAGNOSTICS
    // --------------------------------------------------------

    diagnostics: {
      rejection_reasons:
        rejectionReasons,

      signal_flow:
        flow,

      rules: {
        team_validation:
          "STRICT_TWO_SIDED",

        team_minimum:
          TEAM_MATCH_MIN_SCORE,

        matcher_threshold:
          MATCHER_THRESHOLD,

        matcher_min_score:
          MIN_MATCHER_SCORE,

        score_only:
          "REJECTED",

        exact_id_alone:
          "REJECTED",

        reversed_direction:
          true,

        direct_cloudbet_fallback:
          true,

        catalogue_search:
          true,

        competition_search:
          true,

        event_detail_search:
          true,

        team_names_only:
          true,

        score_based_search:
          false,

        result_based_search:
          false,

        one_team_match:
          "REJECTED",

        missing_team_match:
          "REJECTED",

        non_live_event:
          "PRESENT_NOT_LIVE",

        both_teams_plus_live:
          "VERIFIED",

        second_cloudbet_live_request:
          false
      }
    },

    timing: {
      tracker_ms:
        trackerMs,

      matcher_ms:
        matcherResult.ms,

      cloudbet_ms:
        cloudbetResult.ms,

      parallel_external_ms:
        parallelExternalMs,

      archive_ms:
        archiveMs,

      total_ms:
        totalMs
    },

    prepared_bets:
      preparedBets,

    bet_candidates:
      candidates,

    no_match:
      noMatch,

    message:
      catalogueFallbackMatches > 0
        ? `V5.8 DRY RUN. ${catalogueFallbackMatches} Hunter match(es) confirmed through Cloudbet catalogue -> competition -> concrete event -> LIVE verification.`
        : cataloguePresentNotLive > 0
          ? `V5.8 DRY RUN. ${cataloguePresentNotLive} Hunter match(es) found in Cloudbet catalogue but event was not LIVE.`
          : missing.length > 0
            ? `V5.8 DRY RUN. ${missing.length} Hunter match(es) were not found in the initial Cloudbet /live response. Catalogue fallback executed.`
            : "V5.8 DRY RUN. Initial Cloudbet /live verification completed.",

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
        BET_STAKE_EUR
    },

    archive: {
      table:
        ARCHIVE_TABLE,

      enabled:
        true,

      idempotent:
        true,

      batch:
        true
    },

    diagnostic: {
      raw_cloudbet_json:
        true,

      before_live_filter:
        true,

      missing_detection:
        true,

      catalogue_fallback:
        true,

      competition_search:
        true,

      concrete_event_search:
        true,

      team_names_only:
        true,

      score_based_search:
        false,

      result_based_search:
        false,

      event_live_verification:
        true,

      second_cloudbet_live_request:
        false
    },

    security: {
      matcher_threshold:
        MATCHER_THRESHOLD,

      matcher_min_score:
        MIN_MATCHER_SCORE,

      team_minimum:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_minimum:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_minimum:
        CONTAINMENT_MIN_SCORE,

      token_minimum:
        TOKEN_MATCH_MIN_SCORE,

      two_sided_team_validation:
        true,

      reversed_direction_allowed:
        true,

      score_only_rejected:
        true,

      exact_id_alone:
        false,

      direct_cloudbet_fallback:
        true,

      catalogue_event_fallback:
        true,

      one_team_rejected:
        true,

      result_only_rejected:
        true,

      non_live_event_rejected:
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

      raw_diagnostic_reused:
        true,

      cloudbet_live_data_reused:
        true,

      catalogue_fallback:
        true,

      competition_search:
        true,

      concrete_event_search:
        true,

      additional_raw_live_request:
        false,

      archive_batch:
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
      "V5.8 DRY RUN worker healthy. Cloudbet catalogue -> competition -> concrete event fallback enabled. Real betting disabled.",

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
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";

    try {
      if (
        path === "/" ||
        path === "/health"
      ) {
        return health();
      }

      if (
        path === "/archive"
      ) {
        return archiveResponse(
          env
        );
      }

      if (
        path === "/match" ||
        path === "/live" ||
        path === "/bet" ||
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {
        return runV58(
          env
        );
      }

      return json(
        {
          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

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
