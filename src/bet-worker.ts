// ============================================================
// CLOUDBET BET WORKER V7.3.4
// DRY RUN · TRACKER READY CANDIDATE · EXACT MATCHER ODDS REFRESH
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V7.3.4:
// - dynamic legacy bet_archive compatibility
// - reads production schema with PRAGMA table_info(bet_archive)
// - fills known required legacy columns (match_id/result/status/mode/etc.)
// - blocks clearly on unknown required columns instead of inventing data
// - no Matcher / Tracker / betting logic changes
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
  AI_MATCHER: Fetcher;
  DB: D1Database;
  CLOUDBET_API_KEY?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

type Obj = Record<string, any>;

// V7.6.21 DIRECT PREFLIGHT FIX:
// - Fixes Telegram BET READY -> INVALID_SIGNAL
// - Direct /preflight enriches the just-created Hunter signal from TRACKER /entries
// - HOME/AWAY can also be derived safely from match/match_name
// - competition can fall back to league
// - AI /resolve therefore receives a complete fixture identity signal
// - /run fast AI-history path remains unchanged
// - Existing betting/test code is preserved
// - NORMAL BETTING REMAINS DISABLED
//
// // V7.6.20 FAST /run FIX:
// - /run NO LONGER calls AI /resolve sequentially for every Hunter signal
// - /run fetches AI Matcher /api/history ONCE and reads current V1.3.3 accepted matches
// - This removes long browser hangs when many Hunter signals are present
// - Direct /preflight can still use AI /resolve for one signal
// - AI /resolve now has a hard timeout
// - Existing betting/test code preserved
// - NORMAL BETTING REMAINS DISABLED
//
// // V7.6.19 AI MATCHER CONNECTION:
// - AI_MATCHER service binding is now the PRIMARY source of Cloudbet event_id
// - Uses AI Matcher POST /resolve for Hunter fixture identity
// - Requires AI accepted=true, confidence>=0.90 and category_guard.ok=true
// - Tracker/old matcher event_id is retained only as diagnostic/entry-odds metadata
// - Old MATCHER binding remains untouched and is still used ONLY for exact SAME event_id odds refresh
// - If AI event_id differs from Tracker event_id, stale Tracker entry_odds are NOT reused
// - Final same-event / score / period / minute / exact market / odds / balance / duplicate gates remain unchanged
// - ALL existing betting/test code is preserved
// - NORMAL BETTING REMAINS DISABLED
//
// // V7.6.18 FIX:
// - Rearms exactly ONE additional automatic real 0.10 USDT E2E test with a NEW D1 key
// - A PlaceBet response of PENDING_ACCEPTANCE is NOT archived as a placed bet
// - real_bet_archive is written ONLY after Cloudbet returns betStatus=ACCEPTED
// - PENDING / REJECTED / API errors stay only in the safety/test guard tables
// - Adds GET /bet-status?reference_id=... to query Cloudbet GraphQL directly
// - /bet-status archives + notifies only when Cloudbet confirms ACCEPTED
// - Normal betting remains DISABLED; all existing final safety gates remain active
//
// // V7.6.17 FIX:
// - NEXT genuine DIRECT_PREFLIGHT BET READY can execute the existing AUTO E2E one-shot
// - Real test stake remains exactly 0.10 USDT and globally one-shot guarded in D1
// - Final fresh same-event validation now also receives Hunter entry_minute fallback
// - Final event/score/period/minute/exact 1H O0.5/selection/odds/stake/balance/duplicate gates remain active
//
// // V7.6.16 FIX:
// - DIRECT /preflight now passes Hunter entry_minute into verifySameEventAndOdds()
// - If Cloudbet minute is unavailable, Hunter ENTRY minute may be used only inside 10-42
// - SAME event_id, score, period, exact 1H O0.5, selection, odds, stake, balance and duplicate checks remain unchanged
// - No matching thresholds or betting enablement changed
//
// // V7.6.15:
// - Cloudbet minute remains authoritative when present.
// - Explicit Cloudbet minute outside 10–42 is still blocked.
// - If Cloudbet minute is missing, the original Hunter ENTRY minute may be used
//   only as a fallback, while SAME event_id + exact 1H O0.5 + selection state
//   + score/period safety checks remain mandatory.
// - No fuzzy event fallback and no betting threshold was lowered.

// ============================================================
// V7.6.22 — AI WAIT + ODDS HOLD FIX
//
// - Temporary AI /resolve failures => WAITING_AI, not final rejection.
// - Missing AI history => pending until next cron, not skipped/rejected.
// - Accepted AI match + unavailable exact odds => persistent PENDING_ODDS.
// - Existing pending_odds row owns retries; /run does not duplicate checks.
// - Terminal failures (goal, 1H ended, outside window, changed event) do not retry.
// - SAME AI event_id / exact 1H O0.5 / all final safety gates preserved.
// - NORMAL BETTING REMAINS OFF; existing one-shot keys are NOT rearmed.
// ============================================================

// ============================================================
// CONFIG
// ============================================================

const VERSION =
  "V7.6.23 MATCHER SYNC + PENDING ODDS CALLBACK - BETTING OFF";

const MODE =
  "DRY_RUN";

const DRY_RUN =
  true;

const BETTING_ENABLED =
  false;

const BET_MINUTE_FROM =
  10;

const BET_MINUTE_TO =
  42;

// Handoff only. Does NOT transmit wager.
const HANDOFF_ENABLED =
  true;

const BET_CURRENCY =
  "USDT";

const BET_STAKE =
  "0.10";

const TRADING_STRAIGHT_ENDPOINT =
  "https://sports-api.cloudbet.com/pub/v4/bets/place/straight";

const TRADING_TRANSPORT =
  "GRAPHQL";

// ONE-SHOT REAL API TEST. This does not enable normal betting.
// Dedicated one-shot real API test. Normal betting remains disabled.
// Exactly one 0.10 USDT request can be sent through the explicit confirmed route.
const REAL_TEST_ENABLED = false;
const REAL_TEST_STAKE = 0.10;
const REAL_TEST_KEY = "V7.6.7_GRAPHQL_ONE_SHOT_0_10_USDT"; // keep consumed key; real test disabled
const REAL_TEST_CONFIRM = "PLACE_0_10_USDT_ONCE";

// V7.6.11 — automatic end-to-end proof test.
// Normal betting stays OFF. Exactly one automatic real 0.10 USDT request
// may be sent from the normal Hunter -> /run flow after ALL safety gates pass.
const AUTO_E2E_TEST_ENABLED = true;
const AUTO_E2E_TEST_STAKE = "0.10";
const AUTO_E2E_TEST_KEY = "V7.6.18_SECOND_AUTO_E2E_ONE_SHOT_0_10_USDT";

// Legacy display/archive value preserved from V7.0.2.
const BET_STAKE_EUR =
  0.10;

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

const TARGET_MARKET_URL =
  `${TARGET_MARKET}/${TARGET_OUTCOME}?${TARGET_PARAMS}`;

const CLOUDBET_EVENT_PATH =
  "/event?id=";

const SERVICE_TIMEOUT_MS =
  10_000;

const AI_MATCHER_TIMEOUT_MS =
  12_000;

const AI_HISTORY_LIMIT =
  500;

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
// V7.6.19 — AI MATCHER PRIMARY IDENTITY
// AI decides fixture identity only.
// Bet Worker remains authoritative for every betting safety gate.
// ============================================================

interface AiMatchResolution {
  ok: boolean;
  accepted: boolean;
  event_id: string | null;
  cloudbet_match: string | null;
  confidence: number | null;
  reason: string | null;
  category_guard_ok: boolean;
  cache_hit: boolean | null;
  raw: any;
}

async function resolveAiMatch(
  env: Env,
  signal: any
): Promise<AiMatchResolution> {
  if (!env.AI_MATCHER) {
    return {
      ok: false,
      accepted: false,
      event_id: null,
      cloudbet_match: null,
      confidence: null,
      reason: "AI_MATCHER_BINDING_MISSING",
      category_guard_ok: false,
      cache_hit: null,
      raw: null
    };
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      AI_MATCHER_TIMEOUT_MS
    );

  try {
    const response = await env.AI_MATCHER.fetch(
      new Request(
        "https://ai-matcher.internal/resolve",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "accept": "application/json"
          },
          body: JSON.stringify(signal ?? {}),
          signal: controller.signal
        }
      )
    );

    const rawText = await response.text();

    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = {
        parse_error: true,
        raw: rawText.slice(0, 4000)
      };
    }

    if (!response.ok || data?.success !== true) {
      return {
        ok: false,
        accepted: false,
        event_id: null,
        cloudbet_match: null,
        confidence: null,
        reason:
          safe(data?.error) ||
          `AI_MATCHER_HTTP_${response.status}`,
        category_guard_ok: false,
        cache_hit:
          typeof data?.cache_hit === "boolean"
            ? data.cache_hit
            : null,
        raw: data
      };
    }

    const result = data?.result ?? {};
    const eventId =
      normalizeEventId(
        result?.event_id ??
        result?.candidate?.event_id ??
        result?.candidate?.id
      );

    const confidence =
      numberOrNull(
        result?.confidence
      );

    const categoryGuardOk =
      result?.category_guard?.ok === true;

    const accepted =
      result?.accepted === true &&
      eventId !== null &&
      confidence !== null &&
      confidence >= 0.90 &&
      categoryGuardOk;

    return {
      ok: true,
      accepted,
      event_id: eventId,
      cloudbet_match:
        safe(
          result?.cloudbet_match ??
          ""
        ) || null,
      confidence,
      reason:
        accepted
          ? safe(result?.reason) || "AI_MATCH_ACCEPTED"
          : safe(result?.reason) || "AI_MATCH_NOT_ACCEPTED",
      category_guard_ok: categoryGuardOk,
      cache_hit:
        typeof data?.cache_hit === "boolean"
          ? data.cache_hit
          : null,
      raw: data
    };
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      event_id: null,
      cloudbet_match: null,
      confidence: null,
      reason:
        error instanceof Error
          ? error.message
          : String(error),
      category_guard_ok: false,
      cache_hit: null,
      raw: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

function aiHistorySignalIds(signal: any): string[] {
  const ids = [
    signal?.id,
    signal?.signal_id,
    signal?.match_id,
    signal?.v27_id
  ]
    .map(value => safe(value))
    .filter(Boolean);

  return Array.from(new Set(ids));
}

async function fetchAiHistory(
  env: Env
): Promise<{
  ok: boolean;
  rows: any[];
  error: string | null;
}> {
  if (!env.AI_MATCHER) {
    return {
      ok: false,
      rows: [],
      error: "AI_MATCHER_BINDING_MISSING"
    };
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      AI_MATCHER_TIMEOUT_MS
    );

  try {
    const response =
      await env.AI_MATCHER.fetch(
        new Request(
          `https://ai-matcher.internal/api/history?limit=${AI_HISTORY_LIMIT}`,
          {
            method: "GET",
            headers: {
              "accept": "application/json"
            },
            signal: controller.signal
          }
        )
      );

    const data =
      await response.json() as any;

    if (!response.ok || data?.success !== true) {
      return {
        ok: false,
        rows: [],
        error:
          safe(data?.error) ||
          `AI_HISTORY_HTTP_${response.status}`
      };
    }

    return {
      ok: true,
      rows:
        Array.isArray(data?.history)
          ? data.history
          : [],
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function findAiHistoryMatch(
  signal: any,
  rows: any[]
): AiMatchResolution {
  const ids =
    aiHistorySignalIds(signal);

  const home =
    safe(signalHome(signal))
      .toLowerCase();

  const away =
    safe(signalAway(signal))
      .toLowerCase();

  const row =
    rows.find((item: any) => {
      const rowIds = [
        item?.signal_id,
        item?.match_id
      ]
        .map((value: any) => safe(value))
        .filter(Boolean);

      if (
        ids.length &&
        rowIds.some((id: string) =>
          ids.includes(id)
        )
      ) {
        return true;
      }

      return (
        home &&
        away &&
        safe(item?.hunter_home).toLowerCase() === home &&
        safe(item?.hunter_away).toLowerCase() === away
      );
    }) ?? null;

  if (!row) {
    return {
      ok: true,
      accepted: false,
      event_id: null,
      cloudbet_match: null,
      confidence: null,
      reason: "AI_MATCH_PENDING_HISTORY",
      category_guard_ok: false,
      cache_hit: false,
      raw: null
    };
  }

  const confidence =
    numberOrNull(row?.confidence);

  const eventId =
    normalizeEventId(
      row?.cloudbet_event_id
    );

  const categoryGuardOk =
    Number(row?.category_guard_ok) === 1;

  const currentVersion =
    safe(row?.matcher_version) ===
    "AI-MATCHER-V1.3.3-BET-WORKER-RESOLVE-HISTORY-500";

  const accepted =
    currentVersion &&
    Number(row?.ai_accepted) === 1 &&
    eventId !== null &&
    confidence !== null &&
    confidence >= 0.90 &&
    categoryGuardOk;

  return {
    ok: true,
    accepted,
    event_id: eventId,
    cloudbet_match:
      safe(row?.cloudbet_match) || null,
    confidence,
    reason:
      accepted
        ? safe(row?.reason) || "AI_HISTORY_ACCEPTED"
        : !currentVersion
        ? "AI_HISTORY_OLD_VERSION"
        : safe(row?.reason) || "AI_HISTORY_NOT_ACCEPTED",
    category_guard_ok: categoryGuardOk,
    cache_hit: true,
    raw: row
  };
}


function isAiResolutionPending(
  aiMatch: AiMatchResolution | null | undefined
): boolean {
  if (!aiMatch) return true;

  const reason =
    safe(aiMatch.reason).toUpperCase();

  if (reason === "AI_MATCHER_BINDING_MISSING") {
    return false;
  }

  if (reason === "AI_MATCH_PENDING_HISTORY") {
    return true;
  }

  if (!aiMatch.ok) {
    return true;
  }

  return (
    reason.includes("TIMEOUT") ||
    reason.includes("ABORT") ||
    reason.includes("TEMPORAR") ||
    reason.startsWith("AI_MATCHER_HTTP_")
  );
}

const TERMINAL_PREFLIGHT_ERRORS =
  new Set([
    "CLOUDBET_EVENT_ID_CHANGED",
    "SCORE_NOT_0_0",
    "FIRST_HALF_ENDED",
    "OUTSIDE_HUNTER_MINUTE_WINDOW",
    "HUNTER_ENTRY_MINUTE_OUTSIDE_WINDOW",
    "EVENT_FINISHED",
    "NOT_FIRST_HALF",
    "MINUTE_OVER_45"
  ]);

function isTerminalPreflightFailure(
  reason: any
): boolean {
  return TERMINAL_PREFLIGHT_ERRORS.has(
    safe(reason)
  );
}

async function pendingOddsExists(
  env: Env,
  cloudbetIdInput: any
): Promise<boolean> {
  const cloudbetId =
    normalizeEventId(cloudbetIdInput);

  if (!cloudbetId) return false;

  const row =
    await env.DB
      .prepare(`
        SELECT id
        FROM pending_odds
        WHERE cloudbet_id = ?
        LIMIT 1
      `)
      .bind(cloudbetId)
      .first();

  return !!row;
}

async function removePendingRow(
  env: Env,
  rowId: any,
  reason: string
): Promise<any> {
  if (rowId !== null && rowId !== undefined) {
    await env.DB
      .prepare(`
        DELETE FROM pending_odds
        WHERE id = ?
      `)
      .bind(rowId)
      .run();
  }

  return {
    action: "REMOVED_TERMINAL",
    error: reason
  };
}

function buildAiSelectedCloudbetData(
  signal: any,
  aiMatch: AiMatchResolution
): TrackerCloudbetData {
  const previous =
    trackerCloudbetData(signal);

  const eventId =
    normalizeEventId(
      aiMatch?.event_id
    );

  const sameAsPrevious =
    Boolean(
      eventId &&
      previous.event_id &&
      eventId === previous.event_id
    );

  // Entry odds belong to the OLD tracker-selected event.
  // Reuse them only when both systems selected the exact same event_id.
  const entryOdds =
    sameAsPrevious
      ? previous.entry_odds
      : null;

  const maxStake =
    sameAsPrevious
      ? previous.max_stake
      : null;

  return {
    event_id: eventId,
    match:
      aiMatch?.cloudbet_match ??
      previous.match ??
      null,
    entry_odds: entryOdds,
    max_stake: maxStake,
    odds_available:
      entryOdds !== null &&
      entryOdds > 1,
    matcher_score:
      aiMatch?.confidence ?? null
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
  event: any,
  hunterEntryMinute: number | null = null
): {
  valid: boolean;
  reason: string;
  score: any;
  period: string;
  minute: number | null;
} {
  const score = cloudbetScore(event);
  const period = cloudbetPeriod(event);
  const minute = cloudbetMinute(event);

  // HARD GATE #1 — if Cloudbet exposes the score, it must still be exactly 0:0.
  // Some live Cloudbet events do not expose a live score at all. In that case
  // SCORE_UNKNOWN is allowed to continue to the remaining safety gates.
  if (score.known && (score.home !== 0 || score.away !== 0)) {
    return { valid: false, reason: "SCORE_NOT_0_0", score, period, minute };
  }

  // HARD GATE #2 — period handling.
  // If Cloudbet explicitly says the event is no longer in the first half, BLOCK.
  // Some live Cloudbet events do not expose a usable period at all. In that case
  // PERIOD_UNKNOWN is allowed to continue because the exact 1H O0.5 market,
  // current minute window and selection status are checked later.
  const firstHalfHints = [
    "1p", "1h", "first", "first_half", "first half"
  ];

  const nonFirstHalfHints = [
    "2p", "2h", "second", "second_half", "second half",
    "ht", "half time", "halftime",
    "ft", "full time", "finished", "ended", "final"
  ];

  const firstHalfConfirmed =
    firstHalfHints.some(hint => period.includes(hint));

  const explicitlyNotFirstHalf =
    nonFirstHalfHints.some(hint => period.includes(hint));

  if (!firstHalfConfirmed && explicitlyNotFirstHalf) {
    return { valid: false, reason: "FIRST_HALF_ENDED", score, period, minute };
  }

  // Unknown / generic live period is allowed.
  // Exact first-half market + active selection remain mandatory downstream.

  // HARD GATE #3 — Cloudbet minute is authoritative when present.
  // If Cloudbet does not expose a usable minute, use the original Hunter ENTRY
  // minute only as a constrained fallback. This does NOT relax the SAME event_id,
  // exact 1H O0.5 market, selection, score or period protections.
  if (minute !== null) {
    if (minute < BET_MINUTE_FROM || minute > BET_MINUTE_TO) {
      return {
        valid: false,
        reason: "OUTSIDE_HUNTER_MINUTE_WINDOW",
        score,
        period,
        minute
      };
    }

    return {
      valid: true,
      reason: "EVENT_VALID",
      score,
      period,
      minute
    };
  }

  const fallbackMinute =
    numberOrNull(
      hunterEntryMinute
    );

  if (
    fallbackMinute === null
  ) {
    return {
      valid: false,
      reason: "MINUTE_UNKNOWN",
      score,
      period,
      minute
    };
  }

  if (
    fallbackMinute < BET_MINUTE_FROM ||
    fallbackMinute > BET_MINUTE_TO
  ) {
    return {
      valid: false,
      reason: "HUNTER_ENTRY_MINUTE_OUTSIDE_WINDOW",
      score,
      period,
      minute
    };
  }

  return {
    valid: true,
    reason: "EVENT_VALID_HUNTER_MINUTE_FALLBACK",
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
  expectedEventId: string,
  hunterEntryMinute: number | null = null
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

    const validation =
      eventStillValidForTarget(
        event,
        hunterEntryMinute
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
          matcherOdds.current_odds,
        max_stake:
          matcherOdds.max_stake,
        min_stake:
          matcherOdds.min_stake,
        selection_status:
          matcherOdds.selection_status,
        market_url:
          matcherOdds.market_url,
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

    // HARD GATE #4 — exact market/selection/odds must match the intended bet.
    const exactMarketUrl = safe(matcherOdds.market_url) === TARGET_MARKET_URL;
    const selectionEnabled = safe(matcherOdds.selection_status) === "SELECTION_ENABLED";
    const livePrice = numberOrNull(matcherOdds.current_odds);

    if (!exactMarketUrl || !selectionEnabled || livePrice === null || livePrice <= 1) {
      return {
        success: false,
        event_id: expectedEventId,
        current_odds: livePrice,
        max_stake: matcherOdds.max_stake,
        min_stake: matcherOdds.min_stake,
        selection_status: matcherOdds.selection_status,
        market_url: matcherOdds.market_url,
        event,
        validation: {
          ...validation,
          exact_event_id: true,
          exact_market_url: exactMarketUrl,
          selection_enabled: selectionEnabled,
          odds_source: "MATCHER_LIVE_EXACT_EVENT_ID"
        },
        error: !exactMarketUrl
          ? "EXACT_MARKET_URL_MISMATCH"
          : (!selectionEnabled ? "SELECTION_NOT_ENABLED" : "CURRENT_ODDS_INVALID")
      };
    }

    return {
      success:
        true,
      event_id:
        expectedEventId,
      current_odds:
        matcherOdds.current_odds,
      max_stake:
        matcherOdds.max_stake,
      min_stake:
        matcherOdds.min_stake,
      selection_status:
        matcherOdds.selection_status,
      market_url:
        matcherOdds.market_url,
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
  if (!HANDOFF_ENABLED) {
    return null;
  }

  const eventId =
    normalizeEventId(
      bet?.cloudbet?.event_id ??
      current?.event_id ??
      null
    );

  const marketUrl =
    safe(
      current?.market_url ??
      bet?.cloudbet?.market_url ??
      ""
    );

  const price =
    numberOrNull(
      current?.current_odds ??
      bet?.odds?.current_odds ??
      null
    );

  if (
    !eventId ||
    marketUrl !== TARGET_MARKET_URL ||
    price === null ||
    price <= 1 ||
    safe(BET_STAKE) !== "0.10"
  ) {
    return null;
  }

  const preflight =
    buildAccountPreflight(
      account,
      current
    );

  const referenceId =
    crypto.randomUUID();

  const input = {
    referenceId,
    eventId,
    price: String(price),
    currency: BET_CURRENCY,
    marketUrl,
    stake: BET_STAKE
  };

  const query = `
    mutation PlaceBet($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId
        eventId
        marketUrl
        currency
        price
        stake
        betStatus
        side
        betErrorCode
      }
    }
  `;

  return {
    ready_to_send:
      preflight.ready_to_send,
    sent:
      false,
    transport:
      TRADING_TRANSPORT,
    block_reason:
      preflight.block_reason,
    preflight,

    method:
      "POST",

    endpoint:
      GRAPHQL_ENDPOINT,

    headers: {
      "Accept":
        "application/json",
      "Content-Type":
        "application/json",
      "X-API-KEY":
        "<CLOUDBET_API_KEY>"
    },

    operation:
      "PlaceBet",

    graphql_input:
      input,

    body: {
      query,
      variables: {
        input
      }
    },

    // Compatibility snapshot only. Never transmitted by V7.6.3.
    legacy_rest_selection: {
      eventId,
      marketUrl,
      price: String(price)
    }
  };
}

// ============================================================
// NOTE
// The remainder of the original V7.6.0 file is preserved below.
// ============================================================

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
    result:
      "TEXT",
    status:
      "TEXT",
    mode:
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

    await env.DB
      .prepare(`
        CREATE TABLE IF NOT EXISTS bet_archive (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          match_id TEXT,
          result TEXT,
          status TEXT,
          mode TEXT,
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
  entry_minute?: any;
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
// V7.3.4 — DYNAMIC LEGACY ARCHIVE HELPERS
// ============================================================

async function getBetArchiveSchema(
  env: Env
): Promise<D1ColumnInfo[]> {
  const result =
    await env.DB
      .prepare(
        "PRAGMA table_info(bet_archive)"
      )
      .all<D1ColumnInfo>();

  return result.results || [];
}

function getLegacyArchiveValue(
  name: string,
  ctx: any
): any {
  const key = name.toLowerCase();

  switch (key) {
    case "match_id":
    case "signal_match_id":
      return ctx.match_id;

    case "result":
      return "PREFLIGHT_READY";

    case "status":
      return "ARCHIVED";

    case "mode":
      return MODE;

    case "execution_id":
      return ctx.execution_id;

    case "timestamp":
    case "created_at":
    case "updated_at":
      return nowISO();

    case "cloudbet_id":
    case "event_id":
      return ctx.cloudbet_id;

    case "match":
    case "match_name":
      return signalMatch(ctx.signal);

    case "home":
    case "home_team":
      return signalHome(ctx.signal);

    case "away":
    case "away_team":
      return signalAway(ctx.signal);

    case "odds":
    case "entry_odds":
    case "current_odds":
      return ctx.current_odds;

    case "stake_eur":
    case "stake":
      return BET_STAKE_EUR;

    case "market":
      return BET_MARKET;

    case "selection":
      return BET_SELECTION;

    case "entry_minute":
    case "minute":
      return ctx.signal?.entry_minute ?? ctx.signal?.minute ?? null;

    case "hunter_score":
      return ctx.signal?.hunter_score ?? ctx.signal?.score ?? null;

    case "payload_json":
    case "payload":
      return ctx.payload_json;

    default:
      return undefined;
  }
}

async function insertArchiveCompatible(
  env: Env,
  base: Record<string, any>,
  ctx: any
): Promise<any> {
  const schema =
    await getBetArchiveSchema(env);

  const valuesByColumn:
    Record<string, any> = {
      ...base
    };

  const filled:
    string[] = [];

  for (const col of schema) {
    const name =
      safe(col?.name).toLowerCase();

    if (!name) continue;

    if (
      name === "id" &&
      Number(col?.pk || 0) === 1
    ) {
      continue;
    }

    if (
      Object.prototype.hasOwnProperty.call(
        valuesByColumn,
        name
      )
    ) {
      continue;
    }

    const mapped =
      getLegacyArchiveValue(
        name,
        ctx
      );

    if (mapped !== undefined) {
      valuesByColumn[name] =
        mapped;

      filled.push(name);
      continue;
    }

    const required =
      Number(col?.notnull || 0) === 1;

    const hasDefault =
      col?.dflt_value !== null &&
      col?.dflt_value !== undefined;

    if (required && !hasDefault) {
      throw new Error(
        `UNSUPPORTED_REQUIRED_LEGACY_COLUMN:${col?.name}`
      );
    }
  }

  const validNames =
    new Set(
      schema
        .map(
          c =>
            safe(c?.name)
              .toLowerCase()
        )
        .filter(Boolean)
    );

  const columns =
    Object.keys(valuesByColumn)
      .filter(
        c =>
          validNames.has(c)
      );

  const placeholders =
    columns.map(() => "?")
      .join(", ");

  const sql =
    `INSERT INTO bet_archive (${columns.join(", ")}) VALUES (${placeholders})`;

  const values =
    columns.map(
      c =>
        valuesByColumn[c]
    );

  await env.DB
    .prepare(sql)
    .bind(...values)
    .run();

  return {
    columns,
    legacy_filled: filled
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
    const archivePayloadJson =
      JSON.stringify({
        signal,
        bet,
        current
      });

    const archiveInsert =
      await insertArchiveCompatible(
        env,
        {
          match_id:
            archiveMatchId,
          execution_id:
            bet.execution_id,
          timestamp:
            nowISO(),
          cloudbet_id:
            cloudbetId,
          home:
            signalHome(signal),
          away:
            signalAway(signal),
          odds:
            currentOdds,
          stake_eur:
            BET_STAKE_EUR,
          market:
            BET_MARKET,
          selection:
            BET_SELECTION,
          payload_json:
            archivePayloadJson
        },
        {
          match_id:
            archiveMatchId,
          execution_id:
            bet.execution_id,
          cloudbet_id:
            cloudbetId,
          signal,
          current_odds:
            currentOdds,
          payload_json:
            archivePayloadJson
        }
      );

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
      archive_columns:
        archiveInsert.columns,
      legacy_columns_filled:
        archiveInsert.legacy_filled,
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
// V7.6.23 — TRACKER CALLBACK FOR PENDING_ODDS -> FOUND
// ============================================================

async function notifyTrackerOddsFound(
  env: Env,
  row: any,
  signal: any,
  cloudbetId: string,
  current: any
): Promise<any> {

  if (!env.TRACKER) {
    return {
      success: false,
      reason:
        "TRACKER_BINDING_MISSING"
    };
  }

  const odds =
    numberOrNull(
      current?.odds ??
      current?.price ??
      current?.current_odds
    );

  if (
    odds === null ||
    odds <= 1
  ) {
    return {
      success: false,
      reason:
        "ODDS_MISSING"
    };
  }

  try {

    const response =
      await env.TRACKER.fetch(
        new Request(
          "https://tracker.internal/internal/odds-found",
          {
            method: "POST",
            headers: {
              "content-type":
                "application/json",
              "accept":
                "application/json"
            },
            body:
              JSON.stringify({
                match_id:
                  signal?.match_id ??
                  signal?.id ??
                  row?.match_id ??
                  null,

                signal_id:
                  signal?.id ??
                  null,

                event_id:
                  cloudbetId,

                odds,

                max_stake:
                  numberOrNull(
                    current?.max_stake ??
                    current?.maxStake
                  ),

                cloudbet_match:
                  current?.match ??
                  current?.cloudbet_match ??
                  null,

                found_at:
                  nowISO(),

                source:
                  "BET_WORKER_PENDING_RETRY"
              })
          }
        )
      );

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
      data = {
        raw:
          text.slice(
            0,
            500
          )
      };
    }

    return {
      success:
        response.ok &&
        data?.success !== false,
      status:
        response.status,
      data
    };

  } catch (error) {

    return {
      success: false,
      reason:
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
  account: AccountSnapshot,
  current?: CurrentOddsResult
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
      auto_e2e_test: {
        attempted: false,
        consumed: false,
        reason: AUTO_E2E_TEST_ENABLED
          ? "NO_PENDING_ODDS"
          : "AUTO_E2E_TEST_DISABLED"
      },
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

  // V7.6.12 — if a signal originally entered PENDING_ODDS and odds later
  // become available, the same one-shot E2E test is allowed to execute here.
  // This closes the READY-via-pending gap. The global D1 one-shot guard still
  // guarantees at most one real 0.10 USDT attempt.
  let autoE2ETest: any = {
    attempted: false,
    consumed: false,
    reason: AUTO_E2E_TEST_ENABLED
      ? "WAITING_FOR_PENDING_ODDS_READY"
      : "AUTO_E2E_TEST_DISABLED"
  };

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
        cloudbetId,
        numberOrNull(
          row.entry_minute
        )
      );

    if (
      !current.success
    ) {
      const result =
        isTerminalPreflightFailure(
          current.error
        )
          ? await removePendingRow(
              env,
              row.id,
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
          "REMOVED_MISSING" ||
        result.action ===
          "REMOVED_TERMINAL"
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

    // Persist the newly discovered real odds back into Hunter D1
    // and send ONE Telegram reply to the original ENTRY.
    const trackerNotification =
      await notifyTrackerOddsFound(
        env,
        row,
        signal,
        cloudbetId,
        current
      );

    const handoff =
      buildTradingHandoff(
        bet,
        current,
        account
      );

    // V7.6.12 FIX — READY after PENDING_ODDS must follow the same real-test
    // execution path as an immediately READY Hunter signal.
    if (
      AUTO_E2E_TEST_ENABLED &&
      handoff?.ready_to_send === true &&
      autoE2ETest?.consumed !== true &&
      autoE2ETest?.attempted !== true
    ) {
      autoE2ETest = await runAutoE2EOneShot(
        env,
        signal,
        cloudbetId
      );
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
        "READY_TO_BET",
      odds_transition:
        "PENDING_TO_FOUND",
      bet,
      handoff,
      archive,
      tracker_notification:
        trackerNotification
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
    auto_e2e_test: autoE2ETest,
    results
  };
}


function graphqlTradingPayloadPreview(): any {
  const exampleInput = {
    referenceId: "<UUID>",
    eventId: "<EVENT_ID>",
    price: "<CURRENT_ODDS>",
    currency: BET_CURRENCY,
    marketUrl: TARGET_MARKET_URL,
    stake: BET_STAKE
  };

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "GRAPHQL_TRADING_PAYLOAD_PREVIEW",
    safe_read_only: true,
    wager_sent: false,
    betting_enabled: BETTING_ENABLED,
    real_test_enabled: REAL_TEST_ENABLED,
    transport: TRADING_TRANSPORT,
    endpoint: GRAPHQL_ENDPOINT,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-KEY": "<CLOUDBET_API_KEY>"
    },
    body: {
      query: `mutation PlaceBet($input: PlaceBetInput!) { placeBet(input: $input) { referenceId eventId marketUrl currency price stake betStatus side betErrorCode } }`,
      variables: {
        input: exampleInput
      }
    }
  };
}


// ============================================================
// V7.6.5 — SAFE GRAPHQL ZERO-STAKE VALIDATION
//
// Purpose:
// - locks to one REAL Cloudbet event id
// - refreshes REAL current odds for the exact 1H O0.5 selection
// - sends the real eventId / marketUrl / price to GraphQL placeBet
// - deliberately sends numeric ZERO stake so no valid wager exists
// - never uses BET_STAKE / REAL_TEST_STAKE
//
// This is NOT a read-only HTTP request: it does call the placeBet resolver.
// It is intentionally non-wagering because the stake is invalid by design.
// ============================================================

const GRAPHQL_VALIDATION_ZERO_STAKE =
  "0";

function graphqlErrorMessages(body: any): string[] {
  if (!Array.isArray(body?.errors)) {
    return [];
  }

  return body.errors
    .map((item: any) => safe(item?.message))
    .filter(Boolean);
}

function classifyGraphqlValidationResponse(
  status: number,
  body: any
): string {
  const messages = graphqlErrorMessages(body);
  const joined = messages.join(" | ").toLowerCase();

  if (status === 401 || status === 403) {
    return "GRAPHQL_AUTH_REJECTED";
  }

  if (
    joined.includes("stake") ||
    joined.includes("invalid") ||
    joined.includes("amount") ||
    joined.includes("number") ||
    joined.includes("numeric") ||
    joined.includes("scalar")
  ) {
    return "PLACEBET_INPUT_OR_BUSINESS_VALIDATION_REACHED";
  }

  const placeBet = body?.data?.placeBet ?? null;

  if (placeBet?.betErrorCode) {
    return "PLACEBET_BUSINESS_VALIDATION_REACHED";
  }

  if (placeBet) {
    return "UNEXPECTED_PLACEBET_DATA_RETURNED_REVIEW_IMMEDIATELY";
  }

  if (status >= 200 && status < 500 && messages.length > 0) {
    return "GRAPHQL_VALIDATION_PATH_REACHED";
  }

  return "GRAPHQL_VALIDATION_MIXED_RESULT";
}

async function runGraphqlSafeValidation(
  env: Env,
  eventIdInput: any
): Promise<any> {
  const started = Date.now();
  const eventId = normalizeEventId(eventIdInput);

  if (!eventId) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      valid_wager_sent: false,
      placebet_request_sent: false,
      error: "EVENT_ID_REQUIRED",
      example: "/graphql-validation-test?event_id=36197593",
      processing_ms: Date.now() - started
    };
  }

  const apiKey = safe(env.CLOUDBET_API_KEY);

  if (!apiKey) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      event_id: eventId,
      valid_wager_sent: false,
      placebet_request_sent: false,
      error: "CLOUDBET_API_KEY_MISSING",
      processing_ms: Date.now() - started
    };
  }

  // Reuse the existing SAME-EVENT + exact 1H O0.5 verification path.
  const current = await verifySameEventAndOdds(env, eventId);

  if (!current?.success) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      event_id: eventId,
      valid_wager_sent: false,
      placebet_request_sent: false,
      error: current?.error || "TARGET_ODDS_NOT_AVAILABLE",
      current,
      processing_ms: Date.now() - started
    };
  }

  const marketUrl = safe(current?.market_url);
  const price = numberOrNull(current?.current_odds);

  if (!marketUrl || price === null || price <= 1) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      event_id: eventId,
      valid_wager_sent: false,
      placebet_request_sent: false,
      error: "CURRENT_SELECTION_NOT_READY",
      current_odds: price,
      market_url: marketUrl || null,
      current,
      processing_ms: Date.now() - started
    };
  }

  const referenceId = crypto.randomUUID();

  const input = {
    referenceId,
    eventId,
    price: String(price),
    currency: BET_CURRENCY,
    marketUrl,
    // CRITICAL SAFETY GUARD: diagnostic stake must remain exactly zero.
    stake: GRAPHQL_VALIDATION_ZERO_STAKE
  };

  const minStake = numberOrNull(current?.min_stake);

  // Defense in depth: zero must be strictly below the live minimum stake.
  if (safe(input.stake) !== "0" || minStake === null || minStake <= 0) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      event_id: eventId,
      valid_wager_sent: false,
      placebet_request_sent: false,
      error: "SAFETY_GUARD_ZERO_STAKE_NOT_CONFIRMED_BELOW_MIN",
      diagnostic_stake: input.stake,
      min_stake: minStake,
      processing_ms: Date.now() - started
    };
  }

  const query = `
    mutation V765ZeroStakeValidation($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId
        eventId
        marketUrl
        currency
        price
        stake
        betStatus
        side
        betErrorCode
      }
    }
  `;

  let httpStatus = 0;
  let responseBody: any = null;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        query,
        variables: { input }
      }),
      redirect: "manual"
    });

    httpStatus = response.status;
    const raw = await response.text();

    try {
      responseBody = raw ? JSON.parse(raw) : null;
    } catch {
      responseBody = raw ? { raw: raw.slice(0, 3000) } : null;
    }

    const interpretation = classifyGraphqlValidationResponse(
      httpStatus,
      responseBody
    );

    return {
      success: true,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      safe_non_wagering_test: true,
      valid_wager_sent: false,
      placebet_request_sent: true,
      betting_enabled: BETTING_ENABLED,
      real_test_enabled: REAL_TEST_ENABLED,
      transport: "GRAPHQL",
      endpoint: GRAPHQL_ENDPOINT,
      event_id: eventId,
      current_odds: price,
      market_url: marketUrl,
      currency: BET_CURRENCY,
      diagnostic_stake: GRAPHQL_VALIDATION_ZERO_STAKE,
      min_stake: minStake,
      safety: {
        real_stake_used: false,
        bet_stake_constant_used: false,
        real_test_stake_used: false,
        diagnostic_stake_is_numeric: true,
        diagnostic_stake_is_zero: true,
        diagnostic_stake_below_min: minStake > 0
      },
      request: {
        operation: "V765ZeroStakeValidation",
        reference_id: referenceId,
        event_id: eventId,
        price: String(price),
        currency: BET_CURRENCY,
        market_url: marketUrl,
        stake: GRAPHQL_VALIDATION_ZERO_STAKE
      },
      response: {
        ok: response.ok,
        http_status: httpStatus,
        headers: diagnosticHeaders(response.headers),
        body: responseBody
      },
      interpretation,
      current,
      processing_ms: Date.now() - started
    };
  } catch (error) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ZERO_STAKE_VALIDATION",
      safe_non_wagering_test: true,
      valid_wager_sent: false,
      placebet_request_sent: false,
      event_id: eventId,
      error: error instanceof Error ? error.message : String(error),
      processing_ms: Date.now() - started
    };
  }
}


// ============================================================
// V7.6.6 — REAL-PAYLOAD DRY RUN
// Builds the exact real-value GraphQL placeBet payload with BET_STAKE=0.10,
// but NEVER transmits it to Cloudbet. No placeBet fetch() occurs here.
// ============================================================

async function runGraphqlRealPayloadDryRun(
  env: Env,
  eventIdInput: any
): Promise<any> {
  const started = Date.now();
  const eventId = normalizeEventId(eventIdInput);

  if (!eventId) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_REAL_PAYLOAD_DRY_RUN",
      wager_sent: false,
      placebet_request_sent: false,
      error: "EVENT_ID_REQUIRED",
      example: "/graphql-real-dry-run?event_id=36196339",
      processing_ms: Date.now() - started
    };
  }

  const current = await verifySameEventAndOdds(env, eventId);

  if (!current?.success) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_REAL_PAYLOAD_DRY_RUN",
      event_id: eventId,
      wager_sent: false,
      placebet_request_sent: false,
      error: current?.error || "TARGET_ODDS_NOT_AVAILABLE",
      current,
      processing_ms: Date.now() - started
    };
  }

  const marketUrl = safe(current?.market_url);
  const price = numberOrNull(current?.current_odds);
  const minStake = numberOrNull(current?.min_stake);
  const maxStake = numberOrNull(current?.max_stake);
  const stake = numberOrNull(BET_STAKE);

  if (!marketUrl || price === null || price <= 1) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_REAL_PAYLOAD_DRY_RUN",
      event_id: eventId,
      wager_sent: false,
      placebet_request_sent: false,
      error: "CURRENT_SELECTION_NOT_READY",
      current,
      processing_ms: Date.now() - started
    };
  }

  if (stake === null || stake <= 0) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_REAL_PAYLOAD_DRY_RUN",
      event_id: eventId,
      wager_sent: false,
      placebet_request_sent: false,
      error: "BET_STAKE_INVALID",
      configured_stake: BET_STAKE,
      processing_ms: Date.now() - started
    };
  }

  const stakeAboveOrEqualMin = minStake !== null ? stake >= minStake : null;
  const stakeBelowOrEqualMax = maxStake !== null ? stake <= maxStake : null;
  const selectionEnabled = safe(current?.selection_status) === "SELECTION_ENABLED";
  const payloadReady =
    selectionEnabled &&
    stakeAboveOrEqualMin === true &&
    stakeBelowOrEqualMax !== false;

  const referenceId = crypto.randomUUID();

  const query = `
    mutation V766RealPayloadDryRun($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId
        eventId
        marketUrl
        currency
        price
        stake
        betStatus
        side
        betErrorCode
      }
    }
  `;

  const input = {
    referenceId,
    eventId,
    price: String(price),
    currency: BET_CURRENCY,
    marketUrl,
    stake: BET_STAKE
  };

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "GRAPHQL_REAL_PAYLOAD_DRY_RUN",
    safe_read_only: true,
    wager_sent: false,
    placebet_request_sent: false,
    betting_enabled: BETTING_ENABLED,
    real_test_enabled: REAL_TEST_ENABLED,
    transport: "GRAPHQL",
    endpoint: GRAPHQL_ENDPOINT,
    event_id: eventId,
    current_odds: price,
    market_url: marketUrl,
    currency: BET_CURRENCY,
    configured_stake: BET_STAKE,
    min_stake: minStake,
    max_stake: maxStake,
    selection_status: current?.selection_status ?? null,
    validation: {
      selection_enabled: selectionEnabled,
      stake_numeric: true,
      stake_positive: stake > 0,
      stake_at_or_above_min: stakeAboveOrEqualMin,
      stake_at_or_below_max: stakeBelowOrEqualMax,
      payload_ready_for_real_submission: payloadReady
    },
    safety: {
      fetch_to_placebet_executed: false,
      valid_wager_transmitted: false,
      this_endpoint_can_place_bet: false
    },
    request_preview: {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": "<CLOUDBET_API_KEY>"
      },
      body: {
        query,
        variables: { input }
      }
    },
    current,
    processing_ms: Date.now() - started
  };
}

// ============================================================
// V7.3.1 — DIRECT SINGLE EVENT PREFLIGHT
// ============================================================

interface DirectPreflightInput {
  event_id?: any;
  match_id?: any;
  match?: any;
  match_name?: any;
  home?: any;
  away?: any;
  competition?: any;
  league?: any;
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

  const matchText =
    safe(
      input?.match ??
      input?.match_name
    );

  const parsed =
    splitMatch(
      matchText
    );

  const home =
    safe(
      input?.home
    ) ||
    parsed.home;

  const away =
    safe(
      input?.away
    ) ||
    parsed.away;

  return {
    status:
      "ENTRY",

    match_id:
      input?.match_id ??
      null,

    match:
      matchText ||
      (
        home && away
          ? `${home} - ${away}`
          : ""
      ),

    match_name:
      matchText ||
      (
        home && away
          ? `${home} - ${away}`
          : ""
      ),

    home,
    away,

    competition:
      safe(
        input?.competition ??
        input?.league
      ) || null,

    league:
      safe(
        input?.league ??
        input?.competition
      ) || null,

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
        matchText || null,

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

// ============================================================
// V7.6.21 — DIRECT PREFLIGHT TRACKER ENRICHMENT
// Tracker creates the Hunter DB row BEFORE /preflight.
// Reuse that row so AI always receives fixture names.
// ============================================================

async function enrichDirectPreflightInput(
  env: Env,
  input: DirectPreflightInput
): Promise<DirectPreflightInput> {
  const requestedMatchId =
    safe(
      input?.match_id
    );

  const requestedEventId =
    normalizeEventId(
      input?.event_id
    );

  try {
    const tracker =
      await fetchServiceJSON(
        env.TRACKER,
        "/entries",
        SERVICE_TIMEOUT_MS
      );

    if (!tracker.ok) {
      return input;
    }

    const rows =
      trackerEntries(
        tracker.data
      );

    const row =
      rows.find((item: any) => {
        const rowMatchId =
          safe(
            item?.match_id ??
            item?.id
          );

        const rowEventId =
          normalizeEventId(
            item?.cloudbet?.event_id ??
            item?.cloudbet_event_id
          );

        if (
          requestedMatchId &&
          rowMatchId &&
          requestedMatchId === rowMatchId
        ) {
          return true;
        }

        if (
          requestedEventId &&
          rowEventId &&
          requestedEventId === rowEventId
        ) {
          return true;
        }

        return false;
      }) ?? null;

    if (!row) {
      return input;
    }

    const rowMatch =
      safe(
        row?.match ??
        row?.match_name
      );

    const parsed =
      splitMatch(
        rowMatch
      );

    return {
      ...input,

      event_id:
        input?.event_id ??
        row?.cloudbet?.event_id ??
        row?.cloudbet_event_id ??
        null,

      match_id:
        input?.match_id ??
        row?.match_id ??
        row?.id ??
        null,

      match:
        safe(input?.match) ||
        rowMatch ||
        null,

      match_name:
        safe(input?.match_name) ||
        rowMatch ||
        null,

      home:
        safe(input?.home) ||
        safe(row?.home) ||
        parsed.home ||
        null,

      away:
        safe(input?.away) ||
        safe(row?.away) ||
        parsed.away ||
        null,

      competition:
        safe(input?.competition) ||
        safe(row?.competition) ||
        safe(row?.league) ||
        null,

      league:
        safe(input?.league) ||
        safe(row?.league) ||
        safe(row?.competition) ||
        null,

      entry_minute:
        input?.entry_minute ??
        row?.entry_minute ??
        row?.current_minute ??
        null,

      hunter_score:
        input?.hunter_score ??
        row?.hunter_score ??
        null,

      entry_odds:
        input?.entry_odds ??
        row?.cloudbet?.entry_odds ??
        row?.entry_odds ??
        null,

      max_stake:
        input?.max_stake ??
        row?.cloudbet?.max_stake ??
        row?.cloudbet_max_stake ??
        null,

      matcher_score:
        input?.matcher_score ??
        row?.cloudbet?.matcher_score ??
        row?.matcher_score ??
        null
    };
  } catch {
    return input;
  }
}


// ============================================================
// V7.6.9 — REAL BET ARCHIVE + TELEGRAM
// Separate from legacy bet_archive (which also contains DRY_RUN rows).
// Every real PlaceBet response is persisted here by reference_id.
// Telegram failure NEVER changes the wager result.
// ============================================================

async function ensureRealBetArchiveTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_bet_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT UNIQUE,
      event_id TEXT NOT NULL,
      match TEXT,
      home TEXT,
      away TEXT,
      market_url TEXT NOT NULL,
      market TEXT NOT NULL,
      selection TEXT NOT NULL,
      currency TEXT NOT NULL,
      stake REAL NOT NULL,
      odds REAL,
      bet_status TEXT,
      bet_error_code TEXT,
      http_status INTEGER,
      transport TEXT,
      source TEXT,
      response_json TEXT,
      telegram_status TEXT,
      telegram_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();

  await env.DB.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_real_bet_archive_reference
    ON real_bet_archive(reference_id)
  `).run();

  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS idx_real_bet_archive_event
    ON real_bet_archive(event_id, market_url)
  `).run();
}

function cloudbetEventTeams(event: any): { match: string; home: string; away: string } {
  const home = safe(event?.home?.name || event?.home?.team?.name || event?.home || "");
  const away = safe(event?.away?.name || event?.away?.team?.name || event?.away || "");
  const match = home && away ? `${home} - ${away}` : safe(event?.name || event?.match || "");
  return { match, home, away };
}

function telegramEscape(value: any): string {
  // Plain-text Telegram message; normalize only control whitespace.
  return safe(value).replace(/[\r\n]+/g, " ");
}

async function sendTelegramMessage(env: Env, text: string): Promise<any> {
  const token = safe(env.TELEGRAM_BOT_TOKEN);
  const chatId = safe(env.TELEGRAM_CHAT_ID);

  if (!token || !chatId) {
    return {
      sent: false,
      skipped: true,
      reason: !token ? "TELEGRAM_BOT_TOKEN_MISSING" : "TELEGRAM_CHAT_ID_MISSING"
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    const raw = await response.text();
    let body: any = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = raw || null; }

    return {
      sent: response.ok && body?.ok !== false,
      skipped: false,
      http_status: response.status,
      error: response.ok && body?.ok !== false ? null : safe(body?.description || raw || `HTTP_${response.status}`),
      body
    };
  } catch (error) {
    return {
      sent: false,
      skipped: false,
      http_status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function realBetTelegramText(ctx: any): string {
  const status = safe(ctx.bet_status).toUpperCase();
  const title = status === "ACCEPTED"
    ? "✅ BET ACCEPTED"
    : status === "REJECTED"
      ? "❌ BET REJECTED"
      : "✅ BET PLACED";

  const lines = [
    title,
    "",
    `⚽ ${telegramEscape(ctx.match || `${ctx.home || ""} - ${ctx.away || ""}`) || `Event ${ctx.event_id}`}`,
    `🎯 1H Over 0.5`,
    `💰 Stake: ${Number(ctx.stake).toFixed(2)} ${telegramEscape(ctx.currency)}`,
    `📈 Odds: ${ctx.odds ?? "—"}`,
    `🧾 Status: ${status || "UNKNOWN"}`,
    `🔑 Reference ID: ${telegramEscape(ctx.reference_id)}`
  ];

  if (ctx.bet_error_code) lines.push(`⚠️ Error: ${telegramEscape(ctx.bet_error_code)}`);
  return lines.join("\n");
}


async function runTelegramTest(env: Env): Promise<any> {
  const message = [
    "🧪 TELEGRAM TEST",
    "",
    "✅ cloudbet-bet-worker can send Telegram notifications.",
    `🧩 Version: ${VERSION}`,
    `💰 Real bet stake: ${BET_STAKE} ${BET_CURRENCY}`,
    "🔒 No Cloudbet request was sent.",
    `🕐 ${nowISO()}`
  ].join("\n");

  const telegram = await sendTelegramMessage(env, message);

  return {
    success: telegram.sent === true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "TELEGRAM_TEST",
    safe_read_only: true,
    cloudbet_request_sent: false,
    wager_sent: false,
    telegram_bot_token_present: !!safe(env.TELEGRAM_BOT_TOKEN),
    telegram_chat_id_present: !!safe(env.TELEGRAM_CHAT_ID),
    telegram
  };
}

async function archiveAndNotifyRealBet(env: Env, ctx: any): Promise<any> {
  await ensureRealBetArchiveTable(env);

  const now = nowISO();
  const referenceId = safe(ctx.reference_id);
  if (!referenceId) {
    return { archived: false, telegram: { sent: false, skipped: true, reason: "REFERENCE_ID_MISSING" } };
  }

  await env.DB.prepare(`
    INSERT INTO real_bet_archive (
      reference_id, event_id, match, home, away,
      market_url, market, selection, currency, stake, odds,
      bet_status, bet_error_code, http_status, transport, source,
      response_json, telegram_status, telegram_error, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(reference_id) DO UPDATE SET
      bet_status = excluded.bet_status,
      bet_error_code = excluded.bet_error_code,
      http_status = excluded.http_status,
      response_json = excluded.response_json,
      updated_at = excluded.updated_at
  `).bind(
    referenceId,
    safe(ctx.event_id),
    safe(ctx.match) || null,
    safe(ctx.home) || null,
    safe(ctx.away) || null,
    safe(ctx.market_url),
    BET_MARKET,
    BET_SELECTION,
    safe(ctx.currency || BET_CURRENCY),
    numberOrNull(ctx.stake) ?? 0,
    numberOrNull(ctx.odds),
    safe(ctx.bet_status) || null,
    safe(ctx.bet_error_code) || null,
    numberOrNull(ctx.http_status),
    safe(ctx.transport || "GRAPHQL"),
    safe(ctx.source || "REAL_PLACEBET"),
    JSON.stringify(ctx.response ?? null).slice(0, 20000),
    now,
    now
  ).run();

  const telegram = await sendTelegramMessage(env, realBetTelegramText(ctx));

  await env.DB.prepare(`
    UPDATE real_bet_archive
    SET telegram_status = ?, telegram_error = ?, updated_at = ?
    WHERE reference_id = ?
  `).bind(
    telegram.sent ? "SENT" : (telegram.skipped ? "SKIPPED" : "FAILED"),
    safe(telegram.error || telegram.reason) || null,
    nowISO(),
    referenceId
  ).run();

  return { archived: true, telegram };
}

async function listRealBets(env: Env, limitInput: any): Promise<any> {
  await ensureRealBetArchiveTable(env);
  const parsed = Number(limitInput);
  const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, Math.floor(parsed))) : 25;
  const result = await env.DB.prepare(`
    SELECT reference_id, event_id, match, home, away, market_url, market, selection,
           currency, stake, odds, bet_status, bet_error_code, http_status, transport,
           source, telegram_status, telegram_error, created_at, updated_at
    FROM real_bet_archive
    ORDER BY id DESC
    LIMIT ?
  `).bind(limit).all<any>();

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "REAL_BET_ARCHIVE",
    count: (result.results || []).length,
    bets: result.results || []
  };
}

// ============================================================
// HARD GATE #5 — REAL BET DUPLICATE PROTECTION
// One real bet max per Cloudbet event + exact target market URL.
// This table is separate from the archive because archive rows can exist in DRY_RUN.
// ============================================================

async function ensureRealBetGuardTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_bet_guard (
      guard_key TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      market_url TEXT NOT NULL,
      stake TEXT NOT NULL,
      status TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

function realBetGuardKey(eventId: string, marketUrl: string): string {
  return `${eventId}|${marketUrl}|${BET_CURRENCY}`;
}

async function realBetAlreadyClaimed(
  env: Env,
  eventId: string,
  marketUrl: string
): Promise<boolean> {
  await ensureRealBetGuardTable(env);
  const row = await env.DB.prepare(`
    SELECT guard_key FROM real_bet_guard WHERE guard_key = ? LIMIT 1
  `).bind(realBetGuardKey(eventId, marketUrl)).first<any>();
  return !!row;
}


// ============================================================
// V7.6.18 — CLOUDBET BET CONFIRMATION
// Cloudbet GraphQL supports querying a submitted bet by referenceId.
// IMPORTANT: real_bet_archive is written only after betStatus=ACCEPTED.
// ============================================================

function isCloudbetAcceptedBetStatus(value: any): boolean {
  return safe(value).toUpperCase() === "ACCEPTED";
}

function isCloudbetRejectedBetStatus(value: any): boolean {
  const status = safe(value).toUpperCase();
  return status === "REJECTED" ||
         status === "CANCELLED" ||
         status === "CANCELED" ||
         status === "FAILED";
}

async function queryCloudbetBetByReference(
  env: Env,
  referenceIdInput: any
): Promise<any> {
  const referenceId = safe(referenceIdInput);
  const apiKey = safe(env.CLOUDBET_API_KEY);

  if (!referenceId) {
    return {
      success: false,
      found: false,
      error: "REFERENCE_ID_MISSING"
    };
  }

  if (!apiKey) {
    return {
      success: false,
      found: false,
      reference_id: referenceId,
      error: "CLOUDBET_API_KEY_MISSING"
    };
  }

  const query = `
    query Bet($referenceId: String!) {
      bet(referenceId: $referenceId) {
        referenceId
        sportsKey
        categoryKey
        eventId
        eventName
        marketUrl
        currency
        price
        stake
        side
        returnAmount
        betStatus
        betErrorCode
      }
    }
  `;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        query,
        variables: { referenceId }
      }),
      redirect: "manual"
    });

    const raw = await response.text();

    let body: any = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw ? { raw: raw.slice(0, 5000) } : null;
    }

    const bet = body?.data?.bet ?? null;

    return {
      success: response.ok && !!bet,
      found: !!bet,
      reference_id: referenceId,
      http_status: response.status,
      bet_status: safe(bet?.betStatus) || null,
      bet_error_code: safe(bet?.betErrorCode) || null,
      accepted: isCloudbetAcceptedBetStatus(bet?.betStatus),
      rejected: isCloudbetRejectedBetStatus(bet?.betStatus),
      bet,
      response: body
    };
  } catch (error) {
    return {
      success: false,
      found: false,
      reference_id: referenceId,
      http_status: 0,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function confirmAndArchiveCloudbetBet(
  env: Env,
  referenceIdInput: any,
  source = "AUTO_E2E_CONFIRMED"
): Promise<any> {
  const lookup = await queryCloudbetBetByReference(env, referenceIdInput);
  const referenceId = safe(referenceIdInput);

  if (!lookup?.found || !lookup?.bet) {
    return {
      ...lookup,
      archived: false,
      archive_reason: "CLOUDBET_BET_NOT_CONFIRMED"
    };
  }

  const bet = lookup.bet;
  const status = safe(bet?.betStatus).toUpperCase();

  // Update guard state, but do NOT create a real_bet_archive row unless ACCEPTED.
  await ensureRealBetGuardTable(env);

  const eventId = normalizeEventId(bet?.eventId);
  const marketUrl = safe(bet?.marketUrl);

  if (eventId && marketUrl) {
    await env.DB.prepare(`
      UPDATE real_bet_guard
      SET status = ?, reference_id = ?, updated_at = ?
      WHERE guard_key = ?
    `).bind(
      status || "UNKNOWN",
      safe(bet?.referenceId || referenceId),
      nowISO(),
      realBetGuardKey(eventId, marketUrl)
    ).run();
  }

  await ensureAutoE2ETestTable(env);
  await env.DB.prepare(`
    UPDATE auto_e2e_test_guard
    SET status = ?, reference_id = ?, http_status = ?, response_json = ?, updated_at = ?
    WHERE test_key = ?
  `).bind(
    status || "UNKNOWN",
    safe(bet?.referenceId || referenceId),
    numberOrNull(lookup?.http_status),
    JSON.stringify(lookup?.response ?? null).slice(0, 12000),
    nowISO(),
    AUTO_E2E_TEST_KEY
  ).run();

  if (!isCloudbetAcceptedBetStatus(status)) {
    return {
      ...lookup,
      archived: false,
      archive_reason: isCloudbetRejectedBetStatus(status)
        ? "CLOUDBET_REJECTED"
        : "WAITING_FOR_CLOUDBET_ACCEPTED"
    };
  }

  const archiveNotification = await archiveAndNotifyRealBet(env, {
    reference_id: safe(bet?.referenceId || referenceId),
    event_id: safe(bet?.eventId),
    match: safe(bet?.eventName) || null,
    home: null,
    away: null,
    market_url: safe(bet?.marketUrl),
    currency: safe(bet?.currency || BET_CURRENCY),
    stake: bet?.stake,
    odds: bet?.price,
    bet_status: status,
    bet_error_code: safe(bet?.betErrorCode) || null,
    http_status: numberOrNull(lookup?.http_status),
    transport: "GRAPHQL",
    source,
    response: lookup?.response
  });

  await env.DB.prepare(`
    UPDATE auto_e2e_test_guard
    SET status = 'COMPLETED_ACCEPTED', updated_at = ?
    WHERE test_key = ?
  `).bind(
    nowISO(),
    AUTO_E2E_TEST_KEY
  ).run();

  return {
    ...lookup,
    archived: archiveNotification?.archived === true,
    archive_notification: archiveNotification
  };
}

// ============================================================
// V7.6.11 — AUTOMATIC END-TO-END ONE-SHOT TEST
// Triggered only from the normal /run Hunter flow.
// It re-checks SAME event + 0:0 + 1H + configured minute window + exact 1H O0.5,
// refreshes account/odds immediately before POST, then atomically consumes
// one global D1 test key. Normal betting remains disabled.
// ============================================================

async function ensureAutoE2ETestTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS auto_e2e_test_guard (
      test_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      event_id TEXT,
      reference_id TEXT,
      stake TEXT,
      odds TEXT,
      http_status INTEGER,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function autoE2ETestStatus(env: Env): Promise<any> {
  await ensureAutoE2ETestTable(env);
  const row = await env.DB.prepare(`
    SELECT test_key, status, event_id, reference_id, stake, odds,
           http_status, response_json, created_at, updated_at
    FROM auto_e2e_test_guard
    WHERE test_key = ?
    LIMIT 1
  `).bind(AUTO_E2E_TEST_KEY).first<any>();
  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "AUTO_E2E_TEST_STATUS",
    enabled: AUTO_E2E_TEST_ENABLED,
    normal_betting_enabled: BETTING_ENABLED,
    max_real_bets: 1,
    test_generation: "SECOND_ONE_SHOT",
    archive_policy: "ONLY_AFTER_CLOUDBET_ACCEPTED",
    stake: AUTO_E2E_TEST_STAKE,
    currency: BET_CURRENCY,
    consumed: !!row,
    test: row ?? null
  };
}

async function archiveRealBetAttemptExists(env: Env, eventId: string, marketUrl: string): Promise<boolean> {
  await ensureRealBetArchiveTable(env);
  const row = await env.DB.prepare(`
    SELECT reference_id FROM real_bet_archive
    WHERE event_id = ? AND market_url = ?
    LIMIT 1
  `).bind(eventId, marketUrl).first<any>();
  return !!row;
}

async function runAutoE2EOneShot(env: Env, signal: any, eventIdInput: any): Promise<any> {
  const eventId = normalizeEventId(eventIdInput);

  if (!AUTO_E2E_TEST_ENABLED) return { attempted: false, consumed: false, reason: "AUTO_E2E_TEST_DISABLED" };
  if (BETTING_ENABLED) return { attempted: false, consumed: false, reason: "SAFETY_BLOCK_NORMAL_BETTING_MUST_REMAIN_DISABLED" };
  if (safe(AUTO_E2E_TEST_STAKE) !== "0.10" || safe(BET_STAKE) !== "0.10") {
    return { attempted: false, consumed: false, reason: "SAFETY_BLOCK_STAKE_NOT_EXACT_0_10" };
  }
  if (!eventId) return { attempted: false, consumed: false, reason: "EVENT_ID_MISSING" };

  const current =
    await verifySameEventAndOdds(
      env,
      eventId,
      numberOrNull(
        signal?.entry_minute ??
        signal?.minute
      )
    );
  if (!current?.success) {
    return { attempted: false, consumed: false, reason: current?.error || "FINAL_EVENT_REFRESH_FAILED", event_id: eventId, current };
  }

  const marketUrl = safe(current?.market_url);
  const price = numberOrNull(current?.current_odds);
  const minStake = numberOrNull(current?.min_stake);
  const maxStake = numberOrNull(current?.max_stake);
  const stake = Number(AUTO_E2E_TEST_STAKE);

  if (marketUrl !== TARGET_MARKET_URL || safe(current?.selection_status) !== "SELECTION_ENABLED" ||
      price === null || price <= 1 || minStake === null || stake < minStake ||
      (maxStake !== null && stake > maxStake)) {
    return {
      attempted: false, consumed: false, reason: "FINAL_MARKET_OR_STAKE_VALIDATION_FAILED",
      event_id: eventId, current_odds: price, min_stake: minStake, max_stake: maxStake,
      market_url: marketUrl, selection_status: current?.selection_status ?? null
    };
  }

  const account = await fetchAccountSnapshot(env);
  const preflight = buildAccountPreflight(account, current);
  if (preflight?.ready_to_send !== true) {
    return { attempted: false, consumed: false, reason: preflight?.block_reason || "ACCOUNT_PREFLIGHT_FAILED", event_id: eventId, account, preflight };
  }

  const apiKey = safe(env.CLOUDBET_API_KEY);
  if (!apiKey) return { attempted: false, consumed: false, reason: "CLOUDBET_API_KEY_MISSING" };

  if (await realBetAlreadyClaimed(env, eventId, marketUrl) || await archiveRealBetAttemptExists(env, eventId, marketUrl)) {
    return { attempted: false, consumed: false, reason: "DUPLICATE_REAL_BET_BLOCKED", event_id: eventId, market_url: marketUrl };
  }

  await ensureAutoE2ETestTable(env);
  await ensureRealBetGuardTable(env);
  const now = nowISO();
  const referenceId = crypto.randomUUID();

  const globalClaim = await env.DB.prepare(`
    INSERT OR IGNORE INTO auto_e2e_test_guard
      (test_key, status, event_id, reference_id, stake, odds, created_at, updated_at)
    VALUES (?, 'CLAIMED', ?, ?, ?, ?, ?, ?)
  `).bind(AUTO_E2E_TEST_KEY, eventId, referenceId, AUTO_E2E_TEST_STAKE, String(price), now, now).run();

  if (Number((globalClaim as any)?.meta?.changes ?? 0) !== 1) {
    const status = await autoE2ETestStatus(env);
    return { attempted: false, consumed: true, reason: "AUTO_E2E_TEST_ALREADY_CONSUMED", existing: status.test };
  }

  const guardClaim = await env.DB.prepare(`
    INSERT OR IGNORE INTO real_bet_guard
      (guard_key, event_id, market_url, stake, status, reference_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'CLAIMED', ?, ?, ?)
  `).bind(realBetGuardKey(eventId, marketUrl), eventId, marketUrl, AUTO_E2E_TEST_STAKE, referenceId, now, now).run();

  if (Number((guardClaim as any)?.meta?.changes ?? 0) !== 1) {
    await env.DB.prepare(`UPDATE auto_e2e_test_guard SET status = 'BLOCKED_DUPLICATE', updated_at = ? WHERE test_key = ?`)
      .bind(nowISO(), AUTO_E2E_TEST_KEY).run();
    return { attempted: false, consumed: true, reason: "DUPLICATE_REAL_BET_BLOCKED_ATOMIC", event_id: eventId, market_url: marketUrl };
  }

  const input = { referenceId, eventId, price: String(price), currency: BET_CURRENCY, marketUrl, stake: AUTO_E2E_TEST_STAKE };
  const query = `
    mutation PlaceBet($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId eventId marketUrl currency price stake betStatus side betErrorCode
      }
    }
  `;

  let httpStatus = 0;
  let responseBody: any = null;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ query, variables: { input } }),
      redirect: "manual"
    });

    httpStatus = response.status;
    const raw = await response.text();
    try { responseBody = raw ? JSON.parse(raw) : null; }
    catch { responseBody = raw ? { raw: raw.slice(0, 3000) } : null; }

    const placeBet = responseBody?.data?.placeBet ?? null;
    const betStatus = safe(placeBet?.betStatus) || (response.ok ? "UNKNOWN" : "HTTP_ERROR");
    const betErrorCode = safe(placeBet?.betErrorCode) || null;
    const returnedReferenceId = safe(placeBet?.referenceId || referenceId);

    // V7.6.18:
    // The POST response is NOT enough to call the bet "placed" when Cloudbet says
    // PENDING_ACCEPTANCE. We persist only the technical safety state here.
    // real_bet_archive remains untouched until a direct Cloudbet bet(referenceId)
    // query confirms betStatus=ACCEPTED.
    await env.DB.prepare(`
      UPDATE auto_e2e_test_guard
      SET status = ?, reference_id = ?, http_status = ?, response_json = ?, updated_at = ?
      WHERE test_key = ?
    `).bind(
      betStatus,
      returnedReferenceId,
      httpStatus,
      JSON.stringify(responseBody ?? null).slice(0, 12000),
      nowISO(),
      AUTO_E2E_TEST_KEY
    ).run();

    await env.DB.prepare(`
      UPDATE real_bet_guard
      SET status = ?, reference_id = ?, updated_at = ?
      WHERE guard_key = ?
    `).bind(
      betStatus,
      returnedReferenceId,
      nowISO(),
      realBetGuardKey(eventId, marketUrl)
    ).run();

    const teams = cloudbetEventTeams(current?.event);

    // If Cloudbet already returned ACCEPTED on PlaceBet, confirm once more from
    // the dedicated bet(referenceId) query before archiving.
    // If it returned PENDING_ACCEPTANCE, no archive row is created.
    let cloudbetConfirmation: any = {
      found: false,
      accepted: false,
      bet_status: betStatus,
      archived: false,
      archive_reason: "WAITING_FOR_CLOUDBET_ACCEPTED"
    };

    if (returnedReferenceId) {
      cloudbetConfirmation = await confirmAndArchiveCloudbetBet(
        env,
        returnedReferenceId,
        "AUTO_E2E_CONFIRMED_ACCEPTED"
      );
    }

    return {
      attempted: true,
      consumed: true,
      max_real_bets: 1,
      event_id: eventId,
      match: teams.match || signalMatch(signal),
      request: {
        endpoint: GRAPHQL_ENDPOINT,
        operation: "PlaceBet",
        reference_id: referenceId,
        event_id: eventId,
        market_url: marketUrl,
        price: String(price),
        stake: AUTO_E2E_TEST_STAKE,
        currency: BET_CURRENCY,
        balance_before_request: account.balance
      },
      response: {
        ok: response.ok,
        status: httpStatus,
        body: responseBody
      },
      cloudbet_confirmation: cloudbetConfirmation,
      real_bet_archived: cloudbetConfirmation?.archived === true
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(`UPDATE auto_e2e_test_guard SET status = 'REQUEST_ERROR', response_json = ?, updated_at = ? WHERE test_key = ?`)
      .bind(JSON.stringify({ error: message }), nowISO(), AUTO_E2E_TEST_KEY).run();
    await env.DB.prepare(`UPDATE real_bet_guard SET status = 'REQUEST_ERROR', updated_at = ? WHERE guard_key = ?`)
      .bind(nowISO(), realBetGuardKey(eventId, marketUrl)).run();
    return { attempted: true, consumed: true, max_real_bets: 1, event_id: eventId, error: message };
  }
}

async function runExplicitOneShot010(
  env: Env,
  eventIdInput: any,
  confirmInput: any
): Promise<any> {
  const eventId = normalizeEventId(eventIdInput);
  const confirm = safe(confirmInput);

  if (!eventId) {
    return { success: false, action: "REAL_ONE_SHOT_0_10", attempted: false, error: "EVENT_ID_REQUIRED" };
  }

  if (confirm !== REAL_TEST_CONFIRM) {
    return { success: false, action: "REAL_ONE_SHOT_0_10", attempted: false, error: "EXPLICIT_CONFIRMATION_REQUIRED" };
  }

  const current = await verifySameEventAndOdds(env, eventId);
  if (!current?.success) {
    return { success: false, action: "REAL_ONE_SHOT_0_10", attempted: false, error: current?.error || "TARGET_ODDS_NOT_AVAILABLE", current };
  }

  const price = numberOrNull(current?.current_odds);
  const minStake = numberOrNull(current?.min_stake);
  const maxStake = numberOrNull(current?.max_stake);
  const marketUrl = safe(current?.market_url);
  const enabled = safe(current?.selection_status) === "SELECTION_ENABLED";

  if (!enabled || price === null || price <= 1 || !marketUrl ||
      minStake === null || REAL_TEST_STAKE < minStake ||
      (maxStake !== null && REAL_TEST_STAKE > maxStake)) {
    return {
      success: false, action: "REAL_ONE_SHOT_0_10", attempted: false,
      error: "LIVE_SELECTION_OR_STAKE_VALIDATION_FAILED",
      event_id: eventId, current_odds: price, min_stake: minStake, max_stake: maxStake,
      selection_status: current?.selection_status ?? null, market_url: marketUrl || null
    };
  }

  if (await realBetAlreadyClaimed(env, eventId, marketUrl)) {
    return {
      success: false,
      action: "REAL_ONE_SHOT_0_10",
      attempted: false,
      error: "DUPLICATE_REAL_BET_BLOCKED",
      event_id: eventId,
      market_url: marketUrl
    };
  }

  const account = await fetchAccountSnapshot(env);
  const handoff = {
    graphql_input: { eventId, marketUrl, price: String(price) }
  };

  const result = await oneShotRealBetTest(env, eventId, handoff, account, current);
  return {
    success: result?.attempted === true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "REAL_ONE_SHOT_0_10",
    normal_betting_enabled: BETTING_ENABLED,
    exact_test_stake: REAL_TEST_STAKE,
    currency: BET_CURRENCY,
    event_id: eventId,
    result
  };
}

async function ensureRealTestTable(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS real_bet_test_guard (
      test_key TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      event_id TEXT,
      stake REAL,
      balance REAL,
      http_status INTEGER,
      response_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function oneShotRealBetTest(
  env: Env,
  eventId: string,
  handoff: any,
  account: AccountSnapshot,
  current: any
): Promise<any> {
  if (!REAL_TEST_ENABLED) {
    return { attempted: false, reason: "REAL_TEST_DISABLED" };
  }

  const balance = numberOrNull(account?.balance);
  if (balance === null) {
    return { attempted: false, reason: "BALANCE_UNAVAILABLE" };
  }

  if (balance < REAL_TEST_STAKE) {
    return {
      attempted: false,
      reason: "INSUFFICIENT_BALANCE_FOR_0_10_TEST",
      balance,
      test_stake: REAL_TEST_STAKE
    };
  }

  const apiKey = safe(env.CLOUDBET_API_KEY);
  if (!apiKey) {
    return { attempted: false, reason: "CLOUDBET_API_KEY_MISSING" };
  }

  const selection =
    handoff?.graphql_input ??
    handoff?.body?.variables?.input ??
    handoff?.body?.selection ??
    null;

  if (!selection?.eventId || !selection?.marketUrl || !selection?.price) {
    return { attempted: false, reason: "HANDOFF_INCOMPLETE" };
  }

  await ensureRealTestTable(env);
  const now = nowISO();

  const claim = await env.DB.prepare(`
    INSERT OR IGNORE INTO real_bet_test_guard
      (test_key, status, event_id, stake, balance, created_at, updated_at)
    VALUES (?, 'CLAIMED', ?, ?, ?, ?, ?)
  `).bind(
    REAL_TEST_KEY,
    eventId,
    REAL_TEST_STAKE,
    balance,
    now,
    now
  ).run();

  const changes = Number((claim as any)?.meta?.changes ?? 0);
  if (changes !== 1) {
    const existing = await env.DB.prepare(`
      SELECT test_key, status, event_id, stake, balance, http_status,
             response_json, created_at, updated_at
      FROM real_bet_test_guard
      WHERE test_key = ?
      LIMIT 1
    `).bind(REAL_TEST_KEY).first<any>();

    return {
      attempted: false,
      reason: "REAL_TEST_ALREADY_CONSUMED",
      existing: existing ?? null
    };
  }

  const referenceId = crypto.randomUUID();

  const input = {
    referenceId,
    eventId: safe(eventId),
    price: String(selection.price),
    currency: BET_CURRENCY,
    marketUrl: safe(selection.marketUrl),
    stake: String(REAL_TEST_STAKE)
  };

  const query = `
    mutation PlaceBet($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId
        eventId
        marketUrl
        currency
        price
        stake
        betStatus
        side
        betErrorCode
      }
    }
  `;

  let httpStatus = 0;
  let responseBody: any = null;

  try {
    const response = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-API-KEY": apiKey
      },
      body: JSON.stringify({
        query,
        variables: { input }
      }),
      redirect: "manual"
    });

    httpStatus = response.status;
    const raw = await response.text();

    try {
      responseBody = raw ? JSON.parse(raw) : null;
    } catch {
      responseBody = raw ? { raw: raw.slice(0, 3000) } : null;
    }

    const stored = JSON.stringify({
      transport: "GRAPHQL",
      ok: response.ok,
      status: httpStatus,
      headers: diagnosticHeaders(response.headers),
      body: responseBody
    }).slice(0, 12000);

    await env.DB.prepare(`
      UPDATE real_bet_test_guard
      SET status = 'COMPLETED', http_status = ?, response_json = ?, updated_at = ?
      WHERE test_key = ?
    `).bind(httpStatus, stored, nowISO(), REAL_TEST_KEY).run();

    const placeBet = responseBody?.data?.placeBet ?? null;
    const teams = cloudbetEventTeams(current?.event);
    const archive_notification = placeBet?.referenceId
      ? await archiveAndNotifyRealBet(env, {
          reference_id: placeBet.referenceId,
          event_id: placeBet.eventId || eventId,
          match: teams.match,
          home: teams.home,
          away: teams.away,
          market_url: placeBet.marketUrl || input.marketUrl,
          currency: placeBet.currency || BET_CURRENCY,
          stake: placeBet.stake || REAL_TEST_STAKE,
          odds: placeBet.price || input.price,
          bet_status: placeBet.betStatus,
          bet_error_code: placeBet.betErrorCode,
          http_status: httpStatus,
          transport: "GRAPHQL",
          source: "REAL_ONE_SHOT_0_10",
          response: responseBody
        })
      : { archived: false, telegram: { sent: false, skipped: true, reason: "PLACEBET_REFERENCE_ID_MISSING" } };

    return {
      attempted: true,
      one_shot_consumed: true,
      archive_notification,
      transport: "GRAPHQL",
      request: {
        endpoint: GRAPHQL_ENDPOINT,
        operation: "PlaceBet",
        reference_id: referenceId,
        event_id: eventId,
        currency: BET_CURRENCY,
        stake: REAL_TEST_STAKE,
        market_url: input.marketUrl,
        price: input.price,
        balance_before_request: balance
      },
      response: {
        ok: response.ok,
        status: httpStatus,
        headers: diagnosticHeaders(response.headers),
        body: responseBody
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await env.DB.prepare(`
      UPDATE real_bet_test_guard
      SET status = 'REQUEST_ERROR', response_json = ?, updated_at = ?
      WHERE test_key = ?
    `).bind(
      JSON.stringify({
        transport: "GRAPHQL",
        error: message
      }).slice(0, 12000),
      nowISO(),
      REAL_TEST_KEY
    ).run();

    return {
      attempted: true,
      one_shot_consumed: true,
      transport: "GRAPHQL",
      response: {
        ok: false,
        status: httpStatus,
        error: message
      }
    };
  }
}

const TRADING_DIAGNOSTIC_ENDPOINT =
  "https://sports-api.cloudbet.com/pub/v4/bets?limit=1&offset=0";

const GRAPHQL_ENDPOINT =
  "https://sports-api-graphql.cloudbet.com/graphql";

function diagnosticHeaders(
  headers: Headers
): Record<string, string | null> {
  return {
    server: headers.get("server"),
    cf_ray: headers.get("cf-ray"),
    content_type: headers.get("content-type"),
    content_length: headers.get("content-length"),
    cache_control: headers.get("cache-control"),
    date: headers.get("date"),
    location: headers.get("location"),
    via: headers.get("via")
  };
}

async function tradingDiagnostic(
  env: Env
): Promise<any> {
  const started = Date.now();
  const apiKey = safe(env.CLOUDBET_API_KEY);

  if (!apiKey) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "TRADING_GET_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: false,
      error: "CLOUDBET_API_KEY_MISSING",
      processing_ms: Date.now() - started
    };
  }

  try {
    const response = await fetch(
      TRADING_DIAGNOSTIC_ENDPOINT,
      {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "X-API-Key": apiKey
        },
        redirect: "manual"
      }
    );

    const text = await response.text();

    let body: any = null;
    let bodyType = "EMPTY";

    if (text) {
      try {
        body = JSON.parse(text);
        bodyType = "JSON";
      } catch {
        body = {
          raw: text.slice(0, 3000)
        };
        bodyType =
          /<html|<!doctype html/i.test(text)
            ? "HTML"
            : "TEXT";
      }
    }

    const cloudflareBlock =
      response.status === 403 &&
      bodyType === "HTML" &&
      /cloudflare|sorry, you have been blocked|attention required/i
        .test(text);

    return {
      success: true,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "TRADING_GET_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: true,
      request: {
        method: "GET",
        endpoint: TRADING_DIAGNOSTIC_ENDPOINT
      },
      response: {
        ok: response.ok,
        http_status: response.status,
        body_type: bodyType,
        cloudflare_block_detected: cloudflareBlock,
        headers: diagnosticHeaders(response.headers),
        body
      },
      interpretation:
        cloudflareBlock
          ? "TRADING_API_BLOCKED_AT_CLOUDFLARE_EDGE"
          : response.ok
            ? "TRADING_GET_REACHED_API_SUCCESSFULLY"
            : bodyType === "JSON"
              ? "TRADING_GET_REACHED_API_AND_RETURNED_API_ERROR"
              : "TRADING_GET_FAILED_NON_JSON",
      processing_ms: Date.now() - started
    };
  } catch (error) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "TRADING_GET_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: true,
      error:
        error instanceof Error
          ? error.message
          : String(error),
      processing_ms: Date.now() - started
    };
  }
}

async function graphqlDiagnostic(env: Env): Promise<any> {
  const started = Date.now();
  const key = safe(env.CLOUDBET_API_KEY);

  if (!key) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ACCOUNT_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: false,
      error: "CLOUDBET_API_KEY_MISSING",
      processing_ms: Date.now() - started
    };
  }

  const query = `
    query AccountBalances {
      accountBalances {
        currency
        amount
      }
    }
  `;

  try {
    const response = await fetch(
      GRAPHQL_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "X-API-KEY": key
        },
        body: JSON.stringify({
          query
        }),
        redirect: "manual"
      }
    );

    const raw = await response.text();

    let body: any = null;
    let bodyType = "EMPTY";

    if (raw) {
      try {
        body = JSON.parse(raw);
        bodyType = "JSON";
      } catch {
        body = {
          raw: raw.slice(0, 3000)
        };
        bodyType =
          /<html|<!doctype html/i.test(raw)
            ? "HTML"
            : "TEXT";
      }
    }

    const cfBlocked =
      response.status === 403 &&
      bodyType === "HTML" &&
      /cloudflare|sorry,\s*you have been blocked|attention required/i.test(raw);

    const graphQLErrors =
      Array.isArray(body?.errors)
        ? body.errors
        : [];

    const balances =
      Array.isArray(body?.data?.accountBalances)
        ? body.data.accountBalances
        : [];

    let interpretation =
      "GRAPHQL_ACCOUNT_QUERY_FAILED_NON_JSON";

    if (
      response.ok &&
      bodyType === "JSON" &&
      graphQLErrors.length === 0 &&
      Array.isArray(body?.data?.accountBalances)
    ) {
      interpretation =
        "GRAPHQL_ACCOUNT_QUERY_REACHED_API_SUCCESSFULLY";
    } else if (cfBlocked) {
      interpretation =
        "GRAPHQL_BLOCKED_AT_CLOUDFLARE_EDGE";
    } else if (
      bodyType === "JSON" &&
      graphQLErrors.length > 0
    ) {
      interpretation =
        "GRAPHQL_REACHED_API_AND_RETURNED_GRAPHQL_ERROR";
    } else if (bodyType === "JSON") {
      interpretation =
        "GRAPHQL_REACHED_API_AND_RETURNED_JSON";
    }

    return {
      success: response.ok && !cfBlocked,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ACCOUNT_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: true,
      request: {
        method: "POST",
        endpoint: GRAPHQL_ENDPOINT,
        operation: "AccountBalances"
      },
      response: {
        ok: response.ok,
        http_status: response.status,
        body_type: bodyType,
        cloudflare_block_detected: cfBlocked,
        headers: diagnosticHeaders(response.headers),
        balances,
        graphql_errors: graphQLErrors,
        body
      },
      interpretation,
      processing_ms: Date.now() - started
    };

  } catch (error: any) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "GRAPHQL_ACCOUNT_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: true,
      request: {
        method: "POST",
        endpoint: GRAPHQL_ENDPOINT,
        operation: "AccountBalances"
      },
      error:
        String(
          error?.message ??
          error ??
          "GRAPHQL_DIAGNOSTIC_FAILED"
        ),
      processing_ms: Date.now() - started
    };
  }
}

async function authMatrixDiagnostic(env: Env): Promise<any> {
  const started = Date.now();
  const key = safe(env.CLOUDBET_API_KEY);

  if (!key) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "AUTH_MATRIX_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      api_key_present: false,
      error: "CLOUDBET_API_KEY_MISSING"
    };
  }

  async function probe(
    name: string,
    url: string,
    init: RequestInit
  ): Promise<any> {
    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual"
      });
      const raw = await response.text();
      let body: any = null;
      let bodyType = "EMPTY";

      if (raw) {
        try {
          body = JSON.parse(raw);
          bodyType = "JSON";
        } catch {
          bodyType = /<html|<!doctype html/i.test(raw) ? "HTML" : "TEXT";
          body = { raw: raw.slice(0, 2000) };
        }
      }

      return {
        name,
        ok: response.ok,
        http_status: response.status,
        body_type: bodyType,
        headers: diagnosticHeaders(response.headers),
        body
      };
    } catch (error: any) {
      return {
        name,
        ok: false,
        error: String(error?.message ?? error ?? "REQUEST_FAILED")
      };
    }
  }

  const commonHeaders = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-API-Key": key
  };

  const graphqlQuery = `
    query AuthMatrix($limit: Int) {
      accountBalances {
        currency
        amount
      }
      bets(limit: $limit) {
        referenceId
        eventId
        currency
        price
        stake
        betStatus
        betErrorCode
      }
    }
  `;

  const [restCurrencies, restBalance, restBets, graphql] =
    await Promise.all([
      probe(
        "REST_ACCOUNT_CURRENCIES",
        "https://sports-api.cloudbet.com/pub/v1/account/currencies",
        { method: "GET", headers: commonHeaders }
      ),
      probe(
        "REST_ACCOUNT_USDT_BALANCE",
        "https://sports-api.cloudbet.com/pub/v1/account/currencies/USDT/balance",
        { method: "GET", headers: commonHeaders }
      ),
      probe(
        "REST_TRADING_BETS",
        "https://sports-api.cloudbet.com/pub/v4/bets?limit=1&offset=0",
        { method: "GET", headers: commonHeaders }
      ),
      probe(
        "GRAPHQL_ACCOUNT_AND_BETS",
        GRAPHQL_ENDPOINT,
        {
          method: "POST",
          headers: commonHeaders,
          body: JSON.stringify({
            query: graphqlQuery,
            variables: { limit: 1 }
          })
        }
      )
    ]);

  const gqlErrors =
    Array.isArray(graphql?.body?.errors)
      ? graphql.body.errors
      : [];

  let interpretation = "AUTH_MATRIX_MIXED_RESULT";

  if (
    restCurrencies?.http_status === 200 &&
    restBalance?.http_status === 200 &&
    restBets?.http_status === 200 &&
    graphql?.http_status === 200 &&
    gqlErrors.length === 0
  ) {
    interpretation = "REST_AND_GRAPHQL_AUTH_OK";
  } else if (
    restCurrencies?.http_status === 200 &&
    restBalance?.http_status === 200 &&
    restBets?.http_status === 200 &&
    graphql?.http_status === 200 &&
    gqlErrors.length > 0
  ) {
    interpretation =
      "REST_ACCOUNT_AND_TRADING_AUTH_OK_GRAPHQL_RESOLVER_AUTH_FAILED";
  } else if (
    restBets?.http_status === 200 &&
    (restCurrencies?.http_status !== 200 || restBalance?.http_status !== 200)
  ) {
    interpretation =
      "REST_TRADING_HISTORY_OK_ACCOUNT_API_AUTH_OR_ACCOUNT_SCOPE_FAILED";
  }

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "AUTH_MATRIX_DIAGNOSTIC",
    safe_read_only: true,
    wager_sent: false,
    real_test_enabled: REAL_TEST_ENABLED,
    api_key_present: true,
    probes: {
      rest_account_currencies: restCurrencies,
      rest_account_usdt_balance: restBalance,
      rest_trading_bets: restBets,
      graphql_account_and_bets: graphql
    },
    interpretation,
    processing_ms: Date.now() - started
  };
}

async function restPostPathDiagnostic(env: Env): Promise<any> {
  const started = Date.now();
  const key = safe(env.CLOUDBET_API_KEY);

  if (!key) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "POST_AUTH_DIAGNOSTIC",
      safe_read_only: true,
      wager_sent: false,
      real_test_enabled: REAL_TEST_ENABLED,
      api_key_present: false,
      error: "CLOUDBET_API_KEY_MISSING",
      processing_ms: Date.now() - started
    };
  }

  async function probe(
    name: string,
    url: string,
    init: RequestInit
  ): Promise<any> {
    const probeStarted = Date.now();

    try {
      const response = await fetch(url, {
        ...init,
        redirect: "manual"
      });

      const raw = await response.text();

      let body: any = null;
      let bodyType = "EMPTY";

      if (raw) {
        try {
          body = JSON.parse(raw);
          bodyType = "JSON";
        } catch {
          bodyType =
            /<html|<!doctype html/i.test(raw)
              ? "HTML"
              : "TEXT";

          body = {
            raw: raw.slice(0, 4000)
          };
        }
      }

      const cloudflareBlock =
        response.status === 403 &&
        bodyType === "HTML" &&
        /cloudflare|sorry,\s*you have been blocked|attention required/i.test(raw);

      return {
        name,
        ok: response.ok,
        http_status: response.status,
        latency_ms: Date.now() - probeStarted,
        body_type: bodyType,
        cloudflare_block_detected: cloudflareBlock,
        auth_challenge:
          response.headers.get("www-authenticate"),
        allowed_methods:
          response.headers.get("allow"),
        cors_allowed_methods:
          response.headers.get("access-control-allow-methods"),
        cors_allowed_headers:
          response.headers.get("access-control-allow-headers"),
        headers:
          diagnosticHeaders(response.headers),
        body
      };
    } catch (error: any) {
      return {
        name,
        ok: false,
        http_status: 0,
        latency_ms: Date.now() - probeStarted,
        body_type: "REQUEST_ERROR",
        cloudflare_block_detected: false,
        error: String(
          error?.message ??
          error ??
          "REQUEST_FAILED"
        )
      };
    }
  }

  const authHeaders = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-API-Key": key
  };

  // 1) Authenticated REST GET control.
  const controlGet = await probe(
    "CONTROL_GET_TRADING_HISTORY",
    TRADING_DIAGNOSTIC_ENDPOINT,
    {
      method: "GET",
      headers: authHeaders
    }
  );

  // 2) OPTIONS without API key.
  const optionsStraightNoAuth = await probe(
    "OPTIONS_PLACE_STRAIGHT_NO_AUTH",
    TRADING_STRAIGHT_ENDPOINT,
    {
      method: "OPTIONS",
      headers: {
        "Accept": "application/json",
        "Origin": "https://example.invalid",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "content-type,x-api-key"
      }
    }
  );

  // 3) OPTIONS with API key.
  const optionsStraightAuth = await probe(
    "OPTIONS_PLACE_STRAIGHT_WITH_API_KEY",
    TRADING_STRAIGHT_ENDPOINT,
    {
      method: "OPTIONS",
      headers: {
        ...authHeaders,
        "Origin": "https://example.invalid",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "content-type,x-api-key"
      }
    }
  );

  // 4) Intentionally invalid REST payload.
  // No valid wager fields are supplied.
  const restPostInvalid = await probe(
    "REST_POST_STRAIGHT_INVALID_PAYLOAD",
    TRADING_STRAIGHT_ENDPOINT,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        diagnostic: "V7.6.1",
        intentionallyInvalid: true
      })
    }
  );

  // 5) Authenticated read-only GraphQL POST.
  const graphQLReadOnlyQuery = `
    query V761AccountAuthDiagnostic {
      accountBalances {
        currency
        amount
      }
    }
  `;

  const graphqlReadOnly = await probe(
    "GRAPHQL_POST_ACCOUNT_BALANCES",
    GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query: graphQLReadOnlyQuery
      })
    }
  );

  // 6) GraphQL PlaceBet validation-only request.
  // Required $input is intentionally omitted. Therefore this cannot form
  // a valid wager and should fail GraphQL variable validation.
  const graphQLMutationValidation = `
    mutation V761PlaceBetValidation($input: PlaceBetInput!) {
      placeBet(input: $input) {
        referenceId
        betStatus
        betErrorCode
      }
    }
  `;

  const graphqlPlaceBetNoInput = await probe(
    "GRAPHQL_PLACE_BET_NO_INPUT_VALIDATION_ONLY",
    GRAPHQL_ENDPOINT,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        query: graphQLMutationValidation,
        variables: {}
      })
    }
  );

  const graphqlReadErrors =
    Array.isArray(
      graphqlReadOnly?.body?.errors
    )
      ? graphqlReadOnly.body.errors
      : [];

  const graphqlMutationErrors =
    Array.isArray(
      graphqlPlaceBetNoInput?.body?.errors
    )
      ? graphqlPlaceBetNoInput.body.errors
      : [];

  const restGetAuthenticated =
    controlGet?.http_status === 200;

  const restPostUnauthorized =
    restPostInvalid?.http_status === 401;

  const restPostForbidden =
    restPostInvalid?.http_status === 403;

  const restPostApplicationReached =
    [400, 409, 422].includes(
      restPostInvalid?.http_status
    ) ||
    (
      restPostInvalid?.body_type === "JSON" &&
      ![401, 403].includes(
        restPostInvalid?.http_status
      )
    );

  // V7.6.2 FIX:
  // A GraphQL POST can be authenticated/reach the API even when a resolver
  // returns an application-level INTERNAL_SERVER_ERROR. The important
  // distinction here is that the request was not rejected with HTTP 401/403.
  const graphqlAuthenticated =
    graphqlReadOnly?.body_type === "JSON" &&
    ![401, 403].includes(
      graphqlReadOnly?.http_status
    ) &&
    [200, 400].includes(
      graphqlReadOnly?.http_status
    );

  const graphqlMutationErrorText =
    graphqlMutationErrors
      .map((e: any) => String(e?.message ?? ""))
      .join(" | ")
      .toLowerCase();

  // Cloudbet returns HTTP 400 for GraphQL variable validation errors.
  // That still proves that POST /graphql, the placeBet mutation and
  // PlaceBetInput! schema validation were reached. No wager is formed.
  const graphqlMutationValidationReached =
    graphqlPlaceBetNoInput?.body_type === "JSON" &&
    [200, 400].includes(
      graphqlPlaceBetNoInput?.http_status
    ) &&
    graphqlMutationErrors.length > 0 &&
    (
      graphqlMutationErrorText.includes("placebetinput") ||
      graphqlMutationErrorText.includes('variable "$input"') ||
      graphqlMutationErrorText.includes("non-null type")
    );

  let interpretation =
    "POST_AUTH_DIAGNOSTIC_MIXED_RESULT";

  let recommendedNextStep =
    "REVIEW_PROBES";

  if (
    restGetAuthenticated &&
    restPostApplicationReached
  ) {
    interpretation =
      "REST_POST_APPLICATION_LAYER_REACHED";

    recommendedNextStep =
      "VERIFY_EXACT_V4_REQUEST_SCHEMA_BEFORE_ANY_REAL_TEST";
  } else if (
    restGetAuthenticated &&
    restPostUnauthorized &&
    graphqlAuthenticated &&
    graphqlMutationValidationReached
  ) {
    interpretation =
      "REST_POST_401_BUT_GRAPHQL_PLACEBET_PATH_REACHED";

    recommendedNextStep =
      "USE_GRAPHQL_PLACEBET_PATH_FOR_NEXT_CONTROLLED_TEST";
  } else if (
    restGetAuthenticated &&
    restPostUnauthorized &&
    graphqlAuthenticated
  ) {
    interpretation =
      "REST_POST_AUTHORIZATION_REJECTED_GRAPHQL_POST_AUTH_OK";

    recommendedNextStep =
      "REST_V4_POST_PATH_OR_TRADING_PERMISSION_IS_THE_PROBLEM";
  } else if (
    restGetAuthenticated &&
    restPostUnauthorized &&
    [401, 403].includes(
      graphqlReadOnly?.http_status
    )
  ) {
    interpretation =
      "REST_GET_AUTH_OK_BUT_POST_AUTH_REJECTED_ACROSS_APIS";

    recommendedNextStep =
      "CHECK_API_KEY_TRADING_PERMISSION_OR_ACCOUNT_API_ACCESS";
  } else if (
    restGetAuthenticated &&
    restPostForbidden
  ) {
    interpretation =
      restPostInvalid?.cloudflare_block_detected === true
        ? "REST_POST_BLOCKED_AT_CLOUDFLARE_EDGE"
        : "REST_POST_FORBIDDEN_BY_API";

    recommendedNextStep =
      "CHECK_API_PERMISSION_OR_EDGE_POLICY";
  } else if (
    !restGetAuthenticated
  ) {
    interpretation =
      "API_KEY_CONTROL_GET_FAILED";

    recommendedNextStep =
      "STOP_AND_FIX_API_KEY_OR_TRADING_API_ACCESS";
  }

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "POST_AUTH_DIAGNOSTIC",
    safe_read_only: true,
    wager_sent: false,
    real_test_enabled: REAL_TEST_ENABLED,
    api_key_present: true,
    invalid_payload_only: true,
    auth_scheme: "X-API-Key",

    safety: {
      valid_wager_payload_sent: false,
      event_id_sent: false,
      market_url_sent: false,
      stake_sent: false,
      price_sent: false,
      reference_id_sent: false
    },

    auth_summary: {
      rest_get_authenticated:
        restGetAuthenticated,
      rest_post_application_reached:
        restPostApplicationReached,
      rest_post_unauthorized:
        restPostUnauthorized,
      graphql_post_authenticated:
        graphqlAuthenticated,
      graphql_place_bet_validation_reached:
        graphqlMutationValidationReached,
      graphql_account_resolver_error:
        graphqlReadErrors.length > 0
    },

    probes: {
      control_get_trading_history:
        controlGet,
      options_place_straight_no_auth:
        optionsStraightNoAuth,
      options_place_straight_with_api_key:
        optionsStraightAuth,
      rest_post_straight_invalid_payload:
        restPostInvalid,
      graphql_post_account_balances:
        graphqlReadOnly,
      graphql_place_bet_no_input_validation_only:
        graphqlPlaceBetNoInput
    },

    interpretation,
    recommended_next_step:
      recommendedNextStep,
    processing_ms:
      Date.now() - started
  };
}

function v4StraightPayloadPreview(): any {
  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    action: "V4_STRAIGHT_PAYLOAD_PREVIEW",
    safe_read_only: true,
    wager_sent: false,
    schema: {
      referenceId: "<UUID>",
      currency: BET_CURRENCY,
      stake: "<STAKE>",
      acceptPartialStake: false,
      priceChange: {
        value: "BETTER"
      },
      selection: {
        eventId: "<EXACT_CLOUDBET_EVENT_ID>",
        marketUrl: "<EXACT_MARKET_URL>",
        price: "<CURRENT_PRICE>"
      }
    },
    contract: "CLOUDBET_OFFICIAL_V4_JULY_22_2026",
    one_shot_rearmed: true,
    one_shot_key: REAL_TEST_KEY,
    test_stake: REAL_TEST_STAKE,
    hard_balance_safety: "NO POST IF BALANCE >= TEST STAKE"
  };
}

async function realTestStatus(env: Env): Promise<any> {
  await ensureRealTestTable(env);
  const row = await env.DB.prepare(`
    SELECT test_key, status, event_id, stake, balance, http_status,
           response_json, created_at, updated_at
    FROM real_bet_test_guard
    WHERE test_key = ?
    LIMIT 1
  `).bind(REAL_TEST_KEY).first<any>();
  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    real_test_enabled: REAL_TEST_ENABLED,
    test_stake: REAL_TEST_STAKE,
    consumed: !!row,
    test: row ?? null
  };
}

// ============================================================
// To keep this generated artifact concise and complete, the remaining
// preflight/run/diagnostic/router logic is copied from the user-provided
// V7.6.0 source below without behavioral changes.
// ============================================================

async function runDirectPreflight(
  env: Env,
  input: DirectPreflightInput
): Promise<any> {
  const started = Date.now();
  const requestedEventId = normalizeEventId(input?.event_id);

  const schema = await ensureDatabaseSchema(env);

  if (!schema.success) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "DIRECT_PREFLIGHT",
      ready: false,
      event_id: requestedEventId,
      reason: "DATABASE_SCHEMA_MIGRATION_FAILED",
      database_schema: schema,
      processing_ms: Date.now() - started
    };
  }

  const enrichedInput =
    await enrichDirectPreflightInput(
      env,
      input
    );

  const signal =
    buildDirectSignal(
      enrichedInput
    );

  const matcherSync =
    enrichedInput?.matcher_sync &&
    typeof enrichedInput.matcher_sync === "object"
      ? enrichedInput.matcher_sync
      : {};

  const oldMatcherLocked =
    matcherSync?.old_matcher_locked === true &&
    requestedEventId !== null;

  // V7.6.23:
  // - secure deterministic matcher => AI verifies the SAME event only
  // - no secure deterministic match => AI keeps its normal fallback search
  const aiRequest = {
    ...signal,
    matcher_sync: {
      ...matcherSync,
      old_matcher_event_id:
        requestedEventId ??
        matcherSync?.old_matcher_event_id ??
        null,
      old_matcher_locked:
        oldMatcherLocked
    },
    locked_event_id:
      oldMatcherLocked
        ? requestedEventId
        : null,
    resolve_mode:
      oldMatcherLocked
        ? "VERIFY_LOCKED_EVENT"
        : "FALLBACK_SEARCH"
  };

  const aiMatch =
    await resolveAiMatch(
      env,
      aiRequest
    );

  const synchronizedEventId =
    oldMatcherLocked
      ? requestedEventId
      : aiMatch.event_id;

  // When the deterministic matcher locked an event, AI disagreement is
  // diagnostic only. It is not allowed to replace or reject that identity.
  // When there is no lock, existing AI acceptance rules remain mandatory.
  if (
    !oldMatcherLocked &&
    (
      !aiMatch.ok ||
      !aiMatch.accepted ||
      !aiMatch.event_id
    )
  ) {
    const aiPending =
      isAiResolutionPending(aiMatch);

    return {
      success: aiPending,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: aiPending ? "WAITING_AI" : "DIRECT_PREFLIGHT",
      ready: false,
      pending: aiPending,
      requested_event_id: requestedEventId,
      event_id: aiMatch.event_id,
      reason:
        aiPending
          ? "AI_MATCH_PENDING"
          : (aiMatch.reason || "AI_MATCH_NOT_ACCEPTED"),
      ai_reason: aiMatch.reason || null,
      ai_match: aiMatch,
      matcher_sync: {
        old_matcher_locked:
          false,
        source:
          "AI_FALLBACK"
      },
      signal_sent_to_ai: {
        match_id: signal?.match_id ?? null,
        match: signal?.match ?? null,
        home: signal?.home ?? null,
        away: signal?.away ?? null,
        competition: signal?.competition ?? null,
        entry_minute: signal?.entry_minute ?? null,
        hunter_score: signal?.hunter_score ?? null
      },
      processing_ms: Date.now() - started
    };
  }

  if (!synchronizedEventId) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "DIRECT_PREFLIGHT",
      ready: false,
      pending: false,
      requested_event_id: requestedEventId,
      event_id: null,
      reason: "SYNCHRONIZED_EVENT_ID_MISSING",
      ai_match: aiMatch,
      processing_ms: Date.now() - started
    };
  }

  const synchronizedAiMatch =
    oldMatcherLocked
      ? {
          ...aiMatch,
          event_id:
            synchronizedEventId,
          accepted:
            aiMatch?.accepted === true &&
            normalizeEventId(
              aiMatch?.event_id
            ) === synchronizedEventId,
          synchronization_source:
            (
              aiMatch?.accepted === true &&
              normalizeEventId(
                aiMatch?.event_id
              ) === synchronizedEventId
            )
              ? "OLD_MATCHER_AI_CONFIRMED"
              : "OLD_MATCHER_LOCK"
        }
      : aiMatch;

  const trackerCloudbet =
    oldMatcherLocked
      ? {
          event_id:
            synchronizedEventId,
          match:
            safe(
              aiMatch?.cloudbet_match ??
              ""
            ) || null,
          entry_odds:
            numberOrNull(
              enrichedInput?.entry_odds
            ),
          max_stake:
            numberOrNull(
              enrichedInput?.max_stake
            ),
          odds_available:
            numberOrNull(
              enrichedInput?.entry_odds
            ) !== null,
          matcher_score:
            numberOrNull(
              matcherSync?.old_matcher_score ??
              enrichedInput?.matcher_score
            )
        }
      : buildAiSelectedCloudbetData(
          signal,
          aiMatch
        );

  const eventId =
    synchronizedEventId;

  const effectiveAiMatch =
    synchronizedAiMatch;

  const account = await fetchAccountSnapshot(env);
  const current =
    await verifySameEventAndOdds(
      env,
      eventId,
      numberOrNull(
        signal?.entry_minute ??
        signal?.minute
      )
    );

  if (!current.success) {
    if (isTerminalPreflightFailure(current.error)) {
      return {
        success: true,
        worker: "cloudbet-bet-worker",
        version: VERSION,
        mode: MODE,
        dry_run: DRY_RUN,
        betting_enabled: BETTING_ENABLED,
        action: "NOT_ELIGIBLE",
        ready: false,
        pending: false,
        event_id: eventId,
        match: signalMatch(signal),
        reason: current.error || "EVENT_NO_LONGER_ELIGIBLE",
        current,
        ai_match: effectiveAiMatch,
        requested_event_id: requestedEventId,
        processing_ms: Date.now() - started
      };
    }

    const pendingExecutionId = crypto.randomUUID();
    const saved = await savePending(
      env,
      pendingExecutionId,
      signal,
      trackerCloudbet,
      current
    );

    return {
      success: saved.success === true,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      dry_run: DRY_RUN,
      betting_enabled: BETTING_ENABLED,
      action: "PENDING_ODDS",
      ready: false,
      pending: true,
      event_id: eventId,
      match: signalMatch(signal),
      reason: current.error || "TARGET_ODDS_NOT_AVAILABLE",
      entry_odds: trackerCloudbet.entry_odds,
      current_odds: current.current_odds,
      max_stake: current.max_stake,
      account,
      account_balance: numberOrNull(account?.balance),
      current,
      pending_odds: saved,
      ai_match: effectiveAiMatch,
      requested_event_id: requestedEventId,
      source: {
        identity: "AI_MATCHER /resolve",
        previous_tracker_event_id: requestedEventId,
        event: "AI_MATCHER_EVENT_ID",
        state: "/event?id=SAME_AI_EVENT_ID",
        odds: "MATCHER /live EXACT SAME AI EVENT_ID"
      },
      processing_ms: Date.now() - started
    };
  }

  const bet = buildReadyBet(signal, trackerCloudbet, current);
  const archive = await archiveBet(env, bet, signal, current);

  if (!archive.success) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      action: "DIRECT_PREFLIGHT",
      ready: false,
      event_id: eventId,
      reason: archive.error || "ARCHIVE_FAILED",
      account,
      current,
      archive,
      processing_ms: Date.now() - started
    };
  }

  const accountPreflight = buildAccountPreflight(account, current);
  const handoff = buildTradingHandoff(bet, current, account);
  const ready = handoff?.ready_to_send === true;

  // V7.6.17: the NEXT genuinely BET READY direct-preflight signal may execute
  // the existing globally guarded AUTO E2E one-shot test for exactly 0.10 USDT.
  // runAutoE2EOneShot performs a fresh same-event validation immediately before POST.
  let realTest: any = {
    attempted: false,
    consumed: false,
    reason: "NOT_READY_FOR_AUTO_E2E"
  };

  if (
    AUTO_E2E_TEST_ENABLED &&
    ready === true
  ) {
    realTest = await runAutoE2EOneShot(
      env,
      signal,
      eventId
    );
  }

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled: BETTING_ENABLED,
    action: "READY_TO_BET",
    ready,
    event_id: eventId,
    match: signalMatch(signal),
    reason:
      ready
        ? "ALL_PREFLIGHT_CHECKS_PASSED"
        : (accountPreflight?.block_reason || "PREFLIGHT_NOT_READY"),
    entry_odds: trackerCloudbet.entry_odds,
    current_odds: current.current_odds,
    max_stake: current.max_stake,
    min_stake: current.min_stake,
    account_balance: numberOrNull(account?.balance),
    account_preflight: accountPreflight,
    handoff,
    archive,
    current,
    ai_match: effectiveAiMatch,
    requested_event_id: requestedEventId,
    source: {
      identity: "AI_MATCHER /resolve",
      previous_tracker_event_id: requestedEventId,
      event: "AI_MATCHER_EVENT_ID",
      state: "/event?id=SAME_AI_EVENT_ID",
      odds: "MATCHER /live EXACT SAME AI EVENT_ID"
    },
    real_test: realTest,
    processing_ms: Date.now() - started
  };
}

async function runWorker(
  env: Env
): Promise<any> {
  const started = Date.now();
  const executionId = crypto.randomUUID();

  const schema = await ensureDatabaseSchema(env);

  if (!schema.success) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "DATABASE_SCHEMA_MIGRATION_FAILED",
      database_schema: schema,
      processing_ms: Date.now() - started
    };
  }

  const account = await fetchAccountSnapshot(env);

  let pendingResult: any;

  try {
    pendingResult = await processPending(env, account);
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
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "TRACKER_FAILED",
      tracker: trackerResult,
      account,
      pending_retry: pendingResult,
      processing_ms: Date.now() - started
    };
  }

  const trackerSignals = trackerEntries(trackerResult.data);
  const hunterSignals = trackerSignals.filter(isHunterEntry);

  const aiHistory =
    await fetchAiHistory(env);

  if (!aiHistory.ok) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting_enabled: BETTING_ENABLED,
      action: "RUN",
      execution_id: executionId,
      error: "AI_MATCHER_HISTORY_FAILED",
      ai_matcher: aiHistory,
      account,
      pending_retry: pendingResult,
      processing_ms: Date.now() - started
    };
  }

  const ready: any[] = [];
  const pending: any[] = [];
  const pendingAi: any[] = [];
  const skipped: any[] = [];
  const errors: any[] = [];

  let trackerReady = 0;
  let refreshedReady = 0;
  let targetPending = 0;
  // V7.6.12 — carry the pending-odds one-shot result into the same /run cycle.
  // If a pending signal already consumed/attempted the one-shot, an immediately
  // READY signal cannot send another wager in this run.
  let autoE2ETest: any =
    pendingResult?.auto_e2e_test ?? {
      attempted: false,
      consumed: false,
      reason: AUTO_E2E_TEST_ENABLED
        ? "WAITING_FOR_READY_HUNTER"
        : "AUTO_E2E_TEST_DISABLED"
    };

  let aiResolved = 0;
  let aiAccepted = 0;
  let aiPending = 0;
  let aiRejected = 0;

  for (const signal of hunterSignals) {
    try {
      const previousTrackerCloudbet =
        trackerCloudbetData(signal);

      const aiMatch =
        findAiHistoryMatch(
          signal,
          aiHistory.rows
        );

      aiResolved++;

      if (
        !aiMatch.ok ||
        !aiMatch.accepted ||
        !aiMatch.event_id
      ) {
        if (isAiResolutionPending(aiMatch)) {
          aiPending++;
          pendingAi.push({
            action: "WAITING_AI",
            reason:
              aiMatch.reason ||
              "AI_MATCH_PENDING",
            signal,
            ai_match: aiMatch,
            previous_tracker_cloudbet:
              previousTrackerCloudbet
          });
        } else {
          aiRejected++;
          skipped.push({
            reason:
              aiMatch.reason ||
              "AI_MATCH_NOT_ACCEPTED",
            signal,
            ai_match: aiMatch,
            previous_tracker_cloudbet:
              previousTrackerCloudbet
          });
        }
        continue;
      }

      aiAccepted++;
      trackerReady++;

      const trackerCloudbet:
        TrackerCloudbetData =
        buildAiSelectedCloudbetData(
          signal,
          aiMatch
        );

      const cloudbetId =
        trackerCloudbet.event_id!;

      if (
        await pendingOddsExists(
          env,
          cloudbetId
        )
      ) {
        targetPending++;
        pending.push({
          action: "ALREADY_PENDING_ODDS",
          cloudbet_id: cloudbetId,
          ai_match: aiMatch,
          previous_tracker_event_id:
            previousTrackerCloudbet.event_id,
          match: signalMatch(signal),
          reason: "PENDING_QUEUE_OWNS_RETRY"
        });
        continue;
      }

      const current =
        await verifySameEventAndOdds(
          env,
          cloudbetId,
          numberOrNull(
            signal?.entry_minute ??
            signal?.minute
          )
        );

      if (!current.success) {
        if (isTerminalPreflightFailure(current.error)) {
          skipped.push({
            reason:
              current.error ||
              "EVENT_NO_LONGER_ELIGIBLE",
            signal,
            cloudbet_id: cloudbetId,
            ai_match: aiMatch,
            current
          });
          continue;
        }

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
            type: "PENDING_SAVE_FAILED",
            signal,
            cloudbet_id: cloudbetId,
            current,
            error: saved.error
          });
          continue;
        }

        targetPending++;
        pending.push({
          execution_id: pendingExecutionId,
          action: "PENDING_ODDS",
          cloudbet_id: cloudbetId,
          ai_match: aiMatch,
          previous_tracker_event_id:
            previousTrackerCloudbet.event_id,
          match: signalMatch(signal),
          entry_odds: trackerCloudbet.entry_odds,
          current_odds: current.current_odds,
          reason: current.error,
          pending: saved
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
          type: "ARCHIVE_FAILED",
          signal,
          cloudbet_id: cloudbetId,
          bet,
          error: archive.error
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

      if (
        AUTO_E2E_TEST_ENABLED &&
        handoff?.ready_to_send === true &&
        autoE2ETest?.consumed !== true &&
        autoE2ETest?.attempted !== true
      ) {
        autoE2ETest = await runAutoE2EOneShot(env, signal, cloudbetId);
      }

      ready.push({
        execution_id: bet.execution_id,
        action: "READY_TO_BET",
        cloudbet_id: cloudbetId,
        ai_match: aiMatch,
        previous_tracker_event_id:
          previousTrackerCloudbet.event_id,
        match: signalMatch(signal),
        home: signalHome(signal),
        away: signalAway(signal),
        entry_minute: signal?.entry_minute ?? null,
        hunter_score:
          signal?.hunter_score ??
          signal?.score ??
          null,
        matcher_score: trackerCloudbet.matcher_score,
        entry_odds: trackerCloudbet.entry_odds,
        current_odds: current.current_odds,
        odds_movement: bet.odds.movement,
        current_max_stake: current.max_stake,
        market_url: current.market_url,
        target: bet.target,
        account_preflight:
          buildAccountPreflight(
            account,
            current
          ),
        handoff,
        archive
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

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled: BETTING_ENABLED,
    handoff_enabled: HANDOFF_ENABLED,
    action: "RUN",
    execution_id: executionId,

    config: {
      stake_eur: BET_STAKE_EUR,
      handoff_currency: BET_CURRENCY,
      handoff_stake: BET_STAKE,
      trading_endpoint: TRADING_STRAIGHT_ENDPOINT,
      market: BET_MARKET,
      selection: BET_SELECTION,
      target_market: TARGET_MARKET,
      target_submarket: TARGET_SUBMARKET,
      target_outcome: TARGET_OUTCOME,
      target_params: TARGET_PARAMS,
      tracker_is_match_source: false,
      ai_matcher_is_primary_match_source: true,
      ai_matcher_endpoint: "/api/history (RUN) + /resolve (DIRECT PREFLIGHT)",
      ai_accept_confidence: 0.90,
      ai_hard_category_guard_required: true,
      direct_event_preflight: true,
      direct_preflight_endpoint: "/preflight",
      d1_auto_migration: true,
      matcher_lookup: true,
      matcher_used_for_matching: false,
      old_tracker_match_retained_for_diagnostics: true,
      matcher_used_for_exact_odds: true,
      matcher_odds_endpoint: "/live",
      matcher_odds_event_lock: "EXACT_EVENT_ID_ONLY",
      fuzzy_fallback: false,
      direct_cloudbet_match_fallback: false,
      final_same_event_check: true,
      current_odds_refresh: true,
      persistent_pending_retry: true,
      odds_event_max_retries: ODDS_EVENT_MAX_RETRIES,
      odds_event_retry_delay_ms: ODDS_EVENT_RETRY_DELAY_MS,
      retry_same_event: true,
      retry_same_market: true,
      retry_same_line: true,
      account_preflight: true,
      account_endpoint: "/account-test",
      handoff_only: true,
      real_bet_post: "AUTO_E2E_ONE_SHOT_ONLY",
      auto_e2e_test_enabled: AUTO_E2E_TEST_ENABLED,
      auto_e2e_max_real_bets: 1,
      auto_e2e_stake: AUTO_E2E_TEST_STAKE,
      hard_safety_gates: true,
      require_known_score_0_0: true,
      require_explicit_first_half: true,
      hunter_minute_window: `${BET_MINUTE_FROM}-${BET_MINUTE_TO}`,
      bet_minute_from: BET_MINUTE_FROM,
      bet_minute_to: BET_MINUTE_TO,
      exact_market_url_lock: TARGET_MARKET_URL,
      fixed_stake: BET_STAKE,
      duplicate_real_bet_guard: true
    },

    source: {
      tracker: "/entries",
      identity:
        "AI_MATCHER /api/history -> accepted event_id",
      previous_tracker_match:
        "DIAGNOSTIC ONLY",
      cloudbet_event:
        "/event?id=AI_MATCHER_EVENT_ID",
      current_odds:
        "MATCHER /live -> EXACT SAME AI EVENT_ID"
    },

    stats: {
      tracker_signals: trackerSignals.length,
      hunter_signals: hunterSignals.length,
      ai_history_rows: aiHistory.rows.length,
      ai_resolved: aiResolved,
      ai_accepted: aiAccepted,
      ai_pending: aiPending,
      ai_rejected: aiRejected,
      tracker_ready: trackerReady,
      ready_to_bet: refreshedReady,
      pending: targetPending,
      skipped: skipped.length,
      errors: errors.length
    },

    account,
    pending_retry: pendingResult,
    ready,
    pending,
    pending_ai: pendingAi,
    skipped,
    errors,
    auto_e2e_test: autoE2ETest,

    processing_ms: Date.now() - started
  };
}

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
    success: tracker.ok,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    betting_enabled: BETTING_ENABLED,
    handoff_enabled: HANDOFF_ENABLED,
    action: "DIAGNOSTIC",

    architecture: {
      match_source: "TRACKER V6.7+",
      tracker_endpoint: "/entries",
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
      matcher_lookup: true,
      matcher_purpose: "EXACT_ODDS_ONLY",
      matcher_name_matching: false,
      matcher_event_selection: false,
      matcher_odds_endpoint: "/live",
      matcher_event_lock: "EXACT_EVENT_ID_ONLY",
      name_matching: false,
      fallback_to_other_event: false,
      final_verification:
        "/event?id=SAME_CLOUDBET_EVENT_ID",
      current_odds_source:
        "MATCHER /live EXACT SAME EVENT_ID",
      final_handoff: true,
      real_bet_post: "AUTO_E2E_ONE_SHOT_ONLY",
      auto_e2e_test_enabled: AUTO_E2E_TEST_ENABLED,
      auto_e2e_max_real_bets: 1,
      auto_e2e_stake: AUTO_E2E_TEST_STAKE
    },

    target: {
      market: TARGET_MARKET,
      submarket: TARGET_SUBMARKET,
      outcome: TARGET_OUTCOME,
      params: TARGET_PARAMS
    },

    handoff: {
      enabled: HANDOFF_ENABLED,
      currency: BET_CURRENCY,
      stake: BET_STAKE,
      endpoint: TRADING_STRAIGHT_ENDPOINT,
      sent: false
    },

    tracker: {
      ok: tracker.ok,
      status: tracker.status,
      latency_ms: tracker.latency_ms,
      signals: trackerSignals.length,
      raw: tracker.data,
      error: tracker.error || null
    },

    diagnostics,

    processing_ms: Date.now() - started
  };
}

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
    success: result.ok,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    proxy: "TRACKER",
    endpoint: "/entries",
    status: result.status,
    latency_ms: result.latency_ms,
    data: result.data,
    error: result.error || null
  };
}

function healthResponse():
  Response {
  return json({
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    dry_run: DRY_RUN,
    betting_enabled: BETTING_ENABLED,
    handoff_enabled: HANDOFF_ENABLED,
    status: "OK",

    target: {
      market: BET_MARKET,
      selection: TARGET_SELECTION,
      market_key: TARGET_MARKET,
      submarket_key: TARGET_SUBMARKET,
      outcome: TARGET_OUTCOME,
      params: TARGET_PARAMS
    },

    architecture: {
      tracker_match_source: true,
      direct_event_preflight: true,
      direct_preflight_endpoint: "/preflight",
      matcher_lookup: true,
      matcher_used_for_matching: false,
      matcher_used_for_exact_odds: true,
      matcher_odds_endpoint: "/live",
      fuzzy_matching: false,
      cloudbet_fallback: false,
      exact_event_lock: true,
      final_event_refresh: true,
      current_odds_source:
        "MATCHER /live EXACT EVENT_ID",
      final_handoff: true,
      real_bet_post: false
    },

    cloudbet: {
      event_endpoint:
        "/event?id=CLOUDBET_EVENT_ID",
      persistent_retry: true,
      max_retries: ODDS_EVENT_MAX_RETRIES,
      retry_delay_ms: ODDS_EVENT_RETRY_DELAY_MS,
      retry_same_event: true,
      retry_same_market: true,
      retry_same_line: true,
      trading_endpoint: TRADING_STRAIGHT_ENDPOINT,
      handoff_only: true
    },

    endpoints: [
      "/",
      "/health",
      "/run",
      "/preflight",
      "/real-test-010",
      "/real-bets",
      "/auto-test-status",
      "/bet-status?reference_id=...",
      "/telegram-test",
      "/trading-diagnostic",
      "/graphql-diagnostic",
      "/auth-matrix",
      "/rest-post-diagnostic",
      "/trading-payload-preview",
      "/diagnostic",
      "/entries"
    ]
  });
}

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
          success: true,
          worker: "cloudbet-bet-worker",
          version: VERSION,
          mode: MODE,
          dry_run: DRY_RUN,
          betting_enabled: BETTING_ENABLED,
          handoff_enabled: HANDOFF_ENABLED,
          status: "ONLINE",

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
            "AUTO TEST — AT MOST ONE REAL 0.10 USDT POST AFTER ALL GATES"
          ],

          target: {
            market: TARGET_MARKET,
            submarket: TARGET_SUBMARKET,
            outcome: TARGET_OUTCOME,
            params: TARGET_PARAMS
          },

          handoff: {
            currency: BET_CURRENCY,
            stake: BET_STAKE,
            endpoint: TRADING_STRAIGHT_ENDPOINT,
            enabled: HANDOFF_ENABLED,
            real_post: false
          },

          safety: {
            matcher_inside_bet_worker: true,
            matcher_purpose: "EXACT_ODDS_ONLY",
            matcher_name_matching: false,
            matcher_event_selection: false,
            fuzzy_name_matching: false,
            alternative_event_fallback: false,
            same_event_only: true,
            real_betting: false,
            auto_e2e_one_shot_enabled: AUTO_E2E_TEST_ENABLED,
            auto_e2e_max_real_bets: 1,
            auto_e2e_stake: AUTO_E2E_TEST_STAKE,
            one_shot_real_test: REAL_TEST_ENABLED,
            one_shot_test_stake: REAL_TEST_STAKE,
            real_bet_archive: true,
            telegram_notifications: true,
            telegram_bot_token_present: !!safe(env.TELEGRAM_BOT_TOKEN),
            telegram_chat_id_present: !!safe(env.TELEGRAM_CHAT_ID),
            v4_payload_schema_fixed: true
          },

          endpoints: [
            "/",
            "/health",
            "/run",
            "/preflight",
            "/real-test-status",
            "/real-test-010",
            "/real-bets",
            "/auto-test-status",
            "/bet-status?reference_id=...",
            "/telegram-test",
            "/trading-diagnostic",
            "/graphql-diagnostic",
            "/auth-matrix",
            "/rest-post-diagnostic",
            "/trading-payload-preview",
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
          await runEntriesProxy(
            env
          )
        );
      }

      if (path === "/diagnostic") {
        return json(
          await runDiagnostic(
            env
          )
        );
      }

      if (path === "/preflight") {
        if (request.method !== "POST") {
          return json(
            {
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "METHOD_NOT_ALLOWED",
              expected_method: "POST"
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
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "INVALID_JSON_BODY"
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

      if (path === "/real-test-status") {
        return json(
          await realTestStatus(env)
        );
      }

      if (path === "/auto-test-status") {
        if (request.method !== "GET") {
          return json({ success: false, worker: "cloudbet-bet-worker", version: VERSION, error: "METHOD_NOT_ALLOWED", expected_method: "GET" }, 405);
        }
        return json(await autoE2ETestStatus(env));
      }

      if (path === "/bet-status") {
        if (request.method !== "GET") {
          return json({
            success: false,
            worker: "cloudbet-bet-worker",
            version: VERSION,
            error: "METHOD_NOT_ALLOWED",
            expected_method: "GET"
          }, 405);
        }

        const referenceId = url.searchParams.get("reference_id");
        const result = await confirmAndArchiveCloudbetBet(
          env,
          referenceId,
          "BET_STATUS_CONFIRMED_ACCEPTED"
        );

        return json({
          success: result?.success === true,
          worker: "cloudbet-bet-worker",
          version: VERSION,
          action: "CLOUDBET_BET_STATUS",
          reference_id: safe(referenceId),
          normal_betting_enabled: BETTING_ENABLED,
          real_bet_archived: result?.archived === true,
          result
        });
      }

      if (path === "/real-bets") {
        if (request.method !== "GET") {
          return json({ success: false, worker: "cloudbet-bet-worker", version: VERSION, error: "METHOD_NOT_ALLOWED", expected_method: "GET" }, 405);
        }
        return json(await listRealBets(env, url.searchParams.get("limit")));
      }

      if (path === "/telegram-test") {
        if (request.method !== "GET") {
          return json({
            success: false,
            worker: "cloudbet-bet-worker",
            version: VERSION,
            action: "TELEGRAM_TEST",
            error: "METHOD_NOT_ALLOWED",
            expected_method: "GET",
            cloudbet_request_sent: false,
            wager_sent: false
          }, 405);
        }
        return json(await runTelegramTest(env));
      }

      if (path === "/trading-diagnostic") {
        if (request.method !== "GET") {
          return json(
            {
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "METHOD_NOT_ALLOWED",
              expected_method: "GET"
            },
            405
          );
        }

        return json(
          await tradingDiagnostic(env)
        );
      }

      if (path === "/graphql-diagnostic") {
        if (request.method !== "GET") {
          return json(
            {
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "METHOD_NOT_ALLOWED"
            },
            405
          );
        }

        return json(
          await graphqlDiagnostic(env)
        );
      }

      if (path === "/auth-matrix") {
        if (request.method !== "GET") {
          return json(
            {
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "METHOD_NOT_ALLOWED"
            },
            405
          );
        }

        return json(
          await authMatrixDiagnostic(env)
        );
      }

      if (path === "/rest-post-diagnostic") {
        if (request.method !== "GET") {
          return json(
            {
              success: false,
              worker: "cloudbet-bet-worker",
              version: VERSION,
              error: "METHOD_NOT_ALLOWED"
            },
            405
          );
        }

        return json(
          await restPostPathDiagnostic(env)
        );
      }

      if (path === "/real-test-010") {
        const eventId = url.searchParams.get("event_id");
        const confirm = url.searchParams.get("confirm");
        return json(await runExplicitOneShot010(env, eventId, confirm));
      }

      if (path === "/graphql-validation-test") {
        const eventId = url.searchParams.get("event_id");
        return json(
          await runGraphqlSafeValidation(
            env,
            eventId
          )
        );
      }

      if (path === "/graphql-real-dry-run") {
        const eventId = url.searchParams.get("event_id");
        return json(
          await runGraphqlRealPayloadDryRun(
            env,
            eventId
          )
        );
      }

      if (path === "/graphql-trading-payload-preview") {
        return json(
          graphqlTradingPayloadPreview()
        );
      }

      if (path === "/trading-payload-preview") {
        return json(
          v4StraightPayloadPreview()
        );
      }

      if (path === "/run") {
        return json(
          await runWorker(
            env
          )
        );
      }

      return json(
        {
          success: false,
          worker: "cloudbet-bet-worker",
          version: VERSION,
          error: "Not found",
          path
        },
        404
      );
    } catch (
      error
    ) {
      return json(
        {
          success: false,
          worker: "cloudbet-bet-worker",
          version: VERSION,
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

