// ============================================================
// CLOUDBET — FAST LIVE SOCCER DISCOVERY
// READ ONLY
// ============================================================

const API =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const KEY =
  "CLOUDBET_API_KEY";

const MAX_COMPETITIONS = 40;
const BATCH_SIZE = 8;

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

function getKey(env) {
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
      method: "GET",
      headers: {
        accept: "application/json",
        "X-API-Key": getKey(env),
        "cache-control": "no-cache"
      }
    }
  );

  const text = await response.text();

  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      `Cloudbet HTTP ${response.status}`
    );
  }

  return data;
}

// ============================================================
// SOCCER CATALOGUE
// ============================================================

async function getSoccer(env) {
  return cb("/sports/soccer", env);
}

// ============================================================
// COMPETITIONS
// ============================================================

function getCompetitions(data) {
  const result = [];

  for (const category of data?.categories || []) {

    for (const competition of category?.competitions || []) {

      if (!competition?.key) continue;

      result.push({
        key: competition.key,
        name:
          competition.name ||
          competition.key,
        eventCount:
          Number(
            competition.eventCount || 0
          )
      });

    }
  }

  return result;
}

// ============================================================
// TEAM
// ============================================================

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

// ============================================================
// MINUTE
// ============================================================

function getMinute(obj) {

  if (!obj || typeof obj !== "object") {
    return null;
  }

  const keys = [
    "minute",
    "matchMinute",
    "match_minute",
    "elapsed",
    "elapsedMinute",
    "elapsed_minute",
    "currentMinute",
    "current_minute",
    "clock",
    "matchTime",
    "match_time",
    "gameTime",
    "game_time",
    "time"
  ];

  for (const key of keys) {

    const value = obj[key];

    if (
      typeof value === "number" &&
      value >= 0 &&
      value <= 130
    ) {
      return Math.floor(value);
    }

    if (typeof value === "string") {

      let m =
        value.match(
          /^(\d{1,3})\s*:\s*\d{1,2}/
        );

      if (m) {
        return Number(m[1]);
      }

      m =
        value.match(
          /^(\d{1,3})\s*['′]/
        );

      if (m) {
        return Number(m[1]);
      }

    }
  }

  return null;
}

// ============================================================
// SCORE
// ============================================================

function getScore(event) {

  const s =
    event?.score ||
    event?.scores ||
    event?.result;

  if (
    !s ||
    typeof s !== "object"
  ) {
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

// ============================================================
// REAL MATCH
// ============================================================

function isMatch(event) {

  const home =
    team(event?.home);

  const away =
    team(event?.away);

  return Boolean(
    home &&
    away
  );
}

// ============================================================
// LIVE CHECK
// ============================================================

function isLive(event) {

  const status =
    String(
      event?.status || ""
    ).toUpperCase();

  const live =
    event?.live;

  if (
    status === "TRADING_LIVE"
  ) {
    return true;
  }

  if (
    live === true
  ) {
    return true;
  }

  if (
    typeof live === "string" &&
    [
      "LIVE",
      "IN_PLAY",
      "TRADING_LIVE",
      "TRUE"
    ].includes(
      live.toUpperCase()
    )
  ) {
    return true;
  }

  return false;
}

// ============================================================
// FETCH COMPETITION
// ============================================================

async function fetchCompetition(
  competition,
  env
) {

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

    return {
      competition,
      events,
      error: null
    };

  } catch (error) {

    return {
      competition,
      events: [],
      error:
        error?.message ||
        String(error)
    };

  }
}

// ============================================================
// FAST DISCOVERY
// ============================================================

async function discover(env) {

  const soccer =
    await getSoccer(env);

  const all =
    getCompetitions(soccer);

  const selected =
    all
      .filter(
        c =>
          c.eventCount > 0
      )
      .slice(
        0,
        MAX_COMPETITIONS
      );

  const matches = [];
  const errors = [];

  let totalEvents = 0;
  let footballEvents = 0;
  let liveEvents = 0;

  // ----------------------------------------------------------
  // PARALLEL BATCHES
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < selected.length;
    i += BATCH_SIZE
  ) {

    const batch =
      selected.slice(
        i,
        i + BATCH_SIZE
      );

    const results =
      await Promise.all(
        batch.map(
          competition =>
            fetchCompetition(
              competition,
              env
            )
        )
      );

    for (
      const result
      of results
    ) {

      if (result.error) {

        errors.push({
          competition:
            result.competition.key,
          name:
            result.competition.name,
          error:
            result.error
        });

        continue;
      }

      totalEvents +=
        result.events.length;

      for (
        const event
        of result.events
      ) {

        if (!isMatch(event)) {
          continue;
        }

        footballEvents++;

        if (!isLive(event)) {
          continue;
        }

        liveEvents++;

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
            getMinute(event),

          score:
            getScore(event),

          competition: {
            key:
              result.competition.key,

            name:
              result.competition.name
          },

          event_keys:
            Object.keys(event || {})

        });
      }
    }

    // --------------------------------------------------------
    // IF WE FOUND LIVE MATCHES, STOP SCANNING
    // --------------------------------------------------------

    if (matches.length > 0) {
      break;
    }
  }

  // ==========================================================
  // SORT
  // ==========================================================

  matches.sort(
    (a, b) => {

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
  // RESULT
  // ==========================================================

  return {

    success: true,

    test:
      "CLOUDBET FAST LIVE SOCCER",

    filter:
      "SOCCER + LIVE ONLY",

    source:
      "Cloudbet",

    stats: {

      competition_count:
        all.length,

      competitions_checked:
        selected.length,

      total_events:
        totalEvents,

      football_events:
        footballEvents,

      live_events:
        liveEvents,

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

  async fetch(
    request,
    env
  ) {

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
            "cloudbet-fast-live-soccer",

          mode:
            "READ ONLY",

          endpoint:
            "/live",

          secret:
            Boolean(
              env?.[KEY]
            ),

          timestamp:
            new Date().toISOString()

        });

      }

      if (
        path === "/live"
      ) {

        return json(
          await discover(env)
        );

      }

      return json({

        success: false,

        error:
          "Unknown endpoint",

        available: [
          "/",
          "/health",
          "/live"
        ]

      }, 404);

    } catch (error) {

      return json({

        success: false,

        worker:
          "cloudbet-fast-live-soccer",

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
