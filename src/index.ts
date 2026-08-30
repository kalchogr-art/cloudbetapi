// ============================================================
// CLOUDBET — LIVE SOCCER DISCOVERY
// READ ONLY
// ЦЕЛ: намираме реалните футболни мачове на живо
// ============================================================

const API =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const KEY =
  "CLOUDBET_API_KEY";

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}

function apiKey(env) {
  const key = env?.[KEY];

  if (!key || typeof key !== "string") {
    throw new Error(`${KEY} secret is missing`);
  }

  return key.trim();
}

async function cb(path, env) {
  const response = await fetch(
    `${API}${path}`,
    {
      headers: {
        "accept": "application/json",
        "X-API-Key": apiKey(env),
        "cache-control": "no-cache"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Cloudbet HTTP ${response.status}`
    );
  }

  return data;
}

// ------------------------------------------------------------
// SOCCER CATALOGUE
// ------------------------------------------------------------

async function getSoccer(env) {
  return cb("/sports/soccer", env);
}

// ------------------------------------------------------------
// COMPETITIONS
// ------------------------------------------------------------

function competitions(data) {
  const result = [];

  for (const category of data?.categories || []) {

    for (const c of category?.competitions || []) {

      if (!c?.key) continue;

      result.push({
        key: c.key,
        name: c.name || c.key,
        eventCount: Number(c.eventCount || 0)
      });

    }

  }

  return result;
}

// ------------------------------------------------------------
// FIND MINUTE
// ------------------------------------------------------------

function minute(obj, depth = 0) {

  if (obj == null || depth > 7) {
    return null;
  }

  if (typeof obj === "number") {
    if (obj >= 0 && obj <= 130) {
      return Math.floor(obj);
    }
    return null;
  }

  if (typeof obj === "string") {

    let m = obj.match(
      /^(\d{1,3})\s*:\s*\d{1,2}/
    );

    if (m) return Number(m[1]);

    m = obj.match(
      /^(\d{1,3})\s*['′]/
    );

    if (m) return Number(m[1]);

    return null;
  }

  if (typeof obj !== "object") {
    return null;
  }

  const keys = [
    "minute",
    "minutes",
    "matchMinute",
    "match_minute",
    "elapsed",
    "elapsedMinute",
    "elapsed_minute",
    "clock",
    "matchTime",
    "match_time",
    "gameTime",
    "game_time",
    "currentMinute",
    "current_minute",
    "time"
  ];

  for (const key of keys) {

    if (
      Object.prototype.hasOwnProperty.call(
        obj,
        key
      )
    ) {

      const value =
        minute(
          obj[key],
          depth + 1
        );

      if (value !== null) {
        return value;
      }

    }

  }

  return null;
}

// ------------------------------------------------------------
// TEAM
// ------------------------------------------------------------

function team(value) {

  if (typeof value === "string") {
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

// ------------------------------------------------------------
// SCORE
// ------------------------------------------------------------

function score(event) {

  const s =
    event?.score ||
    event?.scores ||
    event?.result ||
    null;

  if (!s || typeof s !== "object") {
    return null;
  }

  return {
    home:
      s.home ??
      s.homeScore ??
      s.home_score ??
      null,

    away:
      s.away ??
      s.awayScore ??
      s.away_score ??
      null
  };
}

// ------------------------------------------------------------
// IS REAL FOOTBALL MATCH
// ------------------------------------------------------------

function isFootballMatch(event) {

  const home =
    team(event?.home);

  const away =
    team(event?.away);

  return Boolean(
    home &&
    away
  );
}

// ------------------------------------------------------------
// DISCOVER LIVE
// ------------------------------------------------------------

async function discover(env) {

  const soccer =
    await getSoccer(env);

  const list =
    competitions(soccer);

  const matches = [];
  const errors = [];

  let totalEvents = 0;

  let footballEvents = 0;

  let liveCandidates = 0;

  // ----------------------------------------------------------
  // CHECK ALL AVAILABLE COMPETITIONS
  // ----------------------------------------------------------

  for (const competition of list) {

    try {

      const data =
        await cb(
          `/competitions/${encodeURIComponent(
            competition.key
          )}`,
          env
        );

      const events =
        Array.isArray(data?.events)
          ? data.events
          : [];

      totalEvents +=
        events.length;

      for (const event of events) {

        if (!isFootballMatch(event)) {
          continue;
        }

        footballEvents++;

        // ----------------------------------------------------
        // LIVE INDICATORS
        // ----------------------------------------------------

        const m =
          minute(event);

        const status =
          String(
            event?.status || ""
          ).toUpperCase();

        const liveField =
          event?.live;

        const liveBoolean =
          liveField === true;

        const liveString =
          typeof liveField === "string" &&
          [
            "LIVE",
            "IN_PLAY",
            "TRADING_LIVE",
            "TRUE"
          ].includes(
            liveField.toUpperCase()
          );

        const looksLive =
          status === "TRADING_LIVE" ||
          liveBoolean ||
          liveString ||
          m !== null;

        if (!looksLive) {
          continue;
        }

        liveCandidates++;

        matches.push({

          id:
            event?.id ??
            null,

          key:
            event?.key ??
            null,

          name:
            event?.name ||
            `${team(event?.home)} - ${team(event?.away)}`,

          home:
            team(event?.home),

          away:
            team(event?.away),

          status:
            event?.status ??
            null,

          live:
            event?.live ??
            null,

          minute:
            m,

          score:
            score(event),

          competition: {
            key:
              competition.key,

            name:
              competition.name
          },

          event_keys:
            Object.keys(event || {})

        });

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

    success: true,

    test:
      "CLOUDBET LIVE SOCCER DISCOVERY",

    filter:
      "SOCCER + LIVE ONLY",

    source:
      "Cloudbet",

    catalogue: {

      competition_count:
        list.length

    },

    stats: {

      total_events:
        totalEvents,

      football_events:
        footballEvents,

      live_candidates:
        liveCandidates,

      matches_found:
        matches.length

    },

    matches,

    errors,

    timestamp:
      new Date().toISOString()

  };
}

// ============================================================
// WORKER
// ============================================================

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

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

        return json({

          success: true,

          worker:
            "cloudbet-live-soccer-discovery",

          mode:
            "READ ONLY",

          endpoint:
            "/live",

          secret:
            Boolean(env?.[KEY]),

          timestamp:
            new Date().toISOString()

        });

      }

      if (path === "/live") {

        return json(
          await discover(env)
        );

      }

      return json({

        success: false,

        error:
          "Unknown endpoint",

        available:
          [
            "/",
            "/health",
            "/live"
          ]

      }, 404);

    } catch (error) {

      return json({

        success: false,

        worker:
          "cloudbet-live-soccer-discovery",

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
