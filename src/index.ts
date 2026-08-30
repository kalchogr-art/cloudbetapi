// ============================================================
// CLOUDBET LIVE MATCHES — LIGHT TEST
// ALL LIVE SOCCER
// NO HT OVER 0.5 FILTER
// NO SINGLE EVENT REQUESTS
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

async function cbFetch(
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
// SOCCER
// ============================================================

async function getSoccer(env) {

  return cbFetch(
    "/sports/soccer",
    env
  );

}


// ============================================================
// COMPETITIONS
// ============================================================

function getCompetitions(
  data
) {

  const result = [];

  const categories =
    Array.isArray(
      data?.categories
    )
      ? data.categories
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

      const eventCount =
        Number(
          competition.eventCount || 0
        );

      if (
        eventCount <= 0
      ) {
        continue;
      }

      result.push({

        key:
          competition.key,

        name:
          competition.name ||
          competition.key,

        eventCount

      });

    }

  }

  return result;
}


// ============================================================
// COMPETITION
// ============================================================

async function getCompetition(
  env,
  key
) {

  return cbFetch(
    `/competitions/${encodeURIComponent(key)}`,
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
      ""
    ).trim();

  }

  return "";
}


// ============================================================
// MATCH NAME
// ============================================================

function matchName(event) {

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

  return (
    event?.name ||
    event?.match ||
    null
  );

}


// ============================================================
// LIGHT EVENT
// ============================================================

function normalizeEvent(
  event,
  competition
) {

  return {

    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    match:
      matchName(
        event
      ),

    home:
      teamName(
        event?.home
      ),

    away:
      teamName(
        event?.away
      ),

    status:
      event?.status ||
      null,

    competition:
      competition?.name ||
      competition?.key ||
      null

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
      ) || "10"
    );

  if (
    !Number.isFinite(limit)
  ) {

    limit = 10;

  }

  limit =
    Math.max(
      1,
      Math.min(
        20,
        Math.floor(limit)
      )
    );

  const selected =
    competitions.slice(
      0,
      limit
    );

  const matches = [];

  const errors = [];

  let totalEvents = 0;

  let liveEvents = 0;


  // ==========================================================
  // SCAN ONLY LIMITED COMPETITIONS
  // ==========================================================

  for (
    const competition
    of selected
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

        if (
          !isLive(
            event
          )
        ) {

          continue;

        }

        liveEvents++;

        matches.push(
          normalizeEvent(
            event,
            competition
          )
        );

      }

    } catch (
      error
    ) {

      errors.push({

        competition:
          competition.key,

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
      "live-all-matches",

    test_mode:
      "ALL CLOUDBET LIVE MATCHES",

    filter:
      "NONE",

    source:
      "Cloudbet",

    sport:
      "soccer",

    catalogue: {

      competition_count:
        competitions.length,

      competitions_checked:
        selected.length

    },

    total_events:
      totalEvents,

    live_events:
      liveEvents,

    matches_found:
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

  let exists = false;

  try {

    exists =
      !!getApiKey(
        env
      );

  } catch {

    exists = false;

  }

  return {

    success:
      true,

    worker:
      "CLOUDBET LIVE MATCHES",

    mode:
      "LIGHT TEST",

    filter:
      "NONE",

    secret: {

      name:
        API_KEY_NAME,

      exists

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
      // LIVE JSON
      // ======================================================

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
            "/live?limit=5",
            "/live?limit=10",
            "/live?limit=20"
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
            "CLOUDBET LIVE MATCHES",

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
