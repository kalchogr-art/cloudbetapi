// ============================================================
// CLOUDBET MATCH MATCHER
// V27 + CLOUDBET
// READ ONLY
// ============================================================

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}


// ============================================================
// NORMALIZE
// ============================================================

function normalizeName(value: unknown): string {
  if (value === null || value === undefined) return "";

  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[().,:;!?]/g, " ")
    .replace(/[-_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// ALIASES
// ============================================================

function normalizeTeam(value: unknown): string {
  const name = normalizeName(value);

  const aliases: Record<string, string> = {
    "man utd": "manchester united",
    "man united": "manchester united",
    "man city": "manchester city",
    "tottenham": "tottenham hotspur",
    "wolves": "wolverhampton wanderers",
    "west ham": "west ham united",
    "newcastle": "newcastle united",
    "psg": "paris saint germain",
    "inter": "inter milan",
    "inter milano": "inter milan",
    "ac milan": "milan",
    "ath madrid": "atletico madrid",
    "atletico": "atletico madrid"
  };

  return aliases[name] || name;
}


// ============================================================
// MATCH KEY
// ============================================================

function matchKey(home: unknown, away: unknown): string {
  const h = normalizeTeam(home);
  const a = normalizeTeam(away);

  if (!h || !a) return "";

  return `${h}|${a}`;
}


// ============================================================
// TEAM NAME
// ============================================================

function teamName(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;

    return String(
      obj.name ||
      obj.key ||
      ""
    );
  }

  return "";
}


// ============================================================
// JSON RESPONSE
// ============================================================

async function readJson(response: Response): Promise<any> {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Invalid JSON response: ${text.slice(0, 500)}`
    );
  }
}


// ============================================================
// V27 MATCHES
// ============================================================

function getV27Matches(data: any): any[] {

  const candidates = [
    data?.matches,
    data?.live_matches,
    data?.feed?.matches,
    data?.feed?.live_matches,
    data?.data?.matches,
    data?.data?.live_matches
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}


// ============================================================
// CLOUDBET MATCHES
// IMPORTANT:
// CURRENT CLOUDBET WORKER RETURNS matches[]
// ============================================================

function getCloudbetMatches(data: any): any[] {

  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  return [];
}


// ============================================================
// FIND HT OVER 0.5
// ============================================================

function getHTOver05(match: any): any | null {

  const bet = match?.bet;

  if (!bet || typeof bet !== "object") {
    return null;
  }

  const market =
    String(bet.market || "");

  const outcome =
    String(bet.outcome || "")
      .toUpperCase();

  const total =
    String(bet.total || "");

  const status =
    String(bet.status || "");


  if (
    market !==
    "soccer.total_goals_period_first_half"
  ) {
    return null;
  }


  if (outcome !== "OVER") {
    return null;
  }


  if (total !== "0.5") {
    return null;
  }


  if (
    status !==
    "SELECTION_ENABLED"
  ) {
    return null;
  }


  return {
    market,
    period: "HT",
    outcome: "OVER",
    total: "0.5",
    odds:
      bet.odds ?? null,
    probability:
      bet.probability ?? null,
    status:
      bet.status ?? null,
    side:
      bet.side ?? null,
    minStake:
      bet.minStake ?? null,
    maxStake:
      bet.maxStake ?? null,
    marketUrl:
      bet.marketUrl ?? null
  };
}


// ============================================================
// MINUTE FROM V27
// ============================================================

function getMinute(match: any): number | null {

  const values = [
    match?.minute,
    match?.match_minute,
    match?.elapsed,
    match?.minute_display,
    match?.time,
    match?.matchTime,
    match?.timer,
    match?.clock
  ];


  for (const value of values) {

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


      const colon =
        text.match(/^(\d{1,3})\s*:/);

      if (colon) {
        return Number(colon[1]);
      }


      const apostrophe =
        text.match(/^(\d{1,3})\s*'/);

      if (apostrophe) {
        return Number(apostrophe[1]);
      }


      const number =
        text.match(/^(\d{1,3})/);

      if (
        number &&
        Number(number[1]) <= 130
      ) {
        return Number(number[1]);
      }
    }
  }


  return null;
}


// ============================================================
// SCORE
// ============================================================

function getScore(match: any): any {

  const score =
    match?.score ||
    match?.scores ||
    match?.result ||
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
// MATCHER
// ============================================================

async function runMatcher(env: any): Promise<any> {

  // ----------------------------------------------------------
  // V27
  // ----------------------------------------------------------

  const v27Response =
    await env.V27.fetch(
      new Request(
        "https://v27.internal/"
      )
    );


  if (!v27Response.ok) {
    throw new Error(
      `V27 HTTP ${v27Response.status}`
    );
  }


  const v27 =
    await readJson(
      v27Response
    );


  // ----------------------------------------------------------
  // CLOUDBET
  // ----------------------------------------------------------

  const cloudbetResponse =
    await env.CLOUDBET.fetch(
      new Request(
        "https://cloudbet.internal/live"
      )
    );


  if (!cloudbetResponse.ok) {
    throw new Error(
      `Cloudbet HTTP ${cloudbetResponse.status}`
    );
  }


  const cloudbet =
    await readJson(
      cloudbetResponse
    );


  // ----------------------------------------------------------
  // ARRAYS
  // ----------------------------------------------------------

  const flashscoreMatches =
    getV27Matches(
      v27
    );


  const cloudbetMatches =
    getCloudbetMatches(
      cloudbet
    );


  // ----------------------------------------------------------
  // CLOUDBET MAP
  // ----------------------------------------------------------

  const cloudbetMap =
    new Map<string, any>();


  for (
    const cb of cloudbetMatches
  ) {

    const home =
      teamName(
        cb?.home
      );

    const away =
      teamName(
        cb?.away
      );


    const key =
      matchKey(
        home,
        away
      );


    if (!key) continue;


    const bet =
      getHTOver05(
        cb
      );


    if (!bet) continue;


    cloudbetMap.set(
      key,
      {
        event: cb,
        bet
      }
    );
  }


  // ----------------------------------------------------------
  // MATCH
  // ----------------------------------------------------------

  const matches: any[] = [];

  const unmatched: any[] = [];


  for (
    const fs of flashscoreMatches
  ) {

    const home =
      teamName(
        fs?.home
      );

    const away =
      teamName(
        fs?.away
      );


    const key =
      matchKey(
        home,
        away
      );


    if (!key) continue;


    const cloud =
      cloudbetMap.get(
        key
      );


    if (!cloud) {

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
        match_key: key
      });

      continue;
    }


    const minute =
      getMinute(
        fs
      );


    const score =
      getScore(
        fs
      );


    matches.push({

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
          cloud.event?.id ??
          null,

        key:
          cloud.event?.key ??
          null,

        bet:
          cloud.bet
      }

    });
  }


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  return {

    success: true,

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
        matches.length,

      unmatched_flashscore:
        unmatched.length
    },

    matches,

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

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json({

          success: true,

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


      if (
        path === "/match"
      ) {

        return json(
          await runMatcher(
            env
          )
        );
      }


      return json({

        success: false,

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

        success: false,

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
