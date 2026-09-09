// ============================================================
// CLOUDBET BET WORKER V7.3.3
// DRY RUN · TRACKER READY CANDIDATE · EXACT MATCHER ODDS REFRESH
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V7.3.3:
// - LEGACY bet_archive compatibility
// - writes required legacy match_id on every archive INSERT
// - prefers Hunter/V27 match_id; safe fallback is locked Cloudbet event_id
// - keeps V7.3.2 automatic D1 migration
// - no Matcher / Tracker / betting logic changes
//
// V7.3.2:
// - SAFE AUTOMATIC D1 SCHEMA MIGRATION
// - fixes old pending_odds / bet_archive schemas without deleting data
// - adds missing columns with ALTER TABLE ADD COLUMN
// - creates missing tables/indexes when needed
// - migration is idempotent and tolerates concurrent duplicate-column races
// - direct /preflight and existing /run both ensure schema before DB work
//
// V7.3.1:
// - DIRECT /preflight endpoint for ONE Tracker event_id
// - fixes Tracker -> Bet Worker race condition
// - /preflight does NOT wait for the same ENTRY to reappear through Tracker /entries
// - exact SAME event_id lock preserved
// - current odds still come only from MATCHER /live by exact event_id
// - no names / no fuzzy matching / no alternate event
// - pending_odds + D1 archive + account preflight + handoff preserved
//
// V7.3.0:
// - BASED ON FULL V7.2.0
// - TRACKER /entries is the ONLY source for matched Cloudbet event_id
// - Uses Tracker cloudbet.entry_odds / odds_available / matcher_score
// - MATCHER is used ONLY to refresh exact odds for SAME event_id
// - NO matcher team/name lookup inside Bet Worker
// - NO fuzzy name matching inside Bet Worker
// - NO direct Cloudbet fallback to another event
// - Final verification is locked to SAME Cloudbet event_id
// - /event?id=EVENT_ID verifies SAME event + state
// - MATCHER /live refreshes exact 1H O0.5 odds for SAME event_id
// - Keeps entry_odds and current_odds separately
// - Persistent pending_odds retry preserved for SAME EVENT / MARKET / LINE
// - D1 bet_archive preserved
// - Preserves Trading API v4 HANDOFF after READY_TO_BET
// - Preserves same HANDOFF when PENDING becomes READY
// - NEW: /run reads authenticated Cloudbet account snapshot via CLOUDBET /account-test
// - NEW: account currency/balance are shown directly in /run
// - NEW: READY_TO_BET gets balance + min/max stake preflight
// - NEW: handoff.ready_to_send is true only when account/stake preflight passes
// - REAL BETTING DISABLED
// - NO POST /pub/v4/bets/place/straight is sent
// ============================================================

interface Env {
  TRACKER: Fetcher;
  CLOUDBET: Fetcher;
  MATCHER: Fetcher;
  DB: D1Database;
}

type Obj = Record<string, any>;

// ============================================================
// CONFIG
// ============================================================

const VERSION =
  "V7.3.3 LEGACY ARCHIVE COMPAT";

const MODE =
  "DRY_RUN";

const DRY_RUN =
  true;

const BETTING_ENABLED =
  false;

// Handoff only. Does NOT transmit wager.
const HANDOFF_ENABLED =
  true;

const BET_CURRENCY =
  "USDT";

const BET_STAKE =
  "0.10";

const TRADING_STRAIGHT_ENDPOINT =
  "https://sports-api.cloudbet.com/pub/v4/bets/place/straight";

// Legacy display/archive value preserved from V7.0.2.
const BET_STAKE_EUR =
  10;

const BET_MARKET =
  "1H Total Goals";

const BET_SELECTION =
  "OVER 0.5";

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

function safe(
  value: any
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value).trim();
}

function norm(
  value: any
): string {
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

function nowISO():
  string {
  return new Date()
    .toISOString();
}

function addSecondsISO(
  seconds: number
): string {
  return new Date(
    Date.now() +
    seconds * 1000
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

  const n =
    Number(value);

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

  if (/^\d+\.0+$/.test(raw)) {
    return raw.replace(
      /\.0+$/,
      ""
    );
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
            method:
              "GET",
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

    let data: any =
      null;

    try {
      data =
        text
          ? JSON.parse(text)
          : null;
    } catch {
      return {
        ok:
          false,
        status:
          response.status,
        latency_ms:
          latency,
        data:
          null,
        error:
          "INVALID_JSON_RESPONSE"
      };
    }

    if (!response.ok) {
      return {
        ok:
          false,
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
      ok:
        true,
      status:
        response.status,
      latency_ms:
        latency,
      data
    };
  } catch (
    error
  ) {
    return {
      ok:
        false,
      status:
        0,
      latency_ms:
        Date.now() -
        started,
      data:
        null,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  } finally {
    clearTimeout(
      timeout
    );
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
      home:
        "",
      away:
        ""
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
          separator
            .toLowerCase()
        );

    if (
      index >= 0
    ) {
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
    home:
      "",
    away:
      ""
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

  return splitMatch(
    signalMatch(
      signal
    )
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

  return splitMatch(
    signalMatch(
      signal
    )
  ).away;
}

function hunterFilterDiagnostic(
  signal: any
): any {
  if (!signal) {
    return {
      accepted:
        false,
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

  const minute =
    Number(
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

  const teamsValid =
    Boolean(
      signalHome(
        signal
      ) &&
      signalAway(
        signal
      )
    );

  const minuteValid =
    !(
      Number.isFinite(
        minute
      ) &&
      minute > 45
    );

  let reason =
    "ACCEPTED";

  if (!statusValid) {
    reason =
      "INVALID_STATUS";
  } else if (
    !teamsValid
  ) {
    reason =
      "TEAMS_MISSING";
  } else if (
    !minuteValid
  ) {
    reason =
      "MINUTE_OVER_45";
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
      signalMatch(
        signal
      ),
    home:
      signalHome(
        signal
      ),
    away:
      signalAway(
        signal
      ),
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
    explicitAvailable ===
      true ||
    Number(
      explicitAvailable
    ) === 1 ||
    (
      explicitAvailable ===
        null &&
      entryOdds !== null &&
      entryOdds > 1
    );

  return {
    event_id:
      eventId,
    match:
      safe(
        cb?.match ??
        signal?.cloudbet_match ??
        ""
      ) || null,
    entry_odds:
      entryOdds,
    max_stake:
      maxStake,
    odds_available:
      oddsAvailable,
    matcher_score:
      matcherScore
  };
}

function trackerCandidateDiagnostic(
  signal: any
): any {
  const hunter =
    hunterFilterDiagnostic(
      signal
    );

  if (
    !hunter.accepted
  ) {
    return {
      ready:
        false,
      reason:
        hunter.reason,
      hunter,
      cloudbet:
        null
    };
  }

  const cloudbet =
    trackerCloudbetData(
      signal
    );

  if (
    !cloudbet.event_id
  ) {
    return {
      ready:
        false,
      reason:
        "TRACKER_CLOUDBET_EVENT_ID_MISSING",
      hunter,
      cloudbet
    };
  }

  const hasEntryOdds =
    cloudbet
      .odds_available &&
    cloudbet
      .entry_odds !==
      null &&
    cloudbet
      .entry_odds >
      1;

  return {
    ready:
      true,
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
    normalizeEventId(
      eventId
    );

  if (
    !canonicalEventId
  ) {
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

  let data =
    result.data;

  if (
    data &&
    typeof data ===
      "object" &&
    data.data &&
    typeof data.data ===
      "object"
  ) {
    data =
      data.data;
  }

  if (
    data &&
    typeof data ===
      "object" &&
    data.event &&
    typeof data.event ===
      "object"
  ) {
    data =
      data.event;
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

  return normalizeEventId(
    value
  );
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
    cloudbetHome(
      event
    );

  const away =
    cloudbetAway(
      event
    );

  if (
    home &&
    away
  ) {
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
    getCloudbetEventId(
      event
    );

  const expected =
    normalizeEventId(
      expectedId
    );

  return Boolean(
    actualId &&
    expected &&
    actualId ===
      expected
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
    typeof raw ===
      "object"
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

  const text =
    safe(raw);

  if (text) {
    const match =
      text.match(
        /(\d+)\s*[:\-]\s*(\d+)/
      );

    if (match) {
      return {
        home:
          Number(
            match[1]
          ),
        away:
          Number(
            match[2]
          ),
        known:
          true
      };
    }
  }

  return {
    home:
      null,
    away:
      null,
    known:
      false
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

  for (
    const value
    of candidates
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    if (
      typeof value ===
      "number"
    ) {
      if (
        Number.isFinite(
          value
        )
      ) {
        return value;
      }
    }

    const text =
      safe(value);

    const match =
      text.match(
        /\d+/
      );

    if (match) {
      const minute =
        Number(
          match[0]
        );

      if (
        Number.isFinite(
          minute
        )
      ) {
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
    cloudbetScore(
      event
    );

  if (
    score.known &&
    !(
      score.home === 0 &&
      score.away === 0
    )
  ) {
    return {
      valid:
        false,
      reason:
        "SCORE_NOT_0_0",
      score,
      period:
        cloudbetPeriod(
          event
        ),
      minute:
        cloudbetMinute(
          event
        )
    };
  }

  const period =
    cloudbetPeriod(
      event
    );

  const secondHalfHints = [
    "2p",
    "2h",
    "second",
    "second_half",
    "second half"
  ];

  if (
    secondHalfHints.some(
      hint =>
        period.includes(
          hint
        )
    )
  ) {
    return {
      valid:
        false,
      reason:
        "NOT_FIRST_HALF",
      score,
      period,
      minute:
        cloudbetMinute(
          event
        )
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
      hint =>
        period.includes(
          hint
        )
    )
  ) {
    return {
      valid:
        false,
      reason:
        "EVENT_FINISHED",
      score,
      period,
      minute:
        cloudbetMinute(
          event
        )
    };
  }

  const minute =
    cloudbetMinute(
      event
    );

  if (
    minute !== null &&
    minute > 45
  ) {
    return {
      valid:
        false,
      reason:
        "MINUTE_OVER_45",
      score,
      period,
      minute
    };
  }

  return {
    valid:
      true,
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
    norm(
      TARGET_MARKET
    )
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

  return (
    outcome ===
      TARGET_OUTCOME &&
    params ===
      TARGET_PARAMS
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

  const price =
    Number(raw);

  if (
    !Number.isFinite(
      price
    ) ||
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

  if (
    Array.isArray(
      value
    )
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
    safe(
      currentMarket
    ) ===
      TARGET_MARKET;

  const submarketMatches =
    isTargetSubmarket(
      currentSubmarket
    );

  if (
    marketMatches &&
    submarketMatches &&
    isTargetSelection(
      value
    ) &&
    selectionEnabled(
      value
    )
  ) {
    const price =
      extractPrice(
        value
      );

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
          safe(
            selectionMarket
          ) ===
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
      child ===
        undefined ||
      child ===
        null
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
// V7.3.0 — EXACT ODDS FROM MATCHER /live
//
// IMPORTANT:
// - MATCHER IS NOT USED TO FIND / MATCH TEAMS HERE
// - Tracker remains the ONLY source of matched event_id
// - NO names
// - NO fuzzy matching
// - NO alternative event
// - Lookup below is EXACT SAME event_id only
// ============================================================

interface MatcherOddsResult {
  success: boolean;
  event_id: string | null;
  match: string | null;
  current_odds: number | null;
  max_stake: number | null;
  min_stake: number | null;
  selection_status: string | null;
  market_url: string | null;
  available: boolean;
  error?: string;
}

function matcherLiveMatches(
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
      data.data?.matches
    )
  ) {
    return data.data.matches;
  }

  return [];
}

async function fetchExactMatcherOdds(
  env: Env,
  expectedEventId: string
): Promise<MatcherOddsResult> {
  const expected =
    normalizeEventId(
      expectedEventId
    );

  if (!expected) {
    return {
      success:
        false,
      event_id:
        null,
      match:
        null,
      current_odds:
        null,
      max_stake:
        null,
      min_stake:
        null,
      selection_status:
        null,
      market_url:
        null,
      available:
        false,
      error:
        "CLOUDBET_EVENT_ID_MISSING"
    };
  }

  const result =
    await fetchServiceJSON(
      env.MATCHER,
      "/live",
      SERVICE_TIMEOUT_MS
    );

  if (!result.ok) {
    return {
      success:
        false,
      event_id:
        expected,
      match:
        null,
      current_odds:
        null,
      max_stake:
        null,
      min_stake:
        null,
      selection_status:
        null,
      market_url:
        null,
      available:
        false,
      error:
        result.error ||
        "MATCHER_LIVE_FAILED"
    };
  }

  const matches =
    matcherLiveMatches(
      result.data
    );

  const exact =
    matches.find(
      row =>
        normalizeEventId(
          row?.event_id ??
          row?.id ??
          null
        ) ===
        expected
    );

  if (!exact) {
    return {
      success:
        false,
      event_id:
        expected,
      match:
        null,
      current_odds:
        null,
      max_stake:
        null,
      min_stake:
        null,
      selection_status:
        null,
      market_url:
        null,
      available:
        false,
      error:
        "EXACT_ODDS_EVENT_NOT_FOUND"
    };
  }

  const odds =
    exact?.odds ??
    null;

  if (!odds) {
    return {
      success:
        false,
      event_id:
        expected,
      match:
        safe(
          exact?.match
        ) || null,
      current_odds:
        null,
      max_stake:
        null,
      min_stake:
        null,
      selection_status:
        null,
      market_url:
        null,
      available:
        false,
      error:
        "TARGET_ODDS_NOT_AVAILABLE"
    };
  }

  const currentOdds =
    numberOrNull(
      odds?.price ??
      odds?.raw_price ??
      null
    );

  const selectionStatus =
    safe(
      odds?.selection_status ??
      odds?.status ??
      ""
    ) || null;

  const available =
    odds?.available ===
      true &&
    selectionStatus ===
      "SELECTION_ENABLED" &&
    currentOdds !==
      null &&
    currentOdds >
      1;

  if (!available) {
    return {
      success:
        false,
      event_id:
        expected,
      match:
        safe(
          exact?.match
        ) || null,
      current_odds:
        currentOdds,
      max_stake:
        numberOrNull(
          odds?.max_stake
        ),
      min_stake:
        numberOrNull(
          odds?.min_stake
        ),
      selection_status:
        selectionStatus,
      market_url:
        safe(
          odds?.market_url
        ) || null,
      available:
        false,
      error:
        "TARGET_ODDS_NOT_AVAILABLE"
    };
  }

  return {
    success:
      true,
    event_id:
      expected,
    match:
      safe(
        exact?.match
      ) || null,
    current_odds:
      currentOdds,
    max_stake:
      numberOrNull(
        odds?.max_stake
      ),
    min_stake:
      numberOrNull(
        odds?.min_stake
      ),
    selection_status:
      selectionStatus,
    market_url:
      safe(
        odds?.market_url
      ) || null,
    available:
      true
  };
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
    // ========================================================
    // STEP 1 — SAME EVENT VERIFICATION
    // /event is used only to verify SAME event_id and state.
    // ========================================================

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
        success:
          false,
        event_id:
          getCloudbetEventId(
            event
          ),
        current_odds:
          null,
        max_stake:
          null,
        min_stake:
          null,
        selection_status:
          null,
        market_url:
          null,
        event,
        validation: {
          valid:
            false,
          reason:
            "CLOUDBET_EVENT_ID_CHANGED"
        },
        error:
          "CLOUDBET_EVENT_ID_CHANGED"
      };
    }

    // ========================================================
    // STEP 2 — SAME EVENT MUST STILL BE VALID
    // 0:0 + first half + <=45.
    // ========================================================

    const validation =
      eventStillValidForTarget(
        event
      );

    if (
      !validation.valid
    ) {
      return {
        success:
          false,
        event_id:
          expectedEventId,
        current_odds:
          null,
        max_stake:
          null,
        min_stake:
          null,
        selection_status:
          null,
        market_url:
          null,
        event,
        validation,
        error:
          validation.reason
      };
    }

    // ========================================================
    // STEP 3 — V7.3.0 FIX
    //
    // Do NOT use recursive /event market parsing for final odds.
    // Matcher /live already exposes exact Cloudbet 1H O0.5 odds.
    //
    // We do NOT ask Matcher to match names here.
    // We locate ONLY the SAME exact event_id from Tracker.
    // ========================================================

    const matcherOdds =
      await fetchExactMatcherOdds(
        env,
        expectedEventId
      );

    if (
      !matcherOdds.success
    ) {
      return {
        success:
          false,
        event_id:
          expectedEventId,
        current_odds:
          matcherOdds
            .current_odds,
        max_stake:
          matcherOdds
            .max_stake,
        min_stake:
          matcherOdds
            .min_stake,
        selection_status:
          matcherOdds
            .selection_status,
        market_url:
          matcherOdds
            .market_url,
        event,
        validation: {
          ...validation,
          odds_source:
            "MATCHER_LIVE_EXACT_EVENT_ID",
          exact_event_id:
            true
        },
        error:
          matcherOdds.error ||
          "TARGET_ODDS_NOT_AVAILABLE"
      };
    }

    // ========================================================
    // STEP 4 — SAME EVENT + VALID STATE + EXACT ENABLED ODDS
    // ========================================================

    return {
      success:
        true,
      event_id:
        expectedEventId,
      current_odds:
        matcherOdds
          .current_odds,
      max_stake:
        matcherOdds
          .max_stake,
      min_stake:
        matcherOdds
          .min_stake,
      selection_status:
        matcherOdds
          .selection_status,
      market_url:
        matcherOdds
          .market_url,
      event,
      validation: {
        ...validation,
        odds_source:
          "MATCHER_LIVE_EXACT_EVENT_ID",
        exact_event_id:
          true
      }
    };
  } catch (
    error
  ) {
    return {
      success:
        false,
      event_id:
        expectedEventId,
      current_odds:
        null,
      max_stake:
        null,
      min_stake:
        null,
      selection_status:
        null,
      market_url:
        null,
      event:
        null,
      validation:
        null,
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
    trackerCloudbet
      .entry_odds;

  const currentOdds =
    current
      .current_odds;

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
        signalMatch(
          signal
        ),
      home:
        signalHome(
          signal
        ),
      away:
        signalAway(
          signal
        ),
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
        trackerCloudbet
          .event_id,
      tracker_match:
        trackerCloudbet
          .match,
      current_match:
        current.event
          ? displayCloudbetMatch(
              current.event
            )
          : null,
      matcher_score:
        trackerCloudbet
          .matcher_score,
      entry_max_stake:
        trackerCloudbet
          .max_stake,
      current_max_stake:
        current
          .max_stake,
      current_min_stake:
        current
          .min_stake,
      selection_status:
        current
          .selection_status,
      market_url:
        current
          .market_url
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
// ACCOUNT SNAPSHOT + PREFLIGHT
// ============================================================

interface AccountSnapshot {
  success: boolean;
  authenticated: boolean;
  currency: string;
  currency_enabled: boolean;
  balance: number | null;
  endpoint: string;
  status: number;
  latency_ms: number;
  error: string | null;
}

async function fetchAccountSnapshot(
  env: Env
): Promise<AccountSnapshot> {
  const result =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/account-test",
      SERVICE_TIMEOUT_MS
    );

  if (!result.ok) {
    return {
      success: false,
      authenticated: false,
      currency: BET_CURRENCY,
      currency_enabled: false,
      balance: null,
      endpoint: "/account-test",
      status: result.status,
      latency_ms: result.latency_ms,
      error: result.error || "ACCOUNT_TEST_FAILED"
    };
  }

  const data = result.data || {};
  const currencies = Array.isArray(data?.currencies)
    ? data.currencies.map((v: any) => safe(v).toUpperCase())
    : [];

  const balanceRow = Array.isArray(data?.balances)
    ? data.balances.find(
        (row: any) =>
          safe(row?.currency).toUpperCase() ===
          BET_CURRENCY.toUpperCase()
      )
    : null;

  const balance = numberOrNull(
    balanceRow?.amount ??
    balanceRow?.data?.amount ??
    data?.balance?.amount ??
    data?.amount ??
    null
  );

  const authenticated =
    data?.authenticated === true ||
    balanceRow?.success === true;

  const currencyEnabled =
    currencies.includes(BET_CURRENCY.toUpperCase()) ||
    safe(balanceRow?.currency).toUpperCase() ===
      BET_CURRENCY.toUpperCase();

  return {
    success:
      authenticated &&
      currencyEnabled &&
      balance !== null,
    authenticated,
    currency: BET_CURRENCY,
    currency_enabled: currencyEnabled,
    balance,
    endpoint: "/account-test",
    status: result.status,
    latency_ms: result.latency_ms,
    error:
      authenticated && currencyEnabled && balance !== null
        ? null
        : "ACCOUNT_SNAPSHOT_INCOMPLETE"
  };
}

function buildAccountPreflight(
  account: AccountSnapshot,
  current: CurrentOddsResult
): any {
  const stake = numberOrNull(BET_STAKE);
  const minStake = numberOrNull(current?.min_stake);
  const maxStake = numberOrNull(current?.max_stake);
  const balance = numberOrNull(account?.balance);

  const accountOk =
    account.success === true &&
    account.authenticated === true &&
    account.currency_enabled === true &&
    balance !== null;

  const selectionEnabled =
    current.success === true &&
    current.selection_status === "SELECTION_ENABLED" &&
    numberOrNull(current.current_odds) !== null &&
    Number(current.current_odds) > 1;

  const aboveMin =
    stake !== null &&
    (minStake === null || stake >= minStake);

  const belowMax =
    stake !== null &&
    (maxStake === null || stake <= maxStake);

  const balanceSufficient =
    stake !== null &&
    balance !== null &&
    stake <= balance;

  const stakeAllowed =
    aboveMin && belowMax;

  let blockReason: string | null = null;

  if (!accountOk) {
    blockReason = "ACCOUNT_NOT_READY";
  } else if (!selectionEnabled) {
    blockReason = "SELECTION_NOT_ENABLED";
  } else if (!aboveMin) {
    blockReason = "STAKE_BELOW_MIN";
  } else if (!belowMax) {
    blockReason = "STAKE_ABOVE_MAX";
  } else if (!balanceSufficient) {
    blockReason = "INSUFFICIENT_BALANCE";
  }

  return {
    account_ok: accountOk,
    authenticated: account.authenticated,
    currency: BET_CURRENCY,
    currency_enabled: account.currency_enabled,
    balance,
    stake,
    min_stake: minStake,
    max_stake: maxStake,
    selection_enabled: selectionEnabled,
    stake_above_min: aboveMin,
    stake_below_max: belowMax,
    stake_allowed: stakeAllowed,
    balance_sufficient: balanceSufficient,
    ready_to_send: blockReason === null,
    block_reason: blockReason
  };
}

// ============================================================
// FINAL TRADING HANDOFF
// ============================================================

function buildTradingHandoff(
  bet: any,
  current:
    CurrentOddsResult,
  account: AccountSnapshot
): any | null {
  if (
    !HANDOFF_ENABLED
  ) {
    return null;
  }

  const eventId =
    normalizeEventId(
      bet?.cloudbet
        ?.event_id ??
      current?.event_id ??
      null
    );

  const marketUrl =
    safe(
      current?.market_url ??
      bet?.cloudbet
        ?.market_url ??
      ""
    );

  const price =
    numberOrNull(
      current
        ?.current_odds ??
      bet?.odds
        ?.current_odds ??
      null
    );

  if (
    !eventId ||
    !marketUrl ||
    price === null ||
    price <= 1
  ) {
    return null;
  }

  const preflight =
    buildAccountPreflight(
      account,
      current
    );

  return {
    ready_to_send:
      preflight.ready_to_send,
    sent:
      false,
    block_reason:
      preflight.block_reason,
    preflight,

    method:
      "POST",

    endpoint:
      TRADING_STRAIGHT_ENDPOINT,

    headers: {
      "Accept":
        "application/json",
      "Content-Type":
        "application/json",
      "X-API-Key":
        "<CLOUDBET_API_KEY>"
    },

    body: {
      referenceId:
        crypto.randomUUID(),

      currency:
        BET_CURRENCY,

      stake:
        BET_STAKE,

      acceptPartialStake:
        true,

      priceChange: {
        value:
          "BETTER"
      },

      selection: {
        eventId,
        marketUrl,
        price:
          String(price)
      }
    }
  };
}


// ============================================================
// V7.3.2 — SAFE D1 AUTO MIGRATION
//
// Existing databases may have older pending_odds / bet_archive schemas.
// This migration:
// - never drops a table
// - never deletes rows
// - never renames existing columns
// - creates missing tables
// - adds only missing columns
// - is safe to run repeatedly
// ============================================================

interface D1ColumnInfo {
  cid?: number;
  name?: string;
  type?: string;
  notnull?: number;
  dflt_value?: any;
  pk?: number;
}

interface SchemaMigrationResult {
  success: boolean;
  migrated: boolean;
  created_tables: string[];
  added_columns: string[];
  indexes_checked: string[];
  error?: string;
}

const PENDING_ODDS_COLUMNS:
  Record<string, string> = {
    archive_key:
      "TEXT",
    execution_id:
      "TEXT",
    signal_match_id:
      "TEXT",
    cloudbet_id:
      "TEXT",
    match:
      "TEXT",
    home:
      "TEXT",
    away:
      "TEXT",
    entry_minute:
      "REAL",
    market:
      "TEXT",
    selection:
      "TEXT",
    stake_eur:
      "REAL",
    mode:
      "TEXT",
    status:
      "TEXT",
    retry_count:
      "INTEGER DEFAULT 0",
    missing_count:
      "INTEGER DEFAULT 0",
    payload_json:
      "TEXT",
    created_at:
      "TEXT",
    updated_at:
      "TEXT",
    next_check_at:
      "TEXT"
  };

const BET_ARCHIVE_COLUMNS:
  Record<string, string> = {
    match_id:
      "TEXT",
    execution_id:
      "TEXT",
    timestamp:
      "TEXT",
    cloudbet_id:
      "TEXT",
    home:
      "TEXT",
    away:
      "TEXT",
    odds:
      "REAL",
    stake_eur:
      "REAL",
    market:
      "TEXT",
    selection:
      "TEXT",
    payload_json:
      "TEXT"
  };

function isDuplicateColumnError(
  error: any
): boolean {
  const message =
    String(
      error instanceof Error
        ? error.message
        : error
    ).toLowerCase();

  return (
    message.includes(
      "duplicate column"
    ) ||
    message.includes(
      "already exists"
    )
  );
}

async function tableColumns(
  env: Env,
  tableName: string
): Promise<Set<string>> {
  const result =
    await env.DB
      .prepare(
        `PRAGMA table_info(${tableName})`
      )
      .all<D1ColumnInfo>();

  const columns =
    new Set<string>();

  for (
    const row
    of result.results || []
  ) {
    const name =
      safe(
        row?.name
      );

    if (name) {
      columns.add(
        name.toLowerCase()
      );
    }
  }

  return columns;
}

async function addMissingColumns(
  env: Env,
  tableName: string,
  definitions:
    Record<string, string>
): Promise<string[]> {
  const added:
    string[] = [];

  let columns =
    await tableColumns(
      env,
      tableName
    );

  for (
    const [
      columnName,
      sqlType
    ]
    of Object.entries(
      definitions
    )
  ) {
    if (
      columns.has(
        columnName.toLowerCase()
      )
    ) {
      continue;
    }

    try {
      await env.DB
        .prepare(
          `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}`
        )
        .run();

      added.push(
        `${tableName}.${columnName}`
      );

      columns.add(
        columnName.toLowerCase()
      );
    } catch (
      error
    ) {
      // Two requests can migrate at the same time.
      // If the other request added the same column first,
      // re-read the table and continue safely.
      if (
        isDuplicateColumnError(
          error
        )
      ) {
        columns =
          await tableColumns(
            env,
            tableName
          );

        if (
          columns.has(
            columnName.toLowerCase()
          )
        ) {
          continue;
        }
      }

      throw error;
    }
  }

  return added;
}

async function ensureDatabaseSchema(
  env: Env
): Promise<SchemaMigrationResult> {
  const createdTables:
    string[] = [];

  const addedColumns:
    string[] = [];

  const indexesChecked:
    string[] = [];

  try {
    // --------------------------------------------------------
    // pending_odds
    // --------------------------------------------------------
    await env.DB
      .prepare(`
        CREATE TABLE IF NOT EXISTS pending_odds (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          archive_key TEXT,
          execution_id TEXT,
          signal_match_id TEXT,
          cloudbet_id TEXT,
          match TEXT,
          home TEXT,
          away TEXT,
          entry_minute REAL,
          market TEXT,
          selection TEXT,
          stake_eur REAL,
          mode TEXT,
          status TEXT,
          retry_count INTEGER DEFAULT 0,
          missing_count INTEGER DEFAULT 0,
          payload_json TEXT,
          created_at TEXT,
          updated_at TEXT,
          next_check_at TEXT
        )
      `)
      .run();

    createdTables.push(
      "pending_odds"
    );

    addedColumns.push(
      ...await addMissingColumns(
        env,
        "pending_odds",
        PENDING_ODDS_COLUMNS
      )
    );

    // --------------------------------------------------------
    // bet_archive
    // --------------------------------------------------------
    await env.DB
      .prepare(`
        CREATE TABLE IF NOT EXISTS bet_archive (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id TEXT,
          execution_id TEXT,
          timestamp TEXT,
          cloudbet_id TEXT,
          home TEXT,
          away TEXT,
          odds REAL,
          stake_eur REAL,
          market TEXT,
          selection TEXT,
          payload_json TEXT
        )
      `)
      .run();

    createdTables.push(
      "bet_archive"
    );

    addedColumns.push(
      ...await addMissingColumns(
        env,
        "bet_archive",
        BET_ARCHIVE_COLUMNS
      )
    );

    // --------------------------------------------------------
    // Indexes
    // --------------------------------------------------------
    await env.DB
      .prepare(`
        CREATE INDEX IF NOT EXISTS
        idx_pending_odds_cloudbet_id
        ON pending_odds(cloudbet_id)
      `)
      .run();

    indexesChecked.push(
      "idx_pending_odds_cloudbet_id"
    );

    await env.DB
      .prepare(`
        CREATE INDEX IF NOT EXISTS
        idx_pending_odds_next_check
        ON pending_odds(next_check_at)
      `)
      .run();

    indexesChecked.push(
      "idx_pending_odds_next_check"
    );

    await env.DB
      .prepare(`
        CREATE INDEX IF NOT EXISTS
        idx_bet_archive_cloudbet_market_selection
        ON bet_archive(
          cloudbet_id,
          market,
          selection
        )
      `)
      .run();

    indexesChecked.push(
      "idx_bet_archive_cloudbet_market_selection"
    );

    return {
      success:
        true,
      migrated:
        addedColumns.length >
        0,
      created_tables:
        createdTables,
      added_columns:
        addedColumns,
      indexes_checked:
        indexesChecked
    };
  } catch (
    error
  ) {
    return {
      success:
        false,
      migrated:
        addedColumns.length >
        0,
      created_tables:
        createdTables,
      added_columns:
        addedColumns,
      indexes_checked:
        indexesChecked,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
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
      trackerCloudbet
        .event_id
    );

  if (!cloudbetId) {
    return {
      success:
        false,
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
      success:
        true,
      action:
        "UPDATED_PENDING",
      cloudbet_id:
        cloudbetId,
      retry_count:
        Number(
          existing
            .retry_count ||
          0
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
      signalMatch(
        signal
      ),
      signalHome(
        signal
      ),
      signalAway(
        signal
      ),
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
    success:
      true,
    action:
      "CREATED_PENDING",
    archive_key:
      archiveKey,
    cloudbet_id:
      cloudbetId,
    retry_count:
      0,
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

  return (
    result.results ||
    []
  );
}

async function incrementPendingRetry(
  env: Env,
  row: PendingRow,
  error: string
): Promise<any> {
  const nextRetry =
    Number(
      row.retry_count ||
      0
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
  const nextMissing =
    Number(
      row.missing_count ||
      0
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
      success:
        false,
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
      success:
        true,
      duplicate:
        true,
      action:
        "ALREADY_ARCHIVED",
      cloudbet_id:
        cloudbetId
    };
  }

  const currentOdds =
    numberOrNull(
      bet?.odds
        ?.current_odds
    );

  // V7.3.3 legacy D1 compatibility:
  // production bet_archive may require match_id NOT NULL.
  const archiveMatchId =
    safe(
      signal?.match_id ??
      signal?.id ??
      bet?.signal?.match_id ??
      bet?.match_id ??
      ""
    ) ||
    cloudbetId;

  try {
    await env.DB
      .prepare(`
        INSERT INTO bet_archive (
          match_id,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .bind(
        archiveMatchId,
        bet.execution_id,
        nowISO(),
        cloudbetId,
        signalHome(
          signal
        ),
        signalAway(
          signal
        ),
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
      success:
        true,
      duplicate:
        false,
      action:
        "ARCHIVED",
      execution_id:
        bet.execution_id,
      cloudbet_id:
        cloudbetId,
      entry_odds:
        bet?.odds
          ?.entry_odds ??
        null,
      current_odds:
        currentOdds
    };
  } catch (
    error
  ) {
    return {
      success:
        false,
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
  env: Env,
  account: AccountSnapshot
): Promise<any> {
  const rows =
    await loadPending(
      env
    );

  if (
    !rows.length
  ) {
    return {
      success:
        true,
      pending_found:
        0,
      processed:
        0,
      completed:
        0,
      rescheduled:
        0,
      expired:
        0,
      missing:
        0,
      results:
        []
    };
  }

  let completed =
    0;

  let rescheduled =
    0;

  let expired =
    0;

  let missing =
    0;

  const results:
    any[] = [];

  for (
    const row
    of rows
  ) {
    const cloudbetId =
      normalizeEventId(
        row.cloudbet_id
      );

    if (
      !cloudbetId
    ) {
      const result =
        await incrementPendingRetry(
          env,
          row,
          "CLOUDBET_EVENT_ID_MISSING"
        );

      results.push({
        pending_id:
          row.id,
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
      payload =
        JSON.parse(
          row.payload_json ||
          "{}"
        );
    } catch {
      payload = {};
    }

    const current =
      await verifySameEventAndOdds(
        env,
        cloudbetId
      );

    if (
      !current.success
    ) {
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
          current.error ||
          ""
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
        pending_id:
          row.id,
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
      payload.signal ||
      {};

    const trackerCloudbet =
      payload
        .tracker_cloudbet ||
      {
        event_id:
          cloudbetId,
        match:
          null,
        entry_odds:
          null,
        max_stake:
          null,
        odds_available:
          true,
        matcher_score:
          null
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

    if (
      !archive.success
    ) {
      const result =
        await incrementPendingRetry(
          env,
          row,
          archive.error ||
          "ARCHIVE_FAILED"
        );

      results.push({
        pending_id:
          row.id,
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

    const handoff =
      buildTradingHandoff(
        bet,
        current,
        account
      );

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
        "READY_TO_BET",
      bet,
      handoff,
      archive
    });
  }

  return {
    success:
      true,
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
// V7.3.1 — DIRECT SINGLE EVENT PREFLIGHT
//
// Tracker sends the already matched SAME Cloudbet event_id directly.
// Bet Worker does NOT rediscover this event through Tracker /entries.
//
// SAFETY:
// - exact event_id only
// - no team matching
// - no fuzzy matching
// - no alternate Cloudbet event
// - real betting remains disabled
// ============================================================

interface DirectPreflightInput {
  event_id?: any;
  match_id?: any;
  match?: any;
  home?: any;
  away?: any;
  entry_minute?: any;
  hunter_score?: any;
  entry_odds?: any;
  max_stake?: any;
  matcher_score?: any;
}

function buildDirectSignal(
  input: DirectPreflightInput
): any {
  const eventId =
    normalizeEventId(
      input?.event_id
    );

  const entryOdds =
    numberOrNull(
      input?.entry_odds
    );

  return {
    status:
      "ENTRY",

    match_id:
      input?.match_id ??
      null,

    match:
      safe(
        input?.match
      ),

    home:
      safe(
        input?.home
      ),

    away:
      safe(
        input?.away
      ),

    entry_minute:
      numberOrNull(
        input?.entry_minute
      ),

    hunter_score:
      numberOrNull(
        input?.hunter_score
      ),

    cloudbet: {
      event_id:
        eventId,

      match:
        safe(
          input?.match
        ) || null,

      entry_odds:
        entryOdds,

      max_stake:
        numberOrNull(
          input?.max_stake
        ),

      odds_available:
        entryOdds !== null &&
        entryOdds > 1,

      matcher_score:
        numberOrNull(
          input?.matcher_score
        )
    }
  };
}

async function runDirectPreflight(
  env: Env,
  input: DirectPreflightInput
): Promise<any> {
  const started =
    Date.now();

  const eventId =
    normalizeEventId(
      input?.event_id
    );

  if (!eventId) {
    return {
      success:
        false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      action:
        "DIRECT_PREFLIGHT",
      ready:
        false,
      reason:
        "CLOUDBET_EVENT_ID_MISSING",
      processing_ms:
        Date.now() -
        started
    };
  }

  const schema =
    await ensureDatabaseSchema(
      env
    );

  if (
    !schema.success
  ) {
    return {
      success:
        false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      action:
        "DIRECT_PREFLIGHT",
      ready:
        false,
      event_id:
        eventId,
      reason:
        "DATABASE_SCHEMA_MIGRATION_FAILED",
      database_schema:
        schema,
      processing_ms:
        Date.now() -
        started
    };
  }


  const signal =
    buildDirectSignal(
      input
    );

  const trackerCloudbet =
    trackerCloudbetData(
      signal
    );

  if (
    trackerCloudbet.event_id !==
    eventId
  ) {
    return {
      success:
        false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      action:
        "DIRECT_PREFLIGHT",
      ready:
        false,
      event_id:
        eventId,
      reason:
        "DIRECT_EVENT_ID_NORMALIZATION_FAILED",
      processing_ms:
        Date.now() -
        started
    };
  }

  const account =
    await fetchAccountSnapshot(
      env
    );

  const current =
    await verifySameEventAndOdds(
      env,
      eventId
    );

  if (
    !current.success
  ) {
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

    return {
      success:
        saved.success === true,
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
        "PENDING_ODDS",
      ready:
        false,
      event_id:
        eventId,
      match:
        signalMatch(
          signal
        ),
      reason:
        current.error ||
        "TARGET_ODDS_NOT_AVAILABLE",
      entry_odds:
        trackerCloudbet
          .entry_odds,
      current_odds:
        current
          .current_odds,
      max_stake:
        current
          .max_stake,
      account,
      account_balance:
        numberOrNull(
          account?.balance
        ),
      current,
      pending:
        saved,
      source: {
        event:
          "DIRECT_TRACKER_EVENT_ID",
        state:
          "/event?id=SAME_EVENT_ID",
        odds:
          "MATCHER /live EXACT SAME EVENT_ID"
      },
      processing_ms:
        Date.now() -
        started
    };
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

  if (
    !archive.success
  ) {
    return {
      success:
        false,
      worker:
        "cloudbet-bet-worker",
      version:
        VERSION,
      action:
        "DIRECT_PREFLIGHT",
      ready:
        false,
      event_id:
        eventId,
      reason:
        archive.error ||
        "ARCHIVE_FAILED",
      account,
      current,
      archive,
      processing_ms:
        Date.now() -
        started
    };
  }

  const accountPreflight =
    buildAccountPreflight(
      account,
      current
    );

  const handoff =
    buildTradingHandoff(
      bet,
      current,
      account
    );

  const ready =
    handoff?.ready_to_send ===
      true;

  return {
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
    action:
      "READY_TO_BET",
    ready,
    event_id:
      eventId,
    match:
      signalMatch(
        signal
      ),
    reason:
      ready
        ? "ALL_PREFLIGHT_CHECKS_PASSED"
        : (
            accountPreflight
              ?.block_reason ||
            "PREFLIGHT_NOT_READY"
          ),
    entry_odds:
      trackerCloudbet
        .entry_odds,
    current_odds:
      current
        .current_odds,
    max_stake:
      current
        .max_stake,
    min_stake:
      current
        .min_stake,
    account_balance:
      numberOrNull(
        account?.balance
      ),
    account_preflight:
      accountPreflight,
    handoff,
    archive,
    current,
    source: {
      event:
        "DIRECT_TRACKER_EVENT_ID",
      state:
        "/event?id=SAME_EVENT_ID",
      odds:
        "MATCHER /live EXACT SAME EVENT_ID"
    },
    processing_ms:
      Date.now() -
      started
  };
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

  const schema =
    await ensureDatabaseSchema(
      env
    );

  if (
    !schema.success
  ) {
    return {
      success:
        false,
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
        "DATABASE_SCHEMA_MIGRATION_FAILED",
      database_schema:
        schema,
      processing_ms:
        Date.now() -
        started
    };
  }

  const account =
    await fetchAccountSnapshot(
      env
    );

  let pendingResult:
    any;

  try {
    pendingResult =
      await processPending(
        env,
        account
      );
  } catch (
    error
  ) {
    pendingResult = {
      success:
        false,
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

  if (
    !trackerResult.ok
  ) {
    return {
      success:
        false,
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
      account,
      pending_retry:
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

  const hunterSignals =
    trackerSignals.filter(
      isHunterEntry
    );

  const ready:
    any[] = [];

  const pending:
    any[] = [];

  const skipped:
    any[] = [];

  const errors:
    any[] = [];

  let trackerReady =
    0;

  let refreshedReady =
    0;

  let targetPending =
    0;

  for (
    const signal
    of hunterSignals
  ) {
    try {
      const diagnostic =
        trackerCandidateDiagnostic(
          signal
        );

      if (
        !diagnostic.ready
      ) {
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
        trackerCloudbet
          .event_id!;

      const current =
        await verifySameEventAndOdds(
          env,
          cloudbetId
        );

      if (
        !current.success
      ) {
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

        if (
          !saved.success
        ) {
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
            signalMatch(
              signal
            ),
          entry_odds:
            trackerCloudbet
              .entry_odds,
          current_odds:
            current
              .current_odds,
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

      if (
        !archive.success
      ) {
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

      const handoff =
        buildTradingHandoff(
          bet,
          current,
          account
        );

      refreshedReady++;

      ready.push({
        execution_id:
          bet.execution_id,
        action:
          "READY_TO_BET",
        cloudbet_id:
          cloudbetId,
        match:
          signalMatch(
            signal
          ),
        home:
          signalHome(
            signal
          ),
        away:
          signalAway(
            signal
          ),
        entry_minute:
          signal?.entry_minute ??
          null,
        hunter_score:
          signal?.hunter_score ??
          signal?.score ??
          null,
        matcher_score:
          trackerCloudbet
            .matcher_score,
        entry_odds:
          trackerCloudbet
            .entry_odds,
        current_odds:
          current
            .current_odds,
        odds_movement:
          bet.odds
            .movement,
        current_max_stake:
          current
            .max_stake,
        market_url:
          current
            .market_url,
        target:
          bet.target,
        account_preflight:
          buildAccountPreflight(
            account,
            current
          ),
        handoff,
        archive
      });
    } catch (
      error
    ) {
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
    handoff_enabled:
      HANDOFF_ENABLED,
    action:
      "RUN",
    execution_id:
      executionId,

    config: {
      stake_eur:
        BET_STAKE_EUR,
      handoff_currency:
        BET_CURRENCY,
      handoff_stake:
        BET_STAKE,
      trading_endpoint:
        TRADING_STRAIGHT_ENDPOINT,
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
      direct_event_preflight:
        true,
      direct_preflight_endpoint:
        "/preflight",
      d1_auto_migration:
        true,
      matcher_lookup:
        true,
      matcher_used_for_matching:
        false,
      matcher_used_for_exact_odds:
        true,
      matcher_odds_endpoint:
        "/live",
      matcher_odds_event_lock:
        "EXACT_EVENT_ID_ONLY",
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
        true,
      account_preflight:
        true,
      account_endpoint:
        "/account-test",
      handoff_only:
        true,
      real_bet_post:
        false
    },

    source: {
      tracker:
        "/entries",
      cloudbet_event:
        "/event?id=CLOUDBET_EVENT_ID",
      current_odds:
        "MATCHER /live -> EXACT SAME EVENT_ID"
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

    account,
    pending_retry:
      pendingResult,
    ready,
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
    handoff_enabled:
      HANDOFF_ENABLED,
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
        true,
      matcher_purpose:
        "EXACT_ODDS_ONLY",
      matcher_name_matching:
        false,
      matcher_event_selection:
        false,
      matcher_odds_endpoint:
        "/live",
      matcher_event_lock:
        "EXACT_EVENT_ID_ONLY",
      name_matching:
        false,
      fallback_to_other_event:
        false,
      final_verification:
        "/event?id=SAME_CLOUDBET_EVENT_ID",
      current_odds_source:
        "MATCHER /live EXACT SAME EVENT_ID",
      final_handoff:
        true,
      real_bet_post:
        false
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

    handoff: {
      enabled:
        HANDOFF_ENABLED,
      currency:
        BET_CURRENCY,
      stake:
        BET_STAKE,
      endpoint:
        TRADING_STRAIGHT_ENDPOINT,
      sent:
        false
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
        tracker.error ||
        null
    },

    diagnostics,

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
    handoff_enabled:
      HANDOFF_ENABLED,
    status:
      "OK",

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
      direct_event_preflight:
        true,
      direct_preflight_endpoint:
        "/preflight",
      matcher_lookup:
        true,
      matcher_used_for_matching:
        false,
      matcher_used_for_exact_odds:
        true,
      matcher_odds_endpoint:
        "/live",
      fuzzy_matching:
        false,
      cloudbet_fallback:
        false,
      exact_event_lock:
        true,
      final_event_refresh:
        true,
      current_odds_source:
        "MATCHER /live EXACT EVENT_ID",
      final_handoff:
        true,
      real_bet_post:
        false
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
        true,
      trading_endpoint:
        TRADING_STRAIGHT_ENDPOINT,
      handoff_only:
        true
    },

    endpoints: [
      "/",
      "/health",
      "/run",
      "/preflight",
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
      new URL(
        request.url
      );

    const path =
      url.pathname;

    try {
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
          dry_run:
            DRY_RUN,
          betting_enabled:
            BETTING_ENABLED,
          handoff_enabled:
            HANDOFF_ENABLED,
          status:
            "ONLINE",

          flow: [
            "TRACKER /entries OR DIRECT /preflight",
            "READ exact cloudbet.event_id + entry_odds",
            "LOCK SAME EVENT ID",
            "CLOUDBET /event?id=EVENT_ID",
            "VERIFY SAME EVENT + 1H + 0:0",
            "MATCHER /live",
            "FIND EXACT SAME EVENT_ID ONLY",
            "REFRESH exact 1H OVER 0.5 current_odds",
            "IF UNAVAILABLE -> PENDING_ODDS",
            "RETRY SAME EVENT / MARKET / LINE",
            "READY_TO_BET",
            "D1 ARCHIVE",
            "ACCOUNT SNAPSHOT /account-test",
            "BALANCE + MIN/MAX STAKE PREFLIGHT",
            "BUILD TRADING API HANDOFF",
            "STOP — NO REAL POST"
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

          handoff: {
            currency:
              BET_CURRENCY,
            stake:
              BET_STAKE,
            endpoint:
              TRADING_STRAIGHT_ENDPOINT,
            enabled:
              HANDOFF_ENABLED,
            real_post:
              false
          },

          safety: {
            matcher_inside_bet_worker:
              true,
            matcher_purpose:
              "EXACT_ODDS_ONLY",
            matcher_name_matching:
              false,
            matcher_event_selection:
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
            "/preflight",
            "/diagnostic",
            "/entries"
          ]
        });
      }

      if (
        path ===
        "/health"
      ) {
        return healthResponse();
      }

      if (
        path ===
        "/entries"
      ) {
        return json(
          await runEntriesProxy(
            env
          )
        );
      }

      if (
        path ===
        "/diagnostic"
      ) {
        return json(
          await runDiagnostic(
            env
          )
        );
      }

      if (
        path ===
        "/preflight"
      ) {
        if (
          request.method !==
          "POST"
        ) {
          return json(
            {
              success:
                false,
              worker:
                "cloudbet-bet-worker",
              version:
                VERSION,
              error:
                "METHOD_NOT_ALLOWED",
              expected_method:
                "POST"
            },
            405
          );
        }

        let input:
          DirectPreflightInput = {};

        try {
          input =
            await request.json();
        } catch {
          return json(
            {
              success:
                false,
              worker:
                "cloudbet-bet-worker",
              version:
                VERSION,
              error:
                "INVALID_JSON_BODY"
            },
            400
          );
        }

        return json(
          await runDirectPreflight(
            env,
            input
          )
        );
      }

      if (
        path ===
        "/run"
      ) {
        return json(
          await runWorker(
            env
          )
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
            "Not found",
          path
        },
        404
      );
    } catch (
    error
    ) {
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
