// ============================================================
// CLOUDBET BET WORKER V5.8.4
// DRY RUN — PERSISTENT ODDS RETRY
// EXACT 1H TOTAL GOALS OVER 0.5 MARKET
//
// V5.8.4 FIX:
// - /live се използва за live event verification
// - /event?id=EVENT_ID се използва за FULL CLOUDBET EVENT
// - Odds се четат от full event markets/submarkets/selections
// - Pending odds retry също използва /event?id=EVENT_ID
// - Добавена odds диагностика:
//   event -> market -> submarket -> selection -> price
// - TEAM TOTAL markets са изрично отхвърлени
// - hunter_bet_archive schema е запазена
// - Persistent pending odds retry е запазен
// - REAL BETTING DISABLED
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

const VERSION = "V5.8.4";

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
// CLOUDBET FULL EVENT
//
// /live = live list / verification
// /event?id=ID = full event with markets
// ============================================================

async function fetchCloudbetEvent(
  service: Fetcher,
  eventId: string
): Promise<AnyObj> {
  const id =
    safeString(eventId);

  if (
    !id ||
    !/^\d+$/.test(id)
  ) {
    throw new Error(
      `INVALID_CLOUDBET_EVENT_ID: ${id}`
    );
  }

  const response =
    await fetchServiceJSON(
      service,
      `/event?id=${encodeURIComponent(id)}`
    );

  if (
    response?.data &&
    typeof response.data ===
      "object"
  ) {
    return response.data;
  }

  return response;
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

// ============================================================
// ODDS
// EXACT CLOUDBET MARKET
// ============================================================

function isSelectionEnabled(
  selection: AnyObj
): boolean {
  const status =
    safeString(
      selection?.status
    ).toUpperCase();

  if (!status) {
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

function extractSelectionPrice(
  selection: AnyObj
): number | null {
  const price =
    Number(
      selection?.price
    );

  return (
    Number.isFinite(
      price
    ) &&
    price > 1
  )
    ? price
    : null;
}

// ============================================================
// MARKET EXTRACTION
// Supports:
// 1. markets: []
// 2. markets: {}
// 3. direct soccer.* keys on event
// ============================================================

function extractMarketEntries(
  match: AnyObj
): AnyObj[] {
  const result:
    AnyObj[] =
    [];

  if (
    !match ||
    typeof match !==
      "object"
  ) {
    return result;
  }

  const addMarket = (
    value: any,
    key = ""
  ) => {
    if (
      !value ||
      typeof value !==
        "object"
    ) {
      return;
    }

    result.push({
      ...(value as AnyObj),

      _market_key:
        safeString(
          key ||
          value?.marketKey ||
          value?.key ||
          value?.market
        )
    });
  };

  const markets =
    match?.markets;

  if (
    Array.isArray(
      markets
    )
  ) {
    for (
      const market of markets
    ) {
      addMarket(
        market
      );
    }
  } else if (
    markets &&
    typeof markets ===
      "object"
  ) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        markets
      )
    ) {
      addMarket(
        value,
        key
      );
    }
  }

  for (
    const [
      key,
      value
    ] of Object.entries(
      match
    )
  ) {
    if (
      key === "markets" ||
      !value ||
      typeof value !==
        "object" ||
      Array.isArray(value)
    ) {
      continue;
    }

    if (
      key.startsWith(
        "soccer."
      )
    ) {
      addMarket(
        value,
        key
      );
    }
  }

  return result;
}

function extractSubmarketEntries(
  market: AnyObj
): AnyObj[] {
  const result:
    AnyObj[] =
    [];

  const raw =
    market?.submarkets;

  if (
    Array.isArray(raw)
  ) {
    for (
      const item of raw
    ) {
      if (
        item &&
        typeof item ===
          "object"
      ) {
        result.push({
          ...(item as AnyObj),

          _submarket_key:
            safeString(
              item?._submarket_key ??
              item?.submarketKey ??
              item?.key
            )
        });
      }
    }

    return result;
  }

  if (
    raw &&
    typeof raw ===
      "object"
  ) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        raw
      )
    ) {
      if (
        !value ||
        typeof value !==
          "object"
      ) {
        continue;
      }

      result.push({
        ...(value as AnyObj),

        _submarket_key:
          key
      });
    }
  }

  return result;
}

function isTargetFirstHalfSubmarket(
  key: string
): boolean {
  const normalized =
    safeString(
      key
    ).toLowerCase();

  if (
    normalized ===
    TARGET_SUBMARKET_KEY
  ) {
    return true;
  }

  if (
    normalized.includes(
      "period=1h"
    ) &&
    !normalized.includes(
      "team="
    )
  ) {
    return true;
  }

  return false;
}

function isTargetOver05Selection(
  selection: AnyObj
): boolean {
  const outcome =
    safeString(
      selection?.outcome
    ).toLowerCase();

  if (
    outcome !==
    TARGET_OUTCOME_KEY
  ) {
    return false;
  }

  const params =
    safeString(
      selection?.params
    ).toLowerCase();

  if (
    params ===
    TARGET_PARAMS
  ) {
    return true;
  }

  const marketUrl =
    safeString(
      selection?.marketUrl
    ).toLowerCase();

  return (
    marketUrl ===
    TARGET_MARKET_URL
  );
}

// ============================================================
// EXACT ODDS EXTRACTION
// ============================================================

function extractFirstHalfOver05Odds(
  match: AnyObj
): number | null {
  if (
    !match ||
    typeof match !==
      "object"
  ) {
    return null;
  }

  const markets =
    extractMarketEntries(
      match
    );

  for (
    const market of markets
  ) {
    const marketKey =
      safeString(
        market?._market_key ??
        market?.marketKey ??
        market?.key ??
        market?.market
      );

    if (
      marketKey !==
      TARGET_MARKET_KEY
    ) {
      continue;
    }

    const submarkets =
      extractSubmarketEntries(
        market
      );

    for (
      const submarket of
      submarkets
    ) {
      const submarketKey =
        safeString(
          submarket?._submarket_key ??
          submarket?.submarketKey ??
          submarket?.key
        );

      if (
        !isTargetFirstHalfSubmarket(
          submarketKey
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

        if (
          !isTargetOver05Selection(
            selection
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
          price === null
        ) {
          continue;
        }

        const maxStake =
          Number(
            selection?.maxStake
          );

        if (
          Number.isFinite(
            maxStake
          ) &&
          maxStake <= 0
        ) {
          continue;
        }

        return price;
      }
    }
  }

  return null;
}

// ============================================================
// STRICT ODDS FALLBACK
// ============================================================

function extractOddsRecursive(
  root: any
): number | null {
  const visited =
    new Set<any>();

  function walk(
    node: any,
    context: string,
    marketKeyContext = "",
    submarketKeyContext = ""
  ): number | null {
    if (
      node === null ||
      node === undefined ||
      typeof node !==
        "object" ||
      visited.has(node)
    ) {
      return null;
    }

    visited.add(node);

    const currentMarketKey =
      safeString(
        node?.marketKey ??
        node?.market ??
        node?.key ??
        marketKeyContext
      );

    const currentSubmarketKey =
      safeString(
        node?.submarketKey ??
        submarketKeyContext
      );

    const currentContext = [
      context,
      currentMarketKey,
      currentSubmarketKey,
      node?.marketUrl,
      node?.url,
      node?.name,
      node?.outcome,
      node?.selection,
      node?.side,
      node?.params
    ]
      .map(
        normalizeText
      )
      .join(" ");

    const outcome =
      safeString(
        node?.outcome
      ).toLowerCase();

    const params =
      safeString(
        node?.params
      ).toLowerCase();

    const marketUrl =
      safeString(
        node?.marketUrl
      );

    const exactMarket =
      currentMarketKey ===
      TARGET_MARKET_KEY;

    const exactSubmarket =
      currentSubmarketKey ===
        TARGET_SUBMARKET_KEY ||
      (
        currentContext.includes(
          "period 1h"
        ) &&
        !currentContext.includes(
          "team="
        )
      );

    const exactOutcome =
      outcome ===
      TARGET_OUTCOME_KEY;

    const exactParams =
      params ===
      TARGET_PARAMS;

    const exactUrl =
      marketUrl ===
      TARGET_MARKET_URL;

    if (
      node?.price !==
        undefined &&
      exactMarket &&
      exactSubmarket &&
      exactOutcome &&
      exactParams &&
      isSelectionEnabled(
        node
      )
    ) {
      const price =
        extractSelectionPrice(
          node
        );

      const maxStake =
        Number(
          node?.maxStake
        );

      if (
        price !== null &&
        (
          !Number.isFinite(
            maxStake
          ) ||
          maxStake > 0
        )
      ) {
        return price;
      }
    }

    if (
      node?.price !==
        undefined &&
      exactUrl &&
      isSelectionEnabled(
        node
      )
    ) {
      const price =
        extractSelectionPrice(
          node
        );

      const maxStake =
        Number(
          node?.maxStake
        );

      if (
        price !== null &&
        (
          !Number.isFinite(
            maxStake
          ) ||
          maxStake > 0
        )
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
            currentContext,
            currentMarketKey,
            currentSubmarketKey
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
      const [
        key,
        child
      ] of Object.entries(
        node
      )
    ) {
      if (
        !child ||
        typeof child !==
          "object"
      ) {
        continue;
      }

      const normalizedKey =
        normalizeText(
          key
        );

      let nextMarketKey =
        currentMarketKey;

      let nextSubmarketKey =
        currentSubmarketKey;

      if (
        key.startsWith(
          "soccer."
        )
      ) {
        nextMarketKey =
          key;
      }

      if (
        key.startsWith(
          "period="
        )
      ) {
        nextSubmarketKey =
          key;
      }

      const found =
        walk(
          child,
          `${currentContext} ${normalizedKey}`,
          nextMarketKey,
          nextSubmarketKey
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

function extractOdds(
  match: AnyObj
): number | null {
  const exact =
    extractFirstHalfOver05Odds(
      match
    );

  if (
    exact !== null
  ) {
    return exact;
  }

  return extractOddsRecursive(
    match
  );
}

// ============================================================
// ODDS DIAGNOSTIC
// ============================================================

function buildOddsDiagnostic(
  match: AnyObj
): AnyObj {
  const markets =
    extractMarketEntries(
      match
    );

  const marketKeys =
    markets
      .map(
        market =>
          safeString(
            market?._market_key ??
            market?.marketKey ??
            market?.key ??
            market?.market
          )
      )
      .filter(Boolean);

  const uniqueMarketKeys =
    Array.from(
      new Set(
        marketKeys
      )
    );

  const targetMarkets =
    markets.filter(
      market =>
        safeString(
          market?._market_key ??
          market?.marketKey ??
          market?.key ??
          market?.market
        ) ===
        TARGET_MARKET_KEY
    );

  const targetSubmarkets:
    AnyObj[] =
    [];

  let targetSubmarketFound =
    false;

  let targetSelectionFound =
    false;

  let targetPrice:
    number | null = null;

  for (
    const market of
    targetMarkets
  ) {
    const submarkets =
      extractSubmarketEntries(
        market
      );

    for (
      const submarket of
      submarkets
    ) {
      const submarketKey =
        safeString(
          submarket?._submarket_key ??
          submarket?.submarketKey ??
          submarket?.key
        );

      const targetSubmarket =
        isTargetFirstHalfSubmarket(
          submarketKey
        );

      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];

      const selectionInfo:
        AnyObj[] =
        [];

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

        const outcome =
          safeString(
            selection?.outcome
          ).toLowerCase();

        const params =
          safeString(
            selection?.params
          ).toLowerCase();

        const marketUrl =
          safeString(
            selection?.marketUrl
          );

        const price =
          extractSelectionPrice(
            selection
          );

        const targetOutcome =
          outcome ===
          TARGET_OUTCOME_KEY;

        const targetParams =
          params ===
          TARGET_PARAMS;

        const targetUrl =
          marketUrl.toLowerCase() ===
          TARGET_MARKET_URL;

        const targetSelection =
          targetSubmarket &&
          targetOutcome &&
          (
            targetParams ||
            targetUrl
          );

        if (
          targetSelection
        ) {
          targetSelectionFound =
            true;

          if (
            price !== null
          ) {
            targetPrice =
              price;
          }
        }

        selectionInfo.push({
          outcome:
            outcome || null,

          params:
            params || null,

          marketUrl:
            marketUrl || null,

          price:
            price,

          raw_price:
            selection?.price ??
            null,

          status:
            safeString(
              selection?.status
            ) || null,

          maxStake:
            selection?.maxStake ??
            null,

          enabled:
            isSelectionEnabled(
              selection
            ),

          target:
            targetSelection
        });
      }

      if (
        targetSubmarket
      ) {
        targetSubmarketFound =
          true;
      }

      targetSubmarkets.push({
        key:
          submarketKey ||
          null,

        target:
          targetSubmarket,

        selections:
          selectionInfo
      });
    }
  }

  const hasMarkets =
    Array.isArray(
      match?.markets
    ) ||
    (
      match?.markets &&
      typeof match.markets ===
        "object"
    ) ||
    markets.length > 0;

  return {
    cloudbet_id:
      extractMatchId(
        match
      ),

    has_markets:
      hasMarkets,

    markets_type:
      Array.isArray(
        match?.markets
      )
        ? "array"
        : (
            match?.markets &&
            typeof match.markets ===
              "object"
          )
          ? "object"
          : markets.length
              ? "derived"
              : "missing",

    market_count:
      markets.length,

    market_keys:
      uniqueMarketKeys.slice(
        0,
        100
      ),

    target_market:
      TARGET_MARKET_KEY,

    target_market_found:
      targetMarkets.length >
      0,

    target_submarket:
      TARGET_SUBMARKET_KEY,

    target_submarket_found:
      targetSubmarketFound,

    target_selection:
      `${TARGET_OUTCOME_KEY}?${TARGET_PARAMS}`,

    target_selection_found:
      targetSelectionFound,

    target_price:
      targetPrice,

    target_submarkets:
      targetSubmarkets
  };
}

// ============================================================
// RESOLVE FULL EVENT FOR ODDS
// ============================================================

async function resolveCloudbetOddsEvent(
  env: Env,
  cloudbet: AnyObj
): Promise<AnyObj> {
  const cloudbetId =
    extractMatchId(
      cloudbet
    );

  if (!cloudbetId) {
    return {
      event:
        cloudbet,

      source:
        "LIVE_EVENT_FALLBACK",

      success:
        false,

      error:
        "CLOUDBET_EVENT_ID_MISSING",

      diagnostic:
        buildOddsDiagnostic(
          cloudbet
        )
    };
  }

  try {
    const fullEvent =
      await fetchCloudbetEvent(
        env.CLOUDBET,
        cloudbetId
      );

    const event =
      fullEvent &&
      typeof fullEvent ===
        "object"
        ? fullEvent
        : cloudbet;

    return {
      event,

      source:
        "CLOUDBET_FULL_EVENT",

      success:
        true,

      error:
        null,

      diagnostic:
        buildOddsDiagnostic(
          event
        )
    };
  } catch (error) {
    return {
      event:
        cloudbet,

      source:
        "LIVE_EVENT_FALLBACK",

      success:
        false,

      error:
        error instanceof Error
          ? error.message
          : String(error),

      diagnostic:
        buildOddsDiagnostic(
          cloudbet
        )
    };
  }
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
    "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS";

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

    if (id) {
      map.set(
        id,
        match
      );
    }
  }

  return map;
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

// ============================================================
// ARCHIVE INSERT
// REAL hunter_bet_archive SCHEMA
// ============================================================

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
        bet?.signal
          ?.hunter_score ??
        bet?.signal
          ?.v27
          ?.hunter_score ??
        bet?.signal
          ?.score ??
        null
      );

    const cloudbetCombinedScore =
      Number(
        bet?.cloudbet_combined_score ??
        bet?.matcher
          ?.cloudbet_combined_score ??
        bet?.matcher
          ?.team_scores
          ?.combined_score ??
        null
      );

    const direction =
      safeString(
        bet?.direction ??
        bet?.matcher
          ?.direction
      ) || null;

    const matcherSource =
      safeString(
        bet?.matcher_source ??
        bet?.matcher?.source
      ) || "MATCHER";

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
        cloudbet_id =
          excluded.cloudbet_id,

        signal_match_id =
          excluded.signal_match_id,

        match =
          excluded.match,

        home =
          excluded.home,

        away =
          excluded.away,

        entry_minute =
          excluded.entry_minute,

        market =
          excluded.market,

        selection =
          excluded.selection,

        stake_eur =
          excluded.stake_eur,

        mode =
          excluded.mode,

        payload_json =
          excluded.payload_json,

        status =
          'PENDING_ODDS',

        retry_count =
          pending_odds.retry_count,

        missing_count =
          0,

        updated_at =
          datetime('now'),

        next_check_at =
          datetime('now', '+1 minute')
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

    // --------------------------------------------------------
    // /live is ONLY used to verify that the event is still live.
    // --------------------------------------------------------

    const liveCloudbet =
      byId.get(
        cloudbetId
      );

    if (!liveCloudbet) {
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

    // --------------------------------------------------------
    // Validate using LIVE event.
    // --------------------------------------------------------

    const validity =
      pendingIsStillValid(
        liveCloudbet
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

    // --------------------------------------------------------
    // IMPORTANT V5.8.4:
    // Fetch FULL EVENT for odds.
    // --------------------------------------------------------

    const oddsResolution =
      await resolveCloudbetOddsEvent(
        env,
        liveCloudbet
      );

    const oddsEvent =
      oddsResolution.event;

    const oddsDiagnostic =
      oddsResolution.diagnostic;

    const odds =
      extractOdds(
        oddsEvent
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
          0,

        reason:
          "TARGET_1H_TOTAL_GOALS_OVER_0_5_NOT_FOUND",

        full_event_fetch:
          {
            success:
              oddsResolution.success,

            source:
              oddsResolution.source,

            error:
              oddsResolution.error
          },

        odds_diagnostic:
          oddsDiagnostic
      });

      continue;
    }

    // --------------------------------------------------------
    // Rebuild pending bet from stored payload.
    // --------------------------------------------------------

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

      ...oddsEvent,

      id:
        cloudbetId,

      odds,

      odds_available:
        true,

      odds_source:
        "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
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
        oddsEvent
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

    bet.odds_diagnostic =
      oddsDiagnostic;

    bet.full_event_fetch =
      {
        success:
          oddsResolution.success,

        source:
          oddsResolution.source,

        error:
          oddsResolution.error
      };

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

      odds_source:
        "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS",

      odds_diagnostic:
        oddsDiagnostic,

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

// ============================================================
// PREPARED BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  matcherResult: AnyObj,
  verification: AnyObj,
  oddsEvent?: AnyObj,
  oddsDiagnostic?: AnyObj,
  fullEventError?: string | null
): AnyObj {
  const cloudbet =
    oddsEvent ??
    verification?.cloudbet ??
    matcherResult?.cloudbet ??
    {};

  const odds =
    extractOdds(
      cloudbet
    );

  const hunterScore =
    Number(
      signal?.hunter_score ??
      signal?.v27?.hunter_score ??
      signal?.score ??
      null
    );

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

    hunter_score:
      Number.isFinite(
        hunterScore
      )
        ? hunterScore
        : null,

    match:
      signalMatchName(
        signal
      ) ||
      `${signalHome(
        signal
      )} - ${signalAway(
        signal
      )}`,

    v27: {
      id:
        signalMatchId(
          signal
        ),
      home:
        signalHome(
          signal
        ),
      away:
        signalAway(
          signal
        )
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
        null,

      source:
        matcherResult
          ?.source ??
        "MATCHER"
    },

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
        extractHome(
          cloudbet
        ),

      away:
        extractAway(
          cloudbet
        ),

      status:
        cloudbet?.status ??
        null,

      state:
        cloudbet?.state ??
        null,

      live:
        isCloudbetLive(
          cloudbet
        ),

      odds,

      odds_available:
        odds !== null,

      odds_source:
        odds !== null
          ? "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
          : null,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION
    },

    odds_diagnostic:
      oddsDiagnostic ??
      buildOddsDiagnostic(
        cloudbet
      ),

    full_event_fetch: {
      success:
        fullEventError
          ? false
          : !!oddsEvent,

      source:
        oddsEvent
          ? "CLOUDBET_FULL_EVENT"
          : "LIVE_EVENT_FALLBACK",

      error:
        fullEventError ??
        null
    },

    verification: {
      verified:
        verification
          ?.verified ===
        true,

      source:
        verification
          ?.source ??
        null,

      cloudbet_id:
        verification
          ?.cloudbet_id ??
        extractMatchId(
          cloudbet
        ) ??
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
// DRY RUN
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

    bet.cloudbet
      .odds_available =
      true;

    bet.cloudbet
      .odds_source =
      "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS";
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

    hunter_score:
      bet?.hunter_score ??
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

    odds,

    odds_available:
      oddsAvailable,

    candidate_complete:
      oddsAvailable,

    odds_source:
      oddsAvailable
        ? "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
        : null,

    cloudbet:
      bet?.cloudbet ??
      null,

    odds_diagnostic:
      bet?.odds_diagnostic ??
      buildOddsDiagnostic(
        bet?.cloudbet ??
        {}
      ),

    full_event_fetch:
      bet?.full_event_fetch ??
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
// MAIN RUN
// ============================================================

async function runV58(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  // All three external services
  // are called in parallel.
  //
  // /live remains the verification source.
  // Full odds events are fetched below only
  // for verified candidates.

  const [
    trackerData,
    matcherData,
    cloudbetData
  ] =
    await Promise.all([
      fetchServiceJSON(
        env.TRACKER,
        "/entries"
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      )
    ]);

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
    AnyObj[] = [];

  const matcherFailures:
    AnyObj[] = [];

  const verificationFailures:
    AnyObj[] = [];

  const oddsFetchFailures:
    AnyObj[] = [];

  for (
    const signal of
    hunterEntries
  ) {
    // --------------------------------------------------------
    // MATCHER
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // CLOUDBET /live VERIFICATION
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // V5.8.4:
    // GET FULL EVENT BY CLOUDBET EVENT ID
    // --------------------------------------------------------

    const liveCloudbet =
      verification.cloudbet;

    const oddsResolution =
      await resolveCloudbetOddsEvent(
        env,
        liveCloudbet
      );

    const oddsEvent =
      oddsResolution.event;

    const oddsDiagnostic =
      oddsResolution.diagnostic;

    if (
      !oddsResolution.success
    ) {
      oddsFetchFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
            signal
          ),

        cloudbet_id:
          verification.cloudbet_id,

        error:
          oddsResolution.error
      });
    }

    // --------------------------------------------------------
    // Build bet using FULL EVENT.
    // --------------------------------------------------------

    const bet =
      buildPreparedBet(
        signal,
        matcher,
        verification,
        oddsEvent,
        oddsDiagnostic,
        oddsResolution.error
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

  // ==========================================================
  // ODDS CLASSIFICATION
  // ==========================================================

  const completeBets:
    AnyObj[] = [];

  const pendingBets:
    AnyObj[] = [];

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

  // ==========================================================
  // SAVE PENDING ODDS
  // ==========================================================

  const pendingResults:
    AnyObj[] = [];

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

      odds_diagnostic:
        bet?.odds_diagnostic ??
        null,

      full_event_fetch:
        bet?.full_event_fetch ??
        null,

      ...result
    });
  }

  // ==========================================================
  // ARCHIVE COMPLETE BETS
  // ==========================================================

  const archive =
    await archivePreparedBets(
      env,
      completeBets
    );

  // ==========================================================
  // DRY RUN CANDIDATES
  // ==========================================================

  const candidates =
    preparedBets.map(
      buildDryRunCandidate
    );

  const completeCandidates =
    candidates.filter(
      candidate =>
        candidate
          .candidate_complete ===
        true
    );

  const incompleteCandidates =
    candidates.filter(
      candidate =>
        candidate
          .candidate_complete !==
        true
    );

  // ==========================================================
  // RESPONSE
  // ==========================================================

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

      exact_market_key:
        TARGET_MARKET_KEY,

      exact_submarket:
        TARGET_SUBMARKET_KEY,

      exact_outcome:
        TARGET_OUTCOME_KEY,

      exact_params:
        TARGET_PARAMS,

      exact_market_url:
        TARGET_MARKET_URL,

      required_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      live_source:
        "/live",

      odds_source:
        "/event?id=CLOUDBET_EVENT_ID",

      pending_retry:
        "CRON_EVERY_MINUTE",

      max_missing_checks:
        MAX_MISSING_CHECKS
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
        verificationFailures.length,

      full_event_fetch_failures:
        oddsFetchFailures.length
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
          result =>
            result?.success ===
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

    odds_fetch_failures:
      oddsFetchFailures,

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

      exact_market_key:
        TARGET_MARKET_KEY,

      exact_submarket:
        TARGET_SUBMARKET_KEY,

      exact_outcome:
        TARGET_OUTCOME_KEY,

      exact_params:
        TARGET_PARAMS,

      full_event_endpoint:
        "/event?id=EVENT_ID",

      pending_odds:
        true,

      retry:
        "CRON_EVERY_MINUTE",

      max_missing_checks:
        MAX_MISSING_CHECKS
    }
  });
}

// ============================================================
// ARCHIVE HTTP
// READ ONLY
// ============================================================

async function archiveResponse(
  env: Env
): Promise<Response> {
  if (!env.DB) {
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
    const countResult =
      await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM hunter_bet_archive
      `).first();

    const total =
      Number(
        countResult?.total ??
        0
      );

    const result =
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
        LIMIT 200
      `).all();

    const rows =
      result.results ??
      [];

    return json({
      success: true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      status:
        "ARCHIVE",

      table:
        "hunter_bet_archive",

      total,

      returned:
        rows.length,

      archive:
        rows
    });
  } catch (error) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-bet-worker",

        version:
          VERSION,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}

// ============================================================
// PENDING HTTP
// ============================================================

async function pendingResponse(
  env: Env
): Promise<Response> {
  if (!env.DB) {
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
      return pendingResponse(
        env
      );
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
