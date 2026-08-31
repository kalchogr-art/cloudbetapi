// ============================================================
// GOAL WATCH — CLOUDBET BET WORKER V1
//
// PURPOSE:
// Hunter Tracking
//      ↓
// Matcher V7-FH
//      ↓
// CONFIDENT_MATCH
//      ↓
// Cloudbet event
//      ↓
// Cloudbet live odds
//      ↓
// FIRST-HALF OVER 0.5
//      ↓
// BET_READY
//
// IMPORTANT:
// V1 IS READ ONLY.
// NO BET IS PLACED.
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;

  // Cloudbet API key is kept as a Cloudflare secret.
  CLOUDBET_API_KEY: string;

  // Optional configuration
  BET_MODE?: string;
  BET_CURRENCY?: string;
  BET_STAKE?: string;
}


// ============================================================
// CONFIG
// ============================================================

const WORKER_VERSION = "V1";

const DEFAULT_BET_MODE = "READ_ONLY";
const DEFAULT_CURRENCY = "PLAY_EUR";

const REQUIRED_STATUS = "TRACKING";
const REQUIRED_CLASSIFICATION = "CONFIDENT_MATCH";

const TARGET_PERIOD = "FIRST_HALF";
const TARGET_OUTCOME = "OVER";
const TARGET_LINE = 0.5;


// ============================================================
// JSON
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}


// ============================================================
// SAFE STRING
// ============================================================

function text(value: any): string {
  return String(value ?? "").trim();
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalize(value: any): string {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// FETCH JSON FROM INTERNAL SERVICE
// ============================================================

async function fetchInternalJSON(
  service: Fetcher,
  path: string
): Promise<any> {

  const response = await service.fetch(
    new Request(
      `https://internal${path}`,
      {
        method: "GET",
        headers: {
          "accept": "application/json"
        }
      }
    )
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Internal service ${path} returned HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `Invalid JSON from internal service ${path}`
    );
  }
}


// ============================================================
// CLOUDBET API
// ============================================================
//
// API base can be changed through CLOUDBET_API_BASE if needed.
// The official API documentation currently exposes the sports
// odds/event endpoints under the Cloudbet API.
// ============================================================

function cloudbetBase(): string {
  return "https://sports-api.cloudbet.com/pub";
}


async function fetchCloudbetJSON(
  env: Env,
  path: string
): Promise<any> {

  if (!env.CLOUDBET_API_KEY) {
    throw new Error(
      "CLOUDBET_API_KEY secret is missing"
    );
  }

  const response = await fetch(
    `${cloudbetBase()}${path}`,
    {
      method: "GET",
      headers: {
        "accept": "application/json",
        "X-API-Key": env.CLOUDBET_API_KEY
      }
    }
  );

  const body = await response.text();

  if (!response.ok) {
    throw new Error(
      `Cloudbet HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      "Invalid JSON returned by Cloudbet"
    );
  }
}


// ============================================================
// ARRAY HELPERS
// ============================================================

function firstArray(
  obj: any,
  fields: string[]
): any[] {

  for (const field of fields) {
    if (Array.isArray(obj?.[field])) {
      return obj[field];
    }
  }

  return [];
}


// ============================================================
// TRACKER EXTRACTION
// ============================================================

function extractTrackingSignals(data: any): any[] {

  const candidates = [
    data?.signals,
    data?.tracking,
    data?.active_tracking,
    data?.active_signals,
    data?.entries,
    data?.matches
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}


// ============================================================
// TRACKING STATUS
// ============================================================

function trackingStatus(signal: any): string {

  return text(
    signal?.status ??
    signal?.tracking_status ??
    signal?.state
  ).toUpperCase();
}


// ============================================================
// TRACKING MATCH NAME
// ============================================================

function trackingMatchName(signal: any): string {

  return text(
    signal?.match ??
    signal?.match_name ??
    signal?.name ??
    signal?.event ??
    ""
  );
}


// ============================================================
// TRACKING ID
// ============================================================

function trackingId(signal: any): string {

  return text(
    signal?.signal_id ??
    signal?.id ??
    signal?.tracking_id ??
    ""
  );
}


// ============================================================
// HUNTER SCORE
// ============================================================

function hunterScore(signal: any): number | null {

  const value =
    signal?.hunter_score ??
    signal?.score ??
    signal?.hunterScore;

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}


// ============================================================
// ENTRY MINUTE
// ============================================================

function entryMinute(signal: any): number | null {

  const value =
    signal?.entry_minute ??
    signal?.entryMinute ??
    signal?.entry;

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  if (number < 0 || number > 130) {
    return null;
  }

  return Math.floor(number);
}


// ============================================================
// SCORE 0:0 CHECK
// ============================================================

function isZeroZero(value: any): boolean {

  const score = normalize(value);

  return (
    score === "0 0" ||
    score === "0 0 0" ||
    score === "0:0"
  );
}


// ============================================================
// TRACKER VALIDATION
// ============================================================

function validateSignal(signal: any) {

  const status = trackingStatus(signal);

  if (status !== REQUIRED_STATUS) {
    return {
      valid: false,
      reason: "TRACKING_STATUS_NOT_ACTIVE"
    };
  }

  const minute = entryMinute(signal);

  if (minute === null) {
    return {
      valid: false,
      reason: "ENTRY_MINUTE_MISSING"
    };
  }

  if (minute > 45) {
    return {
      valid: false,
      reason: "ENTRY_NOT_FIRST_HALF"
    };
  }

  const score =
    signal?.score ??
    signal?.result ??
    signal?.current_score;

  if (
    score !== undefined &&
    score !== null &&
    !isZeroZero(score)
  ) {
    return {
      valid: false,
      reason: "CURRENT_SCORE_NOT_0_0"
    };
  }

  return {
    valid: true,
    reason: "TRACKING_SIGNAL_VALID"
  };
}


// ============================================================
// MATCHER RESULT EXTRACTION
// ============================================================

function extractMatcherMatches(data: any): any[] {

  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  return [];
}


// ============================================================
// MATCHER CLASSIFICATION
// ============================================================

function matcherClassification(match: any): string {

  return text(
    match?.classification ??
    match?.match_classification
  ).toUpperCase();
}


// ============================================================
// MATCHER NAME
// ============================================================

function matcherName(
  match: any,
  side: "v27" | "cloudbet"
): string {

  const obj = match?.[side];

  if (!obj) {
    return "";
  }

  return text(
    obj?.match ??
    `${obj?.home ?? ""} - ${obj?.away ?? ""}`
  );
}


// ============================================================
// FIND MATCHER RESULT FOR TRACKER SIGNAL
// ============================================================

function findMatcherMatch(
  signal: any,
  matcherMatches: any[]
): any | null {

  const signalName =
    normalize(trackingMatchName(signal));

  if (!signalName) {
    return null;
  }

  // ----------------------------------------------------------
  // 1. Exact normalized match name
  // ----------------------------------------------------------

  for (const match of matcherMatches) {

    const names = [
      matcherName(match, "v27"),
      matcherName(match, "cloudbet")
    ];

    for (const name of names) {

      if (
        name &&
        normalize(name) === signalName
      ) {
        return match;
      }
    }
  }


  // ----------------------------------------------------------
  // 2. Team-side comparison
  // ----------------------------------------------------------

  const signalHome =
    normalize(
      signal?.home ??
      signal?.home_team ??
      signal?.homeTeam ??
      ""
    );

  const signalAway =
    normalize(
      signal?.away ??
      signal?.away_team ??
      signal?.awayTeam ??
      ""
    );

  if (!signalHome || !signalAway) {
    return null;
  }

  for (const match of matcherMatches) {

    const cloudbet = match?.cloudbet;
    const v27 = match?.v27;

    const candidates = [cloudbet, v27];

    for (const candidate of candidates) {

      if (!candidate) continue;

      const home =
        normalize(candidate?.home);

      const away =
        normalize(candidate?.away);

      if (
        home === signalHome &&
        away === signalAway
      ) {
        return match;
      }
    }
  }

  return null;
}


// ============================================================
// EXTRACT CLOUD BET EVENT ID
// ============================================================

function extractCloudbetEventId(
  match: any
): string {

  const cb = match?.cloudbet;

  if (!cb) {
    return "";
  }

  return text(
    cb?.eventId ??
    cb?.event_id ??
    cb?.id ??
    cb?.key
  );
}


// ============================================================
// CLOUD BET EVENT
// ============================================================

async function getCloudbetEvent(
  env: Env,
  eventId: string
): Promise<any> {

  if (!eventId) {
    throw new Error(
      "Cloudbet event ID is missing"
    );
  }

  return fetchCloudbetJSON(
    env,
    `/v2/odds/events/${encodeURIComponent(eventId)}`
  );
}


// ============================================================
// RECURSIVE OBJECT WALKER
// ============================================================

function walk(
  value: any,
  callback: (node: any) => void
) {

  if (!value || typeof value !== "object") {
    return;
  }

  callback(value);

  if (Array.isArray(value)) {

    for (const item of value) {
      walk(item, callback);
    }

    return;
  }

  for (const child of Object.values(value)) {
    walk(child, callback);
  }
}


// ============================================================
// MARKET DETECTION
// ============================================================

function looksLikeFirstHalf(
  node: any
): boolean {

  const values = [
    node?.period,
    node?.period_name,
    node?.periodName,
    node?.name,
    node?.label,
    node?.description,
    node?.key,
    node?.market
  ];

  const combined =
    values
      .filter(v => typeof v === "string")
      .map(normalize)
      .join(" ");

  if (!combined) {
    return false;
  }

  return (
    combined.includes("first half") ||
    combined.includes("1st half") ||
    combined.includes("1h") ||
    combined.includes("firsthalf")
  );
}


// ============================================================
// OVER 0.5 DETECTION
// ============================================================

function looksLikeOver05(
  node: any
): boolean {

  const outcome =
    normalize(
      node?.outcome ??
      node?.selection ??
      node?.side ??
      node?.name ??
      node?.label ??
      ""
    );

  const params =
    normalize(
      node?.params ??
      node?.parameter ??
      node?.line ??
      node?.total ??
      ""
    );

  const combined =
    `${outcome} ${params}`;

  const isOver =
    combined.includes("over");

  const isHalf =
    combined.includes("0 5") ||
    combined.includes("0.5") ||
    combined.includes("05");

  return isOver && isHalf;
}


// ============================================================
// PRICE
// ============================================================

function extractPrice(node: any): number | null {

  const values = [
    node?.price,
    node?.odds,
    node?.decimal_odds
  ];

  for (const value of values) {

    const number = Number(value);

    if (
      Number.isFinite(number) &&
      number > 1
    ) {
      return number;
    }
  }

  return null;
}


// ============================================================
// ENABLED CHECK
// ============================================================

function isSelectionEnabled(
  node: any
): boolean {

  const status =
    normalize(
      node?.status ??
      node?.state ??
      ""
    );

  if (!status) {
    return true;
  }

  return (
    status.includes("enabled") ||
    status.includes("active") ||
    status.includes("open") ||
    status === "trading"
  );
}


// ============================================================
// FIND TARGET SELECTION
// ============================================================

function findOver05FirstHalf(
  event: any
) {

  const candidates: any[] = [];

  walk(event, node => {

    if (!node || typeof node !== "object") {
      return;
    }

    if (!looksLikeFirstHalf(node)) {
      return;
    }

    if (!looksLikeOver05(node)) {
      return;
    }

    candidates.push(node);
  });

  if (!candidates.length) {
    return {
      found: false,
      selection: null,
      candidates_checked: 0
    };
  }

  // Prefer enabled selections with a valid price.
  candidates.sort((a, b) => {

    const aEnabled =
      isSelectionEnabled(a) ? 1 : 0;

    const bEnabled =
      isSelectionEnabled(b) ? 1 : 0;

    if (aEnabled !== bEnabled) {
      return bEnabled - aEnabled;
    }

    const aPrice =
      extractPrice(a) !== null ? 1 : 0;

    const bPrice =
      extractPrice(b) !== null ? 1 : 0;

    return bPrice - aPrice;
  });

  const selected =
    candidates[0];

  const price =
    extractPrice(selected);

  return {
    found:
      isSelectionEnabled(selected) &&
      price !== null,

    selection: {

      market_url:
        selected?.marketUrl ??
        selected?.market_url ??
        selected?.url ??
        null,

      outcome:
        selected?.outcome ??
        selected?.selection ??
        selected?.side ??
        null,

      params:
        selected?.params ??
        selected?.parameter ??
        null,

      price,

      status:
        selected?.status ??
        selected?.state ??
        null,

      min_stake:
        selected?.minStake ??
        selected?.min_stake ??
        null,

      max_stake:
        selected?.maxStake ??
        selected?.max_stake ??
        null
    },

    candidates_checked:
      candidates.length
  };
}


// ============================================================
// BET READY CHECK
// ============================================================

function finalBetReadyCheck(
  signal: any,
  matcher: any,
  market: any
) {

  const errors: string[] = [];

  if (
    trackingStatus(signal) !==
    REQUIRED_STATUS
  ) {
    errors.push(
      "TRACKER_NOT_TRACKING"
    );
  }

  if (
    matcherClassification(matcher) !==
    REQUIRED_CLASSIFICATION
  ) {
    errors.push(
      "MATCHER_NOT_CONFIDENT"
    );
  }

  const minute =
    entryMinute(signal);

  if (
    minute === null ||
    minute > 45
  ) {
    errors.push(
      "NOT_FIRST_HALF"
    );
  }

  if (!market?.found) {
    errors.push(
      "OVER_0_5_FIRST_HALF_NOT_FOUND"
    );
  }

  if (
    market?.selection?.price === null ||
    market?.selection?.price === undefined
  ) {
    errors.push(
      "PRICE_MISSING"
    );
  }

  return {
    ready:
      errors.length === 0,

    errors
  };
}


// ============================================================
// PROCESS
// ============================================================

async function process(
  env: Env
): Promise<Response> {

  const started =
    Date.now();


  // ==========================================================
  // 1. GET TRACKING SIGNALS
  // ==========================================================

  const trackerData =
    await fetchInternalJSON(
      env.TRACKER,
      "/"
    );

  const signals =
    extractTrackingSignals(
      trackerData
    );

  const activeSignals =
    signals.filter(
      signal =>
        trackingStatus(signal) ===
        REQUIRED_STATUS
    );


  // ==========================================================
  // 2. GET MATCHER OUTPUT
  // ==========================================================

  const matcherData =
    await fetchInternalJSON(
      env.MATCHER,
      "/match"
    );

  const matcherMatches =
    extractMatcherMatches(
      matcherData
    );


  // ==========================================================
  // 3. PROCESS EACH ACTIVE SIGNAL
  // ==========================================================

  const results: any[] = [];

  for (const signal of activeSignals) {

    const validation =
      validateSignal(signal);

    const signalId =
      trackingId(signal);

    const signalName =
      trackingMatchName(signal);

    if (!validation.valid) {

      results.push({

        signal_id:
          signalId || null,

        match:
          signalName || null,

        hunter_score:
          hunterScore(signal),

        entry_minute:
          entryMinute(signal),

        bet_ready:
          false,

        reason:
          validation.reason
      });

      continue;
    }


    // --------------------------------------------------------
    // Matcher
    // --------------------------------------------------------

    const matched =
      findMatcherMatch(
        signal,
        matcherMatches
      );

    if (!matched) {

      results.push({

        signal_id:
          signalId || null,

        match:
          signalName || null,

        hunter_score:
          hunterScore(signal),

        entry_minute:
          entryMinute(signal),

        bet_ready:
          false,

        reason:
          "NO_MATCHER_COUNTERPART"
      });

      continue;
    }


    // --------------------------------------------------------
    // Matcher classification
    // --------------------------------------------------------

    if (
      matcherClassification(matched) !==
      REQUIRED_CLASSIFICATION
    ) {

      results.push({

        signal_id:
          signalId || null,

        match:
          signalName || null,

        hunter_score:
          hunterScore(signal),

        entry_minute:
          entryMinute(signal),

        matcher_classification:
          matcherClassification(matched),

        bet_ready:
          false,

        reason:
          "MATCHER_NOT_CONFIDENT"
      });

      continue;
    }


    // --------------------------------------------------------
    // Cloudbet event ID
    // --------------------------------------------------------

    const eventId =
      extractCloudbetEventId(
        matched
      );

    if (!eventId) {

      results.push({

        signal_id:
          signalId || null,

        match:
          signalName || null,

        bet_ready:
          false,

        reason:
          "CLOUDBET_EVENT_ID_MISSING"
      });

      continue;
    }


    // --------------------------------------------------------
    // Cloudbet live event
    // --------------------------------------------------------

    let eventData: any;

    try {

      eventData =
        await getCloudbetEvent(
          env,
          eventId
        );

    } catch (error: any) {

      results.push({

        signal_id:
          signalId || null,

        match:
          signalName || null,

        event_id:
          eventId,

        bet_ready:
          false,

        reason:
          "CLOUDBET_EVENT_FETCH_FAILED",

        error:
          error?.message ??
          String(error)
      });

      continue;
    }


    // --------------------------------------------------------
    // Find market
    // --------------------------------------------------------

    const market =
      findOver05FirstHalf(
        eventData
      );


    // --------------------------------------------------------
    // Final check
    // --------------------------------------------------------

    const final =
      finalBetReadyCheck(
        signal,
        matched,
        market
      );


    results.push({

      signal_id:
        signalId || null,

      match:
        signalName || null,

      hunter_score:
        hunterScore(signal),

      entry_minute:
        entryMinute(signal),

      tracker_status:
        trackingStatus(signal),

      matcher_classification:
        matcherClassification(matched),

      v27_match:
        matcherName(
          matched,
          "v27"
        ),

      cloudbet_match:
        matcherName(
          matched,
          "cloudbet"
        ),

      event_id:
        eventId,

      market: market.selection,

      bet_ready:
        final.ready,

      action:
        "NO_BET_PLACED",

      reason:
        final.ready
          ? "ALL_READ_ONLY_CHECKS_PASSED"
          : final.errors.join(",")

    });
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
      WORKER_VERSION,

    mode:
      env.BET_MODE ??
      DEFAULT_BET_MODE,

    betting:
      "DISABLED",

    currency:
      env.BET_CURRENCY ??
      DEFAULT_CURRENCY,

    stats: {

      tracker_signals:
        signals.length,

      active_tracking:
        activeSignals.length,

      bet_ready:
        results.filter(
          x => x.bet_ready === true
        ).length,

      rejected:
        results.filter(
          x => x.bet_ready !== true
        ).length,

      processing_ms:
        Date.now() -
        started
    },

    results,

    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// HEALTH
// ============================================================

function health(
  env: Env
): Response {

  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      WORKER_VERSION,

    mode:
      env.BET_MODE ??
      DEFAULT_BET_MODE,

    betting:
      "DISABLED",

    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET_API_KEY:
        Boolean(
          env.CLOUDBET_API_KEY
        )
    },

    target: {

      sport:
        "SOCCER",

      period:
        TARGET_PERIOD,

      outcome:
        TARGET_OUTCOME,

      line:
        TARGET_LINE
    },

    message:
      "READ ONLY betting preparation worker. No bet can be placed.",

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

      if (
        path === "/" ||
        path === "/health"
      ) {

        return health(
          env
        );
      }


      if (
        path === "/bet-ready" ||
        path === "/live"
      ) {

        return process(
          env
        );
      }


      return json(
        {
          success:
            false,

          error:
            "Unknown endpoint",

          available_endpoints: [
            "/",
            "/health",
            "/bet-ready",
            "/live"
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
            WORKER_VERSION,

          mode:
            env.BET_MODE ??
            DEFAULT_BET_MODE,

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
