// ============================================================
// CLOUDBET BET WORKER V5.9.6
// DRY RUN · PERSISTENT ODDS RETRY
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V5.9.6 FIXES:
// - CLOUDBET binding uses /live
// - /events remains internal to Cloudbet detector
// - Exact verified Cloudbet event ID is preserved
// - Alphanumeric Cloudbet event IDs are supported
// - /event?id=<EXACT_EVENT_ID> used for odds
// - Persistent retry: SAME EVENT / SAME MARKET / SAME LINE
// - OddsResult uses success consistently
// - All target constants explicitly defined
// - No event switching during retry
// - No market switching during retry
// - No line switching during retry
// - REAL BETTING DISABLED
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

const VERSION = "V5.9.6";

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
//
// IMPORTANT:
// The detector exposes /live.
// The detector itself internally calls Cloudbet /events.

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
  // Kazakhstan
  "akademia ontustyk":
    "akademiya ontustyk",

  "akademiya ontustyk":
    "akademiya ontustyk",

  // Common abbreviations
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

  // English
  "united":
    "utd",

  "utd":
    "utd",

  // Common transliteration variants
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
  if (value === null || value === undefined) {
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
    resolve => setTimeout(resolve, ms)
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

  for (const separator of separators) {
    const index =
      text
        .toLowerCase()
        .indexOf(
          separator.toLowerCase()
        );

    if (index >= 0) {
      return {
        home:
          text.slice(
            0,
            index
          ).trim(),

        away:
          text.slice(
            index +
            separator.length
          ).trim()
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
      typeof direct === "object"
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
      typeof direct === "object"
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
  const aa = a || "";
  const bb = b || "";

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

  return previous[bb.length];
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

  if (!aTokens.length ||
      !bTokens.length) {
    return 0;
  }

  const aSet =
    new Set(aTokens);

  const bSet =
    new Set(bTokens);

  let common = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
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
      home >= TEAM_MATCH_MIN_SCORE &&
      away >= TEAM_MATCH_MIN_SCORE
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
      Date.now() - started;

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
      Date.now() - started;

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

  // IMPORTANT:
  // Cloudbet event IDs may be alphanumeric,
  // e.g. 18dwh5.
  //
  // Do NOT require numeric IDs.

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
    typeof data.data === "object"
  ) {
    data =
      data.data;
  }

  return data || {};
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

function isHunterEntry(
  signal: any
): boolean {
  if (!signal) {
    return false;
  }

  const status =
    String(
      signal.status ||
      signal.state ||
      ""
    ).toUpperCase();

  if (
    status &&
    ![
      "ENTRY",
      "SIGNAL",
      "TRACKING",
      "ACTIVE",
      "HUNTER"
    ].includes(status)
  ) {
    return false;
  }

  const home =
    signal.home ||
    signal.home_team ||
    signal.home_name;

  const away =
    signal.away ||
    signal.away_team ||
    signal.away_name;

  if (!home || !away) {
    return false;
  }

  const minute =
    Number(
      signal.entry_minute ??
      signal.minute ??
      signal.elapsed ??
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
  return safe(
    signal?.home ||
    signal?.home_team ||
    signal?.home_name ||
    ""
  );
}

function signalAway(
  signal: any
): string {
  return safe(
    signal?.away ||
    signal?.away_team ||
    signal?.away_name ||
    ""
  );
}

function signalMatch(
  signal: any
): string {
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
    0
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
    matcherScore(matcher);

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
    score < MIN_MATCHER_SCORE
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
    const matcher of matches
  ) {
    const mh =
      extractHome(matcher);

    const ma =
      extractAway(matcher);

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

// ============================================================
// TEAM SIMILARITY
// ============================================================

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
// CLOUDbet NORMALIZATION
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
    const events: any[] = [];

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
    const events: any[] = [];

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
    ) ||
    null
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

  // ----------------------------------------------------------
  // MATCHER-PROVIDED EVENT ID
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // DIRECT FALLBACK
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // NORMALIZED TARGET
  // ----------------------------------------------------------

  if (
    event.target_1h_over_05 === true
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

  // ----------------------------------------------------------
  // STANDARD SELECTIONS
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // RECURSIVE RAW SEARCH
  // ----------------------------------------------------------

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
  marketContext: string | null,
  submarketContext: string | null
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
      const item of value
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

  // ----------------------------------------------------------
  // CURRENT OBJECT AS SELECTION
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // SELECTIONS
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // COMMON NESTED CONTAINERS
  // ----------------------------------------------------------

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
// ODDS EXTRACTION
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

// ============================================================
// ODDS DIAGNOSTIC
// ============================================================

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
      displayMatch(
        event
      ),

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
// EXACT ODDS RESULT
// ============================================================

interface OddsResult {
  success: boolean;
  event_id: string | null;
  odds: number | null;
  event: Obj | null;
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

  // IMPORTANT:
  // Preserve the exact verified Cloudbet event ID.

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
      diagnostic: {
        error:
          "CLOUDBET_EVENT_ID_MISSING"
      },
      error:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  try {

    const event =
      await fetchCloudbetEvent(
        env,
        eventId
      );

    const diagnostic =
      buildOddsDiagnostic(
        event
      );

    const odds =
      extractOdds(
        event
      );

    if (
      odds === null
    ) {
      return {
        success: false,
        event_id:
          eventId,
        odds: null,
        event,
        diagnostic,
        error:
          "TARGET_ODDS_NOT_AVAILABLE"
      };
    }

    return {
      success: true,
      event_id:
        eventId,
      odds,
      event,
      diagnostic
    };

  } catch (error) {

    const diagnostic =
      error instanceof
        ServiceRequestError
        ? error.toJSON()
        : {
            error:
              error instanceof
              Error
                ? error.message
                : String(error)
          };

    return {
      success: false,
      event_id:
        eventId,
      odds: null,
      event: null,
      diagnostic,
      error:
        error instanceof
        Error
          ? error.message
          : String(error)
    };
  }
}

// ============================================================
// ODDS RETRY
// ============================================================
//
// One attempt only.
//
// Persistent retry is handled by pending_odds.
//
// /run does NOT wait for 20 attempts.
//

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
  last_error?: string | null;
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
          next_check_at = ?,
          last_error = ?
        WHERE cloudbet_id = ?
      `)
      .bind(
        executionId,
        payloadJson,
        nowISO(),
        nextCheck,
        oddsResult.error ||
          null,
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

  await env.DB
    .prepare(`
      INSERT INTO pending_odds (
        execution_id,
        cloudbet_id,
        payload_json,
        created_at,
        updated_at,
        next_check_at,
        retry_count,
        missing_count,
        last_error
      )
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
    `)
    .bind(
      executionId,
      cloudbetId,
      payloadJson,
      nowISO(),
      nowISO(),
      nextCheck,
      oddsResult.error ||
        null
    )
    .run();

  return {
    success: true,
    action:
      "CREATED_PENDING",
    cloudbet_id:
      cloudbetId,
    retry_count: 0,
    next_check_at:
      nextCheck
  };
}

// ============================================================
// PENDING RETRY HELPERS
// ============================================================

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
      row.retry_count || 0
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
      .bind(row.id)
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
        next_check_at = ?,
        last_error = ?
      WHERE id = ?
    `)
    .bind(
      nextRetry,
      nowISO(),
      nextCheck,
      error,
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
      row.missing_count || 0
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
      .bind(row.id)
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
        next_check_at = ?,
        last_error = ?
      WHERE id = ?
    `)
    .bind(
      nextMissing,
      nowISO(),
      nextCheck,
      error,
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
    // still valid
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
//
// CRITICAL:
//
// - SAME Cloudbet event ID
// - NO event switching
// - NO market switching
// - NO line switching
// - EXACT 1H OVER 0.5
// ============================================================

async function processPending(
  env: Env
): Promise<any> {

  const rows =
    await loadPending(env);

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

  const results: any[] = [];

  // One /live call for all pending records.
  const liveResponse =
    await fetchServiceJSON(
      env.CLOUDBET,
      CLOUDBET_LIVE_PATH,
      SERVICE_TIMEOUT_MS
    );

  if (!liveResponse.ok) {
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

    // ========================================================
    // SAME EVENT ID ONLY
    // ========================================================

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

    // Force the verified original event ID.
    const retryEvent = {
      ...liveEvent,

      id:
        cloudbetId,

      event_id:
        cloudbetId
    };

    // EXACT SAME EVENT.
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

    // ========================================================
    // ODDS FOUND
    // ========================================================

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
        ...(originalBet.cloudbet || {}),
        ...(liveEvent || {}),

        id:
          cloudbetId,

        event_id:
          cloudbetId
      },

      odds: {
        ...(originalBet.odds || {}),
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
      .bind(row.id)
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

  const cloudbetId =
    bet?.cloudbet?.id ||
    bet?.cloudbet?.event_id ||
    bet?.cloudbet_id ||
    cloudbet?.id ||
    cloudbet?.event_id ||
    extractMatchId(
      cloudbet
    );

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

  const odds =
    oddsResult?.odds ??
    bet?.odds ??
    null;

  try {

    await env.DB
      .prepare(`
        INSERT INTO bet_archive (
          execution_id,
          timestamp,
          cloudbet_id,
          home,
          away,
          odds,
          stake_eur,
          market,
          selection,
          payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        executionId,
        nowISO(),
        cloudbetId ||
          null,
        home,
        away,
        odds,
        BET_STAKE_EUR,
        BET_MARKET,
        BET_SELECTION,
        JSON.stringify({
          bet,
          signal,
          matcher,
          cloudbet,
          odds:
            oddsResult
        })
      )
      .run();

    return {
      success: true,

      execution_id:
        executionId,

      cloudbet_id:
        cloudbetId,

      odds
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
    signal?.home ||
    "";

  const cloudbetAwayName =
    verificationCloudbet?.away ||
    verificationCloudbet?.away_team ||
    signal?.away ||
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
        signal?.home ||
        "",

      away:
        signal?.away ||
        "",

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
        matcher?.match_score ??
        matcher?.score ??
        null,

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

  // ----------------------------------------------------------
  // DIRECT SOURCE ID
  // ----------------------------------------------------------

  const direct =
    matches.find(
      (m: any) => {

        const id =
          String(
            m?.match_id ||
            m?.source_match_id ||
            m?.flashscore_id ||
            ""
          );

        return (
          id &&
          sourceSignalId &&
          id ===
            sourceSignalId
        );
      }
    );

  if (direct) {
    return direct;
  }

  // ----------------------------------------------------------
  // BEST MATCH
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // MANUAL TEAM FALLBACK
  // ----------------------------------------------------------

  const home =
    normalizeTeam(
      signalHome(signal)
    );

  const away =
    normalizeTeam(
      signalAway(signal)
    );

  let bestFallback:
    any | null = null;

  let bestScore = 0;

  for (
    const m of matches
  ) {

    const mh =
      normalizeTeam(
        extractHome(m)
      );

    const ma =
      normalizeTeam(
        extractAway(m)
      );

    const hs =
      teamSimilarity(
        home,
        mh
      );

    const as =
      teamSimilarity(
        away,
        ma
      );

    const score =
      (hs + as) / 2;

    if (
      score >
      bestScore
    ) {
      bestScore =
        score;

      bestFallback = {
        ...m,

        fallback_score:
          score,

        match_score:
          score
      };
    }
  }

  if (
    bestFallback &&
    bestScore >=
      MATCHER_THRESHOLD
  ) {
    return bestFallback;
  }

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

  // ----------------------------------------------------------
  // PERSISTENT PENDING RETRY
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // TRACKER + MATCHER + CLOUDBET /live
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // TRACKER
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // MATCHER
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // CLOUDBET
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // NORMALIZE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // RESULTS
  // ----------------------------------------------------------

  const entries: any[] = [];
  const pending: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];

  let targetReady = 0;
  let targetPending = 0;
  let targetMissing = 0;

  // ----------------------------------------------------------
  // PROCESS HUNTER SIGNALS
  // ----------------------------------------------------------

  for (
    const signal
    of hunterSignals
  ) {

    try {

      // ======================================================
      // STEP 1 — MATCHER
      // ======================================================

      let matcher =
        getMatcherForSignal(
          signal,
          matcherResult.data
        );

      // ======================================================
      // STEP 2 — DIRECT CLOUDBET FALLBACK
      // ======================================================

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

      // ======================================================
      // STEP 3 — STRICT CLOUDBET VERIFICATION
      // ======================================================

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

      // ======================================================
      // STEP 4 — EXACT TARGET ODDS
      // ======================================================

      const oddsResult =
        await resolveOddsOnce(
          env,
          verifiedCloudbet
        );

      // ======================================================
      // STEP 5 — BUILD BET
      // ======================================================

      const bet =
        buildBet(
          signal,
          matcher,
          verifiedCloudbet,
          oddsResult
        );

      // ======================================================
      // TARGET AVAILABLE
      // ======================================================

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

      // ======================================================
      // TARGET ODDS MISSING
      //
      // SAVE SAME EVENT ID FOR PERSISTENT RETRY.
      // ======================================================

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

  // ----------------------------------------------------------
  // FINAL RESPONSE
  // ----------------------------------------------------------

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
        "/event?id=CLOUDBET_EVENT_ID",

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
        "CLOUDBET /live → events[]"
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

  const hunterSignals =
    tracker.ok
      ? trackerEntries(
          tracker.data
        ).filter(
          isHunterEntry
        )
      : [];

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
        "/event?id=CLOUDBET_EVENT_ID",

      cloudbet_live_parser:
        "CLOUDBET /live → events[]",

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

      hunter_signals:
        hunterSignals.length,

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
        matcher.ok
          ? matcherMatches(
              matcher.data
            ).length
          : 0,

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
        "/event?id=CLOUDBET_EVENT_ID",

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
            "/diagnostic"
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
