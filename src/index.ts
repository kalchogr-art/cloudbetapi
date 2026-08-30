// ============================================================
// CLOUDBET — FAST LIVE SOCCER DETECTOR
// READ ONLY
//
// ЦЕЛ:
// 1. Взима футболните състезания
// 2. Проверява събитията
// 3. Връща само LIVE футболни срещи
//
// БЕЗ:
// - HT OVER 0.5
// - коефициенти
// - matcher
// - V27
// - заявки към всеки event
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
    typeof key !== "string"
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

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        method: "GET",

        headers: {
          "accept":
            "application/json",

          "X-API-Key":
            getApiKey(env),

          "cache-control":
            "no-cache"
        }
      }
    );

  const text =
    await response.text();

  let data = {};

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
      `Cloudbet HTTP ${response.status}`
    );

  }

  return data;

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
// COMPETITIONS
// ============================================================

function getCompetitions(
  soccer
) {

  const result = [];

  const categories =
    Array.isArray(
      soccer?.categories
    )
      ? soccer.categories
      : [];

  for (
    const category of categories
  ) {

    const competitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition
      of competitions
    ) {

      if (
        !competition?.key
      ) {

        continue;

      }

      result.push({

        key:
          competition.key,

        name:
          competition.name ||
          competition.key,

        eventCount:
          Number(
            competition.eventCount ||
            0
          )

      });

    }

  }

  return result;

}


// ============================================================
// COMPETITION EVENTS
// ============================================================

async function getCompetition(
  env,
  key
) {

  return cloudbetFetch(
    `/competitions/${encodeURIComponent(key)}`,
    env
  );

}


// ============================================================
// LIVE DETECTION
// ============================================================

function isLive(event) {

  // Най-сигурният Cloudbet статус
  if (
    event?.status ===
    "TRADING_LIVE"
  ) {

    return true;

  }


  // Допълнителни възможни live полета

  if (
    event?.live === true
  ) {

    return true;

  }


  if (
    event?.isLive === true
  ) {

    return true;

  }


  if (
    event?.inPlay === true
  ) {

    return true;

  }


  if (
    event?.in_play === true
  ) {

    return true;

  }


  if (
    event?.state ===
    "LIVE"
  ) {

    return true;

  }


  if (
    event?.state ===
    "IN_PLAY"
  ) {

    return true;

  }


  return false;

}


// ============================================================
// TEAM NAME
// ============================================================

function teamName(value) {

  if (
    typeof value === "string"
  ) {

    return value.trim();

  }

  if (
    value &&
    typeof value === "object"
  ) {

    return String(
      value.name ||
      value.key ||
      value.label ||
      ""
    ).trim();

  }

  return "";

}


// ============================================================
// GET MATCH NAME
// ============================================================

function getMatchName(event) {

  const direct =
    event?.name ||
    event?.match ||
    event?.event_name ||
    event?.eventName;

  if (
    direct
  ) {

    return String(
      direct
    );

  }


  const home =
    teamName(
      event?.home
    );

  const away =
    teamName(
      event?.away
    );

  if (
    home &&
    away
  ) {

    return `${home} - ${away}`;

  }

  return null;

}


// ============================================================
// MINUTE SEARCH
// ============================================================

function findMinute(
  event
) {

  const values = [

    event?.minute,

    event?.matchMinute,

    event?.match_minute,

    event?.elapsed,

    event?.elapsedMinute,

    event?.elapsed_minute,

    event?.clock,

    event?.matchTime,

    event?.match_time,

    event?.gameTime,

    event?.game_time,

    event?.currentMinute,

    event?.current_minute,

    event?.time

  ];


  for (
    const value
    of values
  ) {

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {

      if (
        value >= 0 &&
        value <= 130
      ) {

        return Math.floor(
          value
        );

      }

    }


    if (
      typeof value === "string"
    ) {

      const text =
        value.trim();


      let match =
        text.match(
          /^(\d{1,3})\s*:\s*\d{1,2}/
        );

      if (
        match
      ) {

        return Number(
          match[1]
        );

      }


      match =
        text.match(
          /^(\d{1,3})\s*['′]/
        );

      if (
        match
      ) {

        return Number(
          match[1]
        );

      }


      if (
        /^\d{1,3}$/.test(
          text
        )
      ) {

        const n =
          Number(text);

        if (
          n >= 0 &&
          n <= 130
        ) {

          return n;

        }

      }

    }

  }


  return null;

}


// ============================================================
// SCORE
// ============================================================

function getScore(event) {

  const score =
    event?.score ||
    event?.scores ||
    event?.result ||
    null;


  if (
    !score ||
    typeof score !== "object"
  ) {

    return {
      home: null,
      away: null
    };

  }


  const home =
    Number(
      score.home ??
      score.homeScore ??
      score.home_score
    );


  const away =
    Number(
      score.away ??
      score.awayScore ??
      score.away_score
    );


  return {

    home:
      Number.isFinite(home)
        ? home
        : null,

    away:
      Number.isFinite(away)
        ? away
        : null

  };

}


// ============================================================
// BUILD MATCH
// ============================================================

function buildMatch(
  event,
  competition
) {

  const home =
    teamName(
      event?.home
    );

  const away =
    teamName(
      event?.away
    );


  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    match:
      getMatchName(
        event
      ),

    home,

    away,

    status:
      event?.status ??
      null,

    live:
      event?.live ??
      null,

    minute:
      findMinute(
        event
      ),

    minute_display:
      findMinute(event) !== null
        ? `${findMinute(event)}'`
        : null,

    score:
      getScore(
        event
      ),

    competition: {

      key:
        competition?.key ??
        null,

      name:
        competition?.name ??
        null

    }

  };

}


// ============================================================
// SCAN
// ============================================================

async function scan(env, request) {

  const soccer =
    await getSoccer(
      env
    );


  const competitions =
    getCompetitions(
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
      "100"
    );


  if (
    !Number.isFinite(limit)
  ) {

    limit = 100;

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
    competitions
      .filter(
        c =>
          Number(
            c.eventCount ||
            0
          ) > 0
      )
      .slice(
        0,
        limit
      );


  const matches = [];

  const errors = [];


  let totalEvents =
    0;


  let liveEvents =
    0;


  // ==========================================================
  // PARALLEL COMPETITION REQUESTS
  // ==========================================================

  const results =
    await Promise.all(
      selected.map(
        async competition => {

          try {

            const data =
              await getCompetition(
                env,
                competition.key
              );


            const events =
              Array.isArray(
                data?.events
              )
                ? data.events
                : [];


            return {

              competition,

              events,

              error:
                null

            };

          } catch (error) {

            return {

              competition,

              events: [],

              error:
                error?.message ||
                String(error)

            };

          }

        }
      )
    );


  // ==========================================================
  // PROCESS
  // ==========================================================

  for (
    const result
    of results
  ) {

    totalEvents +=
      result.events.length;


    if (
      result.error
    ) {

      errors.push({

        competition:
          result.competition.key,

        name:
          result.competition.name,

        error:
          result.error

      });

      continue;

    }


    for (
      const event
      of result.events
    ) {

      if (
        !isLive(event)
      ) {

        continue;

      }


      liveEvents++;


      const match =
        buildMatch(
          event,
          result.competition
        );


      // Само реални футболни срещи
      if (
        !match.home ||
        !match.away
      ) {

        continue;

      }


      matches.push(
        match
      );

    }

  }


  // ==========================================================
  // SORT BY MINUTE
  // ==========================================================

  matches.sort(
    (a, b) => {

      const am =
        a.minute === null
          ? 999
          : a.minute;

      const bm =
        b.minute === null
          ? 999
          : b.minute;

      return am - bm;

    }
  );


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    success:
      true,

    test:
      "CLOUDBET ALL LIVE SOCCER",

    filter:
      "SOCCER + LIVE ONLY",

    source:
      "Cloudbet",

    sport:
      "soccer",

    stats: {

      competition_count:
        competitions.length,

      competitions_checked:
        selected.length,

      total_events:
        totalEvents,

      live_events_detected:
        liveEvents,

      live_matches:
        matches.length,

      errors:
        errors.length

    },

    matches,

    errors,

    timestamp:
      new Date().toISOString()

  };

}


// ============================================================
// HEALTH
// ============================================================

function health(env) {

  let secret = false;

  let length = 0;


  try {

    const key =
      getApiKey(env);

    secret = true;

    length =
      key.length;

  } catch {

    secret = false;

  }


  return {

    success:
      true,

    worker:
      "cloudbet-live-soccer",

    mode:
      "READ ONLY",

    secret: {

      name:
        API_KEY_NAME,

      exists:
        secret,

      length

    },

    endpoints: [

      "/",

      "/health",

      "/live",

      "/live?limit=100"

    ],

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

      // ------------------------------------------------------
      // HEALTH
      // ------------------------------------------------------

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json(
          health(env)
        );

      }


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

      if (
        path === "/live"
      ) {

        return json(
          await scan(
            env,
            request
          )
        );

      }


      // ------------------------------------------------------
      // 404
      // ------------------------------------------------------

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
            "cloudbet-live-soccer",

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
