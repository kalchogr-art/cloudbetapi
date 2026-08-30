// ============================================================
// CLOUDBET — LIVE HT OVER 0.5
// READ ONLY
//
// Показва САМО:
//   LIVE Soccer
//   soccer.total_goals
//   period=ht
//   outcome=over
//   total=0.5
//   SELECTION_ENABLED
//
// Връща:
//   - име на мача
//   - минута
//   - резултат
//   - коефициент
//   - probability
//   - maxStake
//
// НЕ ПОСТАВЯ ЗАЛОЗИ
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
// CLOUDBET REQUEST
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
    String(value)
      .trim();


  if (!text)
    return null;


  // 32:15
  const clock =
    text.match(
      /^(\d{1,3}):(\d{1,2})/
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


  // 32+2
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
// EVENT MINUTE
// ============================================================

function getEventMinute(event) {

  const candidates = [

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
    const value of candidates
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
  // nested time objects
  // ----------------------------------------------------------

  const objects = [

    event?.time,

    event?.clock,

    event?.elapsed

  ];


  for (
    const object
    of objects
  ) {

    if (
      !object ||
      typeof object !== "object"
    ) {

      continue;

    }


    const values = [

      object.minute,

      object.minutes,

      object.display,

      object.value,

      object.elapsed

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
// MARKET FILTER
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


  for (
    const [
      marketKey,
      market
    ]
    of Object.entries(markets)
  ) {

    // --------------------------------------------------------
    // EXACT MARKET
    // --------------------------------------------------------

    if (
      marketKey !==
      "soccer.total_goals"
    ) {

      continue;

    }


    const submarkets =
      market?.submarkets;


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
      // FIRST HALF ONLY
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
          !selection
        ) {

          continue;

        }


        // ----------------------------------------------------
        // OVER
        // ----------------------------------------------------

        if (
          String(
            selection?.outcome ||
            ""
          ).toLowerCase()
          !== "over"
        ) {

          continue;

        }


        // ----------------------------------------------------
        // TOTAL 0.5
        // ----------------------------------------------------

        const params =
          String(
            selection?.params ||
            ""
          )
          .toLowerCase()
          .replace(
            /\s/g,
            ""
          );


        if (
          params !==
          "total=0.5"
        ) {

          continue;

        }


        // ----------------------------------------------------
        // ENABLED ONLY
        // ----------------------------------------------------

        if (
          selection?.status !==
          "SELECTION_ENABLED"
        ) {

          continue;

        }


        // ----------------------------------------------------
        // BACK ONLY
        // ----------------------------------------------------

        if (
          selection?.side &&
          String(
            selection.side
          ).toUpperCase()
          !== "BACK"
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

    }

  }


  return null;

}


// ============================================================
// NORMALIZE EVENT
// ============================================================

function normalizeLiveEvent(event) {

  const market =
    findHTOver05(event);


  if (!market)
    return null;


  const score =
    getScore(event);


  const minute =
    getEventMinute(event);


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

    is_live:
      event?.status ===
      "TRADING_LIVE",

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

    bet: market

  };

}


// ============================================================
// LIVE EVENTS
// ============================================================

async function getLiveEvents(env) {

  // IMPORTANT:
  //
  // DO NOT SEND:
  //   from
  //   to
  //
  // Cloudbet live events request
  // rejects those parameters.
  //
  // ----------------------------------------------------------

  const data =
    await cloudbetFetch(
      "/events",
      env
    );


  const events =
    Array.isArray(
      data?.events
    )
      ? data.events
      : [];


  const liveEvents =
    events.filter(
      event =>
        event?.status ===
        "TRADING_LIVE"
    );


  const filtered = [];


  for (
    const event
    of liveEvents
  ) {

    const normalized =
      normalizeLiveEvent(
        event
      );


    if (!normalized)
      continue;


    filtered.push(
      normalized
    );

  }


  return {

    events_received:
      events.length,

    live_events:
      liveEvents.length,

    matching_events:
      filtered.length,

    matches:
      filtered

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

    filter: {

      sport:
        "soccer",

      market:
        "soccer.total_goals",

      period:
        "ht",

      outcome:
        "over",

      total:
        "0.5",

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
// FORMAT OUTPUT
// ============================================================

function formatMatches(
  result
) {

  return result.matches.map(
    match => ({

      id:
        match.id,

      name:
        match.name,

      minute:
        match.minute,

      minute_display:
        match.minute_display,

      score:
        match.score,

      competition:
        match.competition,

      over_05_ht: {

        price:
          match.bet.price,

        probability:
          match.bet.probability,

        minStake:
          match.bet.minStake,

        maxStake:
          match.bet.maxStake,

        status:
          match.bet.status,

        side:
          match.bet.side,

        marketUrl:
          match.bet.marketUrl

      }

    })
  );

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
          await getLiveEvents(
            env
          );


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

            total:
              "0.5",

            status:
              "SELECTION_ENABLED"

          },

          events_received:
            result.events_received,

          live_events:
            result.live_events,

          matching_events:
            result.matching_events,

          matches:
            formatMatches(
              result
            ),

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
