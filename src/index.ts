// ============================================================
// CLOUDBET API TEST — SOCCER / LIVE / MARKETS
// READ ONLY
// ============================================================
//
// ENV SECRET:
//   CLOUDBET_API_KEY
//
// ENDPOINTS:
//
//   /                 -> health
//   /balance          -> account balance
//   /sports           -> all sports
//   /soccer           -> Soccer competitions
//   /soccer-events    -> Soccer events + markets
//   /live             -> LIVE soccer events + markets
//
// IMPORTANT:
// Cloudbet Soccer:
//   sports -> soccer -> competitions -> competition events
//
// NO BETS ARE PLACED.
// ============================================================

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";


// ============================================================
// JSON
// ============================================================

function json(data, status = 200) {

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


// ============================================================
// API KEY
// ============================================================

function getApiKey(env) {

  const key =
    env?.[API_KEY_NAME];

  if (
    !key ||
    typeof key !== "string" ||
    !key.trim()
  ) {

    throw new Error(
      `${API_KEY_NAME} secret is missing`
    );

  }

  return key.trim();

}


// ============================================================
// CLOUDBET FETCH
// ============================================================

async function cloudbetFetch(
  path,
  env
) {

  const apiKey =
    getApiKey(env);

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "GET",

        headers: {
          "accept":
            "application/json",

          "X-API-Key":
            apiKey,

          "cache-control":
            "no-cache"
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {
      raw: text
    };

  }


  if (!response.ok) {

    throw new Error(
      `Cloudbet HTTP ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );

  }


  return {
    status:
      response.status,

    data
  };

}


// ============================================================
// BALANCE
// ============================================================

async function getBalance(env) {

  const apiKey =
    getApiKey(env);

  const response =
    await fetch(
      "https://account-api.cloudbet.com/v1/account/balance",
      {
        headers: {
          "accept":
            "application/json",

          "X-API-Key":
            apiKey,

          "cache-control":
            "no-cache"
        }
      }
    );

  const text =
    await response.text();

  let data;

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    data = {
      raw: text
    };

  }


  if (!response.ok) {

    throw new Error(
      `Cloudbet balance HTTP ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );

  }


  return {
    http_status:
      response.status,

    data
  };

}


// ============================================================
// SPORTS
// ============================================================

async function getSports(env) {

  return cloudbetFetch(
    "/sports",
    env
  );

}


// ============================================================
// SOCCER
// ============================================================

async function getSoccer(env) {

  return cloudbetFetch(
    "/sports/soccer",
    env
  );

}


// ============================================================
// COMPETITIONS
// ============================================================

function extractCompetitions(
  soccer
) {

  const competitions = [];

  const categories =
    Array.isArray(
      soccer?.categories
    )
      ? soccer.categories
      : [];


  for (
    const category of categories
  ) {

    const categoryCompetitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];


    for (
      const competition
      of categoryCompetitions
    ) {

      if (
        !competition?.key
      ) {

        continue;

      }


      competitions.push({

        key:
          competition.key,

        name:
          competition.name ||
          competition.key,

        category_key:
          category.key ||
          null,

        category_name:
          category.name ||
          null,

        eventCount:
          Number(
            competition.eventCount ||
            0
          )

      });

    }

  }


  return competitions;

}


// ============================================================
// COMPETITION
// ============================================================

async function getCompetition(
  env,
  competitionKey
) {

  const path =
    `/competitions/${encodeURIComponent(
      competitionKey
    )}`;

  return cloudbetFetch(
    path,
    env
  );

}


// ============================================================
// MARKET NORMALIZER
// ============================================================
//
// Cloudbet returns markets in:
//
// event.markets
//
// We preserve the complete raw markets AND create
// a normalized summary.
//
// ============================================================

function getMarketSummary(
  event
) {

  const markets =
    event?.markets || {};

  const result = [];


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    return result;

  }


  for (
    const [marketKey, market]
    of Object.entries(markets)
  ) {

    if (
      !market ||
      typeof market !== "object"
    ) {

      continue;

    }


    const submarkets =
      market?.submarkets || {};


    if (
      !submarkets ||
      typeof submarkets !== "object"
    ) {

      continue;

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
        !submarket ||
        typeof submarket !== "object"
      ) {

        continue;

      }


      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];


      result.push({

        market:
          marketKey,

        submarket:
          submarketKey,

        selections:
          selections.map(
            selection => ({

              outcome:
                selection?.outcome ??
                null,

              params:
                selection?.params ??
                null,

              marketUrl:
                selection?.marketUrl ??
                null,

              price:
                Number(
                  selection?.price ||
                  0
                ),

              probability:
                Number(
                  selection?.probability ||
                  0
                ),

              minStake:
                Number(
                  selection?.minStake ||
                  0
                ),

              maxStake:
                Number(
                  selection?.maxStake ||
                  0
                ),

              status:
                selection?.status ??
                null,

              side:
                selection?.side ??
                null

            })
          )

      });

    }

  }


  return result;

}


// ============================================================
// EVENT NORMALIZER
// ============================================================

function normalizeEvent(
  event,
  competition
) {

  const home =
    event?.home?.name ||
    event?.home?.key ||
    null;


  const away =
    event?.away?.name ||
    event?.away?.key ||
    null;


  const status =
    event?.status ||
    null;


  const isLive =
    status ===
    "TRADING_LIVE";


  const rawMarkets =
    event?.markets &&
    typeof event.markets === "object"
      ? event.markets
      : {};


  const marketSummary =
    getMarketSummary(event);


  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    name:
      event?.name ||
      (
        home &&
        away
          ? `${home} - ${away}`
          : null
      ),

    home,

    away,

    status,

    is_live:
      isLive,

    cutoffTime:
      event?.cutoffTime ||
      null,

    competition: {

      key:
        competition?.key ||
        null,

      name:
        competition?.name ||
        null

    },

    // --------------------------------------------------------
    // NUMBER OF MARKETS
    // --------------------------------------------------------

    market_count:
      marketSummary.length,

    // --------------------------------------------------------
    // NORMALIZED MARKETS
    // --------------------------------------------------------

    market_summary:
      marketSummary,

    // --------------------------------------------------------
    // RAW CLOUDbet MARKETS
    // --------------------------------------------------------

    markets:
      rawMarkets

  };

}


// ============================================================
// SOCCER EVENTS
// ============================================================

async function getSoccerEvents(
  env,
  request
) {

  // ----------------------------------------------------------
  // SOCCER CATALOGUE
  // ----------------------------------------------------------

  const soccerResult =
    await getSoccer(env);

  const soccer =
    soccerResult.data;


  const competitions =
    extractCompetitions(
      soccer
    );


  const url =
    new URL(request.url);


  const all =
    url.searchParams.get(
      "all"
    ) === "1";


  let limit =
    Number(
      url.searchParams.get(
        "limit"
      ) ||
      "40"
    );


  if (
    !Number.isFinite(limit)
  ) {

    limit = 40;

  }


  limit =
    Math.max(
      1,
      Math.min(
        all
          ? 500
          : 100,

        Math.floor(limit)
      )
    );


  const selected =
    all
      ? competitions
      : competitions.slice(
          0,
          limit
        );


  // ----------------------------------------------------------
  // ONLY COMPETITIONS WITH EVENTS
  // ----------------------------------------------------------

  const usable =
    selected.filter(
      competition =>
        Number(
          competition.eventCount ||
          0
        ) > 0
    );


  const events = [];

  const errors = [];


  // ----------------------------------------------------------
  // SEQUENTIAL
  // ----------------------------------------------------------

  for (
    const competition
    of usable
  ) {

    try {

      const result =
        await getCompetition(
          env,
          competition.key
        );


      const data =
        result.data;


      const competitionEvents =
        Array.isArray(
          data?.events
        )
          ? data.events
          : [];


      for (
        const event
        of competitionEvents
      ) {

        events.push(

          normalizeEvent(
            event,
            competition
          )

        );

      }


    } catch (error) {

      errors.push({

        competition:
          competition.key,

        name:
          competition.name,

        error:
          error?.message ||
          String(error)

      });

    }

  }


  return {

    soccer: {

      key:
        "soccer",

      name:
        "Soccer"

    },

    catalogue: {

      competition_count:
        competitions.length,

      competitions_checked:
        selected.length,

      competitions_with_events:
        usable.length

    },

    events_count:
      events.length,

    live_count:
      events.filter(
        event =>
          event.is_live
      ).length,

    events,

    errors

  };

}


// ============================================================
// LIVE
// ============================================================

async function getLive(
  env,
  request
) {

  const result =
    await getSoccerEvents(
      env,
      request
    );


  const live =
    result.events.filter(
      event =>
        event.is_live === true
    );


  return {

    source:
      "Cloudbet",

    sport:
      "soccer",

    catalogue:
      result.catalogue,

    events_count:
      result.events_count,

    live_count:
      live.length,

    // --------------------------------------------------------
    // ALL LIVE EVENTS
    // INCLUDING MARKETS
    // --------------------------------------------------------

    live_events:
      live,

    errors:
      result.errors

  };

}


// ============================================================
// HEALTH
// ============================================================

async function health(
  env
) {

  let exists =
    false;

  let length =
    0;


  try {

    const key =
      getApiKey(env);

    exists =
      true;

    length =
      key.length;

  } catch {

    exists =
      false;

  }


  return {

    success:
      true,

    worker:
      "CLOUDBET SOCCER API V3",

    mode:
      "READ ONLY",

    secret: {

      name:
        API_KEY_NAME,

      exists,

      length

    },

    timestamp:
      new Date().toISOString()

  };

}


// ============================================================
// ROUTER
// ============================================================

export default {

  async fetch(
    request,
    env
  ) {

    const url =
      new URL(
        request.url
      );


    const path =
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";


    try {

      // ======================================================
      // HEALTH
      // ======================================================

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json(
          await health(env)
        );

      }


      // ======================================================
      // BALANCE
      // ======================================================

      if (
        path === "/balance"
      ) {

        const result =
          await getBalance(
            env
          );


        return json({

          success:
            true,

          endpoint:
            "balance",

          source:
            "Cloudbet",

          ...result

        });

      }


      // ======================================================
      // SPORTS
      // ======================================================

      if (
        path === "/sports"
      ) {

        const result =
          await getSports(
            env
          );


        return json({

          success:
            true,

          endpoint:
            "sports",

          source:
            "Cloudbet",

          http_status:
            result.status,

          data:
            result.data,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // SOCCER
      // ======================================================

      if (
        path === "/soccer"
      ) {

        const result =
          await getSoccer(
            env
          );


        const competitions =
          extractCompetitions(
            result.data
          );


        return json({

          success:
            true,

          endpoint:
            "soccer",

          source:
            "Cloudbet",

          http_status:
            result.status,

          sport:
            "soccer",

          competition_count:
            competitions.length,

          competitions,

          raw:
            result.data,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // SOCCER EVENTS
      // ======================================================

      if (
        path === "/soccer-events"
      ) {

        const result =
          await getSoccerEvents(
            env,
            request
          );


        return json({

          success:
            true,

          endpoint:
            "soccer-events",

          source:
            "Cloudbet",

          ...result,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // LIVE
      // ======================================================

      if (
        path === "/live"
      ) {

        const result =
          await getLive(
            env,
            request
          );


        return json({

          success:
            true,

          endpoint:
            "live",

          ...result,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // 404
      // ======================================================

      return json(
        {

          success:
            false,

          error:
            "Unknown endpoint",

          available_endpoints: [

            "/",

            "/health",

            "/balance",

            "/sports",

            "/soccer",

            "/soccer-events?limit=40",

            "/soccer-events?all=1",

            "/live"

          ]

        },

        404
      );


    } catch (error) {

      return json(

        {

          success:
            false,

          worker:
            "CLOUDBET SOCCER API V3",

          error:
            error?.message ||
            String(error),

          timestamp:
            new Date().toISOString()

        },

        500
      );

    }

  }

};
