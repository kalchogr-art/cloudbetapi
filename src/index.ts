// ============================================================
// CLOUDBET API — SOCCER / LIVE / OVER 0.5 HT
// READ ONLY
// ============================================================
//
// ENV SECRET:
//   CLOUDBET_API_KEY
//
// /live
//   -> само LIVE футболни мачове
//   -> само Over 0.5 HT
//   -> само SELECTION_ENABLED
//   -> само BACK
//   -> име
//   -> минута
//   -> резултат
//   -> коефициент
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

  return cloudbetFetch(
    `/competitions/${encodeURIComponent(
      competitionKey
    )}`,
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
// OVER 0.5 HT
// ============================================================
//
// EXACT FILTER:
//
// market      = soccer.total_goals
// submarket   = period=ht
// outcome     = over
// params      = total=0.5
// status      = SELECTION_ENABLED
// side        = BACK
//
// ============================================================

function getOver05HT(
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
      "period=ht"
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

        market:
          "soccer.total_goals",

        submarket:
          "period=ht",

        outcome:
          "over",

        params:
          "total=0.5",

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

    market:
      "soccer.total_goals",

    submarket:
      "period=ht",

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

  const homeValues = [

    event?.score?.home,
    event?.scores?.home,
    event?.home?.score,
    event?.homeScore,
    event?.home_score

  ];


  const awayValues = [

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
    of homeValues
  ) {

    const n =
      Number(value);

    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(n)
    ) {

      home = n;
      break;

    }

  }


  for (
    const value
    of awayValues
  ) {

    const n =
      Number(value);

    if (
      value !== null &&
      value !== undefined &&
      value !== "" &&
      Number.isFinite(n)
    ) {

      away = n;
      break;

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
// MINUTE
// ============================================================
//
// НЕ изчисляваме минута от cutoffTime.
// Вземаме само стойност, която Cloudbet реално връща.
//
// ============================================================

function getMatchMinute(
  event
) {

  const candidates = [

    event?.minute,
    event?.match_minute,
    event?.matchMinute,
    event?.live_minute,
    event?.liveMinute,
    event?.current_minute,
    event?.currentMinute,
    event?.elapsed_minute,
    event?.elapsedMinute,

    event?.clock?.minute,
    event?.clock?.display,
    event?.clock?.value,

    event?.timer?.minute,
    event?.timer?.display,
    event?.timer?.value,

    event?.match_time?.minute,
    event?.match_time?.display,
    event?.match_time?.value,

    event?.matchTime?.minute,
    event?.matchTime?.display,
    event?.matchTime?.value

  ];


  for (
    const value
    of candidates
  ) {

    const minute =
      parseMinute(value);


    if (
      minute !== null
    ) {

      return {

        minute,

        display:
          `${minute}'`

      };

    }

  }


  return {

    minute:
      null,

    display:
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

    return validateMinute(
      value
    );

  }


  const text =
    String(value)
      .trim();


  if (!text)
    return null;


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
    !Number.isFinite(
      Number(value)
    )
  ) {

    return null;

  }


  const minute =
    Math.floor(
      Number(value)
    );


  if (
    minute < 0 ||
    minute > 130
  ) {

    return null;

  }


  return minute;

}


// ============================================================
// NORMALIZE EVENT
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


  const name =
    event?.name ||
    (
      home &&
      away
        ? `${home} v ${away}`
        : null
    );


  const status =
    event?.status ||
    null;


  const isLive =
    status ===
    "TRADING_LIVE";


  const over05HT =
    getOver05HT(event);


  const score =
    getScore(event);


  const minute =
    getMatchMinute(event);


  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    name,

    home,

    away,

    status,

    is_live:
      isLive,

    minute:
      minute.minute,

    minute_display:
      minute.display,

    score,

    over_05_ht:
      over05HT,

    competition: {

      key:
        competition?.key ||
        null,

      name:
        competition?.name ||
        null

    }

  };

}


// ============================================================
// GET SOCCER EVENTS
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

    events,

    errors

  };

}


// ============================================================
// LIVE
// ============================================================
//
// ВРЪЩАМЕ САМО:
//
// LIVE
// +
// Over 0.5 HT
//
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
        event.is_live === true &&
        event.over_05_ht?.available === true
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
      "CLOUDBET SOCCER API V5",

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
      new URL(request.url);


    const path =
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";


    try {

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json(
          await health(env)
        );

      }


      // ------------------------------------------------------
      // SOCCER
      // ------------------------------------------------------

      if (
        path === "/soccer"
      ) {

        const result =
          await getSoccer(env);


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

          competition_count:
            competitions.length,

          competitions,

          timestamp:
            new Date().toISOString()

        });

      }


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

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


      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------

      return json({

        success:
          false,

        error:
          "Unknown endpoint",

        available_endpoints: [

          "/",

          "/health",

          "/soccer",

          "/live"

        ]

      }, 404);


    } catch (error) {

      return json({

        success:
          false,

        worker:
          "CLOUDBET SOCCER API V5",

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
