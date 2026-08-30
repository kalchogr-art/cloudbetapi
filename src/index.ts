// ============================================================
// CLOUDBET — LIVE HT OVER 0.5 V4
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
    const category of categories
  ) {

    const list =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition of list
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
// COMPETITION EVENTS
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
// LIVE
// ============================================================

function isLive(event) {

  return (
    event?.status ===
    "TRADING_LIVE"
  );

}


// ============================================================
// MINUTE
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

  const text =
    String(value).trim();

  if (!text) {
    return null;
  }

  let match =
    text.match(
      /^(\d{1,3})\s*:\s*\d{1,2}/
    );

  if (match) {
    return Number(match[1]);
  }

  match =
    text.match(
      /(\d{1,3})\s*['′]/
    );

  if (match) {
    return Number(match[1]);
  }

  match =
    text.match(
      /^(\d{1,3})$/
    );

  if (match) {
    return Number(match[1]);
  }

  return null;

}


// ============================================================
// FIND MINUTE
// ============================================================

function getMinute(event) {

  const values = [

    event?.minute,

    event?.matchMinute,

    event?.match_minute,

    event?.elapsedMinute,

    event?.elapsed_minute,

    event?.clock,

    event?.time,

    event?.matchTime,

    event?.match_time

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

  // ----------------------------------------------------------
  // NESTED OBJECTS
  // ----------------------------------------------------------

  const objects = [

    event?.clock,

    event?.time,

    event?.matchTime,

    event?.match_time

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

      object?.matchMinute,

      object?.match_minute,

      object?.elapsed,

      object?.value,

      object?.display

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

  let home = 0;
  let away = 0;

  if (
    event?.score &&
    typeof event.score === "object"
  ) {

    home =
      Number(
        event.score.home ??
        event.score.home_score ??
        0
      );

    away =
      Number(
        event.score.away ??
        event.score.away_score ??
        0
      );

  }

  if (
    event?.home &&
    typeof event.home === "object"
  ) {

    home =
      Number(
        event.home.score ??
        event.home.goals ??
        home
      );

  }

  if (
    event?.away &&
    typeof event.away === "object"
  ) {

    away =
      Number(
        event.away.score ??
        event.away.goals ??
        away
      );

  }

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
// HT OVER 0.5
// ============================================================
//
// IMPORTANT:
// We do NOT assume that the submarket key is exactly
// "period=ht".
// We inspect the key AND the submarket itself.
//
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
    const [marketKey, market]
    of Object.entries(markets)
  ) {

    const marketName =
      String(
        marketKey || ""
      ).toLowerCase();

    if (
      marketName !==
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

      const keyText =
        String(
          submarketKey || ""
        )
        .toLowerCase();

      const submarketString =
        JSON.stringify(
          submarket
        )
        .toLowerCase();

      // ------------------------------------------------------
      // FIRST HALF DETECTION
      // ------------------------------------------------------

      const firstHalf =
        keyText.includes(
          "period=ht"
        ) ||

        keyText.includes(
          "period=1h"
        ) ||

        keyText.includes(
          "period=first"
        ) ||

        keyText === "ht" ||

        keyText === "1h" ||

        keyText.includes(
          "first_half"
        ) ||

        keyText.includes(
          "first-half"
        ) ||

        submarketString.includes(
          '"period":"ht"'
        ) ||

        submarketString.includes(
          '"period":"1h"'
        ) ||

        submarketString.includes(
          '"period":"first_half"'
        );

      if (!firstHalf) {
        continue;
      }

      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];

      for (
        const selection of selections
      ) {

        const outcome =
          String(
            selection?.outcome || ""
          )
          .toLowerCase();

        if (
          outcome !== "over"
        ) {
          continue;
        }

        const params =
          String(
            selection?.params || ""
          )
          .toLowerCase();

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
            marketKey,

          submarket:
            submarketKey,

          outcome:
            selection.outcome,

          params:
            selection.params,

          odds:
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

          status:
            selection.status,

          side:
            selection?.side ||
            null,

          marketUrl:
            selection?.marketUrl ||
            null

        };

      }

    }

  }

  return null;

}


// ============================================================
// MATCH NORMALIZER
// ============================================================

function normalizeMatch(
  event,
  competition,
  bet
) {

  const home =
    typeof event?.home === "object"
      ? (
          event.home.name ||
          event.home.key ||
          null
        )
      : (
          event?.home ||
          null
        );

  const away =
    typeof event?.away === "object"
      ? (
          event.away.name ||
          event.away.key ||
          null
        )
      : (
          event?.away ||
          null
        );

  const score =
    getScore(event);

  const minute =
    getMinute(event);

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
        home && away
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
        bet.market,

      period:
        "ht",

      outcome:
        "over",

      total:
        "0.5",

      odds:
        bet.odds,

      probability:
        bet.probability,

      status:
        bet.status,

      side:
        bet.side,

      minStake:
        bet.minStake,

      maxStake:
        bet.maxStake,

      marketUrl:
        bet.marketUrl

    }

  };

}


// ============================================================
// LIVE SCAN
// ============================================================

async function scanLive(
  env,
  request
) {

  const soccerResult =
    await getSoccer(env);

  const competitions =
    extractCompetitions(
      soccerResult.data
    );

  const url =
    new URL(
      request.url
    );

  let limit =
    Number(
      url.searchParams.get(
        "limit"
      ) || "40"
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
          competition.eventCount || 0
        ) > 0
    );

  const matches = [];
  const errors = [];

  let liveEvents = 0;
  let totalEvents = 0;

  // ==========================================================
  // COMPETITIONS
  // ==========================================================

  for (
    const competition of usable
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

      totalEvents +=
        events.length;

      for (
        const event of events
      ) {

        if (
          !isLive(event)
        ) {
          continue;
        }

        liveEvents++;

        const bet =
          findHTOver05(
            event
          );

        if (!bet) {
          continue;
        }

        matches.push(

          normalizeMatch(
            event,
            competition,
            bet
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
  // SORT BY MINUTE
  // ==========================================================

  matches.sort(
    (a, b) => {

      const aMinute =
        a.minute === null
          ? -1
          : a.minute;

      const bMinute =
        b.minute === null
          ? -1
          : b.minute;

      return bMinute - aMinute;

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

      live:
        true,

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

    total_events:
      totalEvents,

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

async function health(env) {

  let exists = false;
  let length = 0;

  try {

    const key =
      getApiKey(env);

    exists = true;
    length = key.length;

  } catch {

    exists = false;

  }

  return {

    success:
      true,

    worker:
      "CLOUDBET LIVE HT OVER 0.5 V4",

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
      // LIVE HT OVER 0.5
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

    } catch (error) {

      return json(

        {

          success:
            false,

          worker:
            "CLOUDBET LIVE HT OVER 0.5 V4",

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
