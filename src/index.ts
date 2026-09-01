// ============================================================
// CLOUDBET — FAST LIVE SOCCER DETECTOR V2
// READ ONLY
//
// V2 FIX:
// - Добавен /search endpoint
// - Търсене на САМИЯ МАЧ по HOME + AWAY
// - НЕ търси резултат
// - НЕ изисква мачът да е live за да бъде намерен
// - След намиране връща status/live/minute/score
// - Не прави request към всеки event
// - Съществуващият /live остава същият
//
// БЕЗ:
// - HT OVER 0.5
// - betting
// - odds logic
// - matcher
// - V27
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
// BASIC
// ============================================================

function safeString(v) {
  return String(v ?? "").trim();
}


// ============================================================
// NORMALIZATION
// ============================================================

const TEAM_ALIASES = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "man u": "manchester united",
  "manchester utd": "manchester united",
  "psg": "paris saint germain",
  "paris sg": "paris saint germain",
  "inter": "inter milan",
  "inter milano": "inter milan",
  "internazionale": "inter milan",
  "fc internazionale": "inter milan",
  "atletico": "atletico madrid",
  "atletico de madrid": "atletico madrid",
  "sporting cp": "sporting lisbon",
  "sporting lisboa": "sporting lisbon",
  "red star": "crvena zvezda",
  "red star belgrade": "crvena zvezda",
  "psv eindhoven": "psv",
  "bayern munchen": "bayern munich",
  "utd": "united",
  "ath": "athletic",
  "dep": "deportivo",
  "depor": "deportivo"
};

const GENERIC_WORDS = new Set([
  "fc",
  "cf",
  "sc",
  "ac",
  "afc",
  "ca",
  "cd",
  "sd",
  "ss",
  "as",
  "us",
  "ud",
  "aa",
  "ad",
  "rc",
  "fk",
  "sk",
  "ks",
  "sv",
  "vfb",
  "vfl",
  "club",
  "calcio",
  "football",
  "soccer"
]);

function normalizeText(v) {
  return safeString(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyAliases(v) {
  let r = normalizeText(v);

  for (const alias of Object.keys(TEAM_ALIASES)) {
    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    r = r.replace(
      new RegExp(
        `(^|\\s)${escaped}(?=\\s|$)`,
        "g"
      ),
      `$1${TEAM_ALIASES[alias]}`
    );
  }

  return r.replace(/\s+/g, " ").trim();
}

function normalizeTeam(v) {
  return applyAliases(v)
    .split(" ")
    .filter(Boolean)
    .filter(x => !GENERIC_WORDS.has(x))
    .filter(x => !/^\d+$/.test(x))
    .join(" ")
    .trim();
}

function teamTokens(v) {
  return normalizeTeam(v)
    .split(" ")
    .filter(x => x.length >= 3);
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev =
    Array.from(
      { length: b.length + 1 },
      (_, i) => i
    );

  let curr =
    new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost =
        a[i - 1] === b[j - 1]
          ? 0
          : 1;

      curr[j] =
        Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
    }

    [prev, curr] =
      [curr, prev];
  }

  return prev[b.length];
}


function characterSimilarity(a, b) {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  return Math.max(
    0,
    1 -
      levenshtein(A, B) /
      Math.max(
        A.length,
        B.length
      )
  );
}


// ============================================================
// TEAM MATCH
// ============================================================

function teamScore(a, b) {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) {
    return {
      score: 0,
      method: "EMPTY"
    };
  }

  if (A === B) {
    return {
      score: 1,
      method: "EXACT"
    };
  }

  if (
    A.includes(B) ||
    B.includes(A)
  ) {
    return {
      score: Math.max(
        0.75,
        Math.min(A.length, B.length) /
          Math.max(A.length, B.length)
      ),
      method: "CONTAINMENT"
    };
  }

  const common =
    teamTokens(A).filter(
      x =>
        teamTokens(B).includes(x)
    );

  if (common.length >= 1) {
    const score =
      common.length /
      Math.max(
        teamTokens(A).length,
        teamTokens(B).length
      );

    if (score >= 0.75) {
      return {
        score,
        method: "TOKEN_STRONG",
        common_tokens: common
      };
    }
  }

  return {
    score:
      characterSimilarity(A, B),
    method:
      "CHARACTER_SIMILARITY"
  };
}


function strictMatch(
  homeA,
  awayA,
  homeB,
  awayB
) {
  const normalHome =
    teamScore(homeA, homeB);

  const normalAway =
    teamScore(awayA, awayB);

  const reverseHome =
    teamScore(homeA, awayB);

  const reverseAway =
    teamScore(awayA, homeB);

  const normalScore =
    Math.min(
      normalHome.score,
      normalAway.score
    );

  const reverseScore =
    Math.min(
      reverseHome.score,
      reverseAway.score
    );

  const normalValid =
    normalHome.score >= 0.70 &&
    normalAway.score >= 0.70;

  const reverseValid =
    reverseHome.score >= 0.70 &&
    reverseAway.score >= 0.70;

  if (
    normalValid &&
    normalScore >= reverseScore
  ) {
    return {
      matched: true,
      direction: "NORMAL",
      home_score:
        normalHome.score,
      away_score:
        normalAway.score,
      combined_score:
        normalScore
    };
  }

  if (reverseValid) {
    return {
      matched: true,
      direction: "REVERSED",
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      combined_score:
        reverseScore
    };
  }

  return {
    matched: false,
    direction:
      normalScore >= reverseScore
        ? "NORMAL"
        : "REVERSED",
    home_score:
      normalScore >= reverseScore
        ? normalHome.score
        : reverseHome.score,
    away_score:
      normalScore >= reverseScore
        ? normalAway.score
        : reverseAway.score,
    combined_score:
      Math.max(
        normalScore,
        reverseScore
      )
  };
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

async function cloudbetFetch(
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
  return cloudbetFetch(
    "/sports/soccer",
    env
  );
}


// ============================================================
// COMPETITIONS
// ============================================================

function getCompetitions(
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
    const category
    of categories
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
      if (!competition?.key) {
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
// COMPETITION
// ============================================================

async function getCompetition(
  env,
  key
) {
  return cloudbetFetch(
    `/competitions/${encodeURIComponent(key)}`,
    env
  );
}


// ============================================================
// LIVE
// ============================================================

function isLive(event) {

  if (
    event?.status ===
    "TRADING_LIVE"
  ) {
    return true;
  }

  if (
    event?.live === true
  ) {
    return true;
  }

  if (
    event?.isLive === true
  ) {
    return true;
  }

  if (
    event?.inPlay === true
  ) {
    return true;
  }

  if (
    event?.in_play === true
  ) {
    return true;
  }

  if (
    event?.state ===
    "LIVE"
  ) {
    return true;
  }

  if (
    event?.state ===
    "IN_PLAY"
  ) {
    return true;
  }

  return false;
}


// ============================================================
// TEAM NAME
// ============================================================

function teamName(value) {

  if (
    typeof value ===
    "string"
  ) {
    return value.trim();
  }

  if (
    value &&
    typeof value ===
    "object"
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
// MATCH NAME
// ============================================================

function getMatchName(event) {

  const direct =
    event?.name ||
    event?.match ||
    event?.event_name ||
    event?.eventName;

  if (direct) {
    return String(direct);
  }

  const home =
    teamName(event?.home);

  const away =
    teamName(event?.away);

  if (home && away) {
    return `${home} - ${away}`;
  }

  return null;
}


// ============================================================
// MINUTE
// ============================================================

function findMinute(event) {

  const values = [
    event?.minute,
    event?.matchMinute,
    event?.match_minute,
    event?.elapsed,
    event?.elapsedMinute,
    event?.elapsed_minute,
    event?.clock,
    event?.matchTime,
    event?.match_time,
    event?.gameTime,
    event?.game_time,
    event?.currentMinute,
    event?.current_minute,
    event?.time
  ];

  for (
    const value
    of values
  ) {

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      if (
        value >= 0 &&
        value <= 130
      ) {
        return Math.floor(value);
      }
    }

    if (
      typeof value === "string"
    ) {
      const text =
        value.trim();

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

      if (
        /^\d{1,3}$/.test(text)
      ) {
        const n =
          Number(text);

        if (
          n >= 0 &&
          n <= 130
        ) {
          return n;
        }
      }
    }
  }

  return null;
}


// ============================================================
// SCORE
// ============================================================

function getScore(event) {

  const score =
    event?.score ||
    event?.scores ||
    event?.result ||
    null;

  if (
    !score ||
    typeof score !== "object"
  ) {
    return {
      home: null,
      away: null
    };
  }

  const home =
    Number(
      score.home ??
      score.homeScore ??
      score.home_score
    );

  const away =
    Number(
      score.away ??
      score.awayScore ??
      score.away_score
    );

  return {
    home:
      Number.isFinite(home)
        ? home
        : null,

    away:
      Number.isFinite(away)
        ? away
        : null
  };
}


// ============================================================
// BUILD MATCH
// ============================================================

function buildMatch(
  event,
  competition
) {
  const home =
    teamName(event?.home);

  const away =
    teamName(event?.away);

  const minute =
    findMinute(event);

  return {
    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    match:
      getMatchName(event),

    home,

    away,

    status:
      event?.status ??
      null,

    live:
      event?.live ??
      null,

    is_live:
      isLive(event),

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : null,

    score:
      getScore(event),

    competition: {
      key:
        competition?.key ??
        null,

      name:
        competition?.name ??
        null
    }
  };
}


// ============================================================
// /LIVE SCAN
// ============================================================

async function scan(
  env,
  request
) {
  const soccer =
    await getSoccer(env);

  const competitions =
    getCompetitions(soccer);

  const url =
    new URL(request.url);

  let limit =
    Number(
      url.searchParams.get(
        "limit"
      ) ||
      "100"
    );

  if (
    !Number.isFinite(limit)
  ) {
    limit = 100;
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
    competitions
      .filter(
        c =>
          Number(
            c.eventCount ||
            0
          ) > 0
      )
      .slice(0, limit);

  const matches = [];
  const errors = [];

  let totalEvents = 0;
  let liveEvents = 0;

  const results =
    await Promise.all(
      selected.map(
        async competition => {
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
      )
    );

  for (
    const result
    of results
  ) {

    totalEvents +=
      result.events.length;

    if (
      result.error
    ) {
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

    for (
      const event
      of result.events
    ) {

      if (
        !isLive(event)
      ) {
        continue;
      }

      liveEvents++;

      const match =
        buildMatch(
          event,
          result.competition
        );

      if (
        !match.home ||
        !match.away
      ) {
        continue;
      }

      matches.push(match);
    }
  }

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

  return {
    success: true,

    test:
      "CLOUDBET ALL LIVE SOCCER",

    filter:
      "SOCCER + LIVE ONLY",

    source:
      "Cloudbet",

    sport:
      "soccer",

    stats: {
      competition_count:
        competitions.length,

      competitions_checked:
        selected.length,

      total_events:
        totalEvents,

      live_events_detected:
        liveEvents,

      live_matches:
        matches.length,

      errors:
        errors.length
    },

    matches,

    errors,

    timestamp:
      new Date().toISOString()
  };
}


// ============================================================
// SEARCH MATCH
//
// ВАЖНО:
// Търси САМИЯ EVENT / МАЧ.
// НЕ търси резултат.
//
// Използване:
//
// /search?home=Fakel%20Voronezh&away=Krasnodar
//
// /search?home=LSK%20Kvinner%20W&away=Bodo-Glimt%20W
// ============================================================

async function searchMatch(
  env,
  request
) {
  const url =
    new URL(request.url);

  const requestedHome =
    safeString(
      url.searchParams.get(
        "home"
      )
    );

  const requestedAway =
    safeString(
      url.searchParams.get(
        "away"
      )
    );

  if (
    !requestedHome ||
    !requestedAway
  ) {
    return {
      success: false,

      search: {
        performed: false
      },

      error:
        "home and away are required",

      example:
        "/search?home=Fakel%20Voronezh&away=Krasnodar"
    };
  }

  const soccer =
    await getSoccer(env);

  const competitions =
    getCompetitions(soccer);

  const selected =
    competitions.filter(
      c =>
        Number(
          c.eventCount ||
          0
        ) > 0
    );

  const candidates = [];
  const errors = [];

  let totalEventsChecked = 0;

  // ----------------------------------------------------------
  // Първо търсим нормалната посока.
  // След това допускаме reversed.
  // ----------------------------------------------------------

  const results =
    await Promise.all(
      selected.map(
        async competition => {

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
      )
    );

  for (
    const result
    of results
  ) {

    totalEventsChecked +=
      result.events.length;

    if (
      result.error
    ) {

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

    for (
      const event
      of result.events
    ) {

      const eventHome =
        teamName(
          event?.home
        );

      const eventAway =
        teamName(
          event?.away
        );

      if (
        !eventHome ||
        !eventAway
      ) {
        continue;
      }

      const score =
        strictMatch(
          requestedHome,
          requestedAway,
          eventHome,
          eventAway
        );

      if (
        !score.matched
      ) {
        continue;
      }

      candidates.push({
        match:
          buildMatch(
            event,
            result.competition
          ),

        direction:
          score.direction,

        home_score:
          score.home_score,

        away_score:
          score.away_score,

        combined_score:
          score.combined_score
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.combined_score -
      a.combined_score
  );

  const best =
    candidates[0] ?? null;

  if (!best) {

    return {
      success: true,

      search: {
        performed: true,

        type:
          "MATCH_HOME_AWAY",

        requested_home:
          requestedHome,

        requested_away:
          requestedAway,

        normalized_home:
          normalizeTeam(
            requestedHome
          ),

        normalized_away:
          normalizeTeam(
            requestedAway
          )
      },

      found: false,

      match: null,

      candidates_checked:
        totalEventsChecked,

      matching_candidates:
        0,

      errors:
        errors.length,

      error_details:
        errors,

      timestamp:
        new Date().toISOString()
    };
  }

  return {
    success: true,

    search: {
      performed: true,

      type:
        "MATCH_HOME_AWAY",

      requested_home:
        requestedHome,

      requested_away:
        requestedAway,

      normalized_home:
        normalizeTeam(
          requestedHome
        ),

      normalized_away:
        normalizeTeam(
          requestedAway
        )
    },

    found: true,

    match:
      best.match,

    direction:
      best.direction,

    home_score:
      best.home_score,

    away_score:
      best.away_score,

    combined_score:
      best.combined_score,

    candidates_checked:
      totalEventsChecked,

    matching_candidates:
      candidates.length,

    // Показваме ограничен брой
    // алтернативни съвпадения
    candidates:
      candidates
        .slice(0, 5)
        .map(x => ({
          match:
            x.match,

          direction:
            x.direction,

          home_score:
            x.home_score,

          away_score:
            x.away_score,

          combined_score:
            x.combined_score
        })),

    errors:
      errors.length,

    error_details:
      errors,

    timestamp:
      new Date().toISOString()
  };
}


// ============================================================
// HEALTH
// ============================================================

function health(env) {

  let secret = false;
  let length = 0;

  try {

    const key =
      getApiKey(env);

    secret = true;
    length =
      key.length;

  } catch {

    secret = false;

  }

  return {
    success: true,

    worker:
      "cloudbet-live-soccer",

    version:
      "V2",

    mode:
      "READ ONLY",

    secret: {
      name:
        API_KEY_NAME,

      exists:
        secret,

      length
    },

    endpoints: [
      "/",
      "/health",
      "/live",
      "/live?limit=100",
      "/search?home=TEAM&away=TEAM"
    ],

    search: {
      enabled: true,

      searches_for:
        "MATCH",

      searches_by:
        "HOME + AWAY",

      searches_result:
        false,

      live_required:
        false
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
      new URL(request.url);

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
          health(env)
        );

      }


      // ------------------------------------------------------
      // LIVE
      // ------------------------------------------------------

      if (
        path === "/live"
      ) {

        return json(
          await scan(
            env,
            request
          )
        );

      }


      // ------------------------------------------------------
      // SEARCH MATCH
      // ------------------------------------------------------

      if (
        path === "/search"
      ) {

        return json(
          await searchMatch(
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
          success: false,

          error:
            "Unknown endpoint",

          available_endpoints: [
            "/",
            "/health",
            "/live",
            "/live?limit=100",
            "/search?home=TEAM&away=TEAM"
          ]
        },
        404
      );

    } catch (error) {

      return json(
        {
          success: false,

          worker:
            "cloudbet-live-soccer",

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
