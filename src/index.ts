// ============================================================
// CLOUDBET API — LIVE SOCCER / HT OVER 0.5
// READ ONLY
// ============================================================
//
// FILTER:
//   LIVE
//   soccer.total_goals
//   period=ht
//   outcome=over
//   total=0.5
//   SELECTION_ENABLED
//
// OUTPUT:
//   match
//   minute
//   score
//   odds
//   competition
//
// NO BETS
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
          "no-store",

        "access-control-allow-origin":
          "*",

        "access-control-allow-methods":
          "GET,HEAD,OPTIONS",

        "access-control-allow-headers":
          "Content-Type"
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

  return data;

}


// ============================================================
// GET LIVE EVENTS
// ============================================================
//
// Cloudbet requires from/to for public events API.
//
// We request a 2-hour window starting now.
// ============================================================

async function getLiveEvents(env) {

  const now =
    new Date();

  const from =
    now.toISOString();

  const to =
    new Date(
      now.getTime() +
      2 * 60 * 60 * 1000
    ).toISOString();

  const path =
    `/events?sport=soccer` +
    `&from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}`;

  const data =
    await cloudbetFetch(
      path,
      env
    );

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


// ============================================================
// LIVE CHECK
// ============================================================

function isLive(event) {

  const status =
    String(
      event?.status ||
      ""
    )
    .toUpperCase()
    .trim();

  return (
    status === "TRADING_LIVE" ||
    event?.is_live === true ||
    event?.isLive === true
  );

}


// ============================================================
// MINUTE
// ============================================================

function getMinute(event) {

  const values = [

    event?.minute,

    event?.match_minute,

    event?.current_minute,

    event?.live_minute,

    event?.matchTime,

    event?.match_time,

    event?.clock,

    event?.status?.minute,

    event?.status?.match_minute,

    event?.status?.clock

  ];

  for (
    const value
    of values
  ) {

    const minute =
      parseMinute(value);

    if (
      minute !== null
    ) {

      return minute;

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

    return Number.isFinite(value)
      ? Math.floor(value)
      : null;

  }

  if (
    typeof value === "object"
  ) {

    const nested = [

      value?.minute,

      value?.display,

      value?.value,

      value?.clock

    ];

    for (
      const item
      of nested
    ) {

      const result =
        parseMinute(item);

      if (
        result !== null
      ) {

        return result;

      }

    }

    return null;

  }

  const text =
    String(value)
      .trim();

  if (!text)
    return null;


  // 32:15

  const clock =
    text.match(
      /^(\d{1,3}):/
    );

  if (clock) {

    return Number(
      clock[1]
    );

  }


  // 32'

  const apostrophe =
    text.match(
      /^(\d{1,3})\s*['′]/
    );

  if (apostrophe) {

    return Number(
      apostrophe[1]
    );

  }


  // 45+2

  const added =
    text.match(
      /^(\d{1,3})\s*\+\s*(\d{1,2})/
    );

  if (added) {

    return (
      Number(added[1]) +
      Number(added[2])
    );

  }


  // 32

  const plain =
    text.match(
      /^(\d{1,3})$/
    );

  if (plain) {

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
      event?.scores?.home ??
      event?.home_score ??
      0
    );

  const away =
    Number(
      event?.score?.away ??
      event?.scores?.away ??
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
// FIND EXACT HT OVER 0.5
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

  const totalGoals =
    markets[
      "soccer.total_goals"
    ];

  if (!totalGoals) {

    return null;

  }

  const submarkets =
    totalGoals?.submarkets;

  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    return null;

  }

  for (
    const [
      submarketKey,
      submarket
    ]
    of Object.entries(submarkets)
  ) {

    const key =
      String(
        submarketKey || ""
      )
      .toLowerCase()
      .trim();

    if (
      key !== "period=ht"
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

      const outcome =
        String(
          selection?.outcome ||
          ""
        )
        .toLowerCase()
        .trim();

      const params =
        String(
          selection?.params ||
          ""
        )
        .toLowerCase()
        .trim();

      const status =
        String(
          selection?.status ||
          ""
        )
        .toUpperCase()
        .trim();

      if (
        outcome !== "over"
      ) {

        continue;

      }

      if (
        params !== "total=0.5"
      ) {

        continue;

      }

      if (
        status !== "SELECTION_ENABLED"
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
        price <= 0
      ) {

        continue;

      }

      return {

        odds:
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

        status,

        side:
          selection?.side ||
          null,

        marketUrl:
          selection?.marketUrl ||
          null

      };

    }

  }

  return null;

}


// ============================================================
// NORMALIZE MATCH
// ============================================================

function normalizeMatch(
  event,
  bet
) {

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

  const score =
    getScore(event);

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

    minute:
      getMinute(event),

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

      period:
        "HT",

      selection:
        "OVER 0.5",

      odds:
        bet.odds,

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

  const events =
    await getLiveEvents(env);

  const matches = [];

  for (
    const event
    of events
  ) {

    // --------------------------------------------------------
    // ONLY LIVE
    // --------------------------------------------------------

    if (
      !isLive(event)
    ) {

      continue;

    }


    // --------------------------------------------------------
    // EXACT HT OVER 0.5
    // --------------------------------------------------------

    const bet =
      findHTOver05(event);

    if (
      !bet
    ) {

      continue;

    }


    matches.push(
      normalizeMatch(
        event,
        bet
      )
    );

  }

  return {

    success:
      true,

    endpoint:
      "live",

    source:
      "Cloudbet",

    sport:
      "soccer",

    filter: {

      live:
        true,

      market:
        "soccer.total_goals",

      period:
        "ht",

      outcome:
        "over",

      total:
        0.5,

      status:
        "SELECTION_ENABLED"

    },

    events_received:
      events.length,

    matches_count:
      matches.length,

    matches,

    timestamp:
      new Date().toISOString()

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
      "/events",

    request_window:
      "now → +2 hours",

    filter: {

      live:
        true,

      market:
        "soccer.total_goals",

      period:
        "ht",

      outcome:
        "over",

      total:
        0.5,

      status:
        "SELECTION_ENABLED"

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

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,

          headers: {
            "access-control-allow-origin":
              "*",

            "access-control-allow-methods":
              "GET,OPTIONS",

            "access-control-allow-headers":
              "Content-Type"
          }
        }
      );

    }


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

        return json(
          await getLive(env)
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
