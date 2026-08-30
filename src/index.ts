// ============================================================
// CLOUDBET — DEBUG TOTAL GOALS
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
// DEBUG
// ============================================================

async function debugCloudbet(
  env
) {

  const soccer =
    await getSoccer(env);


  const competitions =
    extractCompetitions(
      soccer
    );


  let checked =
    0;

  let liveCount =
    0;


  // ----------------------------------------------------------
  // CHECK FIRST 100 COMPETITIONS
  // ----------------------------------------------------------

  for (
    const competition
    of competitions.slice(0, 100)
  ) {

    if (
      Number(
        competition.eventCount || 0
      ) <= 0
    ) {

      continue;

    }


    checked++;


    let data;


    try {

      data =
        await cloudbetFetch(
          `/competitions/${encodeURIComponent(
            competition.key
          )}`,
          env
        );

    } catch {

      continue;

    }


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

      if (
        event?.status !==
        "TRADING_LIVE"
      ) {

        continue;

      }


      liveCount++;


      const markets =
        event?.markets;


      if (
        !markets ||
        typeof markets !== "object"
      ) {

        continue;

      }


      // ------------------------------------------------------
      // FIND TOTAL GOALS MARKET
      // ------------------------------------------------------

      for (
        const [marketKey, market]
        of Object.entries(
          markets
        )
      ) {

        if (
          String(
            marketKey
          ).toLowerCase()
            !==
          "soccer.total_goals"
        ) {

          continue;

        }


        // ----------------------------------------------------
        // FOUND IT
        // ----------------------------------------------------

        return {

          success:
            true,

          endpoint:
            "debug",

          source:
            "Cloudbet",

          live_events_seen:
            liveCount,

          competitions_checked:
            checked,

          match: {

            id:
              event?.id ??
              null,

            key:
              event?.key ??
              null,

            name:
              event?.name ??
              null,

            home:
              event?.home ??
              null,

            away:
              event?.away ??
              null,

            status:
              event?.status ??
              null

          },

          total_goals_market: {

            market_key:
              marketKey,

            market:

              market

          },

          all_market_keys:
            Object.keys(
              markets
            ),

          timestamp:
            new Date().toISOString()

        };

      }

    }

  }


  return {

    success:
      true,

    endpoint:
      "debug",

    source:
      "Cloudbet",

    message:
      "No LIVE soccer.total_goals market found",

    live_events_seen:
      liveCount,

    competitions_checked:
      checked,

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
      "CLOUDBET DEBUG TOTAL GOALS",

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

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json(
          await health(env)
        );

      }


      if (
        path === "/debug"
      ) {

        return json(
          await debugCloudbet(env)
        );

      }


      return json(

        {

          success:
            false,

          error:
            "Unknown endpoint",

          available_endpoints: [

            "/",

            "/health",

            "/debug"

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
            "CLOUDBET DEBUG TOTAL GOALS",

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
