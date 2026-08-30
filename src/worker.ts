// ============================================================
// CLOUDBET MATCH MATCHER
// V27 + CLOUDBET SERVICE BINDINGS
// NO API KEY
// READ ONLY
// ============================================================

type Env = {
  V27: Fetcher;
  CLOUDBET: Fetcher;
};

type JsonObject = Record<string, any>;


// ============================================================
// JSON
// ============================================================

function json(
  data: JsonObject,
  status = 200
): Response {

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
// SERVICE BINDING JSON
// ============================================================

async function bindingJson(
  binding: Fetcher,
  name: string
): Promise<JsonObject> {

  const response =
    await binding.fetch(
      new Request(
        "https://internal/"
      )
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `${name} HTTP ${response.status}`
    );

  }

  let data: JsonObject;

  try {

    data =
      text
        ? JSON.parse(text)
        : {};

  } catch {

    throw new Error(
      `${name} returned non-JSON`
    );

  }

  return data;
}


// ============================================================
// NORMALIZE NAME
// ============================================================

function normalizeName(
  value: any
): string {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\(w\)|\(women\)/g,
      " women"
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
    )
    .replace(
      /\bfootball club\b/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


// ============================================================
// TOKENS
// ============================================================

function tokens(
  value: any
): string[] {

  return normalizeName(
    value
  )
    .split(" ")
    .filter(
      x => x.length >= 2
    );

}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

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

    return 0.95;

  }

  const ta =
    new Set(tokens(a));

  const tb =
    new Set(tokens(b));

  if (
    !ta.size ||
    !tb.size
  ) {

    return 0;

  }

  let common = 0;

  for (
    const token of ta
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

function matchScore(
  v27: JsonObject,
  cb: JsonObject
): number {

  const direct =
    (
      teamScore(
        v27.home,
        cb.home
      ) +

      teamScore(
        v27.away,
        cb.away
      )
    ) / 2;


  const reverse =
    (
      teamScore(
        v27.home,
        cb.away
      ) +

      teamScore(
        v27.away,
        cb.home
      )
    ) / 2;


  return Math.max(
    direct,
    reverse
  );

}


// ============================================================
// V27 MATCHES
// ============================================================

function getV27Matches(
  data: JsonObject
): JsonObject[] {

  if (
    Array.isArray(
      data.matches
    )
  ) {

    return data.matches;

  }

  if (
    Array.isArray(
      data.live_matches
    )
  ) {

    return data.live_matches;

  }

  if (
    Array.isArray(
      data.data
    )
  ) {

    return data.data;

  }

  return [];

}


// ============================================================
// CLOUDBET MATCHES
// ============================================================

function getCloudbetMatches(
  data: JsonObject
): JsonObject[] {

  return Array.isArray(
    data.matches
  )
    ? data.matches
    : [];

}


// ============================================================
// HT OVER 0.5
// ============================================================

function findHTOver05(
  event: JsonObject
): JsonObject | null {

  const markets =
    event.markets;

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
    market.submarkets;

  if (
    !submarkets ||
    typeof submarkets !== "object"
  ) {

    return null;

  }

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
        (submarket as JsonObject)
          ?.selections
      )
        ? (submarket as JsonObject)
            .selections
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
          key,

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
// MATCH
// ============================================================

function matchGames(
  v27Matches: JsonObject[],
  cloudbetMatches: JsonObject[]
): JsonObject[] {

  const results: JsonObject[] = [];

  const used =
    new Set<any>();

  for (
    const v27 of v27Matches
  ) {

    if (
      !v27?.home ||
      !v27?.away
    ) {

      continue;

    }

    let best:
      JsonObject | null =
      null;

    let bestScore = 0;

    for (
      const cb of cloudbetMatches
    ) {

      if (
        used.has(cb.id)
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
        score >
        bestScore
      ) {

        bestScore =
          score;

        best =
          cb;

      }

    }

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
  env: Env
): Promise<JsonObject> {

  const started =
    Date.now();


  // ==========================================================
  // ONLY TWO SERVICE BINDING REQUESTS
  // ==========================================================

  const [
    v27Data,
    cloudbetData
  ] = await Promise.all([

    bindingJson(
      env.V27,
      "V27"
    ),

    bindingJson(
      env.CLOUDBET,
      "CLOUDBET"
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


  const matches =
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
        "V27 SERVICE BINDING",

      cloudbet:
        "CLOUDBET SERVICE BINDING"

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      matched:
        matches.length,

      unmatched:
        Math.max(
          0,
          v27Matches.length -
          matches.length
        ),

      processing_ms:
        Date.now() -
        started

    },

    matches,

    timestamp:
      new Date().toISOString()

  };

}


// ============================================================
// ROUTER
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

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

          bindings: {

            V27:
              "goal-watch-proxy",

            CLOUDBET:
              "cloudbetapi"

          },

          timestamp:
            new Date().toISOString()

        });

      }


      // ------------------------------------------------------
      // MATCHER
      // ------------------------------------------------------

      if (
        path === "/live" ||
        path === "/match"
      ) {

        return json(
          await runMatcher(
            env
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
            "/match"
          ]

        },

        404

      );

    } catch (
      error: any
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
