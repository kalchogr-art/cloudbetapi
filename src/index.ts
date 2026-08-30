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
// ADDED:
//   - Over 0.5 FT extraction
//   - Current score extraction
//   - Match minute extraction when supplied by Cloudbet
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
// EXTRACT COMPETITIONS
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
// MARKET SUMMARY
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
// OVER 0.5 FT
// ============================================================
//
// Looks specifically for:
//
// market:
//   soccer.total_goals
//
// submarket:
//   period=ft
//
// outcome:
//   over
//
// params:
//   total=0.5
//
// status:
//   SELECTION_ENABLED
//
// side:
//   BACK
//
// ============================================================

function getOver05(
  event
) {

  const marketSummary =
    getMarketSummary(event);


  for (
    const market
    of marketSummary
  ) {

    if (
      market.market !==
      "soccer.total_goals"
    ) {

      continue;

    }


    if (
      market.submarket !==
      "period=ft"
    ) {

      continue;

    }


    for (
      const selection
      of market.selections
    ) {

      if (
        selection.outcome !==
        "over"
      ) {

        continue;

      }


      if (
        selection.params !==
        "total=0.5"
      ) {

        continue;

      }


      if (
        selection.status !==
        "SELECTION_ENABLED"
      ) {

        continue;

      }


      if (
        selection.side !==
        "BACK"
      ) {

        continue;

      }


      return {

        available:
          true,

        price:
          selection.price,

        probability:
          selection.probability,

        minStake:
          selection.minStake,

        maxStake:
          selection.maxStake,

        status:
          selection.status,

        side:
          selection.side,

        market:
          market.market,

        submarket:
          market.submarket,

        outcome:
          selection.outcome,

        params:
          selection.params,

        marketUrl:
          selection.marketUrl

      };

    }

  }


  return {

    available:
      false,

    price:
      null,

    probability:
      null,

    minStake:
      null,

    maxStake:
      null,

    status:
      null,

    side:
      null,

    market:
      "soccer.total_goals",

    submarket:
      "period=ft",

    outcome:
      "over",

    params:
      "total=0.5",

    marketUrl:
      null

  };

}


// ============================================================
// SCORE
// ============================================================

function getScore(
  event
) {

  const homeCandidates = [

    event?.score?.home,

    event?.scores?.home,

    event?.home?.score,

    event?.homeScore,

    event?.home_score

  ];


  const awayCandidates = [

    event?.score?.away,

    event?.scores?.away,

    event?.away?.score,

    event?.awayScore,

    event?.away_score

  ];


  let home = null;
  let away = null;


  for (
    const value
    of homeCandidates
  ) {

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {

      const n =
        Number(value);

      if (
        Number.isFinite(n)
      ) {

        home = n;

        break;

      }

    }

  }


  for (
    const value
    of awayCandidates
  ) {

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {

      const n =
        Number(value);

      if (
        Number.isFinite(n)
      ) {

        away = n;

        break;

      }

    }

  }


  return {

    home,

    away,

    text:
      home !== null &&
      away !== null
        ? `${home}:${away}`
        : null

  };

}


// ============================================================
// MATCH MINUTE
// ============================================================
//
// Cloudbet may expose the live clock under different fields.
// We check the fields that can safely contain the match time.
//
// We DO NOT calculate a fake minute from cutoffTime.
//
// ============================================================

function getMatchMinute(
  event
) {

  const directCandidates = [

    event?.minute,

    event?.match_minute,

    event?.matchMinute,

    event?.live_minute,

    event?.liveMinute,

    event?.current_minute,

    event?.currentMinute,

    event?.elapsed_minute,

    event?.elapsedMinute

  ];


  for (
    const value
    of directCandidates
  ) {

    const parsed =
      parseMinute(
        value
      );


    if (
      parsed !== null
    ) {

      return {

        minute:
          parsed,

        display:
          `${parsed}'`,

        source:
          "direct"

      };

    }

  }


  const nestedCandidates = [

    event?.clock,

    event?.timer,

    event?.match_time,

    event?.matchTime,

    event?.time,

    event?.live

  ];


  for (
    const value
    of nestedCandidates
  ) {

    if (
      value === null ||
      value === undefined
    ) {

      continue;

    }


    if (
      typeof value === "object"
    ) {

      const objectCandidates = [

        value?.minute,

        value?.display,

        value?.value,

        value?.elapsed,

        value?.time

      ];


      for (
        const nested
        of objectCandidates
      ) {

        const parsed =
          parseMinute(
            nested
          );


        if (
          parsed !== null
        ) {

          return {

            minute:
              parsed,

            display:
              `${parsed}'`,

            source:
              "nested"

          };

        }

      }

    } else {

      const parsed =
        parseMinute(
          value
        );


      if (
        parsed !== null
      ) {

        return {

          minute:
            parsed,

          display:
            `${parsed}'`,

          source:
            "nested"

        };

      }

    }

  }


  return {

    minute:
      null,

    display:
      null,

    source:
      null

  };

}


// ============================================================
// PARSE MINUTE
// ============================================================

function parseMinute(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {

    return null;

  }


  if (
    typeof value === "number"
  ) {

    if (
      !Number.isFinite(value)
    ) {

      return null;

    }


    const n =
      Math.floor(value);


    if (
      n < 0 ||
      n > 130
    ) {

      return null;

    }


    return n;

  }


  const text =
    String(value)
      .trim();


  if (!text)
    return null;


  // 34'
  const apostrophe =
    text.match(
      /^(\d{1,3})\s*['′]/
    );


  if (
    apostrophe
  ) {

    return validateMinute(
      Number(
        apostrophe[1]
      )
    );

  }


  // 34:21
  const clock =
    text.match(
      /^(\d{1,3}):(\d{1,2})/
    );


  if (
    clock
  ) {

    return validateMinute(
      Number(
        clock[1]
      )
    );

  }


  // 34+2
  const added =
    text.match(
      /^(\d{1,3})\s*\+\s*(\d{1,2})/
    );


  if (
    added
  ) {

    return validateMinute(
      Number(
        added[1]
      ) +
      Number(
        added[2]
      )
    );

  }


  // plain number
  const plain =
    text.match(
      /^(\d{1,3})$/
    );


  if (
    plain
  ) {

    return validateMinute(
      Number(
        plain[1]
      )
    );

  }


  return null;

}


// ============================================================
// VALIDATE MINUTE
// ============================================================

function validateMinute(
  value
) {

  if (
    !Number.isFinite(value)
  ) {

    return null;

  }


  const minute =
    Math.floor(value);


  if (
    minute < 0 ||
    minute > 130
  ) {

    return null;

  }


  return minute;

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


  const over05 =
    getOver05(event);


  const score =
    getScore(event);


  const matchMinute =
    getMatchMinute(event);


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

    // --------------------------------------------------------
    // CURRENT SCORE
    // --------------------------------------------------------

    score,

    // --------------------------------------------------------
    // CURRENT MATCH MINUTE
    // --------------------------------------------------------

    match_minute:
      matchMinute,

    // --------------------------------------------------------
    // OVER 0.5 FT
    // --------------------------------------------------------

    over_05_ft:
      over05,

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
    // RAW CLOUDBET MARKETS
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
    // INCLUDING SCORE + MINUTE + OVER 0.5
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
      "CLOUDBET SOCCER API V4",

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
            "CLOUDBET SOCCER API V4",

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
