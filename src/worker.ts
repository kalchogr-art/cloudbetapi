// ============================================================
// CLOUDBET MATCH MATCHER
// V27 + CLOUDBET LIVE WORKER
// NO CLOUDBET API KEY
// READ ONLY
// ============================================================

const V27_URL =
  "https://v27.internal/";

const CLOUDBET_LIVE_URL =
  "https://cloudbetapi.kalchogr.workers.dev/live";


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
// FETCH JSON
// ============================================================

async function fetchJson(
  url
) {

  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          "accept":
            "application/json",

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

    throw new Error(
      `Invalid JSON from ${url}`
    );

  }

  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status} from ${url}`
    );

  }

  return data;

}


// ============================================================
// NORMALIZE NAME
// ============================================================

function normalizeName(
  value
) {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  let name =
    String(value)
      .toLowerCase()
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      );


  name =
    name
      .replace(
        /\(w\)/g,
        ""
      )
      .replace(
        /\(women\)/g,
        ""
      )
      .replace(
        /\(u19\)/g,
        " u19"
      )
      .replace(
        /\(u20\)/g,
        " u20"
      )
      .replace(
        /\(u21\)/g,
        " u21"
      )
      .replace(
        /\(u23\)/g,
        " u23"
      );


  // Common suffixes
  name =
    name
      .replace(
        /\bfootball club\b/g,
        ""
      )
      .replace(
        /\bfc\b/g,
        ""
      )
      .replace(
        /\bcf\b/g,
        ""
      )
      .replace(
        /\bsc\b/g,
        ""
      )
      .replace(
        /\bac\b/g,
        ""
      )
      .replace(
        /\bafc\b/g,
        ""
      );


  name =
    name
      .replace(
        /[^a-z0-9]+/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  return name;

}


// ============================================================
// TOKENS
// ============================================================

function tokens(
  value
) {

  return normalizeName(
    value
  )
    .split(" ")
    .filter(
      token =>
        token.length >= 2
    );

}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a,
  b
) {

  const na =
    normalizeName(a);

  const nb =
    normalizeName(b);


  if (
    !na ||
    !nb
  ) {

    return 0;

  }


  if (
    na === nb
  ) {

    return 1;

  }


  if (
    na.includes(nb) ||
    nb.includes(na)
  ) {

    return 0.94;

  }


  const ta =
    new Set(
      tokens(a)
    );

  const tb =
    new Set(
      tokens(b)
    );


  if (
    !ta.size ||
    !tb.size
  ) {

    return 0;

  }


  let common = 0;

  for (
    const token
    of ta
  ) {

    if (
      tb.has(token)
    ) {

      common++;

    }

  }


  return (
    common /
    Math.max(
      ta.size,
      tb.size
    )
  );

}


// ============================================================
// MATCH SCORE
// ============================================================

function calculateMatchScore(
  v27,
  cloudbet
) {

  const directHome =
    teamScore(
      v27.home,
      cloudbet.home
    );

  const directAway =
    teamScore(
      v27.away,
      cloudbet.away
    );


  const direct =
    (
      directHome +
      directAway
    ) / 2;


  const reverseHome =
    teamScore(
      v27.home,
      cloudbet.away
    );

  const reverseAway =
    teamScore(
      v27.away,
      cloudbet.home
    );


  const reverse =
    (
      reverseHome +
      reverseAway
    ) / 2;


  return Math.max(
    direct,
    reverse
  );

}


// ============================================================
// EXTRACT V27
// ============================================================

function getV27Matches(
  data
) {

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;

  }


  if (
    Array.isArray(
      data?.live_matches
    )
  ) {

    return data.live_matches;

  }


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;

  }


  return [];

}


// ============================================================
// EXTRACT CLOUDBET
// ============================================================

function getCloudbetMatches(
  data
) {

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;

  }


  return [];

}


// ============================================================
// HT OVER 0.5
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


  const market =
    markets[
      "soccer.total_goals_period_first_half"
    ];


  if (
    !market
  ) {

    return null;

  }


  const submarkets =
    market?.submarkets;


  if (
    !submarkets
  ) {

    return null;

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

      const outcome =
        String(
          selection?.outcome ||
          ""
        ).toLowerCase();


      const params =
        String(
          selection?.params ||
          ""
        ).toLowerCase();


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
        selection?.status !==
        "SELECTION_ENABLED"
      ) {

        continue;

      }


      const odds =
        Number(
          selection?.price
        );


      if (
        !Number.isFinite(
          odds
        ) ||
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
            selection?.probability ||
            0
          ),

        status:
          selection.status,

        side:
          selection?.side ||
          null

      };

    }

  }


  return null;

}


// ============================================================
// MATCHER
// ============================================================

function matchGames(
  v27Matches,
  cloudbetMatches
) {

  const results = [];

  const used =
    new Set();


  for (
    const v27
    of v27Matches
  ) {

    if (
      !v27?.home ||
      !v27?.away
    ) {

      continue;

    }


    let best =
      null;

    let bestScore =
      0;


    for (
      const cloudbet
      of cloudbetMatches
    ) {

      if (
        used.has(
          cloudbet.id
        )
      ) {

        continue;

      }


      if (
        !cloudbet?.home ||
        !cloudbet?.away
      ) {

        continue;

      }


      const score =
        calculateMatchScore(
          v27,
          cloudbet
        );


      if (
        score >
        bestScore
      ) {

        bestScore =
          score;

        best =
          cloudbet;

      }

    }


    // Strong match only
    if (
      !best ||
      bestScore < 0.70
    ) {

      continue;

    }


    used.add(
      best.id
    );


    results.push({

      match:
        v27.match ||
        `${v27.home} - ${v27.away}`,

      home:
        v27.home,

      away:
        v27.away,


      v27: {

        id:
          v27.id ??
          v27.match_id ??
          null,

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
          },

        hunter_score:
          v27?.goal_signal?.score ??
          v27?.hunter_score ??
          null

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
          best.competition ??
          null

      },


      ht_over_05:
        findHTOver05(
          best
        ),


      match_score:
        Number(
          bestScore.toFixed(
            3
          )
        )

    });

  }


  return results;

}


// ============================================================
// MAIN
// ============================================================

async function runMatcher() {

  const started =
    Date.now();


  // ==========================================================
  // TWO REQUESTS ONLY
  // ==========================================================

  const [
    v27Data,
    cloudbetData
  ] = await Promise.all([

    fetchJson(
      V27_URL
    ),

    fetchJson(
      CLOUDBET_LIVE_URL
    )

  ]);


  const v27Matches =
    getV27Matches(
      v27Data
    );


  const cloudbetMatches =
    getCloudbetMatches(
      cloudbetData
    );


  const matched =
    matchGames(
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

      v27:
        "V27",

      cloudbet:
        "Cloudbet LIVE Worker"

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

      processing_ms:
        Date.now() -
        started

    },


    matches:
      matched,


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

        return json({

          success:
            true,

          worker:
            "cloudbet-match-matcher",

          mode:
            "READ ONLY",

          cloudbet_api_key:
            "NOT USED",

          v27:
            V27_URL,

          cloudbet:
            CLOUDBET_LIVE_URL,

          timestamp:
            new Date().toISOString()

        });

      }


      // ------------------------------------------------------
      // MATCH
      // ------------------------------------------------------

      if (
        path === "/live" ||
        path === "/match"
      ) {

        return json(
          await runMatcher()
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
            "/match"
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
