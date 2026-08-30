// ============================================================
// CLOUDBET MATCH MATCHER V2
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
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}


// ============================================================
// TEXT NORMALIZATION
// ============================================================

function normalizeText(value: any): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES: Record<string, string> = {
  "dep": "deportivo",
  "depor": "deportivo",
  "atletico": "atletico",
  "ath": "athletic",
  "inter": "inter",
  "inter milan": "inter milan",
  "inter milano": "inter milan",
  "man city": "manchester city",
  "man united": "manchester united",
  "man utd": "manchester united",
  "psg": "paris saint germain",
  "psv": "psv",
  "utd": "united",
  "sporting cp": "sporting lisbon",
  "sporting lisbon": "sporting lisbon",
  "sparta prague": "sparta prague",
  "slavia prague": "slavia prague",
  "red star": "crvena zvezda",
  "crvena zvezda": "crvena zvezda"
};


// ============================================================
// GENERIC CLUB WORDS
// IMPORTANT:
// Do NOT remove meaningful identity words such as
// real / atletico / deportivo.
// ============================================================

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
  "spa",
  "srl",
  "football",
  "soccer"
]);


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function normalizeTeam(value: any): string {
  let s = normalizeText(value);

  if (!s) {
    return "";
  }

  if (TEAM_ALIASES[s]) {
    s = TEAM_ALIASES[s];
  }

  let words = s
    .split(" ")
    .filter(Boolean)
    .filter(w => !GENERIC_WORDS.has(w));

  // Remove isolated numeric suffixes only.
  words = words.filter(w => !/^\d+$/.test(w));

  return words.join(" ").trim();
}


// ============================================================
// TEAM TOKENS
// ============================================================

function teamTokens(value: any): Set<string> {
  const normalized = normalizeTeam(value);

  return new Set(
    normalized
      .split(" ")
      .filter(Boolean)
      .filter(w => w.length >= 2)
  );
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const prev = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    const curr = new Array<number>(b.length + 1);
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j++) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}


// ============================================================
// TOKEN SIMILARITY
// ============================================================

function tokenSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }

  if (!a || !b) {
    return 0;
  }

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (!maxLength) {
    return 0;
  }

  return 1 - distance / maxLength;
}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(a: any, b: any): number {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  // Exact contained name.
  if (
    A.length >= 5 &&
    B.length >= 5 &&
    (A.includes(B) || B.includes(A))
  ) {
    return 0.94;
  }

  const aTokens = [...teamTokens(A)];
  const bTokens = [...teamTokens(B)];

  if (!aTokens.length || !bTokens.length) {
    return 0;
  }

  let exact = 0;
  let fuzzy = 0;

  for (const aToken of aTokens) {
    let best = 0;

    for (const bToken of bTokens) {
      if (aToken === bToken) {
        best = 1;
        break;
      }

      const sim = tokenSimilarity(aToken, bToken);

      if (sim > best) {
        best = sim;
      }
    }

    if (best >= 0.90) {
      fuzzy += best;
    } else if (best >= 0.75) {
      fuzzy += best * 0.65;
    }
  }

  // Count exact token overlap separately.
  for (const token of aTokens) {
    if (bTokens.includes(token)) {
      exact++;
    }
  }

  const minTokens = Math.min(
    aTokens.length,
    bTokens.length
  );

  const maxTokens = Math.max(
    aTokens.length,
    bTokens.length
  );

  const precision =
    fuzzy / Math.max(1, aTokens.length);

  const recall =
    fuzzy / Math.max(1, bTokens.length);

  const overlap =
    exact / Math.max(1, minTokens);

  let score =
    precision * 0.40 +
    recall * 0.25 +
    overlap * 0.35;

  // Single-token teams require stronger evidence.
  if (
    aTokens.length === 1 &&
    bTokens.length === 1
  ) {
    const sim =
      tokenSimilarity(
        aTokens[0],
        bTokens[0]
      );

    if (sim >= 0.90) {
      score = Math.max(score, sim);
    }
  }

  // If only a very small token matches a much longer team,
  // don't allow a false positive.
  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {
    score *= 0.65;
  }

  return Math.min(1, score);
}


// ============================================================
// EXTRACT HOME
// ============================================================

function extractHome(match: AnyObj): string | null {
  if (typeof match?.home === "string") {
    return match.home;
  }

  if (typeof match?.homeTeam === "string") {
    return match.homeTeam;
  }

  if (typeof match?.home_name === "string") {
    return match.home_name;
  }

  if (typeof match?.home?.name === "string") {
    return match.home.name;
  }

  const text =
    match?.match ??
    match?.name ??
    "";

  return splitMatchName(text).home;
}


// ============================================================
// EXTRACT AWAY
// ============================================================

function extractAway(match: AnyObj): string | null {
  if (typeof match?.away === "string") {
    return match.away;
  }

  if (typeof match?.awayTeam === "string") {
    return match.awayTeam;
  }

  if (typeof match?.away_name === "string") {
    return match.away_name;
  }

  if (typeof match?.away?.name === "string") {
    return match.away.name;
  }

  const text =
    match?.match ??
    match?.name ??
    "";

  return splitMatchName(text).away;
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
  const text = String(value ?? "").trim();

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

  for (const separator of separators) {
    const index = text.indexOf(separator);

    if (index >= 0) {
      return {
        home: text.slice(0, index).trim(),
        away: text
          .slice(index + separator.length)
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
// MATCH SCORE
// ============================================================

function matchScore(
  v27: AnyObj,
  cb: AnyObj
): number {
  const vHome = extractHome(v27);
  const vAway = extractAway(v27);

  const cHome = extractHome(cb);
  const cAway = extractAway(cb);

  if (
    !vHome ||
    !vAway ||
    !cHome ||
    !cAway
  ) {
    return 0;
  }

  const normalHome =
    teamScore(vHome, cHome);

  const normalAway =
    teamScore(vAway, cAway);

  const normal =
    (normalHome + normalAway) / 2;

  const reverseHome =
    teamScore(vHome, cAway);

  const reverseAway =
    teamScore(vAway, cHome);

  const reversed =
    (reverseHome + reverseAway) / 2;

  // Normally home/away direction should matter.
  // Reversed is accepted only when both sides are strong.
  if (
    reversed > normal &&
    reverseHome >= 0.80 &&
    reverseAway >= 0.80
  ) {
    return reversed;
  }

  return normal;
}


// ============================================================
// V27 MATCH EXTRACTION
// ============================================================

function extractV27Matches(
  data: any
): AnyObj[] {
  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  if (Array.isArray(data?.live_matches)) {
    return data.live_matches;
  }

  if (Array.isArray(data?.events)) {
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
  if (Array.isArray(data?.matches)) {
    return data.matches;
  }

  if (Array.isArray(data?.live_matches)) {
    return data.live_matches;
  }

  if (Array.isArray(data?.events)) {
    return data.events;
  }

  return [];
}


// ============================================================
// CLOUDBET LIVE
// ============================================================

function isCloudbetLive(
  match: AnyObj
): boolean {
  const status =
    String(match?.status ?? "")
      .toUpperCase();

  if (status === "TRADING_LIVE") {
    return true;
  }

  if (match?.live === true) {
    return true;
  }

  return false;
}


// ============================================================
// FIND BEST MATCH
// ============================================================

function findBestMatch(
  v27: AnyObj,
  cloudbetMatches: AnyObj[],
  threshold: number,
  usedIds: Set<string>
) {
  let best: AnyObj | null = null;
  let bestScore = 0;

  for (const cb of cloudbetMatches) {
    const cbId = String(
      cb?.id ??
      cb?.key ??
      ""
    );

    // Prevent same Cloudbet event being assigned
    // to multiple V27 matches.
    if (
      cbId &&
      usedIds.has(cbId)
    ) {
      continue;
    }

    const score =
      matchScore(v27, cb);

    if (score > bestScore) {
      bestScore = score;
      best = cb;
    }
  }

  if (
    !best ||
    bestScore < threshold
  ) {
    return {
      matched: false,
      best,
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
// FETCH SERVICE JSON
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
// MAIN MATCHER
// ============================================================

async function runMatcher(
  env: Env,
  request: Request
): Promise<Response> {
  const started = Date.now();

  const url =
    new URL(request.url);

  let threshold =
    Number(
      url.searchParams.get("threshold") ??
      "0.45"
    );

  if (!Number.isFinite(threshold)) {
    threshold = 0.45;
  }

  threshold =
    Math.max(
      0.30,
      Math.min(1, threshold)
    );


  // ----------------------------------------------------------
  // LOAD V27
  // ----------------------------------------------------------

  const v27Data =
    await fetchServiceJSON(
      env.V27,
      "/"
    );


  // ----------------------------------------------------------
  // LOAD CLOUDBET /live
  // ----------------------------------------------------------

  const cloudbetData =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );


  // ----------------------------------------------------------
  // EXTRACT
  // ----------------------------------------------------------

  const v27Matches =
    extractV27Matches(v27Data);

  const cloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    ).filter(
      isCloudbetLive
    );


  // ----------------------------------------------------------
  // MATCH
  // ----------------------------------------------------------

  const matches: AnyObj[] = [];
  const unmatched: AnyObj[] = [];

  const usedCloudbetIds =
    new Set<string>();


  for (const v27 of v27Matches) {
    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        usedCloudbetIds
      );

    const v27Home =
      extractHome(v27);

    const v27Away =
      extractAway(v27);

    const v27Name =
      v27?.match ??
      v27?.name ??
      `${v27Home ?? ""} - ${v27Away ?? ""}`;


    // --------------------------------------------------------
    // MATCH FOUND
    // --------------------------------------------------------

    if (result.matched) {
      const cb =
        result.best;

      const cbId =
        String(
          cb?.id ??
          cb?.key ??
          ""
        );

      if (cbId) {
        usedCloudbetIds.add(cbId);
      }

      matches.push({
        match:
          v27Name,

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
            cb?.minute_display ??
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

      continue;
    }


    // --------------------------------------------------------
    // UNMATCHED
    // --------------------------------------------------------

    unmatched.push({
      v27_match:
        v27Name,

      v27_home:
        v27Home,

      v27_away:
        v27Away,

      best_cloudbet:
        result.best
          ? (
              result.best?.match ??
              result.best?.name ??
              `${extractHome(result.best) ?? ""} - ${extractAway(result.best) ?? ""}`
            )
          : null,

      best_score:
        Number(
          result.score.toFixed(3)
        )
    });
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
        threshold,

      matcher:
        "TEAM NORMALIZATION + TOKEN FUZZY MATCH + ALIAS MATCH"
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

      unique_cloudbet_used:
        usedCloudbetIds.size,

      processing_ms:
        Date.now() - started
    },

    matches,

    unmatched:
      unmatched.slice(0, 100),

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

    matcher:
      "V2 NORMALIZED + FUZZY",

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
      new URL(request.url);

    const path =
      url.pathname
        .replace(/\/+$/, "") || "/";

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
