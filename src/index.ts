// ============================================================
// CLOUDBET — LIVE MATCH DIAGNOSTIC V2
//
// PURPOSE:
// READ ONLY diagnostic worker.
//
// IMPORTANT:
// HT OVER 0.5 FILTER IS DISABLED.
//
// We now collect ALL LIVE Cloudbet soccer events.
// Goal:
// 1. See real Cloudbet live matches
// 2. See exact team names
// 3. See exact event IDs
// 4. See minute data
// 5. Inspect market structure
// 6. Prepare correct data for V27 ↔ Cloudbet matcher
//
// NO BETTING.
// NO ORDERS.
// NO BETTING ACTIONS.
// ============================================================


const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const EVENT_API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";


// ============================================================
// JSON
// ============================================================

function json(data, status = 200) {

  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
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
  base,
  path,
  env
) {

  const apiKey =
    getApiKey(env);

  const response =
    await fetch(
      `${base}${path}`,
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
// SOCCER
// ============================================================

async function getSoccer(env) {

  return cloudbetFetch(
    API_BASE,
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
    const category
    of categories
  ) {

    const list =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];


    for (
      const competition
      of list
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
    API_BASE,

    `/competitions/${encodeURIComponent(
      competitionKey
    )}`,

    env
  );

}


// ============================================================
// SINGLE EVENT
// ============================================================

async function getEvent(
  env,
  eventId
) {

  return cloudbetFetch(
    EVENT_API_BASE,

    `/events/${encodeURIComponent(
      eventId
    )}`,

    env
  );

}


// ============================================================
// LIVE
// ============================================================

function isLive(event) {

  return (
    String(
      event?.status ||
      ""
    ).toUpperCase()
    ===
    "TRADING_LIVE"
  );

}


// ============================================================
// DEEP MINUTE SEARCH
// ============================================================

function findMinuteDeep(
  obj,
  depth = 0
) {

  if (
    obj === null ||
    obj === undefined ||
    depth > 8
  ) {

    return null;

  }


  if (
    typeof obj === "number"
  ) {

    if (
      Number.isFinite(obj) &&
      obj >= 0 &&
      obj <= 130
    ) {

      return Math.floor(
        obj
      );

    }

    return null;

  }


  if (
    typeof obj === "string"
  ) {

    const text =
      obj.trim();

    if (!text) {

      return null;

    }


    let match =
      text.match(
        /^(\d{1,3})\s*:\s*\d{1,2}/
      );

    if (match) {

      return Number(
        match[1]
      );

    }


    match =
      text.match(
        /^(\d{1,3})\s*['′]/
      );

    if (match) {

      return Number(
        match[1]
      );

    }


    return null;

  }


  if (
    typeof obj !== "object"
  ) {

    return null;

  }


  const preferredKeys = [

    "minute",

    "minutes",

    "matchMinute",

    "match_minute",

    "elapsedMinute",

    "elapsed_minute",

    "elapsed",

    "clock",

    "matchTime",

    "match_time",

    "gameTime",

    "game_time",

    "currentMinute",

    "current_minute",

    "time",

    "timer",

    "periodTime",

    "period_time"

  ];


  for (
    const key
    of preferredKeys
  ) {

    if (
      !Object.prototype.hasOwnProperty.call(
        obj,
        key
      )
    ) {

      continue;

    }


    const parsed =
      findMinuteDeep(
        obj[key],
        depth + 1
      );


    if (
      parsed !== null
    ) {

      return parsed;

    }

  }


  return null;

}


// ============================================================
// TEAM NAME
// ============================================================

function getTeamName(team) {

  if (
    typeof team === "string"
  ) {

    return team.trim();

  }


  if (
    team &&
    typeof team === "object"
  ) {

    return String(
      team.name ||
      team.key ||
      team.abbreviation ||
      ""
    ).trim();

  }


  return "";

}


// ============================================================
// TEAM EXTRACTION
// ============================================================

function resolveTeams(
  event
) {

  const directHome =
    getTeamName(
      event?.home
    );

  const directAway =
    getTeamName(
      event?.away
    );


  if (
    directHome &&
    directAway
  ) {

    return {

      home:
        directHome,

      away:
        directAway,

      source:
        "fields"

    };

  }


  const text =
    String(
      event?.name ||
      event?.match ||
      event?.event_name ||
      event?.eventName ||
      ""
    ).trim();


  if (text) {

    let match =
      text.match(
        /^(.+?)\s+-\s+(.+)$/
      );


    if (match) {

      return {

        home:
          match[1].trim(),

        away:
          match[2].trim(),

        source:
          "name"

      };

    }


    match =
      text.match(
        /^(.+?)\s+v\s+(.+)$/i
      );


    if (match) {

      return {

        home:
          match[1].trim(),

        away:
          match[2].trim(),

        source:
          "name"

      };

    }


    match =
      text.match(
        /^(.+?)\s+vs\.?\s+(.+)$/i
      );


    if (match) {

      return {

        home:
          match[1].trim(),

        away:
          match[2].trim(),

        source:
          "name"

      };

    }


    match =
      text.match(
        /^(.+?)\s+@\s+(.+)$/
      );


    if (match) {

      return {

        home:
          match[2].trim(),

        away:
          match[1].trim(),

        source:
          "name"

      };

    }

  }


  return {

    home:
      directHome,

    away:
      directAway,

    source:
      "partial"

  };

}


// ============================================================
// SCORE
// ============================================================

function findScoreDeep(
  obj,
  depth = 0
) {

  if (
    obj === null ||
    obj === undefined ||
    depth > 8
  ) {

    return null;

  }


  if (
    typeof obj !== "object"
  ) {

    return null;

  }


  const homeKeys = [

    "home",

    "homeScore",

    "home_score",

    "scoreHome",

    "homeGoals",

    "home_goals"

  ];


  const awayKeys = [

    "away",

    "awayScore",

    "away_score",

    "scoreAway",

    "awayGoals",

    "away_goals"

  ];


  let home =
    null;

  let away =
    null;


  for (
    const key
    of homeKeys
  ) {

    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        key
      )
    ) {

      const value =
        Number(
          obj[key]
        );


      if (
        Number.isFinite(value)
      ) {

        home =
          Math.floor(
            value
          );

        break;

      }

    }

  }


  for (
    const key
    of awayKeys
  ) {

    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        key
      )
    ) {

      const value =
        Number(
          obj[key]
        );


      if (
        Number.isFinite(value)
      ) {

        away =
          Math.floor(
            value
          );

        break;

      }

    }

  }


  if (
    home !== null &&
    away !== null
  ) {

    return {

      home,

      away

    };

  }


  for (
    const value
    of Object.values(
      obj
    )
  ) {

    if (
      value &&
      typeof value === "object"
    ) {

      const found =
        findScoreDeep(
          value,
          depth + 1
        );


      if (
        found
      ) {

        return found;

      }

    }

  }


  return null;

}


// ============================================================
// MARKET SUMMARY
// ============================================================

function inspectMarkets(
  event
) {

  const markets =
    event?.markets;


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    return {

      exists:
        false,

      count:
        0,

      keys:
        []

    };

  }


  const keys =
    Object.keys(
      markets
    );


  return {

    exists:
      true,

    count:
      keys.length,

    keys:
      keys.slice(
        0,
        100
      )

  };

}


// ============================================================
// HT MARKET INSPECTION
//
// IMPORTANT:
// This does NOT filter the match.
// It only tells us whether the HT market exists.
// ============================================================

function inspectHTMarket(
  event
) {

  const markets =
    event?.markets;


  if (
    !markets ||
    typeof markets !== "object"
  ) {

    return {

      exists:
        false,

      market:
        null,

      submarkets:
        []

    };

  }


  const marketKey =
    "soccer.total_goals_period_first_half";


  const market =
    markets[
      marketKey
    ];


  if (
    !market ||
    typeof market !== "object"
  ) {

    return {

      exists:
        false,

      market:
        null,

      submarkets:
        []

    };

  }


  const submarkets =
    market?.submarkets;


  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    return {

      exists:
        true,

      market:
        marketKey,

      submarkets:
        []

    };

  }


  const result = [];


  for (
    const [
      key,
      submarket
    ]
    of Object.entries(
      submarkets
    )
  ) {

    const selections =
      Array.isArray(
        submarket?.selections
      )
        ? submarket.selections
        : [];


    result.push({

      key,

      selection_count:
        selections.length,

      selections:
        selections
          .slice(
            0,
            20
          )
          .map(
            selection => ({

              outcome:
                selection?.outcome ??
                null,

              params:
                selection?.params ??
                null,

              price:
                selection?.price ??
                null,

              probability:
                selection?.probability ??
                null,

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


  return {

    exists:
      true,

    market:
      marketKey,

    submarkets:
      result

  };

}


// ============================================================
// NORMALIZE EVENT
// ============================================================

async function normalizeMatch(
  env,
  event,
  competition
) {

  const teams =
    resolveTeams(
      event
    );


  let eventDetails =
    null;


  let minute =
    findMinuteDeep(
      event
    );


  let score =
    findScoreDeep(
      event
    );


  // ----------------------------------------------------------
  // SINGLE EVENT ENDPOINT
  // ----------------------------------------------------------

  try {

    if (
      event?.id
    ) {

      eventDetails =
        await getEvent(
          env,
          event.id
        );


      const detailMinute =
        findMinuteDeep(
          eventDetails
        );


      if (
        detailMinute !== null
      ) {

        minute =
          detailMinute;

      }


      const detailScore =
        findScoreDeep(
          eventDetails
        );


      if (
        detailScore
      ) {

        score =
          detailScore;

      }

    }

  } catch {

    eventDetails =
      null;

  }


  const marketInfo =
    inspectMarkets(
      eventDetails ||
      event
    );


  const htMarket =
    inspectHTMarket(
      eventDetails ||
      event
    );


  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    name:
      event?.name ??
      event?.match ??
      null,

    home:
      teams.home,

    away:
      teams.away,

    team_source:
      teams.source,

    status:
      event?.status ??
      null,

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : null,

    score,

    competition: {

      key:
        competition?.key ??
        null,

      name:
        competition?.name ??
        null

    },

    market_info:
      marketInfo,

    ht_market:
      htMarket,

    event_detail_loaded:
      !!eventDetails

  };

}


// ============================================================
// LIVE SCAN
// ============================================================

async function scanLive(
  env,
  request
) {

  const soccer =
    await getSoccer(
      env
    );


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

    limit =
      40;

  }


  limit =
    Math.max(
      1,
      Math.min(
        100,
        Math.floor(
          limit
        )
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
          competition.eventCount ||
          0
        ) > 0
    );


  const matches = [];

  const errors = [];


  let totalEvents =
    0;

  let liveEvents =
    0;


  // ==========================================================
  // SCAN COMPETITIONS
  // ==========================================================

  for (
    const competition
    of usable
  ) {

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


      totalEvents +=
        events.length;


      for (
        const event
        of events
      ) {

        // ----------------------------------------------------
        // IMPORTANT:
        // NO HT OVER 0.5 FILTER HERE.
        // ALL LIVE EVENTS ARE KEPT.
        // ----------------------------------------------------

        if (
          !isLive(
            event
          )
        ) {

          continue;

        }


        liveEvents++;


        const match =
          await normalizeMatch(
            env,
            event,
            competition
          );


        matches.push(
          match
        );

      }

    } catch (
      error
    ) {

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
  // SORT BY MINUTE
  // ==========================================================

  matches.sort(
    (
      a,
      b
    ) => {

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
  // STATS
  // ==========================================================

  const withNames =
    matches.filter(
      match =>
        match.home &&
        match.away
    ).length;


  const withMinute =
    matches.filter(
      match =>
        match.minute !== null
    ).length;


  const withScore =
    matches.filter(
      match =>
        match.score &&
        match.score.home !== null &&
        match.score.away !== null
    ).length;


  const withHTMarket =
    matches.filter(
      match =>
        match.ht_market?.exists
    ).length;


  return {

    success:
      true,

    endpoint:
      "live-all-matches",

    source:
      "Cloudbet",

    sport:
      "soccer",

    test_mode:
      "ALL CLOUDBET MATCHES — HT OVER 0.5 FILTER DISABLED",

    filter: {

      live:
        true,

      status:
        "TRADING_LIVE",

      ht_over_05:
        "DISABLED",

      betting:
        "DISABLED"

    },

    catalogue: {

      competition_count:
        competitions.length,

      competitions_checked:
        selected.length,

      competitions_with_events:
        usable.length

    },

    stats: {

      total_events:
        totalEvents,

      live_events:
        liveEvents,

      matches_returned:
        matches.length,

      matches_with_names:
        withNames,

      matches_with_minute:
        withMinute,

      matches_with_score:
        withScore,

      matches_with_ht_market:
        withHTMarket

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
      "CLOUDBET LIVE MATCH DIAGNOSTIC V2",

    mode:
      "READ ONLY",

    ht_over_05_filter:
      "DISABLED",

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
          await health(
            env
          )
        );

      }


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

      if (
        path === "/live"
      ) {

        return json(
          await scanLive(
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

            "/live?limit=40",

            "/live?limit=100"

          ]

        },

        404

      );

    } catch (
      error
    ) {

      return json(

        {

          success:
            false,

          worker:
            "CLOUDBET LIVE MATCH DIAGNOSTIC V2",

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
