// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.9.2 — FAST LIVE + REST ACCOUNT TEST
//
// EXISTING PURPOSE:
// - fast /live for matcher
// - ONE official Cloudbet request
// - NO market scanning in /live
// - compact event objects only
// - /event uses direct event endpoint
// - /line-test preserved for diagnostics
//
// V5.9.2:
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

const VERSION = "V5.9.2 FAST LIVE + REST ACCOUNT TEST";

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

function inspectSelections(
  marketKey: string,
  market: AnyObj,
  require1h: boolean
): AnyObj | null {

  const submarkets =
    market?.submarkets;

  if (
    !submarkets ||
    typeof submarkets !==
      "object"
  ) {
    return null;
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

      const enabled =
        !status ||
        [
          "SELECTION_ENABLED",
          "OPEN",
          "TRADING",
          "ACTIVE"
        ].includes(status);

      return {
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

        maxStake,

        enabled:
          enabled &&
          price !== null &&
          price > 1 &&
          (
            maxStake === null ||
            maxStake > 0
          ),

        target:
          true
      };
    }
  }

  return null;
}


function findExactTarget(
  event: AnyObj
): AnyObj | null {

  const markets =
    event?.markets;

  if (
    !markets ||
    typeof markets !==
      "object"
  ) {
    return null;
  }

  const legacy =
    markets[
      "soccer.total_goals_period_first_half"
    ];

  if (
    legacy &&
    typeof legacy ===
      "object"
  ) {
    const found =
      inspectSelections(
        "soccer.total_goals_period_first_half",
        legacy,
        false
      );

    if (found) {
      return found;
    }
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
    const found =
      inspectSelections(
        "soccer.total_goals",
        generic,
        true
      );

    if (found) {
      return found;
    }
  }

  return null;
}


// ============================================================
// LEGACY LINE TEST
// Kept only so the existing endpoint is not removed.
// Previous test showed this path returns 404 from Cloudbet.
// ============================================================

async function lineTest(
  env: Env,
  eventId: string
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
                TARGET_MARKET_URL
            }),

          signal:
            controller.signal
        }
      );

    const parsed =
      await readResponse(
        response
      );

    return {
      success:
        response.ok,

      response: {
        status:
          response.status,

        elapsed_ms:
          Date.now() -
          started
      },

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
          "/account-test"
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
