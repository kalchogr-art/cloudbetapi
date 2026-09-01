// ============================================================
// CLOUDBET BET WORKER V5.8.3
// DRY RUN — PERSISTENT ODDS RETRY
// EXACT 1H TOTAL GOALS OVER 0.5 MARKET
//
// OPTIMIZED:
// - Parallel Tracker / Matcher / Cloudbet requests
// - One Cloudbet /live request per RUN
// - One Cloudbet /live request per pending CRON
// - Strict two-sided team verification
// - Exact Cloudbet 1H Over 0.5 market
// - READ ONLY /archive endpoint
// - REAL BETTING DISABLED
//
// V5.8.3 FIX:
// - hunter_bet_archive uses the REAL D1 schema
// - /archive uses the REAL D1 schema
// - hunter_score persisted
// - pending_odds remains unchanged
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

const VERSION = "V5.8.3";

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

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

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
// EXACT CLOUDBET MARKET
// ============================================================

const TARGET_MARKET_KEY =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET_KEY =
  "period=1h";

const TARGET_OUTCOME_KEY =
  "over";

const TARGET_PARAMS =
  "total=0.5";

const TARGET_MARKET_URL =
  "soccer.total_goals_period_first_half/over?total=0.5";

// ============================================================
// PENDING
// ============================================================

const MAX_MISSING_CHECKS = 3;

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

function safeString(
  value: any
): string {
  return String(
    value ?? ""
  ).trim();
}

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

function applyAliases(
  value: string
): string {
  let result =
    normalizeText(value);

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

    result =
      result.replace(
        new RegExp(
          `(^|\\s)${escaped}(?=\\s|$)`,
          "g"
        ),
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

function normalizeTeam(
  value: any
): string {
  return applyAliases(
    safeString(value)
  )
    .split(" ")
    .filter(Boolean)
    .filter(
      word =>
        !GENERIC_WORDS.has(
          word
        )
    )
    .filter(
      word =>
        !/^\d+$/.test(word)
    )
    .join(" ")
    .trim();
}

function teamTokens(
  value: any
): string[] {
  return normalizeTeam(
    value
  )
    .split(" ")
    .filter(
      word =>
        word.length >= 3
    );
}

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {
  const text =
    safeString(value);

  for (
    const separator of [
      " - ",
      " v ",
      " vs ",
      " VS ",
      " @ "
    ]
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
// MATCH EXTRACTION
// ============================================================

function extractHome(
  match: AnyObj
): string {
  const values = [
    match?.v27?.home,
    match?.v27?.homeTeam,
    match?.v27?.home_name,
    match?.home,
    match?.homeTeam,
    match?.home_name,
    match?.home?.name,
    match?.home_team?.name,
    match?.teams?.home?.name
  ];

  for (
    const value of values
  ) {
    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
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

function extractAway(
  match: AnyObj
): string {
  const values = [
    match?.v27?.away,
    match?.v27?.awayTeam,
    match?.v27?.away_name,
    match?.away,
    match?.awayTeam,
    match?.away_name,
    match?.away?.name,
    match?.away_team?.name,
    match?.teams?.away?.name
  ];

  for (
    const value of values
  ) {
    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {
      return value.trim();
    }
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

function displayMatch(
  match: AnyObj
): string {
  return (
    safeString(
      match?.match ??
      match?.name ??
      match?.event_name
    ) ||
    `${extractHome(
      match
    )} - ${extractAway(
      match
    )}`
  );
}

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
// TEAM MATCHING
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
    Array.from(
      {
        length:
          b.length + 1
      },
      (_, index) =>
        index
    );

  let current =
    new Array<number>(
      b.length + 1
    );

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
          previous[j - 1] +
            cost
        );
    }

    [
      previous,
      current
    ] = [
      current,
      previous
    ];
  }

  return previous[
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

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
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

  const tokensA =
    teamTokens(A);

  const tokensB =
    teamTokens(B);

  const common =
    tokensA.filter(
      token =>
        tokensB.includes(
          token
        )
    );

  if (
    common.length >=
    TOKEN_MIN_COMMON
  ) {
    const score =
      common.length /
      Math.max(
        tokensA.length,
        tokensB.length
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

  const reverseHome =
    teamMatchScore(
      homeA,
      awayB
    );

  const reverseAway =
    teamMatchScore(
      awayA,
      homeB
    );

  const normalScore =
    Math.min(
      normalHome.score,
      normalAway.score
    );

  const reversedScore =
    Math.min(
      reverseHome.score,
      reverseAway.score
    );

  const normalValid =
    normalHome.accepted &&
    normalAway.accepted &&
    normalHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    normalAway.score >=
      TEAM_MATCH_MIN_SCORE;

  const reversedValid =
    reverseHome.accepted &&
    reverseAway.accepted &&
    reverseHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    reverseAway.score >=
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
        normalHome.score,
      away_score:
        normalAway.score,
      combined_score:
        normalScore,
      both_teams_pass: true,
      home_method:
        normalHome.method,
      away_method:
        normalAway.method
    };
  }

  if (reversedValid) {
    return {
      matched: true,
      direction:
        "REVERSED",
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      combined_score:
        reversedScore,
      both_teams_pass: true,
      home_method:
        reverseHome.method,
      away_method:
        reverseAway.method
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
        ? normalHome.score
        : reverseHome.score,
    away_score:
      normalScore >=
      reversedScore
        ? normalAway.score
        : reverseAway.score,
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
  const values =
    data?.signals ??
    data?.entries ??
    data?.hunter_entries ??
    data?.data ??
    [];

  return Array.isArray(
    values
  )
    ? values.filter(
        value =>
          value &&
          typeof value ===
            "object"
      )
    : [];
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
  return safeString(
    signal?.v27?.home ??
    extractHome(signal)
  );
}

function signalAway(
  signal: AnyObj
): string {
  return safeString(
    signal?.v27?.away ??
    extractAway(signal)
  );
}

// ============================================================
// MATCHER
// ============================================================

function extractMatcherMatches(
  data: AnyObj
): AnyObj[] {
  const values =
    data?.matches ??
    data?.results ??
    data?.matched ??
    data?.candidates ??
    [];

  return Array.isArray(
    values
  )
    ? values
    : [];
}

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

  if (!teamScore.matched) {
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

    source: "MATCHER",

    classification,

    method,

    matcher_score:
      matcherScore,

    v27: {
      id:
        extractMatchId(
          v27
        ),
      match:
        displayMatch(
          v27
        ),
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
    Record<string, number> =
    {};

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

      continue;
    }

    const reason =
      result.reason ??
      "UNKNOWN";

    rejectionReasons[
      reason
    ] =
      (
        rejectionReasons[
          reason
        ] ?? 0
      ) + 1;
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
        item =>
          item &&
          typeof item ===
            "object"
      );
    }
  }

  return [];
}

function isCloudbetLive(
  match: AnyObj
): boolean {
  const status =
    safeString(
      match?.status ??
      match?.event_status ??
      match?.trading_status
    ).toUpperCase();

  const state =
    safeString(
      match?.state
    ).toUpperCase();

  return (
    status ===
      "TRADING_LIVE" ||
    state === "LIVE" ||
    match?.live === true
  );
}

// ============================================================
// CLOUDBET RAW MATCH
// ============================================================

function findCloudbetRawJsonPresence(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  const sHome =
    signalHome(signal);

  const sAway =
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
    const cloudbet of matches
  ) {
    const cbHome =
      extractHome(
        cloudbet
      );

    const cbAway =
      extractAway(
        cloudbet
      );

    if (
      !teamsPresent(
        sHome,
        sAway
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
        sHome,
        sAway,
        cbHome,
        cbAway
      );

    if (!score.matched) {
      continue;
    }

    const cloudbetId =
      extractMatchId(
        cloudbet
      );

    const idMatch =
      !!signalId &&
      !!cloudbetId &&
      signalId ===
        cloudbetId;

    const candidate = {
      ...cloudbet,

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
          isCloudbetLive(
            cloudbet
          )
      }
    };

    if (idMatch) {
      return {
        found: true,
        source:
          "RAW_JSON",
        status:
          isCloudbetLive(
            cloudbet
          )
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
      best = candidate;
    }
  }

  if (best) {
    return {
      found: true,
      source:
        "RAW_JSON",
      status:
        isCloudbetLive(
          best
        )
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
    cloudbet: null
  };
}

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

  if (signalId) {
    const byId =
      liveMatches.find(
        cloudbet =>
          extractMatchId(
            cloudbet
          ) === signalId
      );

    if (byId) {
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
    const cloudbet of
    liveMatches
  ) {
    if (
      !isCloudbetLive(
        cloudbet
      )
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sHome,
        sAway,
        extractHome(
          cloudbet
        ),
        extractAway(
          cloudbet
        )
      );

    if (!score.matched) {
      continue;
    }

    const candidate = {
      ...cloudbet,
      _match_score:
        score
    };

    if (
      !best ||
      score.combined_score >
        best?._match_score
          ?.combined_score
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      found: false,
      source:
        "CLOUDBET_DIRECT",
      cloudbet: null
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

// ============================================================
// MATCHER SEARCH
// ============================================================

function findBestMatcherCandidate(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj {
  const matches =
    extractMatcherMatches(
      matcherData
    );

  let best: AnyObj = {
    accepted: false,
    reason:
      "NO_MATCHER_CANDIDATE",
    matcher_candidates:
      matches.length
  };

  for (
    const item of matches
  ) {
    const validation =
      validateMatcherCandidate(
        signal,
        item
      );

    if (
      !validation.accepted
    ) {
      continue;
    }

    if (
      !best.accepted ||
      Number(
        validation.matcher_score ??
        0
      ) >
        Number(
          best.matcher_score ??
          0
        )
    ) {
      best =
        validation;
    }
  }

  return best;
}

// ============================================================
// CLOUDBET EXTRACTION
// ============================================================

function extractCloudbetMatches(
  data: AnyObj
): AnyObj[] {
  const values =
    data?.matches ??
    data?.events ??
    data?.data ??
    data?.results ??
    [];

  return Array.isArray(
    values
  )
    ? values
    : [];
}

function isCloudbetLive(
  match: AnyObj
): boolean {
  if (
    match?.live === true ||
    match?.is_live === true ||
    match?.in_play === true
  ) {
    return true;
  }

  const status =
    safeString(
      match?.status ??
      match?.state ??
      match?.event_status
    ).toLowerCase();

  return (
    status === "live" ||
    status === "inplay" ||
    status === "in_play" ||
    status === "started"
  );
}

function findCloudbetRawJsonPresence(
  match: AnyObj
): boolean {
  const json =
    JSON.stringify(
      match
    ).toLowerCase();

  return (
    json.includes(
      "total_goals_period_first_half"
    ) ||
    json.includes(
      "period=1h"
    ) ||
    json.includes(
      "over?total=0.5"
    )
  );
}

// ============================================================
// DIRECT CLOUDBET MATCH
// ============================================================

function findDirectCloudbet(
  signal: AnyObj,
  liveMatches: AnyObj[]
): AnyObj {
  const sHome =
    signalHome(
      signal
    );

  const sAway =
    signalAway(
      signal
    );

  let best:
    AnyObj = {
      accepted: false,
      reason:
        "NO_DIRECT_CLOUDBET_MATCH"
    };

  for (
    const cloudbet of
      liveMatches
  ) {
    const cHome =
      extractHome(
        cloudbet
      );

    const cAway =
      extractAway(
        cloudbet
      );

    if (
      !teamsPresent(
        cHome,
        cAway
      )
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sHome,
        sAway,
        cHome,
        cAway
      );

    if (
      !score.matched
    ) {
      continue;
    }

    if (
      !best.accepted ||
      score.combined_score >
        Number(
          best.team_scores
            ?.combined_score ??
          0
        )
    ) {
      best = {
        accepted: true,
        reason:
          "DIRECT_CLOUDBET_MATCH_ACCEPTED",
        source:
          "DIRECT_CLOUDBET",
        cloudbet: {
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
            cAway,
          live:
            isCloudbetLive(
              cloudbet
            ),
          raw:
            cloudbet
        },
        team_scores:
          score
      };
    }
  }

  return best;
}

// ============================================================
// CLOUD BET MARKET HELPERS
// ============================================================

function collectObjects(
  value: any,
  output: AnyObj[] = []
): AnyObj[] {
  if (
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (
    Array.isArray(
      value
    )
  ) {
    for (
      const item of value
    ) {
      collectObjects(
        item,
        output
      );
    }

    return output;
  }

  if (
    typeof value ===
    "object"
  ) {
    output.push(
      value
    );

    for (
      const key of
        Object.keys(
          value
        )
    ) {
      collectObjects(
        value[key],
        output
      );
    }
  }

  return output;
}

function normalizeMarketText(
  value: any
): string {
  return safeString(
    value
  )
    .toLowerCase()
    .replace(
      /[\s_-]+/g,
      ""
    );
}

function hasTargetMarketKey(
  value: any
): boolean {
  const text =
    normalizeMarketText(
      value
    );

  return (
    text.includes(
      normalizeMarketText(
        TARGET_MARKET_KEY
      )
    ) ||
    text.includes(
      normalizeMarketText(
        TARGET_SUBMARKET_KEY
      )
    )
  );
}

function isTargetOutcome(
  value: any
): boolean {
  const text =
    normalizeMarketText(
      value
    );

  return (
    text ===
      "over" ||
    text ===
      "over0.5" ||
    text.includes(
      "over0.5"
    )
  );
}

function isTargetLine(
  value: any
): boolean {
  const number =
    Number(
      value
    );

  return (
    Number.isFinite(
      number
    ) &&
    number ===
      TARGET_LINE
  );
}

function objectContainsTargetMarket(
  value: AnyObj
): boolean {
  const objects =
    collectObjects(
      value,
      []
    );

  for (
    const object of
      objects
  ) {
    const keyText =
      [
        object?.key,
        object?.market_key,
        object?.marketKey,
        object?.type,
        object?.name,
        object?.market,
        object?.path,
        object?.url
      ]
        .map(
          item =>
            safeString(
              item
            )
        )
        .join(" ");

    if (
      hasTargetMarketKey(
        keyText
      )
    ) {
      return true;
    }
  }

  return false;
}

function findTargetOutcome(
  value: AnyObj
): AnyObj | null {
  const objects =
    collectObjects(
      value,
      []
    );

  for (
    const object of
      objects
  ) {
    const keyText =
      [
        object?.key,
        object?.outcome_key,
        object?.outcomeKey,
        object?.name,
        object?.selection,
        object?.label,
        object?.url
      ]
        .map(
          item =>
            safeString(
              item
            )
        )
        .join(" ");

    const line =
      object?.line ??
      object?.total ??
      object?.handicap ??
      object?.points ??
      object?.params?.total;

    const outcome =
      object?.outcome ??
      object?.outcome_key ??
      object?.selection ??
      object?.name ??
      object?.label ??
      object?.key;

    if (
      isTargetOutcome(
        keyText
      ) &&
      (
        line ===
          undefined ||
        isTargetLine(
          line
        )
      )
    ) {
      return object;
    }

    if (
      isTargetOutcome(
        outcome
      ) &&
      (
        line ===
          undefined ||
        isTargetLine(
          line
        )
      )
    ) {
      return object;
    }
  }

  return null;
}

// ============================================================
// ODDS EXTRACTION
// ============================================================

function extractOdds(
  cloudbet: AnyObj
): number | null {
  const objects =
    collectObjects(
      cloudbet,
      []
    );

  for (
    const object of
      objects
  ) {
    const keyText =
      [
        object?.key,
        object?.outcome_key,
        object?.outcomeKey,
        object?.name,
        object?.selection,
        object?.label
      ]
        .map(
          item =>
            safeString(
              item
            )
        )
        .join(" ");

    const line =
      object?.line ??
      object?.total ??
      object?.handicap ??
      object?.points ??
      object?.params?.total;

    const outcome =
      object?.outcome ??
      object?.outcome_key ??
      object?.selection ??
      object?.name ??
      object?.label ??
      object?.key;

    if (
      !isTargetOutcome(
        keyText
      ) &&
      !isTargetOutcome(
        outcome
      )
    ) {
      continue;
    }

    if (
      line !==
        undefined &&
      !isTargetLine(
        line
      )
    ) {
      continue;
    }

    const odds =
      Number(
        object?.odds ??
        object?.price ??
        object?.decimal ??
        object?.value ??
        object?.rate
      );

    if (
      Number.isFinite(
        odds
      ) &&
      odds > 1
    ) {
      return odds;
    }
  }

  return null;
}

// ============================================================
// CLOUD BET MARKET SEARCH
// ============================================================

function findTargetMarket(
  cloudbet: AnyObj
): AnyObj | null {
  const objects =
    collectObjects(
      cloudbet,
      []
    );

  for (
    const object of
      objects
  ) {
    const keyText =
      [
        object?.key,
        object?.market_key,
        object?.marketKey,
        object?.type,
        object?.name,
        object?.market,
        object?.path,
        object?.url
      ]
        .map(
          item =>
            safeString(
              item
            )
        )
        .join(" ");

    if (
      !hasTargetMarketKey(
        keyText
      )
    ) {
      continue;
    }

    return object;
  }

  return null;
}

// ============================================================
// PREPARED BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  matcher: AnyObj,
  cloudbet: AnyObj,
  odds: number | null
): AnyObj {
  const signalId =
    signalMatchId(
      signal
    );

  const signalName =
    signalMatchName(
      signal
    );

  const home =
    signalHome(
      signal
    );

  const away =
    signalAway(
      signal
    );

  const matcherScore =
    Number(
      matcher?.matcher_score ??
      matcher?.score ??
      0
    );

  const cloudbetCombinedScore =
    Number(
      matcher?.team_scores
        ?.combined_score ??
      cloudbet?.team_scores
        ?.combined_score ??
      0
    );

  const direction =
    safeString(
      matcher?.team_scores
        ?.direction ??
      cloudbet?.team_scores
        ?.direction
    );

  const entryMinute =
    Number(
      signal?.entry_minute ??
      signal?.minute ??
      signal?.v27?.minute ??
      0
    );

  const archiveKey =
    [
      signalId,
      extractMatchId(
        cloudbet
      ),
      entryMinute
    ].join(
      ":"
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
      "DRY_RUN_ONLY",

    archive_key:
      archiveKey,

    signal_match_id:
      signalId,

    match:
      signalName,

    home,

    away,

    entry_minute:
      entryMinute,

    hunter_score:
      signal?.hunter_score ??
      signal?.v27?.hunter_score ??
      signal?.score ??
      null,

    cloudbet_id:
      extractMatchId(
        cloudbet
      ),

    cloudbet_match:
      displayMatch(
        cloudbet
      ),

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    odds,

    stake_eur:
      BET_STAKE_EUR,

    matcher_source:
      matcher?.source ??
      "MATCHER",

    matcher_score:
      Number.isFinite(
        matcherScore
      )
        ? matcherScore
        : null,

    cloudbet_combined_score:
      Number.isFinite(
        cloudbetCombinedScore
      )
        ? cloudbetCombinedScore
        : null,

    direction:
      direction ||
      null,

    matcher,

    cloudbet
  };
}
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
      oddsAvailable
        ? "DRY_RUN_READY"
        : "WAITING_FOR_ODDS",

    archive_key:
      bet?.archive_key ??
      null,

    signal_match_id:
      bet?.signal_match_id ??
      null,

    match:
      bet?.match ??
      null,

    home:
      bet?.home ??
      null,

    away:
      bet?.away ??
      null,

    entry_minute:
      bet?.entry_minute ??
      null,

    hunter_score:
      bet?.hunter_score ??
      null,

    cloudbet_id:
      bet?.cloudbet_id ??
      null,

    cloudbet_match:
      bet?.cloudbet_match ??
      null,

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    odds,

    odds_available:
      oddsAvailable,

    stake_eur:
      BET_STAKE_EUR,

    matcher_source:
      bet?.matcher_source ??
      "MATCHER",

    matcher_score:
      bet?.matcher_score ??
      null,

    cloudbet_combined_score:
      bet?.cloudbet_combined_score ??
      null,

    direction:
      bet?.direction ??
      null
  };
}

// ============================================================
// PENDING ODDS
// ============================================================

function pendingArchiveKey(
  bet: AnyObj
): string {
  return safeString(
    bet?.archive_key
  );
}

async function getPendingOdds(
  db: D1Database
): Promise<AnyObj[]> {
  const result =
    await db
      .prepare(
        `
        SELECT
          *
        FROM pending_odds
        WHERE status = 'PENDING_ODDS'
        ORDER BY id ASC
        `
      )
      .all();

  return Array.isArray(
    result?.results
  )
    ? result.results
    : [];
}

async function getPendingByArchiveKey(
  db: D1Database,
  archiveKey: string
): Promise<AnyObj | null> {
  if (
    !archiveKey
  ) {
    return null;
  }

  const result =
    await db
      .prepare(
        `
        SELECT
          *
        FROM pending_odds
        WHERE archive_key = ?
        LIMIT 1
        `
      )
      .bind(
        archiveKey
      )
      .first();

  return (
    result ??
    null
  );
}

async function insertPendingOdds(
  db: D1Database,
  bet: AnyObj,
  now: string
): Promise<void> {
  const archiveKey =
    pendingArchiveKey(
      bet
    );

  if (
    !archiveKey
  ) {
    return;
  }

  const existing =
    await getPendingByArchiveKey(
      db,
      archiveKey
    );

  if (
    existing
  ) {
    return;
  }

  await db
    .prepare(
      `
      INSERT INTO pending_odds (
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
        updated_at,
        payload_json,
        missing_count
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'PENDING_ODDS',
        0,
        ?,
        ?,
        ?,
        ?,
        ?,
        0
      )
      `
    )
    .bind(
      archiveKey,
      bet?.signal_match_id ??
        null,
      bet?.cloudbet_id ??
        "",
      bet?.match ??
        null,
      bet?.home ??
        null,
      bet?.away ??
        null,
      bet?.entry_minute ??
        null,
      BET_MARKET,
      BET_SELECTION,
      BET_STAKE_EUR,
      MODE,
      now,
      now,
      now,
      now,
      JSON.stringify(
        bet
      )
    )
    .run();
}

async function updatePendingOdds(
  db: D1Database,
  pending: AnyObj,
  odds: number | null,
  now: string
): Promise<void> {
  const retryCount =
    Number(
      pending?.retry_count ??
      0
    ) + 1;

  const nextCheck =
    new Date(
      Date.now() +
        30000
    ).toISOString();

  await db
    .prepare(
      `
      UPDATE pending_odds
      SET
        retry_count = ?,
        last_checked_at = ?,
        next_check_at = ?,
        updated_at = ?,
        payload_json = ?,
        status = ?
      WHERE archive_key = ?
      `
    )
    .bind(
      retryCount,
      now,
      nextCheck,
      now,
      JSON.stringify({
        previous:
          pending?.payload_json ??
          null,
        odds
      }),
      odds !== null
        ? "READY"
        : "PENDING_ODDS",
      pending.archive_key
    )
    .run();
}

// ============================================================
// HUNTER BET ARCHIVE
// ============================================================

async function archiveBet(
  db: D1Database,
  bet: AnyObj,
  now: string
): Promise<void> {
  const archiveKey =
    safeString(
      bet?.archive_key
    );

  if (
    !archiveKey
  ) {
    return;
  }

  await db
    .prepare(
      `
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
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      `
    )
    .bind(
      archiveKey,

      bet?.signal_match_id ??
        null,

      bet?.match ??
        null,

      bet?.home ??
        null,

      bet?.away ??
        null,

      bet?.entry_minute ??
        null,

      bet?.hunter_score ??
        null,

      bet?.cloudbet_id ??
        null,

      bet?.cloudbet_match ??
        bet?.match ??
        null,

      bet?.matcher_source ??
        "MATCHER",

      bet?.matcher_score ??
        null,

      bet?.cloudbet_combined_score ??
        null,

      bet?.direction ??
        null,

      now
    )
    .run();
}

// ============================================================
// ARCHIVE READ
// ============================================================

async function readArchive(
  db: D1Database,
  limit = 100
): Promise<AnyObj[]> {
  const safeLimit =
    Math.min(
      Math.max(
        Number(
          limit
        ) || 100,
        1
      ),
      500
    );

  const result =
    await db
      .prepare(
        `
        SELECT
          id,
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
        FROM hunter_bet_archive
        ORDER BY id DESC
        LIMIT ?
        `
      )
      .bind(
        safeLimit
      )
      .all();

  return Array.isArray(
    result?.results
  )
    ? result.results
    : [];
}

// ============================================================
// ARCHIVE STATS
// ============================================================

async function archiveStats(
  db: D1Database
): Promise<AnyObj> {
  const total =
    await db
      .prepare(
        `
        SELECT
          COUNT(*) AS total
        FROM hunter_bet_archive
        `
      )
      .first();

  const today =
    await db
      .prepare(
        `
        SELECT
          COUNT(*) AS total
        FROM hunter_bet_archive
        WHERE date(created_at) =
          date('now')
        `
      )
      .first();

  return {
    total:
      Number(
        total?.total ??
        0
      ),

    today:
      Number(
        today?.total ??
        0
      )
  };
}

// ============================================================
// SIGNAL HELPERS
// ============================================================

function signalHunterScore(
  signal: AnyObj
): number | null {
  const score =
    Number(
      signal?.hunter_score ??
      signal?.v27?.hunter_score ??
      signal?.score ??
      signal?.goal_signal?.score
    );

  return Number.isFinite(
    score
  )
    ? score
    : null;
}

function signalEntryMinute(
  signal: AnyObj
): number | null {
  const minute =
    Number(
      signal?.entry_minute ??
      signal?.minute ??
      signal?.v27?.minute
    );

  return Number.isFinite(
    minute
  )
    ? minute
    : null;
}

function signalIsEligible(
  signal: AnyObj
): boolean {
  if (
    !isHunterEntry(
      signal
    )
  ) {
    return false;
  }

  const minute =
    signalEntryMinute(
      signal
    );

  const score =
    signalHunterScore(
      signal
    );

  if (
    minute ===
      null ||
    score ===
      null
  ) {
    return false;
  }

  return (
    minute >= 10 &&
    minute <= 45 &&
    score >= 60
  );
}

// ============================================================
// MAIN CANDIDATE PROCESS
// ============================================================

async function processSignal(
  env: Env,
  signal: AnyObj,
  cloudbetLive: AnyObj[]
): Promise<AnyObj> {
  const matcherRequest =
    fetchServiceJSON(
      env.MATCHER,
      `/match?home=${encodeURIComponent(
        signalHome(
          signal
        )
      )}&away=${encodeURIComponent(
        signalAway(
          signal
        )
      )}`
    );

  let matcherData:
    AnyObj = {};

  try {
    matcherData =
      await matcherRequest;
  } catch (
    error
  ) {
    return {
      status:
        "MATCHER_ERROR",
      signal_match_id:
        signalMatchId(
          signal
        ),
      match:
        signalMatchName(
          signal
        ),
      error:
        error instanceof
        Error
          ? error.message
          : String(
              error
            )
    };
  }

  const matcher =
    findBestMatcherCandidate(
      signal,
      matcherData
    );

  let selectedCloudbet:
    AnyObj | null =
    null;

  if (
    matcher?.accepted &&
    matcher?.cloudbet
  ) {
    selectedCloudbet =
      matcher.cloudbet;
  }

  if (
    !selectedCloudbet
  ) {
    const direct =
      findDirectCloudbet(
        signal,
        cloudbetLive
      );

    if (
      direct?.accepted
    ) {
      selectedCloudbet =
        direct.cloudbet;
    }
  }

  if (
    !selectedCloudbet
  ) {
    return {
      status:
        "CLOUDBET_MATCH_NOT_FOUND",

      signal_match_id:
        signalMatchId(
          signal
        ),

      match:
        signalMatchName(
          signal
        ),

      matcher,

      cloudbet_live_count:
        cloudbetLive.length
    };
  }

  const rawCloudbet =
    selectedCloudbet?.raw ??
    selectedCloudbet;

  const market =
    findTargetMarket(
      rawCloudbet
    );

  const odds =
    extractOdds(
      rawCloudbet
    );

  const prepared =
    buildPreparedBet(
      signal,
      matcher,
      {
        ...selectedCloudbet,
        market
      },
      odds
    );

  return {
    status:
      "MATCHED",

    prepared,

    candidate:
      buildDryRunCandidate(
        prepared
      ),

    matcher,

    cloudbet:
      selectedCloudbet,

    market_found:
      !!market,

    odds,

    odds_available:
      odds !== null
  };
    }
// ============================================================
// MATCH STATE
// ============================================================

function extractNumber(
  value: any
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

function extractScorePair(
  match: AnyObj
): {
  home: number | null;
  away: number | null;
} {
  const pairs = [
    [
      match?.home_score,
      match?.away_score
    ],
    [
      match?.homeScore,
      match?.awayScore
    ],
    [
      match?.score?.home,
      match?.score?.away
    ],
    [
      match?.score?.home_score,
      match?.score?.away_score
    ],
    [
      match?.scores?.home,
      match?.scores?.away
    ],
    [
      match?.scores?.home_score,
      match?.scores?.away_score
    ],
    [
      match?.result?.home,
      match?.result?.away
    ],
    [
      match?.result?.home_score,
      match?.result?.away_score
    ],
    [
      match?.home?.score,
      match?.away?.score
    ],
    [
      match?.homeTeam?.score,
      match?.awayTeam?.score
    ]
  ];

  for (
    const pair of pairs
  ) {
    const home =
      extractNumber(
        pair[0]
      );

    const away =
      extractNumber(
        pair[1]
      );

    if (
      home !== null &&
      away !== null
    ) {
      return {
        home,
        away
      };
    }
  }

  const text =
    safeString(
      match?.score ??
      match?.result ??
      match?.current_score
    );

  const scoreMatch =
    text.match(
      /(\d+)\s*[-:]\s*(\d+)/
    );

  if (scoreMatch) {
    return {
      home:
        Number(
          scoreMatch[1]
        ),
      away:
        Number(
          scoreMatch[2]
        )
    };
  }

  return {
    home: null,
    away: null
  };
}

function hasGoal(
  match: AnyObj
): boolean {
  const score =
    extractScorePair(
      match
    );

  if (
    score.home !== null &&
    score.away !== null
  ) {
    return (
      score.home > 0 ||
      score.away > 0
    );
  }

  const text =
    normalizeText(
      [
        match?.score,
        match?.result,
        match?.status_text,
        match?.event_status
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
  match: AnyObj
): number | null {
  const values = [
    match?.minute,
    match?.match_minute,
    match?.matchMinute,
    match?.clock?.minute,
    match?.time?.minute,
    match?.game_time,
    match?.elapsed
  ];

  for (
    const value of values
  ) {
    const number =
      extractNumber(
        value
      );

    if (
      number !== null
    ) {
      return number;
    }

    const minuteMatch =
      safeString(
        value
      ).match(
        /(\d{1,3})/
      );

    if (
      minuteMatch
    ) {
      return Number(
        minuteMatch[1]
      );
    }
  }

  return null;
}

function isFirstHalf(
  match: AnyObj
): boolean {
  if (
    hasGoal(match)
  ) {
    return false;
  }

  const period =
    normalizeText(
      match?.period ??
      match?.match_period ??
      match?.phase ??
      match?.state ??
      match?.status ??
      ""
    );

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
    extractMinute(
      match
    );

  return (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
  );
}

function pendingIsStillValid(
  cloudbet: AnyObj
): {
  valid: boolean;
  reason: string;
} {
  if (!cloudbet) {
    return {
      valid: false,
      reason:
        "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  if (
    !isCloudbetLive(
      cloudbet
    )
  ) {
    return {
      valid: false,
      reason:
        "CLOUDBET_NO_LONGER_LIVE"
    };
  }

  if (
    hasGoal(
      cloudbet
    )
  ) {
    return {
      valid: false,
      reason:
        "GOAL_ALREADY_SCORED"
    };
  }

  if (
    !isFirstHalf(
      cloudbet
    )
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
// ARCHIVE
// ============================================================

function archiveKey(
  bet: AnyObj
): string {
  const signalId =
    safeString(
      bet?.signal_match_id
    );

  if (signalId) {
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

async function archivePreparedBets(
  env: Env,
  bets: AnyObj[]
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      inserted: 0,
      skipped:
        bets.length,
      error:
        "DB_BINDING_MISSING"
    };
  }

  if (!bets.length) {
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
    const matcherScore =
      Number(
        bet?.matcher
          ?.matcher_score ??
        bet?.matcher_score ??
        0
      );

    const entryMinute =
      Number(
        bet?.entry_minute ??
        bet?.minute ??
        bet?.signal?.minute ??
        null
      );

    const hunterScore =
      Number(
        bet?.hunter_score ??
        bet?.signal?.hunter_score ??
        bet?.signal?.v27?.hunter_score ??
        bet?.signal?.score ??
        null
      );

    const cloudbetCombinedScore =
      Number(
        bet?.cloudbet_combined_score ??
        bet?.matcher
          ?.cloudbet_combined_score ??
        null
      );

    const direction =
      safeString(
        bet?.direction ??
        bet?.matcher?.direction
      ) || null;

    const matcherSource =
      safeString(
        bet?.matcher_source ??
        bet?.matcher?.source
      ) ||
      "MATCHER";

    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO hunter_bet_archive
        (
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
        VALUES
        (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
        )
      `).bind(
        archiveKey(
          bet
        ),

        safeString(
          bet?.signal_match_id
        ) || null,

        safeString(
          bet?.match
        ) || null,

        safeString(
          bet?.v27?.home ??
          bet?.home ??
          bet?.cloudbet?.home
        ) || null,

        safeString(
          bet?.v27?.away ??
          bet?.away ??
          bet?.cloudbet?.away
        ) || null,

        Number.isFinite(
          entryMinute
        )
          ? entryMinute
          : null,

        Number.isFinite(
          hunterScore
        )
          ? hunterScore
          : null,

        getCloudbetId(
          bet
        ) || null,

        safeString(
          bet?.cloudbet_match ??
          bet?.cloudbet?.match ??
          bet?.match
        ) || null,

        matcherSource,

        Number.isFinite(
          matcherScore
        )
          ? matcherScore
          : null,

        Number.isFinite(
          cloudbetCombinedScore
        )
          ? cloudbetCombinedScore
          : null,

        direction
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
  } catch (error) {
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

async function savePendingOdds(
  env: Env,
  bet: AnyObj
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      error:
        "DB_BINDING_MISSING"
    };
  }

  const archive =
    archiveKey(bet);

  const signalId =
    safeString(
      bet?.signal_match_id
    );

  const cloudbetId =
    getCloudbetId(
      bet
    );

  if (!cloudbetId) {
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

  let payload =
    "{}";

  try {
    payload =
      JSON.stringify(
        bet
      );
  } catch {
    payload =
      "{}";
  }

  try {
    await env.DB.prepare(`
      INSERT INTO pending_odds
      (
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
        missing_count,
        last_checked_at,
        next_check_at,
        payload_json,
        created_at,
        updated_at
      )
      VALUES
      (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'PENDING_ODDS',
        0,
        0,
        NULL,
        datetime('now', '+1 minute'),
        ?,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(archive_key)
      DO UPDATE SET
        cloudbet_id = excluded.cloudbet_id,
        signal_match_id = excluded.signal_match_id,
        match = excluded.match,
        home = excluded.home,
        away = excluded.away,
        entry_minute = excluded.entry_minute,
        market = excluded.market,
        selection = excluded.selection,
        stake_eur = excluded.stake_eur,
        mode = excluded.mode,
        payload_json = excluded.payload_json,
        status = 'PENDING_ODDS',
        retry_count = pending_odds.retry_count,
        missing_count = 0,
        updated_at = datetime('now'),
        next_check_at = datetime('now', '+1 minute')
    `).bind(
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
      MODE,
      payload
    ).run();

    return {
      success: true,
      status:
        "PENDING_ODDS",
      archive_key:
        archive,
      cloudbet_id:
        cloudbetId
    };
  } catch (error) {
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
  id: number
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
  id: number
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
      ORDER BY created_at ASC
    `).all();

  return (
    result.results ??
    []
  ) as AnyObj[];
}

async function reschedulePending(
  env: Env,
  id: number,
  retryCount: number,
  missingCount: number
): Promise<void> {
  await env.DB.prepare(`
    UPDATE pending_odds
    SET
      retry_count = ?,
      missing_count = ?,
      last_checked_at = datetime('now'),
      next_check_at = datetime('now', '+1 minute'),
      updated_at = datetime('now')
    WHERE id = ?
  `)
    .bind(
      retryCount,
      missingCount,
      id
    )
    .run();
}

// ============================================================
// PENDING CRON
// ============================================================

async function processPendingOdds(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  const diagnostics:
    AnyObj = {
      success: true,
      version:
        VERSION,
      action:
        "PENDING_ODDS_CRON",
      pending_loaded: 0,
      checked: 0,
      odds_found: 0,
      invalidated: 0,
      still_pending: 0,
      errors: 0,
      details: []
    };

  if (!env.DB) {
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
  } catch (error) {
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
    !pendingRows.length
  ) {
    diagnostics.elapsed_ms =
      Date.now() -
      started;

    return diagnostics;
  }

  let rawData:
    AnyObj;

  try {
    rawData =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      );
  } catch (error) {
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

  for (
    const row of pendingRows
  ) {
    diagnostics.checked++;

    const rowId =
      Number(
        row?.id
      );

    const cloudbetId =
      safeString(
        row?.cloudbet_id
      );

    if (
      !Number.isInteger(
        rowId
      )
    ) {
      diagnostics.errors++;
      continue;
    }

    if (!cloudbetId) {
      await invalidatePending(
        env,
        rowId
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id: rowId,
        status:
          "INVALIDATED",
        reason:
          "CLOUDBET_ID_MISSING"
      });

      continue;
    }

    const cloudbet =
      byId.get(
        cloudbetId
      );

    if (!cloudbet) {
      const missingCount =
        Number(
          row?.missing_count ??
          0
        ) + 1;

      if (
        missingCount >
        MAX_MISSING_CHECKS
      ) {
        await invalidatePending(
          env,
          rowId
        );

        diagnostics.invalidated++;

        diagnostics.details.push({
          id: rowId,
          cloudbet_id:
            cloudbetId,
          status:
            "INVALIDATED",
          reason:
            "CLOUDBET_EVENT_NOT_FOUND",
          missing_count:
            missingCount
        });

        continue;
      }

      await reschedulePending(
        env,
        rowId,
        Number(
          row?.retry_count ??
          0
        ),
        missingCount
      );

      diagnostics.still_pending++;

      diagnostics.details.push({
        id: rowId,
        cloudbet_id:
          cloudbetId,
        status:
          "PENDING_ODDS",
        reason:
          "CLOUDBET_EVENT_TEMPORARILY_MISSING",
        missing_count:
          missingCount
      });

      continue;
    }

    const previousMissing =
      Number(
        row?.missing_count ??
        0
      );

    if (
      previousMissing >
      0
    ) {
      await env.DB.prepare(`
        UPDATE pending_odds
        SET
          missing_count = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `)
        .bind(rowId)
        .run();
    }

    const validity =
      pendingIsStillValid(
        cloudbet
      );

    if (
      !validity.valid
    ) {
      await invalidatePending(
        env,
        rowId
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id: rowId,
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
        cloudbet
      );

    if (
      odds === null
    ) {
      const retryCount =
        Number(
          row?.retry_count ??
          0
        ) + 1;

      await reschedulePending(
        env,
        rowId,
        retryCount,
        0
      );

      diagnostics.still_pending++;

      diagnostics.details.push({
        id: rowId,
        cloudbet_id:
          cloudbetId,
        status:
          "PENDING_ODDS",
        odds: null,
        retry_count:
          retryCount,
        missing_count:
          0
      });

      continue;
    }

    let bet:
      AnyObj = {};

    const payloadText =
      safeString(
        row?.payload_json
      );

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

    if (
      !bet ||
      typeof bet !==
        "object"
    ) {
      bet = {};
    }

    bet.cloudbet = {
      ...(bet.cloudbet ??
        {}),
      ...cloudbet,

      id:
        cloudbetId,

      odds,

      odds_available:
        true,

      odds_source:
        "CLOUDBET_FIRST_HALF_TOTAL_GOALS"
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
      displayMatch(
        cloudbet
      );

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

    const archive =
      await archivePreparedBets(
        env,
        [bet]
      );

    await deletePending(
      env,
      rowId
    );

    diagnostics.odds_found++;

    diagnostics.details.push({
      id: rowId,
      cloudbet_id:
        cloudbetId,
      status:
        "READY",
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
        cloudbet =>
          extractMatchId(
            cloudbet
          ) ===
          matcherCloudbetId
      );

    if (
      byId
    ) {
      const score =
        twoSidedTeamScore(
          signalHome(
            signal
          ),
          signalAway(
            signal
          ),
          extractHome(
            byId
          ),
          extractAway(
            byId
          )
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
    findCloudbetRawJsonPresence(
      signal,
      rawData
    );

  if (
    raw.found &&
    raw.cloudbet
  ) {
    const cloudbet =
      raw.cloudbet;

    const score =
      twoSidedTeamScore(
        signalHome(
          signal
        ),
        signalAway(
          signal
        ),
        extractHome(
          cloudbet
        ),
        extractAway(
          cloudbet
        )
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
        cloudbet,
        cloudbet_id:
          extractMatchId(
            cloudbet
          ),
        team_scores:
          score,
        cloudbet_live:
          isCloudbetLive(
            cloudbet
          )
      };
    }
  }

  return {
    verified: false,
    source:
      "NOT_VERIFIED",
    cloudbet: null,
    cloudbet_id: null
  };
        }
function buildVerifiedBet(
  signal: AnyObj,
  matcher: AnyObj,
  verification: AnyObj
): AnyObj {
  const cloudbet =
    verification?.cloudbet ??
    null;

  const cloudbetId =
    safeString(
      verification?.cloudbet_id ??
      extractMatchId(
        cloudbet ??
        {}
      )
    );

  const matcherScore =
    Number(
      matcher?.matcher_score ??
      matcher?.score ??
      0
    );

  const cloudbetCombinedScore =
    Number(
      matcher?.cloudbet_combined_score ??
      verification?.team_scores?.combined_score ??
      0
    );

  const direction =
    safeString(
      matcher?.direction ??
      verification?.direction
    ) || null;

  const entryMinute =
    Number(
      signal?.entry_minute ??
      signal?.minute ??
      signal?.v27?.minute ??
      null
    );

  const hunterScore =
    Number(
      signal?.hunter_score ??
      signal?.v27?.hunter_score ??
      signal?.score ??
      null
    );

  const match =
    safeString(
      signal?.match ??
      signal?.league_match
    ) ||
    `${signalHome(signal)} - ${signalAway(signal)}`;

  return {
    archive_key:
      archiveKey(
        signal
      ),

    signal_match_id:
      safeString(
        signal?.match_id ??
        signal?.v27?.id
      ),

    match,

    home:
      signalHome(
        signal
      ),

    away:
      signalAway(
        signal
      ),

    entry_minute:
      entryMinute,

    hunter_score:
      hunterScore,

    cloudbet_id:
      cloudbetId,

    cloudbet_match:
      cloudbet
        ? displayMatch(
            cloudbet
          )
        : match,

    matcher_source:
      safeString(
        verification?.source
      ) ||
      "MATCHER",

    matcher_score:
      matcherScore,

    cloudbet_combined_score:
      cloudbetCombinedScore,

    direction,

    matcher,

    cloudbet,

    signal
  };
}

function buildFinalCandidate(
  bet: AnyObj
): AnyObj {
  const odds =
    extractOdds(
      bet?.cloudbet
    );

  const oddsAvailable =
    odds !== null;

  return {
    ...bet,

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
      oddsAvailable
        ? "DRY_RUN_READY"
        : "WAITING_FOR_ODDS",

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    odds,

    odds_available:
      oddsAvailable,

    stake_eur:
      BET_STAKE_EUR
  };
}

// ============================================================
// MAIN SIGNAL PROCESSING
// ============================================================

async function processHunterSignal(
  env: Env,
  signal: AnyObj,
  liveMatches: AnyObj[],
  rawData: AnyObj
): Promise<AnyObj> {
  const result:
    AnyObj = {
      signal_match_id:
        signal?.match_id ??
        null,

      match:
        signal?.match ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.v27?.hunter_score ??
        signal?.score ??
        null,

      matcher:
        null,

      verification:
        null,

      candidate:
        null,

      pending:
        false,

      archived:
        false,

      error:
        null
    };

  try {
    const matcher =
      await runMatcher(
        env,
        signal
      );

    result.matcher =
      matcher;

    if (
      !matcher?.matched
    ) {
      result.status =
        "MATCHER_NO_MATCH";

      return result;
    }

    const verification =
      await verifyCloudbet(
        signal,
        matcher,
        liveMatches,
        rawData
      );

    result.verification =
      verification;

    if (
      !verification?.verified
    ) {
      result.status =
        "CLOUDBET_NOT_VERIFIED";

      return result;
    }

    const bet =
      buildVerifiedBet(
        signal,
        matcher,
        verification
      );

    const candidate =
      buildFinalCandidate(
        bet
      );

    result.candidate =
      candidate;

    if (
      candidate?.odds_available
    ) {
      const archive =
        await archivePreparedBets(
          env,
          [candidate]
        );

      result.archived =
        archive?.inserted ??
        false;

      result.archive =
        archive;

      result.status =
        "READY";

      return result;
    }

    await savePendingOdds(
      env,
      candidate
    );

    result.pending =
      true;

    result.status =
      "PENDING_ODDS";

    return result;
  } catch (error) {
    result.status =
      "ERROR";

    result.error =
      error instanceof Error
        ? error.message
        : String(error);

    return result;
  }
}

// ============================================================
// LOAD HUNTER SIGNALS
// ============================================================

async function loadHunterSignals(
  env: Env
): Promise<AnyObj[]> {
  const result =
    await env.DB.prepare(`
      SELECT *
      FROM hunter_signals
      WHERE status = 'TRACKING'
      ORDER BY id ASC
    `).all();

  return (
    result.results ??
    []
  ) as AnyObj[];
}

// ============================================================
// UPDATE SIGNAL STATUS
// ============================================================

async function updateSignalStatus(
  env: Env,
  signalId: number,
  status: string,
  result: string | null = null
): Promise<void> {
  await env.DB.prepare(`
    UPDATE hunter_signals
    SET
      status = ?,
      result = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `)
    .bind(
      status,
      result,
      signalId
    )
    .run();
}

// ============================================================
// MATCH CURRENT LIVE MATCH TO SIGNAL
// ============================================================

function signalIsCurrent(
  signal: AnyObj,
  liveMatches: AnyObj[]
): boolean {
  const signalMatchId =
    safeString(
      signal?.match_id
    );

  const signalHomeName =
    signalHome(
      signal
    );

  const signalAwayName =
    signalAway(
      signal
    );

  for (
    const match of liveMatches
  ) {
    const cloudbetId =
      extractMatchId(
        match
      );

    if (
      signalMatchId &&
      cloudbetId &&
      signalMatchId ===
        cloudbetId
    ) {
      return true;
    }

    const score =
      twoSidedTeamScore(
        signalHomeName,
        signalAwayName,
        extractHome(
          match
        ),
        extractAway(
          match
        )
      );

    if (
      score.matched
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// ARCHIVE ENDPOINT
// ============================================================

async function handleArchive(
  env: Env,
  request: Request
): Promise<Response> {
  const url =
    new URL(
      request.url
    );

  const limit =
    Math.min(
      Math.max(
        Number(
          url.searchParams.get(
            "limit"
          ) ??
          50
        ) || 50,
        1
      ),
      500
    );

  const rows =
    await env.DB.prepare(`
      SELECT
        id,
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
      FROM hunter_bet_archive
      ORDER BY id DESC
      LIMIT ?
    `)
      .bind(limit)
      .all();

  const count =
    await env.DB.prepare(`
      SELECT COUNT(*) AS count
      FROM hunter_bet_archive
    `).first();

  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    archive_count:
      Number(
        count?.count ??
        0
      ),

    limit,

    rows:
      rows.results ??
      []
  });
}

// ============================================================
// PENDING ENDPOINT
// ============================================================

async function handlePending(
  env: Env
): Promise<Response> {
  const rows =
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
        updated_at,
        missing_count
      FROM pending_odds
      WHERE status = 'PENDING_ODDS'
      ORDER BY id DESC
    `).all();

  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    pending_count:
      rows.results?.length ??
      0,

    rows:
      rows.results ??
      []
  });
}

// ============================================================
// HEALTH
// ============================================================

async function handleHealth(
  env: Env
): Promise<Response> {
  let db =
    false;

  try {
    await env.DB
      .prepare(
        `SELECT 1 AS ok`
      )
      .first();

    db = true;
  } catch {
    db = false;
  }

  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting_enabled:
      BETTING_ENABLED,

    dry_run:
      DRY_RUN,

    bindings: {
      DB:
        db,
      CLOUDBET:
        !!env.CLOUDBET,
      MATCHER:
        !!env.MATCHER,
      TRACKER:
        !!env.TRACKER
    }
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
        return json(
          await runV58(
            env
          )
        );
      } catch (error) {
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
    // PENDING
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
              missing_count,
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
            result.results
              ?.length ??
            0,

          pending:
            result.results ??
            []
        });
      } catch (error) {
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
    // ARCHIVE
    // --------------------------------------------------------

    if (
      url.pathname ===
      "/archive"
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

      return archiveResponse(
        env
      );
    }

    // --------------------------------------------------------
    // NOT FOUND
    // --------------------------------------------------------

    return json(
      {
        success: false,

        error:
          "NOT_FOUND",

        path:
          url.pathname,

        available: [
          "/health",
          "/run",
          "/pending",
          "/archive"
        ]
      },
      404
    );
  },

  // ==========================================================
  // CRON
  // ==========================================================

  async scheduled(
    controller:
      ScheduledController,
    env: Env,
    ctx:
      ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      processPendingOdds(
        env
      )
        .then(
          result => {
            console.log(
              JSON.stringify({
                cron: true,
                version:
                  VERSION,
                ...result
              })
            );
          }
        )
        .catch(
          error => {
            console.error(
              JSON.stringify({
                cron: true,

                version:
                  VERSION,

                success:
                  false,

                error:
                  error instanceof Error
                    ? error.message
                    : String(error)
              })
            );
          }
        )
    );
  }
};
