// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.9.8 — ALL LIVE LINE AUDIT FIX
//
// EXISTING PURPOSE:
// - fast /live for matcher
// - ONE official Cloudbet request
// - NO market scanning in /live
// - compact event objects only
// - /event uses direct event endpoint
// - /line-test preserved for diagnostics
//
// V5.9.8:
// - Added /account-test
// - Uses official Cloudbet REST Account API
// - Reads currencies and balance for each currency
// - READ ONLY
// - NO BET PLACEMENT
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

type AnyObj = Record<string, any>;

const VERSION = "V5.9.8 ALL LIVE LINE AUDIT FIX";

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const ACCOUNT_API_BASE =
  "https://sports-api.cloudbet.com/pub/v1/account";

const TIMEOUT_MS = 8000;

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_MARKET_URL =
  "soccer.total_goals_period_first_half/over?total=0.5";


// ============================================================
// RESPONSE
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
          "application/json; charset=utf-8",
        "cache-control":
          "no-store"
      }
    }
  );
}


// ============================================================
// HELPERS
// ============================================================

function apiKey(env: Env): string {
  return String(
    env.CLOUDBET_API_KEY || ""
  ).trim();
}

async function readResponse(
  response: Response
): Promise<{
  data: any;
  raw: string | null;
}> {
  const text =
    await response.text();

  if (!text) {
    return {
      data: null,
      raw: null
    };
  }

  try {
    return {
      data: JSON.parse(text),
      raw: null
    };
  } catch {
    return {
      data: null,
      raw: text.slice(0, 2000)
    };
  }
}

function finiteNumber(
  value: any
): number | null {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// CLOUDBET ODDS FETCH
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string,
  init: RequestInit = {}
): Promise<{
  response: Response;
  elapsedMs: number;
}> {
  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        API_BASE + path,
        {
          ...init,

          headers: {
            "accept":
              "application/json",

            "x-api-key":
              apiKey(env),

            ...(init.headers || {})
          },

          signal:
            controller.signal
        }
      );

    return {
      response,
      elapsedMs:
        Date.now() - started
    };

  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// EVENT EXTRACTION
// ============================================================

function extractEvents(
  data: any
): AnyObj[] {

  if (
    data &&
    Array.isArray(
      data.competitions
    )
  ) {
    const result:
      AnyObj[] = [];

    for (
      const competition
      of data.competitions
    ) {
      if (
        !Array.isArray(
          competition?.events
        )
      ) {
        continue;
      }

      for (
        const event
        of competition.events
      ) {
        if (
          !event ||
          typeof event !==
            "object"
        ) {
          continue;
        }

        result.push({
          ...event,

          competition:
            event.competition ??
            {
              name:
                competition?.name ??
                null,

              key:
                competition?.key ??
                null,

              category:
                competition?.category ??
                null
            }
        });
      }
    }

    return result;
  }

  if (
    Array.isArray(
      data?.events
    )
  ) {
    return data.events;
  }

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  return [];
}


function isLive(
  event: AnyObj
): boolean {

  const status =
    String(
      event?.status ??
      ""
    )
      .trim()
      .toUpperCase();

  return (
    status ===
      "TRADING_LIVE" ||
    status ===
      "LIVE" ||
    status.includes(
      "LIVE"
    )
  );
}


function compactEvent(
  event: AnyObj
): AnyObj {

  return {
    id:
      event?.id ??
      null,

    event_id:
      event?.id ??
      null,

    home:
      event?.home?.name ??
      null,

    away:
      event?.away?.name ??
      null,

    home_key:
      event?.home?.key ??
      null,

    away_key:
      event?.away?.key ??
      null,

    status:
      event?.status ??
      null,

    competition:
      event?.competition
        ? {
            name:
              event.competition
                ?.name ??
              null,

            key:
              event.competition
                ?.key ??
              null,

            category:
              event.competition
                ?.category ??
              null
          }
        : null
  };
}


// ============================================================
// FAST LIVE
// ============================================================

async function getFastLive(
  env: Env
): Promise<AnyObj> {

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const result =
    await cloudbetFetch(
      env,
      path
    );

  if (
    !result.response.ok
  ) {
    const body =
      await result.response
        .text();

    throw new Error(
      "CLOUDBET_HTTP_" +
      result.response.status +
      ": " +
      body.slice(0, 300)
    );
  }

  const parsed =
    await readResponse(
      result.response
    );

  const events =
    extractEvents(
      parsed.data
    );

  const live:
    AnyObj[] = [];

  for (
    const event
    of events
  ) {
    if (
      isLive(event)
    ) {
      live.push(
        compactEvent(event)
      );
    }
  }

  return {
    request: {
      path,
      requests_made: 1,
      elapsed_ms:
        result.elapsedMs,
      http_status:
        result.response.status
    },

    events_received:
      events.length,

    events_recognized_live:
      live.length,

    events:
      live
  };
}


// ============================================================
// SEARCH
// ============================================================

function normalize(
  value: any
): string {

  return String(
    value ?? ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim();
}


function searchEvents(
  events: AnyObj[],
  query: string
): AnyObj[] {

  const q =
    normalize(query);

  if (!q) {
    return [];
  }

  return events.filter(
    event => {

      const home =
        normalize(
          event?.home
        );

      const away =
        normalize(
          event?.away
        );

      return (
        home.includes(q) ||
        away.includes(q) ||
        `${home} ${away}`
          .includes(q)
      );
    }
  );
}


// ============================================================
// DIRECT EVENT
// ============================================================

async function getEventDirect(
  env: Env,
  id: string
): Promise<AnyObj> {

  const eventId =
    String(id).trim();

  const path =
    "/events/" +
    encodeURIComponent(
      eventId
    );

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const parsed =
    await readResponse(
      result.response
    );

  const data =
    parsed.data;

  const event =
    data?.event &&
    typeof data.event ===
      "object"
      ? data.event
      : data &&
        typeof data ===
          "object" &&
        !Array.isArray(data)
      ? data
      : null;

  return {
    request: {
      path,

      requested_event_id:
        eventId,

      http_status:
        result.response.status,

      ok:
        result.response.ok,

      elapsed_ms:
        result.elapsedMs
    },

    found:
      result.response.ok &&
      !!event,

    event,

    raw:
      parsed.raw
  };
}


// ============================================================
// EXACT 1H OVER 0.5 TARGET
// ============================================================

function collectMatchingSelections(
  marketKey: string,
  market: AnyObj,
  require1h: boolean
): AnyObj[] {

  const results:
    AnyObj[] = [];

  const submarkets =
    market?.submarkets;

  if (
    !submarkets ||
    typeof submarkets !==
      "object"
  ) {
    return results;
  }

  for (
    const [
      submarketKey,
      submarket
    ]
    of Object.entries(
      submarkets
    )
  ) {

    if (
      require1h &&
      !String(
        submarketKey
      )
        .toLowerCase()
        .includes(
          "period=1h"
        )
    ) {
      continue;
    }

    const selections =
      Array.isArray(
        (submarket as AnyObj)
          ?.selections
      )
        ? (submarket as AnyObj)
            .selections
        : [];

    for (
      const selection
      of selections
    ) {

      if (
        String(
          selection?.outcome ??
          ""
        )
          .trim()
          .toLowerCase() !==
        "over"
      ) {
        continue;
      }

      const params =
        String(
          selection?.params ??
          ""
        )
          .trim()
          .toLowerCase();

      if (
        !params.includes(
          "total=0.5"
        )
      ) {
        continue;
      }

      const price =
        finiteNumber(
          selection?.price
        );

      const minStake =
        finiteNumber(
          selection?.minStake
        );

      const maxStake =
        finiteNumber(
          selection?.maxStake
        );

      const status =
        String(
          selection?.status ??
          ""
        )
          .trim()
          .toUpperCase();

      const statusEnabled =
        !status ||
        [
          "SELECTION_ENABLED",
          "OPEN",
          "TRADING",
          "ACTIVE"
        ].includes(
          status
        );

      const enabled =
        statusEnabled &&
        price !== null &&
        price > 1 &&
        (
          maxStake === null ||
          maxStake > 0
        );

      results.push({
        market:
          marketKey,

        submarket:
          submarketKey,

        outcome:
          selection?.outcome ??
          null,

        params:
          selection?.params ??
          null,

        marketUrl:
          selection?.marketUrl ??
          null,

        price,

        raw_price:
          selection?.price ??
          null,

        status:
          selection?.status ??
          null,

        minStake,

        maxStake,

        status_enabled:
          statusEnabled,

        enabled,

        target:
          true
      });
    }
  }

  return results;
}


function findExactTargets(
  event: AnyObj
): AnyObj[] {

  const markets =
    event?.markets;

  if (
    !markets ||
    typeof markets !==
      "object"
  ) {
    return [];
  }

  const candidates:
    AnyObj[] = [];

  const legacy =
    markets[
      "soccer.total_goals_period_first_half"
    ];

  if (
    legacy &&
    typeof legacy ===
      "object"
  ) {
    candidates.push(
      ...collectMatchingSelections(
        "soccer.total_goals_period_first_half",
        legacy,
        false
      )
    );
  }

  const generic =
    markets[
      "soccer.total_goals"
    ];

  if (
    generic &&
    typeof generic ===
      "object"
  ) {
    candidates.push(
      ...collectMatchingSelections(
        "soccer.total_goals",
        generic,
        true
      )
    );
  }

  return candidates;
}


function findExactTarget(
  event: AnyObj
): AnyObj | null {

  const candidates =
    findExactTargets(
      event
    );

  if (
    candidates.length ===
    0
  ) {
    return null;
  }

  // IMPORTANT:
  // Prefer an actually tradable target.
  // Older code returned the first matching legacy selection even
  // when it was disabled, which could hide an active generic 1H market.
  const active =
    candidates.find(
      candidate =>
        candidate?.enabled ===
        true
    );

  if (active) {
    return {
      ...active,
      selection_source:
        "ACTIVE_PREFERRED",
      candidates_checked:
        candidates.length
    };
  }

  // Diagnostic fallback only: return the best matching disabled selection.
  const fallback =
    candidates
      .slice()
      .sort(
        (a, b) => {
          const ap =
            finiteNumber(
              a?.price
            ) ?? 0;

          const bp =
            finiteNumber(
              b?.price
            ) ?? 0;

          const am =
            finiteNumber(
              a?.maxStake
            ) ?? 0;

          const bm =
            finiteNumber(
              b?.maxStake
            ) ?? 0;

          if (bp !== ap) {
            return bp - ap;
          }

          return bm - am;
        }
      )[0];

  return {
    ...fallback,
    selection_source:
      "DISABLED_DIAGNOSTIC_FALLBACK",
    candidates_checked:
      candidates.length
  };
}


// ============================================================
// LIVE LINE FETCH — OFFICIAL /v2/odds/lines
//
// Request body is officially:
// {
//   eventId,
//   marketUrl
// }
//
// This endpoint is used to obtain the latest available price/limits
// immediately before a possible bet.
// ============================================================

async function latestLineFetch(
  env: Env,
  eventId: string,
  marketUrl: string
): Promise<AnyObj> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        API_BASE +
        "/lines",
        {
          method:
            "POST",

          headers: {
            "accept":
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              apiKey(env)
          },

          body:
            JSON.stringify({
              eventId:
                String(
                  eventId
                ),

              marketUrl:
                String(
                  marketUrl
                )
            }),

          signal:
            controller.signal
        }
      );

    const parsed =
      await readResponse(
        response
      );

    const data =
      parsed.data;

    const status =
      String(
        data?.status ??
        ""
      )
        .trim()
        .toUpperCase();

    const price =
      finiteNumber(
        data?.price
      );

    const minStake =
      finiteNumber(
        data?.minStake ??
        data?.minRiskStake
      );

    const maxStake =
      finiteNumber(
        data?.maxStake ??
        data?.maxRiskStake
      );

    const successStatus =
      [
        "SUCCESS",
        "OK",
        "SELECTION_ENABLED",
        "ACTIVE",
        "TRADING"
      ].includes(
        status
      );

    const available =
      response.ok &&
      (
        successStatus ||
        (
          price !== null &&
          price > 1 &&
          (
            maxStake === null ||
            maxStake > 0
          )
        )
      );

    return {
      success:
        response.ok,

      available,

      request: {
        eventId:
          String(
            eventId
          ),

        marketUrl:
          String(
            marketUrl
          )
      },

      response: {
        status:
          response.status,

        ok:
          response.ok,

        elapsed_ms:
          Date.now() -
          started
      },

      line: {
        status:
          data?.status ??
          null,

        price,

        minStake,

        maxStake,

        lineId:
          data?.lineId ??
          null,

        altLineId:
          data?.altLineId ??
          null,

        effectiveAsOf:
          data?.effectiveAsOf ??
          null
      },

      data,

      raw:
        parsed.raw
    };

  } finally {
    clearTimeout(timer);
  }
}


async function lineTest(
  env: Env,
  eventId: string
): Promise<AnyObj> {

  return latestLineFetch(
    env,
    eventId,
    TARGET_MARKET_URL
  );
}


// ============================================================
// ACCOUNT TEST — REST API — READ ONLY
// Official flow:
// 1) GET /pub/v1/account/currencies
// 2) GET /pub/v1/account/currencies/{CURRENCY}/balance
// ============================================================

async function accountRestFetch(
  env: Env,
  path: string
): Promise<{
  response: Response;
  elapsedMs: number;
  data: any;
  raw: string | null;
}> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        ACCOUNT_API_BASE +
        path,
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              apiKey(env)
          },

          signal:
            controller.signal
        }
      );

    const parsed =
      await readResponse(
        response
      );

    return {
      response,

      elapsedMs:
        Date.now() -
        started,

      data:
        parsed.data,

      raw:
        parsed.raw
    };

  } finally {
    clearTimeout(timer);
  }
}


async function accountTest(
  env: Env
): Promise<AnyObj> {

  const key =
    apiKey(env);

  if (!key) {
    return {
      success:
        false,

      authenticated:
        false,

      read_only:
        true,

      betting:
        false,

      wager_sent:
        false,

      error:
        "CLOUDBET_API_KEY_MISSING"
    };
  }


  // ----------------------------------------------------------
  // STEP 1 — CURRENCIES
  // ----------------------------------------------------------

  const currenciesResult =
    await accountRestFetch(
      env,
      "/currencies"
    );

  const currenciesData =
    currenciesResult.data;

  const currencies =
    Array.isArray(
      currenciesData?.currencies
    )
      ? currenciesData.currencies
          .map(
            (value: any) =>
              String(value)
                .trim()
          )
          .filter(Boolean)
      : [];


  if (
    !currenciesResult.response.ok
  ) {

    return {
      success:
        false,

      authenticated:
        false,

      read_only:
        true,

      betting:
        false,

      wager_sent:
        false,

      endpoint:
        "REST_ACCOUNT_API",

      step:
        "CURRENCIES",

      response: {
        status:
          currenciesResult
            .response
            .status,

        elapsed_ms:
          currenciesResult
            .elapsedMs
      },

      currencies:
        [],

      balances:
        [],

      data:
        currenciesData,

      raw:
        currenciesResult.raw
    };
  }


  // ----------------------------------------------------------
  // STEP 2 — BALANCE FOR EACH CURRENCY
  // ----------------------------------------------------------

  const balances:
    AnyObj[] = [];

  for (
    const currency
    of currencies
  ) {

    const balanceResult =
      await accountRestFetch(
        env,
        "/currencies/" +
        encodeURIComponent(
          currency
        ) +
        "/balance"
      );

    const amount =
      balanceResult.data
        ?.amount ??
      null;

    balances.push({
      currency,

      success:
        balanceResult
          .response
          .ok,

      status:
        balanceResult
          .response
          .status,

      amount,

      elapsed_ms:
        balanceResult
          .elapsedMs,

      data:
        balanceResult.data,

      raw:
        balanceResult.raw
    });
  }


  const allBalancesOk =
    balances.every(
      item =>
        item.success === true
    );


  return {
    success:
      currenciesResult
        .response
        .ok &&
      allBalancesOk,

    authenticated:
      currenciesResult
        .response
        .ok,

    read_only:
      true,

    betting:
      false,

    wager_sent:
      false,

    endpoint:
      "REST_ACCOUNT_API",

    currencies_request: {
      status:
        currenciesResult
          .response
          .status,

      elapsed_ms:
        currenciesResult
          .elapsedMs
    },

    currencies,

    balances,

    summary: {
      currencies_count:
        currencies.length,

      balances_ok:
        balances.filter(
          item =>
            item.success === true
        ).length,

      balances_failed:
        balances.filter(
          item =>
            item.success !== true
        ).length
    }
  };
}


// ============================================================
// TRADING PREFLIGHT — NO WAGER IS SENT
//
// Checks the exact same data needed for a real single bet:
// - authenticated USDT account + balance
// - exact Cloudbet event
// - exact 1H Over 0.5 selection
// - current price
// - selection status
// - minStake / maxStake
// - requested test stake = 0.10 USDT
//
// IMPORTANT:
// This endpoint NEVER calls placeBet.
// ============================================================

const PREFLIGHT_CURRENCY =
  "USDT";

const PREFLIGHT_STAKE =
  0.10;


async function tradingPreflight(
  env: Env,
  eventId: string
): Promise<AnyObj> {

  const account =
    await accountTest(
      env
    );

  const balanceRow =
    Array.isArray(
      account?.balances
    )
      ? account.balances.find(
          (item: AnyObj) =>
            String(
              item?.currency ??
              ""
            )
              .trim()
              .toUpperCase() ===
            PREFLIGHT_CURRENCY
        )
      : null;

  const balance =
    finiteNumber(
      balanceRow?.amount ??
      balanceRow?.data?.amount
    );

  const eventResult =
    await getEventDirect(
      env,
      eventId
    );

  const targetCandidates =
    eventResult.event
      ? findExactTargets(
          eventResult.event
        )
      : [];

  const target =
    eventResult.event
      ? findExactTarget(
          eventResult.event
        )
      : null;

  const marketUrl =
    String(
      target?.marketUrl ??
      TARGET_MARKET_URL
    ).trim();

  const lineRefresh =
    eventResult.found &&
    marketUrl
      ? await latestLineFetch(
          env,
          eventId,
          marketUrl
        )
      : null;

  const eventPrice =
    finiteNumber(
      target?.price
    );

  const eventMinStake =
    finiteNumber(
      target?.minStake
    );

  const eventMaxStake =
    finiteNumber(
      target?.maxStake
    );

  const livePrice =
    finiteNumber(
      lineRefresh?.line
        ?.price
    );

  const liveMinStake =
    finiteNumber(
      lineRefresh?.line
        ?.minStake
    );

  const liveMaxStake =
    finiteNumber(
      lineRefresh?.line
        ?.maxStake
    );

  const effectivePrice =
    livePrice !== null &&
    livePrice > 0
      ? livePrice
      : eventPrice;

  const effectiveMinStake =
    liveMinStake !== null
      ? liveMinStake
      : eventMinStake;

  const effectiveMaxStake =
    liveMaxStake !== null
      ? liveMaxStake
      : eventMaxStake;

  const lineAvailable =
    lineRefresh?.available ===
    true;

  const eventSelectionEnabled =
    target?.enabled ===
    true;

  const checks = {
    api_authenticated:
      account?.authenticated ===
      true,

    currency_available:
      !!balanceRow,

    balance_readable:
      balance !== null,

    sufficient_balance:
      balance !== null &&
      balance >=
        PREFLIGHT_STAKE,

    event_found:
      eventResult.found ===
      true,

    exact_target_found:
      !!target,

    market_url_available:
      marketUrl.length > 0,

    live_line_request_ok:
      lineRefresh?.response
        ?.ok === true,

    live_line_available:
      lineAvailable,

    price_valid:
      effectivePrice !== null &&
      effectivePrice > 1,

    min_stake_ok:
      effectiveMinStake ===
        null ||
      PREFLIGHT_STAKE >=
        effectiveMinStake,

    max_stake_ok:
      effectiveMaxStake ===
        null ||
      PREFLIGHT_STAKE <=
        effectiveMaxStake
  };

  const failedChecks =
    Object.entries(
      checks
    )
      .filter(
        ([, value]) =>
          value !== true
      )
      .map(
        ([key]) =>
          key
      );

  const ready =
    failedChecks.length ===
    0;

  const referenceId =
    crypto.randomUUID();

  return {
    success:
      true,

    action:
      "TRADING_PREFLIGHT",

    ready_to_place_bet:
      ready,

    wager_sent:
      false,

    place_bet_called:
      false,

    read_only:
      true,

    requested_test: {
      currency:
        PREFLIGHT_CURRENCY,

      stake:
        PREFLIGHT_STAKE,

      event_id:
        String(
          eventId
        )
    },

    account: {
      authenticated:
        account?.authenticated ===
        true,

      currency:
        PREFLIGHT_CURRENCY,

      balance
    },

    event: {
      found:
        eventResult.found ===
        true,

      event_id:
        String(
          eventId
        ),

      home:
        eventResult.event
          ?.home?.name ??
        null,

      away:
        eventResult.event
          ?.away?.name ??
        null,

      status:
        eventResult.event
          ?.status ??
        null
    },

    selection_candidates:
      targetCandidates,

    selection_candidates_count:
      targetCandidates.length,

    event_selection: target
      ? {
          market:
            target.market ??
            null,

          submarket:
            target.submarket ??
            null,

          outcome:
            target.outcome ??
            null,

          params:
            target.params ??
            null,

          marketUrl:
            target.marketUrl ??
            null,

          price:
            eventPrice,

          status:
            target.status ??
            null,

          minStake:
            eventMinStake,

          maxStake:
            eventMaxStake,

          enabled:
            eventSelectionEnabled
        }
      : null,

    live_line_refresh:
      lineRefresh,

    effective_selection: {
      marketUrl,

      price:
        effectivePrice,

      minStake:
        effectiveMinStake,

      maxStake:
        effectiveMaxStake,

      source:
        lineAvailable
          ? "LIVE_LINE_ENDPOINT"
          : "EVENT_FALLBACK"
    },

    checks,

    failed_checks:
      failedChecks,

    would_send: ready
      ? {
          referenceId,

          eventId:
            String(
              eventId
            ),

          marketUrl,

          price:
            String(
              effectivePrice
            ),

          currency:
            PREFLIGHT_CURRENCY,

          stake:
            PREFLIGHT_STAKE
              .toFixed(2),

          note:
            "PREVIEW_ONLY_NOT_SENT"
        }
      : null
  };
}


// ============================================================
// TRADING ACCESS TEST — READ ONLY
//
// Official current v4 tracking endpoint:
// GET /pub/v4/bets
//
// Cloudbet states that a Trading API key is required for
// /pub/v4/bets. This function DOES NOT place a bet.
// ============================================================

async function tradingAccessTest(
  env: Env
): Promise<AnyObj> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        "https://sports-api.cloudbet.com/pub/v4/bets?limit=1&offset=0",
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              apiKey(env)
          },

          signal:
            controller.signal
        }
      );

    const parsed =
      await readResponse(
        response
      );

    const tradingAuthenticated =
      response.ok;

    return {
      success:
        response.ok,

      action:
        "TRADING_ACCESS_TEST",

      trading_authenticated:
        tradingAuthenticated,

      trading_api_access:
        tradingAuthenticated,

      read_only:
        true,

      betting:
        false,

      wager_sent:
        false,

      place_bet_called:
        false,

      endpoint:
        "/pub/v4/bets",

      response: {
        status:
          response.status,

        ok:
          response.ok,

        elapsed_ms:
          Date.now() -
          started
      },

      interpretation:
        response.ok
          ? "TRADING_API_KEY_CONFIRMED"
          : "TRADING_API_ACCESS_NOT_CONFIRMED",

      data:
        parsed.data,

      raw:
        parsed.raw
    };

  } finally {
    clearTimeout(timer);
  }
}


// ============================================================
// ALL LIVE LINE AUDIT — READ ONLY
//
// Fetches all current live soccer events and checks the exact
// 1H Over 0.5 line through /v2/odds/lines for each event.
//
// NO WAGER IS SENT.
// ============================================================

async function allLiveLineAudit(
  env: Env
): Promise<AnyObj> {

  const started =
    Date.now();

  // IMPORTANT:
  // getFastLive() returns compact events and intentionally removes markets.
  // For this audit we need RAW live events so findExactTarget() can inspect
  // the actual market tree.
  const livePath =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const liveResponse =
    await cloudbetFetch(
      env,
      livePath
    );

  if (
    !liveResponse.response.ok
  ) {
    const body =
      await liveResponse.response
        .text();

    throw new Error(
      "CLOUDBET_LIVE_HTTP_" +
      liveResponse.response.status +
      ": " +
      body.slice(0, 300)
    );
  }

  const liveParsed =
    await readResponse(
      liveResponse.response
    );

  const allEvents =
    extractEvents(
      liveParsed.data
    );

  const liveEvents =
    allEvents.filter(
      event =>
        isLive(event)
    );

  const results:
    AnyObj[] = [];

  let enabledCount = 0;
  let disabledCount = 0;
  let missingTargetCount = 0;
  let lineErrorCount = 0;
  let directEventFallbacks = 0;

  for (
    const rawEvent
    of liveEvents
  ) {

    const eventId =
      String(
        rawEvent?.id ??
        rawEvent?.eventId ??
        ""
      ).trim();

    if (!eventId) {
      continue;
    }

    let event =
      rawEvent;

    let target =
      findExactTarget(
        event
      );

    // Some /events responses can be compact depending on API behavior.
    // If the market tree is missing, fetch the SAME event directly once.
    if (!target) {

      try {

        const direct =
          await getEventDirect(
            env,
            eventId
          );

        if (
          direct?.found &&
          direct?.event
        ) {
          directEventFallbacks++;
          event =
            direct.event;

          target =
            findExactTarget(
              event
            );
        }

      } catch {
        // Keep audit running. Missing target will be reported below.
      }
    }

    const home =
      event?.home?.name ??
      rawEvent?.home?.name ??
      rawEvent?.home ??
      null;

    const away =
      event?.away?.name ??
      rawEvent?.away?.name ??
      rawEvent?.away ??
      null;

    if (!target) {

      missingTargetCount++;

      results.push({
        event_id:
          eventId,

        home,

        away,

        event_status:
          event?.status ??
          rawEvent?.status ??
          null,

        target_found:
          false,

        line_checked:
          false,

        status:
          "TARGET_NOT_FOUND",

        price:
          null,

        minStake:
          null,

        maxStake:
          null
      });

      continue;
    }

    const marketUrl =
      String(
        target?.marketUrl ??
        TARGET_MARKET_URL
      ).trim();

    try {

      const line =
        await latestLineFetch(
          env,
          eventId,
          marketUrl
        );

      const enabled =
        line?.available ===
        true;

      if (enabled) {
        enabledCount++;
      } else {
        disabledCount++;
      }

      results.push({
        event_id:
          eventId,

        home,

        away,

        event_status:
          event?.status ??
          rawEvent?.status ??
          null,

        target_found:
          true,

        line_checked:
          true,

        market:
          target?.market ??
          null,

        marketUrl,

        event_selection_status:
          target?.status ??
          null,

        event_selection_price:
          finiteNumber(
            target?.price
          ),

        event_selection_minStake:
          finiteNumber(
            target?.minStake
          ),

        event_selection_maxStake:
          finiteNumber(
            target?.maxStake
          ),

        status:
          line?.line?.status ??
          null,

        available:
          enabled,

        price:
          finiteNumber(
            line?.line?.price
          ),

        minStake:
          finiteNumber(
            line?.line?.minStake
          ),

        maxStake:
          finiteNumber(
            line?.line?.maxStake
          ),

        http_status:
          line?.response?.status ??
          null
      });

    } catch (
      error
    ) {

      lineErrorCount++;

      results.push({
        event_id:
          eventId,

        home,

        away,

        event_status:
          event?.status ??
          rawEvent?.status ??
          null,

        target_found:
          true,

        line_checked:
          false,

        marketUrl,

        status:
          "LINE_FETCH_ERROR",

        error:
          error instanceof Error
            ? error.message
            : String(error)
      });
    }
  }

  const checkedLines =
    enabledCount +
    disabledCount;

  return {
    success:
      true,

    action:
      "ALL_LIVE_LINE_AUDIT",

    read_only:
      true,

    wager_sent:
      false,

    betting:
      false,

    source: {
      live_path:
        livePath,

      live_http_status:
        liveResponse.response
          .status,

      events_received:
        allEvents.length,

      live_events:
        liveEvents.length,

      direct_event_fallbacks:
        directEventFallbacks
    },

    summary: {
      live_events:
        liveEvents.length,

      checked:
        results.length,

      lines_checked:
        checkedLines,

      enabled:
        enabledCount,

      disabled:
        disabledCount,

      target_not_found:
        missingTargetCount,

      line_errors:
        lineErrorCount,

      enabled_percent_of_checked_lines:
        checkedLines
          ? Math.round(
              enabledCount /
              checkedLines *
              1000
            ) / 10
          : 0,

      elapsed_ms:
        Date.now() -
        started
    },

    results
  };
}


// ============================================================
// MAIN
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


    // ========================================================
    // ROOT
    // ========================================================

    if (
      path ===
      "/"
    ) {

      return json({
        success:
          true,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        mode:
          "READ_ONLY",

        betting:
          false,

        fast_live:
          true,

        endpoints: [
          "/live",
          "/search?q=TEAM",
          "/event?id=EVENT_ID",
          "/event-direct?id=EVENT_ID",
          "/line-test?id=EVENT_ID",
          "/account-test",
          "/trading-preflight?id=EVENT_ID",
          "/trading-access-test",
          "/all-live-line-audit"
        ]
      });
    }


    // ========================================================
    // FAST LIVE
    // ========================================================

    if (
      path ===
      "/live"
    ) {

      const started =
        Date.now();

      try {

        const result =
          await getFastLive(
            env
          );

        return json({
          success:
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "LIVE",

          read_only:
            true,

          betting:
            false,

          fast_mode:
            true,

          market_scan:
            false,

          ...result,

          performance: {
            total_elapsed_ms:
              Date.now() -
              started
          }
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "LIVE",

            fast_mode:
              true,

            error:
              error instanceof Error
                ? error.message
                : String(error),

            performance: {
              total_elapsed_ms:
                Date.now() -
                started
            }
          },
          500
        );
      }
    }


    // ========================================================
    // SEARCH
    // ========================================================

    if (
      path ===
      "/search"
    ) {

      const q =
        url.searchParams
          .get("q") ??
        "";

      try {

        const live =
          await getFastLive(
            env
          );

        return json({
          success:
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "SEARCH",

          query:
            q,

          events_received:
            live.events_received,

          events_recognized_live:
            live.events_recognized_live,

          results:
            searchEvents(
              live.events,
              q
            )
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "SEARCH",

            query:
              q,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // EVENT
    // ========================================================

    if (
      path ===
        "/event" ||
      path ===
        "/event-direct"
    ) {

      const id =
        url.searchParams
          .get("id");

      if (!id) {
        return json(
          {
            success:
              false,

            error:
              "Missing id"
          },
          400
        );
      }

      try {

        const result =
          await getEventDirect(
            env,
            id
          );

        const target =
          result.event
            ? findExactTarget(
                result.event
              )
            : null;

        const targetCandidates =
          result.event
            ? findExactTargets(
                result.event
              )
            : [];

        return json({
          success:
            result.found,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            path ===
              "/event"
              ? "EVENT"
              : "EVENT_DIRECT",

          read_only:
            true,

          betting:
            false,

          ...result,

          target,

          target_candidates:
            targetCandidates,

          target_candidates_count:
            targetCandidates.length,

          target_available:
            !!target
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "EVENT",

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // LINE TEST
    // ========================================================

    if (
      path ===
      "/line-test"
    ) {

      const id =
        url.searchParams
          .get("id");

      if (!id) {
        return json(
          {
            success:
              false,

            error:
              "Missing id"
          },
          400
        );
      }

      try {

        const result =
          await lineTest(
            env,
            id
          );

        return json({
          success:
            result.success,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "LINE_TEST",

          read_only:
            true,

          betting:
            false,

          target: {
            event_id:
              id,

            market:
              TARGET_MARKET,

            outcome:
              "over",

            params:
              "total=0.5",

            marketUrl:
              TARGET_MARKET_URL
          },

          line:
            result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "LINE_TEST",

            read_only:
              true,

            betting:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // ACCOUNT TEST
    // ========================================================

    if (
      path ===
      "/account-test"
    ) {

      try {

        const result =
          await accountTest(
            env
          );

        return json({
          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "ACCOUNT_TEST",

          ...result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "ACCOUNT_TEST",

            read_only:
              true,

            betting:
              false,

            wager_sent:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // TRADING PREFLIGHT — NO BET PLACEMENT
    // ========================================================

    if (
      path ===
      "/trading-preflight"
    ) {

      const id =
        url.searchParams
          .get("id");

      if (!id) {
        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "TRADING_PREFLIGHT",

            ready_to_place_bet:
              false,

            wager_sent:
              false,

            place_bet_called:
              false,

            error:
              "Missing id"
          },
          400
        );
      }

      try {

        const result =
          await tradingPreflight(
            env,
            id
          );

        return json({
          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          ...result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "TRADING_PREFLIGHT",

            ready_to_place_bet:
              false,

            wager_sent:
              false,

            place_bet_called:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // TRADING ACCESS TEST — READ ONLY
    // ========================================================

    if (
      path ===
      "/trading-access-test"
    ) {

      try {

        const result =
          await tradingAccessTest(
            env
          );

        return json({
          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          ...result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "TRADING_ACCESS_TEST",

            trading_authenticated:
              false,

            trading_api_access:
              false,

            read_only:
              true,

            betting:
              false,

            wager_sent:
              false,

            place_bet_called:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // ALL LIVE LINE AUDIT — READ ONLY
    // ========================================================

    if (
      path ===
      "/all-live-line-audit"
    ) {

      try {

        const result =
          await allLiveLineAudit(
            env
          );

        return json({
          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          ...result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "ALL_LIVE_LINE_AUDIT",

            read_only:
              true,

            wager_sent:
              false,

            betting:
              false,

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }


    // ========================================================
    // NOT FOUND
    // ========================================================

    return json(
      {
        success:
          false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        error:
          "Not found",

        path
      },
      404
    );
  }
};
