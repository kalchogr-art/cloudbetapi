// ============================================================
// CLOUDBET — LIVE HT OVER 0.5
// READ ONLY
//
// Показва САМО:
//   LIVE soccer
//   soccer.total_goals
//   period=ht
//   outcome=over
//   total=0.5
//   SELECTION_ENABLED
//
// РЕЗУЛТАТ:
//   име на мач
//   минута
//   коефициент
//   marketUrl
//
// ENV SECRET:
//   CLOUDBET_API_KEY
//
// NO BETS ARE PLACED
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

          "Content-Type":
            "application/json",

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
// PARSE MINUTE
// ============================================================
//
// Cloudbet public events API не дава задължително
// игровия clock като отделно поле.
//
// Взимаме наличната информация, ако я има.
// Ако няма minute поле, връщаме null.
//
// ============================================================

function extractMinute(event) {

  const values = [

    event?.minute,
    event?.matchMinute,
    event?.match_minute,
    event?.gameMinute,
    event?.game_minute,
    event?.clock,
    event?.matchClock,
    event?.match_clock,
    event?.score?.minute,
    event?.scores?.minute,
    event?.metadata?.minute

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


  return null;

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
    typeof value === "number"
  ) {

    if (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 130
    ) {

      return Math.floor(value);

    }

    return null;

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
      const item of nested
    ) {

      const parsed =
        parseMinute(item);

      if (
        parsed !== null
      ) {

        return parsed;

      }

    }

    return null;

  }


  const text =
    String(value)
      .trim();


  if (!text)
    return null;


  const clock =
    text.match(
      /^(\d{1,3}):(\d{1,2})/
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


  const added =
    text.match(
      /^(\d{1,3})\s*\+\s*(\d{1,2})/
    );


  if (
    added
  ) {

    return (
      Number(added[1]) +
      Number(added[2])
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
// FIND HT OVER 0.5
// ============================================================

function findHtOver05(
  event
) {

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


  for (
    const [
      submarketKey,
      submarket
    ]
    of Object.entries(
      submarkets
    )
  ) {

    // --------------------------------------------------------
    // FIRST HALF ONLY
    // --------------------------------------------------------

    const key =
      String(
        submarketKey || ""
      )
      .toLowerCase();


    if (
      !key.includes(
        "period=ht"
      )
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
        !selection
      ) {

        continue;

      }


      // ------------------------------------------------------
      // OVER
      // ------------------------------------------------------

      if (
        String(
          selection?.outcome || ""
        ).toLowerCase() !==
        "over"
      ) {

        continue;

      }


      // ------------------------------------------------------
      // TOTAL 0.5
      // ------------------------------------------------------

      const params =
        String(
          selection?.params || ""
        ).toLowerCase();


      if (
        !(
          params === "total=0.5" ||
          params.includes(
            "total=0.5"
          )
        )
      ) {

        continue;

      }


      // ------------------------------------------------------
      // ENABLED
      // ------------------------------------------------------

      if (
        selection?.status !==
        "SELECTION_ENABLED"
      ) {

        continue;

      }


      const price =
        Number(
          selection?.price || 0
        );


      if (
        !Number.isFinite(price) ||
        price <= 1
      ) {

        continue;

      }


      return {

        market:
          "soccer.total_goals",

        submarket:
          submarketKey,

        outcome:
          "over",

        total:
          0.5,

        price,

        probability:
          Number(
            selection?.probability || 0
          ),

        minStake:
          Number(
            selection?.minStake || 0
          ),

        maxStake:
          Number(
            selection?.maxStake || 0
          ),

        marketUrl:
          selection?.marketUrl ||
          null,

        status:
          selection?.status ||
          null,

        side:
          selection?.side ||
          null

      };

    }

  }


  return null;

}


// ============================================================
// NORMALIZE EVENT
// ============================================================

function normalizeEvent(
  event
) {

  const home =
    event?.home?.name ||
    event?.home?.key ||
    null;


  const away =
    event?.away?.name ||
    event?.away?.key ||
    null;


  const market =
    findHtOver05(
      event
    );


  if (!market)
    return null;


  const minute =
    extractMinute(
      event
    );


  return {

    id:
      event?.id ??
      null,

    name:
      event?.name ||
      (
        home && away
          ? `${home} - ${away}`
          : null
      ),

    home,
    away,

    status:
      event?.status ||
      null,

    is_live:
      event?.status ===
      "TRADING_LIVE",

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : "—",

    competition: {

      key:
        event?.competition?.key ||
        null,

      name:
        event?.competition?.name ||
        null

    },

    bet: market

  };

}


// ============================================================
// LIVE EVENTS
// ============================================================
//
// Cloudbet Events API използва:
//   sport=soccer
//   live=true
//   from=<unix>
//   to=<unix>
//
// ============================================================

async function getLiveEvents(
  env
) {

  const now =
    Math.floor(
      Date.now() / 1000
    );


  // Малък прозорец около текущото време.
  // from/to са задължителни за /events.

  const from =
    now - 3600;


  const to =
    now + 3600;


  const params =
    new URLSearchParams();


  params.set(
    "sport",
    "soccer"
  );


  params.set(
    "live",
    "true"
  );


  params.set(
    "from",
    String(from)
  );


  params.set(
    "to",
    String(to)
  );


  params.set(
    "players",
    "false"
  );


  params.set(
    "limit",
    "1000"
  );


  const data =
    await cloudbetFetch(
      `/events?${params.toString()}`,
      env
    );


  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];


  const filtered = [];


  for (
    const event
    of events
  ) {

    if (
      event?.status !==
      "TRADING_LIVE"
    ) {

      continue;

    }


    const normalized =
      normalizeEvent(
        event
      );


    if (!normalized)
      continue;


    filtered.push(
      normalized
    );

  }


  return {

    success:
      true,

    endpoint:
      "live",

    source:
      "Cloudbet",

    filter: {

      sport:
        "soccer",

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

    request_window: {

      from,

      to

    },

    events_count:
      events.length,

    matching_count:
      filtered.length,

    live_events:
      filtered,

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

    filter:
      "LIVE SOCCER — HT OVER 0.5",

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
      // LIVE
      // ------------------------------------------------------

      if (
        path === "/live"
      ) {

        return json(
          await getLiveEvents(
            env
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

          worker:
            "CLOUDBET LIVE HT OVER 0.5",

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
