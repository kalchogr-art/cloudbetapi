// ============================================================
// CLOUDBET MATCH MATCHER V6-FH
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V6-FH:
// 1. FIRST-HALF INPUT FILTER
// 2. V27 FIRST-HALF FILTER
// 3. CLOUDBET FIRST-HALF FILTER
// 4. PRE-NORMALIZED TEAMS
// 5. TOKEN INDEX
// 6. SAFE EXACT / ALIAS LOOKUP
// 7. LIMITED FUZZY FALLBACK
// 8. STRICT TWO-SIDED MATCH
// 9. CATEGORY PROTECTION
// 10. HOME/AWAY DIRECTION CHECK
// 11. COMPETITION / COUNTRY SIGNAL
// 12. CLOUDBET-ONLY FIRST-HALF OUTPUT
// 13. COMPETITION NORMALIZATION
// 14. READ ONLY
//
// IMPORTANT:
// MATCH SCORING IS NOT CHANGED.
//
// V6 adds a separate Cloudbet-first-half feed for matches
// that have no V27 counterpart.
//
// They are NOT marked as matched.
// They are exposed separately for the next worker.
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


// ============================================================
// GENERIC CLUB WORDS
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

  const tokens = s.split(" ").filter(Boolean);
  const categories: string[] = [];

  for (const token of tokens) {

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


function categoryCompatible(
  a: any,
  b: any
): boolean {

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

    const canonical = TEAM_ALIASES[alias];

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


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function normalizeTeam(value: any): string {

  let s = normalizeText(value);

  if (!s) return "";

  s = applyTeamAliases(s);

  let words = s
    .split(" ")
    .filter(Boolean)
    .filter(w => !GENERIC_WORDS.has(w));

  words = words.filter(
    w => !/^\d+$/.test(w)
  );

  return words.join(" ").trim();
}


// ============================================================
// TOKENS
// ============================================================

function teamTokens(value: any): Set<string> {

  return new Set(
    normalizeTeam(value)
      .split(" ")
      .filter(Boolean)
      .filter(w => w.length >= 2)
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

  let prev = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {

    const curr = new Array<number>(b.length + 1);
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {

      const cost =
        a[i - 1] === b[j - 1]
          ? 0
          : 1;

      curr[j] = Math.min(
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

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);

  if (!maxLength) return 0;

  return 1 - distance / maxLength;
}


// ============================================================
// WEAK TOKENS
// ============================================================

const WEAK_TEAM_TOKENS = new Set([
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

  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) return 0;

  if (!categoryCompatible(a, b)) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  const aTokens = [...teamTokens(A)];
  const bTokens = [...teamTokens(B)];

  if (!aTokens.length || !bTokens.length) {
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
      token => longer.includes(token)
    );

  if (
    shorterAllExact &&
    shorter.length >= 2
  ) {

    const extraTokens =
      longer.filter(
        token => !shorter.includes(token)
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

  for (const aToken of aTokens) {

    let best = 0;

    for (const bToken of bTokens) {

      if (aToken === bToken) {
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
    } else if (best >= 0.75) {
      fuzzy += best * 0.65;
    }
  }

  for (const token of aTokens) {

    if (bTokens.includes(token)) {
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
    Math.max(1, aTokens.length);

  const recall =
    fuzzy /
    Math.max(1, bTokens.length);

  const overlap =
    exact /
    Math.max(1, minTokens);

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
      score = Math.max(score, sim);
    }
  }

  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {
    score *= 0.50;
  }

  if (
    minTokens === 1 &&
    WEAK_TEAM_TOKENS.has(aTokens[0])
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
    score = Math.min(score, 0.58);
  }

  return Math.min(1, score);
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

  for (const separator of separators) {

    const index =
      text.indexOf(separator);

    if (index >= 0) {

      return {
        home:
          text.slice(0, index).trim(),

        away:
          text.slice(
            index + separator.length
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

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).home;
}


function extractAway(
  match: AnyObj
): string | null {

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

  return splitMatchName(
    match?.match ??
    match?.name ??
    ""
  ).away;
}


// ============================================================
// MINUTE
// ============================================================

function parseMinute(value: any): number | null {

  if (typeof value === "number") {

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

    const base = Number(plus[1]);

    if (
      Number.isFinite(base) &&
      base >= 0 &&
      base <= 130
    ) {
      return base;
    }
  }

  const match =
    text.match(/(\d{1,3})/);

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


// ============================================================
// PERIOD
// ============================================================

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

  for (const value of fields) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {

      return normalizeText(value);
    }

    if (
      typeof value === "object" &&
      value
    ) {

      const nested =
        value?.name ??
        value?.label ??
        value?.period ??
        value?.short;

      if (
        typeof nested === "string" &&
        nested.trim()
      ) {
        return normalizeText(nested);
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
    pattern => pattern.test(text)
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
    pattern => pattern.test(text)
  );
}


// ============================================================
// MATCH MINUTE
// ============================================================

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

  for (const value of fields) {

    const minute =
      parseMinute(value);

    if (minute !== null) {
      return minute;
    }
  }

  return null;
}


// ============================================================
// FIRST HALF
// ============================================================

function isFirstHalf(
  match: AnyObj
): boolean {

  if (!match) return false;

  if (hasExplicitSecondHalf(match)) {
    return false;
  }

  if (hasExplicitFirstHalf(match)) {
    return true;
  }

  const minute =
    matchMinute(match);

  if (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
  ) {
    return true;
  }

  return true;
}


// ============================================================
// COMPETITION
// ============================================================

function competitionText(
  match: AnyObj
): string {

  const competition =
    match?.competition;

  if (
    typeof competition === "string"
  ) {
    return normalizeText(competition);
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
    return normalizeText(league);
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
// COMPETITION NORMALIZATION
//
// Examples:
//
// Liga MX - Apertura
// Liga MX, Apertura
// Liga MX Apertura
//
// -> liga mx apertura
// ============================================================

function normalizeCompetition(
  value: any
): string {

  let s =
    normalizeText(value);

  if (!s) return "";

  s = s
    .replace(/\bapertura\b/g, "apertura")
    .replace(/\bclausura\b/g, "clausura")
    .replace(/\bprimera a\b/g, "primera a")
    .replace(/\bprimera b\b/g, "primera b")
    .replace(/\bnext pro\b/g, "next pro")
    .replace(/\bnextpro\b/g, "next pro");

  return s
    .replace(/\s+/g, " ")
    .trim();
}


// ============================================================
// COUNTRY
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

  for (const value of fields) {

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return normalizeText(value);
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
    normalizeCompetition(
      competitionText(a)
    );

  const B =
    normalizeCompetition(
      competitionText(b)
    );

  if (!A || !B) return 0;

  if (A === B) return 1;

  const aWords =
    new Set(
      A.split(" ").filter(Boolean)
    );

  const bWords =
    new Set(
      B.split(" ").filter(Boolean)
    );

  let overlap = 0;

  for (const word of aWords) {

    if (bWords.has(word)) {
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

  if (!A || !B) return 0;

  return A === B ? 1 : 0;
}


// ============================================================
// DETAILED SCORE
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
    (reverseHomeScore + reverseAwayScore) / 2;

  let direction = "NORMAL";
  let baseScore = normal;

  if (
    reversed > normal &&
    reverseHomeScore >= REVERSED_CONFIDENT_SCORE &&
    reverseAwayScore >= REVERSED_CONFIDENT_SCORE
  ) {

    direction = "REVERSED";
    baseScore = reversed;
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

  if (competitionScore >= 0.80) {
    total += COMPETITION_BONUS;
  }

  if (countryScore === 1) {
    total += COUNTRY_BONUS;
  }

  return {

    total:
      Math.min(1, total),

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
// PREPARED MATCH
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

    id:
      String(
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
    new Map<string, number[]>();

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

    for (const token of tokens) {

      const list =
        index.get(token);

      if (list) {
        list.push(i);
      } else {
        index.set(token, [i]);
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

  const vTokens =
    new Set([
      ...v27.homeTokens,
      ...v27.awayTokens
    ]);

  for (const token of vTokens) {

    const indexes =
      tokenIndex.get(token);

    if (!indexes) continue;

    for (const index of indexes) {
      candidateSet.add(index);
    }
  }

  if (!candidateSet.size) {

    const limit =
      Math.min(
        cloudbet.length,
        12
      );

    for (
      let i = 0;
      i < limit;
      i++
    ) {
      candidateSet.add(i);
    }
  }

  return [...candidateSet];
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
    PreparedMatch | null = null;

  let bestDetail:
    AnyObj | null = null;

  let bestScore = 0;

  let candidateEvaluations = 0;

  const candidates =
    getCandidates(
      v27,
      cloudbet,
      tokenIndex
    );

  for (const index of candidates) {

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
// EXTRACT V27
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
// EXTRACT CLOUDBET
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
// CLOUDBET ONLY RECORD
// ============================================================

function buildCloudbetOnlyRecord(
  cb: PreparedMatch
) {

  return {

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
      extractHome(cb.raw),

    away:
      extractAway(cb.raw),

    normalized_home:
      cb.normalizedHome,

    normalized_away:
      cb.normalizedAway,

    category_home:
      cb.homeCategory,

    category_away:
      cb.awayCategory,

    competition:
      cb.raw?.competition ??
      cb.raw?.league ??
      null,

    competition_normalized:
      normalizeCompetition(
        competitionText(cb.raw)
      ),

    country:
      countryText(cb.raw),

    status:
      cb.raw?.status ??
      null,

    minute:
      matchMinute(cb.raw),

    score:
      cb.raw?.score ??
      null,

    source:
      "CLOUDBET_FIRST_HALF_ONLY",

    reason:
      "NO_V27_COUNTERPART"

  };
}


// ============================================================
// MATCH RECORD
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
// THRESHOLD
// ============================================================

function getThreshold(
  request: Request
): number {

  const url =
    new URL(request.url);

  let threshold =
    Number(
      url.searchParams.get("threshold") ??
      String(DEFAULT_THRESHOLD)
    );

  if (!Number.isFinite(threshold)) {
    threshold =
      DEFAULT_THRESHOLD;
  }

  return Math.max(
    0.30,
    Math.min(1, threshold)
  );
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

  const threshold =
    getThreshold(request);

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

  // ==========================================================
  // FIRST HALF
  // ==========================================================

  const v27Matches =
    rawV27Matches.filter(
      isFirstHalf
    );

  const cloudbetMatches =
    cloudbetLive.filter(
      isFirstHalf
    );

  // ==========================================================
  // PREPARE
  // ==========================================================

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

  // ==========================================================
  // RESULTS
  // ==========================================================

  const matches: AnyObj[] = [];
  const possibleMatches: AnyObj[] = [];
  const reversedCandidates: AnyObj[] = [];
  const falsePositiveRisks: AnyObj[] = [];
  const unmatched: AnyObj[] = [];

  const usedCloudbetIds =
    new Set<string>();

  let candidateEvaluations = 0;

  // ==========================================================
  // V27 -> CLOUDBET MATCHING
  // ==========================================================

  for (
    const v27 of
    preparedV27
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

        ...buildMatchRecord(
          v27.raw,
          cb.raw,
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

      const item =
        buildMatchRecord(
          v27.raw,
          result.best.raw,
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
    }

    unmatched.push({

      v27:
        matchDisplayName(
          v27.raw
        ),

      v27_id:
        v27.id,

      classification:
        result.classification,

      reason:
        result.reason

    });
  }

  // ==========================================================
  // CLOUDBET-ONLY FIRST HALF
  //
  // IMPORTANT:
  // These are NOT matches.
  // They are simply Cloudbet live first-half events
  // which were not consumed by a confident V27 match.
  // ==========================================================

  const cloudbetOnlyFirstHalf =
    preparedCloudbet
      .filter(cb => {

        if (!cb.id) return true;

        return !usedCloudbetIds.has(
          cb.id
        );

      })
      .map(
        buildCloudbetOnlyRecord
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
      "V6-FH",

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

      cloudbet_only:
        "UNMATCHED CLOUDBET FIRST-HALF EVENTS EXPOSED SEPARATELY",

      optimization:
        "FIRST-HALF INPUT FILTER + PRE-NORMALIZED TEAMS + TOKEN INDEX + SAFE EXACT/ALIAS LOOKUP + LIMITED FUZZY FALLBACK"

    },

    stats: {

      v27_raw_matches:
        rawV27Matches.length,

      v27_matches:
        v27Matches.length,

      v27_first_half_filtered:
        rawV27Matches.length -
        v27Matches.length,

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

      unique_cloudbet_used:
        usedCloudbetIds.size,

      prepared_v27:
        preparedV27.length,

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
      unmatched.slice(0, 100),

    // ========================================================
    // THIS IS THE NEW OUTPUT FOR THE NEXT WORKER
    // ========================================================

    cloudbet_only_first_half:
      cloudbetOnlyFirstHalf,

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
      "V6-FH",

    mode:
      "READ ONLY",

    bindings: {

      V27:
        true,

      CLOUDBET:
        true

    },

    matcher:
      "V6 FIRST-HALF FILTER + STRICT TWO-SIDED MATCH + CLOUDBET-ONLY OUTPUT",

    rules: {

      first_half:
        "EXPLICIT FIRST HALF OR MINUTE <= 45",

      second_half:
        "EXPLICIT SECOND HALF IS EXCLUDED",

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

      aliases:
        "Aliases are applied inside larger team names",

      common_tokens:
        "Generic/common club tokens cannot create a strong match alone",

      cloudbet_only:
        "Cloudbet first-half events without a V27 counterpart are exposed separately"

    },

    message:
      "V6-FH keeps V5 scoring unchanged and adds a separate Cloudbet-only first-half feed.",

    timestamp:
      new Date().toISOString()

  });
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
    getThreshold(request);

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

  const v27Matches =
    rawV27Matches.filter(
      isFirstHalf
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

  const normalMatched:
    PreparedMatch[] = [];

  const normalUnmatched:
    PreparedMatch[] = [];

  let candidateEvaluations = 0;

  for (
    const v27 of
    preparedV27
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

      if (result.best.id) {
        usedCloudbetIds.add(
          result.best.id
        );
      }

      normalMatched.push(v27);

    } else {

      normalUnmatched.push(v27);
    }
  }

  const cloudbetOnly =
    preparedCloudbet
      .filter(cb => {

        if (!cb.id) return true;

        return !usedCloudbetIds.has(
          cb.id
        );

      })
      .map(
        buildCloudbetOnlyRecord
      );

  const diagnostics: AnyObj[] = [];

  let potentialMatches = 0;
  let closeBelowThreshold = 0;
  let reversedCandidates = 0;
  let falsePositiveRisk = 0;
  let trueUnmatched = 0;

  for (
    let i = 0;
    i < normalUnmatched.length;
    i++
  ) {

    const v27 =
      normalUnmatched[i];

    const result =
      findBestMatch(
        v27,
        preparedCloudbet,
        tokenIndex,
        threshold,
        undefined,
        true
      );

    candidateEvaluations +=
      result.candidateEvaluations;

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

        index: i,

        v27: {

          id:
            v27.raw?.id ??
            null,

          match:
            matchDisplayName(
              v27.raw
            ),

          home:
            extractHome(v27.raw),

          away:
            extractAway(v27.raw),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.homeCategory,

          category_away:
            v27.awayCategory,

          minute:
            matchMinute(v27.raw),

          score:
            v27.raw?.score ??
            null

        },

        best_cloudbet: {

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
            result.best.awayCategory,

          status:
            result.best.raw?.status ??
            null,

          minute:
            matchMinute(
              result.best.raw
            ),

          competition:
            result.best.raw?.competition ??
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

        index: i,

        v27: {

          id:
            v27.raw?.id ??
            null,

          match:
            matchDisplayName(
              v27.raw
            ),

          home:
            extractHome(v27.raw),

          away:
            extractAway(v27.raw),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.homeCategory,

          category_away:
            v27.awayCategory,

          minute:
            matchMinute(v27.raw),

          score:
            v27.raw?.score ??
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

  diagnostics.sort(
    (a, b) =>
      Number(
        b?.scoring?.total ?? 0
      ) -
      Number(
        a?.scoring?.total ?? 0
      )
  );

  return json({

    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      "V6-FH",

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

      first_half_filter:
        true,

      first_half_rule:
        "EXPLICIT FIRST HALF OR MINUTE <= 45; EXPLICIT SECOND HALF IS EXCLUDED",

      cloudbet_only:
        "Cloudbet first-half events not consumed by confident V27 matching are returned separately"

    },

    stats: {

      v27_raw_matches:
        rawV27Matches.length,

      v27_matches:
        v27Matches.length,

      v27_first_half_filtered:
        rawV27Matches.length -
        v27Matches.length,

      cloudbet_raw_matches:
        rawCloudbetMatches.length,

      cloudbet_live_matches:
        cloudbetLive.length,

      cloudbet_first_half_matches:
        cloudbetMatches.length,

      cloudbet_second_half_filtered:
        cloudbetLive.length -
        cloudbetMatches.length,

      normal_matched:
        normalMatched.length,

      unmatched:
        normalUnmatched.length,

      cloudbet_only_first_half:
        cloudbetOnly.length,

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

      prepared_v27:
        preparedV27.length,

      prepared_cloudbet:
        preparedCloudbet.length,

      candidate_evaluations:
        candidateEvaluations,

      processing_ms:
        Date.now() -
        started

    },

    diagnostics:
      diagnostics.slice(0, 100),

    cloudbet_only_first_half:
      cloudbetOnly,

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

    } catch (error: any) {

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-match-matcher",

          version:
            "V6-FH",

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
