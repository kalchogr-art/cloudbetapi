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
// V5:
// 1. STRICT TWO-SIDED TEAM MATCH
// 2. STRONG TEAM ALIAS MATCHING
// 3. U19/U21/U23/RESERVE/WOMEN PROTECTION
// 4. HOME/AWAY DIRECTION PROTECTION
// 5. REVERSED MATCH DIAGNOSTIC
// 6. COMPETITION / COUNTRY SIGNAL
// 7. CONFIDENT / POSSIBLE / FALSE POSITIVE / UNMATCHED
// 8. PRE-NORMALIZED TEAM DATA
// 9. FAST CANDIDATE FILTER
// 10. DETAILED UNMATCHED REASONS
// 11. UNIQUE CLOUDBET MATCH USAGE
// 12. DIAGNOSTIC MODE
// 13. READ ONLY
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

// Fast candidate filter.
// We only calculate the expensive detailed score when
// at least one meaningful team token overlaps.
const MIN_CANDIDATE_TOKEN_SCORE = 0.55;

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
// GENERIC WORDS
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
// CATEGORY NORMALIZATION
// ============================================================

function normalizeCategory(value: any): string {

  let s = normalizeText(value);

  if (!s) {
    return "";
  }

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

// ============================================================
// APPLY ALIASES
// ============================================================

function applyTeamAliases(value: string): string {

  let s = normalizeText(value);

  if (!s) {
    return "";
  }

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

  if (!s) {
    return "";
  }

  s = applyTeamAliases(s);

  const words = s
    .split(" ")
    .filter(Boolean)
    .filter(w => !GENERIC_WORDS.has(w))
    .filter(w => !/^\d+$/.test(w));

  return words.join(" ").trim();
}

// ============================================================
// TEAM CATEGORY
// ============================================================

function teamCategory(value: any): string {
  return normalizeCategory(value);
}

// ============================================================
// CATEGORY COMPATIBILITY
// ============================================================

function categoryCompatible(
  a: any,
  b: any
): boolean {

  const A = teamCategory(a);
  const B = teamCategory(b);

  if (!A && !B) {
    return true;
  }

  if (!A || !B) {
    return true;
  }

  return A === B;
}

// ============================================================
// TOKEN SET
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

  let prev = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= a.length; i++) {

    const curr = new Array<number>(
      b.length + 1
    );

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

  const distance = levenshtein(a, b);

  const maxLength = Math.max(
    a.length,
    b.length
  );

  if (!maxLength) {
    return 0;
  }

  return 1 - distance / maxLength;
}

// ============================================================
// PRE-NORMALIZED TEAM OBJECT
// ============================================================

interface PreparedTeam {
  raw: string;
  normalized: string;
  category: string;
  tokens: string[];
  tokenSet: Set<string>;
}

function prepareTeam(value: any): PreparedTeam {

  const raw = String(value ?? "");
  const normalized = normalizeTeam(raw);

  const tokens = normalized
    .split(" ")
    .filter(Boolean)
    .filter(w => w.length >= 2);

  return {
    raw,
    normalized,
    category: teamCategory(raw),
    tokens,
    tokenSet: new Set(tokens)
  };
}

// ============================================================
// TEAM SCORE PREPARED
// ============================================================

function teamScorePrepared(
  A: PreparedTeam,
  B: PreparedTeam
): number {

  if (!A.normalized || !B.normalized) {
    return 0;
  }

  if (A.category && B.category &&
      A.category !== B.category) {
    return 0;
  }

  if (A.normalized === B.normalized) {
    return 1;
  }

  const aTokens = A.tokens;
  const bTokens = B.tokens;

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

  const shorterAllExact = shorter.every(
    token => longer.includes(token)
  );

  if (
    shorterAllExact &&
    shorter.length >= 2
  ) {

    const extraTokens = longer.filter(
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

      const sim = tokenSimilarity(
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

    if (B.tokenSet.has(token)) {
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

  if (
    aTokens.length === 1 &&
    bTokens.length === 1
  ) {

    const sim = tokenSimilarity(
      aTokens[0],
      bTokens[0]
    );

    if (sim >= 0.90) {
      score = Math.max(
        score,
        sim
      );
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
    WEAK_TEAM_TOKENS.has(
      aTokens[0]
    )
  ) {
    score *= 0.35;
  }

  const exactMeaningful =
    aTokens.filter(
      token =>
        B.tokenSet.has(token) &&
        !WEAK_TEAM_TOKENS.has(token)
    ).length;

  if (
    exactMeaningful === 0 &&
    overlap > 0
  ) {
    score = Math.min(
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

  const text = String(
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

  for (const separator of separators) {

    const index =
      text.indexOf(separator);

    if (index >= 0) {

      return {
        home: text
          .slice(0, index)
          .trim(),

        away: text
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
// COMPETITION
// ============================================================

function competitionText(
  match: AnyObj
): string {

  const competition =
    match?.competition;

  if (typeof competition === "string") {
    return normalizeText(competition);
  }

  if (typeof competition?.name === "string") {
    return normalizeText(
      competition.name
    );
  }

  if (typeof competition?.key === "string") {
    return normalizeText(
      competition.key
    );
  }

  const league = match?.league;

  if (typeof league === "string") {
    return normalizeText(league);
  }

  if (typeof league?.name === "string") {
    return normalizeText(
      league.name
    );
  }

  return "";
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

  const A = competitionText(a);
  const B = competitionText(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  const aWords = new Set(
    A.split(" ").filter(Boolean)
  );

  const bWords = new Set(
    B.split(" ").filter(Boolean)
  );

  let overlap = 0;

  for (const word of aWords) {

    if (bWords.has(word)) {
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

// ============================================================
// COUNTRY SIMILARITY
// ============================================================

function countrySimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A = countryText(a);
  const B = countryText(b);

  if (!A || !B) {
    return 0;
  }

  return A === B ? 1 : 0;
}

// ============================================================
// FAST CANDIDATE CHECK
// ============================================================

function candidateTokenScore(
  A: PreparedTeam,
  B: PreparedTeam
): number {

  if (
    !A.tokens.length ||
    !B.tokens.length
  ) {
    return 0;
  }

  let best = 0;

  for (const a of A.tokens) {

    for (const b of B.tokens) {

      if (a === b) {
        if (!WEAK_TEAM_TOKENS.has(a)) {
          return 1;
        }

        best = Math.max(best, 0.55);
        continue;
      }

      const sim =
        tokenSimilarity(a, b);

      if (
        sim >= 0.90 &&
        !WEAK_TEAM_TOKENS.has(a)
      ) {
        best = Math.max(
          best,
          sim
        );
      }
    }
  }

  return best;
}

// ============================================================
// DETAILED MATCH SCORE
// ============================================================

function detailedMatchScore(
  v27: AnyObj,
  cb: AnyObj
) {

  const vHomeRaw = extractHome(v27);
  const vAwayRaw = extractAway(v27);

  const cHomeRaw = extractHome(cb);
  const cAwayRaw = extractAway(cb);

  if (
    !vHomeRaw ||
    !vAwayRaw ||
    !cHomeRaw ||
    !cAwayRaw
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
      countryScore: 0,
      reason: "MISSING_TEAM_NAME"
    };
  }

  const vHome = prepareTeam(vHomeRaw);
  const vAway = prepareTeam(vAwayRaw);
  const cHome = prepareTeam(cHomeRaw);
  const cAway = prepareTeam(cAwayRaw);

  const homeScore =
    teamScorePrepared(
      vHome,
      cHome
    );

  const awayScore =
    teamScorePrepared(
      vAway,
      cAway
    );

  const reverseHomeScore =
    teamScorePrepared(
      vHome,
      cAway
    );

  const reverseAwayScore =
    teamScorePrepared(
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
    reverseHomeScore >= 0.80 &&
    reverseAwayScore >= 0.80
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

  let total = baseScore;

  if (competitionScore >= 0.80) {
    total += COMPETITION_BONUS;
  }

  if (countryScore === 1) {
    total += COUNTRY_BONUS;
  }

  return {

    total: Math.min(
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
    countryScore,

    reason:
      homeScore < WEAK_SIDE_LIMIT &&
      awayScore < WEAK_SIDE_LIMIT
        ? "BOTH_TEAMS_WEAK"
        : homeScore < WEAK_SIDE_LIMIT
          ? "HOME_WEAK"
          : awayScore < WEAK_SIDE_LIMIT
            ? "AWAY_WEAK"
            : "BELOW_STRONG_THRESHOLD"
  };
}

// ============================================================
// CLASSIFY
// ============================================================

function classifyMatch(
  detail: AnyObj,
  threshold: number
) {

  const home = detail.homeScore;
  const away = detail.awayScore;
  const total = detail.total;

  if (
    detail.direction ===
    "REVERSED"
  ) {

    if (
      home >= REVERSED_CONFIDENT_SCORE &&
      away >= REVERSED_CONFIDENT_SCORE
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
    total >= Math.max(
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
    total >= Math.max(
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
      detail.reason ??
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

  let best: AnyObj | null = null;
  let bestDetail: AnyObj | null = null;
  let bestScore = 0;

  const vHome = prepareTeam(
    extractHome(v27)
  );

  const vAway = prepareTeam(
    extractAway(v27)
  );

  for (const cb of cloudbetMatches) {

    const cbId = String(
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

    const cHome = prepareTeam(
      extractHome(cb)
    );

    const cAway = prepareTeam(
      extractAway(cb)
    );

    // --------------------------------------------------------
    // Category protection before expensive scoring
    // --------------------------------------------------------

    if (
      vHome.category &&
      cHome.category &&
      vHome.category !== cHome.category
    ) {
      continue;
    }

    if (
      vAway.category &&
      cAway.category &&
      vAway.category !== cAway.category
    ) {
      continue;
    }

    // --------------------------------------------------------
    // FAST NORMAL DIRECTION CANDIDATE
    // --------------------------------------------------------

    const normalCandidate = Math.max(
      candidateTokenScore(
        vHome,
        cHome
      ),
      candidateTokenScore(
        vAway,
        cAway
      )
    );

    // --------------------------------------------------------
    // FAST REVERSED CANDIDATE
    // --------------------------------------------------------

    const reverseCandidate = Math.max(
      candidateTokenScore(
        vHome,
        cAway
      ),
      candidateTokenScore(
        vAway,
        cHome
      )
    );

    if (
      normalCandidate <
        MIN_CANDIDATE_TOKEN_SCORE &&
      reverseCandidate <
        MIN_CANDIDATE_TOKEN_SCORE
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
      classification.reason
  };
}

// ============================================================
// EXTRACT MATCHES
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
// DISPLAY NAME
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
// FETCH SERVICE
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
        v27?.id ?? null,

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
        cb?.id ?? null,

      key:
        cb?.key ?? null,

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
        cb?.status ?? null,

      minute:
        cb?.minute ??
        cb?.minute_display ??
        null,

      score:
        cb?.score ?? null,

      competition:
        cb?.competition ?? null
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
// UNMATCHED RECORD
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
        v27?.id ?? null,

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
        v27?.score ?? null
    },

    best_cloudbet:
      result.best
        ? {

            id:
              result.best?.id ?? null,

            key:
              result.best?.key ?? null,

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

            reason:
              result.detail.reason

          }
        : null,

    threshold,

    gap_to_threshold:
      Number(
        Math.max(
          0,
          threshold -
          Number(
            result.detail?.total ?? 0
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
    new URL(request.url);

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      String(DEFAULT_THRESHOLD)
    );

  if (!Number.isFinite(threshold)) {
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

  const cloudbetRaw =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    cloudbetRaw.filter(
      isCloudbetLive
    );

  const matches: AnyObj[] = [];
  const possibleMatches: AnyObj[] = [];
  const reversedCandidates: AnyObj[] = [];
  const falsePositiveRisks: AnyObj[] = [];
  const unmatched: AnyObj[] = [];

  const usedCloudbetIds =
    new Set<string>();

  for (
    const v27 of v27Matches
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

    unmatched.push(
      buildUnmatchedRecord(
        unmatched.length,
        v27,
        result,
        threshold
      )
    );
  }

  return json({

    success: true,

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
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL",

      optimization:
        "PRE-NORMALIZED TEAMS + FAST TOKEN CANDIDATE FILTER"

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

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
// DIAGNOSTIC
// ============================================================

async function runDiagnostic(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();

  const url =
    new URL(request.url);

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      String(DEFAULT_THRESHOLD)
    );

  if (!Number.isFinite(threshold)) {
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

  const cloudbetRaw =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    cloudbetRaw.filter(
      isCloudbetLive
    );

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

      if (cbId) {
        usedCloudbetIds.add(cbId);
      }

      normalMatched.push(v27);

    } else {

      normalUnmatched.push(v27);
    }
  }

  const diagnostics:
    AnyObj[] = [];

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

        index: i,

        v27: {

          id:
            v27?.id ?? null,

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
            v27?.score ?? null

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
            ),

          reason:
            result.detail.reason

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
            v27?.id ?? null,

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
            v27?.score ?? null

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
        "Every normally unmatched V27 match is compared against every live Cloudbet event with used Cloudbet IDs ignored."

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

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

      false_positive:
        "One team >= 0.80 while the other is < 0.50",

      reversed:
        "Home/Away reversed candidates are separately classified",

      category_protection:
        "U19/U21/U23/reserve/women categories are protected",

      aliases:
        "Aliases are applied inside larger team names",

      common_tokens:
        "Common club tokens cannot create a strong match",

      optimization:
        "Fast token candidate filter + pre-normalized teams",

      diagnostic:
        "Detailed reason is returned for unmatched candidates"

    },

    message:
      "Matcher V5 uses V27 and CLOUDBET Service Bindings. No API key is required here.",

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
        .replace(
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
