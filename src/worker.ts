// ============================================================
// CLOUDBET MATCH MATCHER V5
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V27      -> Flashscore live matches
// CLOUDBET -> /live
//
// NO CLOUDBET API KEY HERE
//
// V5 FIXES:
// 1. STRICT TWO-SIDED TEAM MATCH
// 2. STRONGER TEAM ALIAS MATCHING
// 3. U19/U21/U23 PROTECTION
// 4. RESERVE / WOMEN PROTECTION
// 5. COMMON TOKEN PROTECTION
// 6. HOME/AWAY DIRECTION CHECK
// 7. CORRECT REVERSED MATCH SCORING
// 8. COMPETITION SIGNAL
// 9. COUNTRY SIGNAL
// 10. CONFIDENT / POSSIBLE / REVERSED / UNMATCHED
// 11. FALSE POSITIVE PROTECTION
// 12. PRE-NORMALIZED TEAM CACHE
// 13. DIAGNOSTIC MODE
// 14. CLOUDBET LIVE STATUS FALLBACK
// 15. READ ONLY
// ============================================================


interface Env {
  V27: Fetcher;
  CLOUDBET: Fetcher;
}


type AnyObj = Record<string, any>;


// ============================================================
// CONFIG
// ============================================================

const DEFAULT_THRESHOLD = 0.45;

const STRONG_TEAM_SCORE = 0.78;

const POSSIBLE_TEAM_SCORE = 0.60;

const POSSIBLE_TOTAL_SCORE = 0.72;

const CONFIDENT_TOTAL_SCORE = 0.80;

const REVERSED_CONFIDENT_SCORE = 0.90;

const WEAK_SIDE_LIMIT = 0.50;

const COMPETITION_BONUS = 0.05;

const COUNTRY_BONUS = 0.02;


// ============================================================
// JSON
// ============================================================

function json(
  data: any,
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
// TEXT NORMALIZATION
// ============================================================

function normalizeText(
  value: any
): string {

  return String(value ?? "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /['’`]/g,
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
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES:
  Record<string, string> = {

  // England
  "man city":
    "manchester city",

  "man utd":
    "manchester united",

  "man united":
    "manchester united",

  "man u":
    "manchester united",

  "manchester utd":
    "manchester united",

  // France
  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  // Italy
  "inter":
    "inter milan",

  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "fc internazionale":
    "inter milan",

  // Spain
  "atletico":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid",

  // Portugal
  "sporting cp":
    "sporting lisbon",

  "sporting lisboa":
    "sporting lisbon",

  // Serbia
  "red star":
    "crvena zvezda",

  "red star belgrade":
    "crvena zvezda",

  // Netherlands
  "psv eindhoven":
    "psv",

  // Germany
  "bayern munchen":
    "bayern munich",

  // General
  "utd":
    "united",

  "ath":
    "athletic",

  "dep":
    "deportivo",

  "depor":
    "deportivo"
};


// ============================================================
// GENERIC CLUB WORDS
// ============================================================

const GENERIC_WORDS =
  new Set([
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
// CATEGORY NORMALIZATION
// ============================================================

function normalizeCategory(
  value: any
): string {

  let s =
    normalizeText(value);

  if (!s) {
    return "";
  }

  s =
    s
      .replace(
        /\bu\s+(\d{2})\b/g,
        "u$1"
      )
      .replace(
        /\bu(\d{2})\b/g,
        "u$1"
      )
      .replace(
        /\bunder\s+(\d{2})\b/g,
        "u$1"
      )
      .replace(
        /\b(\d{2})\s*years?\b/g,
        "u$1"
      )
      .replace(
        /\bii\b/g,
        "2"
      )
      .replace(
        /\biii\b/g,
        "3"
      )
      .replace(
        /\biv\b/g,
        "4"
      )
      .replace(
        /\breserves?\b/g,
        "reserve"
      )
      .replace(
        /\bres\b/g,
        "reserve"
      )
      .replace(
        /\bwomen\b/g,
        "women"
      )
      .replace(
        /\bwomen'?s\b/g,
        "women"
      )
      .replace(
        /\bladies\b/g,
        "women"
      )
      .replace(
        /\bgirls\b/g,
        "women"
      );

  const tokens =
    s
      .split(" ")
      .filter(Boolean);

  const categories:
    string[] = [];

  for (
    const token of tokens
  ) {

    if (
      /^u\d{2}$/.test(token)
    ) {
      categories.push(token);
    }

    if (
      token === "reserve"
    ) {
      categories.push("reserve");
    }

    if (
      token === "women"
    ) {
      categories.push("women");
    }

    if (
      /^[234]$/.test(token)
    ) {
      categories.push(
        `team${token}`
      );
    }
  }

  return categories.join(" ");
}


// ============================================================
// APPLY ALIASES
// ============================================================

function applyTeamAliases(
  value: string
): string {

  let s =
    normalizeText(value);

  if (!s) {
    return "";
  }

  const aliases =
    Object.keys(
      TEAM_ALIASES
    ).sort(
      (a, b) =>
        b.length - a.length
    );

  for (
    const alias of aliases
  ) {

    const canonical =
      TEAM_ALIASES[alias];

    const regex =
      new RegExp(
        `(^|\\s)${alias.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )}(?=\\s|$)`,
        "g"
      );

    s =
      s.replace(
        regex,
        `$1${canonical}`
      );
  }

  return s
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function normalizeTeam(
  value: any
): string {

  let s =
    normalizeText(value);

  if (!s) {
    return "";
  }

  s =
    applyTeamAliases(s);

  let words =
    s
      .split(" ")
      .filter(Boolean)
      .filter(
        w =>
          !GENERIC_WORDS.has(w)
      );

  // IMPORTANT:
  // Do NOT remove U19/U21/U23 here.
  // Category protection handles them separately.

  return words.join(" ")
    .trim();
}


// ============================================================
// TEAM CATEGORY
// ============================================================

function teamCategory(
  value: any
): string {

  return normalizeCategory(value);
}


// ============================================================
// CATEGORY COMPATIBILITY
// ============================================================

function categoryCompatible(
  a: any,
  b: any
): boolean {

  const A =
    teamCategory(a);

  const B =
    teamCategory(b);

  if (!A && !B) {
    return true;
  }

  if (!A || !B) {
    return true;
  }

  return A === B;
}


// ============================================================
// TEAM TOKENS
// ============================================================

function teamTokens(
  value: any
): Set<string> {

  const normalized =
    normalizeTeam(value);

  return new Set(
    normalized
      .split(" ")
      .filter(Boolean)
      .filter(
        w =>
          w.length >= 2
      )
  );
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(
  a: string,
  b: string
): number {

  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  const prev =
    new Array<number>(
      b.length + 1
    );

  for (
    let j = 0;
    j <= b.length;
    j++
  ) {
    prev[j] = j;
  }

  for (
    let i = 1;
    i <= a.length;
    i++
  ) {

    const curr =
      new Array<number>(
        b.length + 1
      );

    curr[0] = i;

    for (
      let j = 1;
      j <= b.length;
      j++
    ) {

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

    for (
      let j = 0;
      j <= b.length;
      j++
    ) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}


// ============================================================
// TOKEN SIMILARITY
// ============================================================

function tokenSimilarity(
  a: string,
  b: string
): number {

  if (a === b) {
    return 1;
  }

  if (!a || !b) {
    return 0;
  }

  const distance =
    levenshtein(
      a,
      b
    );

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  if (!maxLength) {
    return 0;
  }

  return (
    1 -
    distance /
      maxLength
  );
}


// ============================================================
// WEAK TEAM TOKENS
// ============================================================

const WEAK_TEAM_TOKENS =
  new Set([
    "united",
    "city",
    "athletic",
    "athletico",
    "sporting",
    "club",
    "real",
    "fc",
    "sc",
    "cf",
    "inter",
    "national",
    "international",
    "racing",
    "star",
    "red",
    "dynamo",
    "dinamo"
  ]);


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);

  if (!A || !B) {
    return 0;
  }

  if (
    !categoryCompatible(
      a,
      b
    )
  ) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  const aTokens =
    [
      ...teamTokens(A)
    ];

  const bTokens =
    [
      ...teamTokens(B)
    ];

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

  // ----------------------------------------------------------
  // Exact subset
  // ----------------------------------------------------------

  const shorter =
    aTokens.length <= bTokens.length
      ? aTokens
      : bTokens;

  const longer =
    aTokens.length <= bTokens.length
      ? bTokens
      : aTokens;

  const shorterAllExact =
    shorter.every(
      token =>
        longer.includes(token)
    );

  if (
    shorterAllExact &&
    shorter.length >= 2
  ) {

    const extraTokens =
      longer.filter(
        token =>
          !shorter.includes(token)
      );

    const meaningfulExtra =
      extraTokens.filter(
        token =>
          !/^u\d{2}$/.test(token) &&
          token !== "reserve" &&
          token !== "women" &&
          !/^team[234]$/.test(token)
      );

    if (
      meaningfulExtra.length === 0
    ) {
      return 0.97;
    }
  }

  let fuzzy = 0;

  let exact = 0;

  for (
    const aToken of aTokens
  ) {

    let best = 0;

    for (
      const bToken of bTokens
    ) {

      if (
        aToken === bToken
      ) {

        best = 1;
        break;
      }

      const sim =
        tokenSimilarity(
          aToken,
          bToken
        );

      if (
        sim > best
      ) {
        best = sim;
      }
    }

    if (
      best >= 0.90
    ) {

      fuzzy += best;

    } else if (
      best >= 0.75
    ) {

      fuzzy +=
        best * 0.65;
    }
  }

  for (
    const token of aTokens
  ) {

    if (
      bTokens.includes(token)
    ) {
      exact++;
    }
  }

  const minTokens =
    Math.min(
      aTokens.length,
      bTokens.length
    );

  const maxTokens =
    Math.max(
      aTokens.length,
      bTokens.length
    );

  const precision =
    fuzzy /
    Math.max(
      1,
      aTokens.length
    );

  const recall =
    fuzzy /
    Math.max(
      1,
      bTokens.length
    );

  const overlap =
    exact /
    Math.max(
      1,
      minTokens
    );

  let score =
    precision * 0.40 +
    recall * 0.25 +
    overlap * 0.35;

  // Single token
  if (
    aTokens.length === 1 &&
    bTokens.length === 1
  ) {

    const sim =
      tokenSimilarity(
        aTokens[0],
        bTokens[0]
      );

    if (
      sim >= 0.90
    ) {
      score =
        Math.max(
          score,
          sim
        );
    }
  }

  // One token vs large club
  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {

    score *= 0.50;
  }

  // Weak common token protection
  if (
    minTokens === 1 &&
    WEAK_TEAM_TOKENS.has(
      aTokens[0]
    )
  ) {

    score *= 0.35;
  }

  const exactMeaningful =
    aTokens.filter(
      token =>
        bTokens.includes(token) &&
        !WEAK_TEAM_TOKENS.has(token)
    ).length;

  if (
    exactMeaningful === 0 &&
    overlap > 0
  ) {

    score =
      Math.min(
        score,
        0.58
      );
  }

  return Math.min(
    1,
    score
  );
}


// ============================================================
// EXTRACT HOME
// ============================================================

function extractHome(
  match: AnyObj
): string | null {

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

  return splitMatchName(text).home;
}


// ============================================================
// EXTRACT AWAY
// ============================================================

function extractAway(
  match: AnyObj
): string | null {

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

  const text =
    String(
      value ?? ""
    ).trim();

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
    const separator of separators
  ) {

    const index =
      text.indexOf(separator);

    if (index >= 0) {

      return {

        home:
          text
            .slice(
              0,
              index
            )
            .trim(),

        away:
          text
            .slice(
              index +
              separator.length
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
// COMPETITION EXTRACTION
// ============================================================

function competitionText(
  match: AnyObj
): string {

  const competition =
    match?.competition;

  if (
    typeof competition === "string"
  ) {
    return normalizeText(
      competition
    );
  }

  if (
    typeof competition?.name === "string"
  ) {
    return normalizeText(
      competition.name
    );
  }

  if (
    typeof competition?.key === "string"
  ) {
    return normalizeText(
      competition.key
    );
  }

  const league =
    match?.league;

  if (
    typeof league === "string"
  ) {
    return normalizeText(
      league
    );
  }

  if (
    typeof league?.name === "string"
  ) {
    return normalizeText(
      league.name
    );
  }

  return "";
}


// ============================================================
// COUNTRY EXTRACTION
// ============================================================

function countryText(
  match: AnyObj
): string {

  const fields = [

    match?.country,

    match?.country_name,

    match?.competition?.country,

    match?.league?.country

  ];

  for (
    const value of fields
  ) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {

      return normalizeText(
        value
      );
    }
  }

  return "";
}


// ============================================================
// COMPETITION SIMILARITY
// ============================================================

function competitionSimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    competitionText(a);

  const B =
    competitionText(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  const aWords =
    new Set(
      A
        .split(" ")
        .filter(Boolean)
    );

  const bWords =
    new Set(
      B
        .split(" ")
        .filter(Boolean)
    );

  let overlap = 0;

  for (
    const word of aWords
  ) {

    if (
      bWords.has(word)
    ) {
      overlap++;
    }
  }

  return (
    overlap /
    Math.max(
      1,
      Math.min(
        aWords.size,
        bWords.size
      )
    )
  );
}


// ============================================================
// COUNTRY SIMILARITY
// ============================================================

function countrySimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    countryText(a);

  const B =
    countryText(b);

  if (!A || !B) {
    return 0;
  }

  return A === B ? 1 : 0;
}


// ============================================================
// DETAILED MATCH SCORE
// ============================================================

function detailedMatchScore(
  v27: AnyObj,
  cb: AnyObj
) {

  const vHome =
    extractHome(v27);

  const vAway =
    extractAway(v27);

  const cHome =
    extractHome(cb);

  const cAway =
    extractAway(cb);

  if (
    !vHome ||
    !vAway ||
    !cHome ||
    !cAway
  ) {

    return {

      total: 0,

      baseScore: 0,

      homeScore: 0,

      awayScore: 0,

      reverseHomeScore: 0,

      reverseAwayScore: 0,

      direction: "NONE",

      competitionScore: 0,

      countryScore: 0

    };
  }

  // NORMAL
  const homeScore =
    teamScore(
      vHome,
      cHome
    );

  const awayScore =
    teamScore(
      vAway,
      cAway
    );

  // REVERSED
  const reverseHomeScore =
    teamScore(
      vHome,
      cAway
    );

  const reverseAwayScore =
    teamScore(
      vAway,
      cHome
    );

  const normal =
    (
      homeScore +
      awayScore
    ) / 2;

  const reversed =
    (
      reverseHomeScore +
      reverseAwayScore
    ) / 2;

  let direction =
    "NORMAL";

  let baseScore =
    normal;

  // IMPORTANT:
  // Reversed is selected only if BOTH
  // sides are strong enough.
  if (
    reversed > normal &&
    reverseHomeScore >= 0.80 &&
    reverseAwayScore >= 0.80
  ) {

    direction =
      "REVERSED";

    baseScore =
      reversed;
  }

  const competitionScore =
    competitionSimilarity(
      v27,
      cb
    );

  const countryScore =
    countrySimilarity(
      v27,
      cb
    );

  let total =
    baseScore;

  if (
    competitionScore >= 0.80
  ) {

    total +=
      COMPETITION_BONUS;
  }

  if (
    countryScore === 1
  ) {

    total +=
      COUNTRY_BONUS;
  }

  return {

    total:
      Math.min(
        1,
        total
      ),

    baseScore,

    homeScore,

    awayScore,

    reverseHomeScore,

    reverseAwayScore,

    direction,

    competitionScore,

    countryScore

  };
}


// ============================================================
// CLASSIFY MATCH
// ============================================================

function classifyMatch(
  detail: AnyObj,
  threshold: number
) {

  const home =
    detail.homeScore;

  const away =
    detail.awayScore;

  const reverseHome =
    detail.reverseHomeScore;

  const reverseAway =
    detail.reverseAwayScore;

  const total =
    detail.total;


  // ==========================================================
  // REVERSED
  // ==========================================================

  if (
    detail.direction ===
    "REVERSED"
  ) {

    if (
      reverseHome >=
        REVERSED_CONFIDENT_SCORE &&

      reverseAway >=
        REVERSED_CONFIDENT_SCORE &&

      total >=
        REVERSED_CONFIDENT_SCORE
    ) {

      return {

        classification:
          "CONFIDENT_MATCH",

        reason:
          "STRONG_REVERSED_TWO_SIDED_MATCH"

      };
    }

    return {

      classification:
        "REVERSED_CANDIDATE",

      reason:
        "HOME_AWAY_DIRECTION_REVERSED"

    };
  }


  // ==========================================================
  // CONFIDENT
  // ==========================================================

  if (
    home >=
      STRONG_TEAM_SCORE &&

    away >=
      STRONG_TEAM_SCORE &&

    total >=
      Math.max(
        threshold,
        CONFIDENT_TOTAL_SCORE
      )
  ) {

    return {

      classification:
        "CONFIDENT_MATCH",

      reason:
        "STRONG_TWO_SIDED_MATCH"

    };
  }


  // ==========================================================
  // POSSIBLE
  // ==========================================================

  if (
    home >=
      POSSIBLE_TEAM_SCORE &&

    away >=
      POSSIBLE_TEAM_SCORE &&

    total >=
      POSSIBLE_TOTAL_SCORE
  ) {

    return {

      classification:
        "POSSIBLE_MATCH",

      reason:
        "BOTH_TEAMS_HAVE_REASONABLE_SIMILARITY"

    };
  }


  // ==========================================================
  // FALSE POSITIVE
  // ==========================================================

  if (
    (
      home >= 0.80 &&
      away < WEAK_SIDE_LIMIT
    ) ||

    (
      away >= 0.80 &&
      home < WEAK_SIDE_LIMIT
    )
  ) {

    return {

      classification:
        "FALSE_POSITIVE_RISK",

      reason:
        "ONLY_ONE_TEAM_MATCHES"

    };
  }


  // ==========================================================
  // CLOSE
  // ==========================================================

  if (
    total >=
    Math.max(
      0,
      threshold - 0.10
    )
  ) {

    return {

      classification:
        "CLOSE_BELOW_THRESHOLD",

      reason:
        "BOTH_SIDES_NOT_STRONG_ENOUGH"

    };
  }


  // ==========================================================
  // TRUE UNMATCHED
  // ==========================================================

  return {

    classification:
      "TRUE_UNMATCHED",

    reason:
      "WEAK_TWO_SIDED_SIMILARITY"

  };
}


// ============================================================
// FIND BEST MATCH
// ============================================================

function findBestMatch(
  v27: AnyObj,
  cloudbetMatches: AnyObj[],
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false
) {

  let best:
    AnyObj | null = null;

  let bestDetail:
    AnyObj | null = null;

  let bestScore = 0;

  for (
    const cb of cloudbetMatches
  ) {

    const cbId =
      String(
        cb?.id ??
        cb?.key ??
        ""
      );

    if (
      !ignoreUsed &&
      usedIds &&
      cbId &&
      usedIds.has(cbId)
    ) {
      continue;
    }

    const detail =
      detailedMatchScore(
        v27,
        cb
      );

    if (
      detail.total >
      bestScore
    ) {

      bestScore =
        detail.total;

      best =
        cb;

      bestDetail =
        detail;
    }
  }

  if (
    !best ||
    !bestDetail
  ) {

    return {

      matched: false,

      best: null,

      score: 0,

      detail: null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "NO_VALID_CLOUDBET_CANDIDATE"

    };
  }

  const classification =
    classifyMatch(
      bestDetail,
      threshold
    );

  const strictMatched =
    classification.classification ===
    "CONFIDENT_MATCH";

  return {

    matched:
      strictMatched,

    best,

    score:
      bestDetail.total,

    detail:
      bestDetail,

    classification:
      classification.classification,

    reason:
      classification.reason

  };
}


// ============================================================
// EXTRACT V27 MATCHES
// ============================================================

function extractV27Matches(
  data: any
): AnyObj[] {

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
      data?.events
    )
  ) {
    return data.events;
  }

  return [];
}


// ============================================================
// EXTRACT CLOUDBET MATCHES
// ============================================================

function extractCloudbetMatches(
  data: any
): AnyObj[] {

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
      data?.events
    )
  ) {
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
    String(
      match?.status ?? ""
    ).toUpperCase();

  if (
    status ===
    "TRADING_LIVE"
  ) {
    return true;
  }

  if (
    status ===
    "LIVE"
  ) {
    return true;
  }

  if (
    status ===
    "TRADING"
  ) {
    return true;
  }

  if (
    match?.live === true
  ) {
    return true;
  }

  if (
    match?.is_live === true
  ) {
    return true;
  }

  if (
    match?.in_play === true
  ) {
    return true;
  }

  // IMPORTANT:
  // /live is already the Cloudbet live feed.
  //
  // If Cloudbet does not provide a status field,
  // don't discard the event.
  if (!status) {
    return true;
  }

  return false;
}


// ============================================================
// MATCH DISPLAY NAME
// ============================================================

function matchDisplayName(
  match: AnyObj
): string {

  const home =
    extractHome(match);

  const away =
    extractAway(match);

  return (
    match?.match ??
    match?.name ??
    `${home ?? ""} - ${away ?? ""}`
  );
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

  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status}: ${text.slice(
        0,
        300
      )}`
    );
  }

  try {

    return JSON.parse(
      text
    );

  } catch {

    throw new Error(
      `Invalid JSON from ${path}`
    );
  }
}


// ============================================================
// BUILD MATCH RECORD
// ============================================================

function buildMatchRecord(
  v27: AnyObj,
  cb: AnyObj,
  detail: AnyObj
) {

  return {

    match:
      matchDisplayName(v27),

    v27: {

      id:
        v27?.id ??
        null,

      home:
        extractHome(v27),

      away:
        extractAway(v27),

      normalized_home:
        normalizeTeam(
          extractHome(v27)
        ),

      normalized_away:
        normalizeTeam(
          extractAway(v27)
        ),

      category_home:
        teamCategory(
          extractHome(v27)
        ),

      category_away:
        teamCategory(
          extractAway(v27)
        ),

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
        matchDisplayName(cb),

      home:
        extractHome(cb),

      away:
        extractAway(cb),

      normalized_home:
        normalizeTeam(
          extractHome(cb)
        ),

      normalized_away:
        normalizeTeam(
          extractAway(cb)
        ),

      category_home:
        teamCategory(
          extractHome(cb)
        ),

      category_away:
        teamCategory(
          extractAway(cb)
        ),

      status:
        cb?.status ??
        null,

      live:
        cb?.live ??
        cb?.is_live ??
        cb?.in_play ??
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
        null,

      country:
        cb?.country ??
        null
    },

    scoring: {

      total:
        Number(
          detail.total.toFixed(3)
        ),

      base_score:
        Number(
          detail.baseScore.toFixed(3)
        ),

      home_score:
        Number(
          detail.homeScore.toFixed(3)
        ),

      away_score:
        Number(
          detail.awayScore.toFixed(3)
        ),

      reverse_home_score:
        Number(
          detail.reverseHomeScore.toFixed(3)
        ),

      reverse_away_score:
        Number(
          detail.reverseAwayScore.toFixed(3)
        ),

      direction:
        detail.direction,

      competition_score:
        Number(
          detail.competitionScore.toFixed(3)
        ),

      country_score:
        Number(
          detail.countryScore.toFixed(3)
        )
    }
  };
}


// ============================================================
// BUILD UNMATCHED RECORD
// ============================================================

function buildUnmatchedRecord(
  index: number,
  v27: AnyObj,
  result: AnyObj,
  threshold: number
) {

  return {

    index,

    v27: {

      id:
        v27?.id ??
        null,

      match:
        matchDisplayName(v27),

      home:
        extractHome(v27),

      away:
        extractAway(v27),

      normalized_home:
        normalizeTeam(
          extractHome(v27)
        ),

      normalized_away:
        normalizeTeam(
          extractAway(v27)
        ),

      category_home:
        teamCategory(
          extractHome(v27)
        ),

      category_away:
        teamCategory(
          extractAway(v27)
        ),

      minute:
        v27?.minute ??
        v27?.minute_display ??
        null,

      score:
        v27?.score ??
        null
    },

    best_cloudbet:
      result.best
        ? {

            id:
              result.best?.id ??
              null,

            key:
              result.best?.key ??
              null,

            match:
              matchDisplayName(
                result.best
              ),

            home:
              extractHome(
                result.best
              ),

            away:
              extractAway(
                result.best
              ),

            normalized_home:
              normalizeTeam(
                extractHome(
                  result.best
                )
              ),

            normalized_away:
              normalizeTeam(
                extractAway(
                  result.best
                )
              ),

            category_home:
              teamCategory(
                extractHome(
                  result.best
                )
              ),

            category_away:
              teamCategory(
                extractAway(
                  result.best
                )
              ),

            competition:
              result.best?.competition ??
              null

          }
        : null,

    scoring:
      result.detail
        ? {

            total:
              Number(
                result.detail.total.toFixed(3)
              ),

            base_score:
              Number(
                result.detail.baseScore.toFixed(3)
              ),

            home_score:
              Number(
                result.detail.homeScore.toFixed(3)
              ),

            away_score:
              Number(
                result.detail.awayScore.toFixed(3)
              ),

            reverse_home_score:
              Number(
                result.detail.reverseHomeScore.toFixed(3)
              ),

            reverse_away_score:
              Number(
                result.detail.reverseAwayScore.toFixed(3)
              ),

            direction:
              result.detail.direction

          }
        : null,

    threshold,

    gap_to_threshold:
      Number(
        Math.max(
          0,
          threshold -
          Number(
            result.detail?.total ??
            0
          )
        ).toFixed(3)
      ),

    classification:
      result.classification,

    reason:
      result.reason
  };
}


// ============================================================
// MAIN MATCHER
// ============================================================

async function runMatcher(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();

  const url =
    new URL(
      request.url
    );

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      String(
        DEFAULT_THRESHOLD
      )
    );

  if (
    !Number.isFinite(threshold)
  ) {

    threshold =
      DEFAULT_THRESHOLD;
  }

  threshold =
    Math.max(
      0.30,
      Math.min(
        1,
        threshold
      )
    );


  // ==========================================================
  // LOAD V27 + CLOUDBET IN PARALLEL
  // ==========================================================

  const [
    v27Data,
    cloudbetData
  ] =
    await Promise.all([

      fetchServiceJSON(
        env.V27,
        "/"
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      )

    ]);


  // ==========================================================
  // EXTRACT
  // ==========================================================

  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const allCloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    allCloudbetMatches
      .filter(
        isCloudbetLive
      );


  // ==========================================================
  // RESULT ARRAYS
  // ==========================================================

  const matches:
    AnyObj[] = [];

  const possibleMatches:
    AnyObj[] = [];

  const unmatched:
    AnyObj[] = [];

  const falsePositiveRisks:
    AnyObj[] = [];

  const reversedCandidates:
    AnyObj[] = [];


  const usedCloudbetIds =
    new Set<string>();


  // ==========================================================
  // PROCESS
  // ==========================================================

  for (
    const v27 of
    v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        usedCloudbetIds,
        false
      );


    // --------------------------------------------------------
    // CONFIDENT
    // --------------------------------------------------------

    if (
      result.matched &&
      result.best
    ) {

      const cb =
        result.best;

      const cbId =
        String(
          cb?.id ??
          cb?.key ??
          ""
        );

      if (
        cbId
      ) {

        usedCloudbetIds.add(
          cbId
        );
      }

      matches.push({

        ...buildMatchRecord(
          v27,
          cb,
          result.detail
        ),

        classification:
          "CONFIDENT_MATCH",

        reason:
          result.reason

      });

      continue;
    }


    // --------------------------------------------------------
    // DIAGNOSTIC CATEGORIES
    // --------------------------------------------------------

    if (
      result.best &&
      result.detail
    ) {

      const item =
        buildMatchRecord(
          v27,
          result.best,
          result.detail
        );


      if (
        result.classification ===
        "POSSIBLE_MATCH"
      ) {

        possibleMatches.push({

          ...item,

          classification:
            "POSSIBLE_MATCH",

          reason:
            result.reason

        });

        continue;
      }


      if (
        result.classification ===
        "REVERSED_CANDIDATE"
      ) {

        reversedCandidates.push({

          ...item,

          classification:
            "REVERSED_CANDIDATE",

          reason:
            result.reason

        });

        continue;
      }


      if (
        result.classification ===
        "FALSE_POSITIVE_RISK"
      ) {

        falsePositiveRisks.push({

          ...item,

          classification:
            "FALSE_POSITIVE_RISK",

          reason:
            result.reason

        });

        continue;
      }


      unmatched.push(
        buildUnmatchedRecord(
          unmatched.length,
          v27,
          result,
          threshold
        )
      );

      continue;
    }


    // --------------------------------------------------------
    // NO CANDIDATE
    // --------------------------------------------------------

    unmatched.push(
      buildUnmatchedRecord(
        unmatched.length,
        v27,
        result,
        threshold
      )
    );
  }


  // ==========================================================
  // RESPONSE
  // ==========================================================

  return json({

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      "V5",

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

      strong_team_score:
        STRONG_TEAM_SCORE,

      possible_team_score:
        POSSIBLE_TEAM_SCORE,

      possible_total_score:
        POSSIBLE_TOTAL_SCORE,

      confident_total_score:
        CONFIDENT_TOTAL_SCORE,

      reversed_confident_score:
        REVERSED_CONFIDENT_SCORE,

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL"

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        allCloudbetMatches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      confident_matched:
        matches.length,

      possible_matches:
        possibleMatches.length,

      reversed_candidates:
        reversedCandidates.length,

      false_positive_risks:
        falsePositiveRisks.length,

      true_unmatched:
        unmatched.length,

      unique_cloudbet_used:
        usedCloudbetIds.size,

      processing_ms:
        Date.now() -
        started

    },

    matches,

    possible_matches:
      possibleMatches,

    reversed_candidates:
      reversedCandidates,

    false_positive_risks:
      falsePositiveRisks,

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
// DIAGNOSTIC MODE
// ============================================================

async function runDiagnostic(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();

  const url =
    new URL(
      request.url
    );

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      String(
        DEFAULT_THRESHOLD
      )
    );

  if (
    !Number.isFinite(threshold)
  ) {

    threshold =
      DEFAULT_THRESHOLD;
  }

  threshold =
    Math.max(
      0.30,
      Math.min(
        1,
        threshold
      )
    );


  // ==========================================================
  // LOAD BOTH SERVICES IN PARALLEL
  // ==========================================================

  const [
    v27Data,
    cloudbetData
  ] =
    await Promise.all([

      fetchServiceJSON(
        env.V27,
        "/"
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      )

    ]);


  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const allCloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    allCloudbetMatches
      .filter(
        isCloudbetLive
      );


  // ==========================================================
  // NORMAL MATCH
  // ==========================================================

  const usedCloudbetIds =
    new Set<string>();

  const normalMatched:
    AnyObj[] = [];

  const normalUnmatched:
    AnyObj[] = [];


  for (
    const v27 of
    v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        usedCloudbetIds,
        false
      );

    if (
      result.matched &&
      result.best
    ) {

      const cbId =
        String(
          result.best?.id ??
          result.best?.key ??
          ""
        );

      if (
        cbId
      ) {

        usedCloudbetIds.add(
          cbId
        );
      }

      normalMatched.push(
        v27
      );

    } else {

      normalUnmatched.push(
        v27
      );
    }
  }


  // ==========================================================
  // DIAGNOSTIC AGAINST ALL CLOUDBET
  // ==========================================================

  const diagnostics:
    AnyObj[] = [];

  let potentialMatches = 0;

  let closeBelowThreshold = 0;

  let reversedCandidates = 0;

  let trueUnmatched = 0;

  let falsePositiveRisk = 0;


  for (
    let i = 0;
    i <
    normalUnmatched.length;
    i++
  ) {

    const v27 =
      normalUnmatched[i];

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        undefined,
        true
      );


    if (
      result.best &&
      result.detail
    ) {

      const classification =
        classifyMatch(
          result.detail,
          threshold
        );


      if (
        classification.classification ===
        "POSSIBLE_MATCH"
      ) {
        potentialMatches++;
      }

      if (
        classification.classification ===
        "CLOSE_BELOW_THRESHOLD"
      ) {
        closeBelowThreshold++;
      }

      if (
        classification.classification ===
        "REVERSED_CANDIDATE"
      ) {
        reversedCandidates++;
      }

      if (
        classification.classification ===
        "FALSE_POSITIVE_RISK"
      ) {
        falsePositiveRisk++;
      }

      if (
        classification.classification ===
        "TRUE_UNMATCHED"
      ) {
        trueUnmatched++;
      }


      diagnostics.push({

        index:
          i,

        v27: {

          id:
            v27?.id ??
            null,

          match:
            matchDisplayName(v27),

          home:
            extractHome(v27),

          away:
            extractAway(v27),

          normalized_home:
            normalizeTeam(
              extractHome(v27)
            ),

          normalized_away:
            normalizeTeam(
              extractAway(v27)
            ),

          category_home:
            teamCategory(
              extractHome(v27)
            ),

          category_away:
            teamCategory(
              extractAway(v27)
            ),

          minute:
            v27?.minute ??
            v27?.minute_display ??
            null,

          score:
            v27?.score ??
            null

        },


        best_cloudbet: {

          id:
            result.best?.id ??
            null,

          key:
            result.best?.key ??
            null,

          match:
            matchDisplayName(
              result.best
            ),

          home:
            extractHome(
              result.best
            ),

          away:
            extractAway(
              result.best
            ),

          normalized_home:
            normalizeTeam(
              extractHome(
                result.best
              )
            ),

          normalized_away:
            normalizeTeam(
              extractAway(
                result.best
              )
            ),

          category_home:
            teamCategory(
              extractHome(
                result.best
              )
            ),

          category_away:
            teamCategory(
              extractAway(
                result.best
              )
            ),

          status:
            result.best?.status ??
            null,

          live:
            result.best?.live ??
            result.best?.is_live ??
            result.best?.in_play ??
            null,

          competition:
            result.best?.competition ??
            null

        },


        scoring: {

          total:
            Number(
              result.detail.total.toFixed(3)
            ),

          base_score:
            Number(
              result.detail.baseScore.toFixed(3)
            ),

          home_score:
            Number(
              result.detail.homeScore.toFixed(3)
            ),

          away_score:
            Number(
              result.detail.awayScore.toFixed(3)
            ),

          reverse_home_score:
            Number(
              result.detail.reverseHomeScore.toFixed(3)
            ),

          reverse_away_score:
            Number(
              result.detail.reverseAwayScore.toFixed(3)
            ),

          direction:
            result.detail.direction,

          competition_score:
            Number(
              result.detail.competitionScore.toFixed(3)
            ),

          country_score:
            Number(
              result.detail.countryScore.toFixed(3)
            )

        },


        threshold,

        gap_to_threshold:
          Number(
            Math.max(
              0,
              threshold -
              result.detail.total
            ).toFixed(3)
          ),

        classification:
          classification.classification,

        reason:
          classification.reason

      });

    } else {

      trueUnmatched++;

      diagnostics.push({

        index:
          i,

        v27: {

          id:
            v27?.id ??
            null,

          match:
            matchDisplayName(v27),

          home:
            extractHome(v27),

          away:
            extractAway(v27),

          normalized_home:
            normalizeTeam(
              extractHome(v27)
            ),

          normalized_away:
            normalizeTeam(
              extractAway(v27)
            ),

          category_home:
            teamCategory(
              extractHome(v27)
            ),

          category_away:
            teamCategory(
              extractAway(v27)
            ),

          minute:
            v27?.minute ??
            v27?.minute_display ??
            null,

          score:
            v27?.score ??
            null

        },

        best_cloudbet:
          null,

        scoring:
          null,

        threshold,

        gap_to_threshold:
          Number(
            threshold.toFixed(3)
          ),

        classification:
          "TRUE_UNMATCHED",

        reason:
          "NO_VALID_CLOUDBET_CANDIDATE"

      });
    }
  }


  // ==========================================================
  // SORT
  // ==========================================================

  diagnostics.sort(
    (a, b) =>
      Number(
        b?.scoring?.total ??
        0
      ) -
      Number(
        a?.scoring?.total ??
        0
      )
  );


  // ==========================================================
  // RESPONSE
  // ==========================================================

  return json({

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      "V5",

    mode:
      "READ ONLY",

    diagnostic:
      "UNMATCHED_ONLY",

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
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL",

      diagnostic_note:
        "Used Cloudbet IDs are ignored during diagnostic comparison so every unmatched V27 event is compared against every live Cloudbet event."

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        allCloudbetMatches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      normal_matched:
        normalMatched.length,

      unmatched:
        normalUnmatched.length,

      potential_matches:
        potentialMatches,

      close_below_threshold:
        closeBelowThreshold,

      reversed_candidates:
        reversedCandidates,

      false_positive_risk:
        falsePositiveRisk,

      true_unmatched:
        trueUnmatched,

      diagnostic_items:
        diagnostics.length,

      processing_ms:
        Date.now() -
        started

    },

    diagnostics:
      diagnostics.slice(
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

    version:
      "V5",

    mode:
      "READ ONLY",

    bindings: {

      V27:
        true,

      CLOUDBET:
        true

    },

    matcher:
      "V5 STRICT TWO-SIDED MATCH",

    rules: {

      confident:
        "Both teams >= 0.78 and total >= 0.80",

      possible:
        "Both teams >= 0.60 and total >= 0.72",

      reversed:
        "Both reversed team scores >= 0.90 and total >= 0.90",

      false_positive:
        "One team strong while the other is weak",

      category_protection:
        "U19/U21/U23/reserve/women categories are protected",

      aliases:
        "Aliases are applied inside larger team names",

      common_tokens:
        "Generic/common club tokens cannot create a strong match alone",

      cloudbet_live:
        "TRADING_LIVE / LIVE / TRADING / live flags / empty-status fallback"

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
      // NORMAL MATCH
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
      // DIAGNOSTIC
      // ------------------------------------------------------

      if (
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {

        return runDiagnostic(
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

            "/live",

            "/diagnostic",

            "/diagnostic?threshold=0.45"

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

          version:
            "V5",

          mode:
            "READ ONLY",

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
