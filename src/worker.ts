// ============================================================
// CLOUDBET MATCH MATCHER V7-FH
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V7-FH FIXED:
//
// 1. FIRST-HALF INPUT FILTER
// 2. V27 FIRST-HALF / FILTERED SPLIT
// 3. CLOUDBET FIRST-HALF FILTER
// 4. PRE-NORMALIZED TEAMS
// 5. DIRECT TWO-SIDED EXACT/ALIAS PASS
// 6. TOKEN INDEX
// 7. SAFE EXACT / ALIAS LOOKUP
// 8. LIMITED FUZZY FALLBACK
// 9. STRICT TWO-SIDED MATCH
// 10. CATEGORY PROTECTION
// 11. HOME/AWAY DIRECTION CHECK
// 12. COMPETITION / COUNTRY SIGNAL
// 13. CLOUDBET-ONLY AGAINST ALL V27
// 14. V27_COUNTERPART_FILTERED
// 15. NO_V27_COUNTERPART
// 16. EXACT ID ALONE IS NEVER SECURITY
// 17. READ ONLY
//
// IMPORTANT:
// Matcher scoring thresholds remain unchanged.
// The fix improves candidate discovery and exact/alias linking.
// ============================================================

interface Env {
  V27: Fetcher;
  CLOUDBET: Fetcher;
}

type AnyObj = Record<string, any>;

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
// NORMALIZATION
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
// ALIASES
// ============================================================

const TEAM_ALIASES: Record<string, string> = {

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
  "spa",
  "srl",
  "football",
  "soccer"
]);


// ============================================================
// CATEGORY
// ============================================================

function normalizeCategory(value: any): string {

  let s = normalizeText(value);

  if (!s) return "";

  s = s
    .replace(/\bu\s+(\d{2})\b/g, "u$1")
    .replace(/\bu(\d{2})\b/g, "u$1")
    .replace(/\bunder\s+(\d{2})\b/g, "u$1")
    .replace(/\b(\d{2})\s*years?\b/g, "u$1")
    .replace(/\bii\b/g, "2")
    .replace(/\biii\b/g, "3")
    .replace(/\biv\b/g, "4")
    .replace(/\breserves?\b/g, "reserve")
    .replace(/\bres\b/g, "reserve")
    .replace(/\bwomen\b/g, "women")
    .replace(/\bwomen'?s\b/g, "women")
    .replace(/\bladies\b/g, "women")
    .replace(/\bgirls\b/g, "women");

  const categories: string[] = [];

  for (const token of s.split(" ").filter(Boolean)) {

    if (/^u\d{2}$/.test(token)) {
      categories.push(token);
    }

    if (token === "reserve") {
      categories.push("reserve");
    }

    if (token === "women") {
      categories.push("women");
    }

    if (/^[234]$/.test(token)) {
      categories.push(`team${token}`);
    }
  }

  return categories.join(" ");
}


function teamCategory(value: any): string {
  return normalizeCategory(value);
}


function categoryCompatible(a: any, b: any): boolean {

  const A = teamCategory(a);
  const B = teamCategory(b);

  if (!A && !B) return true;

  if (!A || !B) return true;

  return A === B;
}


// ============================================================
// TEAM ALIASES
// ============================================================

function applyTeamAliases(value: string): string {

  let s = normalizeText(value);

  if (!s) return "";

  const aliases = Object.keys(TEAM_ALIASES)
    .sort((a, b) => b.length - a.length);

  for (const alias of aliases) {

    const canonical =
      TEAM_ALIASES[alias];

    const regex = new RegExp(
      `(^|\\s)${alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      )}(?=\\s|$)`,
      "g"
    );

    s = s.replace(
      regex,
      `$1${canonical}`
    );
  }

  return s
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeTeam(value: any): string {

  let s = normalizeText(value);

  if (!s) return "";

  s = applyTeamAliases(s);

  const words = s
    .split(" ")
    .filter(Boolean)
    .filter(
      w => !GENERIC_WORDS.has(w)
    )
    .filter(
      w => !/^\d+$/.test(w)
    );

  return words.join(" ").trim();
}


function teamTokens(value: any): Set<string> {

  return new Set(
    normalizeTeam(value)
      .split(" ")
      .filter(Boolean)
      .filter(
        w => w.length >= 2
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

  if (a === b) return 0;

  if (!a.length) return b.length;

  if (!b.length) return a.length;

  let prev =
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

    prev = curr;
  }

  return prev[b.length];
}


function tokenSimilarity(
  a: string,
  b: string
): number {

  if (a === b) return 1;

  if (!a || !b) return 0;

  const distance =
    levenshtein(a, b);

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  return maxLength
    ? 1 - distance / maxLength
    : 0;
}


// ============================================================
// WEAK TOKENS
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

  if (!A || !B) return 0;

  if (!categoryCompatible(a, b)) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  const aTokens =
    [...teamTokens(A)];

  const bTokens =
    [...teamTokens(B)];

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

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

    if (!meaningfulExtra.length) {
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

      if (sim > best) {
        best = sim;
      }
    }

    if (best >= 0.90) {
      fuzzy += best;
    }
    else if (best >= 0.75) {
      fuzzy += best * 0.65;
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
      score =
        Math.max(
          score,
          sim
        );
    }
  }

  if (
    minTokens === 1 &&
    bTokens.length >= 3 &&
    overlap === 0
  ) {
    score *= 0.50;
  }

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
// HOME / AWAY
// ============================================================

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {

  const text =
    String(value ?? "").trim();

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
      text.indexOf(
        separator
      );

    if (index >= 0) {

      return {
        home:
          text.slice(
            0,
            index
          ).trim(),

        away:
          text.slice(
            index +
            separator.length
          ).trim()
      };
    }
  }

  return {
    home: null,
    away: null
  };
}


function extractHome(
  match: AnyObj
): string | null {

  if (
    typeof match?.home ===
    "string"
  ) {
    return match.home;
  }

  if (
    typeof match?.homeTeam ===
    "string"
  ) {
    return match.homeTeam;
  }

  if (
    typeof match?.home_name ===
    "string"
  ) {
    return match.home_name;
  }

  if (
    typeof match?.home?.name ===
    "string"
  ) {
    return match.home.name;
  }

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).home;
}


function extractAway(
  match: AnyObj
): string | null {

  if (
    typeof match?.away ===
    "string"
  ) {
    return match.away;
  }

  if (
    typeof match?.awayTeam ===
    "string"
  ) {
    return match.awayTeam;
  }

  if (
    typeof match?.away_name ===
    "string"
  ) {
    return match.away_name;
  }

  if (
    typeof match?.away?.name ===
    "string"
  ) {
    return match.away.name;
  }

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).away;
}


// ============================================================
// MINUTE / PERIOD
// ============================================================

function parseMinute(
  value: any
): number | null {

  if (
    typeof value === "number"
  ) {

    if (
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 130
    ) {
      return Math.floor(value);
    }

    return null;
  }

  const text =
    String(value ?? "").trim();

  if (!text) return null;

  const plus =
    text.match(
      /^(\d{1,3})\s*\+\s*(\d{1,2})/
    );

  if (plus) {

    const base =
      Number(plus[1]);

    if (
      Number.isFinite(base) &&
      base >= 0 &&
      base <= 130
    ) {
      return base;
    }
  }

  const match =
    text.match(
      /(\d{1,3})/
    );

  if (!match) return null;

  const minute =
    Number(match[1]);

  if (
    !Number.isFinite(minute) ||
    minute < 0 ||
    minute > 130
  ) {
    return null;
  }

  return minute;
}


function periodText(
  match: AnyObj
): string {

  const fields = [
    match?.period,
    match?.period_name,
    match?.periodName,
    match?.phase,
    match?.phase_name,
    match?.half,
    match?.match_period,
    match?.game_period,
    match?.status,
    match?.status_text,
    match?.statusText
  ];

  for (
    const value of fields
  ) {

    if (
      typeof value ===
      "string" &&
      value.trim()
    ) {
      return normalizeText(
        value
      );
    }

    if (
      typeof value ===
      "object" &&
      value
    ) {

      const nested =
        value?.name ??
        value?.label ??
        value?.period ??
        value?.short;

      if (
        typeof nested ===
        "string" &&
        nested.trim()
      ) {
        return normalizeText(
          nested
        );
      }
    }
  }

  return "";
}


function hasExplicitSecondHalf(
  match: AnyObj
): boolean {

  const text =
    periodText(match);

  if (!text) return false;

  return [
    /\b2h\b/,
    /\bsecond half\b/,
    /\b2nd half\b/,
    /\bsecondhalf\b/,
    /\b2ndhalf\b/,
    /\bperiod 2\b/,
    /\bhalf 2\b/,
    /\bhalf2\b/
  ].some(
    pattern =>
      pattern.test(text)
  );
}


function hasExplicitFirstHalf(
  match: AnyObj
): boolean {

  const text =
    periodText(match);

  if (!text) return false;

  return [
    /\b1h\b/,
    /\bfirst half\b/,
    /\b1st half\b/,
    /\bfirsthalf\b/,
    /\b1sthalf\b/,
    /\bperiod 1\b/,
    /\bhalf 1\b/,
    /\bhalf1\b/
  ].some(
    pattern =>
      pattern.test(text)
  );
}


function matchMinute(
  match: AnyObj
): number | null {

  const fields = [
    match?.minute,
    match?.minute_display,
    match?.minuteDisplay,
    match?.clock?.minute,
    match?.clock?.display,
    match?.game_time,
    match?.gameTime,
    match?.elapsed,
    match?.elapsed_time,
    match?.elapsedTime
  ];

  for (
    const value of fields
  ) {

    const minute =
      parseMinute(value);

    if (
      minute !== null
    ) {
      return minute;
    }
  }

  return null;
}


// ============================================================
// V27 FILTER STATE
// ============================================================

type V27FilterState =
  | "FIRST_HALF"
  | "FILTERED_SECOND_HALF";


function getV27FilterState(
  match: AnyObj
): V27FilterState {

  if (
    hasExplicitSecondHalf(
      match
    )
  ) {
    return "FILTERED_SECOND_HALF";
  }

  if (
    hasExplicitFirstHalf(
      match
    )
  ) {
    return "FIRST_HALF";
  }

  const minute =
    matchMinute(match);

  if (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
  ) {
    return "FIRST_HALF";
  }

  return "FIRST_HALF";
}


function isFirstHalf(
  match: AnyObj
): boolean {

  return (
    getV27FilterState(
      match
    ) === "FIRST_HALF"
  );
}


// ============================================================
// COMPETITION / COUNTRY
// ============================================================

function competitionText(
  match: AnyObj
): string {

  const competition =
    match?.competition;

  if (
    typeof competition ===
    "string"
  ) {
    return normalizeText(
      competition
    );
  }

  if (
    typeof competition?.name ===
    "string"
  ) {
    return normalizeText(
      competition.name
    );
  }

  if (
    typeof competition?.key ===
    "string"
  ) {
    return normalizeText(
      competition.key
    );
  }

  const league =
    match?.league;

  if (
    typeof league ===
    "string"
  ) {
    return normalizeText(
      league
    );
  }

  if (
    typeof league?.name ===
    "string"
  ) {
    return normalizeText(
      league.name
    );
  }

  return "";
}


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
      typeof value ===
      "string" &&
      value.trim()
    ) {
      return normalizeText(
        value
      );
    }
  }

  return "";
}


function competitionSimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    competitionText(a);

  const B =
    competitionText(b);

  if (!A || !B) return 0;

  if (A === B) return 1;

  const aWords =
    new Set(
      A.split(" ")
        .filter(Boolean)
    );

  const bWords =
    new Set(
      B.split(" ")
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

  return overlap /
    Math.max(
      1,
      Math.min(
        aWords.size,
        bWords.size
      )
    );
}


function countrySimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    countryText(a);

  const B =
    countryText(b);

  if (!A || !B) return 0;

  return A === B ? 1 : 0;
}


// ============================================================
// NEW FIX:
// DIRECT TWO-SIDED NORMALIZED TEAM MATCH
//
// This is intentionally BEFORE token/fuzzy candidate selection.
//
// It allows:
//
// V27:
//   Aberystwyth - Llanelli
//
// Cloudbet:
//   Aberystwyth FC - Llanelli AFC
//
// to reach detailed scoring even when the raw IDs differ.
//
// Security is still decided by detailedMatchScore + classifyMatch.
// ============================================================

function directTwoSidedMatch(
  v27: PreparedMatch,
  cb: PreparedMatch
): boolean {

  if (
    !v27.normalizedHome ||
    !v27.normalizedAway ||
    !cb.normalizedHome ||
    !cb.normalizedAway
  ) {
    return false;
  }

  if (
    !categoryCompatible(
      v27.home,
      cb.home
    )
  ) {
    return false;
  }

  if (
    !categoryCompatible(
      v27.away,
      cb.away
    )
  ) {
    return false;
  }

  const normalHome =
    v27.normalizedHome ===
    cb.normalizedHome;

  const normalAway =
    v27.normalizedAway ===
    cb.normalizedAway;

  if (
    normalHome &&
    normalAway
  ) {
    return true;
  }

  return false;
}


// ============================================================
// DIRECT ALIAS / TOKEN PAIR MATCH
//
// Requires both sides to have meaningful overlap.
// This prevents a single common team token from creating
// a candidate by itself.
// ============================================================

function directTwoSidedTokenMatch(
  v27: PreparedMatch,
  cb: PreparedMatch
): boolean {

  if (
    !v27.normalizedHome ||
    !v27.normalizedAway ||
    !cb.normalizedHome ||
    !cb.normalizedAway
  ) {
    return false;
  }

  if (
    !categoryCompatible(
      v27.home,
      cb.home
    ) ||
    !categoryCompatible(
      v27.away,
      cb.away
    )
  ) {
    return false;
  }

  const home =
    teamScore(
      v27.home,
      cb.home
    );

  const away =
    teamScore(
      v27.away,
      cb.away
    );

  return (
    home >= POSSIBLE_TEAM_SCORE &&
    away >= POSSIBLE_TEAM_SCORE
  );
}


// ============================================================
// SCORE
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
    (homeScore + awayScore) / 2;

  const reversed =
    (reverseHomeScore +
      reverseAwayScore) / 2;

  let direction =
    "NORMAL";

  let baseScore =
    normal;

  if (
    reversed > normal &&
    reverseHomeScore >=
      REVERSED_CONFIDENT_SCORE &&
    reverseAwayScore >=
      REVERSED_CONFIDENT_SCORE
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
// CLASSIFY
// ============================================================

function classifyMatch(
  detail: AnyObj,
  threshold: number
) {

  const home =
    detail.homeScore;

  const away =
    detail.awayScore;

  const total =
    detail.total;

  if (
    detail.direction ===
    "REVERSED"
  ) {

    if (
      home >= 0.90 &&
      away >= 0.90
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

  if (
    home >= STRONG_TEAM_SCORE &&
    away >= STRONG_TEAM_SCORE &&
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

  if (
    home >= POSSIBLE_TEAM_SCORE &&
    away >= POSSIBLE_TEAM_SCORE &&
    total >= POSSIBLE_TOTAL_SCORE
  ) {

    return {
      classification:
        "POSSIBLE_MATCH",

      reason:
        "BOTH_TEAMS_HAVE_REASONABLE_SIMILARITY"
    };
  }

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

  return {
    classification:
      "TRUE_UNMATCHED",

    reason:
      "WEAK_TWO_SIDED_SIMILARITY"
  };
}


// ============================================================
// PREPARED
// ============================================================

interface PreparedMatch {

  raw: AnyObj;

  id: string;

  home: string;

  away: string;

  normalizedHome: string;

  normalizedAway: string;

  homeTokens: string[];

  awayTokens: string[];

  homeCategory: string;

  awayCategory: string;
}


function prepareMatch(
  match: AnyObj
): PreparedMatch {

  const home =
    extractHome(match) ?? "";

  const away =
    extractAway(match) ?? "";

  return {

    raw: match,

    id: String(
      match?.id ??
      match?.key ??
      ""
    ),

    home,

    away,

    normalizedHome:
      normalizeTeam(home),

    normalizedAway:
      normalizeTeam(away),

    homeTokens:
      [...teamTokens(home)],

    awayTokens:
      [...teamTokens(away)],

    homeCategory:
      teamCategory(home),

    awayCategory:
      teamCategory(away)
  };
}


// ============================================================
// TOKEN INDEX
// ============================================================

function buildTokenIndex(
  matches: PreparedMatch[]
): Map<string, number[]> {

  const index =
    new Map<
      string,
      number[]
    >();

  for (
    let i = 0;
    i < matches.length;
    i++
  ) {

    const match =
      matches[i];

    const tokens =
      new Set([
        ...match.homeTokens,
        ...match.awayTokens
      ]);

    for (
      const token of tokens
    ) {

      const list =
        index.get(token);

      if (list) {
        list.push(i);
      }
      else {
        index.set(
          token,
          [i]
        );
      }
    }
  }

  return index;
}


// ============================================================
// CANDIDATES
// ============================================================

function getCandidates(
  v27: PreparedMatch,
  cloudbet: PreparedMatch[],
  tokenIndex: Map<string, number[]>
): number[] {

  const candidateSet =
    new Set<number>();


  // ----------------------------------------------------------
  // FIX 1:
  // Direct two-sided normalized match.
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < cloudbet.length;
    i++
  ) {

    const cb =
      cloudbet[i];

    if (
      directTwoSidedMatch(
        v27,
        cb
      )
    ) {
      candidateSet.add(i);
    }
  }


  // ----------------------------------------------------------
  // FIX 2:
  // Two-sided token/alias candidate.
  // ----------------------------------------------------------

  for (
    let i = 0;
    i < cloudbet.length;
    i++
  ) {

    const cb =
      cloudbet[i];

    if (
      directTwoSidedTokenMatch(
        v27,
        cb
      )
    ) {
      candidateSet.add(i);
    }
  }


  // ----------------------------------------------------------
  // Existing token index.
  // ----------------------------------------------------------

  const vTokens =
    new Set([
      ...v27.homeTokens,
      ...v27.awayTokens
    ]);

  for (
    const token of vTokens
  ) {

    const indexes =
      tokenIndex.get(token);

    if (!indexes) continue;

    for (
      const index of indexes
    ) {
      candidateSet.add(index);
    }
  }


  // ----------------------------------------------------------
  // Limited fallback.
  // ----------------------------------------------------------

  if (
    !candidateSet.size
  ) {

    const limit =
      Math.min(
        cloudbet.length,
        20
      );

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      candidateSet.add(i);
    }
  }

  return [
    ...candidateSet
  ];
}


// ============================================================
// BEST MATCH
// ============================================================

function findBestMatch(
  v27: PreparedMatch,
  cloudbet: PreparedMatch[],
  tokenIndex: Map<string, number[]>,
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false
) {

  let best:
    PreparedMatch | null =
    null;

  let bestDetail:
    AnyObj | null =
    null;

  let bestScore = 0;

  let candidateEvaluations = 0;


  const candidates =
    getCandidates(
      v27,
      cloudbet,
      tokenIndex
    );


  for (
    const index of candidates
  ) {

    const cb =
      cloudbet[index];

    if (!cb) continue;

    if (
      !ignoreUsed &&
      usedIds &&
      cb.id &&
      usedIds.has(cb.id)
    ) {
      continue;
    }

    candidateEvaluations++;


    const detail =
      detailedMatchScore(
        v27.raw,
        cb.raw
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
        "NO_VALID_CLOUDBET_CANDIDATE",

      candidateEvaluations
    };
  }


  const classification =
    classifyMatch(
      bestDetail,
      threshold
    );


  return {

    matched:
      classification.classification ===
      "CONFIDENT_MATCH",

    best,

    score:
      bestDetail.total,

    detail:
      bestDetail,

    classification:
      classification.classification,

    reason:
      classification.reason,

    candidateEvaluations
  };
}


// ============================================================
// EXTRACT
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
    match?.live === true
  ) {
    return true;
  }

  return false;
}


// ============================================================
// DISPLAY
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
// SERVICE FETCH
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
      `HTTP ${response.status}: ${text.slice(
        0,
        300
      )}`
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
// SCORE RECORD
// ============================================================

function scoringRecord(
  detail: AnyObj
): AnyObj {

  return {

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
  };
}


// ============================================================
// V27 COUNTERPART SEARCH
//
// FIX:
// The counterpart search now performs a direct two-sided
// normalized/alias candidate check before full scoring.
//
// ALL V27 is still searched here, including filtered 2H.
//
// Security still requires CONFIDENT_MATCH.
// ============================================================

function findV27Counterpart(
  cloudbetMatch: PreparedMatch,
  allV27: PreparedMatch[],
  threshold: number
) {

  let best:
    PreparedMatch | null =
    null;

  let bestDetail:
    AnyObj | null =
    null;


  // ----------------------------------------------------------
  // PASS 1:
  // Direct two-sided normalized/alias candidate.
  // ----------------------------------------------------------

  for (
    const v27 of allV27
  ) {

    const direct =
      directTwoSidedMatch(
        v27,
        cloudbetMatch
      );

    if (!direct) continue;


    const detail =
      detailedMatchScore(
        v27.raw,
        cloudbetMatch.raw
      );


    if (
      !bestDetail ||
      detail.total >
      bestDetail.total
    ) {

      best =
        v27;

      bestDetail =
        detail;
    }
  }


  // ----------------------------------------------------------
  // PASS 2:
  // Two-sided team candidate.
  // ----------------------------------------------------------

  if (!bestDetail) {

    for (
      const v27 of allV27
    ) {

      if (
        !directTwoSidedTokenMatch(
          v27,
          cloudbetMatch
        )
      ) {
        continue;
      }


      const detail =
        detailedMatchScore(
          v27.raw,
          cloudbetMatch.raw
        );


      if (
        !bestDetail ||
        detail.total >
        bestDetail.total
      ) {

        best =
          v27;

        bestDetail =
          detail;
      }
    }
  }


  // ----------------------------------------------------------
  // PASS 3:
  // Full controlled scoring fallback.
  // ----------------------------------------------------------

  if (!bestDetail) {

    for (
      const v27 of allV27
    ) {

      const detail =
        detailedMatchScore(
          v27.raw,
          cloudbetMatch.raw
        );


      if (
        !bestDetail ||
        detail.total >
        bestDetail.total
      ) {

        best =
          v27;

        bestDetail =
          detail;
      }
    }
  }


  if (
    !best ||
    !bestDetail
  ) {

    return {

      found: false,

      best: null,

      detail: null,

      classification:
        "NO_V27_COUNTERPART"
    };
  }


  const classification =
    classifyMatch(
      bestDetail,
      threshold
    );


  if (
    classification.classification ===
    "CONFIDENT_MATCH"
  ) {

    return {

      found: true,

      best,

      detail:
        bestDetail,

      classification:
        "V27_COUNTERPART_FILTERED",

      reason:
        classification.reason
    };
  }


  return {

    found: false,

    best,

    detail:
      bestDetail,

    classification:
      "NO_V27_COUNTERPART",

    reason:
      "NO_CONFIDENT_V27_COUNTERPART"
  };
}


// ============================================================
// CLOUDBET-ONLY RECORD
// ============================================================

function buildCloudbetOnlyRecord(
  cb: PreparedMatch,
  counterpart: AnyObj
) {

  const v27 =
    counterpart.best;

  const detail =
    counterpart.detail;

  const raw =
    cb.raw;


  return {

    id:
      raw?.id ??
      null,

    key:
      raw?.key ??
      null,

    match:
      matchDisplayName(raw),

    home:
      extractHome(raw),

    away:
      extractAway(raw),

    normalized_home:
      cb.normalizedHome,

    normalized_away:
      cb.normalizedAway,

    category_home:
      cb.homeCategory,

    category_away:
      cb.awayCategory,

    competition:
      raw?.competition ??
      null,

    competition_normalized:
      competitionText(raw),

    country:
      countryText(raw),

    status:
      raw?.status ??
      null,

    minute:
      matchMinute(raw),

    score:
      raw?.score ??
      null,

    source:
      counterpart.classification,

    reason:
      counterpart.reason ??
      (
        counterpart.classification ===
        "V27_COUNTERPART_FILTERED"
          ? "V27_COUNTERPART_WAS_FILTERED_FROM_FIRST_HALF"
          : "NO_V27_COUNTERPART"
      ),

    v27_counterpart:
      v27
        ? {

            id:
              v27.raw?.id ??
              null,

            match:
              matchDisplayName(
                v27.raw
              ),

            home:
              extractHome(
                v27.raw
              ),

            away:
              extractAway(
                v27.raw
              ),

            normalized_home:
              v27.normalizedHome,

            normalized_away:
              v27.normalizedAway,

            category_home:
              v27.homeCategory,

            category_away:
              v27.awayCategory,

            minute:
              matchMinute(
                v27.raw
              ),

            score:
              v27.raw?.score ??
              null,

            filter_state:
              getV27FilterState(
                v27.raw
              )
          }

        : null,

    scoring:
      detail
        ? scoringRecord(
            detail
          )
        : null
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

  const threshold =
    getThreshold(
      request
    );


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


  const rawV27Matches =
    extractV27Matches(
      v27Data
    );

  const rawCloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );


  const cloudbetLive =
    rawCloudbetMatches.filter(
      isCloudbetLive
    );


  const allPreparedV27 =
    rawV27Matches.map(
      prepareMatch
    );


  const v27Matches =
    rawV27Matches.filter(
      isFirstHalf
    );


  const v27Filtered =
    rawV27Matches.filter(
      match =>
        getV27FilterState(
          match
        ) ===
        "FILTERED_SECOND_HALF"
    );


  const cloudbetMatches =
    cloudbetLive.filter(
      isFirstHalf
    );


  const preparedV27 =
    v27Matches.map(
      prepareMatch
    );

  const preparedCloudbet =
    cloudbetMatches.map(
      prepareMatch
    );


  const tokenIndex =
    buildTokenIndex(
      preparedCloudbet
    );


  const matches:
    AnyObj[] = [];

  const possibleMatches:
    AnyObj[] = [];

  const reversedCandidates:
    AnyObj[] = [];

  const falsePositiveRisks:
    AnyObj[] = [];

  const unmatched:
    AnyObj[] = [];


  const usedCloudbetIds =
    new Set<string>();


  let candidateEvaluations =
    0;


  // ==========================================================
  // NORMAL FIRST-HALF MATCHING
  // ==========================================================

  for (
    const v27 of preparedV27
  ) {

    const result =
      findBestMatch(
        v27,
        preparedCloudbet,
        tokenIndex,
        threshold,
        usedCloudbetIds,
        false
      );


    candidateEvaluations +=
      result.candidateEvaluations;


    if (
      result.matched &&
      result.best
    ) {

      const cb =
        result.best;


      if (cb.id) {
        usedCloudbetIds.add(
          cb.id
        );
      }


      matches.push({

        match:
          matchDisplayName(
            v27.raw
          ),

        v27: {

          id:
            v27.raw?.id ??
            null,

          home:
            extractHome(
              v27.raw
            ),

          away:
            extractAway(
              v27.raw
            ),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.homeCategory,

          category_away:
            v27.awayCategory,

          minute:
            matchMinute(
              v27.raw
            ),

          score:
            v27.raw?.score ??
            null
        },


        cloudbet: {

          id:
            cb.raw?.id ??
            null,

          key:
            cb.raw?.key ??
            null,

          match:
            matchDisplayName(
              cb.raw
            ),

          home:
            extractHome(
              cb.raw
            ),

          away:
            extractAway(
              cb.raw
            ),

          normalized_home:
            cb.normalizedHome,

          normalized_away:
            cb.normalizedAway,

          category_home:
            cb.homeCategory,

          category_away:
            cb.awayCategory,

          status:
            cb.raw?.status ??
            null,

          minute:
            matchMinute(
              cb.raw
            ),

          score:
            cb.raw?.score ??
            null,

          competition:
            cb.raw?.competition ??
            null
        },


        scoring:
          scoringRecord(
            result.detail
          ),

        classification:
          "CONFIDENT_MATCH",

        reason:
          result.reason
      });


      continue;
    }


    if (
      result.best &&
      result.detail
    ) {

      const item = {

        match:
          matchDisplayName(
            v27.raw
          ),

        v27: {

          id:
            v27.raw?.id ??
            null,

          home:
            extractHome(
              v27.raw
            ),

          away:
            extractAway(
              v27.raw
            ),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.homeCategory,

          category_away:
            v27.awayCategory
        },


        cloudbet: {

          id:
            result.best.raw?.id ??
            null,

          key:
            result.best.raw?.key ??
            null,

          match:
            matchDisplayName(
              result.best.raw
            ),

          home:
            extractHome(
              result.best.raw
            ),

          away:
            extractAway(
              result.best.raw
            ),

          normalized_home:
            result.best.normalizedHome,

          normalized_away:
            result.best.normalizedAway,

          category_home:
            result.best.homeCategory,

          category_away:
            result.best.awayCategory
        },


        scoring:
          scoringRecord(
            result.detail
          )
      };


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
    }


    unmatched.push({

      index:
        unmatched.length,

      match:
        matchDisplayName(
          v27.raw
        ),

      v27: {

        id:
          v27.raw?.id ??
          null,

        home:
          extractHome(
            v27.raw
          ),

        away:
          extractAway(
            v27.raw
          ),

        normalized_home:
          v27.normalizedHome,

        normalized_away:
          v27.normalizedAway,

        category_home:
          v27.homeCategory,

        category_away:
          v27.awayCategory,

        minute:
          matchMinute(
            v27.raw
          ),

        score:
          v27.raw?.score ??
          null
      },

      classification:
        result.classification,

      reason:
        result.reason
    });
  }


  // ==========================================================
  // CLOUDBET-ONLY AGAINST ALL V27
  // ==========================================================

  const cloudbetOnlyFirstHalf:
    AnyObj[] = [];


  for (
    const cb of preparedCloudbet
  ) {

    if (
      cb.id &&
      usedCloudbetIds.has(
        cb.id
      )
    ) {
      continue;
    }


    const counterpart =
      findV27Counterpart(
        cb,
        allPreparedV27,
        threshold
      );


    cloudbetOnlyFirstHalf.push(
      buildCloudbetOnlyRecord(
        cb,
        counterpart
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
      "V7-FH",

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

      first_half_filter:
        true,

      first_half_rule:
        "EXPLICIT FIRST HALF OR MINUTE <= 45; EXPLICIT SECOND HALF IS EXCLUDED",

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL",

      candidate_discovery:
        "DIRECT TWO-SIDED NORMALIZED/ALIAS PASS + TWO-SIDED TOKEN PASS + TOKEN INDEX + LIMITED FALLBACK",

      exact_id_security:
        "EXACT ID ALONE IS NEVER SUFFICIENT; CONFIDENT TWO-SIDED MATCH IS REQUIRED",

      cloudbet_only:
        "UNMATCHED CLOUDBET FIRST-HALF EVENTS CHECKED AGAINST ALL V27 EVENTS",

      filtered_counterpart:
        "V27_SECOND_HALF_COUNTERPARTS ARE EXPOSED AS V27_COUNTERPART_FILTERED",

      scoring:
        "UNCHANGED FROM V6-FH",

      optimization:
        "PRE-NORMALIZED TEAMS + DIRECT TWO-SIDED MATCH + TOKEN INDEX + LIMITED FUZZY FALLBACK"
    },


    stats: {

      v27_raw_matches:
        rawV27Matches.length,

      v27_matches:
        v27Matches.length,

      v27_first_half_filtered:
        rawV27Matches.length -
        v27Matches.length,

      v27_filtered_second_half:
        v27Filtered.length,

      cloudbet_raw_matches:
        rawCloudbetMatches.length,

      cloudbet_live_matches:
        cloudbetLive.length,

      cloudbet_first_half_matches:
        cloudbetMatches.length,

      cloudbet_second_half_filtered:
        cloudbetLive.length -
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

      cloudbet_only_first_half:
        cloudbetOnlyFirstHalf.length,

      cloudbet_only_with_v27_filtered_counterpart:
        cloudbetOnlyFirstHalf.filter(
          x =>
            x.source ===
            "V27_COUNTERPART_FILTERED"
        ).length,

      cloudbet_only_true_no_v27_counterpart:
        cloudbetOnlyFirstHalf.filter(
          x =>
            x.source ===
            "NO_V27_COUNTERPART"
        ).length,

      unique_cloudbet_used:
        usedCloudbetIds.size,

      prepared_v27:
        preparedV27.length,

      prepared_v27_all:
        allPreparedV27.length,

      prepared_cloudbet:
        preparedCloudbet.length,

      candidate_evaluations:
        candidateEvaluations,

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

    v27_filtered_second_half:
      v27Filtered
        .slice(
          0,
          100
        )
        .map(
          match => ({

            id:
              match?.id ??
              null,

            match:
              matchDisplayName(
                match
              ),

            home:
              extractHome(
                match
              ),

            away:
              extractAway(
                match
              ),

            normalized_home:
              normalizeTeam(
                extractHome(
                  match
                )
              ),

            normalized_away:
              normalizeTeam(
                extractAway(
                  match
                )
              ),

            minute:
              matchMinute(
                match
              ),

            score:
              match?.score ??
              null,

            filter_state:
              "FILTERED_SECOND_HALF"
          })
        ),


    cloudbet_only_first_half:
      cloudbetOnlyFirstHalf,


    timestamp:
      new Date().toISOString()
  });
}


// ============================================================
// THRESHOLD
// ============================================================

function getThreshold(
  request: Request
): number {

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
    !Number.isFinite(
      threshold
    )
  ) {
    threshold =
      DEFAULT_THRESHOLD;
  }


  return Math.max(
    0.30,
    Math.min(
      1,
      threshold
    )
  );
}


// ============================================================
// DIAGNOSTIC
// ============================================================

async function runDiagnostic(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();

  const threshold =
    getThreshold(
      request
    );


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


  const rawV27Matches =
    extractV27Matches(
      v27Data
    );

  const rawCloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    );


  const cloudbetLive =
    rawCloudbetMatches.filter(
      isCloudbetLive
    );


  const allPreparedV27 =
    rawV27Matches.map(
      prepareMatch
    );


  const v27Matches =
    rawV27Matches.filter(
      isFirstHalf
    );


  const v27Filtered =
    rawV27Matches.filter(
      m =>
        getV27FilterState(
          m
        ) ===
        "FILTERED_SECOND_HALF"
    );


  const cloudbetMatches =
    cloudbetLive.filter(
      isFirstHalf
    );


  const preparedV27 =
    v27Matches.map(
      prepareMatch
    );

  const preparedCloudbet =
    cloudbetMatches.map(
      prepareMatch
    );


  const tokenIndex =
    buildTokenIndex(
      preparedCloudbet
    );


  const usedCloudbetIds =
    new Set<string>();


  let candidateEvaluations =
    0;


  const matched:
    AnyObj[] = [];

  const unmatched:
    PreparedMatch[] = [];


  for (
    const v27 of preparedV27
  ) {

    const result =
      findBestMatch(
        v27,
        preparedCloudbet,
        tokenIndex,
        threshold,
        usedCloudbetIds,
        false
      );


    candidateEvaluations +=
      result.candidateEvaluations;


    if (
      result.matched &&
      result.best
    ) {

      if (
        result.best.id
      ) {

        usedCloudbetIds.add(
          result.best.id
        );
      }


      matched.push({

        v27:
          matchDisplayName(
            v27.raw
          ),

        cloudbet:
          matchDisplayName(
            result.best.raw
          ),

        score:
          Number(
            result.score.toFixed(
              3
            )
          )
      });

    }
    else {

      unmatched.push(
        v27
      );
    }
  }


  // ==========================================================
  // CLOUD BET ONLY DIAGNOSTIC
  // ==========================================================

  const cloudbetOnly:
    AnyObj[] = [];


  for (
    const cb of preparedCloudbet
  ) {

    if (
      cb.id &&
      usedCloudbetIds.has(
        cb.id
      )
    ) {
      continue;
    }


    const counterpart =
      findV27Counterpart(
        cb,
        allPreparedV27,
        threshold
      );


    cloudbetOnly.push(
      buildCloudbetOnlyRecord(
        cb,
        counterpart
      )
    );
  }


  return json({

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      "V7-FH",

    mode:
      "READ ONLY",

    diagnostic:
      "V7 ALL-V27 COUNTERPART CHECK + DIRECT TWO-SIDED LINK FIX",


    settings: {

      match_threshold:
        threshold,

      first_half_filter:
        true,

      first_half_rule:
        "EXPLICIT FIRST HALF OR MINUTE <= 45; EXPLICIT SECOND HALF IS EXCLUDED",

      direct_two_sided_link:
        "NORMALIZED HOME + NORMALIZED AWAY ARE CHECKED BEFORE TOKEN/FUZZY FALLBACK",

      cloudbet_only_rule:
        "UNMATCHED CLOUDBET FIRST-HALF EVENTS ARE CHECKED AGAINST ALL V27 EVENTS",

      filtered_counterpart:
        "SECOND-HALF V27 COUNTERPARTS ARE EXPOSED SEPARATELY",

      exact_id_security:
        "EXACT ID ALONE IS NEVER SUFFICIENT",

      scoring:
        "UNCHANGED FROM V6-FH"
    },


    stats: {

      v27_raw_matches:
        rawV27Matches.length,

      v27_first_half_matches:
        v27Matches.length,

      v27_filtered_second_half:
        v27Filtered.length,

      cloudbet_raw_matches:
        rawCloudbetMatches.length,

      cloudbet_live_matches:
        cloudbetLive.length,

      cloudbet_first_half_matches:
        cloudbetMatches.length,

      normal_matched:
        matched.length,

      normal_unmatched:
        unmatched.length,

      cloudbet_only:
        cloudbetOnly.length,

      cloudbet_only_v27_filtered_counterpart:
        cloudbetOnly.filter(
          x =>
            x.source ===
            "V27_COUNTERPART_FILTERED"
        ).length,

      cloudbet_only_no_v27_counterpart:
        cloudbetOnly.filter(
          x =>
            x.source ===
            "NO_V27_COUNTERPART"
        ).length,

      candidate_evaluations:
        candidateEvaluations,

      processing_ms:
        Date.now() -
        started
    },


    matched,


    unmatched:
      unmatched
        .slice(
          0,
          100
        )
        .map(
          x => ({

            id:
              x.raw?.id ??
              null,

            match:
              matchDisplayName(
                x.raw
              ),

            home:
              extractHome(
                x.raw
              ),

            away:
              extractAway(
                x.raw
              ),

            normalized_home:
              x.normalizedHome,

            normalized_away:
              x.normalizedAway,

            minute:
              matchMinute(
                x.raw
              )
          })
        ),


    v27_filtered_second_half:
      v27Filtered
        .slice(
          0,
          100
        )
        .map(
          x => ({

            id:
              x?.id ??
              null,

            match:
              matchDisplayName(
                x
              ),

            home:
              extractHome(
                x
              ),

            away:
              extractAway(
                x
              ),

            minute:
              matchMinute(
                x
              ),

            score:
              x?.score ??
              null,

            filter_state:
              "FILTERED_SECOND_HALF"
          })
        ),


    cloudbet_only_first_half:
      cloudbetOnly,


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
      "V7-FH",

    mode:
      "READ ONLY",

    bindings: {

      V27:
        true,

      CLOUDBET:
        true
    },


    matcher:
      "V7 FIRST-HALF FILTER + DIRECT TWO-SIDED LINK + ALL-V27 COUNTERPART CHECK",


    rules: {

      first_half:
        "EXPLICIT FIRST HALF OR MINUTE <= 45",

      second_half:
        "EXPLICIT SECOND HALF IS EXCLUDED FROM NORMAL MATCHING",

      direct_link:
        "NORMALIZED HOME + NORMALIZED AWAY ARE CHECKED FIRST",

      token_link:
        "BOTH TEAMS MUST HAVE REASONABLE SIMILARITY",

      cloudbet_only:
        "UNMATCHED CLOUDBET FIRST-HALF EVENTS ARE CHECKED AGAINST ALL V27 EVENTS",

      filtered_counterpart:
        "V27 SECOND-HALF COUNTERPART IS REPORTED AS V27_COUNTERPART_FILTERED",

      no_counterpart:
        "ONLY USED WHEN NO CONFIDENT V27 COUNTERPART EXISTS",

      exact_id:
        "EXACT ID ALONE IS NEVER SECURITY",

      confident:
        "Both teams >= 0.78 and total >= 0.80",

      possible:
        "Both teams >= 0.60 and total >= 0.72",

      false_positive:
        "One team strong while the other is weak",

      reversed:
        "Home/Away reversed candidates are separately classified",

      category_protection:
        "U19/U21/U23/reserve/women categories are protected",

      scoring:
        "UNCHANGED FROM V6-FH"
    },


    message:
      "V7-FH uses direct two-sided normalized/alias linking before controlled fuzzy matching while preserving secure two-sided classification.",


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
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";


    try {

      if (
        path === "/" ||
        path === "/health"
      ) {

        return health();
      }


      if (
        path === "/match" ||
        path === "/live"
      ) {

        return runMatcher(
          env,
          request
        );
      }


      if (
        path === "/diagnostic" ||
        path === "/diagnostics"
      ) {

        return runDiagnostic(
          env,
          request
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

    }
    catch (
      error: any
    ) {

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-match-matcher",

          version:
            "V7-FH",

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
