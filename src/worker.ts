const MATCH_THRESHOLD = 0.45;

type Env = {
  V27: Fetcher;
  CLOUDBET: Fetcher;
};

type Obj = Record<string, any>;

function json(data: Obj, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

async function getJson(
  binding: Fetcher,
  name: string,
  path: string
): Promise<Obj> {

  const response = await binding.fetch(
    new Request(`https://internal${path}`)
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${name} HTTP ${response.status}`
    );
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `${name} returned invalid JSON`
    );
  }
}


// ============================================================
// NORMALIZE
// ============================================================

function norm(value: any): string {

  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bfootball club\b/g, "")
    .replace(/\bfc\b/g, "")
    .replace(/\bsc\b/g, "")
    .replace(/\bac\b/g, "")
    .replace(/\bca\b/g, "")
    .replace(/\bcf\b/g, "")
    .replace(/\bcd\b/g, "")
    .replace(/\bclub\b/g, "")
    .replace(/\bcalcio\b/g, "")
    .replace(/\bspa\b/g, "")
    .replace(/\bsv\b/g, "")
    .replace(/\bss\b/g, "")
    .replace(/\bafc\b/g, "")
    .replace(/\bw\b/g, "women")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


// ============================================================
// TOKEN SCORE
// ============================================================

function tokenScore(
  a: any,
  b: any
): number {

  const aa =
    norm(a)
      .split(" ")
      .filter(Boolean);

  const bb =
    norm(b)
      .split(" ")
      .filter(Boolean);

  if (
    !aa.length ||
    !bb.length
  ) {
    return 0;
  }

  if (
    norm(a) === norm(b)
  ) {
    return 1;
  }

  let hits = 0;

  for (
    const x of aa
  ) {

    if (
      bb.includes(x)
    ) {
      hits++;
      continue;
    }

    if (
      bb.some(
        y =>
          x.length >= 4 &&
          y.length >= 4 &&
          (
            x.includes(y) ||
            y.includes(x)
          )
      )
    ) {
      hits++;
    }

  }

  return (
    hits /
    Math.max(
      aa.length,
      bb.length
    )
  );

}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

  const na = norm(a);
  const nb = norm(b);

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
    return 0.90;
  }

  return tokenScore(
    a,
    b
  );

}


// ============================================================
// MATCH SCORE
// ============================================================

function calculateMatchScore(
  v27: Obj,
  cb: Obj
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
// EXTRACT MATCHES
// ============================================================

function extractV27(
  data: Obj
): Obj[] {

  if (
    Array.isArray(data.matches)
  ) {
    return data.matches;
  }

  if (
    Array.isArray(data.live_matches)
  ) {
    return data.live_matches;
  }

  if (
    Array.isArray(data.data)
  ) {
    return data.data;
  }

  return [];
}


function extractCloudbet(
  data: Obj
): Obj[] {

  if (
    Array.isArray(data.matches)
  ) {
    return data.matches;
  }

  return [];
}


// ============================================================
// CLOUDBET HT OVER 0.5
// ============================================================

function findHTOver05(
  event: Obj
): Obj | null {

  const market =
    event?.markets?.[
      "soccer.total_goals_period_first_half"
    ];

  if (
    !market?.submarkets
  ) {
    return null;
  }

  for (
    const [
      submarketKey,
      rawSubmarket
    ]
    of Object.entries(
      market.submarkets
    )
  ) {

    const submarket =
      rawSubmarket as Obj;

    const selections =
      Array.isArray(
        submarket.selections
      )
        ? submarket.selections
        : [];

    for (
      const selection
      of selections
    ) {

      if (
        String(
          selection?.outcome
        ).toLowerCase()
        !==
        "over"
      ) {
        continue;
      }

      if (
        String(
          selection?.params
        ).toLowerCase()
        !==
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

        marketUrl:
          selection?.marketUrl || null
      };

    }

  }

  return null;

}


// ============================================================
// MATCH
// ============================================================

function findBestMatch(
  v27: Obj,
  cloudbet: Obj[],
  used: Set<any>
) {

  let best: Obj | null = null;
  let bestScore = 0;

  for (
    const cb of cloudbet
  ) {

    if (
      used.has(cb.id)
    ) {
      continue;
    }

    if (
      !cb.home ||
      !cb.away
    ) {
      continue;
    }

    const score =
      calculateMatchScore(
        v27,
        cb
      );

    if (
      score > bestScore
    ) {

      bestScore =
        score;

      best =
        cb;

    }

  }

  return {
    best,
    score: bestScore
  };

}


// ============================================================
// MAIN
// ============================================================

async function matcher(
  env: Env
): Promise<Obj> {

  const started =
    Date.now();

  const [
    v27Data,
    cloudbetData
  ] = await Promise.all([

    getJson(
      env.V27,
      "V27",
      "/"
    ),

    getJson(
      env.CLOUDBET,
      "CLOUDBET",
      "/live"
    )

  ]);

  const v27Matches =
    extractV27(
      v27Data
    );

  const cloudbetMatches =
    extractCloudbet(
      cloudbetData
    );

  const used =
    new Set<any>();

  const matches: Obj[] = [];

  const unmatched: Obj[] = [];

  for (
    const v27 of v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        used
      );

    if (
      !result.best ||
      result.score <
      MATCH_THRESHOLD
    ) {

      unmatched.push({

        v27_match:
          v27.match ||
          `${v27.home} - ${v27.away}`,

        v27_home:
          v27.home,

        v27_away:
          v27.away,

        best_cloudbet:
          result.best
            ? result.best.match
            : null,

        best_score:
          Number(
            result.score.toFixed(3)
          )

      });

      continue;
    }

    used.add(
      result.best.id
    );

    matches.push({

      match:
        v27.match ||
        `${v27.home} - ${v27.away}`,

      home:
        v27.home,

      away:
        v27.away,

      match_score:
        Number(
          result.score.toFixed(3)
        ),

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
          null,

        hunter_score:
          v27?.goal_signal?.score ??
          v27?.hunter_score ??
          null

      },

      cloudbet: {

        id:
          result.best.id,

        key:
          result.best.key,

        match:
          result.best.match,

        home:
          result.best.home,

        away:
          result.best.away,

        status:
          result.best.status,

        competition:
          result.best.competition ??
          null

      },

      ht_over_05:
        findHTOver05(
          result.best
        )

    });

  }

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
        "CLOUDBET SERVICE BINDING /live"

    },

    settings: {

      match_threshold:
        MATCH_THRESHOLD

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      matched:
        matches.length,

      unmatched:
        unmatched.length,

      processing_ms:
        Date.now() -
        started

    },

    matches,

    unmatched:

      unmatched.slice(
        0,
        30
      ),

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

          api_key:
            "NOT USED",

          v27:
            "SERVICE BINDING",

          cloudbet:
            "SERVICE BINDING /live",

          timestamp:
            new Date().toISOString()

        });

      }

      if (
        path === "/live" ||
        path === "/match"
      ) {

        return json(
          await matcher(
            env
          )
        );

      }

      return json({

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

      }, 404);

    } catch (
      error: any
    ) {

      return json({

        success:
          false,

        worker:
          "cloudbet-match-matcher",

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
