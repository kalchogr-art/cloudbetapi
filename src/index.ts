// ============================================================
// CLOUDBET — LIVE HT OVER 0.5
// READ ONLY
// ============================================================
//
// Показва само:
//   LIVE soccer matches
//   HT total goals
//   OVER 0.5
//   SELECTION_ENABLED
//
// Изход:
//   - match name
//   - home / away
//   - minute
//   - score
//   - HT Over 0.5 odds
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
// SOCCER CATALOGUE
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
          category?.key ||
          null,

        category_name:
          category?.name ||
          null,

        eventCount:
          Number(
            competition?.eventCount ||
            0
          )

      });

    }

  }


  return competitions;

}


// ============================================================
// GET COMPETITION
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
// IS LIVE
// ============================================================

function isLiveEvent(event) {

  return (
    event?.status ===
    "TRADING_LIVE"
  );

}


// ============================================================
// EXTRACT MINUTE
// ============================================================
//
// Cloudbet event schemas can expose live time
// in different fields. We check the common ones.
//
// ============================================================

function extractMinute(event) {

  const directValues = [

    event?.minute,

    event?.minute_display,

    event?.minuteDisplay,

    event?.match_minute,

    event?.matchMinute,

    event?.elapsed,

    event?.elapsed_minute,

    event?.elapsedMinute,

    event?.clock

  ];


  for (
    const value of directValues
  ) {

    const minute =
      parseMinute(value);


    if (
      minute !== null
    ) {

      return minute;

    }

  }


  // ----------------------------------------------------------
  // PERIOD / TIME OBJECT
  // ----------------------------------------------------------

  const objects = [

    event?.time,

    event?.match_time,

    event?.matchTime,

    event?.clock,

    event?.status

  ];


  for (
    const object of objects
  ) {

    if (
      !object ||
      typeof object !== "object"
    ) {

      continue;

    }


    const values = [

      object?.minute,

      object?.display,

      object?.value,

      object?.elapsed,

      object?.match_minute,

      object?.matchMinute

    ];


    for (
      const value of values
    ) {

      const minute =
        parseMinute(value);


      if (
        minute !== null
      ) {

        return minute;

      }

    }

  }


  // ----------------------------------------------------------
  // STRING SEARCH
  // ----------------------------------------------------------

  const strings = [

    event?.time,

    event?.match_time,

    event?.matchTime,

    event?.clock,

    event?.status

  ];


  for (
    const value of strings
  ) {

    if (
      typeof value !== "string"
    ) {

      continue;

    }


    const match =
      value.match(
        /(\d{1,3})\s*:\s*(\d{1,2})/
      );


    if (
      match
    ) {

      return Number(
        match[1]
      );

    }

  }


  return null;

}


// ============================================================
// PARSE MINUTE
// ============================================================

function parseMinute(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  if (
    typeof value === "number"
  ) {

    if (
      Number.isFinite(value)
    ) {

      return Math.floor(
        value
      );

    }

    return null;

  }


  const text =
    String(
      value
    )
    .trim();


  if (!text)
    return null;


  const clock =
    text.match(
      /^(\d{1,3})\s*:\s*(\d{1,2})/
    );


  if (
    clock
  ) {

    return Number(
      clock[1]
    );

  }


  const apostrophe =
    text.match(
      /^(\d{1,3})\s*['′]/
    );


  if (
    apostrophe
  ) {

    return Number(
      apostrophe[1]
    );

  }


  const plain =
    text.match(
      /^(\d{1,3})$/
    );


  if (
    plain
  ) {

    return Number(
      plain[1]
    );

  }


  return null;

}


// ============================================================
// SCORE
// ============================================================

function getScore(event) {

  const home =
    Number(
      event?.score?.home ??
      event?.home?.score ??
      0
    );


  const away =
    Number(
      event?.score?.away ??
      event?.away?.score ??
      0
    );


  return {

    home:
      Number.isFinite(home)
        ? home
        : 0,

    away:
      Number.isFinite(away)
        ? away
        : 0

  };

}


// ============================================================
// FIND HT OVER 0.5
// ============================================================

function findHTOver05(
  event
) {

  const markets =
    event?.markets || {};


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    return null;

  }


  for (
    const [marketKey, market]
    of Object.entries(
      markets
    )
  ) {

    if (
      marketKey !==
      "soccer.total_goals"
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

      // ------------------------------------------------------
      // ONLY FIRST HALF
      // ------------------------------------------------------

      if (
        submarketKey !==
        "period=ht"
      ) {

        continue;

      }


      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];


      for (
        const selection
        of selections
      ) {

        if (
          selection?.outcome !==
          "over"
        ) {

          continue;

        }


        if (
          selection?.params !==
          "total=0.5"
        ) {

          continue;

        }


        if (
          selection?.status !==
          "SELECTION_ENABLED"
        ) {

          continue;

        }


        const price =
          Number(
            selection?.price ||
            0
          );


        if (
          !Number.isFinite(price) ||
          price <= 1
        ) {

          continue;

        }


        return {

          market:
            marketKey,

          submarket:
            submarketKey,

          outcome:
            selection.outcome,

          params:
            selection.params,

          marketUrl:
            selection.marketUrl ||
            null,

          price,

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
            selection.status,

          side:
            selection.side ||
            null

        };

      }

    }

  }


  return null;

}


// ============================================================
// NORMALIZE MATCH
// ============================================================

function normalizeLiveMatch(
  event,
  competition,
  htOver05
) {

  const home =
    event?.home?.name ||
    event?.home?.key ||
    null;


  const away =
    event?.away?.name ||
    event?.away?.key ||
    null;


  const score =
    getScore(
      event
    );


  const minute =
    extractMinute(
      event
    );


  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    match:
      event?.name ||
      (
        home &&
        away
          ? `${home} - ${away}`
          : "Unknown match"
      ),

    home,

    away,

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : "—",

    score: {

      home:
        score.home,

      away:
        score.away

    },

    status:
      event?.status ||
      null,

    competition: {

      key:
        competition?.key ||
        null,

      name:
        competition?.name ||
        null

    },

    ht_over_05: {

      odds:
        htOver05.price,

      probability:
        htOver05.probability,

      minStake:
        htOver05.minStake,

      maxStake:
        htOver05.maxStake,

      status:
        htOver05.status,

      side:
        htOver05.side,

      marketUrl:
        htOver05.marketUrl

    }

  };

}


// ============================================================
// LIVE SCANNER
// ============================================================

async function getLiveHTOver05(
  env,
  request
) {

  const soccerResult =
    await getSoccer(
      env
    );


  const soccer =
    soccerResult.data;


  const competitions =
    extractCompetitions(
      soccer
    );


  const url =
    new URL(
      request.url
    );


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
        100,
        Math.floor(limit)
      )
    );


  const selected =
    competitions.slice(
      0,
      limit
    );


  const usable =
    selected.filter(
      competition =>
        Number(
          competition?.eventCount ||
          0
        ) > 0
    );


  const matches = [];

  const errors = [];

  let liveEvents = 0;


  // ==========================================================
  // SCAN COMPETITIONS
  // ==========================================================

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


      const events =
        Array.isArray(
          result?.data?.events
        )
          ? result.data.events
          : [];


      for (
        const event
        of events
      ) {

        if (
          !isLiveEvent(
            event
          )
        ) {

          continue;

        }


        liveEvents++;


        const htOver05 =
          findHTOver05(
            event
          );


        if (
          !htOver05
        ) {

          continue;

        }


        matches.push(

          normalizeLiveMatch(
            event,
            competition,
            htOver05
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


  // ==========================================================
  // SORT
  // ==========================================================

  matches.sort(
    (a, b) => {

      const ma =
        a.minute === null
          ? -1
          : a.minute;

      const mb =
        b.minute === null
          ? -1
          : b.minute;

      return mb - ma;

    }
  );


  return {

    success:
      true,

    endpoint:
      "live-ht-over-0.5",

    source:
      "Cloudbet",

    sport:
      "soccer",

    filter: {

      status:
        "TRADING_LIVE",

      market:
        "soccer.total_goals",

      period:
        "ht",

      outcome:
        "over",

      total:
        "0.5",

      selection_status:
        "SELECTION_ENABLED"

    },

    catalogue: {

      competition_count:
        competitions.length,

      competitions_checked:
        selected.length,

      competitions_with_events:
        usable.length

    },

    live_events:
      liveEvents,

    matching_events:
      matches.length,

    matches,

    errors,

    timestamp:
      new Date().toISOString()

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
      getApiKey(
        env
      );

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
      "CLOUDBET LIVE HT OVER 0.5",

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
          await health(
            env
          )
        );

      }


      // ======================================================
      // LIVE HT OVER 0.5
      // ======================================================

      if (
        path === "/live"
      ) {

        return json(
          await getLiveHTOver05(
            env,
            request
          )
        );

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

            "/live",

            "/live?limit=40",

            "/live?limit=100"

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
            "CLOUDBET LIVE HT OVER 0.5",

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
