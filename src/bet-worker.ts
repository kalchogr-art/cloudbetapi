// ============================================================
// CLOUDBET BET WORKER V6.0.6
// DRY RUN · PERSISTENT ODDS RETRY
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V6.0:
// - TRACKER compatibility: derives HOME/AWAY from match_name/match when fields are null
// - MATCHER V7.1 compatibility: reads v27.id, v27.home/away and scoring.total
// - Cloudbet ID remains read from matcher.cloudbet.id/event_id
// - D1 pending_odds compatibility fixed for the existing production schema
// - Weak matcher fallback removed; insecure candidates now fall through to direct Cloudbet matching
// - archive_key / market / selection / stake_eur / mode are now written on INSERT
// - Existing public diagnostic proxies preserved
// - Persistent retry preserved
// - SAME EVENT / SAME MARKET / SAME LINE
// - REAL BETTING DISABLED
//
// V6.0.6:
// - Compares exact target from /event and detector /line-test
// - Same Cloudbet event ID / same market / same line
// - /line-test is used as a second fresh odds source
// - If /line-test has a usable price it is preferred
// - Full source comparison is exposed in odds_diagnostic
// - DRY RUN remains enabled; no real bet placement
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type Obj = Record<string, any>;

// ============================================================
// CONFIG
// ============================================================

const VERSION = "V6.0.6";

const MODE = "DRY_RUN";
const DRY_RUN = true;
const BETTING_ENABLED = false;

const BET_STAKE_EUR = 10;

const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

// EXACT TARGET
const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

const TARGET_SELECTION =
  "OVER 0.5";

const TARGET_MARKET_KEY =
  TARGET_MARKET;

const TARGET_SUBMARKET_KEY =
  TARGET_SUBMARKET;

// CLOUDBET SERVICE BINDING
const CLOUDBET_LIVE_PATH =
  "/live";

// SERVICE TIMEOUT
const SERVICE_TIMEOUT_MS =
  10_000;

// Persistent odds retry
const ODDS_EVENT_MAX_RETRIES =
  20;

const ODDS_EVENT_RETRY_DELAY_MS =
  30_000;

// Missing event checks
const MAX_MISSING_CHECKS =
  3;

// Matcher
const MATCHER_THRESHOLD =
  0.20;

const MIN_MATCHER_SCORE =
  0.20;

const TEAM_MATCH_MIN_SCORE =
  0.70;

const CHARACTER_SIMILARITY_MIN_SCORE =
  0.70;

const CONTAINMENT_MIN_SCORE =
  0.75;

const TOKEN_MATCH_MIN_SCORE =
  0.75;

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const ALLOWED_SIGNAL_TYPE =
  "HUNTER_ENTRY";

// ============================================================
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES: Record<string, string> = {
  "akademia ontustyk":
    "akademiya ontustyk",

  "akademiya ontustyk":
    "akademiya ontustyk",

  "fc":
    "",

  "f.c.":
    "",

  "fk":
    "",

  "f.k.":
    "",

  "sc":
    "",

  "s.c.":
    "",

  "club":
    "",

  "football club":
    "",

  "fc ":
    "",

  "united":
    "utd",

  "utd":
    "utd",

  "shanghai shenhua":
    "shanghai shenhua",

  "dalian yingbo":
    "dalian yingbo"
};

const GENERIC_WORDS = new Set([
  "fc",
  "fk",
  "sc",
  "cf",
  "afc",
  "club",
  "football",
  "footballclub",
  "women",
  "woman",
  "ladies",
  "u19",
  "u20",
  "u21",
  "u23",
  "reserve",
  "reserves",
  "b",
  "ii",
  "iii"
]);

// ============================================================
// BASIC HELPERS
// ============================================================

function safe(value: any): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function norm(value: any): string {
  return safe(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    resolve =>
      setTimeout(
        resolve,
        ms
      )
  );
}

// ============================================================
// TEAM NORMALIZATION
// ============================================================

function normalizeTeam(
  value: any
): string {
  let result = norm(value);

  if (!result) {
    return "";
  }

  const alias =
    TEAM_ALIASES[result];

  if (alias !== undefined) {
    result = alias;
  }

  const tokens =
    result
      .split(" ")
      .filter(Boolean)
      .filter(
        token =>
          !GENERIC_WORDS.has(token)
      );

  return tokens.join(" ");
}

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
// MATCH PARSING
// ============================================================

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {
  const text =
    safe(value);

  if (!text) {
    return {
      home: "",
      away: ""
    };
  }

  const separators = [
    " - ",
    " vs ",
    " v ",
    " @ ",
    " — ",
    " – ",
    " : "
  ];

  for (
    const separator
    of separators
  ) {
    const index =
      text
        .toLowerCase()
        .indexOf(
          separator.toLowerCase()
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
    home: "",
    away: ""
  };
}

function extractHome(
  item: any
): string {
  if (!item) {
    return "";
  }

  const direct =
    item.home ||
    item.home_team ||
    item.homeTeam ||
    item.home_name ||
    item.homeTeamName;

  if (direct) {
    if (
      typeof direct ===
      "object"
    ) {
      return safe(
        direct.name ||
        direct.team_name ||
        direct.title ||
        direct.id
      );
    }

    return safe(direct);
  }

  const match =
    item.match ||
    item.match_name ||
    item.name ||
    item.event_name ||
    item.eventName;

  if (match) {
    return splitMatch(match).home;
  }

  return "";
}

function extractAway(
  item: any
): string {
  if (!item) {
    return "";
  }

  const direct =
    item.away ||
    item.away_team ||
    item.awayTeam ||
    item.away_name ||
    item.awayTeamName;

  if (direct) {
    if (
      typeof direct ===
      "object"
    ) {
      return safe(
        direct.name ||
        direct.team_name ||
        direct.title ||
        direct.id
      );
    }

    return safe(direct);
  }

  const match =
    item.match ||
    item.match_name ||
    item.name ||
    item.event_name ||
    item.eventName;

  if (match) {
    return splitMatch(match).away;
  }

  return "";
}

function displayMatch(
  item: any
): string {
  const home =
    extractHome(item);

  const away =
    extractAway(item);

  if (home && away) {
    return `${home} - ${away}`;
  }

  return safe(
    item?.match ||
    item?.match_name ||
    item?.name ||
    item?.event_name ||
    ""
  );
}

function extractMatchId(
  item: any
): string | null {
  if (!item) {
    return null;
  }

  const value =
    item.event_id ??
    item.eventId ??
    item.id ??
    item.match_id ??
    item.matchId ??
    item.cloudbet_id ??
    item.cloudbetId;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const result =
    String(value).trim();

  return result || null;
}

// ============================================================
// TEAM MATCHING
// ============================================================

function teamsPresent(
  home: string,
  away: string
): boolean {
  return Boolean(
    normalizeTeam(home) &&
    normalizeTeam(away)
  );
}

function levenshtein(
  a: string,
  b: string
): number {
  const aa =
    a || "";

  const bb =
    b || "";

  if (aa === bb) {
    return 0;
  }

  if (!aa.length) {
    return bb.length;
  }

  if (!bb.length) {
    return aa.length;
  }

  let previous =
    new Array<number>(
      bb.length + 1
    );

  let current =
    new Array<number>(
      bb.length + 1
    );

  for (
    let j = 0;
    j <= bb.length;
    j++
  ) {
    previous[j] = j;
  }

  for (
    let i = 1;
    i <= aa.length;
    i++
  ) {
    current[0] = i;

    for (
      let j = 1;
      j <= bb.length;
      j++
    ) {
      const cost =
        aa[i - 1] ===
        bb[j - 1]
          ? 0
          : 1;

      current[j] =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
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
    bb.length
  ];
}

function characterSimilarity(
  a: string,
  b: string
): number {
  const aa =
    normalizeTeam(a);

  const bb =
    normalizeTeam(b);

  if (!aa || !bb) {
    return 0;
  }

  if (aa === bb) {
    return 1;
  }

  const distance =
    levenshtein(
      aa,
      bb
    );

  const maxLength =
    Math.max(
      aa.length,
      bb.length
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

function teamScore(
  source: string,
  candidate: string
): number {
  const a =
    normalizeTeam(source);

  const b =
    normalizeTeam(candidate);

  if (!a || !b) {
    return 0;
  }

  if (a === b) {
    return 1;
  }

  const aTokens =
    teamTokens(a);

  const bTokens =
    teamTokens(b);

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

  const aSet =
    new Set(aTokens);

  const bSet =
    new Set(bTokens);

  let common = 0;

  for (
    const token
    of aSet
  ) {
    if (
      bSet.has(token)
    ) {
      common++;
    }
  }

  const containment =
    common /
    Math.min(
      aSet.size,
      bSet.size
    );

  const union =
    new Set([
      ...aSet,
      ...bSet
    ]).size;

  const jaccard =
    union
      ? common / union
      : 0;

  const chars =
    characterSimilarity(
      a,
      b
    );

  return Math.max(
    containment,
    jaccard,
    chars
  );
}

function twoSidedTeamScore(
  sourceHome: string,
  sourceAway: string,
  candidateHome: string,
  candidateAway: string
): {
  home: number;
  away: number;
  average: number;
  valid: boolean;
} {
  const home =
    teamScore(
      sourceHome,
      candidateHome
    );

  const away =
    teamScore(
      sourceAway,
      candidateAway
    );

  return {
    home,
    away,
    average:
      (home + away) / 2,
    valid:
      home >=
        TEAM_MATCH_MIN_SCORE &&
      away >=
        TEAM_MATCH_MIN_SCORE
  };
}

// ============================================================
// SERVICE ERROR
// ============================================================

class ServiceRequestError
  extends Error {

  status?: number;
  endpoint?: string;
  details?: any;

  constructor(
    message: string,
    status?: number,
    endpoint?: string,
    details?: any
  ) {
    super(message);

    this.name =
      "ServiceRequestError";

    this.status =
      status;

    this.endpoint =
      endpoint;

    this.details =
      details;
  }

  toJSON(): any {
    return {
      error:
        this.message,

      status:
        this.status ??
        null,

      endpoint:
        this.endpoint ??
        null,

      details:
        this.details ??
        null
    };
  }
}

// ============================================================
// SERVICE FETCH
// ============================================================

interface ServiceResponse {
  ok: boolean;
  status: number;
  latency_ms: number;
  data: any;
  error?: string;
}

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  timeoutMs =
    SERVICE_TIMEOUT_MS
): Promise<ServiceResponse> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await service.fetch(
        new Request(
          `https://internal${path}`,
          {
            method: "GET",
            signal:
              controller.signal
          }
        )
      );

    const latency =
      Date.now() -
      started;

    const text =
      await response.text();

    let data: any = null;

    try {
      data =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      return {
        ok: false,
        status:
          response.status,
        latency_ms:
          latency,
        data: null,
        error:
          "INVALID_JSON_RESPONSE"
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status:
          response.status,
        latency_ms:
          latency,
        data,
        error:
          data?.error ||
          data?.message ||
          `HTTP_${response.status}`
      };
    }

    return {
      ok: true,
      status:
        response.status,
      latency_ms:
        latency,
      data
    };

  } catch (error) {
    const latency =
      Date.now() -
      started;

    return {
      ok: false,
      status: 0,
      latency_ms:
        latency,
      data: null,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };

  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// DIRECT CLOUDBET EVENT
// ============================================================

async function fetchCloudbetEvent(
  env: Env,
  eventId: string
): Promise<Obj> {

  if (!eventId) {
    throw new ServiceRequestError(
      "CLOUDBET_EVENT_ID_MISSING"
    );
  }

  const path =
    `/event?id=${encodeURIComponent(
      eventId
    )}`;

  const result =
    await fetchServiceJSON(
      env.CLOUDBET,
      path,
      SERVICE_TIMEOUT_MS
    );

  if (!result.ok) {
    throw new ServiceRequestError(
      result.error ||
        "CLOUDBET_EVENT_FAILED",
      result.status,
      path,
      result.data
    );
  }

  let data =
    result.data;

  if (
    data &&
    typeof data === "object" &&
    data.data &&
    typeof data.data ===
      "object"
  ) {
    data =
      data.data;
  }

  // V6.0.2:
  // cloudbet-live-soccer-detector V5.7.8 returns the full
  // Cloudbet event inside the public wrapper field: event.
  // Unwrap it so odds parsing receives the actual event.markets.
  if (
    data &&
    typeof data === "object" &&
    data.event &&
    typeof data.event ===
      "object"
  ) {
    data =
      data.event;
  }

  return data || {};
}

// ============================================================
// CLOUDBET LINE TEST — V6.0.6
// Detector endpoint: /line-test?id=EVENT_ID
// READ ONLY
// ============================================================

async function fetchCloudbetLineTest(
  env: Env,
  eventId: string
): Promise<any> {

  if (!eventId) {
    throw new ServiceRequestError(
      "CLOUDBET_EVENT_ID_MISSING"
    );
  }

  const path =
    `/line-test?id=${encodeURIComponent(
      eventId
    )}`;

  const result =
    await fetchServiceJSON(
      env.CLOUDBET,
      path,
      SERVICE_TIMEOUT_MS
    );

  if (!result.ok) {
    return {
      ok: false,
      endpoint:
        path,
      status:
        result.status,
      latency_ms:
        result.latency_ms,
      data:
        null,
      error:
        result.error ||
        "CLOUDBET_LINE_TEST_FAILED",
      raw:
        result.data
    };
  }

  const wrapper =
    result.data || {};

  const line =
    wrapper?.line || {};

  const selection =
    line?.data ?? null;

  return {
    ok:
      line?.success === true &&
      !!selection,

    endpoint:
      path,

    status:
      line?.response?.status ??
      result.status,

    latency_ms:
      line?.response?.elapsed_ms ??
      result.latency_ms,

    selection,

    raw:
      wrapper,

    error:
      line?.success === false
        ? (
            line?.error ||
            "CLOUDBET_LINE_TEST_FAILED"
          )
        : null
  };
}

// ============================================================
// TRACKER
// ============================================================

function extractSignals(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(
      data.signals
    )
  ) {
    return data.signals;
  }

  if (
    Array.isArray(
      data.entries
    )
  ) {
    return data.entries;
  }

  if (
    Array.isArray(
      data.results
    )
  ) {
    return data.results;
  }

  if (
    Array.isArray(
      data.data?.signals
    )
  ) {
    return data.data.signals;
  }

  if (
    Array.isArray(
      data.data?.entries
    )
  ) {
    return data.data.entries;
  }

  return [];
}

// ============================================================
// HUNTER FILTER
// ============================================================

function hunterFilterDiagnostic(
  signal: any
): any {

  if (!signal) {
    return {
      accepted: false,
      reason:
        "SIGNAL_NULL"
    };
  }

  const status =
    String(
      signal.status ||
      signal.state ||
      ""
    ).toUpperCase();

  const home =
    signalHome(signal);

  const away =
    signalAway(signal);

  const minuteRaw =
    signal.entry_minute ??
    signal.minute ??
    signal.elapsed ??
    0;

  const minute =
    Number(minuteRaw);

  const statusValid =
    !status ||
    [
      "ENTRY",
      "SIGNAL",
      "TRACKING",
      "ACTIVE",
      "HUNTER"
    ].includes(status);

  const teamsValid =
    Boolean(
      home &&
      away
    );

  const minuteValid =
    !(
      Number.isFinite(minute) &&
      minute > 45
    );

  let reason =
    "ACCEPTED";

  if (!statusValid) {
    reason =
      "INVALID_STATUS";
  } else if (!teamsValid) {
    reason =
      "TEAMS_MISSING";
  } else if (!minuteValid) {
    reason =
      "MINUTE_OVER_45";
  }

  return {
    accepted:
      statusValid &&
      teamsValid &&
      minuteValid,

    reason,

    signal_type:
      signal?.signal_type ??
      signal?.type ??
      signal?.entry_type ??
      null,

    status,

    home:
      safe(home),

    away:
      safe(away),

    match:
      signalMatch(signal),

    match_id:
      signal?.match_id ??
      signal?.id ??
      null,

    entry_minute:
      signal?.entry_minute ??
      null,

    minute:
      signal?.minute ??
      null,

    elapsed:
      signal?.elapsed ??
      null,

    hunter_score:
      signal?.hunter_score ??
      signal?.score ??
      null
  };
}

function isHunterEntry(
  signal: any
): boolean {
  return hunterFilterDiagnostic(
    signal
  ).accepted;
}

function signalId(
  signal: any
): string {
  return String(
    signal?.match_id ||
    signal?.id ||
    ""
  );
}

function signalHome(
  signal: any
): string {
  const direct =
    safe(
      signal?.home ||
      signal?.home_team ||
      signal?.home_name ||
      ""
    );

  if (direct) {
    return direct;
  }

  const match =
    signal?.match_name ||
    signal?.match ||
    signal?.name ||
    signal?.event_name ||
    "";

  return splitMatch(
    match
  ).home;
}

function signalAway(
  signal: any
): string {
  const direct =
    safe(
      signal?.away ||
      signal?.away_team ||
      signal?.away_name ||
      ""
    );

  if (direct) {
    return direct;
  }

  const match =
    signal?.match_name ||
    signal?.match ||
    signal?.name ||
    signal?.event_name ||
    "";

  return splitMatch(
    match
  ).away;
}

function signalMatch(
  signal: any
): string {
  const direct =
    safe(
      signal?.match_name ||
      signal?.match ||
      signal?.name ||
      signal?.event_name ||
      ""
    );

  if (direct) {
    return direct;
  }

  return displayMatch({
    home:
      signalHome(signal),
    away:
      signalAway(signal)
  });
}

// ============================================================
// MATCHER
// ============================================================

function matcherMatches(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(
      data.matches
    )
  ) {
    return data.matches;
  }

  if (
    Array.isArray(
      data.results
    )
  ) {
    return data.results;
  }

  if (
    Array.isArray(
      data.data?.matches
    )
  ) {
    return data.data.matches;
  }

  if (
    Array.isArray(
      data.data?.results
    )
  ) {
    return data.data.results;
  }

  return [];
}

function matcherScore(
  matcher: any
): number {
  return Number(
    matcher?.match_score ??
    matcher?.score ??
    matcher?.confidence_score ??
    matcher?.confidence ??
    matcher?.scoring?.total ??
    matcher?.matcher_scoring?.total ??
    0
  );
}

function matcherSourceId(
  matcher: any
): string {
  return String(
    matcher?.match_id ||
    matcher?.source_match_id ||
    matcher?.flashscore_id ||
    matcher?.v27?.id ||
    matcher?.v27?.match_id ||
    ""
  );
}

function matcherHome(
  matcher: any
): string {
  return safe(
    matcher?.v27?.home ||
    matcher?.source?.home ||
    extractHome(matcher) ||
    ""
  );
}

function matcherAway(
  matcher: any
): string {
  return safe(
    matcher?.v27?.away ||
    matcher?.source?.away ||
    extractAway(matcher) ||
    ""
  );
}

function matcherV27(
  matcher: any
): boolean {
  const source =
    String(
      matcher?.source ||
      matcher?.provider ||
      matcher?.origin ||
      ""
    ).toUpperCase();

  return (
    source.includes("V27") ||
    source.includes("FLASHSCORE") ||
    !!matcher?.v27
  );
}

function matcherCloudbet(
  matcher: any
): string | null {
  const id =
    matcher?.cloudbet_id ||
    matcher?.cloudbetId ||
    matcher?.event_id ||
    matcher?.eventId ||
    matcher?.cloudbet?.id ||
    matcher?.cloudbet?.event_id ||
    null;

  if (
    id === null ||
    id === undefined
  ) {
    return null;
  }

  const result =
    String(id).trim();

  return result || null;
}

function matcherClassification(
  matcher: any
): string {
  return String(
    matcher?.classification ||
    matcher?.match_classification ||
    matcher?.confidence_classification ||
    ""
  ).toUpperCase();
}

function matcherMethod(
  matcher: any
): string {
  return String(
    matcher?.method ||
    matcher?.match_method ||
    matcher?.source ||
    matcher?.reason ||
    ""
  );
}

function validateMatcher(
  matcher: any
): boolean {
  if (!matcher) {
    return false;
  }

  const score =
    matcherScore(
      matcher
    );

  const classification =
    matcherClassification(
      matcher
    );

  if (
    classification &&
    classification !==
      REQUIRED_MATCH_CLASSIFICATION
  ) {
    return false;
  }

  if (
    score <
    MIN_MATCHER_SCORE
  ) {
    return false;
  }

  return true;
}

function findBestMatcher(
  signal: any,
  matches: any[]
): any | null {

  const home =
    signalHome(signal);

  const away =
    signalAway(signal);

  if (
    !teamsPresent(
      home,
      away
    )
  ) {
    return null;
  }

  let best:
    any | null = null;

  let bestScore = 0;

  for (
    const matcher
    of matches
  ) {
    const mh =
      matcherHome(
        matcher
      );

    const ma =
      matcherAway(
        matcher
      );

    const score =
      twoSidedTeamScore(
        home,
        away,
        mh,
        ma
      );

    if (
      !score.valid
    ) {
      continue;
    }

    if (
      score.average >
      bestScore
    ) {
      bestScore =
        score.average;

      best = {
        ...matcher,

        match_score:
          matcherScore(
            matcher
          ) ||
          score.average,

        team_match_score:
          score.average
      };
    }
  }

  return best;
}

function teamSimilarity(
  a: string,
  b: string
): number {
  return teamScore(
    a,
    b
  );
}

// ============================================================
// CLOUDBET NORMALIZATION
// ============================================================

function cloudbetMatches(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(
      data.events
    )
  ) {
    return data.events;
  }

  if (
    Array.isArray(
      data.data?.events
    )
  ) {
    return data.data.events;
  }

  if (
    Array.isArray(
      data.competitions
    )
  ) {
    const events: any[] =
      [];

    for (
      const competition
      of data.competitions
    ) {
      if (
        Array.isArray(
          competition?.events
        )
      ) {
        events.push(
          ...competition.events
        );
      }
    }

    if (events.length) {
      return events;
    }
  }

  if (
    Array.isArray(
      data.data?.competitions
    )
  ) {
    const events: any[] =
      [];

    for (
      const competition
      of data.data.competitions
    ) {
      if (
        Array.isArray(
          competition?.events
        )
      ) {
        events.push(
          ...competition.events
        );
      }
    }

    if (events.length) {
      return events;
    }
  }

  return [];
}

function isCloudbetLive(
  event: any
): boolean {
  if (!event) {
    return false;
  }

  const status =
    String(
      event.status ||
      event.state ||
      event.event_status ||
      ""
    ).toUpperCase();

  if (
    status === "TRADING_LIVE" ||
    status === "LIVE" ||
    status.includes("LIVE")
  ) {
    return true;
  }

  if (
    event.live === true ||
    event.is_live === true ||
    event.isLive === true
  ) {
    return true;
  }

  return false;
}

function getCloudbetEventId(
  event: any
): string | null {
  if (!event) {
    return null;
  }

  const id =
    event.event_id ??
    event.eventId ??
    event.id ??
    event.cloudbet_id ??
    event.cloudbetId ??
    event.match_id;

  if (
    id === null ||
    id === undefined
  ) {
    return null;
  }

  const result =
    String(id).trim();

  return result || null;
}

function cloudbetHome(
  event: any
): string {
  return safe(
    event?.home ||
    event?.home_team ||
    event?.homeTeam ||
    event?.home_name ||
    ""
  );
}

function cloudbetAway(
  event: any
): string {
  return safe(
    event?.away ||
    event?.away_team ||
    event?.awayTeam ||
    event?.away_name ||
    ""
  );
}

// ============================================================
// DIRECT CLOUDBET FALLBACK
// ============================================================

function directCloudbetFallback(
  signal: any,
  cloudbetLive: any[]
): any | null {

  const sourceHome =
    signalHome(signal);

  const sourceAway =
    signalAway(signal);

  if (
    !teamsPresent(
      sourceHome,
      sourceAway
    )
  ) {
    return null;
  }

  let best:
    any | null = null;

  let bestScore = 0;

  for (
    const event
    of cloudbetLive
  ) {
    const candidateHome =
      cloudbetHome(event);

    const candidateAway =
      cloudbetAway(event);

    const score =
      twoSidedTeamScore(
        sourceHome,
        sourceAway,
        candidateHome,
        candidateAway
      );

    if (
      !score.valid
    ) {
      continue;
    }

    if (
      score.average >
      bestScore
    ) {
      bestScore =
        score.average;

      best = {
        ...event,

        cloudbet_id:
          getCloudbetEventId(
            event
          ),

        match_score:
          score.average,

        team_match_score:
          score.average,

        classification:
          REQUIRED_MATCH_CLASSIFICATION,

        method:
          "DIRECT_CLOUDBET_FALLBACK"
      };
    }
  }

  return best;
}

// ============================================================
// FIND CLOUDBET BY ID
// ============================================================

function findCloudbetById(
  cloudbetLive: any[],
  eventId: string
): any | null {

  const target =
    String(eventId).trim();

  if (!target) {
    return null;
  }

  return (
    cloudbetLive.find(
      event => {
        const id =
          getCloudbetEventId(
            event
          );

        return (
          id !== null &&
          String(id) ===
            target
        );
      }
    ) || null
  );
}

// ============================================================
// VERIFY CLOUDBET
// ============================================================

function verifyCloudbet(
  signal: any,
  matcher: any,
  cloudbetLive: any[]
): {
  ok: boolean;
  cloudbet?: any;
  error?: string;
} {

  const sourceHome =
    signalHome(signal);

  const sourceAway =
    signalAway(signal);

  if (
    !teamsPresent(
      sourceHome,
      sourceAway
    )
  ) {
    return {
      ok: false,
      error:
        "SIGNAL_TEAMS_MISSING"
    };
  }

  const matcherEventId =
    matcherCloudbet(
      matcher
    );

  if (matcherEventId) {
    const exact =
      findCloudbetById(
        cloudbetLive,
        matcherEventId
      );

    if (!exact) {
      return {
        ok: false,
        error:
          "MATCHER_CLOUDBET_EVENT_NOT_IN_LIVE"
      };
    }

    const score =
      twoSidedTeamScore(
        sourceHome,
        sourceAway,
        cloudbetHome(exact),
        cloudbetAway(exact)
      );

    if (
      !score.valid
    ) {
      return {
        ok: false,
        error:
          "MATCHER_CLOUDBET_TEAM_VERIFICATION_FAILED"
      };
    }

    return {
      ok: true,
      cloudbet: {
        ...exact,

        id:
          matcherEventId,

        event_id:
          matcherEventId,

        team_match_score:
          score.average,

        classification:
          REQUIRED_MATCH_CLASSIFICATION
      }
    };
  }

  const fallback =
    directCloudbetFallback(
      signal,
      cloudbetLive
    );

  if (!fallback) {
    return {
      ok: false,
      error:
        "NO_ACCEPTABLE_CLOUDBET_MATCH"
    };
  }

  const eventId =
    getCloudbetEventId(
      fallback
    );

  if (!eventId) {
    return {
      ok: false,
      error:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  const score =
    twoSidedTeamScore(
      sourceHome,
      sourceAway,
      cloudbetHome(fallback),
      cloudbetAway(fallback)
    );

  if (
    !score.valid
  ) {
    return {
      ok: false,
      error:
        "DIRECT_CLOUDBET_TEAM_VERIFICATION_FAILED"
    };
  }

  return {
    ok: true,
    cloudbet: {
      ...fallback,

      id:
        eventId,

      event_id:
        eventId,

      team_match_score:
        score.average,

      classification:
        REQUIRED_MATCH_CLASSIFICATION
    }
  };
}

// ============================================================
// TARGET MARKET
// ============================================================

function isTargetMarket(
  value: any
): boolean {
  const normalized =
    norm(value);

  return (
    normalized ===
    norm(TARGET_MARKET)
  );
}

function isTargetSubmarket(
  value: any
): boolean {
  return (
    safe(value)
      .toLowerCase()
      .trim() ===
    TARGET_SUBMARKET
  );
}

function isTargetSelection(
  selection: any
): boolean {
  if (!selection) {
    return false;
  }

  const outcome =
    safe(
      selection.outcome
    ).toLowerCase();

  const params =
    safe(
      selection.params
    ).toLowerCase();

  if (
    outcome !==
    TARGET_OUTCOME
  ) {
    return false;
  }

  if (
    params !==
    TARGET_PARAMS
  ) {
    return false;
  }

  return true;
}

// ============================================================
// PRICE
// ============================================================

function extractPrice(
  selection: any
): number | null {

  const raw =
    selection?.price ??
    selection?.odds ??
    selection?.decimal_odds ??
    selection?.raw_price ??
    null;

  const price =
    Number(raw);

  if (
    !Number.isFinite(price) ||
    price <= 1
  ) {
    return null;
  }

  return price;
}

function selectionEnabled(
  selection: any
): boolean {

  const status =
    String(
      selection?.status ||
      selection?.state ||
      ""
    ).toUpperCase();

  if (
    status.includes(
      "DISABLED"
    ) ||
    status.includes(
      "SUSPENDED"
    ) ||
    status.includes(
      "CLOSED"
    ) ||
    status.includes(
      "SETTLED"
    )
  ) {
    return false;
  }

  if (
    status.includes(
      "ENABLED"
    ) ||
    status.includes(
      "OPEN"
    ) ||
    status.includes(
      "TRADING"
    ) ||
    status === ""
  ) {
    return true;
  }

  return true;
}

// ============================================================
// TARGET SELECTION SEARCH
// ============================================================

function findTargetSelection(
  event: any
): any | null {

  if (!event) {
    return null;
  }

  // V6.0.3:
  // DIRECT EXACT CLOUDBET STRUCTURE
  //
  // event.markets[TARGET_MARKET]
  //   .submarkets[TARGET_SUBMARKET]
  //   .selections[]
  //
  // The previous recursive fallback entered event.markets but did not
  // iterate arbitrary market-key properties, so the exact target could
  // exist with a valid price and still be missed.
  const directMarket =
    event?.markets?.[
      TARGET_MARKET_KEY
    ];

  const directSubmarket =
    directMarket?.submarkets?.[
      TARGET_SUBMARKET_KEY
    ];

  const directSelections =
    Array.isArray(
      directSubmarket?.selections
    )
      ? directSubmarket.selections
      : [];

  for (
    const selection
    of directSelections
  ) {
    if (
      !isTargetSelection(
        selection
      )
    ) {
      continue;
    }

    if (
      !selectionEnabled(
        selection
      )
    ) {
      continue;
    }

    const price =
      extractPrice(
        selection
      );

    if (
      price === null
    ) {
      continue;
    }

    return {
      ...selection,

      price,

      market:
        TARGET_MARKET_KEY,

      submarket:
        TARGET_SUBMARKET_KEY,

      target:
        true
    };
  }

  if (
    event.target_1h_over_05 ===
    true
  ) {
    const price =
      Number(
        event.target_price
      );

    if (
      Number.isFinite(price) &&
      price > 1
    ) {
      return {
        outcome:
          TARGET_OUTCOME,

        params:
          TARGET_PARAMS,

        price,

        raw_price:
          price,

        status:
          "SELECTION_ENABLED",

        market:
          TARGET_MARKET
      };
    }
  }

  if (
    Array.isArray(
      event.selections
    )
  ) {
    for (
      const selection
      of event.selections
    ) {
      if (
        !isTargetSelection(
          selection
        )
      ) {
        continue;
      }

      if (
        !selectionEnabled(
          selection
        )
      ) {
        continue;
      }

      const price =
        extractPrice(
          selection
        );

      if (
        price === null
      ) {
        continue;
      }

      return {
        ...selection,

        price,

        market:
          selection.market ||
          TARGET_MARKET,

        submarket:
          selection.submarket ||
          TARGET_SUBMARKET
      };
    }
  }

  return searchTargetRecursive(
    event,
    null,
    null
  );
}

// ============================================================
// RECURSIVE TARGET SEARCH
// ============================================================

function searchTargetRecursive(
  value: any,
  marketContext:
    string | null,
  submarketContext:
    string | null
): any | null {

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item
      of value
    ) {
      const found =
        searchTargetRecursive(
          item,
          marketContext,
          submarketContext
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof value !==
    "object"
  ) {
    return null;
  }

  const currentMarket =
    value.market_key ||
    value.marketKey ||
    value.market_name ||
    value.market ||
    value.key ||
    marketContext;

  const currentSubmarket =
    value.submarket_key ||
    value.submarketKey ||
    value.submarket_name ||
    value.submarket ||
    value.period ||
    submarketContext;

  const marketMatches =
    isTargetMarket(
      currentMarket
    ) ||
    currentMarket ===
      TARGET_MARKET_KEY;

  const submarketMatches =
    isTargetSubmarket(
      currentSubmarket
    );

  if (
    marketMatches &&
    submarketMatches &&
    isTargetSelection(value)
  ) {
    if (
      selectionEnabled(value)
    ) {
      const price =
        extractPrice(value);

      if (
        price !== null
      ) {
        return {
          ...value,

          price,

          market:
            TARGET_MARKET,

          submarket:
            TARGET_SUBMARKET
        };
      }
    }
  }

  if (
    Array.isArray(
      value.selections
    )
  ) {
    for (
      const selection
      of value.selections
    ) {
      const selectionMarket =
        selection.market ||
        selection.market_key ||
        currentMarket;

      const selectionSubmarket =
        selection.submarket ||
        selection.submarket_key ||
        selection.period ||
        currentSubmarket;

      if (
        !(
          isTargetMarket(
            selectionMarket
          ) ||
          selectionMarket ===
            TARGET_MARKET_KEY
        )
      ) {
        continue;
      }

      if (
        !isTargetSubmarket(
          selectionSubmarket
        )
      ) {
        continue;
      }

      if (
        !isTargetSelection(
          selection
        )
      ) {
        continue;
      }

      if (
        !selectionEnabled(
          selection
        )
      ) {
        continue;
      }

      const price =
        extractPrice(
          selection
        );

      if (
        price === null
      ) {
        continue;
      }

      return {
        ...selection,

        price,

        market:
          TARGET_MARKET,

        submarket:
          TARGET_SUBMARKET
      };
    }
  }

  const containers = [
    "markets",
    "odds",
    "lines",
    "market",
    "submarkets",
    "data"
  ];

  for (
    const key
    of containers
  ) {
    const child =
      value[key];

    if (
      child === undefined ||
      child === null
    ) {
      continue;
    }

    const found =
      searchTargetRecursive(
        child,
        currentMarket
          ? String(
              currentMarket
            )
          : marketContext,
        currentSubmarket
          ? String(
              currentSubmarket
            )
          : submarketContext
      );

    if (found) {
      return found;
    }
  }

  return null;
}

// ============================================================
// ODDS
// ============================================================

function extractOdds(
  event: any
): number | null {

  const target =
    findTargetSelection(
      event
    );

  if (!target) {
    return null;
  }

  return extractPrice(
    target
  );
}

function buildOddsDiagnostic(
  event: any
): any {

  const target =
    findTargetSelection(
      event
    );

  return {
    event_id:
      getCloudbetEventId(
        event
      ),

    match:
      displayMatch(event),

    home:
      cloudbetHome(event),

    away:
      cloudbetAway(event),

    target_market:
      TARGET_MARKET,

    target_submarket:
      TARGET_SUBMARKET,

    target_outcome:
      TARGET_OUTCOME,

    target_params:
      TARGET_PARAMS,

    target_found:
      !!target,

    target:
      target
        ? {
            outcome:
              target.outcome,

            params:
              target.params,

            price:
              target.price,

            raw_price:
              target.raw_price ??
              target.price,

            status:
              target.status,

            market:
              target.market,

            submarket:
              target.submarket
          }
        : null
  };
}

// ============================================================
// ODDS RESULT
// ============================================================

interface OddsResult {
  success: boolean;
  event_id: string | null;
  odds: number | null;
  event: Obj | null;
  source?: string | null;
  diagnostic: Obj;
  error?: string;
}

// ============================================================
// RESOLVE ODDS ONCE
// ============================================================

async function resolveOddsOnce(
  env: Env,
  cloudbet: Obj
): Promise<OddsResult> {

  const eventId =
    extractMatchId(
      cloudbet
    ) ||
    getCloudbetEventId(
      cloudbet
    );

  if (!eventId) {
    return {
      success: false,
      event_id: null,
      odds: null,
      event: null,
      source: null,
      diagnostic: {
        error:
          "CLOUDBET_EVENT_ID_MISSING"
      },
      error:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  try {

    // V6.0.6:
    // Ask BOTH sources for the SAME event at the same time:
    //   1) /event?id=...
    //   2) /line-test?id=...
    //
    // This lets us see whether the full event feed and the
    // dedicated /lines lookup disagree.

    const [
      eventResult,
      lineResult
    ] =
      await Promise.allSettled([
        fetchCloudbetEvent(
          env,
          eventId
        ),

        fetchCloudbetLineTest(
          env,
          eventId
        )
      ]);

    const event =
      eventResult.status ===
        "fulfilled"
        ? eventResult.value
        : null;

    const eventError =
      eventResult.status ===
        "rejected"
        ? (
            eventResult.reason instanceof Error
              ? eventResult.reason.message
              : String(
                  eventResult.reason
                )
          )
        : null;

    const eventDiagnostic =
      event
        ? buildOddsDiagnostic(
            event
          )
        : {
            error:
              eventError ||
              "EVENT_SOURCE_FAILED"
          };

    const eventTarget =
      event
        ? findTargetSelection(
            event
          )
        : null;

    const eventOdds =
      eventTarget
        ? extractPrice(
            eventTarget
          )
        : null;

    const line =
      lineResult.status ===
        "fulfilled"
        ? lineResult.value
        : {
            ok: false,
            selection: null,
            error:
              lineResult.reason instanceof Error
                ? lineResult.reason.message
                : String(
                    lineResult.reason
                  )
          };

    const lineSelection =
      line?.selection ??
      null;

    const lineStatus =
      String(
        lineSelection?.status ??
        ""
      ).toUpperCase();

    const linePrice =
      extractPrice(
        lineSelection
      );

    const lineMaxStakeRaw =
      lineSelection?.maxStake ??
      lineSelection?.max_stake ??
      null;

    const lineMaxStake =
      lineMaxStakeRaw === null ||
      lineMaxStakeRaw === undefined
        ? null
        : Number(
            lineMaxStakeRaw
          );

    const lineEnabled =
      !!lineSelection &&
      selectionEnabled(
        lineSelection
      ) &&
      linePrice !== null &&
      (
        lineMaxStake === null ||
        (
          Number.isFinite(
            lineMaxStake
          ) &&
          lineMaxStake > 0
        )
      );

    const eventStatus =
      String(
        eventTarget?.status ??
        ""
      );

    const eventMaxStakeRaw =
      eventTarget?.maxStake ??
      eventTarget?.max_stake ??
      null;

    const eventMaxStake =
      eventMaxStakeRaw === null ||
      eventMaxStakeRaw === undefined
        ? null
        : Number(
            eventMaxStakeRaw
          );

    const diagnostic = {
      comparison_version:
        "V6.0.6",

      event_id:
        eventId,

      target: {
        market:
          TARGET_MARKET,

        submarket:
          TARGET_SUBMARKET,

        outcome:
          TARGET_OUTCOME,

        params:
          TARGET_PARAMS
      },

      event_source: {
        ok:
          !!event,

        odds:
          eventOdds,

        status:
          eventTarget?.status ??
          null,

        maxStake:
          Number.isFinite(
            eventMaxStake
          )
            ? eventMaxStake
            : null,

        target_found:
          !!eventTarget,

        diagnostic:
          eventDiagnostic,

        error:
          eventError
      },

      line_source: {
        ok:
          line?.ok === true,

        endpoint:
          line?.endpoint ??
          `/line-test?id=${eventId}`,

        http_status:
          line?.status ??
          null,

        latency_ms:
          line?.latency_ms ??
          null,

        odds:
          linePrice,

        status:
          lineSelection?.status ??
          null,

        maxStake:
          Number.isFinite(
            lineMaxStake
          )
            ? lineMaxStake
            : null,

        selection:
          lineSelection,

        enabled:
          lineEnabled,

        error:
          line?.error ??
          null
      },

      comparison: {
        same_price:
          eventOdds ===
          linePrice,

        same_status:
          eventStatus ===
          lineStatus,

        event_price:
          eventOdds,

        line_price:
          linePrice
      }
    };

    // Prefer the dedicated /lines result when it is actually usable.
    if (
      lineEnabled &&
      linePrice !== null
    ) {
      return {
        success: true,
        event_id:
          eventId,
        odds:
          linePrice,
        event:
          event || cloudbet,
        source:
          "LINE_TEST",
        diagnostic
      };
    }

    // Fallback to the exact target read from /event.
    if (
      eventOdds !== null
    ) {
      return {
        success: true,
        event_id:
          eventId,
        odds:
          eventOdds,
        event:
          event || cloudbet,
        source:
          "EVENT",
        diagnostic
      };
    }

    return {
      success: false,
      event_id:
        eventId,
      odds: null,
      event:
        event || null,
      source: null,
      diagnostic,
      error:
        "TARGET_ODDS_NOT_AVAILABLE"
    };

  } catch (error) {

    const diagnostic =
      error instanceof
        ServiceRequestError
        ? error.toJSON()
        : {
            error:
              error instanceof Error
                ? error.message
                : String(error)
          };

    return {
      success: false,
      event_id:
        eventId,
      odds: null,
      event: null,
      source: null,
      diagnostic,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function resolveOddsWithRetry(
  env: Env,
  cloudbet: Obj
): Promise<OddsResult> {

  return resolveOddsOnce(
    env,
    cloudbet
  );
}

// ============================================================
// D1 — PENDING ODDS
// ============================================================

interface PendingRow {
  id?: number;
  execution_id: string;
  cloudbet_id: string;
  payload_json: string;
  created_at?: string;
  updated_at?: string;
  next_check_at?: string;
  retry_count?: number;
  missing_count?: number;
}

interface PendingPayload {
  bet?: any;
  signal?: any;
  matcher?: any;
  cloudbet?: any;
  odds?: any;
  diagnostic?: any;
}

function nowISO(): string {
  return new Date().toISOString();
}

function addSecondsISO(
  seconds: number
): string {
  return new Date(
    Date.now() +
      seconds * 1000
  ).toISOString();
}

async function savePending(
  env: Env,
  executionId: string,
  bet: any,
  signal: any,
  matcher: any,
  cloudbet: any,
  oddsResult: OddsResult
): Promise<any> {

  const cloudbetId =
    bet?.cloudbet?.id ||
    cloudbet?.id ||
    cloudbet?.event_id ||
    extractMatchId(
      cloudbet
    );

  if (!cloudbetId) {
    return {
      success: false,
      error:
        "CLOUDBET_EVENT_ID_MISSING_FOR_PENDING"
    };
  }

  const payload:
    PendingPayload = {
    bet,
    signal,
    matcher,
    cloudbet,
    odds: oddsResult,
    diagnostic:
      buildOddsDiagnostic(
        cloudbet
      )
  };

  const payloadJson =
    JSON.stringify(
      payload
    );

  const existing =
    await env.DB
      .prepare(`
        SELECT *
        FROM pending_odds
        WHERE cloudbet_id = ?
        LIMIT 1
      `)
      .bind(
        cloudbetId
      )
      .first<PendingRow>();

  const nextCheck =
    addSecondsISO(
      ODDS_EVENT_RETRY_DELAY_MS /
        1000
    );

  if (existing) {
    await env.DB
      .prepare(`
        UPDATE pending_odds
        SET
          execution_id = ?,
          payload_json = ?,
          updated_at = ?,
          next_check_at = ?
        WHERE cloudbet_id = ?
      `)
      .bind(
        executionId,
        payloadJson,
        nowISO(),
        nextCheck,
        cloudbetId
      )
      .run();

    return {
      success: true,
      action:
        "UPDATED_PENDING",
      cloudbet_id:
        cloudbetId,
      retry_count:
        Number(
          existing.retry_count ||
            0
        ),
      next_check_at:
        nextCheck
    };
  }

  const archiveKey =
    `${cloudbetId}:${TARGET_MARKET_KEY}:${TARGET_OUTCOME}:${TARGET_PARAMS}`;

  const signalMatchId =
    signal?.match_id ??
    signal?.id ??
    null;

  const matchName =
    signal?.match_name ??
    signal?.match ??
    `${signalHome(signal)} - ${signalAway(signal)}`;

  const home =
    signalHome(signal);

  const away =
    signalAway(signal);

  const entryMinute =
    signal?.entry_minute ??
    signal?.minute ??
    null;

  await env.DB
    .prepare(`
      INSERT INTO pending_odds (
        archive_key,
        execution_id,
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
        payload_json,
        created_at,
        updated_at,
        next_check_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, 'PENDING_ODDS',
        0, 0, ?, ?, ?, ?
      )
    `)
    .bind(
      archiveKey,
      executionId,
      signalMatchId,
      cloudbetId,
      matchName,
      home,
      away,
      entryMinute,
      BET_MARKET,
      BET_SELECTION,
      BET_STAKE_EUR,
      MODE,
      payloadJson,
      nowISO(),
      nowISO(),
      nextCheck
    )
    .run();

  return {
    success: true,
    action:
      "CREATED_PENDING",
    archive_key:
      archiveKey,
    cloudbet_id:
      cloudbetId,
    retry_count: 0,
    next_check_at:
      nextCheck
  };
}

async function loadPending(
  env: Env
): Promise<PendingRow[]> {

  const result =
    await env.DB
      .prepare(`
        SELECT *
        FROM pending_odds
        WHERE
          next_check_at IS NULL
          OR next_check_at <= datetime('now')
        ORDER BY id ASC
        LIMIT 100
      `)
      .all<PendingRow>();

  return result.results || [];
}

async function incrementPendingRetry(
  env: Env,
  row: PendingRow,
  error: string
): Promise<any> {

  const currentRetry =
    Number(
      row.retry_count ||
        0
    );

  const nextRetry =
    currentRetry + 1;

  if (
    nextRetry >=
    ODDS_EVENT_MAX_RETRIES
  ) {
    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(
        row.id
      )
      .run();

    return {
      action:
        "EXPIRED",

      retry_count:
        nextRetry,

      max_retries:
        ODDS_EVENT_MAX_RETRIES,

      error
    };
  }

  const nextCheck =
    addSecondsISO(
      ODDS_EVENT_RETRY_DELAY_MS /
        1000
    );

  await env.DB
    .prepare(`
      UPDATE pending_odds
      SET
        retry_count = ?,
        updated_at = ?,
        next_check_at = ?
      WHERE id = ?
    `)
    .bind(
      nextRetry,
      nowISO(),
      nextCheck,
      row.id
    )
    .run();

  return {
    action:
      "RESCHEDULED",

    retry_count:
      nextRetry,

    max_retries:
      ODDS_EVENT_MAX_RETRIES,

    next_check_at:
      nextCheck,

    error
  };
}

async function incrementPendingMissing(
  env: Env,
  row: PendingRow,
  error: string
): Promise<any> {

  const currentMissing =
    Number(
      row.missing_count ||
        0
    );

  const nextMissing =
    currentMissing + 1;

  if (
    nextMissing >=
    MAX_MISSING_CHECKS
  ) {
    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(
        row.id
      )
      .run();

    return {
      action:
        "REMOVED_MISSING",

      missing_count:
        nextMissing,

      max_missing_checks:
        MAX_MISSING_CHECKS,

      error
    };
  }

  const nextCheck =
    addSecondsISO(
      ODDS_EVENT_RETRY_DELAY_MS /
        1000
    );

  await env.DB
    .prepare(`
      UPDATE pending_odds
      SET
        missing_count = ?,
        updated_at = ?,
        next_check_at = ?
      WHERE id = ?
    `)
    .bind(
      nextMissing,
      nowISO(),
      nextCheck,
      row.id
    )
    .run();

  return {
    action:
      "RESCHEDULED_MISSING",

    missing_count:
      nextMissing,

    max_missing_checks:
      MAX_MISSING_CHECKS,

    next_check_at:
      nextCheck,

    error
  };
}

// ============================================================
// PENDING VALIDATION
// ============================================================

function pendingValid(
  event: any
): boolean {

  if (!event) {
    return false;
  }

  if (
    !isCloudbetLive(event)
  ) {
    return false;
  }

  const score =
    String(
      event.score ??
      event.result ??
      event.match_score ??
      ""
    ).trim();

  if (
    score === "0:0" ||
    score === "0 - 0"
  ) {
  } else if (score) {
    return false;
  }

  const period =
    event.period ||
    event.phase ||
    event.period_type ||
    "";

  if (
    String(period)
      .toLowerCase()
      .includes("2h")
  ) {
    return false;
  }

  const minute =
    Number(
      event.minute ??
      event.clock ??
      event.elapsed ??
      event.match_minute ??
      0
    );

  if (
    Number.isFinite(minute) &&
    minute > 45
  ) {
    return false;
  }

  return true;
}

// ============================================================
// PENDING RETRY
// ============================================================

async function processPending(
  env: Env
): Promise<any> {

  const rows =
    await loadPending(
      env
    );

  if (!rows.length) {
    return {
      success: true,
      pending_found: 0,
      processed: 0,
      completed: 0,
      rescheduled: 0,
      expired: 0,
      missing: 0
    };
  }

  let completed = 0;
  let rescheduled = 0;
  let expired = 0;
  let missing = 0;

  const results: any[] =
    [];

  const liveResponse =
    await fetchServiceJSON(
      env.CLOUDBET,
      CLOUDBET_LIVE_PATH,
      SERVICE_TIMEOUT_MS
    );

  if (
    !liveResponse.ok
  ) {
    return {
      success: false,
      pending_found:
        rows.length,
      processed: 0,
      completed: 0,
      rescheduled: 0,
      expired: 0,
      missing: 0,
      error:
        "CLOUDBET_LIVE_FAILED",
      cloudbet:
        liveResponse
    };
  }

  const liveMatches =
    cloudbetMatches(
      liveResponse.data
    ).filter(
      isCloudbetLive
    );

  const liveById =
    new Map<string, any>();

  for (
    const event
    of liveMatches
  ) {
    const id =
      extractMatchId(
        event
      ) ||
      getCloudbetEventId(
        event
      );

    if (id) {
      liveById.set(
        String(id),
        event
      );
    }
  }

  for (
    const row
    of rows
  ) {

    const cloudbetId =
      String(
        row.cloudbet_id ||
          ""
      );

    if (!cloudbetId) {
      const r =
        await incrementPendingRetry(
          env,
          row,
          "CLOUDBET_EVENT_ID_MISSING"
        );

      results.push({
        pending_id:
          row.id,
        ...r
      });

      if (
        r.action ===
        "EXPIRED"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    const liveEvent =
      liveById.get(
        cloudbetId
      );

    if (!liveEvent) {
      const r =
        await incrementPendingMissing(
          env,
          row,
          "SAME_CLOUDBET_EVENT_NOT_IN_LIVE"
        );

      results.push({
        pending_id:
          row.id,

        cloudbet_id:
          cloudbetId,

        ...r
      });

      missing++;

      if (
        r.action ===
        "REMOVED_MISSING"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    if (
      !pendingValid(
        liveEvent
      )
    ) {
      const r =
        await incrementPendingMissing(
          env,
          row,
          "SAME_EVENT_NO_LONGER_VALID_FOR_TARGET"
        );

      results.push({
        pending_id:
          row.id,

        cloudbet_id:
          cloudbetId,

        ...r
      });

      missing++;

      if (
        r.action ===
        "REMOVED_MISSING"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    const retryEvent = {
      ...liveEvent,

      id:
        cloudbetId,

      event_id:
        cloudbetId
    };

    const oddsResult =
      await resolveOddsWithRetry(
        env,
        retryEvent
      );

    if (
      !oddsResult.success
    ) {
      const r =
        await incrementPendingRetry(
          env,
          row,
          oddsResult.error ||
            "TARGET_ODDS_STILL_UNAVAILABLE"
        );

      results.push({
        pending_id:
          row.id,

        cloudbet_id:
          cloudbetId,

        odds:
          oddsResult,

        ...r
      });

      if (
        r.action ===
        "EXPIRED"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    let storedPayload:
      PendingPayload = {};

    try {
      storedPayload =
        JSON.parse(
          row.payload_json ||
            "{}"
        );
    } catch {
      storedPayload = {};
    }

    const originalBet =
      storedPayload.bet ||
      {};

    const completedBet = {
      ...originalBet,

      cloudbet: {
        ...(originalBet.cloudbet ||
          {}),
        ...(liveEvent ||
          {}),

        id:
          cloudbetId,

        event_id:
          cloudbetId
      },

      odds: {
        ...(originalBet.odds ||
          {}),
        ...oddsResult
      },

      target: {
        market:
          TARGET_MARKET,

        selection:
          TARGET_SELECTION,

        market_key:
          TARGET_MARKET_KEY,

        submarket_key:
          TARGET_SUBMARKET_KEY,

        outcome:
          TARGET_OUTCOME,

        params:
          TARGET_PARAMS
      }
    };

    const archiveResult =
      await archiveBet(
        env,
        completedBet,
        storedPayload.signal ||
          null,
        storedPayload.matcher ||
          null,
        liveEvent,
        oddsResult
      );

    if (
      !archiveResult.success
    ) {
      const r =
        await incrementPendingRetry(
          env,
          row,
          archiveResult.error ||
            "ARCHIVE_FAILED"
        );

      results.push({
        pending_id:
          row.id,

        cloudbet_id:
          cloudbetId,

        archive:
          archiveResult,

        ...r
      });

      if (
        r.action ===
        "EXPIRED"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(
        row.id
      )
      .run();

    completed++;

    results.push({
      pending_id:
        row.id,

      cloudbet_id:
        cloudbetId,

      action:
        "COMPLETED",

      odds:
        oddsResult,

      archive:
        archiveResult
    });
  }

  return {
    success: true,

    pending_found:
      rows.length,

    processed:
      rows.length,

    completed,

    rescheduled,

    expired,

    missing,

    results
  };
}

// ============================================================
// ARCHIVE
// ============================================================

async function archiveBet(
  env: Env,
  bet: any,
  signal: any,
  matcher: any,
  cloudbet: any,
  oddsResult: OddsResult
): Promise<any> {

  const executionId =
    bet?.execution_id ||
    signal?.execution_id ||
    crypto.randomUUID();

  const signalMatchId =
    String(
      signal?.match_id ||
      signal?.id ||
      bet?.signal?.match_id ||
      ""
    ).trim();

  if (!signalMatchId) {
    return {
      success: false,
      error:
        "ARCHIVE_MATCH_ID_MISSING"
    };
  }

  const matchName =
    signal?.match_name ||
    signal?.match ||
    bet?.signal?.match ||
    displayMatch(signal) ||
    "";

  const cloudbetId =
    bet?.cloudbet?.id ||
    bet?.cloudbet?.event_id ||
    bet?.cloudbet_id ||
    cloudbet?.id ||
    cloudbet?.event_id ||
    extractMatchId(
      cloudbet
    ) ||
    null;

  const home =
    bet?.cloudbet?.home ||
    cloudbet?.home ||
    cloudbetHome(cloudbet) ||
    "";

  const away =
    bet?.cloudbet?.away ||
    cloudbet?.away ||
    cloudbetAway(cloudbet) ||
    "";

  const entryMinute =
    Number(
      signal?.entry_minute ??
      signal?.minute ??
      bet?.signal?.entry_minute ??
      0
    );

  const hunterScore =
    Number(
      signal?.hunter_score ??
      signal?.score ??
      bet?.signal?.hunter_score ??
      0
    );

  const matcherScoreValue =
    Number(
      matcher?.match_score ??
      matcher?.score ??
      matcher?.scoring?.total ??
      matcher?.team_match_score ??
      0
    );

  const matcherSource =
    matcherMethod(
      matcher
    ) ||
    matcher?.reason ||
    matcher?.classification ||
    null;

  const cloudbetVerified =
    cloudbetId
      ? 1
      : 0;

  const result =
    oddsResult?.success &&
    oddsResult?.odds != null
      ? "TARGET_READY"
      : "TARGET_NOT_READY";

  const reason =
    oddsResult?.success
      ? `ODDS_${oddsResult.odds}`
      : (
          oddsResult?.error ||
          null
        );

  try {
    await env.DB
      .prepare(`
        INSERT INTO bet_archive (
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
          cloudbet_match_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

        ON CONFLICT(match_id)
        DO UPDATE SET
          execution_id = excluded.execution_id,
          timestamp = excluded.timestamp,
          match_name = excluded.match_name,
          home = excluded.home,
          away = excluded.away,
          entry_minute = excluded.entry_minute,
          hunter_score = excluded.hunter_score,
          matcher_score = excluded.matcher_score,
          matcher_source = excluded.matcher_source,
          cloudbet_verified = excluded.cloudbet_verified,
          result = excluded.result,
          reason = excluded.reason,
          cloudbet_match_id = excluded.cloudbet_match_id
      `)
      .bind(
        executionId,
        nowISO(),
        signalMatchId,
        matchName,
        home,
        away,
        Number.isFinite(entryMinute)
          ? entryMinute
          : null,
        Number.isFinite(hunterScore)
          ? hunterScore
          : null,
        Number.isFinite(matcherScoreValue)
          ? matcherScoreValue
          : null,
        matcherSource,
        cloudbetVerified,
        result,
        reason,
        cloudbetId
      )
      .run();

    return {
      success: true,

      execution_id:
        executionId,

      match_id:
        signalMatchId,

      cloudbet_match_id:
        cloudbetId,

      odds:
        oddsResult?.odds ??
        null,

      result
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

// ============================================================
// BET BUILDER
// ============================================================

function buildBet(
  signal: any,
  matcher: any,
  verificationCloudbet: any,
  oddsResult: OddsResult
): any {

  const verifiedCloudbetId =
    verificationCloudbet?.id ||
    verificationCloudbet?.event_id ||
    extractMatchId(
      verificationCloudbet
    ) ||
    oddsResult?.event_id ||
    null;

  const cloudbetHomeName =
    verificationCloudbet?.home ||
    verificationCloudbet?.home_team ||
    signalHome(signal) ||
    "";

  const cloudbetAwayName =
    verificationCloudbet?.away ||
    verificationCloudbet?.away_team ||
    signalAway(signal) ||
    "";

  const odds =
    oddsResult?.odds ??
    extractOdds(
      verificationCloudbet
    );

  return {
    execution_id:
      crypto.randomUUID(),

    timestamp:
      nowISO(),

    mode:
      MODE,

    dry_run:
      DRY_RUN,

    betting_enabled:
      BETTING_ENABLED,

    stake_eur:
      BET_STAKE_EUR,

    signal: {
      match_id:
        signal?.match_id ||
        signal?.id ||
        null,

      home:
        signalHome(signal),

      away:
        signalAway(signal),

      entry_minute:
        signal?.entry_minute ??
        signal?.minute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.score ??
        null
    },

    matcher: {
      matched:
        !!matcher,

      match_score:
        matcherScore(
          matcher
        ) || null,

      confidence:
        matcher?.confidence ??
        null,

      classification:
        matcherClassification(
          matcher
        ),

      method:
        matcherMethod(
          matcher
        )
    },

    cloudbet: {
      id:
        verifiedCloudbetId,

      event_id:
        verifiedCloudbetId,

      home:
        cloudbetHomeName,

      away:
        cloudbetAwayName,

      status:
        verificationCloudbet?.status ||
        null,

      competition:
        verificationCloudbet?.competition ||
        null
    },

    target: {
      market:
        TARGET_MARKET,

      selection:
        TARGET_SELECTION,

      market_key:
        TARGET_MARKET_KEY,

      submarket_key:
        TARGET_SUBMARKET_KEY,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS
    },

    odds,

    odds_diagnostic:
      oddsResult,

    action:
      odds != null
        ? "TARGET_READY"
        : "PENDING_ODDS"
  };
}

// ============================================================
// TRACKER RESPONSE NORMALIZATION
// ============================================================

function trackerEntries(
  data: any
): any[] {

  if (!data) {
    return [];
  }

  if (
    Array.isArray(
      data.entries
    )
  ) {
    return data.entries;
  }

  if (
    Array.isArray(
      data.results
    )
  ) {
    return data.results;
  }

  if (
    Array.isArray(
      data.signals
    )
  ) {
    return data.signals;
  }

  if (
    Array.isArray(
      data.data?.entries
    )
  ) {
    return data.data.entries;
  }

  if (
    Array.isArray(
      data.data?.signals
    )
  ) {
    return data.data.signals;
  }

  return [];
}

// ============================================================
// GET MATCHER FOR SIGNAL
// ============================================================

function getMatcherForSignal(
  signal: any,
  matcherData: any
): any | null {

  const matches =
    matcherMatches(
      matcherData
    );

  const sourceSignalId =
    String(
      signal?.match_id ||
      signal?.id ||
      ""
    );

  const direct =
    matches.find(
      (m: any) => {

        const id =
          matcherSourceId(
            m
          );

        return (
          id &&
          sourceSignalId &&
          id ===
            sourceSignalId
        );
      }
    );

  if (
    direct &&
    validateMatcher(
      direct
    )
  ) {
    return direct;
  }

  const best =
    findBestMatcher(
      signal,
      matches
    );

  if (
    best &&
    validateMatcher(best)
  ) {
    return best;
  }

  // V6.0.1:
  // Do NOT accept weak matcher candidates by average fallback similarity.
  // If there is no exact V27-id match and no secure two-sided matcher result,
  // return null so runWorker() falls through to directCloudbetFallback(),
  // which requires TEAM_MATCH_MIN_SCORE on BOTH HOME and AWAY.
  return null;
}

// ============================================================
// MAIN WORKER
// ============================================================

async function runWorker(
  env: Env
): Promise<any> {

  const started =
    Date.now();

  const executionId =
    crypto.randomUUID();

  let pendingResult:
    any = null;

  try {
    pendingResult =
      await processPending(
        env
      );
  } catch (error) {
    pendingResult = {
      success: false,

      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  const [
    trackerResult,
    matcherResult,
    cloudbetResult
  ] =
    await Promise.all([
      fetchServiceJSON(
        env.TRACKER,
        "/entries",
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`,
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        CLOUDBET_LIVE_PATH,
        SERVICE_TIMEOUT_MS
      )
    ]);

  if (
    !trackerResult.ok
  ) {
    return {
      success: false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      mode:
        MODE,
      betting_enabled:
        BETTING_ENABLED,
      action:
        "RUN",
      execution_id:
        executionId,
      error:
        "TRACKER_FAILED",
      tracker:
        trackerResult,
      pending:
        pendingResult,
      processing_ms:
        Date.now() -
        started
    };
  }

  if (
    !matcherResult.ok
  ) {
    return {
      success: false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      mode:
        MODE,
      betting_enabled:
        BETTING_ENABLED,
      action:
        "RUN",
      execution_id:
        executionId,
      error:
        "MATCHER_FAILED",
      matcher:
        matcherResult,
      pending:
        pendingResult,
      processing_ms:
        Date.now() -
        started
    };
  }

  if (
    !cloudbetResult.ok
  ) {
    return {
      success: false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      mode:
        MODE,
      betting_enabled:
        BETTING_ENABLED,
      action:
        "RUN",
      execution_id:
        executionId,
      error:
        "CLOUDBET_LIVE_FAILED",
      cloudbet:
        cloudbetResult,
      pending:
        pendingResult,
      processing_ms:
        Date.now() -
        started
    };
  }

  const trackerSignals =
    trackerEntries(
      trackerResult.data
    );

  const matcherList =
    matcherMatches(
      matcherResult.data
    );

  const cloudbetAll =
    cloudbetMatches(
      cloudbetResult.data
    );

  const cloudbetLive =
    cloudbetAll.filter(
      isCloudbetLive
    );

  const hunterSignals =
    trackerSignals.filter(
      isHunterEntry
    );

  const entries: any[] =
    [];

  const pending: any[] =
    [];

  const skipped: any[] =
    [];

  const errors: any[] =
    [];

  let targetReady = 0;
  let targetPending = 0;
  let targetMissing = 0;

  for (
    const signal
    of hunterSignals
  ) {
    try {

      let matcher =
        getMatcherForSignal(
          signal,
          matcherResult.data
        );

      if (!matcher) {
        matcher =
          directCloudbetFallback(
            signal,
            cloudbetLive
          );
      }

      if (!matcher) {
        skipped.push({
          reason:
            "NO_MATCHER",
          signal
        });

        continue;
      }

      const verification =
        verifyCloudbet(
          signal,
          matcher,
          cloudbetLive
        );

      if (
        !verification.ok
      ) {
        skipped.push({
          reason:
            verification.error ||
            "CLOUDBET_VERIFICATION_FAILED",

          signal,

          matcher
        });

        continue;
      }

      const verifiedCloudbet =
        verification.cloudbet;

      const oddsResult =
        await resolveOddsOnce(
          env,
          verifiedCloudbet
        );

      const bet =
        buildBet(
          signal,
          matcher,
          verifiedCloudbet,
          oddsResult
        );

      if (
        oddsResult.success &&
        oddsResult.odds != null
      ) {
        targetReady++;

        const archive =
          await archiveBet(
            env,
            bet,
            signal,
            matcher,
            verifiedCloudbet,
            oddsResult
          );

        if (
          !archive.success
        ) {
          errors.push({
            type:
              "ARCHIVE_FAILED",

            signal,

            error:
              archive.error
          });

          continue;
        }

        entries.push({
          execution_id:
            bet.execution_id,

          cloudbet_id:
            bet.cloudbet?.id,

          home:
            bet.cloudbet?.home,

          away:
            bet.cloudbet?.away,

          odds:
            oddsResult.odds,

          odds_source:
            oddsResult.source ??
            null,

          odds_diagnostic:
            oddsResult.diagnostic,

          target: {
            market:
              TARGET_MARKET,

            selection:
              TARGET_SELECTION,

            market_key:
              TARGET_MARKET_KEY,

            submarket_key:
              TARGET_SUBMARKET_KEY,

            outcome:
              TARGET_OUTCOME,

            params:
              TARGET_PARAMS
          },

          action:
            "TARGET_READY",

          archive
        });

        continue;
      }

      targetMissing++;

      const pendingResultForBet =
        await savePending(
          env,
          bet.execution_id,
          bet,
          signal,
          matcher,
          verifiedCloudbet,
          oddsResult
        );

      if (
        !pendingResultForBet.success
      ) {
        errors.push({
          type:
            "PENDING_SAVE_FAILED",

          signal,

          error:
            pendingResultForBet.error
        });

        continue;
      }

      targetPending++;

      pending.push({
        execution_id:
          bet.execution_id,

        cloudbet_id:
          bet.cloudbet?.id,

        home:
          bet.cloudbet?.home,

        away:
          bet.cloudbet?.away,

        target: {
          market:
            TARGET_MARKET,

          selection:
            TARGET_SELECTION,

          market_key:
            TARGET_MARKET_KEY,

          submarket_key:
            TARGET_SUBMARKET_KEY,

          outcome:
            TARGET_OUTCOME,

          params:
            TARGET_PARAMS
        },

        odds:
          oddsResult.odds,

        odds_source:
          oddsResult.source ??
          null,

        odds_diagnostic:
          oddsResult.diagnostic,

        error:
          oddsResult.error,

        pending:
          pendingResultForBet
      });

    } catch (error) {
      errors.push({
        type:
          "SIGNAL_PROCESSING_ERROR",

        signal,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  return {
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    dry_run:
      DRY_RUN,

    betting_enabled:
      BETTING_ENABLED,

    action:
      "RUN",

    execution_id:
      executionId,

    config: {
      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      target_market:
        TARGET_MARKET_KEY,

      target_submarket:
        TARGET_SUBMARKET_KEY,

      target_outcome:
        TARGET_OUTCOME,

      target_params:
        TARGET_PARAMS,

      matcher_threshold:
        MATCHER_THRESHOLD,

      team_match_min_score:
        TEAM_MATCH_MIN_SCORE,

      character_similarity_min_score:
        CHARACTER_SIMILARITY_MIN_SCORE,

      containment_min_score:
        CONTAINMENT_MIN_SCORE,

      live_endpoint:
        CLOUDBET_LIVE_PATH,

      odds_endpoint:
        "/event + /line-test?id=CLOUDBET_EVENT_ID",

      odds_event_retry:
        false,

      odds_event_max_retries:
        ODDS_EVENT_MAX_RETRIES,

      odds_event_retry_delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      retry_same_event:
        true,

      retry_same_market:
        true,

      retry_same_line:
        true,

      persistent_pending_retry:
        true
    },

    source: {
      tracker:
        "/entries",

      matcher:
        "/match",

      cloudbet:
        "CLOUDBET SERVICE BINDING /live",

      cloudbet_live_parser:
        "CLOUDBET /live → events[]",

      cloudbet_line_parser:
        "CLOUDBET /line-test → POST /lines"
    },

    stats: {
      tracker_signals:
        trackerSignals.length,

      hunter_signals:
        hunterSignals.length,

      matcher_matches:
        matcherList.length,

      cloudbet_events:
        cloudbetAll.length,

      cloudbet_live:
        cloudbetLive.length,

      target_ready:
        targetReady,

      target_pending:
        targetPending,

      target_missing:
        targetMissing,

      entries:
        entries.length,

      skipped:
        skipped.length,

      errors:
        errors.length
    },

    pending_retry:
      pendingResult,

    entries,

    pending,

    skipped,

    errors,

    processing_ms:
      Date.now() -
      started
  };
}

// ============================================================
// DIAGNOSTIC
// ============================================================

async function runDiagnostic(
  env: Env
): Promise<any> {

  const started =
    Date.now();

  const [
    tracker,
    matcher,
    cloudbet
  ] =
    await Promise.all([
      fetchServiceJSON(
        env.TRACKER,
        "/entries",
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`,
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        CLOUDBET_LIVE_PATH,
        SERVICE_TIMEOUT_MS
      )
    ]);

  const trackerSignals =
    tracker.ok
      ? trackerEntries(
          tracker.data
        )
      : [];

  const hunterDiagnostics =
    trackerSignals.map(
      signal =>
        hunterFilterDiagnostic(
          signal
        )
    );

  const hunterSignals =
    trackerSignals.filter(
      isHunterEntry
    );

  const matcherParsed =
    matcher.ok
      ? matcherMatches(
          matcher.data
        )
      : [];

  const cloudbetParsed =
    cloudbet.ok
      ? cloudbetMatches(
          cloudbet.data
        )
      : [];

  const cloudbetLive =
    cloudbetParsed.filter(
      isCloudbetLive
    );

  const targetDiagnostics =
    cloudbetLive.map(
      (event: any) => {

        const target =
          findTargetSelection(
            event
          );

        return {
          id:
            extractMatchId(
              event
            ) ||
            getCloudbetEventId(
              event
            ),

          home:
            cloudbetHome(event) ||
            null,

          away:
            cloudbetAway(event) ||
            null,

          status:
            event?.status ||
            null,

          live:
            isCloudbetLive(
              event
            ),

          target_found:
            !!target,

          target:
            target
              ? {
                  outcome:
                    target.outcome,

                  params:
                    target.params,

                  price:
                    target.price,

                  status:
                    target.status,

                  market:
                    target.market,

                  submarket:
                    target.submarket
                }
              : null,

          odds_diagnostic:
            buildOddsDiagnostic(
              event
            )
        };
      }
    );

  return {
    success:
      tracker.ok &&
      matcher.ok &&
      cloudbet.ok,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting_enabled:
      BETTING_ENABLED,

    action:
      "DIAGNOSTIC",

    config: {
      live_endpoint:
        CLOUDBET_LIVE_PATH,

      odds_endpoint:
        "/event + /line-test?id=CLOUDBET_EVENT_ID",

      tracker_endpoint:
        "/entries",

      matcher_endpoint:
        `/match?threshold=${MATCHER_THRESHOLD}`,

      target_market:
        TARGET_MARKET_KEY,

      target_submarket:
        TARGET_SUBMARKET_KEY,

      target_outcome:
        TARGET_OUTCOME,

      target_params:
        TARGET_PARAMS,

      persistent_retry:
        true,

      max_retries:
        ODDS_EVENT_MAX_RETRIES,

      retry_delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      retry_same_event:
        true,

      retry_same_market:
        true,

      retry_same_line:
        true
    },

    tracker: {
      ok:
        tracker.ok,

      status:
        tracker.status,

      latency_ms:
        tracker.latency_ms,

      endpoint:
        "/entries",

      total_signals:
        trackerSignals.length,

      hunter_signals:
        hunterSignals.length,

      raw:
        tracker.data,

      hunter_filter:
        hunterDiagnostics,

      error:
        tracker.error ||
        null
    },

    matcher: {
      ok:
        matcher.ok,

      status:
        matcher.status,

      latency_ms:
        matcher.latency_ms,

      endpoint:
        `/match?threshold=${MATCHER_THRESHOLD}`,

      matches:
        matcherParsed.length,

      raw:
        matcher.data,

      error:
        matcher.error ||
        null
    },

    cloudbet: {
      ok:
        cloudbet.ok,

      status:
        cloudbet.status,

      latency_ms:
        cloudbet.latency_ms,

      endpoint:
        CLOUDBET_LIVE_PATH,

      parser:
        "CLOUDBET /live → events[]",

      events_received:
        cloudbetParsed.length,

      live_events:
        cloudbetLive.length,

      target_events:
        targetDiagnostics.filter(
          x =>
            x.target_found
        ).length,

      error:
        cloudbet.error ||
        null
    },

    target_diagnostics:
      targetDiagnostics,

    processing_ms:
      Date.now() -
      started
  };
}

// ============================================================
// PUBLIC TRACKER PROXY
// ============================================================

async function runEntriesProxy(
  env: Env
): Promise<any> {

  const result =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries",
      SERVICE_TIMEOUT_MS
    );

  return {
    success:
      result.ok,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    proxy:
      "TRACKER",

    endpoint:
      "/entries",

    status:
      result.status,

    latency_ms:
      result.latency_ms,

    data:
      result.data,

    error:
      result.error ||
      null
  };
}

// ============================================================
// PUBLIC MATCHER PROXY
// ============================================================

async function runMatchProxy(
  env: Env,
  url: URL
): Promise<any> {

  const threshold =
    url.searchParams.get(
      "threshold"
    ) ||
    String(
      MATCHER_THRESHOLD
    );

  const endpoint =
    `/match?threshold=${encodeURIComponent(
      threshold
    )}`;

  const result =
    await fetchServiceJSON(
      env.MATCHER,
      endpoint,
      SERVICE_TIMEOUT_MS
    );

  return {
    success:
      result.ok,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    proxy:
      "MATCHER",

    endpoint,

    threshold:

      Number(
        threshold
      ),

    status:
      result.status,

    latency_ms:
      result.latency_ms,

    data:
      result.data,

    parsed_matches:
      result.ok
        ? matcherMatches(
            result.data
          ).length
        : 0,

    error:
      result.error ||
      null
  };
}

// ============================================================
// HEALTH
// ============================================================

function healthResponse():
  Response {

  return json({
    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    dry_run:
      DRY_RUN,

    betting_enabled:
      BETTING_ENABLED,

    target: {
      market:
        TARGET_MARKET,

      selection:
        TARGET_SELECTION,

      market_key:
        TARGET_MARKET_KEY,

      submarket_key:
        TARGET_SUBMARKET_KEY,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS
    },

    cloudbet: {
      live_endpoint:
        CLOUDBET_LIVE_PATH,

      live_parser:
        "CLOUDBET /live → events[]",

      odds_endpoint:
        "/event + /line-test?id=CLOUDBET_EVENT_ID",

      persistent_retry:
        true,

      max_retries:
        ODDS_EVENT_MAX_RETRIES,

      retry_delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      retry_same_event:
        true,

      retry_same_market:
        true,

      retry_same_line:
        true
    },

    diagnostics: {
      tracker:
        "/entries",

      matcher:
        "/match",

      full:
        "/diagnostic"
    },

    status:
      "OK"
  });
}

// ============================================================
// FETCH ROUTER
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
      url.pathname;

    try {

      // ------------------------------------------------------
      // ROOT
      // ------------------------------------------------------

      if (
        path === "/" ||
        path === ""
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

          betting_enabled:
            BETTING_ENABLED,

          endpoints: [
            "/",
            "/health",
            "/run",
            "/diagnostic",
            "/entries",
            "/match"
          ],

          target: {
            market:
              TARGET_MARKET,

            selection:
              TARGET_SELECTION,

            exact:
              `${TARGET_MARKET_KEY} / ${TARGET_SUBMARKET_KEY} / ${TARGET_OUTCOME} / ${TARGET_PARAMS}`
          },

          cloudbet_live:
            CLOUDBET_LIVE_PATH
        });
      }

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        path === "/health"
      ) {
        return healthResponse();
      }

      // ------------------------------------------------------
      // PUBLIC TRACKER /entries
      // ------------------------------------------------------

      if (
        path === "/entries"
      ) {
        const result =
          await runEntriesProxy(
            env
          );

        return json(
          result
        );
      }

      // ------------------------------------------------------
      // PUBLIC MATCHER /match
      // ------------------------------------------------------

      if (
        path === "/match"
      ) {
        const result =
          await runMatchProxy(
            env,
            url
          );

        return json(
          result
        );
      }

      // ------------------------------------------------------
      // DIAGNOSTIC
      // ------------------------------------------------------

      if (
        path === "/diagnostic"
      ) {
        const result =
          await runDiagnostic(
            env
          );

        return json(
          result
        );
      }

      // ------------------------------------------------------
      // RUN
      // ------------------------------------------------------

      if (
        path === "/run"
      ) {
        const result =
          await runWorker(
            env
          );

        return json(
          result
        );
      }

      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------

      return json(
        {
          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          error:
            "Not found",

          path
        },
        404
      );

    } catch (error) {

      return json(
        {
          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          error:
            error instanceof Error
              ? error.message
              : String(error),

          path
        },
        500
      );
    }
  }
};
