// ============================================================
// CLOUDBET BET WORKER V5.9.5
// DRY RUN · EXACT 1H TOTAL GOALS OVER 0.5
//
// FLOW:
// TRACKER → MATCHER → DIRECT CLOUDBET FALLBACK → CLOUDBET /live
//       → EXACT TARGET → CLOUDBET /event?id=EVENT_ID
//
// V5.9.5 FIX:
// - CLOUDBET service binding uses /live
// - NEVER call /events through CLOUDBET binding
// - /live returns normalized events[]
// - /event?id=EVENT_ID is used for exact odds
// - SAME event ID preserved
// - NO event switching
// - NO market switching
// - NO line switching
//
// RETRY:
// - /run performs ONE /event attempt
// - Missing odds → PENDING_ODDS
// - Pending retry uses SAME Cloudbet event ID
// - Maximum 20 pending odds attempts
// - 30 sec retry delay
//
// TARGET:
// - Market: soccer.total_goals_period_first_half
// - Submarket: period=1h
// - Outcome: over
// - Params: total=0.5
//
// REAL BETTING:
// - DISABLED
// - DRY RUN ONLY
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type Obj = Record<string, any>;

const VERSION = "V5.9.5";

const MODE = "DRY_RUN";
const DRY_RUN = true;
const BETTING_ENABLED = false;

const BET_STAKE_EUR = 10;
const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

// ─── EXACT TARGET ──────────────────────────────────────────

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

// ─── CLOUDBET LIVE SOURCE ─────────────────────────────────
//
// IMPORTANT V5.9.5:
//
// CLOUDBET is a Service Binding to the
// cloudbet-live-soccer-detector.
//
// The detector exposes /live publicly.
// The detector itself internally calls Cloudbet /events.
//
// Therefore bet-worker MUST NOT call /events here.

const CLOUDBET_LIVE_PATH =
  "/live";

// ─── TIMEOUT / RETRY ───────────────────────────────────────

const SERVICE_TIMEOUT_MS = 10_000;

const ODDS_EVENT_MAX_RETRIES = 20;
const ODDS_EVENT_RETRY_DELAY_MS = 30_000;

const MAX_MISSING_CHECKS = 3;

// ─── MATCHER ───────────────────────────────────────────────

const MATCHER_THRESHOLD = 0.20;
const MIN_MATCHER_SCORE = 0.20;

const TEAM_MATCH_MIN_SCORE = 0.70;
const CHARACTER_SIMILARITY_MIN_SCORE = 0.70;
const CONTAINMENT_MIN_SCORE = 0.75;
const TOKEN_MATCH_MIN_SCORE = 0.75;

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const ALLOWED_SIGNAL_TYPE =
  "HUNTER_ENTRY";

// ─── TEAM ALIASES ──────────────────────────────────────────

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

// ─── BASIC ─────────────────────────────────────────────────

function safe(v: any): string {
  return String(v ?? "").trim();
}

function norm(v: any): string {
  return safe(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

// ─── TEAM NORMALIZATION ────────────────────────────────────

function normalizeTeam(
  value: any
): string {
  let result = norm(value);

  for (
    const [alias, full]
    of Object.entries(TEAM_ALIASES)
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
        `$1${full}`
      );
  }

  return result
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(
      x =>
        x &&
        !GENERIC_WORDS.has(x) &&
        !/^\d+$/.test(x)
    )
    .join(" ")
    .trim();
}

function teamTokens(
  value: any
): string[] {
  return normalizeTeam(value)
    .split(" ")
    .filter(
      x => x.length >= 3
    );
}

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {
  const text = safe(value);

  for (
    const separator of [
      " - ",
      " v ",
      " vs ",
      " VS ",
      " @ "
    ]
  ) {
    const i =
      text.indexOf(separator);

    if (i >= 0) {
      return {
        home:
          text.slice(0, i).trim(),
        away:
          text
            .slice(
              i + separator.length
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
  m: Obj
): string {
  const direct =
    m?.v27?.home ??
    m?.v27?.homeTeam ??
    m?.v27?.home_name ??
    m?.home ??
    m?.homeTeam ??
    m?.home_name ??
    m?.home?.name ??
    m?.home_team?.name ??
    m?.teams?.home?.name;

  if (
    typeof direct === "string" &&
    direct.trim()
  ) {
    return direct.trim();
  }

  return splitMatch(
    m?.match ??
    m?.name ??
    m?.event_name
  ).home;
}

function extractAway(
  m: Obj
): string {
  const direct =
    m?.v27?.away ??
    m?.v27?.awayTeam ??
    m?.v27?.away_name ??
    m?.away ??
    m?.awayTeam ??
    m?.away_name ??
    m?.away?.name ??
    m?.away_team?.name ??
    m?.teams?.away?.name;

  if (
    typeof direct === "string" &&
    direct.trim()
  ) {
    return direct.trim();
  }

  return splitMatch(
    m?.match ??
    m?.name ??
    m?.event_name
  ).away;
}

function displayMatch(
  m: Obj
): string {
  const direct =
    safe(
      m?.match ??
      m?.name ??
      m?.event_name
    );

  if (direct) {
    return direct;
  }

  const home =
    extractHome(m);

  const away =
    extractAway(m);

  if (!home && !away) {
    return "-";
  }

  return `${home} - ${away}`.trim();
}

function extractMatchId(
  m: Obj
): string {
  return safe(
    m?.id ??
    m?.match_id ??
    m?.matchId ??
    m?.event_id ??
    m?.eventId ??
    m?.key
  );
}

function teamsPresent(
  home: any,
  away: any
): boolean {
  return (
    normalizeTeam(home).length > 0 &&
    normalizeTeam(away).length > 0
  );
}

// ─── TEAM MATCHING ─────────────────────────────────────────

function levenshtein(
  a: string,
  b: string
): number {
  const aa = norm(a);
  const bb = norm(b);

  const previous =
    Array.from(
      {
        length:
          bb.length + 1
      },
      (_, i) => i
    );

  for (
    let i = 1;
    i <= aa.length;
    i++
  ) {
    const current = [i];

    for (
      let j = 1;
      j <= bb.length;
      j++
    ) {
      current[j] =
        aa[i - 1] === bb[j - 1]
          ? previous[j - 1]
          : Math.min(
              previous[j - 1] + 1,
              current[j - 1] + 1,
              previous[j] + 1
            );
    }

    for (
      let j = 0;
      j < current.length;
      j++
    ) {
      previous[j] = current[j];
    }
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

  const max =
    Math.max(
      aa.length,
      bb.length
    );

  if (!max) {
    return 0;
  }

  return Math.max(
    0,
    1 -
      levenshtein(
        aa,
        bb
      ) / max
  );
}

function teamScore(
  a: string,
  b: string
): Obj {
  const aa =
    normalizeTeam(a);

  const bb =
    normalizeTeam(b);

  if (!aa || !bb) {
    return {
      score: 0,
      method: "EMPTY",
      accepted: false
    };
  }

  if (aa === bb) {
    return {
      score: 1,
      method: "EXACT",
      accepted: true
    };
  }

  if (
    aa.includes(bb) ||
    bb.includes(aa)
  ) {
    const score =
      Math.max(
        CONTAINMENT_MIN_SCORE,
        Math.min(
          aa.length,
          bb.length
        ) /
          Math.max(
            aa.length,
            bb.length
          )
      );

    return {
      score,
      method: "CONTAINMENT",
      accepted:
        score >=
        TEAM_MATCH_MIN_SCORE
    };
  }

  const aTokens =
    new Set(
      teamTokens(aa)
    );

  const bTokens =
    new Set(
      teamTokens(bb)
    );

  const common =
    [...aTokens].filter(
      x => bTokens.has(x)
    ).length;

  const denominator =
    Math.max(
      aTokens.size,
      bTokens.size
    );

  const ratio =
    denominator > 0
      ? common / denominator
      : 0;

  if (
    common >= 1 &&
    ratio >= TOKEN_MATCH_MIN_SCORE
  ) {
    return {
      score: ratio,
      method: "TOKEN",
      accepted: true
    };
  }

  const score =
    characterSimilarity(
      aa,
      bb
    );

  return {
    score,
    method: "CHARACTER",
    accepted:
      score >=
      CHARACTER_SIMILARITY_MIN_SCORE
  };
}

function twoSidedTeamScore(
  homeA: string,
  awayA: string,
  homeB: string,
  awayB: string
): Obj {
  const normalHome =
    teamScore(
      homeA,
      homeB
    );

  const normalAway =
    teamScore(
      awayA,
      awayB
    );

  const normal =
    Math.min(
      normalHome.score,
      normalAway.score
    );

  const reverseHome =
    teamScore(
      homeA,
      awayB
    );

  const reverseAway =
    teamScore(
      awayA,
      homeB
    );

  const reverse =
    Math.min(
      reverseHome.score,
      reverseAway.score
    );

  const normalAccepted =
    normalHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    normalAway.score >=
      TEAM_MATCH_MIN_SCORE;

  const reverseAccepted =
    reverseHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    reverseAway.score >=
      TEAM_MATCH_MIN_SCORE;

  if (
    normalAccepted &&
    normal >= reverse
  ) {
    return {
      matched: true,
      direction: "NORMAL",
      combined_score: normal,
      home_score:
        normalHome.score,
      away_score:
        normalAway.score,
      home_method:
        normalHome.method,
      away_method:
        normalAway.method
    };
  }

  if (reverseAccepted) {
    return {
      matched: true,
      direction: "REVERSED",
      combined_score: reverse,
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      home_method:
        reverseHome.method,
      away_method:
        reverseAway.method
    };
  }

  return {
    matched: false,
    direction: null,
    combined_score:
      Math.max(
        normal,
        reverse
      ),
    home_score:
      Math.max(
        normalHome.score,
        reverseHome.score
      ),
    away_score:
      Math.max(
        normalAway.score,
        reverseAway.score
      ),
    normal: {
      combined_score: normal,
      home_score:
        normalHome.score,
      away_score:
        normalAway.score,
      home_method:
        normalHome.method,
      away_method:
        normalAway.method
    },
    reverse: {
      combined_score: reverse,
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      home_method:
        reverseHome.method,
      away_method:
        reverseAway.method
    }
  };
}

// ─── SERVICE ERROR ─────────────────────────────────────────

class ServiceRequestError
  extends Error {

  service: string;
  path: string;
  code: string;
  status: number | null;

  constructor(
    service: string,
    path: string,
    code: string,
    message: string,
    status: number | null = null
  ) {
    super(message);

    this.name =
      "ServiceRequestError";

    this.service =
      service;

    this.path =
      path;

    this.code =
      code;

    this.status =
      status;
  }

  toJSON(): Obj {
    return {
      service:
        this.service,

      path:
        this.path,

      code:
        this.code,

      status:
        this.status,

      message:
        this.message
    };
  }
}

// ─── SERVICE FETCH WITH TIMEOUT ────────────────────────────

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  serviceName = "UNKNOWN",
  timeoutMs =
    SERVICE_TIMEOUT_MS
): Promise<Obj> {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await service.fetch(
        new Request(
          `https://service${path}`,
          {
            method: "GET",

            headers: {
              accept:
                "application/json"
            },

            signal:
              controller.signal
          }
        )
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw new ServiceRequestError(
        serviceName,
        path,
        "HTTP_ERROR",
        `HTTP ${response.status}: ${text.slice(
          0,
          500
        )}`,
        response.status
      );
    }

    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new ServiceRequestError(
        serviceName,
        path,
        "INVALID_JSON",
        `Invalid JSON from ${serviceName} ${path}`
      );
    }

  } catch (error) {

    if (
      error instanceof
      ServiceRequestError
    ) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ServiceRequestError(
        serviceName,
        path,
        "SERVICE_TIMEOUT",
        `${serviceName} ${path} timed out after ${timeoutMs}ms`
      );
    }

    throw new ServiceRequestError(
      serviceName,
      path,
      "SERVICE_FETCH_ERROR",
      error instanceof Error
        ? error.message
        : String(error)
    );

  } finally {
    clearTimeout(timer);
  }
}

// ─── CLOUDBET EVENT ────────────────────────────────────────
//
// IMPORTANT:
// /event?id=EVENT_ID is exposed by the Cloudbet detector.
// The event ID MUST come from the verified /live result.
// No hard-coded ID is allowed.

async function fetchCloudbetEvent(
  env: Env,
  eventId: string
): Promise<Obj> {

  if (!eventId) {
    throw new ServiceRequestError(
      "CLOUDBET",
      "/event?id=",
      "INVALID_CLOUDBET_EVENT_ID",
      "CLOUDBET_EVENT_ID_MISSING"
    );
  }

  const data =
    await fetchServiceJSON(
      env.CLOUDBET,
      `/event?id=${encodeURIComponent(
        eventId
      )}`,
      "CLOUDBET",
      SERVICE_TIMEOUT_MS
    );

  if (
    data?.data &&
    typeof data.data ===
      "object" &&
    !Array.isArray(
      data.data
    )
  ) {
    return data.data;
  }

  return data;
}

// ─── TRACKER ───────────────────────────────────────────────

function extractSignals(
  data: Obj
): Obj[] {

  const source =
    data?.signals ??
    data?.entries ??
    data?.hunter_entries ??
    data?.data ??
    [];

  return Array.isArray(source)
    ? source.filter(
        x =>
          x &&
          typeof x ===
            "object"
      )
    : [];
}

function isHunterEntry(
  signal: Obj
): boolean {

  return (
    safe(
      signal?.type ??
        signal?.signal_type ??
        signal?.signalType
    ).toUpperCase() ===
    ALLOWED_SIGNAL_TYPE
  );
}

function signalId(
  signal: Obj
): string {

  return safe(
    signal?.match_id ??
      signal?.matchId ??
      signal?.v27?.id ??
      signal?.id
  );
}

function signalHome(
  signal: Obj
): string {

  return safe(
    signal?.v27?.home ??
      extractHome(signal)
  );
}

function signalAway(
  signal: Obj
): string {

  return safe(
    signal?.v27?.away ??
      extractAway(signal)
  );
}

function signalMatch(
  signal: Obj
): string {

  return safe(
    signal?.match ??
      signal?.name ??
      signal?.v27?.match
  );
}

// ─── MATCHER ───────────────────────────────────────────────

function matcherMatches(
  data: Obj
): Obj[] {

  const source =
    data?.matches ??
    data?.results ??
    data?.matched ??
    data?.candidates ??
    [];

  return Array.isArray(source)
    ? source
    : [];
}

function matcherScore(
  item: Obj
): number {

  const n =
    Number(
      item?.scoring?.total ??
        item?.scoring?.score ??
        item?.matcher_score ??
        item?.match_score ??
        item?.score ??
        0
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function matcherV27(
  item: Obj
): Obj {

  return (
    item?.v27 ??
    item?.source ??
    item
  );
}

function matcherCloudbet(
  item: Obj
): Obj | null {

  return (
    item?.cloudbet ??
    item?.target ??
    item?.matched_cloudbet ??
    null
  );
}

function matcherClassification(
  item: Obj
): string {

  return safe(
    item?.classification ??
      item?.match_classification ??
      item?.security?.classification
  );
}

function matcherMethod(
  item: Obj
): string {

  return safe(
    item?.match_method ??
      item?.method ??
      item?.security?.match_method
  );
}

function validateMatcher(
  signal: Obj,
  item: Obj
): Obj {

  const v27 =
    matcherV27(item);

  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  const vh =
    extractHome(v27);

  const va =
    extractAway(v27);

  if (
    !teamsPresent(sh, sa) ||
    !teamsPresent(vh, va)
  ) {
    return {
      accepted: false,
      reason:
        "TEAMS_MISSING"
    };
  }

  const teams =
    twoSidedTeamScore(
      sh,
      sa,
      vh,
      va
    );

  if (!teams.matched) {
    return {
      accepted: false,
      reason:
        "STRICT_TWO_SIDED_TEAM_VALIDATION_FAILED",
      team_scores:
        teams
    };
  }

  const score =
    matcherScore(item);

  if (
    score <
    MIN_MATCHER_SCORE
  ) {
    return {
      accepted: false,
      reason:
        "MATCHER_SCORE_BELOW_MINIMUM",
      matcher_score:
        score
    };
  }

  const classification =
    matcherClassification(item);

  if (
    classification !==
      REQUIRED_MATCH_CLASSIFICATION &&
    score <
      MATCHER_THRESHOLD
  ) {
    return {
      accepted: false,
      reason:
        "MATCH_NOT_CONFIDENT"
    };
  }

  return {
    accepted: true,

    source:
      "MATCHER",

    classification:
      classification || null,

    method:
      matcherMethod(item) ||
      null,

    matcher_score:
      score,

    v27,

    cloudbet:
      matcherCloudbet(item),

    team_scores:
      teams
  };
}

function findBestMatcher(
  signal: Obj,
  data: Obj
): Obj {

  let best: Obj | null =
    null;

  const diagnostics: Obj[] =
    [];

  for (
    const item of
    matcherMatches(data)
  ) {

    const result =
      validateMatcher(
        signal,
        item
      );

    if (!result.accepted) {

      diagnostics.push({
        reason:
          result.reason,

        score:
          matcherScore(item),

        match:
          displayMatch(
            matcherV27(item)
          ),

        team_scores:
          result.team_scores ??
          null
      });

      continue;
    }

    if (
      !best ||
      result.matcher_score >
        best.matcher_score
    ) {
      best = result;
    }
  }

  if (!best) {
    return {
      found: false,

      reason:
        "NO_ACCEPTABLE_MATCHER_OR_STRICT_CLOUDBET_MATCH",

      diagnostics
    };
  }

  return {
    found: true,
    ...best
  };
}
// ============================================================
// V5.9.5 — PART 2/4
// CLOUDBET /live PARSER
// DIRECT FALLBACK
// EXACT EVENT VERIFICATION
// EXACT TARGET MARKET / ODDS EXTRACTION
// ============================================================


// ─── CLOUDBET /LIVE PARSER ────────────────────────────────
//
// V5.9.5 IMPORTANT:
//
// env.CLOUDBET → cloudbet-live-soccer-detector
//
// Public binding endpoint:
//     /live
//
// Detector internally calls:
//     Cloudbet /events
//
// Detector /live returns normalized:
//     {
//       success: true,
//       events: [...]
//     }
//
// Therefore this worker consumes events[].
// It MUST NOT expect competitions[].events[] as primary format.
//

function cloudbetMatches(
  data: Obj
): Obj[] {

  if (!data) {
    return [];
  }

  // PRIMARY V5.9.5 FORMAT
  // cloudbet-live-soccer-detector /live
  if (
    Array.isArray(
      data.events
    )
  ) {
    return data.events.filter(
      x =>
        x &&
        typeof x ===
          "object"
    );
  }

  // Compatibility:
  // { data: { events: [] } }
  if (
    Array.isArray(
      data?.data?.events
    )
  ) {
    return data.data.events.filter(
      x =>
        x &&
        typeof x ===
          "object"
    );
  }

  // Compatibility fallback only.
  // This is NOT the expected binding format.
  if (
    Array.isArray(
      data.competitions
    )
  ) {

    const result: Obj[] =
      [];

    for (
      const competition of
      data.competitions
    ) {

      if (
        Array.isArray(
          competition?.events
        )
      ) {
        result.push(
          ...competition.events
        );
      }
    }

    return result;
  }

  // Compatibility fallback for
  // { data: { competitions: [...] } }
  if (
    Array.isArray(
      data?.data?.competitions
    )
  ) {

    const result: Obj[] =
      [];

    for (
      const competition of
      data.data.competitions
    ) {

      if (
        Array.isArray(
          competition?.events
        )
      ) {
        result.push(
          ...competition.events
        );
      }
    }

    return result;
  }

  return [];
}


// ─── CLOUDBET LIVE CHECK ──────────────────────────────────

function isCloudbetLive(
  event: Obj
): boolean {

  const status =
    safe(
      event?.status ??
        event?.state ??
        event?.event_status ??
        event?.trading_status
    ).toUpperCase();

  if (
    status === "TRADING_LIVE" ||
    status === "LIVE"
  ) {
    return true;
  }

  if (
    status.includes("LIVE")
  ) {
    return true;
  }

  // Detector /live already filters live events.
  // If it explicitly returns target_available
  // or target information without a status,
  // retain the event instead of discarding it.

  if (
    event?.target_available === true ||
    event?.target_1h_over_05 === true
  ) {
    return true;
  }

  return false;
}


// ─── CLOUDBET EVENT ID ────────────────────────────────────

function getCloudbetEventId(
  event: Obj
): string {

  return safe(
    event?.event_id ??
      event?.eventId ??
      event?.id ??
      event?.cloudbet_id ??
      event?.cloudbetId ??
      event?.match_id
  );
}


// ─── CLOUDBET HOME / AWAY ─────────────────────────────────

function cloudbetHome(
  event: Obj
): string {

  return safe(
    event?.home ??
      event?.home_name ??
      event?.homeTeam ??
      event?.teams?.home?.name ??
      event?.participants?.home?.name
  );
}

function cloudbetAway(
  event: Obj
): string {

  return safe(
    event?.away ??
      event?.away_name ??
      event?.awayTeam ??
      event?.teams?.away?.name ??
      event?.participants?.away?.name
  );
}


// ─── DIRECT CLOUDBET FALLBACK ──────────────────────────────
//
// If MATCHER does not provide an acceptable Cloudbet match,
// search the current /live list directly.
//
// IMPORTANT:
// The comparison is TWO-SIDED.
// We never accept a match based only on one team.
//

function directCloudbetFallback(
  signal: Obj,
  liveMatches: Obj[]
): Obj {

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

      reason:
        "SIGNAL_TEAMS_MISSING"
    };
  }

  let best:
    Obj | null = null;

  for (
    const event of
    liveMatches
  ) {

    if (
      !isCloudbetLive(event)
    ) {
      continue;
    }

    const eh =
      cloudbetHome(event);

    const ea =
      cloudbetAway(event);

    if (
      !teamsPresent(
        eh,
        ea
      )
    ) {
      continue;
    }

    const teams =
      twoSidedTeamScore(
        sh,
        sa,
        eh,
        ea
      );

    if (
      !teams.matched
    ) {
      continue;
    }

    const candidate = {
      event,

      cloudbet_id:
        getCloudbetEventId(
          event
        ),

      home:
        eh,

      away:
        ea,

      score:
        teams.combined_score,

      team_scores:
        teams,

      source:
        "DIRECT_CLOUDBET_FALLBACK"
    };

    if (
      !best ||
      candidate.score >
        best.score
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      found: false,

      reason:
        "NO_DIRECT_CLOUDBET_MATCH"
    };
  }

  if (
    !best.cloudbet_id
  ) {
    return {
      found: false,

      reason:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  return {
    found: true,

    source:
      "DIRECT_CLOUDBET_FALLBACK",

    cloudbet_id:
      best.cloudbet_id,

    event:
      best.event,

    home:
      best.home,

    away:
      best.away,

    score:
      best.score,

    team_scores:
      best.team_scores
  };
}


// ─── FIND CLOUDBET EVENT ───────────────────────────────────

function findCloudbetById(
  liveMatches: Obj[],
  eventId: string
): Obj | null {

  if (!eventId) {
    return null;
  }

  for (
    const event of
    liveMatches
  ) {

    const id =
      getCloudbetEventId(
        event
      );

    if (
      id === eventId
    ) {
      return event;
    }
  }

  return null;
}


// ─── VERIFY CLOUDBET MATCH ────────────────────────────────
//
// This is intentionally strict.
//
// A matcher result alone is NOT enough.
//
// We verify the actual Cloudbet event against
// the Hunter home + away teams.
//
// Event ID alone is never accepted as proof of teams.
//

function verifyCloudbet(
  signal: Obj,
  matcher: Obj,
  liveMatches: Obj[]
): Obj {

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
      verified: false,

      reason:
        "SIGNAL_TEAMS_MISSING"
    };
  }

  let matcherCloudbet =
    matcher?.cloudbet ??
    null;

  let matcherEventId =
    safe(
      matcherCloudbet?.event_id ??
        matcherCloudbet?.eventId ??
        matcherCloudbet?.id ??
        matcherCloudbet?.cloudbet_id
    );

  let candidate:
    Obj | null = null;

  // ----------------------------------------------------------
  // 1. Try matcher-provided Cloudbet event.
  // ----------------------------------------------------------

  if (
    matcherCloudbet &&
    typeof matcherCloudbet ===
      "object"
  ) {

    const id =
      getCloudbetEventId(
        matcherCloudbet
      );

    if (id) {
      const live =
        findCloudbetById(
          liveMatches,
          id
        );

      if (live) {
        candidate =
          live;

        matcherEventId =
          id;
      }
    }
  }

  // ----------------------------------------------------------
  // 2. If matcher gave an ID but it is not currently
  //    present in /live, DO NOT switch to another event
  //    merely because the teams look similar.
  //
  //    This is important for pending/retry safety.
  // ----------------------------------------------------------

  if (
    matcherEventId &&
    !candidate
  ) {
    return {
      verified: false,

      reason:
        "MATCHER_CLOUDBET_EVENT_NOT_IN_LIVE",

      cloudbet_id:
        matcherEventId
    };
  }

  // ----------------------------------------------------------
  // 3. If matcher did not provide an event,
  //    perform strict direct fallback.
  // ----------------------------------------------------------

  if (!candidate) {

    const fallback =
      directCloudbetFallback(
        signal,
        liveMatches
      );

    if (
      !fallback.found
    ) {
      return {
        verified: false,

        reason:
          fallback.reason
      };
    }

    candidate =
      fallback.event;

    matcherEventId =
      fallback.cloudbet_id;
  }

  if (
    !candidate
  ) {
    return {
      verified: false,

      reason:
        "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  const cloudHome =
    cloudbetHome(candidate);

  const cloudAway =
    cloudbetAway(candidate);

  if (
    !teamsPresent(
      cloudHome,
      cloudAway
    )
  ) {
    return {
      verified: false,

      reason:
        "CLOUDBET_TEAMS_MISSING"
    };
  }

  const teams =
    twoSidedTeamScore(
      sh,
      sa,
      cloudHome,
      cloudAway
    );

  if (
    !teams.matched
  ) {
    return {
      verified: false,

      reason:
        "STRICT_TWO_SIDED_CLOUDBET_VALIDATION_FAILED",

      cloudbet_id:
        matcherEventId,

      cloudbet_home:
        cloudHome,

      cloudbet_away:
        cloudAway,

      team_scores:
        teams
    };
  }

  const eventId =
    getCloudbetEventId(
      candidate
    ) ||
    matcherEventId;

  if (!eventId) {
    return {
      verified: false,

      reason:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  return {
    verified: true,

    source:
      matcher?.source ??
      "CLOUDBET",

    cloudbet_id:
      eventId,

    event:
      {
        ...candidate,

        id:
          eventId,

        event_id:
          eventId
      },

    home:
      cloudHome,

    away:
      cloudAway,

    team_scores:
      teams
  };
}


// ─── TARGET MARKET CHECK ──────────────────────────────────

function isTargetMarket(
  market: Obj
): boolean {

  const marketName =
    safe(
      market?.market ??
        market?.market_name ??
        market?.name ??
        market?.key
    );

  return (
    marketName ===
    TARGET_MARKET
  );
}

function isTargetSubmarket(
  submarket: Obj
): boolean {

  const value =
    safe(
      submarket?.submarket ??
        submarket?.submarket_name ??
        submarket?.name ??
        submarket?.key ??
        submarket?.params
    );

  return (
    value ===
    TARGET_SUBMARKET
  );
}

function isTargetSelection(
  selection: Obj
): boolean {

  const outcome =
    safe(
      selection?.outcome ??
        selection?.selection ??
        selection?.side
    ).toLowerCase();

  const params =
    safe(
      selection?.params ??
        selection?.line ??
        selection?.selection_params
    ).toLowerCase();

  if (
    outcome !==
    TARGET_OUTCOME
  ) {
    return false;
  }

  if (
    params &&
    params !==
      TARGET_PARAMS
  ) {
    return false;
  }

  return true;
}


// ─── PRICE EXTRACTION ──────────────────────────────────────

function extractPrice(
  selection: Obj
): number | null {

  const candidates = [
    selection?.price,
    selection?.odds,
    selection?.decimal_odds,
    selection?.raw_price
  ];

  for (
    const value of
    candidates
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


// ─── SELECTION STATUS ──────────────────────────────────────

function selectionEnabled(
  selection: Obj
): boolean {

  const status =
    safe(
      selection?.status ??
        selection?.state ??
        selection?.trading_status
    ).toUpperCase();

  if (!status) {
    return true;
  }

  if (
    status ===
      "SELECTION_ENABLED" ||
    status ===
      "ENABLED" ||
    status ===
      "OPEN" ||
    status ===
      "TRADING"
  ) {
    return true;
  }

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

  return true;
}


// ─── TARGET SEARCH ─────────────────────────────────────────
//
// Supports the normalized event returned by detector /live
// as well as the raw event returned by detector /event.
//

function findTargetSelection(
  event: Obj
): Obj | null {

  // ----------------------------------------------------------
  // CASE 1:
  // normalized detector target fields
  // ----------------------------------------------------------

  if (
    event?.target_1h_over_05 === true
  ) {

    const price =
      Number(
        event?.target_price
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

        target:
          true
      };
    }
  }

  // ----------------------------------------------------------
  // CASE 2:
  // normalized selection array
  // ----------------------------------------------------------

  const normalizedSelections =
    event?.selections;

  if (
    Array.isArray(
      normalizedSelections
    )
  ) {

    for (
      const selection of
      normalizedSelections
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

        raw_price:
          selection?.raw_price ??
          price
      };
    }
  }

  // ----------------------------------------------------------
  // CASE 3:
  // raw Cloudbet markets
  //
  // Expected structure can be nested under:
  //
  // event.markets
  // event.odds
  // event.lines
  // event.submarkets
  //
  // We inspect recursively but only accept the exact
  // target market / submarket / selection.
  // ----------------------------------------------------------

  const roots = [
    event?.markets,
    event?.odds,
    event?.lines,
    event?.market
  ];

  for (
    const root of
    roots
  ) {

    const found =
      searchTargetRecursive(
        root,
        false,
        false
      );

    if (found) {
      return found;
    }
  }

  // Also inspect event itself.
  const direct =
    searchTargetRecursive(
      event,
      false,
      false
    );

  if (direct) {
    return direct;
  }

  return null;
}


// ─── RECURSIVE TARGET SEARCH ───────────────────────────────

function searchTargetRecursive(
  node: any,
  insideTargetMarket: boolean,
  insideTargetSubmarket: boolean
): Obj | null {

  if (!node) {
    return null;
  }

  if (
    Array.isArray(node)
  ) {

    for (
      const item of node
    ) {

      const found =
        searchTargetRecursive(
          item,
          insideTargetMarket,
          insideTargetSubmarket
        );

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (
    typeof node !==
    "object"
  ) {
    return null;
  }

  const marketHit =
    insideTargetMarket ||
    isTargetMarket(node);

  const submarketHit =
    insideTargetSubmarket ||
    (
      marketHit &&
      isTargetSubmarket(
        node
      )
    );

  if (
    marketHit &&
    submarketHit &&
    isTargetSelection(node)
  ) {

    if (
      !selectionEnabled(node)
    ) {
      return null;
    }

    const price =
      extractPrice(node);

    if (
      price === null
    ) {
      return null;
    }

    return {
      ...node,

      price,

      raw_price:
        node?.raw_price ??
        price
    };
  }

  for (
    const value of
    Object.values(node)
  ) {

    if (
      !value ||
      typeof value !==
        "object"
    ) {
      continue;
    }

    const found =
      searchTargetRecursive(
        value,
        marketHit,
        submarketHit
      );

    if (found) {
      return found;
    }
  }

  return null;
}


// ─── ODDS EXTRACTION ──────────────────────────────────────

function extractOdds(
  event: Obj
): number | null {

  const target =
    findTargetSelection(
      event
    );

  if (!target) {
    return null;
  }

  const price =
    Number(
      target.price
    );

  if (
    !Number.isFinite(price) ||
    price <= 1
  ) {
    return null;
  }

  return price;
}


// ─── ODDS DIAGNOSTIC ──────────────────────────────────────

function buildOddsDiagnostic(
  event: Obj
): Obj {

  const eventId =
    getCloudbetEventId(
      event
    );

  const target =
    findTargetSelection(
      event
    );

  return {
    event_id:
      eventId || null,

    match:
      displayMatch(event),

    home:
      cloudbetHome(event) ||
      null,

    away:
      cloudbetAway(event) ||
      null,

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
              target.outcome ??
              TARGET_OUTCOME,

            params:
              target.params ??
              TARGET_PARAMS,

            price:
              target.price ??
              null,

            raw_price:
              target.raw_price ??
              null,

            status:
              target.status ??
              null,

            target:
              target.target ??
              null
          }
        : null
  };
}


// ─── EXACT ODDS RESULT ────────────────────────────────────

interface OddsResult {
  success: boolean;
  event_id: string | null;
  odds: number | null;
  event: Obj | null;
  diagnostic: Obj;
  error?: string;
}

async function resolveOddsOnce(
  env: Env,
  cloudbet: Obj
): Promise<OddsResult> {

  // ----------------------------------------------------------
  // IMPORTANT V5.9.5:
  //
  // Preserve the exact verified Cloudbet event ID.
  // ----------------------------------------------------------

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

      event_id:
        null,

      odds:
        null,

      event:
        null,

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

        odds:
          null,

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

      odds:
        null,

      event:
        null,

      diagnostic,

      error:
        error instanceof
        Error
          ? error.message
          : String(error)
    };
  }
}


// ─── ODDS RETRY ────────────────────────────────────────────
//
// One attempt here.
// Persistent retry is handled by pending_odds.
//
// This guarantees that /run does not sit waiting for
// repeated Cloudbet /event requests.
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

function addSecondsISO(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
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
    extractMatchId(cloudbet);

  if (!cloudbetId) {
    return {
      success: false,
      error: "CLOUDBET_EVENT_ID_MISSING_FOR_PENDING"
    };
  }

  const payload: PendingPayload = {
    bet,
    signal,
    matcher,
    cloudbet,
    odds: oddsResult,
    diagnostic: buildOddsDiagnostic(cloudbet)
  };

  const payloadJson = JSON.stringify(payload);

  const existing = await env.DB
    .prepare(`
      SELECT *
      FROM pending_odds
      WHERE cloudbet_id = ?
      LIMIT 1
    `)
    .bind(cloudbetId)
    .first<PendingRow>();

  const nextCheck = addSecondsISO(
    ODDS_EVENT_RETRY_DELAY_MS / 1000
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
        oddsResult.error || null,
        cloudbetId
      )
      .run();

    return {
      success: true,
      action: "UPDATED_PENDING",
      cloudbet_id: cloudbetId,
      retry_count: existing.retry_count || 0,
      next_check_at: nextCheck
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
      oddsResult.error || null
    )
    .run();

  return {
    success: true,
    action: "CREATED_PENDING",
    cloudbet_id: cloudbetId,
    retry_count: 0,
    next_check_at: nextCheck
  };
}


// ============================================================
// PENDING RETRY HELPERS
// ============================================================

async function loadPending(env: Env): Promise<PendingRow[]> {
  const result = await env.DB
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
  const currentRetry = Number(row.retry_count || 0);
  const nextRetry = currentRetry + 1;

  if (nextRetry >= ODDS_EVENT_MAX_RETRIES) {
    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(row.id)
      .run();

    return {
      action: "EXPIRED",
      retry_count: nextRetry,
      max_retries: ODDS_EVENT_MAX_RETRIES,
      error
    };
  }

  const nextCheck = addSecondsISO(
    ODDS_EVENT_RETRY_DELAY_MS / 1000
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
    action: "RESCHEDULED",
    retry_count: nextRetry,
    max_retries: ODDS_EVENT_MAX_RETRIES,
    next_check_at: nextCheck,
    error
  };
}

async function incrementPendingMissing(
  env: Env,
  row: PendingRow,
  error: string
): Promise<any> {
  const currentMissing = Number(row.missing_count || 0);
  const nextMissing = currentMissing + 1;

  if (nextMissing >= MAX_MISSING_CHECKS) {
    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(row.id)
      .run();

    return {
      action: "REMOVED_MISSING",
      missing_count: nextMissing,
      max_missing_checks: MAX_MISSING_CHECKS,
      error
    };
  }

  const nextCheck = addSecondsISO(
    ODDS_EVENT_RETRY_DELAY_MS / 1000
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
    action: "RESCHEDULED_MISSING",
    missing_count: nextMissing,
    max_missing_checks: MAX_MISSING_CHECKS,
    next_check_at: nextCheck,
    error
  };
}


// ============================================================
// PENDING VALIDATION
// ============================================================

function pendingValid(event: any): boolean {
  if (!event) return false;

  if (!isCloudbetLive(event)) {
    return false;
  }

  const score = String(
    event.score ??
    event.result ??
    event.match_score ??
    ""
  ).trim();

  if (score === "0:0" || score === "0 - 0") {
    // still valid
  } else if (score) {
    return false;
  }

  const period =
    event.period ||
    event.phase ||
    event.period_type ||
    "";

  if (String(period).toLowerCase().includes("2h")) {
    return false;
  }

  const minute = Number(
    event.minute ??
    event.clock ??
    event.elapsed ??
    event.match_minute ??
    0
  );

  if (Number.isFinite(minute) && minute > 45) {
    return false;
  }

  return true;
}


// ============================================================
// PENDING RETRY
//
// CRITICAL RULE:
// - SAME cloudbet event ID
// - NO event switching
// - NO market switching
// - NO line switching
// - EXACT 1H OVER 0.5
// ============================================================

async function processPending(env: Env): Promise<any> {
  const rows = await loadPending(env);

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
  const liveResponse = await fetchServiceJSON(
    env.CLOUDBET,
    CLOUDBET_LIVE_PATH,
    CLOUDBET_TIMEOUT_MS
  );

  if (!liveResponse.ok) {
    return {
      success: false,
      pending_found: rows.length,
      processed: 0,
      completed: 0,
      rescheduled: 0,
      expired: 0,
      missing: 0,
      error: "CLOUDBET_LIVE_FAILED",
      cloudbet: liveResponse
    };
  }

  const liveMatches = cloudbetMatches(liveResponse.data)
    .filter(isCloudbetLive);

  const liveById = new Map<string, any>();

  for (const event of liveMatches) {
    const id =
      extractMatchId(event) ||
      getCloudbetEventId(event);

    if (id) {
      liveById.set(String(id), event);
    }
  }

  for (const row of rows) {
    const cloudbetId = String(row.cloudbet_id || "");

    if (!cloudbetId) {
      const r = await incrementPendingRetry(
        env,
        row,
        "CLOUDBET_EVENT_ID_MISSING"
      );

      results.push({
        pending_id: row.id,
        ...r
      });

      if (r.action === "EXPIRED") expired++;
      else rescheduled++;

      continue;
    }

    // ========================================================
    // SAME EVENT ID ONLY
    // ========================================================

    const liveEvent = liveById.get(cloudbetId);

    if (!liveEvent) {
      const r = await incrementPendingMissing(
        env,
        row,
        "SAME_CLOUDBET_EVENT_NOT_IN_LIVE"
      );

      results.push({
        pending_id: row.id,
        cloudbet_id: cloudbetId,
        ...r
      });

      missing++;

      if (r.action === "REMOVED_MISSING") {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    if (!pendingValid(liveEvent)) {
      const r = await incrementPendingMissing(
        env,
        row,
        "SAME_EVENT_NO_LONGER_VALID_FOR_TARGET"
      );

      results.push({
        pending_id: row.id,
        cloudbet_id: cloudbetId,
        ...r
      });

      missing++;

      if (r.action === "REMOVED_MISSING") {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    // Force the verified original event ID.
    const retryEvent = {
      ...liveEvent,
      id: cloudbetId,
      event_id: cloudbetId
    };

    // EXACT SAME EVENT.
    // /event?id=<original cloudbet_id>
    const oddsResult = await resolveOddsWithRetry(
      env,
      retryEvent
    );

    if (!oddsResult.ok) {
      const r = await incrementPendingRetry(
        env,
        row,
        oddsResult.error || "TARGET_ODDS_STILL_UNAVAILABLE"
      );

      results.push({
        pending_id: row.id,
        cloudbet_id: cloudbetId,
        odds: oddsResult,
        ...r
      });

      if (r.action === "EXPIRED") expired++;
      else rescheduled++;

      continue;
    }

    // ========================================================
    // ODDS FOUND — COMPLETE ORIGINAL BET
    // ========================================================

    let storedPayload: PendingPayload = {};

    try {
      storedPayload = JSON.parse(
        row.payload_json || "{}"
      );
    } catch {
      storedPayload = {};
    }

    const originalBet = storedPayload.bet || {};

    const completedBet = {
      ...originalBet,

      cloudbet: {
        ...(originalBet.cloudbet || {}),
        ...(liveEvent || {}),
        id: cloudbetId,
        event_id: cloudbetId
      },

      odds: {
        ...(originalBet.odds || {}),
        ...oddsResult
      },

      target: {
        market: TARGET_MARKET,
        selection: TARGET_SELECTION,
        market_key: TARGET_MARKET_KEY,
        submarket_key: TARGET_SUBMARKET_KEY,
        outcome: TARGET_OUTCOME,
        params: TARGET_PARAMS
      }
    };

    const archiveResult = await archiveBet(
      env,
      completedBet,
      storedPayload.signal || null,
      storedPayload.matcher || null,
      liveEvent,
      oddsResult
    );

    if (!archiveResult.success) {
      const r = await incrementPendingRetry(
        env,
        row,
        archiveResult.error || "ARCHIVE_FAILED"
      );

      results.push({
        pending_id: row.id,
        cloudbet_id: cloudbetId,
        archive: archiveResult,
        ...r
      });

      if (r.action === "EXPIRED") expired++;
      else rescheduled++;

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
      pending_id: row.id,
      cloudbet_id: cloudbetId,
      action: "COMPLETED",
      odds: oddsResult,
      archive: archiveResult
    });
  }

  return {
    success: true,
    pending_found: rows.length,
    processed: rows.length,
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
    cloudbet?.cloudbet?.id ||
    extractMatchId(cloudbet);

  const home =
    bet?.cloudbet?.home ||
    cloudbet?.home ||
    "";

  const away =
    bet?.cloudbet?.away ||
    cloudbet?.away ||
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
        cloudbetId || null,
        home,
        away,
        odds,
        BET_STAKE_EUR,
        TARGET_MARKET,
        TARGET_SELECTION,
        JSON.stringify({
          bet,
          signal,
          matcher,
          cloudbet,
          odds: oddsResult
        })
      )
      .run();

    return {
      success: true,
      execution_id: executionId,
      cloudbet_id: cloudbetId,
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
    extractMatchId(verificationCloudbet) ||
    oddsResult?.event_id ||
    null;

  const cloudbetHome =
    verificationCloudbet?.home ||
    verificationCloudbet?.home_team ||
    signal?.home ||
    "";

  const cloudbetAway =
    verificationCloudbet?.away ||
    verificationCloudbet?.away_team ||
    signal?.away ||
    "";

  const odds =
    oddsResult?.odds ??
    extractOdds(verificationCloudbet);

  return {
    execution_id: crypto.randomUUID(),
    timestamp: nowISO(),

    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled: BETTING_ENABLED,

    stake_eur: BET_STAKE_EUR,

    signal: {
      match_id:
        signal?.match_id ||
        signal?.id ||
        null,

      home: signal?.home || "",
      away: signal?.away || "",

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
      matched: !!matcher,
      match_score:
        matcher?.match_score ??
        matcher?.score ??
        null,

      confidence:
        matcher?.confidence ??
        null
    },

    cloudbet: {
      id: verifiedCloudbetId,
      event_id: verifiedCloudbetId,

      home: cloudbetHome,
      away: cloudbetAway,

      status:
        verificationCloudbet?.status ||
        null,

      competition:
        verificationCloudbet?.competition ||
        null
    },

    target: {
      market: TARGET_MARKET,
      selection: TARGET_SELECTION,

      market_key: TARGET_MARKET_KEY,
      submarket_key: TARGET_SUBMARKET_KEY,

      outcome: TARGET_OUTCOME,
      params: TARGET_PARAMS
    },

    odds: odds,

    odds_diagnostic: oddsResult,

    action: odds != null
      ? "TARGET_READY"
      : "PENDING_ODDS"
  };
}


// ============================================================
// HUNTER ENTRY DETECTION
// ============================================================

function isHunterEntry(signal: any): boolean {
  if (!signal) return false;

  const status = String(
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

  const minute = Number(
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


// ============================================================
// TRACKER RESPONSE NORMALIZATION
// ============================================================

function trackerEntries(data: any): any[] {
  if (!data) return [];

  if (Array.isArray(data.entries)) {
    return data.entries;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data.signals)) {
    return data.signals;
  }

  if (Array.isArray(data.data?.entries)) {
    return data.data.entries;
  }

  if (Array.isArray(data.data?.signals)) {
    return data.data.signals;
  }

  return [];
}


// ============================================================
// MATCHER RESPONSE NORMALIZATION
// ============================================================

function matcherMatches(data: any): any[] {
  if (!data) return [];

  if (Array.isArray(data.matches)) {
    return data.matches;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data.data?.matches)) {
    return data.data.matches;
  }

  if (Array.isArray(data.data?.results)) {
    return data.data.results;
  }

  return [];
}


// ============================================================
// MATCHER LOOKUP
// ============================================================

function getMatcherForSignal(
  signal: any,
  matcherData: any
): any | null {
  const matches = matcherMatches(matcherData);

  const signalId = String(
    signal?.match_id ||
    signal?.id ||
    ""
  );

  const direct = matches.find((m: any) => {
    const id = String(
      m?.match_id ||
      m?.source_match_id ||
      m?.flashscore_id ||
      ""
    );

    return id && signalId && id === signalId;
  });

  if (direct) {
    return direct;
  }

  const home = normalizeTeam(
    signal?.home ||
    signal?.home_team ||
    ""
  );

  const away = normalizeTeam(
    signal?.away ||
    signal?.away_team ||
    ""
  );

  let best: any = null;
  let bestScore = 0;

  for (const m of matches) {
    const mh = normalizeTeam(
      m?.home ||
      m?.home_team ||
      ""
    );

    const ma = normalizeTeam(
      m?.away ||
      m?.away_team ||
      ""
    );

    const hs = teamSimilarity(home, mh);
    const as = teamSimilarity(away, ma);

    const score =
      (hs + as) / 2;

    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }

  if (
    best &&
    bestScore >= MATCHER_THRESHOLD
  ) {
    return {
      ...best,
      fallback_score: bestScore
    };
  }

  return null;
                              }
// ============================================================
// MAIN WORKER
// ============================================================

async function runWorker(env: Env): Promise<any> {
  const started = Date.now();

  const executionId = crypto.randomUUID();

  // ----------------------------------------------------------
  // PERSISTENT PENDING RETRY
  // ----------------------------------------------------------

  let pendingResult: any = null;

  try {
    pendingResult = await processPending(env);
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

  const [trackerResult, matcherResult, cloudbetResult] =
    await Promise.all([
      fetchServiceJSON(
        env.TRACKER,
        "/entries",
        10000
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`,
        10000
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        CLOUDBET_LIVE_PATH,
        CLOUDBET_TIMEOUT_MS
      )
    ]);

  // ----------------------------------------------------------
  // TRACKER
  // ----------------------------------------------------------

  if (!trackerResult.ok) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "TRACKER_FAILED",
      tracker: trackerResult,
      pending: pendingResult,
      processing_ms: Date.now() - started
    };
  }

  // ----------------------------------------------------------
  // MATCHER
  // ----------------------------------------------------------

  if (!matcherResult.ok) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "MATCHER_FAILED",
      matcher: matcherResult,
      pending: pendingResult,
      processing_ms: Date.now() - started
    };
  }

  // ----------------------------------------------------------
  // CLOUDBET
  // ----------------------------------------------------------

  if (!cloudbetResult.ok) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "CLOUDBET_LIVE_FAILED",
      cloudbet: cloudbetResult,
      pending: pendingResult,
      processing_ms: Date.now() - started
    };
  }

  // ----------------------------------------------------------
  // NORMALIZE
  // ----------------------------------------------------------

  const trackerSignals =
    trackerEntries(trackerResult.data);

  const matcherList =
    matcherMatches(matcherResult.data);

  const cloudbetAll =
    cloudbetMatches(cloudbetResult.data);

  const cloudbetLive =
    cloudbetAll.filter(isCloudbetLive);

  const hunterSignals =
    trackerSignals.filter(isHunterEntry);

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

  for (const signal of hunterSignals) {
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
      //
      // Only if matcher did not provide an acceptable match.
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
          reason: "NO_MATCHER",
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

      if (!verification.ok) {
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
      //
      // /event?id=<VERIFIED EVENT ID>
      //
      // Only one attempt here.
      // Persistent retry is handled by pending_odds.
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
        oddsResult.ok &&
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

        if (!archive.success) {
          errors.push({
            type: "ARCHIVE_FAILED",
            signal,
            error: archive.error
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

          target:
            {
              market: TARGET_MARKET,
              selection: TARGET_SELECTION,
              market_key: TARGET_MARKET_KEY,
              submarket_key:
                TARGET_SUBMARKET_KEY,
              outcome: TARGET_OUTCOME,
              params: TARGET_PARAMS
            },

          action: "TARGET_READY",
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

      if (!pendingResultForBet.success) {
        errors.push({
          type: "PENDING_SAVE_FAILED",
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

        target:
          {
            market: TARGET_MARKET,
            selection: TARGET_SELECTION,
            market_key: TARGET_MARKET_KEY,
            submarket_key:
              TARGET_SUBMARKET_KEY,
            outcome: TARGET_OUTCOME,
            params: TARGET_PARAMS
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
        type: "SIGNAL_PROCESSING_ERROR",

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
      Date.now() - started
  };
}


// ============================================================
// DIAGNOSTIC
// ============================================================

async function runDiagnostic(env: Env): Promise<any> {
  const started = Date.now();

  const [tracker, matcher, cloudbet] =
    await Promise.all([
      fetchServiceJSON(
        env.TRACKER,
        "/entries",
        10000
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`,
        10000
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        CLOUDBET_LIVE_PATH,
        CLOUDBET_TIMEOUT_MS
      )
    ]);

  const cloudbetParsed =
    cloudbet.ok
      ? cloudbetMatches(cloudbet.data)
      : [];

  const cloudbetLive =
    cloudbetParsed.filter(isCloudbetLive);

  const targetDiagnostics =
    cloudbetLive.map((event: any) => {
      const target =
        findTargetSelection(event);

      return {
        id:
          extractMatchId(event) ||
          getCloudbetEventId(event),

        home:
          event?.home ||
          event?.home_team ||
          null,

        away:
          event?.away ||
          event?.away_team ||
          null,

        status:
          event?.status ||
          null,

        live:
          isCloudbetLive(event),

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
                  target.market
              }
            : null,

        odds_diagnostic:
          buildOddsDiagnostic(event)
      };
    });

  const hunterSignals =
    tracker.ok
      ? trackerEntries(tracker.data)
          .filter(isHunterEntry)
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
          ? matcherMatches(matcher.data).length
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
          x => x.target_found
        ).length,

      error:
        cloudbet.error ||
        null
    },

    target_diagnostics:
      targetDiagnostics,

    processing_ms:
      Date.now() - started
  };
}


// ============================================================
// HEALTH
// ============================================================

function healthResponse(): Response {
  return json({
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
// JSON RESPONSE
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
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
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
      new URL(request.url);

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
          success: true,

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
          await runDiagnostic(env);

        return json(result);
      }

      // ------------------------------------------------------
      // RUN
      // ------------------------------------------------------

      if (
        path === "/run"
      ) {
        const result =
          await runWorker(env);

        return json(result);
      }

      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------

      return json(
        {
          success: false,

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
          success: false,

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
