// ============================================================
// CLOUDBET BET WORKER V7.0.2
// DRY RUN · TRACKER READY CANDIDATE
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V7.0.2:
// - TRACKER /entries is the ONLY source for the matched Cloudbet event_id
// - Uses Tracker V6.7+ cloudbet.entry_odds / odds_available / matcher_score
// - NO matcher lookup inside Bet Worker
// - NO fuzzy name matching inside Bet Worker
// - NO direct Cloudbet fallback to another event
// - Final verification is locked to SAME Cloudbet event_id
// - Refreshes SAME event through /event?id=EVENT_ID before READY_TO_BET
// - Keeps entry_odds and current_odds separately
// - Persistent pending_odds retry preserved for SAME EVENT / MARKET / LINE
// - D1 bet_archive preserved
// - REAL BETTING DISABLED
// ============================================================

interface Env {
  TRACKER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type Obj = Record<string, any>;

// ============================================================
// CONFIG
// ============================================================

const VERSION = "V7.0.2";

const MODE = "DRY_RUN";
const DRY_RUN = true;
const BETTING_ENABLED = false;

const BET_STAKE_EUR = 10;

const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

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

const CLOUDBET_EVENT_PATH =
  "/event?id=";

const SERVICE_TIMEOUT_MS =
  10_000;

const ODDS_EVENT_MAX_RETRIES =
  20;

const ODDS_EVENT_RETRY_DELAY_MS =
  30_000;

const MAX_MISSING_CHECKS =
  3;

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
    .replace(/[^a-z0-9.=]+/g, " ")
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
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}

function nowISO(): string {
  return new Date().toISOString();
}

function addSecondsISO(
  seconds: number
): string {
  return new Date(
    Date.now() + seconds * 1000
  ).toISOString();
}

function numberOrNull(
  value: any
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeEventId(
  value: any
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const raw =
    String(value).trim();

  if (!raw) {
    return null;
  }

  // D1 / JSON can surface integer IDs as "36120839.0".
  // Cloudbet event IDs are integer identifiers, so canonicalize
  // only a pure integer-with-zero-decimals representation.
  if (/^\d+\.0+$/.test(raw)) {
    return raw.replace(/\.0+$/, "");
  }

  return raw;
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
  timeoutMs = SERVICE_TIMEOUT_MS
): Promise<ServiceResponse> {
  const started = Date.now();
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response =
      await service.fetch(
        new Request(
          `https://internal${path}`,
          {
            method: "GET",
            signal: controller.signal
          }
        )
      );

    const latency =
      Date.now() - started;

    const text =
      await response.text();

    let data: any = null;

    try {
      data = text
        ? JSON.parse(text)
        : null;
    } catch {
      return {
        ok: false,
        status: response.status,
        latency_ms: latency,
        data: null,
        error: "INVALID_JSON_RESPONSE"
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        latency_ms: latency,
        data,
        error:
          data?.error ||
          data?.message ||
          `HTTP_${response.status}`
      };
    }

    return {
      ok: true,
      status: response.status,
      latency_ms: latency,
      data
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms:
        Date.now() - started,
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
// TRACKER NORMALIZATION
// ============================================================

function trackerEntries(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data.entries)) {
    return data.entries;
  }

  if (Array.isArray(data.results)) {
    return data.results;
  }

  if (Array.isArray(data.signals)) {
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

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {
  const text = safe(value);

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
          text
            .slice(0, index)
            .trim(),
        away:
          text
            .slice(
              index + separator.length
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

function signalMatch(
  signal: any
): string {
  return safe(
    signal?.match_name ||
    signal?.match ||
    signal?.name ||
    signal?.event_name ||
    ""
  );
}

function signalHome(
  signal: any
): string {
  const direct = safe(
    signal?.home ||
    signal?.home_team ||
    signal?.home_name ||
    ""
  );

  if (direct) {
    return direct;
  }

  return splitMatch(
    signalMatch(signal)
  ).home;
}

function signalAway(
  signal: any
): string {
  const direct = safe(
    signal?.away ||
    signal?.away_team ||
    signal?.away_name ||
    ""
  );

  if (direct) {
    return direct;
  }

  return splitMatch(
    signalMatch(signal)
  ).away;
}

function hunterFilterDiagnostic(
  signal: any
): any {
  if (!signal) {
    return {
      accepted: false,
      reason: "SIGNAL_NULL"
    };
  }

  const status = String(
    signal.status ||
    signal.state ||
    ""
  ).toUpperCase();

  const minute = Number(
    signal.entry_minute ??
    signal.minute ??
    signal.elapsed ??
    0
  );

  const statusValid =
    !status ||
    [
      "ENTRY",
      "SIGNAL",
      "TRACKING",
      "ACTIVE",
      "HUNTER"
    ].includes(status);

  const teamsValid = Boolean(
    signalHome(signal) &&
    signalAway(signal)
  );

  const minuteValid = !(
    Number.isFinite(minute) &&
    minute > 45
  );

  let reason = "ACCEPTED";

  if (!statusValid) {
    reason = "INVALID_STATUS";
  } else if (!teamsValid) {
    reason = "TEAMS_MISSING";
  } else if (!minuteValid) {
    reason = "MINUTE_OVER_45";
  }

  return {
    accepted:
      statusValid &&
      teamsValid &&
      minuteValid,
    reason,
    status,
    match_id:
      signal?.match_id ??
      signal?.id ??
      null,
    match:
      signalMatch(signal),
    home:
      signalHome(signal),
    away:
      signalAway(signal),
    entry_minute:
      signal?.entry_minute ??
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

// ============================================================
// TRACKER CLOUDBET READY DATA
// ============================================================

interface TrackerCloudbetData {
  event_id: string | null;
  match: string | null;
  entry_odds: number | null;
  max_stake: number | null;
  odds_available: boolean;
  matcher_score: number | null;
}

function trackerCloudbetData(
  signal: any
): TrackerCloudbetData {
  const cb =
    signal?.cloudbet ||
    signal?.cloudbet_data ||
    {};

  const eventIdRaw =
    cb?.event_id ??
    cb?.id ??
    signal?.cloudbet_event_id ??
    null;

  const eventId =
    normalizeEventId(
      eventIdRaw
    );

  const entryOdds =
    numberOrNull(
      cb?.entry_odds ??
      signal?.entry_odds ??
      null
    );

  const maxStake =
    numberOrNull(
      cb?.max_stake ??
      signal?.cloudbet_max_stake ??
      null
    );

  const matcherScore =
    numberOrNull(
      cb?.matcher_score ??
      signal?.matcher_score ??
      null
    );

  const explicitAvailable =
    cb?.odds_available ??
    signal?.odds_available ??
    null;

  const oddsAvailable =
    explicitAvailable === true ||
    Number(explicitAvailable) === 1 ||
    (
      explicitAvailable === null &&
      entryOdds !== null &&
      entryOdds > 1
    );

  return {
    event_id: eventId,
    match:
      safe(
        cb?.match ??
        signal?.cloudbet_match ??
        ""
      ) || null,
    entry_odds: entryOdds,
    max_stake: maxStake,
    odds_available: oddsAvailable,
    matcher_score: matcherScore
  };
}

function trackerCandidateDiagnostic(
  signal: any
): any {
  const hunter =
    hunterFilterDiagnostic(signal);

  if (!hunter.accepted) {
    return {
      ready: false,
      reason: hunter.reason,
      hunter,
      cloudbet: null
    };
  }

  const cloudbet =
    trackerCloudbetData(signal);

  if (!cloudbet.event_id) {
    return {
      ready: false,
      reason:
        "TRACKER_CLOUDBET_EVENT_ID_MISSING",
      hunter,
      cloudbet
    };
  }

  // V7.0.1:
  // event_id is the gate. Tracker entry odds are a snapshot,
  // not a requirement. If odds were unavailable at Hunter ENTRY,
  // the worker stays locked to this SAME event_id and refreshes
  // the target market below. If still unavailable -> PENDING.
  const hasEntryOdds =
    cloudbet.odds_available &&
    cloudbet.entry_odds !== null &&
    cloudbet.entry_odds > 1;

  return {
    ready: true,
    reason:
      hasEntryOdds
        ? "TRACKER_READY_WITH_ENTRY_ODDS"
        : "TRACKER_READY_WAITING_FOR_ODDS",
    hunter,
    cloudbet
  };
}

// ============================================================
// CLOUDBET EVENT FETCH
// ============================================================

async function fetchCloudbetEvent(
  env: Env,
  eventId: string
): Promise<Obj> {
  if (!eventId) {
    throw new Error(
      "CLOUDBET_EVENT_ID_MISSING"
    );
  }

  const canonicalEventId =
    normalizeEventId(eventId);

  if (!canonicalEventId) {
    throw new Error(
      "CLOUDBET_EVENT_ID_MISSING"
    );
  }

  const path =
    `${CLOUDBET_EVENT_PATH}${encodeURIComponent(
      canonicalEventId
    )}`;

  const result =
    await fetchServiceJSON(
      env.CLOUDBET,
      path,
      SERVICE_TIMEOUT_MS
    );

  if (!result.ok) {
    throw new Error(
      result.error ||
      "CLOUDBET_EVENT_FAILED"
    );
  }

  let data = result.data;

  if (
    data &&
    typeof data === "object" &&
    data.data &&
    typeof data.data === "object"
  ) {
    data = data.data;
  }

  if (
    data &&
    typeof data === "object" &&
    data.event &&
    typeof data.event === "object"
  ) {
    data = data.event;
  }

  return data || {};
}

function getCloudbetEventId(
  event: any
): string | null {
  const value =
    event?.event_id ??
    event?.eventId ??
    event?.id ??
    event?.cloudbet_id ??
    event?.cloudbetId ??
    null;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return normalizeEventId(value);
}

function cloudbetHome(
  event: any
): string {
  return safe(
    event?.home ||
    event?.home_team ||
    event?.homeTeam ||
    event?.home_name ||
    event?.metadata?.homeTeam ||
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
    event?.metadata?.awayTeam ||
    ""
  );
}

function displayCloudbetMatch(
  event: any
): string {
  const home =
    cloudbetHome(event);

  const away =
    cloudbetAway(event);

  if (home && away) {
    return `${home} - ${away}`;
  }

  return safe(
    event?.name ||
    event?.match ||
    event?.event_name ||
    ""
  );
}

// ============================================================
// SAME EVENT VERIFICATION
// ============================================================

function isSameEventId(
  expectedId: string,
  event: any
): boolean {
  const actualId =
    getCloudbetEventId(event);

  const expected =
    normalizeEventId(expectedId);

  return Boolean(
    actualId &&
    expected &&
    actualId === expected
  );
}

function cloudbetScore(
  event: any
): {
  home: number | null;
  away: number | null;
  known: boolean;
} {
  const raw =
    event?.metadata?.score ??
    event?.score ??
    event?.result ??
    event?.match_score ??
    null;

  if (
    raw &&
    typeof raw === "object"
  ) {
    const home =
      numberOrNull(
        raw.home ??
        raw.homeScore ??
        raw.home_score ??
        raw[0]
      );

    const away =
      numberOrNull(
        raw.away ??
        raw.awayScore ??
        raw.away_score ??
        raw[1]
      );

    return {
      home,
      away,
      known:
        home !== null &&
        away !== null
    };
  }

  const text = safe(raw);

  if (text) {
    const match =
      text.match(
        /(\d+)\s*[:\-]\s*(\d+)/
      );

    if (match) {
      return {
        home: Number(match[1]),
        away: Number(match[2]),
        known: true
      };
    }
  }

  return {
    home: null,
    away: null,
    known: false
  };
}

function cloudbetPeriod(
  event: any
): string {
  return safe(
    event?.metadata?.eventStatus ??
    event?.eventStatus ??
    event?.period ??
    event?.phase ??
    event?.period_type ??
    ""
  ).toLowerCase();
}

function cloudbetMinute(
  event: any
): number | null {
  const candidates = [
    event?.minute,
    event?.clock,
    event?.elapsed,
    event?.match_minute,
    event?.metadata?.minute,
    event?.metadata?.elapsed
  ];

  for (const value of candidates) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    if (typeof value === "number") {
      if (Number.isFinite(value)) {
        return value;
      }
    }

    const text = safe(value);
    const match = text.match(/\d+/);

    if (match) {
      const minute = Number(match[0]);

      if (Number.isFinite(minute)) {
        return minute;
      }
    }
  }

  return null;
}

function eventStillValidForTarget(
  event: any
): {
  valid: boolean;
  reason: string;
  score: any;
  period: string;
  minute: number | null;
} {
  const score =
    cloudbetScore(event);

  if (
    score.known &&
    !(
      score.home === 0 &&
      score.away === 0
    )
  ) {
    return {
      valid: false,
      reason:
        "SCORE_NOT_0_0",
      score,
      period:
        cloudbetPeriod(event),
      minute:
        cloudbetMinute(event)
    };
  }

  const period =
    cloudbetPeriod(event);

  const secondHalfHints = [
    "2p",
    "2h",
    "second",
    "second_half",
    "second half"
  ];

  if (
    secondHalfHints.some(
      hint => period.includes(hint)
    )
  ) {
    return {
      valid: false,
      reason:
        "NOT_FIRST_HALF",
      score,
      period,
      minute:
        cloudbetMinute(event)
    };
  }

  const terminalHints = [
    "finished",
    "ended",
    "settled",
    "closed"
  ];

  if (
    terminalHints.some(
      hint => period.includes(hint)
    )
  ) {
    return {
      valid: false,
      reason:
        "EVENT_FINISHED",
      score,
      period,
      minute:
        cloudbetMinute(event)
    };
  }

  const minute =
    cloudbetMinute(event);

  if (
    minute !== null &&
    minute > 45
  ) {
    return {
      valid: false,
      reason:
        "MINUTE_OVER_45",
      score,
      period,
      minute
    };
  }

  return {
    valid: true,
    reason:
      "EVENT_VALID",
    score,
    period,
    minute
  };
}

// ============================================================
// TARGET MARKET / SELECTION
// ============================================================

function isTargetMarket(
  value: any
): boolean {
  return (
    norm(value) ===
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

  const outcome = safe(
    selection.outcome
  ).toLowerCase();

  const params = safe(
    selection.params
  ).toLowerCase();

  return (
    outcome === TARGET_OUTCOME &&
    params === TARGET_PARAMS
  );
}

function extractPrice(
  selection: any
): number | null {
  const raw =
    selection?.price ??
    selection?.odds ??
    selection?.decimal_odds ??
    selection?.raw_price ??
    null;

  const price = Number(raw);

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
  const status = String(
    selection?.status ||
    selection?.state ||
    ""
  ).toUpperCase();

  if (
    status.includes("DISABLED") ||
    status.includes("SUSPENDED") ||
    status.includes("CLOSED") ||
    status.includes("SETTLED")
  ) {
    return false;
  }

  return true;
}

function selectionMaxStake(
  selection: any
): number | null {
  return numberOrNull(
    selection?.maxStake ??
    selection?.max_stake ??
    selection?.limits?.maxStake ??
    selection?.limits?.max_stake ??
    null
  );
}

function selectionMinStake(
  selection: any
): number | null {
  return numberOrNull(
    selection?.minStake ??
    selection?.min_stake ??
    selection?.limits?.minStake ??
    selection?.limits?.min_stake ??
    null
  );
}

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

  if (Array.isArray(value)) {
    for (const item of value) {
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

  if (typeof value !== "object") {
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
    isTargetMarket(currentMarket) ||
    safe(currentMarket) ===
      TARGET_MARKET;

  const submarketMatches =
    isTargetSubmarket(
      currentSubmarket
    );

  if (
    marketMatches &&
    submarketMatches &&
    isTargetSelection(value) &&
    selectionEnabled(value)
  ) {
    const price =
      extractPrice(value);

    if (price !== null) {
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

  if (Array.isArray(value.selections)) {
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
          safe(selectionMarket) ===
            TARGET_MARKET
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
        extractPrice(selection);

      if (price === null) {
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

  for (const key of containers) {
    const child = value[key];

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
          ? String(currentMarket)
          : marketContext,
        currentSubmarket
          ? String(currentSubmarket)
          : submarketContext
      );

    if (found) {
      return found;
    }
  }

  return null;
}

function findTargetSelection(
  event: any
): any | null {
  return searchTargetRecursive(
    event,
    null,
    null
  );
}

// ============================================================
// FINAL EVENT CHECK
// ============================================================

interface CurrentOddsResult {
  success: boolean;
  event_id: string | null;
  current_odds: number | null;
  max_stake: number | null;
  min_stake: number | null;
  selection_status: string | null;
  market_url: string | null;
  event: Obj | null;
  validation: any;
  error?: string;
}

async function verifySameEventAndOdds(
  env: Env,
  expectedEventId: string
): Promise<CurrentOddsResult> {
  try {
    const event =
      await fetchCloudbetEvent(
        env,
        expectedEventId
      );

    if (
      !isSameEventId(
        expectedEventId,
        event
      )
    ) {
      return {
        success: false,
        event_id:
          getCloudbetEventId(event),
        current_odds: null,
        max_stake: null,
        min_stake: null,
        selection_status: null,
        market_url: null,
        event,
        validation: {
          valid: false,
          reason:
            "CLOUDBET_EVENT_ID_CHANGED"
        },
        error:
          "CLOUDBET_EVENT_ID_CHANGED"
      };
    }

    const validation =
      eventStillValidForTarget(
        event
      );

    if (!validation.valid) {
      return {
        success: false,
        event_id:
          expectedEventId,
        current_odds: null,
        max_stake: null,
        min_stake: null,
        selection_status: null,
        market_url: null,
        event,
        validation,
        error:
          validation.reason
      };
    }

    const selection =
      findTargetSelection(event);

    if (!selection) {
      return {
        success: false,
        event_id:
          expectedEventId,
        current_odds: null,
        max_stake: null,
        min_stake: null,
        selection_status: null,
        market_url: null,
        event,
        validation,
        error:
          "TARGET_SELECTION_NOT_AVAILABLE"
      };
    }

    const currentOdds =
      extractPrice(selection);

    if (currentOdds === null) {
      return {
        success: false,
        event_id:
          expectedEventId,
        current_odds: null,
        max_stake:
          selectionMaxStake(
            selection
          ),
        min_stake:
          selectionMinStake(
            selection
          ),
        selection_status:
          safe(
            selection?.status ||
            selection?.state ||
            ""
          ) || null,
        market_url:
          safe(
            selection?.marketUrl ||
            selection?.market_url ||
            ""
          ) || null,
        event,
        validation,
        error:
          "TARGET_ODDS_NOT_AVAILABLE"
      };
    }

    return {
      success: true,
      event_id:
        expectedEventId,
      current_odds:
        currentOdds,
      max_stake:
        selectionMaxStake(
          selection
        ),
      min_stake:
        selectionMinStake(
          selection
        ),
      selection_status:
        safe(
          selection?.status ||
          selection?.state ||
          ""
        ) || null,
      market_url:
        safe(
          selection?.marketUrl ||
          selection?.market_url ||
          ""
        ) || null,
      event,
      validation
    };
  } catch (error) {
    return {
      success: false,
      event_id:
        expectedEventId,
      current_odds: null,
      max_stake: null,
      min_stake: null,
      selection_status: null,
      market_url: null,
      event: null,
      validation: null,
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

function buildReadyBet(
  signal: any,
  trackerCloudbet:
    TrackerCloudbetData,
  current:
    CurrentOddsResult
): any {
  const entryOdds =
    trackerCloudbet.entry_odds;

  const currentOdds =
    current.current_odds;

  const movement =
    entryOdds !== null &&
    currentOdds !== null
      ? Number(
          (
            currentOdds -
            entryOdds
          ).toFixed(4)
        )
      : null;

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
    action:
      "READY_TO_BET",
    stake_eur:
      BET_STAKE_EUR,

    signal: {
      match_id:
        signal?.match_id ??
        signal?.id ??
        null,
      match:
        signalMatch(signal),
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

    cloudbet: {
      event_id:
        trackerCloudbet.event_id,
      tracker_match:
        trackerCloudbet.match,
      current_match:
        current.event
          ? displayCloudbetMatch(
              current.event
            )
          : null,
      matcher_score:
        trackerCloudbet.matcher_score,
      entry_max_stake:
        trackerCloudbet.max_stake,
      current_max_stake:
        current.max_stake,
      current_min_stake:
        current.min_stake,
      selection_status:
        current.selection_status,
      market_url:
        current.market_url
    },

    target: {
      market:
        BET_MARKET,
      selection:
        TARGET_SELECTION,
      market_key:
        TARGET_MARKET,
      submarket_key:
        TARGET_SUBMARKET,
      outcome:
        TARGET_OUTCOME,
      params:
        TARGET_PARAMS
    },

    odds: {
      entry_odds:
        entryOdds,
      current_odds:
        currentOdds,
      movement,
      changed:
        movement !== null
          ? movement !== 0
          : null
    },

    validation:
      current.validation
  };
}

// ============================================================
// D1 — PENDING ODDS
// ============================================================

interface PendingRow {
  id?: number;
  execution_id: string;
  cloudbet_id: string;
  payload_json: string;
  retry_count?: number;
  missing_count?: number;
  next_check_at?: string;
}

interface PendingPayload {
  signal?: any;
  tracker_cloudbet?:
    TrackerCloudbetData;
  last_check?: any;
}

async function savePending(
  env: Env,
  executionId: string,
  signal: any,
  trackerCloudbet:
    TrackerCloudbetData,
  current:
    CurrentOddsResult
): Promise<any> {
  const cloudbetId =
    normalizeEventId(
      trackerCloudbet.event_id
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
    signal,
    tracker_cloudbet:
      trackerCloudbet,
    last_check:
      current
  };

  const payloadJson =
    JSON.stringify(payload);

  const existing =
    await env.DB
      .prepare(`
        SELECT *
        FROM pending_odds
        WHERE cloudbet_id = ?
        LIMIT 1
      `)
      .bind(cloudbetId)
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
          existing.retry_count || 0
        ),
      next_check_at:
        nextCheck
    };
  }

  const archiveKey =
    `${cloudbetId}:${TARGET_MARKET}:${TARGET_OUTCOME}:${TARGET_PARAMS}`;

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
      signal?.match_id ??
        signal?.id ??
        null,
      cloudbetId,
      signalMatch(signal),
      signalHome(signal),
      signalAway(signal),
      signal?.entry_minute ??
        signal?.minute ??
        null,
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
  const nextRetry =
    Number(
      row.retry_count || 0
    ) + 1;

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
      action: "EXPIRED",
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
  const nextMissing =
    Number(
      row.missing_count || 0
    ) + 1;

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
// ARCHIVE
// ============================================================

async function alreadyArchived(
  env: Env,
  cloudbetId: string
): Promise<boolean> {
  const row =
    await env.DB
      .prepare(`
        SELECT execution_id
        FROM bet_archive
        WHERE
          cloudbet_id = ?
          AND market = ?
          AND selection = ?
        LIMIT 1
      `)
      .bind(
        cloudbetId,
        BET_MARKET,
        BET_SELECTION
      )
      .first();

  return !!row;
}

async function archiveBet(
  env: Env,
  bet: any,
  signal: any,
  current:
    CurrentOddsResult
): Promise<any> {
  const cloudbetId =
    safe(
      bet?.cloudbet?.event_id ||
      current?.event_id ||
      ""
    );

  if (!cloudbetId) {
    return {
      success: false,
      error:
        "ARCHIVE_CLOUDBET_ID_MISSING"
    };
  }

  if (
    await alreadyArchived(
      env,
      cloudbetId
    )
  ) {
    return {
      success: true,
      duplicate: true,
      action:
        "ALREADY_ARCHIVED",
      cloudbet_id:
        cloudbetId
    };
  }

  const currentOdds =
    numberOrNull(
      bet?.odds?.current_odds
    );

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
        bet.execution_id,
        nowISO(),
        cloudbetId,
        signalHome(signal),
        signalAway(signal),
        currentOdds,
        BET_STAKE_EUR,
        BET_MARKET,
        BET_SELECTION,
        JSON.stringify({
          bet,
          signal,
          current_check:
            current
        })
      )
      .run();

    return {
      success: true,
      duplicate: false,
      action: "ARCHIVED",
      execution_id:
        bet.execution_id,
      cloudbet_id:
        cloudbetId,
      entry_odds:
        bet?.odds?.entry_odds ??
        null,
      current_odds:
        currentOdds
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
// PENDING RETRY
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
      missing: 0,
      results: []
    };
  }

  let completed = 0;
  let rescheduled = 0;
  let expired = 0;
  let missing = 0;

  const results: any[] = [];

  for (const row of rows) {
    const cloudbetId =
      normalizeEventId(
        row.cloudbet_id
      );

    if (!cloudbetId) {
      const result =
        await incrementPendingRetry(
          env,
          row,
          "CLOUDBET_EVENT_ID_MISSING"
        );

      results.push({
        pending_id: row.id,
        ...result
      });

      if (
        result.action ===
        "EXPIRED"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      continue;
    }

    let payload:
      PendingPayload = {};

    try {
      payload = JSON.parse(
        row.payload_json || "{}"
      );
    } catch {
      payload = {};
    }

    const current =
      await verifySameEventAndOdds(
        env,
        cloudbetId
      );

    if (!current.success) {
      const invalidEventReasons =
        new Set([
          "CLOUDBET_EVENT_ID_CHANGED",
          "SCORE_NOT_0_0",
          "NOT_FIRST_HALF",
          "EVENT_FINISHED",
          "MINUTE_OVER_45"
        ]);

      const result =
        invalidEventReasons.has(
          current.error || ""
        )
          ? await incrementPendingMissing(
              env,
              row,
              current.error ||
                "EVENT_NO_LONGER_VALID"
            )
          : await incrementPendingRetry(
              env,
              row,
              current.error ||
                "TARGET_ODDS_STILL_UNAVAILABLE"
            );

      results.push({
        pending_id: row.id,
        cloudbet_id:
          cloudbetId,
        current,
        ...result
      });

      if (
        result.action ===
          "EXPIRED" ||
        result.action ===
          "REMOVED_MISSING"
      ) {
        expired++;
      } else {
        rescheduled++;
      }

      if (
        result.action ===
        "RESCHEDULED_MISSING"
      ) {
        missing++;
      }

      continue;
    }

    const signal =
      payload.signal || {};

    const trackerCloudbet =
      payload.tracker_cloudbet || {
        event_id:
          cloudbetId,
        match: null,
        entry_odds: null,
        max_stake: null,
        odds_available: true,
        matcher_score: null
      };

    const bet =
      buildReadyBet(
        signal,
        trackerCloudbet,
        current
      );

    const archive =
      await archiveBet(
        env,
        bet,
        signal,
        current
      );

    if (!archive.success) {
      const result =
        await incrementPendingRetry(
          env,
          row,
          archive.error ||
            "ARCHIVE_FAILED"
        );

      results.push({
        pending_id: row.id,
        cloudbet_id:
          cloudbetId,
        current,
        archive,
        ...result
      });

      if (
        result.action ===
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
      pending_id: row.id,
      cloudbet_id:
        cloudbetId,
      action:
        "READY_TO_BET",
      bet,
      archive
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
// MAIN WORKER
// ============================================================

async function runWorker(
  env: Env
): Promise<any> {
  const started = Date.now();
  const executionId =
    crypto.randomUUID();

  let pendingResult: any;

  try {
    pendingResult =
      await processPending(env);
  } catch (error) {
    pendingResult = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  const trackerResult =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries",
      SERVICE_TIMEOUT_MS
    );

  if (!trackerResult.ok) {
    return {
      success: false,
      worker:
        "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled:
        BETTING_ENABLED,
      action: "RUN",
      execution_id:
        executionId,
      error:
        "TRACKER_FAILED",
      tracker:
        trackerResult,
      pending_retry:
        pendingResult,
      processing_ms:
        Date.now() - started
    };
  }

  const trackerSignals =
    trackerEntries(
      trackerResult.data
    );

  const hunterSignals =
    trackerSignals.filter(
      isHunterEntry
    );

  const ready: any[] = [];
  const pending: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];

  let trackerReady = 0;
  let refreshedReady = 0;
  let targetPending = 0;

  for (const signal of hunterSignals) {
    try {
      const diagnostic =
        trackerCandidateDiagnostic(
          signal
        );

      if (!diagnostic.ready) {
        skipped.push({
          reason:
            diagnostic.reason,
          signal,
          diagnostic
        });
        continue;
      }

      trackerReady++;

      const trackerCloudbet:
        TrackerCloudbetData =
        diagnostic.cloudbet;

      const cloudbetId =
        trackerCloudbet.event_id!;

      // IMPORTANT:
      // From this point forward we are locked to this exact event_id.
      // No matcher and no alternative Cloudbet event is allowed.
      const current =
        await verifySameEventAndOdds(
          env,
          cloudbetId
        );

      if (!current.success) {
        const pendingExecutionId =
          crypto.randomUUID();

        const saved =
          await savePending(
            env,
            pendingExecutionId,
            signal,
            trackerCloudbet,
            current
          );

        if (!saved.success) {
          errors.push({
            type:
              "PENDING_SAVE_FAILED",
            signal,
            cloudbet_id:
              cloudbetId,
            current,
            error:
              saved.error
          });
          continue;
        }

        targetPending++;

        pending.push({
          execution_id:
            pendingExecutionId,
          cloudbet_id:
            cloudbetId,
          match:
            signalMatch(signal),
          entry_odds:
            trackerCloudbet.entry_odds,
          current_odds:
            current.current_odds,
          reason:
            current.error,
          pending:
            saved
        });

        continue;
      }

      const bet =
        buildReadyBet(
          signal,
          trackerCloudbet,
          current
        );

      const archive =
        await archiveBet(
          env,
          bet,
          signal,
          current
        );

      if (!archive.success) {
        errors.push({
          type:
            "ARCHIVE_FAILED",
          signal,
          cloudbet_id:
            cloudbetId,
          bet,
          error:
            archive.error
        });
        continue;
      }

      refreshedReady++;

      ready.push({
        execution_id:
          bet.execution_id,
        action:
          "READY_TO_BET",
        cloudbet_id:
          cloudbetId,
        match:
          signalMatch(signal),
        home:
          signalHome(signal),
        away:
          signalAway(signal),
        entry_minute:
          signal?.entry_minute ??
          null,
        hunter_score:
          signal?.hunter_score ??
          signal?.score ??
          null,
        matcher_score:
          trackerCloudbet.matcher_score,
        entry_odds:
          trackerCloudbet.entry_odds,
        current_odds:
          current.current_odds,
        odds_movement:
          bet.odds.movement,
        current_max_stake:
          current.max_stake,
        market_url:
          current.market_url,
        target:
          bet.target,
        archive
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
    version: VERSION,
    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled:
      BETTING_ENABLED,
    action: "RUN",
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
        TARGET_MARKET,
      target_submarket:
        TARGET_SUBMARKET,
      target_outcome:
        TARGET_OUTCOME,
      target_params:
        TARGET_PARAMS,
      tracker_is_match_source:
        true,
      matcher_lookup:
        false,
      fuzzy_fallback:
        false,
      direct_cloudbet_match_fallback:
        false,
      final_same_event_check:
        true,
      current_odds_refresh:
        true,
      persistent_pending_retry:
        true,
      odds_event_max_retries:
        ODDS_EVENT_MAX_RETRIES,
      odds_event_retry_delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,
      retry_same_event:
        true,
      retry_same_market:
        true,
      retry_same_line:
        true
    },

    source: {
      tracker:
        "/entries",
      cloudbet_event:
        "/event?id=CLOUDBET_EVENT_ID"
    },

    stats: {
      tracker_signals:
        trackerSignals.length,
      hunter_signals:
        hunterSignals.length,
      tracker_ready:
        trackerReady,
      ready_to_bet:
        refreshedReady,
      pending:
        targetPending,
      skipped:
        skipped.length,
      errors:
        errors.length
    },

    pending_retry:
      pendingResult,
    ready,
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

async function runDiagnostic(
  env: Env
): Promise<any> {
  const started = Date.now();

  const tracker =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries",
      SERVICE_TIMEOUT_MS
    );

  const trackerSignals =
    tracker.ok
      ? trackerEntries(
          tracker.data
        )
      : [];

  const diagnostics =
    trackerSignals.map(
      signal => ({
        hunter:
          hunterFilterDiagnostic(
            signal
          ),
        candidate:
          trackerCandidateDiagnostic(
            signal
          )
      })
    );

  return {
    success:
      tracker.ok,
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

    architecture: {
      match_source:
        "TRACKER V6.7+",
      tracker_endpoint:
        "/entries",
      required_tracker_fields: [
        "cloudbet.event_id"
      ],
      optional_tracker_fields: [
        "cloudbet.entry_odds",
        "cloudbet.odds_available",
        "cloudbet.max_stake",
        "cloudbet.match",
        "cloudbet.matcher_score"
      ],
      matcher_lookup:
        false,
      name_matching:
        false,
      fallback_to_other_event:
        false,
      final_verification:
        "/event?id=SAME_CLOUDBET_EVENT_ID"
    },

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

    tracker: {
      ok:
        tracker.ok,
      status:
        tracker.status,
      latency_ms:
        tracker.latency_ms,
      signals:
        trackerSignals.length,
      raw:
        tracker.data,
      error:
        tracker.error || null
    },

    diagnostics,

    processing_ms:
      Date.now() - started
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
      result.error || null
  };
}

// ============================================================
// HEALTH
// ============================================================

function healthResponse():
  Response {
  return json({
    success: true,
    worker:
      "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled:
      BETTING_ENABLED,
    status: "OK",

    target: {
      market:
        BET_MARKET,
      selection:
        TARGET_SELECTION,
      market_key:
        TARGET_MARKET,
      submarket_key:
        TARGET_SUBMARKET,
      outcome:
        TARGET_OUTCOME,
      params:
        TARGET_PARAMS
    },

    architecture: {
      tracker_match_source:
        true,
      matcher_lookup:
        false,
      fuzzy_matching:
        false,
      cloudbet_fallback:
        false,
      exact_event_lock:
        true,
      final_event_refresh:
        true
    },

    cloudbet: {
      event_endpoint:
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

    endpoints: [
      "/",
      "/health",
      "/run",
      "/diagnostic",
      "/entries"
    ]
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
      new URL(request.url);

    const path =
      url.pathname;

    try {
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
          dry_run:
            DRY_RUN,
          betting_enabled:
            BETTING_ENABLED,
          status:
            "ONLINE",

          flow: [
            "TRACKER /entries",
            "READ cloudbet.event_id + entry_odds",
            "LOCK SAME EVENT ID",
            "CLOUDBET /event?id=EVENT_ID",
            "VERIFY 1H + 0:0 + OVER 0.5 ENABLED",
            "REFRESH current_odds",
            "READY_TO_BET"
          ],

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

          safety: {
            matcher_inside_bet_worker:
              false,
            fuzzy_name_matching:
              false,
            alternative_event_fallback:
              false,
            same_event_only:
              true,
            real_betting:
              false
          },

          endpoints: [
            "/",
            "/health",
            "/run",
            "/diagnostic",
            "/entries"
          ]
        });
      }

      if (path === "/health") {
        return healthResponse();
      }

      if (path === "/entries") {
        return json(
          await runEntriesProxy(env)
        );
      }

      if (path === "/diagnostic") {
        return json(
          await runDiagnostic(env)
        );
      }

      if (path === "/run") {
        return json(
          await runWorker(env)
        );
      }

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
