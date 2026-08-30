// ============================================================
// CLOUDBET MATCH MATCHER
// V27 + CLOUDBET
// READ ONLY
// ============================================================

const V27_URL = "https://v27.internal/";

const CLOUDBET_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const CLOUDBET_API_KEY =
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
// CLOUDBET REQUEST
// ============================================================

async function cloudbet(path, env) {

  const key = env?.[CLOUDBET_API_KEY];

  if (!key) {
    throw new Error(
      "CLOUDBET_API_KEY secret is missing"
    );
  }

  const response = await fetch(
    `${CLOUDBET_BASE}${path}`,
    {
      method: "GET",
      headers: {
        "accept": "application/json",
        "X-API-Key": key,
        "cache-control": "no-cache"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Cloudbet returned non-JSON response`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Cloudbet HTTP ${response.status}`
    );
  }

  return data;
}


// ============================================================
// V27 REQUEST
// ============================================================

async function getV27() {

  const response = await fetch(
    V27_URL,
    {
      method: "GET",
      headers: {
        "accept": "application/json",
        "cache-control": "no-cache"
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `V27 returned non-JSON response`
    );
  }

  if (!response.ok) {
    throw new Error(
      `V27 HTTP ${response.status}`
    );
  }

  return data;
}


// ============================================================
// NORMALIZE TEAM NAME
// ============================================================

function normalizeName(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  let s = String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Common Cloudbet / Flashscore differences
  s = s
    .replace(/\(w\)/g, "")
    .replace(/\(women\)/g, "")
    .replace(/\(u19\)/g, " u19")
    .replace(/\(u20\)/g, " u20")
    .replace(/\(u21\)/g, " u21")
    .replace(/\(u23\)/g, " u23");

  s = s
    .replace(/\bfc\b/g, "")
    .replace(/\bcf\b/g, "")
    .replace(/\bsc\b/g, "")
    .replace(/\bac\b/g, "")
    .replace(/\bas\b/g, "")
    .replace(/\bcd\b/g, "")
    .replace(/\bca\b/g, "");

  s = s
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}


// ============================================================
// TEAM TOKENS
// ============================================================

function tokens(name) {

  return normalizeName(name)
    .split(" ")
    .filter(
      x => x.length >= 2
    );
}


// ============================================================
// TEAM SIMILARITY
// ============================================================

function teamSimilarity(a, b) {

  const na = normalizeName(a);
  const nb = normalizeName(b);

  if (!na || !nb) {
    return 0;
  }

  if (na === nb) {
    return 1;
  }

  if (
    na.includes(nb) ||
    nb.includes(na)
  ) {
    return 0.92;
  }

  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));

  if (!ta.size || !tb.size) {
    return 0;
  }

  let common = 0;

  for (const token of ta) {
    if (tb.has(token)) {
      common++;
    }
  }

  return common /
    Math.max(
      ta.size,
      tb.size
    );
}


// ============================================================
// MATCH SCORE
// ============================================================

function matchScore(v27, cb) {

  const home =
    teamSimilarity(
      v27.home,
      cb.home
    );

  const away =
    teamSimilarity(
      v27.away,
      cb.away
    );

  // Correct home + away direction
  const direct =
    (home + away) / 2;

  // Also test reversed teams
  const reverseHome =
    teamSimilarity(
      v27.home,
      cb.away
    );

  const reverseAway =
    teamSimilarity(
      v27.away,
      cb.home
    );

  const reversed =
    (reverseHome + reverseAway) / 2;

  return Math.max(
    direct,
    reversed
  );
}


// ============================================================
// EXTRACT V27 MATCHES
// ============================================================

function extractV27Matches(data) {

  if (
    Array.isArray(data?.matches)
  ) {
    return data.matches;
  }

  if (
    Array.isArray(data?.live_matches)
  ) {
    return data.live_matches;
  }

  if (
    Array.isArray(data?.data)
  ) {
    return data.data;
  }

  return [];
}


// ============================================================
// EXTRACT CLOUDBET MATCHES
// ============================================================

function extractCloudbetMatches(data) {

  if (
    Array.isArray(data?.matches)
  ) {
    return data.matches;
  }

  return [];
}


// ============================================================
// FIND HT OVER 0.5
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

  const market =
    markets[
      "soccer.total_goals_period_first_half"
    ];

  if (
    !market ||
    typeof market !== "object"
  ) {
    return null;
  }

  const submarkets =
    market?.submarkets;

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
    ] of Object.entries(
      submarkets
    )
  ) {

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
        String(
          selection?.outcome || ""
        ).toLowerCase() !== "over"
      ) {
        continue;
      }

      if (
        String(
          selection?.params || ""
        ).toLowerCase() !==
        "total=0.5"
      ) {
        continue;
      }

      if (
        selection?.status !==
        "SELECTION_ENABLED"
      ) {
        continue;
      }

      const odds =
        Number(
          selection?.price || 0
        );

      if (
        !Number.isFinite(odds) ||
        odds <= 1
      ) {
        continue;
      }

      return {
        market:
          "soccer.total_goals_period_first_half",

        submarket:
          submarketKey,

        outcome:
          selection.outcome,

        params:
          selection.params,

        odds,

        probability:
          Number(
            selection?.probability || 0
          ),

        status:
          selection.status,

        side:
          selection?.side || null,

        minStake:
          Number(
            selection?.minStake || 0
          ),

        maxStake:
          Number(
            selection?.maxStake || 0
          ),

        marketUrl:
          selection?.marketUrl || null
      };
    }
  }

  return null;
}


// ============================================================
// MATCHER
// ============================================================

function matchLiveGames(
  v27Matches,
  cloudbetMatches
) {

  const results = [];

  const usedCloudbet =
    new Set();

  for (
    const v27 of v27Matches
  ) {

    if (
      !v27?.home ||
      !v27?.away
    ) {
      continue;
    }

    let best = null;
    let bestScore = 0;

    for (
      const cb of cloudbetMatches
    ) {

      if (
        usedCloudbet.has(
          cb.id
        )
      ) {
        continue;
      }

      if (
        !cb?.home ||
        !cb?.away
      ) {
        continue;
      }

      const score =
        matchScore(
          v27,
          cb
        );

      if (
        score > bestScore
      ) {
        bestScore = score;
        best = cb;
      }
    }

    // Require strong team match
    if (
      !best ||
      bestScore < 0.70
    ) {
      continue;
    }

    usedCloudbet.add(
      best.id
    );

    results.push({

      v27: {

        id:
          v27.id ??
          v27.match_id ??
          null,

        match:
          v27.match ||
          `${v27.home} - ${v27.away}`,

        home:
          v27.home,

        away:
          v27.away,

        minute:
          v27.minute ??
          v27.match_minute ??
          null,

        minute_display:
          v27.minute_display ??
          null,

        score:
          v27.score ??
          {
            home: null,
            away: null
          }
      },

      cloudbet: {

        id:
          best.id,

        key:
          best.key,

        match:
          best.match,

        home:
          best.home,

        away:
          best.away,

        status:
          best.status,

        competition:
          best.competition ||
          null,

        ht_over_05:
          findHTOver05(best)
      },

      match_score:
        Number(
          bestScore.toFixed(3)
        )
    });
  }

  return results;
}


// ============================================================
// MAIN
// ============================================================

async function runMatcher(
  request,
  env
) {

  const started =
    Date.now();

  const [
    v27Data,
    cloudbetData
  ] = await Promise.all([

    getV27(),

    (async () => {

      // Cloudbet catalogue
      const soccer =
        await cloudbet(
          "/sports/soccer",
          env
        );

      const categories =
        Array.isArray(
          soccer?.categories
        )
          ? soccer.categories
          : [];

      const competitions = [];

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
            competition?.key &&
            Number(
              competition?.eventCount || 0
            ) > 0
          ) {

            competitions.push(
              competition
            );
          }
        }
      }

      // ------------------------------------------------------
      // Load competitions in parallel
      // ------------------------------------------------------

      const requests =
        competitions
          .slice(0, 100)
          .map(
            competition =>
              cloudbet(
                `/competitions/${encodeURIComponent(
                  competition.key
                )}`,
                env
              )
              .catch(
                () => null
              )
          );

      const responses =
        await Promise.all(
          requests
        );

      const matches = [];

      for (
        const data
        of responses
      ) {

        if (
          !Array.isArray(
            data?.events
          )
        ) {
          continue;
        }

        for (
          const event
          of data.events
        ) {

          if (
            event?.status !==
            "TRADING_LIVE"
          ) {
            continue;
          }

          if (
            !event?.home ||
            !event?.away
          ) {
            continue;
          }

          matches.push(
            event
          );
        }
      }

      return {

        success:
          true,

        matches,

        competition_count:
          competitions.length,

        competitions_checked:
          Math.min(
            competitions.length,
            100
          )
      };

    })()

  ]);


  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const cloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );


  const matched =
    matchLiveGames(
      v27Matches,
      cloudbetMatches
    );


  return {

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    mode:
      "READ ONLY",

    source: {

      flashscore:
        "V27",

      cloudbet:
        "Cloudbet"

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      matched:
        matched.length,

      unmatched_v27:
        Math.max(
          0,
          v27Matches.length -
          matched.length
        ),

      cloudbet_competitions:
        cloudbetData.competition_count,

      cloudbet_competitions_checked:
        cloudbetData.competitions_checked,

      processing_ms:
        Date.now() - started

    },

    matches:
      matched,

    timestamp:
      new Date().toISOString()

  };
}


// ============================================================
// HEALTH
// ============================================================

function health(env) {

  const key =
    env?.[CLOUDBET_API_KEY];

  return {

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    mode:
      "READ ONLY",

    v27:
      V27_URL,

    cloudbet:
      "Cloudbet",

    secret: {

      name:
        CLOUDBET_API_KEY,

      exists:
        Boolean(
          key &&
          String(key).trim()
        ),

      length:
        key
          ? String(key).length
          : 0

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
          health(env)
        );
      }

      if (
        path === "/live" ||
        path === "/match"
      ) {

        return json(
          await runMatcher(
            request,
            env
          )
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
            "/live",
            "/match"
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
            "cloudbet-match-matcher",

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
