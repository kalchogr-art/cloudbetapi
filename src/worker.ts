// ============================================================
// CLOUDBET MATCH MATCHER
// V27 FLASHscore + CLOUDBET
// READ ONLY
// ============================================================

function json(data: unknown, status = 200): Response {
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


// ============================================================
// NORMALIZE TEAM NAME
// ============================================================

function normalizeTeamName(value: unknown): string {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  let name =
    String(value)
      .toLowerCase()
      .trim();

  name =
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

  name =
    name
      .replace(/&/g, " and ")
      .replace(/['’`]/g, "")
      .replace(/[().,:;!?]/g, " ")
      .replace(/[-_/]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  return name;
}


// ============================================================
// TEAM ALIASES
// ============================================================

function normalizeSpecialNames(
  value: unknown
): string {

  let name =
    normalizeTeamName(value);

  const aliases: Record<string, string> = {

    "man utd": "manchester united",
    "man united": "manchester united",

    "man city": "manchester city",

    "tottenham": "tottenham hotspur",

    "wolves": "wolverhampton wanderers",

    "west ham": "west ham united",

    "newcastle": "newcastle united",

    "nottingham forest":
      "nottingham forest",

    "psg":
      "paris saint germain",

    "inter":
      "inter milan",

    "inter milano":
      "inter milan",

    "ac milan":
      "milan",

    "ath madrid":
      "atletico madrid",

    "atletico":
      "atletico madrid"

  };

  return aliases[name] || name;
}


// ============================================================
// MATCH KEY
// ============================================================

function makeMatchKey(
  home: unknown,
  away: unknown
): string {

  const h =
    normalizeSpecialNames(home);

  const a =
    normalizeSpecialNames(away);

  if (!h || !a) {
    return "";
  }

  return `${h}|${a}`;
}


// ============================================================
// EXTRACT TEAM
// ============================================================

function getTeam(
  team: unknown
): string {

  if (
    typeof team === "string"
  ) {
    return team;
  }

  if (
    team &&
    typeof team === "object"
  ) {

    const t =
      team as Record<string, unknown>;

    return String(
      t.name ||
      t.key ||
      ""
    );

  }

  return "";
}


// ============================================================
// PARSE JSON RESPONSE
// ============================================================

async function parseResponse(
  response: Response
): Promise<any> {

  const text =
    await response.text();

  try {

    return text
      ? JSON.parse(text)
      : {};

  } catch {

    throw new Error(
      `Invalid JSON response: ${text.slice(0, 300)}`
    );

  }

}


// ============================================================
// V27 MATCH EXTRACTION
// ============================================================

function extractV27Matches(
  data: any
): any[] {

  const possibleArrays = [

    data?.matches,

    data?.live_matches,

    data?.feed?.matches,

    data?.feed?.live_matches,

    data?.data?.matches,

    data?.data?.live_matches

  ];

  for (
    const arr of possibleArrays
  ) {

    if (
      Array.isArray(arr)
    ) {

      return arr;

    }

  }

  return [];

}


// ============================================================
// CLOUDBET MATCH EXTRACTION
// ============================================================

function extractCloudbetMatches(
  data: any
): any[] {

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;

  }

  if (
    Array.isArray(
      data?.live_events
    )
  ) {

    return data.live_events;

  }

  if (
    Array.isArray(
      data?.events
    )
  ) {

    return data.events;

  }

  return [];

}


// ============================================================
// BUILD CLOUDBET MAP
// ============================================================

function buildCloudbetMap(
  matches: any[]
): Map<string, any> {

  const map =
    new Map<string, any>();


  for (
    const event of matches
  ) {

    const home =
      getTeam(
        event?.home
      );

    const away =
      getTeam(
        event?.away
      );


    const key =
      makeMatchKey(
        home,
        away
      );


    if (!key) {
      continue;
    }


    const bet =
      event?.bet;


    if (
      !bet ||
      String(
        bet?.market || ""
      )
      !==
      "soccer.total_goals_period_first_half"
    ) {

      continue;

    }


    if (
      String(
        bet?.outcome || ""
      ).toUpperCase()
      !==
      "OVER"
    ) {

      continue;

    }


    if (
      String(
        bet?.total || ""
      )
      !==
      "0.5"
    ) {

      continue;

    }


    if (
      bet?.status !==
      "SELECTION_ENABLED"
    ) {

      continue;

    }


    map.set(
      key,
      event
    );

  }


  return map;

}


// ============================================================
// EXTRACT MINUTE
// ============================================================

function extractMinute(
  match: any
): number | null {

  const candidates = [

    match?.minute,

    match?.minute_display,

    match?.match_minute,

    match?.elapsed,

    match?.time,

    match?.matchTime,

    match?.timer,

    match?.clock

  ];


  for (
    const value of candidates
  ) {

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {

      return Math.floor(value);

    }


    if (
      typeof value === "string"
    ) {

      const text =
        value.trim();


      let m =
        text.match(
          /^(\d{1,3})\s*[:']/ 
        );


      if (m) {

        return Number(
          m[1]
        );

      }


      m =
        text.match(
          /^(\d{1,3})/
        );


      if (
        m &&
        Number(m[1]) <= 130
      ) {

        return Number(
          m[1]
        );

      }

    }

  }


  return null;

}


// ============================================================
// EXTRACT SCORE
// ============================================================

function extractScore(
  match: any
): {
  home: number | null;
  away: number | null;
} {

  const score =
    match?.score ||
    match?.scores ||
    match?.result ||
    null;


  if (
    score &&
    typeof score === "object"
  ) {

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


  return {
    home: null,
    away: null
  };

}


// ============================================================
// MAIN MATCHER
// ============================================================

async function runMatcher(
  env: any
): Promise<any> {

  // ==========================================================
  // V27
  // ==========================================================

  const v27Response =
    await env.V27.fetch(
      new Request(
        "https://v27.internal/"
      )
    );


  if (
    !v27Response.ok
  ) {

    throw new Error(
      `V27 binding HTTP ${v27Response.status}`
    );

  }


  const v27 =
    await parseResponse(
      v27Response
    );


  // ==========================================================
  // CLOUDBET
  // ==========================================================

  const cloudbetResponse =
    await env.CLOUDBET.fetch(
      new Request(
        "https://cloudbet.internal/live"
      )
    );


  if (
    !cloudbetResponse.ok
  ) {

    throw new Error(
      `Cloudbet binding HTTP ${cloudbetResponse.status}`
    );

  }


  const cloudbet =
    await parseResponse(
      cloudbetResponse
    );


  // ==========================================================
  // EXTRACT
  // ==========================================================

  const flashscoreMatches =
    extractV27Matches(
      v27
    );


  const cloudbetMatches =
    extractCloudbetMatches(
      cloudbet
    );


  // ==========================================================
  // CLOUDBET MAP
  // ==========================================================

  const cloudbetMap =
    buildCloudbetMap(
      cloudbetMatches
    );


  // ==========================================================
  // MATCH
  // ==========================================================

  const matched: any[] = [];

  const unmatched: any[] = [];


  for (
    const fs of flashscoreMatches
  ) {

    const home =
      getTeam(
        fs?.home
      );


    const away =
      getTeam(
        fs?.away
      );


    const key =
      makeMatchKey(
        home,
        away
      );


    if (!key) {
      continue;
    }


    const cb =
      cloudbetMap.get(
        key
      );


    if (!cb) {

      unmatched.push({

        flashscore_id:
          fs?.id ??
          fs?.match_id ??
          null,

        match:
          fs?.name ||
          `${home} - ${away}`,

        home,

        away,

        match_key:
          key

      });

      continue;

    }


    const minute =
      extractMinute(
        fs
      );


    const score =
      extractScore(
        fs
      );


    matched.push({

      match:
        fs?.name ||
        `${home} - ${away}`,

      home,

      away,

      match_key:
        key,

      flashscore: {

        id:
          fs?.id ??
          fs?.match_id ??
          null,

        minute,

        minute_display:
          minute !== null
            ? `${minute}'`
            : null,

        score

      },

      cloudbet: {

        id:
          cb?.id ??
          null,

        key:
          cb?.key ??
          null,

        odds:
          cb?.bet?.odds ??
          null,

        probability:
          cb?.bet?.probability ??
          null,

        status:
          cb?.bet?.status ??
          null,

        minStake:
          cb?.bet?.minStake ??
          null,

        maxStake:
          cb?.bet?.maxStake ??
          null,

        marketUrl:
          cb?.bet?.marketUrl ??
          null

      }

    });

  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    success:
      true,

    endpoint:
      "match",

    worker:
      "cloudbet-match-matcher",

    source: {

      flashscore:
        "V27",

      cloudbet:
        "Cloudbet"

    },

    stats: {

      flashscore_matches:
        flashscoreMatches.length,

      cloudbet_matches:
        cloudbetMatches.length,

      cloudbet_ht_over05:
        cloudbetMap.size,

      matched:
        matched.length,

      unmatched_flashscore:
        unmatched.length

    },

    matches:
      matched,

    unmatched:
      unmatched,

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
    env: any
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

      // ======================================================
      // HEALTH
      // ======================================================

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

          bindings: {

            V27:
              !!env.V27,

            CLOUDBET:
              !!env.CLOUDBET

          },

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // MATCH
      // ======================================================

      if (
        path === "/match"
      ) {

        return json(
          await runMatcher(
            env
          )
        );

      }


      // ======================================================
      // 404
      // ======================================================

      return json({

        success:
          false,

        error:
          "Unknown endpoint",

        available_endpoints: [

          "/",

          "/health",

          "/match"

        ]

      }, 404);


    } catch (error) {

      return json({

        success:
          false,

        worker:
          "cloudbet-match-matcher",

        error:
          error instanceof Error
            ? error.message
            : String(error),

        timestamp:
          new Date().toISOString()

      }, 500);

    }

  }

};
