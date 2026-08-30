// ============================================================
// CLOUDBET — LIVE HT OVER 0.5
// READ ONLY
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
          "Accept":
            "application/json",

          "X-API-Key":
            apiKey,

          "Cache-Control":
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


  return data;

}


// ============================================================
// MINUTE PARSER
// ============================================================

function parseMinute(value) {

  if (
    value === null ||
    value === undefined
  ) {

    return null;

  }


  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {

    return Math.floor(value);

  }


  const text =
    String(value).trim();


  if (!text)
    return null;


  // 32:15
  let match =
    text.match(
      /^(\d{1,3}):(\d{1,2})/
    );


  if (match) {

    return Number(
      match[1]
    );

  }


  // 32'
  match =
    text.match(
      /^(\d{1,3})\s*['′]/
    );


  if (match) {

    return Number(
      match[1]
    );

  }


  // 32+2
  match =
    text.match(
      /^(\d{1,3})\s*\+\s*(\d{1,2})/
    );


  if (match) {

    return (
      Number(match[1]) +
      Number(match[2])
    );

  }


  // 32
  match =
    text.match(
      /^(\d{1,3})$/
    );


  if (match) {

    return Number(
      match[1]
    );

  }


  return null;

}


// ============================================================
// EVENT MINUTE
// ============================================================

function getEventMinute(event) {

  const values = [

    event?.minute,
    event?.matchMinute,
    event?.match_minute,
    event?.minute_display,
    event?.minuteDisplay,
    event?.clock,
    event?.time,
    event?.elapsed,
    event?.score?.minute,
    event?.scores?.minute

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


  const objects = [

    event?.time,
    event?.clock,
    event?.elapsed

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


    const nestedValues = [

      object?.minute,
      object?.minutes,
      object?.display,
      object?.value,
      object?.elapsed

    ];


    for (
      const value of nestedValues
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


  return null;

}


// ============================================================
// SCORE
// ============================================================

function getScore(event) {

  const home =
    Number(
      event?.scores?.home ??
      event?.score?.home ??
      event?.homeScore ??
      event?.home_score ??
      0
    );


  const away =
    Number(
      event?.scores?.away ??
      event?.score?.away ??
      event?.awayScore ??
      event?.away_score ??
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
// HT OVER 0.5 MARKET
// ============================================================

function findHTOver05(event) {

  const markets =
    event?.markets;


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    return null;

  }


  // ----------------------------------------------------------
  // EXACT MARKET
  // ----------------------------------------------------------

  const totalGoals =
    markets[
      "soccer.total_goals"
    ];


  if (
    !totalGoals ||
    typeof totalGoals !== "object"
  ) {

    return null;

  }


  const submarkets =
    totalGoals.submarkets;


  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    return null;

  }


  // ----------------------------------------------------------
  // EXACT FIRST HALF
  // ----------------------------------------------------------

  const ht =
    submarkets[
      "period=ht"
    ];


  if (
    !ht ||
    typeof ht !== "object"
  ) {

    return null;

  }


  const selections =
    Array.isArray(
      ht.selections
    )
      ? ht.selections
      : [];


  for (
    const selection
    of selections
  ) {

    if (!selection)
      continue;


    // OVER
    if (
      String(
        selection.outcome || ""
      ).toLowerCase()
      !== "over"
    ) {

      continue;

    }


    // TOTAL 0.5
    const params =
      String(
        selection.params || ""
      )
      .toLowerCase()
      .replace(
        /\s/g,
        ""
      );


    if (
      params !== "total=0.5"
    ) {

      continue;

    }


    // ENABLED
    if (
      selection.status !==
      "SELECTION_ENABLED"
    ) {

      continue;

    }


    // BACK
    if (
      selection.side &&
      String(
        selection.side
      ).toUpperCase()
      !== "BACK"
    ) {

      continue;

    }


    return {

      outcome:
        selection.outcome,

      params:
        selection.params,

      marketUrl:
        selection.marketUrl ||
        null,

      price:
        Number(
          selection.price || 0
        ),

      probability:
        Number(
          selection.probability || 0
        ),

      minStake:
        Number(
          selection.minStake || 0
        ),

      maxStake:
        Number(
          selection.maxStake || 0
        ),

      status:
        selection.status,

      side:
        selection.side

    };

  }


  return null;

}


// ============================================================
// NORMALIZE EVENT
// ============================================================

function normalizeEvent(event) {

  const bet =
    findHTOver05(event);


  if (!bet)
    return null;


  const home =
    event?.home?.name ||
    event?.home?.key ||
    event?.home ||
    null;


  const away =
    event?.away?.name ||
    event?.away?.key ||
    event?.away ||
    null;


  const name =
    event?.name ||
    (
      home &&
      away
        ? `${home} - ${away}`
        : "Unknown match"
    );


  const score =
    getScore(event);


  const minute =
    getEventMinute(event);


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

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : "—",

    score,

    status:
      event?.status ||
      null,

    competition: {

      key:
        event?.competition?.key ||
        event?.competitionKey ||
        null,

      name:
        event?.competition?.name ||
        event?.competitionName ||
        null

    },

    bet: {

      market:
        "soccer.total_goals",

      submarket:
        "period=ht",

      outcome:
        "over",

      total:
        0.5,

      price:
        bet.price,

      probability:
        bet.probability,

      minStake:
        bet.minStake,

      maxStake:
        bet.maxStake,

      status:
        bet.status,

      side:
        bet.side,

      marketUrl:
        bet.marketUrl

    }

  };

}


// ============================================================
// LIVE
// ============================================================

async function getLive(env) {

  // ==========================================================
  // IMPORTANT:
  //
  // Cloudbet LIVE endpoint requires:
  //
  //   sport=soccer
  //
  // Do NOT send:
  //   from
  //   to
  //
  // ==========================================================

  const data =
    await cloudbetFetch(
      "/events?sport=soccer",
      env
    );


  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];


  const live =
    events.filter(
      event =>
        event?.status ===
        "TRADING_LIVE"
    );


  const matches = [];


  for (
    const event
    of live
  ) {

    const normalized =
      normalizeEvent(
        event
      );


    if (!normalized)
      continue;


    matches.push(
      normalized
    );

  }


  return {

    events_received:
      events.length,

    live_events:
      live.length,

    matching_events:
      matches.length,

    matches

  };

}


// ============================================================
// HEALTH
// ============================================================

async function health(env) {

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
      "CLOUDBET LIVE HT OVER 0.5",

    mode:
      "READ ONLY",

    endpoint:
      "/events?sport=soccer",

    filter: {

      market:
        "soccer.total_goals",

      period:
        "ht",

      outcome:
        "over",

      total:
        0.5,

      status:
        "SELECTION_ENABLED",

      side:
        "BACK"

    },

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
      // LIVE
      // ======================================================

      if (
        path === "/live"
      ) {

        const result =
          await getLive(env);


        return json({

          success:
            true,

          endpoint:
            "live",

          source:
            "Cloudbet",

          sport:
            "soccer",

          filter: {

            market:
              "soccer.total_goals",

            submarket:
              "period=ht",

            outcome:
              "over",

            params:
              "total=0.5",

            status:
              "SELECTION_ENABLED",

            side:
              "BACK"

          },

          events_received:
            result.events_received,

          live_events:
            result.live_events,

          matching_events:
            result.matching_events,

          matches:
            result.matches,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // 404
      // ======================================================

      return json({

        success:
          false,

        error:
          "Unknown endpoint",

        available_endpoints: [
          "/",
          "/health",
          "/live"
        ]

      }, 404);


    } catch (error) {

      return json({

        success:
          false,

        worker:
          "CLOUDBET LIVE HT OVER 0.5",

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
