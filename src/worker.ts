// ============================================================
// CLOUDBET MATCH MATCHER
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V27      -> Flashscore live matches
// CLOUDBET -> /live
//
// NO CLOUDBET API KEY HERE
// ============================================================

interface Env {
  V27: Fetcher;
  CLOUDBET: Fetcher;
}

type AnyObj = Record<string, any>;


// ============================================================
// JSON
// ============================================================

function json(data: any, status = 200): Response {
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
// NORMALIZE TEXT
// ============================================================

function normalizeText(value: any): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function normalizeTeam(value: any): string {
  let s = normalizeText(value);

  // Common Cloudbet / Flashscore prefixes
  const removeWords = new Set([
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
    "real",
    "club",
    "sporting",
    "deportivo",
    "atletico",
    "athletic",
    "calcio",
    "football",
    "soccer",
    "fk",
    "sk",
    "ks",
    "fk",
    "sv",
    "vfb",
    "vfl",
    "1",
    "2"
  ]);

  const words = s
    .split(" ")
    .filter(Boolean)
    .filter(w => !removeWords.has(w));

  return words.join(" ");
}


// ============================================================
// TEAM TOKENS
// ============================================================

function teamTokens(value: any): Set<string> {
  const s = normalizeTeam(value);

  return new Set(
    s
      .split(" ")
      .filter(Boolean)
      .filter(w => w.length >= 2)
  );
}


// ============================================================
// TOKEN SCORE
// ============================================================

function tokenScore(a: any, b: any): number {
  const A = teamTokens(a);
  const B = teamTokens(b);

  if (!A.size || !B.size) {
    return 0;
  }

  let common = 0;

  for (const token of A) {
    if (B.has(token)) {
      common++;
    }
  }

  const minSize = Math.min(A.size, B.size);
  const maxSize = Math.max(A.size, B.size);

  if (!minSize) {
    return 0;
  }

  const precision = common / minSize;
  const recall = common / maxSize;

  return (
    precision * 0.65 +
    recall * 0.35
  );
}


// ============================================================
// STRING SIMILARITY
// ============================================================

function stringSimilarity(a: any, b: any): number {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  if (
    A.includes(B) ||
    B.includes(A)
  ) {
    return 0.90;
  }

  const aTokens = teamTokens(A);
  const bTokens = teamTokens(B);

  const token = tokenScore(A, B);

  if (
    aTokens.size === 1 &&
    bTokens.size === 1
  ) {
    return token;
  }

  return token;
}


// ============================================================
// TEAM MATCH SCORE
// ============================================================

function teamMatchScore(
  v27Team: any,
  cloudbetTeam: any
): number {

  const direct =
    stringSimilarity(
      v27Team,
      cloudbetTeam
    );

  if (direct >= 1) {
    return 1;
  }

  return direct;
}


// ============================================================
// MATCH SCORE
// ============================================================

function matchScore(
  v27: AnyObj,
  cb: AnyObj
): number {

  const vHome =
    v27?.home ??
    extractHome(v27);

  const vAway =
    v27?.away ??
    extractAway(v27);

  const cHome =
    cb?.home ??
    extractHome(cb);

  const cAway =
    cb?.away ??
    extractAway(cb);

  if (
    !vHome ||
    !vAway ||
    !cHome ||
    !cAway
  ) {
    return 0;
  }


  // ----------------------------------------------------------
  // NORMAL DIRECTION
  // ----------------------------------------------------------

  const homeScore =
    teamMatchScore(
      vHome,
      cHome
    );

  const awayScore =
    teamMatchScore(
      vAway,
      cAway
    );

  const normal =
    (homeScore + awayScore) / 2;


  // ----------------------------------------------------------
  // REVERSED DIRECTION
  // ----------------------------------------------------------

  const reverseHome =
    teamMatchScore(
      vHome,
      cAway
    );

  const reverseAway =
    teamMatchScore(
      vAway,
      cHome
    );

  const reversed =
    (reverseHome + reverseAway) / 2;


  return Math.max(
    normal,
    reversed
  );
}


// ============================================================
// EXTRACT HOME
// ============================================================

function extractHome(match: AnyObj): string | null {

  if (
    typeof match?.home === "string"
  ) {
    return match.home;
  }

  if (
    typeof match?.homeTeam === "string"
  ) {
    return match.homeTeam;
  }

  if (
    typeof match?.home_name === "string"
  ) {
    return match.home_name;
  }

  if (
    typeof match?.home?.name === "string"
  ) {
    return match.home.name;
  }

  const text =
    match?.match ??
    match?.name ??
    "";

  const parts =
    splitMatchName(text);

  return parts.home;
}


// ============================================================
// EXTRACT AWAY
// ============================================================

function extractAway(match: AnyObj): string | null {

  if (
    typeof match?.away === "string"
  ) {
    return match.away;
  }

  if (
    typeof match?.awayTeam === "string"
  ) {
    return match.awayTeam;
  }

  if (
    typeof match?.away_name === "string"
  ) {
    return match.away_name;
  }

  if (
    typeof match?.away?.name === "string"
  ) {
    return match.away.name;
  }

  const text =
    match?.match ??
    match?.name ??
    "";

  const parts =
    splitMatchName(text);

  return parts.away;
}


// ============================================================
// SPLIT MATCH NAME
// ============================================================

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {

  const text =
    String(value ?? "")
      .trim();

  if (!text) {
    return {
      home: null,
      away: null
    };
  }

  const separators = [
    " - ",
    " v ",
    " vs ",
    " VS ",
    " @ "
  ];

  for (
    const separator
    of separators
  ) {

    const index =
      text.indexOf(separator);

    if (index >= 0) {

      return {
        home:
          text
            .slice(0, index)
            .trim(),

        away:
          text
            .slice(
              index + separator.length
            )
            .trim()
      };

    }

  }

  return {
    home: null,
    away: null
  };
}


// ============================================================
// FETCH JSON FROM SERVICE
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<any> {

  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method: "GET",
          headers: {
            "accept":
              "application/json"
          }
        }
      )
    );

  const text =
    await response.text();

  if (!response.ok) {

    throw new Error(
      `HTTP ${response.status}: ${text.slice(0, 300)}`
    );

  }

  try {

    return JSON.parse(text);

  } catch {

    throw new Error(
      `Invalid JSON from ${path}`
    );

  }
}


// ============================================================
// V27 MATCH EXTRACTION
// ============================================================

function extractV27Matches(
  data: any
): AnyObj[] {

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
    Array.isArray(data?.events)
  ) {
    return data.events;
  }

  return [];
}


// ============================================================
// CLOUDBET MATCH EXTRACTION
// ============================================================

function extractCloudbetMatches(
  data: any
): AnyObj[] {

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
    Array.isArray(data?.events)
  ) {
    return data.events;
  }

  return [];
}


// ============================================================
// CLOUD­BET LIVE VALIDATION
// ============================================================

function isCloudbetLive(
  match: AnyObj
): boolean {

  const status =
    String(
      match?.status ?? ""
    ).toUpperCase();

  if (
    status === "TRADING_LIVE"
  ) {
    return true;
  }

  if (
    match?.live === true
  ) {
    return true;
  }

  return false;
}


// ============================================================
// MATCHER
// ============================================================

function findBestMatch(
  v27: AnyObj,
  cloudbetMatches: AnyObj[],
  threshold: number
) {

  let best: AnyObj | null = null;
  let bestScore = 0;

  for (
    const cb
    of cloudbetMatches
  ) {

    const score =
      matchScore(
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

  if (
    !best ||
    bestScore < threshold
  ) {

    return {
      matched: false,
      best: best,
      score: bestScore
    };

  }

  return {
    matched: true,
    best,
    score: bestScore
  };
}


// ============================================================
// MAIN
// ============================================================

async function runMatcher(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();


  // ----------------------------------------------------------
  // THRESHOLD
  // ----------------------------------------------------------

  const url =
    new URL(
      request.url
    );

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      "0.45"
    );

  if (
    !Number.isFinite(threshold)
  ) {
    threshold = 0.45;
  }

  threshold =
    Math.max(
      0.30,
      Math.min(
        1,
        threshold
      )
    );


  // ----------------------------------------------------------
  // V27
  // ----------------------------------------------------------

  const v27Data =
    await fetchServiceJSON(
      env.V27,
      "/"
    );


  // ----------------------------------------------------------
  // CLOUDBET
  //
  // IMPORTANT:
  // NO API KEY HERE.
  // The Cloudbet worker handles the key.
  // ----------------------------------------------------------

  const cloudbetData =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );


  const v27Matches =
    extractV27Matches(
      v27Data
    );


  const cloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    )
      .filter(
        isCloudbetLive
      );


  // ----------------------------------------------------------
  // MATCH
  // ----------------------------------------------------------

  const matches = [];
  const unmatched = [];


  for (
    const v27
    of v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold
      );


    const v27Home =
      extractHome(v27);

    const v27Away =
      extractAway(v27);


    if (
      result.matched
    ) {

      const cb =
        result.best;

      matches.push({

        match:
          v27?.match ??
          v27?.name ??
          `${v27Home} - ${v27Away}`,

        v27: {

          id:
            v27?.id ??
            null,

          home:
            v27Home,

          away:
            v27Away,

          minute:
            v27?.minute ??
            v27?.minute_display ??
            null,

          score:
            v27?.score ??
            null

        },

        cloudbet: {

          id:
            cb?.id ??
            null,

          key:
            cb?.key ??
            null,

          match:
            cb?.match ??
            cb?.name ??
            null,

          home:
            extractHome(cb),

          away:
            extractAway(cb),

          status:
            cb?.status ??
            null,

          minute:
            cb?.minute ??
            null,

          score:
            cb?.score ??
            null,

          competition:
            cb?.competition ??
            null

        },

        match_score:
          Number(
            result.score.toFixed(3)
          )

      });

    } else {

      unmatched.push({

        v27_match:
          v27?.match ??
          v27?.name ??
          `${v27Home} - ${v27Away}`,

        v27_home:
          v27Home,

        v27_away:
          v27Away,

        best_cloudbet:
          result.best
            ? (
                result.best?.match ??
                result.best?.name ??
                null
              )
            : null,

        best_score:
          Number(
            result.score.toFixed(3)
          )

      });

    }

  }


  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------

  return json({

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
        threshold

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
        Date.now() - started

    },

    matches,

    unmatched:
      unmatched.slice(
        0,
        100
      ),

    timestamp:
      new Date().toISOString()

  });
}


// ============================================================
// HEALTH
// ============================================================

function health(): Response {

  return json({

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    mode:
      "READ ONLY",

    bindings: {

      V27:
        true,

      CLOUDBET:
        true

    },

    message:
      "Matcher uses V27 and CLOUDBET Service Bindings. No API key is required here.",

    timestamp:
      new Date().toISOString()

  });
}


// ============================================================
// WORKER
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
      url.pathname
        .replace(
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

        return health();

      }


      // ------------------------------------------------------
      // MATCH
      // ------------------------------------------------------

      if (
        path === "/match" ||
        path === "/live"
      ) {

        return runMatcher(
          env,
          request
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

            "/match",

            "/match?threshold=0.45",

            "/match?threshold=0.40",

            "/live"

          ]

        },

        404

      );

    } catch (error: any) {

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-match-matcher",

          error:
            error?.message ??
            String(error),

          timestamp:
            new Date().toISOString()

        },

        500

      );

    }

  }

};
