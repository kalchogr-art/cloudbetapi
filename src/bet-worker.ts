// ============================================================
// CLOUDBET — BET WORKER V5.8
// DRY RUN — OPTIMIZED TEST BETTING PIPELINE
//
// V5.8 PERSISTENT ODDS RETRY
//
// PRESERVED:
// - Hunter / Tracker logic
// - Matcher logic
// - strict two-sided team matching
// - Matcher + Cloudbet parallel
// - direct Cloudbet fallback
// - raw Cloudbet fallback
// - D1 archive
// - idempotent archive
// - DRY RUN
//
// NEW:
// - Real Cloudbet odds extraction
// - Persistent PENDING_ODDS state
// - D1 pending odds queue
// - Cloudflare Cron retry every minute
// - Retry by already confirmed cloudbet_id
// - No Hunter rerun
// - No Matcher rerun
// - No Cloudbet search rerun
// - Automatic invalidation when bet is no longer valid
//
// IMPORTANT:
// /run NEVER waits for odds retry.
// If odds are temporarily unavailable, the candidate is saved
// to D1 as PENDING_ODDS.
//
// Cron automatically checks pending candidates again.
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
const PENDING_TABLE = "pending_odds";

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
// BASIC
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
          "no-store"
      }
    }
  );
}

function safeString(
  v: any
): string {
  return String(
    v ?? ""
  ).trim();
}

function normalizeText(
  v: any
): string {
  return safeString(v)
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

function applyAliases(
  v: string
): string {
  let r =
    normalizeText(v);

  for (
    const alias of Object.keys(
      TEAM_ALIASES
    )
  ) {
    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    r =
      r.replace(
        new RegExp(
          `(^|\\s)${escaped}(?=\\s|$)`,
          "g"
        ),
        `$1${TEAM_ALIASES[alias]}`
      );
  }

  return r
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeTeam(
  v: any
): string {
  return applyAliases(
    safeString(v)
  )
    .split(" ")
    .filter(Boolean)
    .filter(
      x =>
        !GENERIC_WORDS.has(x)
    )
    .filter(
      x =>
        !/^\d+$/.test(x)
    )
    .join(" ")
    .trim();
}

function teamTokens(
  v: any
): string[] {
  return normalizeTeam(v)
    .split(" ")
    .filter(
      x =>
        x.length >= 3
    );
}

function splitMatchName(
  v: any
) {
  const text =
    safeString(v);

  for (
    const sep of [
      " - ",
      " v ",
      " vs ",
      " VS ",
      " @ "
    ]
  ) {
    const i =
      text.indexOf(sep);

    if (
      i >= 0
    ) {
      return {
        home:
          text
            .slice(
              0,
              i
            )
            .trim(),

        away:
          text
            .slice(
              i +
                sep.length
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
// MATCH EXTRACTION
// ============================================================

function extractHome(
  m: AnyObj
): string {
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

  for (
    const v of values
  ) {
    if (
      typeof v ===
        "string" &&
      v.trim()
    ) {
      return v.trim();
    }
  }

  return (
    splitMatchName(
      m?.match ??
      m?.name ??
      m?.event_name ??
      ""
    ).home ?? ""
  );
}

function extractAway(
  m: AnyObj
): string {
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

  for (
    const v of values
  ) {
    if (
      typeof v ===
        "string" &&
      v.trim()
    ) {
      return v.trim();
    }
  }

  return (
    splitMatchName(
      m?.match ??
      m?.name ??
      m?.event_name ??
      ""
    ).away ?? ""
  );
}

function displayMatch(
  m: AnyObj
): string {
  return (
    safeString(
      m?.match ??
      m?.name ??
      m?.event_name
    ) ||
    `${extractHome(m)} - ${extractAway(m)}`
  );
}

function extractMatchId(
  m: AnyObj
): string {
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
  if (
    a === b
  ) {
    return 0;
  }

  if (
    !a.length
  ) {
    return b.length;
  }

  if (
    !b.length
  ) {
    return a.length;
  }

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
    curr[0] =
      i;

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
          prev[j - 1] +
            cost
        );
    }

    [
      prev,
      curr
    ] = [
      curr,
      prev
    ];
  }

  return prev[
    b.length
  ];
}

function characterSimilarity(
  a: any,
  b: any
): number {
  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  if (
    A === B
  ) {
    return 1;
  }

  return Math.max(
    0,
    1 -
      levenshtein(
        A,
        B
      ) /
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

  if (
    !A ||
    !B
  ) {
    return {
      score: 0,
      method: "EMPTY",
      accepted: false
    };
  }

  if (
    A === B
  ) {
    return {
      score:
        EXACT_TEAM_SCORE,
      method:
        "EXACT",
      accepted:
        true
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
        accepted:
          true,
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
      direction:
        "NORMAL",
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

  if (
    reversedValid
  ) {
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

  if (
    !response.ok
  ) {
    throw new Error(
      `HTTP ${response.status} ${path}: ${text.slice(
        0,
        500
      )}`
    );
  }

  if (
    !text.trim()
  ) {
    return {};
  }

  try {
    return JSON.parse(
      text
    );
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
      typeof x ===
        "object"
  );
}

function isHunterEntry(
  signal: AnyObj
): boolean {
  return safeString(
    signal?.type ??
    signal?.signal_type ??
    signal?.signalType
  )
    .toUpperCase() ===
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

  return Number.isFinite(
    score
  )
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
    method ===
      "EXACT_ID" &&
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
        best =
          result;
      }
    } else {
      const r =
        result.reason ??
        "UNKNOWN";

      rejectionReasons[r] =
        (rejectionReasons[r] ?? 0) +
        1;
    }
  }

  if (
    !best
  ) {
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
  const candidates = [
    data?.data?.matches,
    data?.matches,
    data?.live_matches,
    data?.events,
    data?.data
  ];

  for (
    const value of candidates
  ) {
    if (
      Array.isArray(value)
    ) {
      return value.filter(
        x =>
          x &&
          typeof x ===
            "object"
      );
    }
  }

  return [];
}

// ============================================================
// CLOUDBET LIVE STATUS
// ============================================================

function isCloudbetLive(
  m: AnyObj
): boolean {
  const status =
    safeString(
      m?.status ??
      m?.event_status ??
      m?.trading_status
    ).toUpperCase();

  const state =
    safeString(
      m?.state
    ).toUpperCase();

  return (
    status ===
      "TRADING_LIVE" ||
    state ===
      "LIVE" ||
    m?.live === true
  );
}

// ============================================================
// RAW CLOUDBET SEARCH
// ============================================================

function findCloudbetRawJsonPresence(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  const signalHomeName =
    signalHome(signal);

  const signalAwayName =
    signalAway(signal);

  const signalId =
    signalMatchId(signal);

  const matches =
    extractCloudbetMatches(
      rawData
    );

  let best:
    AnyObj | null = null;

  for (
    const cb of matches
  ) {
    const cbHome =
      extractHome(cb);

    const cbAway =
      extractAway(cb);

    if (
      !teamsPresent(
        signalHomeName,
        signalAwayName
      ) ||
      !teamsPresent(
        cbHome,
        cbAway
      )
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        signalHomeName,
        signalAwayName,
        cbHome,
        cbAway
      );

    if (
      !score.matched
    ) {
      continue;
    }

    const cbId =
      extractMatchId(cb);

    const idMatch =
      !!signalId &&
      !!cbId &&
      signalId ===
        cbId;

    const candidate = {
      ...cb,

      _presence: {
        id_match:
          idMatch,

        direction:
          score.direction,

        home_score:
          score.home_score,

        away_score:
          score.away_score,

        combined_score:
          score.combined_score,

        live:
          isCloudbetLive(cb)
      }
    };

    if (
      idMatch
    ) {
      return {
        found: true,
        source:
          "RAW_JSON",
        status:
          isCloudbetLive(cb)
            ? "JSON_PRESENT"
            : "JSON_PRESENT_NOT_LIVE",
        cloudbet:
          candidate
      };
    }

    if (
      !best ||
      score.combined_score >
        best?._presence
          ?.combined_score
    ) {
      best =
        candidate;
    }
  }

  if (
    best
  ) {
    return {
      found: true,
      source:
        "RAW_JSON",
      status:
        isCloudbetLive(best)
          ? "JSON_PRESENT"
          : "JSON_PRESENT_NOT_LIVE",
      cloudbet:
        best
    };
  }

  return {
    found: false,
    source:
      "RAW_JSON",
    status:
      "MISSING_FROM_LIVE_JSON",
    cloudbet:
      null
  };
}

// ============================================================
// DIRECT LIVE CLOUDBET MATCH
// ============================================================

function findDirectCloudbet(
  signal: AnyObj,
  liveMatches: AnyObj[]
): AnyObj {
  const signalId =
    signalMatchId(signal);

  const sHome =
    signalHome(signal);

  const sAway =
    signalAway(signal);

  if (
    signalId
  ) {
    const byId =
      liveMatches.find(
        cb =>
          extractMatchId(cb) ===
          signalId
      );

    if (
      byId
    ) {
      return {
        found: true,
        source:
          "CLOUDBET_ID",
        cloudbet:
          byId
      };
    }
  }

  let best:
    AnyObj | null = null;

  for (
    const cb of liveMatches
  ) {
    const cbHome =
      extractHome(cb);

    const cbAway =
      extractAway(cb);

    const score =
      twoSidedTeamScore(
        sHome,
        sAway,
        cbHome,
        cbAway
      );

    if (
      !score.matched
    ) {
      continue;
    }

    if (
      !isCloudbetLive(cb)
    ) {
      continue;
    }

    const candidate = {
      ...cb,

      _match_score:
        score
    };

    if (
      !best ||
      score.combined_score >
        best?._match_score
          ?.combined_score
    ) {
      best =
        candidate;
    }
  }

  if (
    !best
  ) {
    return {
      found: false,
      source:
        "CLOUDBET_DIRECT",
      cloudbet:
        null
    };
  }

  return {
    found: true,
    source:
      "CLOUDBET_TEAMS",
    cloudbet:
      best
  };
}

// ============================================================
// FIND RAW MATCH WITHOUT NEW REQUEST
// ============================================================

function findRawCloudbetMatch(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  return findCloudbetRawJsonPresence(
    signal,
    rawData
  );
}

// ============================================================
// ODDS NORMALIZATION
// ============================================================

function normalizeOddsContext(
  value: any
): string {
  return normalizeText(
    value
  )
    .replace(
      /_/g,
      " "
    )
    .replace(
      /-/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function hasFirstHalfContext(
  value: string
): boolean {
  const s =
    normalizeOddsContext(
      value
    );

  return (
    /\b1h\b/.test(s) ||
    /\b1st half\b/.test(s) ||
    /\bfirst half\b/.test(s) ||
    /\bhalf 1\b/.test(s) ||
    /\bperiod 1\b/.test(s) ||
    /half=1\b/.test(s) ||
    /period=1\b/.test(s)
  );
}

function hasTotalGoalsContext(
  value: string
): boolean {
  const s =
    normalizeOddsContext(
      value
    );

  return (
    s.includes(
      "total goals"
    ) ||
    s.includes(
      "total goal"
    ) ||
    s.includes(
      "soccer total goals"
    ) ||
    s.includes(
      "soccer total goals"
    ) ||
    s.includes(
      "goals total"
    ) ||
    s.includes(
      "totals"
    )
  );
}

function hasOverContext(
  value: string
): boolean {
  const s =
    normalizeOddsContext(
      value
    );

  return (
    /\bover\b/.test(s) ||
    /\bo\b/.test(s) ||
    /outcome=over\b/.test(s)
  );
}

function hasHalfGoalLine(
  value: string
): boolean {
  const s =
    normalizeOddsContext(
      value
    );

  return (
    /\b0\.5\b/.test(s) ||
    /\b05\b/.test(s) ||
    /total=0\.5\b/.test(s) ||
    /line=0\.5\b/.test(s) ||
    /handicap=0\.5\b/.test(s)
  );
}

// ============================================================
// SELECTION ENABLED
// ============================================================

function isSelectionEnabled(
  selection: AnyObj
): boolean {
  const status =
    safeString(
      selection?.status
    ).toUpperCase();

  if (
    !status
  ) {
    return true;
  }

  return (
    status ===
      "SELECTION_ENABLED" ||
    status ===
      "ENABLED" ||
    status ===
      "TRADING" ||
    status ===
      "OPEN" ||
    status ===
      "ACTIVE"
  );
}

// ============================================================
// SELECTION PRICE
// ============================================================

function extractSelectionPrice(
  selection: AnyObj
): number | null {
  const price =
    Number(
      selection?.price
    );

  if (
    Number.isFinite(price) &&
    price > 1
  ) {
    return price;
  }

  return null;
}

// ============================================================
// FIRST HALF OVER 0.5
// ============================================================

function extractFirstHalfOver05Odds(
  m: AnyObj
): number | null {
  const markets =
    Array.isArray(
      m?.markets
    )
      ? m.markets
      : [];

  for (
    const market of markets
  ) {
    if (
      !market ||
      typeof market !==
        "object"
    ) {
      continue;
    }

    const marketKey =
      safeString(
        market?.marketKey ??
        market?.key ??
        market?.name ??
        market?.market
      );

    const marketContext =
      [
        marketKey,
        market?.marketUrl,
        market?.url,
        market?.name
      ]
        .map(
          normalizeOddsContext
        )
        .join(" ");

    if (
      !hasTotalGoalsContext(
        marketContext
      )
    ) {
      continue;
    }

    const submarkets =
      Array.isArray(
        market?.submarkets
      )
        ? market.submarkets
        : [];

    for (
      const submarket of
        submarkets
    ) {
      if (
        !submarket ||
        typeof submarket !==
          "object"
      ) {
        continue;
      }

      const submarketContext =
        [
          marketContext,

          safeString(
            submarket?.submarketKey
          ),

          safeString(
            submarket?.key
          ),

          safeString(
            submarket?.name
          ),

          safeString(
            submarket?.marketUrl
          ),

          safeString(
            submarket?.url
          )
        ]
          .map(
            normalizeOddsContext
          )
          .join(" ");

      if (
        !hasFirstHalfContext(
          submarketContext
        )
      ) {
        continue;
      }

      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];

      for (
        const selection of
          selections
      ) {
        if (
          !selection ||
          typeof selection !==
            "object"
        ) {
          continue;
        }

        const selectionContext =
          [
            submarketContext,

            safeString(
              selection?.marketUrl
            ),

            safeString(
              selection?.name
            ),

            safeString(
              selection?.outcome
            ),

            safeString(
              selection?.side
            ),

            safeString(
              selection?.selection
            ),

            safeString(
              selection?.id
            )
          ]
            .map(
              normalizeOddsContext
            )
            .join(" ");

        if (
          !hasFirstHalfContext(
            selectionContext
          )
        ) {
          continue;
        }

        if (
          !hasOverContext(
            selectionContext
          )
        ) {
          continue;
        }

        if (
          !hasHalfGoalLine(
            selectionContext
          )
        ) {
          continue;
        }

        if (
          !isSelectionEnabled(
            selection
          )
        ) {
          continue;
        }

        const price =
          extractSelectionPrice(
            selection
          );

        if (
          price !== null
        ) {
          return price;
        }
      }
    }
  }

  return extractOddsRecursive(
    m
  );
}

// ============================================================
// RECURSIVE ODDS FALLBACK
// ============================================================

function extractOddsRecursive(
  root: any
): number | null {
  const visited =
    new Set<any>();

  function walk(
    node: any,
    context: string
  ): number | null {
    if (
      node === null ||
      node === undefined
    ) {
      return null;
    }

    if (
      typeof node !==
        "object"
    ) {
      return null;
    }

    if (
      visited.has(node)
    ) {
      return null;
    }

    visited.add(node);

    const ownContext =
      [
        context,

        safeString(
          node?.marketKey
        ),

        safeString(
          node?.submarketKey
        ),

        safeString(
          node?.marketUrl
        ),

        safeString(
          node?.url
        ),

        safeString(
          node?.name
        ),

        safeString(
          node?.outcome
        ),

        safeString(
          node?.selection
        ),

        safeString(
          node?.side
        )
      ]
        .map(
          normalizeOddsContext
        )
        .join(" ");

    if (
      node?.price !==
        undefined &&
      hasTotalGoalsContext(
        ownContext
      ) &&
      hasFirstHalfContext(
        ownContext
      ) &&
      hasOverContext(
        ownContext
      ) &&
      hasHalfGoalLine(
        ownContext
      ) &&
      isSelectionEnabled(
        node
      )
    ) {
      const price =
        extractSelectionPrice(
          node
        );

      if (
        price !== null
      ) {
        return price;
      }
    }

    if (
      Array.isArray(node)
    ) {
      for (
        const child of node
      ) {
        const found =
          walk(
            child,
            ownContext
          );

        if (
          found !== null
        ) {
          return found;
        }
      }

      return null;
    }

    for (
      const key of Object.keys(
        node
      )
    ) {
      const child =
        node[key];

      if (
        !child ||
        typeof child !==
          "object"
      ) {
        continue;
      }

      const found =
        walk(
          child,
          `${ownContext} ${normalizeOddsContext(key)}`
        );

      if (
        found !== null
      ) {
        return found;
      }
    }

    return null;
  }

  return walk(
    root,
    ""
  );
}

// ============================================================
// PUBLIC ODDS EXTRACTOR
// ============================================================

function extractOdds(
  m: AnyObj
): number | null {
  if (
    !m ||
    typeof m !==
      "object"
  ) {
    return null;
  }

  return extractFirstHalfOver05Odds(
    m
  );
}

// ============================================================
// ODDS HELPERS
// ============================================================

function getCloudbetId(
  bet: AnyObj
): string {
  return safeString(
    bet?.cloudbet?.id ??
    bet?.cloudbet_id ??
    bet?.cloudbet?.match_id
  );
}

function updateBetOdds(
  bet: AnyObj
): boolean {
  const cloudbet =
    bet?.cloudbet;

  if (
    !cloudbet ||
    typeof cloudbet !==
      "object"
  ) {
    return false;
  }

  const odds =
    extractOdds(
      cloudbet
    );

  if (
    odds === null
  ) {
    return false;
  }

  cloudbet.odds =
    odds;

  cloudbet.odds_available =
    true;

  cloudbet.odds_source =
    "CLOUDBET_LIVE_MARKETS";

  bet.odds =
    odds;

  bet.odds_available =
    true;

  bet.candidate_complete =
    true;

  return true;
}

function buildCloudbetIdMap(
  matches: AnyObj[]
): Map<string, AnyObj> {
  const map =
    new Map<
      string,
      AnyObj
    >();

  for (
    const match of matches
  ) {
    const id =
      extractMatchId(
        match
      );

    if (
      id
    ) {
      map.set(
        id,
        match
      );
    }
  }

  return map;
}

// ============================================================
// MATCH STATE / INVALIDATION
// ============================================================

function extractNumber(
  v: any
): number | null {
  if (
    v === null ||
    v === undefined ||
    v === ""
  ) {
    return null;
  }

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function extractScorePair(
  m: AnyObj
): {
  home: number | null;
  away: number | null;
} {
  const directPairs = [
    [
      m?.home_score,
      m?.away_score
    ],
    [
      m?.homeScore,
      m?.awayScore
    ],
    [
      m?.score?.home,
      m?.score?.away
    ],
    [
      m?.score?.home_score,
      m?.score?.away_score
    ],
    [
      m?.scores?.home,
      m?.scores?.away
    ],
    [
      m?.scores?.home_score,
      m?.scores?.away_score
    ],
    [
      m?.result?.home,
      m?.result?.away
    ],
    [
      m?.result?.home_score,
      m?.result?.away_score
    ],
    [
      m?.home?.score,
      m?.away?.score
    ],
    [
      m?.homeTeam?.score,
      m?.awayTeam?.score
    ]
  ];

  for (
    const pair of directPairs
  ) {
    const h =
      extractNumber(
        pair[0]
      );

    const a =
      extractNumber(
        pair[1]
      );

    if (
      h !== null &&
      a !== null
    ) {
      return {
        home: h,
        away: a
      };
    }
  }

  const scoreText =
    safeString(
      m?.score ??
      m?.result ??
      m?.current_score
    );

  const match =
    scoreText.match(
      /(\d+)\s*[-:]\s*(\d+)/
    );

  if (
    match
  ) {
    return {
      home:
        Number(
          match[1]
        ),
      away:
        Number(
          match[2]
        )
    };
  }

  return {
    home: null,
    away: null
  };
}

function hasGoal(
  m: AnyObj
): boolean {
  const score =
    extractScorePair(
      m
    );

  if (
    score.home !==
      null &&
    score.away !==
      null
  ) {
    return (
      score.home > 0 ||
      score.away > 0
    );
  }

  const text =
    normalizeText(
      [
        m?.score,
        m?.result,
        m?.status_text,
        m?.event_status
      ]
        .map(
          safeString
        )
        .join(" ")
    );

  return (
    /\b[1-9]\s*[-:]\s*[0-9]\b/.test(
      text
    ) ||
    /\b[0-9]\s*[-:]\s*[1-9]\b/.test(
      text
    )
  );
}

function extractMinute(
  m: AnyObj
): number | null {
  const values = [
    m?.minute,
    m?.match_minute,
    m?.matchMinute,
    m?.clock?.minute,
    m?.time?.minute,
    m?.game_time,
    m?.elapsed
  ];

  for (
    const value of values
  ) {
    const n =
      extractNumber(
        value
      );

    if (
      n !== null
    ) {
      return n;
    }

    const text =
      safeString(
        value
      );

    const match =
      text.match(
        /(\d{1,3})/
      );

    if (
      match
    ) {
      return Number(
        match[1]
      );
    }
  }

  return null;
}

function isFirstHalf(
  m: AnyObj
): boolean {
  const period =
    normalizeText(
      m?.period ??
      m?.match_period ??
      m?.phase ??
      m?.state ??
      m?.status ??
      ""
    );

  if (
    hasGoal(m)
  ) {
    return false;
  }

  if (
    /\bfirst half\b/.test(
      period
    ) ||
    /\b1st half\b/.test(
      period
    ) ||
    /\b1h\b/.test(
      period
    )
  ) {
    return true;
  }

  const minute =
    extractMinute(m);

  if (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
  ) {
    return true;
  }

  return false;
}

function pendingIsStillValid(
  cb: AnyObj
): {
  valid: boolean;
  reason: string;
} {
  if (
    !cb
  ) {
    return {
      valid: false,
      reason:
        "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  if (
    !isCloudbetLive(cb)
  ) {
    return {
      valid: false,
      reason:
        "CLOUDBET_NO_LONGER_LIVE"
    };
  }

  if (
    hasGoal(cb)
  ) {
    return {
      valid: false,
      reason:
        "GOAL_ALREADY_SCORED"
    };
  }

  if (
    !isFirstHalf(cb)
  ) {
    return {
      valid: false,
      reason:
        "FIRST_HALF_ENDED"
    };
  }

  return {
    valid: true,
    reason:
      "BET_STILL_VALID"
  };
}

// ============================================================
// ARCHIVE KEY
// ============================================================

function archiveKey(
  bet: AnyObj
): string {
  const signalId =
    safeString(
      bet?.signal_match_id
    );

  if (
    signalId
  ) {
    return `signal:${signalId}`;
  }

  const home =
    normalizeTeam(
      bet?.v27?.home ??
      bet?.cloudbet?.home
    );

  const away =
    normalizeTeam(
      bet?.v27?.away ??
      bet?.cloudbet?.away
    );

  return `teams:${home}:${away}`;
}

// ============================================================
// ARCHIVE
// ============================================================

async function archivePreparedBets(
  env: Env,
  bets: AnyObj[]
): Promise<AnyObj> {
  if (
    !env.DB
  ) {
    return {
      success: false,
      inserted: 0,
      skipped:
        bets.length,
      error:
        "DB_BINDING_MISSING"
    };
  }

  if (
    bets.length === 0
  ) {
    return {
      success: true,
      inserted: 0,
      skipped: 0
    };
  }

  const statements:
    D1PreparedStatement[] =
    [];

  for (
    const bet of bets
  ) {
    const key =
      archiveKey(
        bet
      );

    const cloudbetId =
      getCloudbetId(
        bet
      );

    const odds =
      extractOdds(
        bet?.cloudbet
      );

    const match =
      safeString(
        bet?.match
      );

    const home =
      safeString(
        bet?.v27?.home ??
        bet?.cloudbet?.home
      );

    const away =
      safeString(
        bet?.v27?.away ??
        bet?.cloudbet?.away
      );

    const signalType =
      safeString(
        bet?.signal_type
      );

    const classification =
      safeString(
        bet?.matcher
          ?.classification
      );

    const matcherScore =
      Number(
        bet?.matcher
          ?.matcher_score ??
        0
      );

    const entryMinute =
      Number(
        bet?.entry_minute ??
        bet?.minute ??
        bet?.signal?.minute ??
        null
      );

    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO
        hunter_bet_archive
        (
          archive_key,
          signal_match_id,
          cloudbet_id,
          match,
          home,
          away,
          signal_type,
          classification,
          matcher_score,
          entry_minute,
          market,
          selection,
          odds,
          stake_eur,
          mode,
          created_at
        )
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        key,
        safeString(
          bet?.signal_match_id
        ) || null,
        cloudbetId || null,
        match || null,
        home || null,
        away || null,
        signalType || null,
        classification || null,
        Number.isFinite(
          matcherScore
        )
          ? matcherScore
          : null,
        Number.isFinite(
          entryMinute
        )
          ? entryMinute
          : null,
        BET_MARKET,
        BET_SELECTION,
        odds,
        BET_STAKE_EUR,
        MODE
      )
    );
  }

  try {
    const result =
      await env.DB.batch(
        statements
      );

    return {
      success: true,
      inserted:
        result.length,
      attempted:
        bets.length
    };
  } catch (
    error
  ) {
    return {
      success: false,
      inserted: 0,
      attempted:
        bets.length,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

// ============================================================
// PENDING ODDS
// ============================================================

function pendingId(
  bet: AnyObj
): string {
  return (
    archiveKey(
      bet
    ) +
    ":cloudbet:" +
    getCloudbetId(
      bet
    )
  );
}

async function savePendingOdds(
  env: Env,
  bet: AnyObj
): Promise<AnyObj> {
  if (
    !env.DB
  ) {
    return {
      success: false,
      error:
        "DB_BINDING_MISSING"
    };
  }

  const id =
    pendingId(
      bet
    );

  const archive =
    archiveKey(
      bet
    );

  const signalId =
    safeString(
      bet?.signal_match_id
    );

  const cloudbetId =
    getCloudbetId(
      bet
    );

  if (
    !cloudbetId
  ) {
    return {
      success: false,
      error:
        "CLOUDBET_ID_MISSING"
    };
  }

  const home =
    safeString(
      bet?.v27?.home ??
      bet?.cloudbet?.home
    );

  const away =
    safeString(
      bet?.v27?.away ??
      bet?.cloudbet?.away
    );

  const match =
    safeString(
      bet?.match
    );

  const entryMinute =
    Number(
      bet?.entry_minute ??
      bet?.minute ??
      null
    );

  const payload =
    JSON.stringify(
      bet
    );

  try {
    await env.DB.prepare(`
      INSERT INTO pending_odds
      (
        id,
        archive_key,
        signal_match_id,
        cloudbet_id,
        match,
        home,
        away,
        entry_minute,
        market,
        selection,
        stake_eur,
        mode,
        status,
        retry_count,
        last_checked_at,
        next_check_at,
        created_at,
        updated_at
      )
      VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_ODDS', 0, NULL, datetime('now', '+1 minute'), datetime('now'), datetime('now'))
      ON CONFLICT(archive_key)
      DO UPDATE SET
        cloudbet_id =
          excluded.cloudbet_id,
        match =
          excluded.match,
        home =
          excluded.home,
        away =
          excluded.away,
        entry_minute =
          excluded.entry_minute,
        updated_at =
          datetime('now'),
        next_check_at =
          datetime('now', '+1 minute'),
        status =
          'PENDING_ODDS'
    `).bind(
      id,
      archive,
      signalId || null,
      cloudbetId,
      match || null,
      home || null,
      away || null,
      Number.isFinite(
        entryMinute
      )
        ? entryMinute
        : null,
      BET_MARKET,
      BET_SELECTION,
      BET_STAKE_EUR,
      MODE
    ).run();

    return {
      success: true,
      status:
        "PENDING_ODDS",
      id,
      cloudbet_id:
        cloudbetId
    };
  } catch (
    error
  ) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function deletePending(
  env: Env,
  id: string
): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM pending_odds
    WHERE id = ?
  `)
    .bind(id)
    .run();
}

async function invalidatePending(
  env: Env,
  id: string,
  reason: string
): Promise<void> {
  await env.DB.prepare(`
    UPDATE pending_odds
    SET
      status = 'INVALIDATED',
      updated_at = datetime('now'),
      last_checked_at = datetime('now'),
      next_check_at = NULL
    WHERE id = ?
  `)
    .bind(id)
    .run();
}

async function loadPendingRows(
  env: Env
): Promise<AnyObj[]> {
  const result =
    await env.DB.prepare(`
      SELECT *
      FROM pending_odds
      WHERE status = 'PENDING_ODDS'
        AND (
          next_check_at IS NULL
          OR next_check_at <= datetime('now')
        )
      ORDER BY
        created_at ASC
    `).all();

  return (
    result.results ??
    []
  ) as AnyObj[];
}

// ============================================================
// CRON PENDING ODDS PROCESSOR
// ============================================================
//
// IMPORTANT:
// This function DOES NOT call:
//   Tracker
//   Matcher
//   Cloudbet search
//
// It only:
//   1. loads pending D1 rows
//   2. requests fresh Cloudbet /live
//   3. checks stored cloudbet_id
//   4. extracts odds
// ============================================================

async function processPendingOdds(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  const diagnostics: AnyObj = {
    success: true,

    version:
      VERSION,

    action:
      "PENDING_ODDS_CRON",

    pending_loaded:
      0,

    checked:
      0,

    odds_found:
      0,

    invalidated:
      0,

    still_pending:
      0,

    errors:
      0,

    details:
      []
  };

  if (
    !env.DB
  ) {
    return {
      ...diagnostics,

      success: false,

      error:
        "DB_BINDING_MISSING"
    };
  }

  let pendingRows:
    AnyObj[];

  try {
    pendingRows =
      await loadPendingRows(
        env
      );
  } catch (
    error
  ) {
    return {
      ...diagnostics,

      success: false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  diagnostics.pending_loaded =
    pendingRows.length;

  if (
    pendingRows.length === 0
  ) {
    diagnostics.elapsed_ms =
      Date.now() -
      started;

    return diagnostics;
  }

  // ----------------------------------------------------------
  // ONE fresh Cloudbet /live request for the whole batch.
  // ----------------------------------------------------------

  let rawData:
    AnyObj;

  try {
    rawData =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      );
  } catch (
    error
  ) {
    diagnostics.success =
      false;

    diagnostics.errors =
      pendingRows.length;

    diagnostics.error =
      error instanceof Error
        ? error.message
        : String(error);

    diagnostics.elapsed_ms =
      Date.now() -
      started;

    return diagnostics;
  }

  const liveMatches =
    extractCloudbetMatches(
      rawData
    );

  const byId =
    buildCloudbetIdMap(
      liveMatches
    );

  diagnostics.cloudbet_live_matches =
    liveMatches.length;

  // ----------------------------------------------------------
  // Process each saved candidate.
  // ----------------------------------------------------------

  for (
    const row of pendingRows
  ) {
    diagnostics.checked++;

    const cloudbetId =
      safeString(
        row?.cloudbet_id
      );

    if (
      !cloudbetId
    ) {
      diagnostics.errors++;

      await invalidatePending(
        env,
        safeString(
          row?.id
        ),
        "CLOUDBET_ID_MISSING"
      );

      diagnostics.invalidated++;

      continue;
    }

    // --------------------------------------------------------
    // IMPORTANT:
    // ONLY the previously confirmed ID is checked.
    // --------------------------------------------------------

    const cb =
      byId.get(
        cloudbetId
      );

    if (
      !cb
    ) {
      // Event is no longer present in current live feed.
      // We do NOT search for another event.
      await invalidatePending(
        env,
        safeString(
          row?.id
        ),
        "CLOUDBET_EVENT_NOT_FOUND"
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id:
          row?.id,

        cloudbet_id:
          cloudbetId,

        status:
          "INVALIDATED",

        reason:
          "CLOUDBET_EVENT_NOT_FOUND"
      });

      continue;
    }

    const validity =
      pendingIsStillValid(
        cb
      );

    if (
      !validity.valid
    ) {
      await invalidatePending(
        env,
        safeString(
          row?.id
        ),
        validity.reason
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id:
          row?.id,

        cloudbet_id:
          cloudbetId,

        status:
          "INVALIDATED",

        reason:
          validity.reason
      });

      continue;
    }

    const odds =
      extractOdds(
        cb
      );

    // --------------------------------------------------------
    // ODDS STILL SUSPENDED / UNAVAILABLE
    // --------------------------------------------------------

    if (
      odds === null
    ) {
      await env.DB.prepare(`
        UPDATE pending_odds
        SET
          retry_count =
            retry_count + 1,
          last_checked_at =
            datetime('now'),
          next_check_at =
            datetime('now', '+1 minute'),
          updated_at =
            datetime('now')
        WHERE id = ?
      `)
        .bind(
          row?.id
        )
        .run();

      diagnostics.still_pending++;

      diagnostics.details.push({
        id:
          row?.id,

        cloudbet_id:
          cloudbetId,

        status:
          "PENDING_ODDS",

        odds:
          null,

        retry_count:
          Number(
            row?.retry_count ??
            0
          ) + 1
      });

      continue;
    }

    // --------------------------------------------------------
    // ODDS FOUND
    // --------------------------------------------------------

    const payloadText =
      safeString(
        row?.payload_json
      );

    let bet:
      AnyObj = {};

    if (
      payloadText
    ) {
      try {
        bet =
          JSON.parse(
            payloadText
          );
      } catch {
        bet = {};
      }
    }

    // Reconstruct minimal candidate if old payload
    // is unavailable.
    if (
      !bet ||
      typeof bet !==
        "object"
    ) {
      bet = {};
    }

    bet.cloudbet = {
      ...(bet.cloudbet ?? {}),

      ...cb,

      id:
        cloudbetId,

      odds:
        odds,

      odds_available:
        true,

      odds_source:
        "CLOUDBET_LIVE_MARKETS"
    };

    bet.odds =
      odds;

    bet.odds_available =
      true;

    bet.candidate_complete =
      true;

    bet.cloudbet_id =
      cloudbetId;

    bet.signal_match_id =
      safeString(
        row?.signal_match_id
      );

    bet.match =
      safeString(
        row?.match
      ) ||
      displayMatch(cb);

    bet.v27 =
      bet.v27 ??
      {
        id:
          safeString(
            row?.signal_match_id
          ),

        home:
          safeString(
            row?.home
          ),

        away:
          safeString(
            row?.away
          )
      };

    bet.market =
      BET_MARKET;

    bet.selection =
      BET_SELECTION;

    bet.stake_eur =
      BET_STAKE_EUR;

    // --------------------------------------------------------
    // Archive ONLY when odds are now actually available.
    // --------------------------------------------------------

    const archive =
      await archivePreparedBets(
        env,
        [
          bet
        ]
      );

    // --------------------------------------------------------
    // Remove from pending queue.
    // --------------------------------------------------------

    await deletePending(
      env,
      safeString(
        row?.id
      )
    );

    diagnostics.odds_found++;

    diagnostics.details.push({
      id:
        row?.id,

      cloudbet_id:
        cloudbetId,

      status:
        "READY",

      odds:
        odds,

      archive
    });
  }

  diagnostics.elapsed_ms =
    Date.now() -
    started;

  return diagnostics;
}

// ============================================================
// VERIFY CLOUDBET
// ============================================================

async function verifyCloudbet(
  signal: AnyObj,
  matcherResult: AnyObj,
  liveMatches: AnyObj[],
  rawData: AnyObj
): Promise<AnyObj> {
  const matcherCloudbet =
    matcherResult?.cloudbet;

  const matcherCloudbetId =
    extractMatchId(
      matcherCloudbet ??
      {}
    );

  if (
    matcherCloudbetId
  ) {
    const byId =
      liveMatches.find(
        cb =>
          extractMatchId(cb) ===
          matcherCloudbetId
      );

    if (
      byId
    ) {
      const score =
        twoSidedTeamScore(
          signalHome(signal),
          signalAway(signal),
          extractHome(byId),
          extractAway(byId)
        );

      if (
        score.matched
      ) {
        return {
          verified: true,

          source:
            "MATCHER_CLOUDBET_ID",

          cloudbet:
            byId,

          cloudbet_id:
            matcherCloudbetId,

          team_scores:
            score
        };
      }
    }
  }

  const direct =
    findDirectCloudbet(
      signal,
      liveMatches
    );

  if (
    direct.found
  ) {
    return {
      verified: true,

      source:
        direct.source,

      cloudbet:
        direct.cloudbet,

      cloudbet_id:
        extractMatchId(
          direct.cloudbet
        ),

      team_scores:
        direct.cloudbet
          ?._match_score ??
        null
    };
  }

  const raw =
    findRawCloudbetMatch(
      signal,
      rawData
    );

  if (
    raw.found &&
    raw.cloudbet
  ) {
    const cb =
      raw.cloudbet;

    const score =
      twoSidedTeamScore(
        signalHome(signal),
        signalAway(signal),
        extractHome(cb),
        extractAway(cb)
      );

    if (
      score.matched
    ) {
      return {
        verified: true,

        source:
          raw.status ===
          "JSON_PRESENT_NOT_LIVE"
            ? "RAW_JSON_NOT_LIVE"
            : "RAW_JSON",

        cloudbet:
          cb,

        cloudbet_id:
          extractMatchId(cb),

        team_scores:
          score,

        cloudbet_live:
          isCloudbetLive(cb)
      };
    }
  }

  return {
    verified: false,

    source:
      "NOT_VERIFIED",

    cloudbet:
      null,

    cloudbet_id:
      null
  };
}

// ============================================================
// PREPARED BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  matcherResult: AnyObj,
  verification: AnyObj
): AnyObj {
  const cb =
    verification?.cloudbet ??
    matcherResult?.cloudbet ??
    {};

  const odds =
    extractOdds(cb);

  const oddsAvailable =
    odds !== null;

  const cloudbetId =
    extractMatchId(cb);

  return {
    status:
      "READY",

    mode:
      MODE,

    betting_enabled:
      BETTING_ENABLED,

    dry_run:
      DRY_RUN,

    signal_type:
      safeString(
        signal?.type ??
        signal?.signal_type ??
        signal?.signalType
      ),

    signal_match_id:
      signalMatchId(
        signal
      ),

    match:
      signalMatchName(
        signal
      ) ||
      `${signalHome(signal)} - ${signalAway(signal)}`,

    v27: {
      id:
        signalMatchId(
          signal
        ),

      home:
        signalHome(signal),

      away:
        signalAway(signal)
    },

    matcher: {
      classification:
        matcherResult
          ?.classification ??
        null,

      method:
        matcherResult
          ?.method ??
        null,

      matcher_score:
        matcherResult
          ?.matcher_score ??
        null,

      direction:
        matcherResult
          ?.team_scores
          ?.direction ??
        null,

      home_score:
        matcherResult
          ?.team_scores
          ?.home_score ??
        null,

      away_score:
        matcherResult
          ?.team_scores
          ?.away_score ??
        null,

      combined_score:
        matcherResult
          ?.team_scores
          ?.combined_score ??
        null
    },

    cloudbet: {
      id:
        cloudbetId,

      match:
        displayMatch(cb),

      home:
        extractHome(cb),

      away:
        extractAway(cb),

      status:
        cb?.status ??
        null,

      state:
        cb?.state ??
        null,

      live:
        isCloudbetLive(cb),

      odds:
        odds,

      odds_available:
        oddsAvailable,

      odds_source:
        oddsAvailable
          ? "CLOUDBET_LIVE_MARKETS"
          : null,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION
    },

    verification: {
      verified:
        verification?.verified ===
        true,

      source:
        verification?.source ??
        null,

      cloudbet_id:
        verification?.cloudbet_id ??
        cloudbetId ??
        null
    },

    stake_eur:
      BET_STAKE_EUR,

    bet_placed:
      false,

    simulated:
      true
  };
}

// ============================================================
// DRY RUN CANDIDATE
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

  if (
    oddsAvailable
  ) {
    bet.cloudbet.odds =
      odds;

    bet.cloudbet.odds_available =
      true;

    bet.cloudbet.odds_source =
      "CLOUDBET_LIVE_MARKETS";
  }

  return {
    status:
      "BET_CANDIDATE",

    mode:
      MODE,

    betting_enabled:
      false,

    dry_run:
      true,

    bet_placed:
      false,

    bet_action:
      "SIMULATED_ONLY",

    match:
      bet?.match ??
      displayMatch(
        bet?.cloudbet ??
        {}
      ),

    signal_match_id:
      bet?.signal_match_id ??
      null,

    cloudbet_id:
      getCloudbetId(
        bet
      ),

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    stake_eur:
      BET_STAKE_EUR,

    odds:
      odds,

    odds_available:
      oddsAvailable,

    candidate_complete:
      oddsAvailable,

    odds_source:
      oddsAvailable
        ? "CLOUDBET_LIVE_MARKETS"
        : null,

    cloudbet:
      bet?.cloudbet ??
      null,

    matcher:
      bet?.matcher ??
      null,

    verification:
      bet?.verification ??
      null,

    simulated:
      true
  };
}

// ============================================================
// MAIN V5.8
// ============================================================

async function runV58(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  // ----------------------------------------------------------
  // TRACKER
  // ----------------------------------------------------------

  const trackerPromise =
    fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );

  // ----------------------------------------------------------
  // MATCHER
  // ----------------------------------------------------------

  const matcherPromise =
    fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    );

  // ----------------------------------------------------------
  // CLOUDBET
  // ----------------------------------------------------------

  const cloudbetPromise =
    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );

  let trackerData:
    AnyObj;

  let matcherData:
    AnyObj;

  let cloudbetData:
    AnyObj;

  try {
    [
      trackerData,
      matcherData,
      cloudbetData
    ] =
      await Promise.all([
        trackerPromise,
        matcherPromise,
        cloudbetPromise
      ]);
  } catch (
    error
  ) {
    return {
      success: false,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      mode:
        MODE,

      betting:
        "DISABLED",

      error:
        error instanceof Error
          ? error.message
          : String(error),

      elapsed_ms:
        Date.now() -
        started
    };
  }

  const allSignals =
    extractSignals(
      trackerData
    );

  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );

  const liveMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const preparedBets:
    AnyObj[] =
    [];

  const matcherFailures:
    AnyObj[] =
    [];

  const verificationFailures:
    AnyObj[] =
    [];

  // ----------------------------------------------------------
  // PROCESS HUNTER ENTRIES
  // ----------------------------------------------------------

  for (
    const signal of
      hunterEntries
  ) {
    const matcher =
      findBestMatcherCandidate(
        signal,
        matcherData
      );

    if (
      !matcher.found
    ) {
      matcherFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
            signal
          ),

        reason:
          matcher.reason,

        diagnostics:
          matcher.diagnostics
      });

      continue;
    }

    const verification =
      await verifyCloudbet(
        signal,
        matcher,
        liveMatches,
        cloudbetData
      );

    if (
      !verification.verified
    ) {
      verificationFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
            signal
          ),

        reason:
          "CLOUDBET_NOT_VERIFIED"
      });

      continue;
    }

    const bet =
      buildPreparedBet(
        signal,
        matcher,
        verification
      );

    bet.entry_minute =
      Number(
        signal?.minute ??
        signal?.entry_minute ??
        signal?.v27?.minute ??
        null
      );

    preparedBets.push(
      bet
    );
  }

  // ----------------------------------------------------------
  // NO WAITING
  //
  // Check odds immediately from initial /live.
  // Missing odds are persisted to D1.
  // ----------------------------------------------------------

  const completeBets:
    AnyObj[] =
    [];

  const pendingBets:
    AnyObj[] =
    [];

  for (
    const bet of
      preparedBets
  ) {
    if (
      updateBetOdds(
        bet
      )
    ) {
      completeBets.push(
        bet
      );
    } else {
      pendingBets.push(
        bet
      );
    }
  }

  // ----------------------------------------------------------
  // SAVE PENDING ODDS
  // ----------------------------------------------------------

  const pendingResults:
    AnyObj[] =
    [];

  for (
    const bet of
      pendingBets
  ) {
    const result =
      await savePendingOdds(
        env,
        bet
      );

    pendingResults.push({
      match:
        bet?.match,

      cloudbet_id:
        getCloudbetId(
          bet
        ),

      ...result
    });
  }

  // ----------------------------------------------------------
  // ARCHIVE ONLY BETS WITH REAL ODDS
  // ----------------------------------------------------------

  const archive =
    await archivePreparedBets(
      env,
      completeBets
    );

  // ----------------------------------------------------------
  // FINAL CANDIDATES
  // ----------------------------------------------------------

  const candidates =
    preparedBets.map(
      buildDryRunCandidate
    );

  const completeCandidates =
    candidates.filter(
      c =>
        c.candidate_complete ===
        true
    );

  const incompleteCandidates =
    candidates.filter(
      c =>
        c.candidate_complete !==
        true
    );

  return {
    success: true,

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

    action:
      "RUN",

    config: {
      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      target_sport:
        TARGET_SPORT,

      target_period:
        TARGET_PERIOD,

      target_outcome:
        TARGET_OUTCOME,

      target_line:
        TARGET_LINE,

      required_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      pending_retry:
        "CRON_EVERY_MINUTE"
    },

    tracker: {
      signals_received:
        allSignals.length,

      hunter_entries:
        hunterEntries.length
    },

    matcher: {
      candidates_checked:
        hunterEntries.length,

      matched:
        preparedBets.length,

      failures:
        matcherFailures.length
    },

    cloudbet: {
      live_matches:
        liveMatches.length,

      verified:
        preparedBets.length,

      verification_failures:
        verificationFailures.length
    },

    odds: {
      prepared:
        preparedBets.length,

      available:
        completeBets.length,

      unavailable:
        pendingBets.length,

      pending_saved:
        pendingResults.filter(
          x =>
            x?.success ===
            true
        ).length,

      pending:
        pendingResults
    },

    candidates: {
      total:
        candidates.length,

      complete:
        completeCandidates.length,

      incomplete:
        incompleteCandidates.length
    },

    archive,

    prepared_bets:
      preparedBets,

    bet_candidates:
      candidates,

    matcher_failures:
      matcherFailures,

    verification_failures:
      verificationFailures,

    elapsed_ms:
      Date.now() -
      started
  };
}

// ============================================================
// HEALTH
// ============================================================

function healthResponse(
  env: Env
): Response {
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

    dry_run:
      DRY_RUN,

    bindings: {
      TRACKER:
        !!env.TRACKER,

      MATCHER:
        !!env.MATCHER,

      CLOUDBET:
        !!env.CLOUDBET,

      DB:
        !!env.DB
    },

    config: {
      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      stake_eur:
        BET_STAKE_EUR,

      pending_odds:
        true,

      retry:
        "CRON_EVERY_MINUTE"
    }
  });
}

// ============================================================
// REQUEST HANDLER + CRON
// ============================================================

export default {

  // ==========================================================
  // HTTP
  // ==========================================================

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url =
      new URL(
        request.url
      );

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      url.pathname ===
        "/health" ||
      url.pathname ===
        "/"
    ) {
      return healthResponse(
        env
      );
    }

    // --------------------------------------------------------
    // RUN
    // --------------------------------------------------------

    if (
      url.pathname ===
        "/run"
    ) {
      if (
        request.method !==
        "GET"
      ) {
        return json(
          {
            success: false,
            error:
              "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      try {
        const result =
          await runV58(
            env
          );

        return json(
          result
        );
      } catch (
        error
      ) {
        return json(
          {
            success: false,

            worker:
              "cloudbet-bet-worker",

            version:
              VERSION,

            mode:
              MODE,

            betting:
              "DISABLED",

            error:
              error instanceof Error
                ? error.message
                : String(error),

            stack:
              error instanceof Error
                ? error.stack
                : null
          },
          500
        );
      }
    }

    // --------------------------------------------------------
    // PENDING STATUS
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/pending"
    ) {
      if (
        !env.DB
      ) {
        return json(
          {
            success: false,
            error:
              "DB_BINDING_MISSING"
          },
          500
        );
      }

      try {
        const result =
          await env.DB.prepare(`
            SELECT
              id,
              archive_key,
              signal_match_id,
              cloudbet_id,
              match,
              home,
              away,
              entry_minute,
              market,
              selection,
              stake_eur,
              mode,
              status,
              retry_count,
              last_checked_at,
              next_check_at,
              created_at,
              updated_at
            FROM pending_odds
            WHERE status = 'PENDING_ODDS'
            ORDER BY created_at ASC
          `).all();

        return json({
          success: true,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          status:
            "PENDING_ODDS",

          count:
            result.results?.length ??
            0,

          pending:
            result.results ??
            []
        });
      } catch (
        error
      ) {
        return json(
          {
            success: false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }

    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    return json(
      {
        success: false,

        error:
          "NOT_FOUND",

        path:
          url.pathname,

        available:
          [
            "/health",
            "/run",
            "/pending"
          ]
      },
      404
    );
  },

  // ==========================================================
  // CLOUDFLARE CRON
  // ==========================================================

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      processPendingOdds(
        env
      )
        .then(
          result => {
            console.log(
              JSON.stringify(
                {
                  cron:
                    true,

                  version:
                    VERSION,

                  ...result
                }
              )
            );
          }
        )
        .catch(
          error => {
            console.error(
              JSON.stringify(
                {
                  cron:
                    true,

                  version:
                    VERSION,

                  success:
                    false,

                  error:
                    error instanceof Error
                      ? error.message
                      : String(error)
                }
              )
            );
          }
        )
    );
  }
};

// ============================================================
// END V5.8
// ============================================================
