// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR
// V5.8.7
//
// READ ONLY
// NO BETTING
//
// V5.8.7:
// - /event-direct?id=EVENT_ID
// - Direct GET test:
//   /pub/v2/odds/events/{EVENT_ID}
// - Router for /event-direct FIXED
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

type AnyObj = Record<string, any>;

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const VERSION =
  "V5.8.7";

const CLOUDBET_TIMEOUT_MS =
  8000;

const CLOUD0007_URL =
  "https://www.cloud0007.com/en/sports/live?s=soccer";

const CLOUD0007_ORIGIN =
  "https://www.cloud0007.com";

const CLOUD0007_PAGE_TIMEOUT_MS =
  10000;

const CLOUD0007_JS_TIMEOUT_MS =
  7000;

const CLOUD0007_JS_CONCURRENCY =
  6;


// ============================================================
// TARGET
// ============================================================

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

const TARGET_MARKET_URL =
  "soccer.total_goals_period_first_half/over?total=0.5";


// ============================================================
// JSON
// ============================================================

function json(
  data: AnyObj,
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
          "no-store",
      },
    }
  );
}


// ============================================================
// TIMEOUT FETCH
// ============================================================

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = CLOUDBET_TIMEOUT_MS
): Promise<Response> {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {

    return await fetch(
      url,
      {
        ...init,
        signal: controller.signal,
      }
    );

  } finally {

    clearTimeout(timer);

  }
}


// ============================================================
// CLOUDBET GET
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string
): Promise<{
  response: Response;
  elapsedMs: number;
}> {

  const started =
    Date.now();

  const response =
    await fetchWithTimeout(
      `${API_BASE}${path}`,
      {
        method: "GET",

        headers: {
          accept:
            "application/json",

          "x-api-key":
            env.CLOUDBET_API_KEY || "",
        },
      }
    );

  return {
    response,
    elapsedMs:
      Date.now() - started,
  };
}


// ============================================================
// SAFE JSON
// ============================================================

async function parseJSON(
  response: Response
): Promise<any> {

  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {

    return JSON.parse(text);

  } catch {

    return null;

  }
}


// ============================================================
// EVENTS EXTRACTION
// ============================================================

function extractEvents(
  data: any
): AnyObj[] {

  if (
    data &&
    Array.isArray(data.competitions)
  ) {

    const result: AnyObj[] =
      [];

    for (
      const competition
      of data.competitions
    ) {

      if (
        !competition ||
        !Array.isArray(
          competition.events
        )
      ) {
        continue;
      }

      for (
        const event
        of competition.events
      ) {

        if (
          event &&
          typeof event === "object"
        ) {

          result.push({

            ...event,

            competition:
              event.competition ??
              {
                name:
                  competition.name ??
                  null,

                key:
                  competition.key ??
                  null,

                category:
                  competition.category ??
                  null,
              },

          });

        }

      }

    }

    return result;
  }


  if (
    data &&
    Array.isArray(data.events)
  ) {

    return data.events.filter(
      (event: any) =>
        event &&
        typeof event === "object"
    );

  }


  if (Array.isArray(data)) {

    return data.filter(
      (event: any) =>
        event &&
        typeof event === "object"
    );

  }


  return [];
}


// ============================================================
// LIVE
// ============================================================

function isLiveEvent(
  event: AnyObj
): boolean {

  const status =
    String(
      event?.status ?? ""
    )
      .trim()
      .toUpperCase();

  return (
    status === "TRADING_LIVE" ||
    status === "LIVE" ||
    status.includes("LIVE")
  );
}


// ============================================================
// NUMBER
// ============================================================

function finiteNumber(
  value: any
): number | null {

  const n =
    Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


// ============================================================
// TARGET SELECTION
// ============================================================

function findTargetSelection(
  event: AnyObj
): AnyObj | null {

  const markets =
    event?.markets;

  if (
    !markets ||
    typeof markets !== "object"
  ) {
    return null;
  }


  const market =
    markets[TARGET_MARKET];

  if (
    !market ||
    typeof market !== "object"
  ) {
    return null;
  }


  const submarkets =
    market.submarkets;

  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {
    return null;
  }


  const submarket =
    submarkets[TARGET_SUBMARKET];

  if (
    !submarket ||
    typeof submarket !== "object"
  ) {
    return null;
  }


  const selections =
    Array.isArray(
      submarket.selections
    )
      ? submarket.selections
      : [];


  for (
    const selection
    of selections
  ) {

    if (
      selection?.outcome !==
      TARGET_OUTCOME
    ) {
      continue;
    }


    if (
      selection?.params !==
      TARGET_PARAMS
    ) {
      continue;
    }


    const status =
      String(
        selection?.status ?? ""
      )
        .trim()
        .toUpperCase();


    if (
      status &&
      ![
        "SELECTION_ENABLED",
        "OPEN",
        "TRADING",
        "ACTIVE",
      ].includes(status)
    ) {
      continue;
    }


    const price =
      finiteNumber(
        selection?.price
      );


    if (
      price === null ||
      price <= 1
    ) {
      continue;
    }


    const maxStake =
      finiteNumber(
        selection?.maxStake
      );


    if (
      maxStake !== null &&
      maxStake <= 0
    ) {
      continue;
    }


    return {

      ...selection,

      target:
        true,

      target_market:
        TARGET_MARKET,

      target_submarket:
        TARGET_SUBMARKET,

      target_outcome:
        TARGET_OUTCOME,

      target_params:
        TARGET_PARAMS,

    };

  }


  return null;
}


// ============================================================
// TARGET DIAGNOSTIC
// ============================================================

function diagnoseTargetMarket(
  event: AnyObj
): AnyObj {

  const result: AnyObj = {

    event_id:
      event?.id ?? null,

    home:
      event?.home?.name ??
      null,

    away:
      event?.away?.name ??
      null,

    status:
      event?.status ??
      null,

    target_market:
      TARGET_MARKET,

    target_submarket:
      TARGET_SUBMARKET,

    target_outcome:
      TARGET_OUTCOME,

    target_params:
      TARGET_PARAMS,

    market_exists:
      false,

    submarket_exists:
      false,

    selections:
      [],

    exact_target_found:
      false,

    exact_target_enabled:
      false,

    exact_target_price:
      null,

    exact_target_maxStake:
      null,

    reason:
      null,

  };


  const markets =
    event?.markets;


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    result.reason =
      "NO_MARKETS_OBJECT";

    return result;
  }


  const market =
    markets[TARGET_MARKET];


  if (
    !market ||
    typeof market !== "object"
  ) {

    result.reason =
      "TARGET_MARKET_NOT_PRESENT";

    result.available_markets =
      Object.keys(markets);

    return result;
  }


  result.market_exists =
    true;


  const submarkets =
    market.submarkets;


  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    result.reason =
      "NO_SUBMARKETS_OBJECT";

    return result;
  }


  const submarket =
    submarkets[
      TARGET_SUBMARKET
    ];


  if (
    !submarket ||
    typeof submarket !== "object"
  ) {

    result.reason =
      "TARGET_SUBMARKET_NOT_PRESENT";

    result.available_submarkets =
      Object.keys(submarkets);

    return result;
  }


  result.submarket_exists =
    true;


  const selections =
    Array.isArray(
      submarket.selections
    )
      ? submarket.selections
      : [];


  result.selections =
    selections.map(
      (selection: AnyObj) => {

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
            selection?.status ?? ""
          )
            .trim()
            .toUpperCase();


        const exactOutcome =
          selection?.outcome ===
          TARGET_OUTCOME;


        const exactParams =
          selection?.params ===
          TARGET_PARAMS;


        const exact =
          exactOutcome &&
          exactParams;


        const enabledStatus =
          !status ||
          [
            "SELECTION_ENABLED",
            "OPEN",
            "TRADING",
            "ACTIVE",
          ].includes(status);


        return {

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

          raw_maxStake:
            selection?.maxStake ??
            null,

          side:
            selection?.side ??
            null,

          exact_outcome:
            exactOutcome,

          exact_params:
            exactParams,

          exact_target:
            exact,

          enabled_status:
            enabledStatus,

          valid_price:
            price !== null &&
            price > 1,

          valid_maxStake:
            maxStake === null ||
            maxStake > 0,

          fully_usable:
            exact &&
            enabledStatus &&
            price !== null &&
            price > 1 &&
            (
              maxStake === null ||
              maxStake > 0
            ),

        };

      }
    );


  const exactSelection =
    selections.find(
      (selection: AnyObj) =>
        selection?.outcome ===
          TARGET_OUTCOME &&
        selection?.params ===
          TARGET_PARAMS
    );


  if (!exactSelection) {

    result.reason =
      "TARGET_SELECTION_NOT_PRESENT";

    return result;
  }


  result.exact_target_found =
    true;


  const price =
    finiteNumber(
      exactSelection?.price
    );


  const maxStake =
    finiteNumber(
      exactSelection?.maxStake
    );


  const status =
    String(
      exactSelection?.status ?? ""
    )
      .trim()
      .toUpperCase();


  result.exact_target_price =
    price;

  result.exact_target_maxStake =
    maxStake;

  result.exact_target_status =
    exactSelection?.status ??
    null;


  const enabledStatus =
    !status ||
    [
      "SELECTION_ENABLED",
      "OPEN",
      "TRADING",
      "ACTIVE",
    ].includes(status);


  const enabled =
    enabledStatus &&
    price !== null &&
    price > 1 &&
    (
      maxStake === null ||
      maxStake > 0
    );


  result.exact_target_enabled =
    enabled;


  if (enabled) {

    result.reason =
      "TARGET_READY";

  } else if (!enabledStatus) {

    result.reason =
      `TARGET_STATUS_${status}`;

  } else if (
    price === null ||
    price <= 1
  ) {

    result.reason =
      "TARGET_BAD_PRICE";

  } else if (
    maxStake !== null &&
    maxStake <= 0
  ) {

    result.reason =
      "TARGET_MAXSTAKE_ZERO";

  } else {

    result.reason =
      "TARGET_NOT_ACCEPTABLE";

  }


  return result;
}


// ============================================================
// BUILD LIVE MATCH
// ============================================================

function buildLiveMatch(
  event: AnyObj
): AnyObj {

  const target =
    findTargetSelection(event);


  return {

    id:
      event?.id ?? null,

    event_id:
      event?.id ?? null,

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
      event?.competition ??
      null,

    target_1h_over_05:
      target,

    target_price:
      target?.price ??
      null,

    target_available:
      !!target,

  };
}


// ============================================================
// LIVE EVENTS
// ============================================================

async function getLiveSoccerEvents(
  env: Env
): Promise<AnyObj> {

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";


  const result =
    await cloudbetFetch(
      env,
      path
    );


  const data =
    await parseJSON(
      result.response
    );


  const events =
    extractEvents(data);


  const liveEvents =
    events.filter(
      isLiveEvent
    );


  const targetEvents =
    liveEvents.filter(
      event =>
        !!findTargetSelection(
          event
        )
    );


  return {

    request: {

      path,

      requests_made:
        1,

      elapsed_ms:
        result.elapsedMs,

      http_status:
        result.response.status,

    },

    events_received:
      events.length,

    events_recognized_live:
      liveEvents.length,

    target_1h_over_05_found:
      targetEvents.length,

    events:
      liveEvents.map(
        buildLiveMatch
      ),

  };
}


// ============================================================
// NORMALIZE
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


// ============================================================
// SEARCH
// ============================================================

function searchEvents(
  events: AnyObj[],
  query: string
): AnyObj[] {

  const q =
    normalize(query);

  if (!q) {
    return [];
  }


  return events
    .filter(
      event => {

        const home =
          normalize(
            event?.home?.name
          );

        const away =
          normalize(
            event?.away?.name
          );

        const full =
          `${home} ${away}`;


        return (
          full.includes(q) ||
          home.includes(q) ||
          away.includes(q)
        );

      }
    )
    .map(
      buildLiveMatch
    );
}


// ============================================================
// EVENT FROM LIVE FEED
// ============================================================

async function getEvent(
  env: Env,
  id: string
): Promise<AnyObj> {

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";


  const result =
    await cloudbetFetch(
      env,
      path
    );


  const data =
    await parseJSON(
      result.response
    );


  const events =
    extractEvents(data);


  const targetId =
    String(id).trim();


  const event =
    events.find(
      (item: AnyObj) =>
        String(
          item?.id ?? ""
        ).trim() ===
        targetId
    ) ?? null;


  if (!event) {

    return {

      request: {

        path,

        requested_event_id:
          targetId,

        lookup:
          "LIVE_EVENTS_BY_ID",

        events_received:
          events.length,

        elapsed_ms:
          result.elapsedMs,

        http_status:
          result.response.status,

      },

      found:
        false,

      event:
        null,

      target:
        null,

      error:
        "EVENT_NOT_FOUND_IN_LIVE_EVENTS",

    };

  }


  return {

    request: {

      path,

      requested_event_id:
        targetId,

      lookup:
        "LIVE_EVENTS_BY_ID",

      events_received:
        events.length,

      elapsed_ms:
        result.elapsedMs,

      http_status:
        result.response.status,

    },

    found:
      true,

    event,

    target:
      findTargetSelection(event),

    target_diagnostic:
      diagnoseTargetMarket(event),

  };
}


// ============================================================
// DIRECT EVENT LOOKUP
// V5.8.7
// ============================================================

async function getEventDirect(
  env: Env,
  id: string
): Promise<AnyObj> {

  const targetId =
    String(id).trim();


  const path =
    `/events/${encodeURIComponent(
      targetId
    )}`;


  const result =
    await cloudbetFetch(
      env,
      path
    );


  const raw =
    await result.response.text();


  let data: any =
    null;


  try {

    data =
      raw
        ? JSON.parse(raw)
        : null;

  } catch {

    data =
      null;

  }


  const event =
    data?.event &&
    typeof data.event === "object"
      ? data.event

      : data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        (
          data.id !== undefined ||
          data.home !== undefined ||
          data.away !== undefined ||
          data.markets !== undefined
        )
      ? data

      : null;


  return {

    request: {

      method:
        "GET",

      path,

      full_url:
        `${API_BASE}${path}`,

      requested_event_id:
        targetId,

      http_status:
        result.response.status,

      ok:
        result.response.ok,

      elapsed_ms:
        result.elapsedMs,

      content_type:
        result.response.headers.get(
          "content-type"
        ),

    },

    found:
      result.response.ok &&
      !!event,

    event,

    target:
      event
        ? findTargetSelection(event)
        : null,

    target_diagnostic:
      event
        ? diagnoseTargetMarket(event)
        : null,

    response_data:
      data,

    raw:
      data === null
        ? raw.slice(0, 5000)
        : null,

  };
}


// ============================================================
// LINE TEST
// ============================================================

async function fetchTargetLine(
  env: Env,
  eventId: string
): Promise<AnyObj> {

  const started =
    Date.now();


  const url =
    `${API_BASE}/lines`;


  const body = {

    eventId:
      String(eventId),

    marketUrl:
      TARGET_MARKET_URL,

  };


  try {

    const response =
      await fetchWithTimeout(
        url,
        {
          method:
            "POST",

          headers: {

            accept:
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              "",

          },

          body:
            JSON.stringify(body),

        }
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

      data =
        null;

    }


    return {

      success:
        response.ok,

      request: {

        method:
          "POST",

        endpoint:
          "/lines",

        eventId:
          String(eventId),

        marketUrl:
          TARGET_MARKET_URL,

      },

      response: {

        status:
          response.status,

        ok:
          response.ok,

        elapsed_ms:
          Date.now() -
          started,

        content_type:
          response.headers.get(
            "content-type"
          ),

      },

      data,

      raw:
        data === null
          ? text.slice(0, 3000)
          : null,

    };

  } catch (error) {

    return {

      success:
        false,

      error:
        error instanceof Error
          ? error.message
          : String(error),

      response: {

        status:
          0,

        elapsed_ms:
          Date.now() -
          started,

      },

    };

  }
}


// ============================================================
// AUTHENTICATED GET
// ============================================================

async function authenticatedCloudbetGet(
  env: Env,
  fullUrl: string
): Promise<AnyObj> {

  const started =
    Date.now();


  try {

    const response =
      await fetchWithTimeout(
        fullUrl,
        {
          method:
            "GET",

          headers: {

            accept:
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              "",

          },

        }
      );


    const raw =
      await response.text();


    let data: any =
      null;


    try {

      data =
        raw
          ? JSON.parse(raw)
          : null;

    } catch {

      data =
        null;

    }


    return {

      ok:
        response.ok,

      status:
        response.status,

      elapsed_ms:
        Date.now() -
        started,

      content_type:
        response.headers.get(
          "content-type"
        ),

      data,

      raw:
        data === null
          ? raw.slice(0, 2000)
          : null,

    };

  } catch (error) {

    return {

      ok:
        false,

      status:
        0,

      elapsed_ms:
        Date.now() -
        started,

      error:
        error instanceof Error
          ? error.message
          : String(error),

    };

  }
}


// ============================================================
// AUTHENTICATED POST
// ============================================================

async function authenticatedCloudbetPost(
  env: Env,
  fullUrl: string,
  body: any = {}
): Promise<AnyObj> {

  const started =
    Date.now();


  try {

    const response =
      await fetchWithTimeout(
        fullUrl,
        {

          method:
            "POST",

          headers: {

            accept:
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              "",

          },

          body:
            JSON.stringify(body),

        }
      );


    const raw =
      await response.text();


    let data: any =
      null;


    try {

      data =
        raw
          ? JSON.parse(raw)
          : null;

    } catch {

      data =
        null;

    }


    return {

      ok:
        response.ok,

      status:
        response.status,

      elapsed_ms:
        Date.now() -
        started,

      data,

      raw:
        data === null
          ? raw.slice(0, 2000)
          : null,

    };

  } catch (error) {

    return {

      ok:
        false,

      status:
        0,

      elapsed_ms:
        Date.now() -
        started,

      error:
        error instanceof Error
          ? error.message
          : String(error),

    };

  }
}


// ============================================================
// TRADING CHECK
// ============================================================

async function tradingAccessCheck(
  env: Env
): Promise<Response> {

  const started =
    Date.now();


  const currenciesUrl =
    "https://sports-api.cloudbet.com/pub/v1/account/currencies";


  const balanceUrl =
    "https://sports-api.cloudbet.com/pub/v1/account/currencies/USDT/balance";


  const historyV3Url =
    "https://sports-api.cloudbet.com/pub/v3/bets/history?limit=1&offset=0";


  const [
    currencies,
    balance,
    historyV3
  ] =
    await Promise.all([

      authenticatedCloudbetGet(
        env,
        currenciesUrl
      ),

      authenticatedCloudbetGet(
        env,
        balanceUrl
      ),

      authenticatedCloudbetPost(
        env,
        historyV3Url,
        {}
      ),

    ]);


  const currenciesAuthenticated =
    currencies.status === 200;


  const balanceAuthenticated =
    balance.status === 200;


  const historyV3Authenticated =
    historyV3.status === 200;


  const availableCurrencies =
    Array.isArray(
      currencies?.data?.currencies
    )
      ? currencies.data.currencies
      : [];


  return json({

    success:
      currenciesAuthenticated ||
      balanceAuthenticated ||
      historyV3Authenticated,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "TRADING_CHECK",

    read_only:
      true,

    betting:
      false,

    api_key_present:
      !!env.CLOUDBET_API_KEY,

    checks: {

      account_currencies: {

        status:
          currencies.status,

        ok:
          currencies.ok,

        currencies:
          availableCurrencies,

        response:
          currencies.data ??
          currencies.raw ??
          null,

      },


      account_balance_usdt: {

        status:
          balance.status,

        ok:
          balance.ok,

        response:
          balance.data ??
          balance.raw ??
          null,

      },


      trading_history_v3: {

        method:
          "POST",

        status:
          historyV3.status,

        ok:
          historyV3.ok,

        response:
          historyV3.data ??
          historyV3.raw ??
          null,

      },

    },


    summary: {

      account_api_authenticated:
        currenciesAuthenticated ||
        balanceAuthenticated,

      balance_ok:
        balanceAuthenticated,

      trading_history_ok:
        historyV3Authenticated,

    },


    performance: {

      total_elapsed_ms:
        Date.now() -
        started,

    },

  });
}


// ============================================================
// TARGET MARKET DIAGNOSTIC
// ============================================================

async function diagnosticTargetMarket(
  env: Env
): Promise<Response> {

  const started =
    Date.now();


  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";


  const result =
    await cloudbetFetch(
      env,
      path
    );


  const data =
    await parseJSON(
      result.response
    );


  const events =
    extractEvents(data);


  const liveEvents =
    events.filter(
      isLiveEvent
    );


  const diagnostics =
    liveEvents.map(
      diagnoseTargetMarket
    );


  return json({

    success:
      true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_TARGET_MARKET",

    read_only:
      true,

    betting:
      false,

    summary: {

      events_received:
        events.length,

      live_events:
        liveEvents.length,

      market_present:
        diagnostics.filter(
          x => x.market_exists
        ).length,

      submarket_present:
        diagnostics.filter(
          x => x.submarket_exists
        ).length,

      exact_target_present:
        diagnostics.filter(
          x =>
            x.exact_target_found
        ).length,

      exact_target_enabled:
        diagnostics.filter(
          x =>
            x.exact_target_enabled
        ).length,

    },

    events:
      diagnostics,

    performance: {

      total_elapsed_ms:
        Date.now() -
        started,

    },

  });
}


// ============================================================
// GRAPHQL
// ============================================================

const CLOUDBET_GRAPHQL_URL =
  "https://sports-api-graphql.cloudbet.com/graphql";


async function graphqlSingleCheck(
  env: Env,
  kind: "account" | "bets"
): Promise<Response> {

  const started =
    Date.now();


  const query =
    kind === "account"

      ? `
        query AccountBalances {
          accountBalances {
            currency
            amount
          }
        }
      `

      : `
        query Bets($limit: Int) {
          bets(limit: $limit) {
            referenceId
            categoryKey
            sportsKey
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

    const response =
      await fetchWithTimeout(
        CLOUDBET_GRAPHQL_URL,
        {

          method:
            "POST",

          headers: {

            accept:
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              "",

          },

          body:
            JSON.stringify({

              query,

              variables:
                kind === "bets"
                  ? { limit: 1 }
                  : undefined,

            }),

        }
      );


    const raw =
      await response.text();


    let data: any =
      null;


    try {

      data =
        raw
          ? JSON.parse(raw)
          : null;

    } catch {

      data =
        null;

    }


    return json({

      success:
        response.ok,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        kind === "account"
          ? "GRAPHQL_ACCOUNT_CHECK"
          : "GRAPHQL_BETS_CHECK",

      read_only:
        true,

      betting:
        false,

      response: {

        http_status:
          response.status,

        ok:
          response.ok,

        elapsed_ms:
          Date.now() -
          started,

      },

      data,

      raw:
        data === null
          ? raw.slice(0, 3000)
          : null,

    });

  } catch (error) {

    return json({

      success:
        false,

      version:
        VERSION,

      error:
        error instanceof Error
          ? error.message
          : String(error),

    }, 500);

  }
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
      new URL(request.url);


    const pathname =
      url.pathname;


    // ========================================================
    // ROOT
    // ========================================================

    if (pathname === "/") {

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

        endpoints: [

          "/live",

          "/search?q=HOME%20AWAY",

          "/event?id=EVENT_ID",

          "/event-direct?id=EVENT_ID",

          "/line-test?id=EVENT_ID",

          "/trading-check",

          "/graphql-account-check",

          "/graphql-bets-check",

          "/diagnostic-target-market",

        ],

      });

    }


    // ========================================================
    // LIVE
    // ========================================================

    if (pathname === "/live") {

      try {

        const result =
          await getLiveSoccerEvents(
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

          ...result,

        });

      } catch (error) {

        return json({

          success:
            false,

          version:
            VERSION,

          action:
            "LIVE",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // ========================================================
    // SEARCH
    // ========================================================

    if (pathname === "/search") {

      const query =
        url.searchParams.get("q") ??
        "";


      try {

        const result =
          await cloudbetFetch(
            env,
            "/events?sport=soccer&live=true&players=false&limit=10000"
          );


        const data =
          await parseJSON(
            result.response
          );


        const events =
          extractEvents(data);


        const liveEvents =
          events.filter(
            isLiveEvent
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

          query,

          events_received:
            events.length,

          events_recognized_live:
            liveEvents.length,

          results:
            searchEvents(
              liveEvents,
              query
            ),

        });

      } catch (error) {

        return json({

          success:
            false,

          version:
            VERSION,

          action:
            "SEARCH",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // ========================================================
    // EVENT FROM LIVE FEED
    // ========================================================

    if (pathname === "/event") {

      const id =
        url.searchParams.get("id");


      if (!id) {

        return json({

          success:
            false,

          error:
            "Missing id",

        }, 400);

      }


      try {

        const result =
          await getEvent(
            env,
            id
          );


        return json({

          success:
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT",

          read_only:
            true,

          betting:
            false,

          ...result,

        });

      } catch (error) {

        return json({

          success:
            false,

          version:
            VERSION,

          action:
            "EVENT",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // ========================================================
    // EVENT DIRECT
    // V5.8.7 ROUTER FIX
    // ========================================================

    if (
      pathname ===
      "/event-direct"
    ) {

      const id =
        url.searchParams.get(
          "id"
        );


      if (!id) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT_DIRECT",

          error:
            "Missing id",

        }, 400);

      }


      try {

        const result =
          await getEventDirect(
            env,
            id
          );


        return json({

          success:
            result?.request?.ok ===
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT_DIRECT",

          read_only:
            true,

          betting:
            false,

          ...result,

        });

      } catch (error) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT_DIRECT",

          read_only:
            true,

          betting:
            false,

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // ========================================================
    // LINE TEST
    // ========================================================

    if (pathname === "/line-test") {

      const id =
        url.searchParams.get("id");


      if (!id) {

        return json({

          success:
            false,

          version:
            VERSION,

          action:
            "LINE_TEST",

          error:
            "Missing id",

        }, 400);

      }


      const result =
        await fetchTargetLine(
          env,
          id
        );


      return json({

        success:
          true,

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

          submarket:
            TARGET_SUBMARKET,

          outcome:
            TARGET_OUTCOME,

          params:
            TARGET_PARAMS,

          marketUrl:
            TARGET_MARKET_URL,

        },

        line:
          result,

      });

    }


    // ========================================================
    // TRADING CHECK
    // ========================================================

    if (
      pathname ===
      "/trading-check"
    ) {

      return await tradingAccessCheck(
        env
      );

    }


    // ========================================================
    // GRAPHQL ACCOUNT
    // ========================================================

    if (
      pathname ===
      "/graphql-account-check"
    ) {

      return await graphqlSingleCheck(
        env,
        "account"
      );

    }


    // ========================================================
    // GRAPHQL BETS
    // ========================================================

    if (
      pathname ===
      "/graphql-bets-check"
    ) {

      return await graphqlSingleCheck(
        env,
        "bets"
      );

    }


    // ========================================================
    // TARGET DIAGNOSTIC
    // ========================================================

    if (
      pathname ===
      "/diagnostic-target-market"
    ) {

      return await diagnosticTargetMarket(
        env
      );

    }


    // ========================================================
    // 404
    // ========================================================

    return json({

      success:
        false,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      error:
        "Not found",

      path:
        pathname,

    }, 404);

  },

};
