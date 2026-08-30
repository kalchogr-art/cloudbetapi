// ============================================================
// CLOUDBET API — LIVE SOCCER / HT OVER 0.5
// READ ONLY
// ============================================================
//
// Показва само:
//   LIVE футболни мачове
//   soccer.total_goals
//   period=ht
//   outcome=over
//   total=0.5
//   SELECTION_ENABLED
//
// Резултат:
//   match
//   home
//   away
//   minute
//   score
//   odds
//
// БЕЗ ЗАЛОЗИ
// ============================================================

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";


// ============================================================
// JSON
// ============================================================

function json(
  data,
  status = 200
) {

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
          "no-store",

        "access-control-allow-origin":
          "*"
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
        method:
          "GET",

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
    const category
    of categories
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
// EXTRACT MINUTE
// ============================================================
//
// Cloudbet may expose the live minute in different fields.
// We check the common possibilities.
//
// ============================================================

function getMinute(
  event
) {

  const directValues = [

    event?.minute,

    event?.match_minute,

    event?.current_minute,

    event?.live_minute,

    event?.clock,

    event?.matchTime,

    event?.match_time

  ];


  for (
    const value
    of directValues
  ) {

    const minute =
      parseMinute(
        value
      );


    if (
      minute !== null
    ) {

      return minute;

    }

  }


  // ----------------------------------------------------------
  // STATUS OBJECT
  // ----------------------------------------------------------

  const statusValues = [

    event?.status?.minute,

    event?.status?.clock,

    event?.status?.match_minute,

    event?.status?.matchTime

  ];


  for (
    const value
    of statusValues
  ) {

    const minute =
      parseMinute(
        value
      );


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

function parseMinute(
  value
) {

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
      !Number.isFinite(value)
    ) {

      return null;

    }


    return Math.floor(
      value
    );

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

      const parsed =
        parseMinute(
          item
        );


      if (
        parsed !== null
      ) {

        return parsed;

      }

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
      /^(\d{1,3}):/
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

    return Number(
      plain[1]
    );

  }


  return null;

}


// ============================================================
// LIVE STATUS
// ============================================================

function isLiveEvent(
  event
) {

  const status =
    String(
      event?.status ||
      ""
    )
    .toUpperCase();


  if (
    status ===
    "TRADING_LIVE"
  ) {

    return true;

  }


  if (
    event?.is_live === true
  ) {

    return true;

  }


  if (
    event?.isLive === true
  ) {

    return true;

  }


  return false;

}


// ============================================================
// FIND HT OVER 0.5
// ============================================================

function findHTOver05(
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
    totalGoals?.submarkets;


  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    return null;

  }


  // ----------------------------------------------------------
  // FIND period=ht
  // ----------------------------------------------------------

  for (
    const [
      submarketKey,
      submarket
    ]
    of Object.entries(
      submarkets
    )
  ) {

    const key =
      String(
        submarketKey || ""
      )
      .toLowerCase();


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


    // --------------------------------------------------------
    // EXACT OVER 0.5
    // --------------------------------------------------------

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
        params !==
        "total=0.5"
      ) {

        continue;

      }


      if (
        status !==
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
        price <= 0
      ) {

        continue;

      }


      return {

        market:
          "soccer.total_goals",

        submarket:
          "period=ht",

        outcome:
          "over",

        total:
          0.5,

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

function normalizeLiveMatch(
  event,
  competition,
  htOver05
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


  const homeScore =
    Number(
      event?.score?.home ??
      event?.home_score ??
      event?.scores?.home ??
      0
    );


  const awayScore =
    Number(
      event?.score?.away ??
      event?.away_score ??
      event?.scores?.away ??
      0
    );


  return {

    id:
      event?.id ??
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

    score: {

      home:
        homeScore,

      away:
        awayScore

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

    bet: {

      market:
        htOver05.market,

      period:
        "HT",

      selection:
        "OVER 0.5",

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
// LIVE SEARCH
// ============================================================

async function getLive(
  env
) {

  // ----------------------------------------------------------
  // LOAD SOCCER CATALOGUE
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // ALL COMPETITIONS
  // ----------------------------------------------------------

  const usable =
    competitions.filter(
      competition =>
        Number(
          competition.eventCount ||
          0
        ) > 0
    );


  const liveMatches = [];

  const errors = [];


  // ----------------------------------------------------------
  // CHECK ALL COMPETITIONS
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


      const events =
        Array.isArray(
          data?.events
        )
          ? data.events
          : [];


      for (
        const event
        of events
      ) {

        // ----------------------------------------------------
        // ONLY LIVE
        // ----------------------------------------------------

        if (
          !isLiveEvent(event)
        ) {

          continue;

        }


        // ----------------------------------------------------
        // ONLY HT OVER 0.5
        // ----------------------------------------------------

        const htOver05 =
          findHTOver05(
            event
          );


        if (
          !htOver05
        ) {

          continue;

        }


        liveMatches.push(

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


  return {

    success:
      true,

    endpoint:
      "live",

    source:
      "Cloudbet",

    sport:
      "soccer",

    catalogue: {

      competition_count:
        competitions.length,

      competitions_checked:
        usable.length,

      competitions_with_events:
        usable.length

    },

    matches_count:
      liveMatches.length,

    matches:
      liveMatches,

    errors

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
      "CLOUDBET HT OVER 0.5",

    mode:
      "READ ONLY",

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
            "CLOUDBET HT OVER 0.5",

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
