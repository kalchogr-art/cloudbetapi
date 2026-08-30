// ============================================================
// CLOUDBET MATCH MATCHER V5
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V27      -> Flashscore live matches
// CLOUDBET -> /live
//
// V5
// ------------------------------------------------------------
// 1. STRICT TWO-SIDED TEAM MATCH
// 2. STRONG ALIAS MATCHING
// 3. U19/U21/U23/RESERVE/WOMEN PROTECTION
// 4. HOME/AWAY DIRECTION PROTECTION
// 5. REVERSED MATCH DIAGNOSTIC
// 6. COMPETITION / COUNTRY SIGNAL
// 7. FALSE POSITIVE PROTECTION
// 8. PRE-NORMALIZED TEAM CACHE
// 9. TOKEN INDEX
// 10. SAFE EXACT / ALIAS LOOKUP
// 11. LIMITED FUZZY FALLBACK
// 12. SAME JSON OUTPUT STRUCTURE
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

const SORTED_ALIASES =
  Object.keys(TEAM_ALIASES).sort(
    (a, b) => b.length - a.length
  );


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
// WEAK COMMON TOKENS
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
// CATEGORY
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
    .replace(/\bwomen'?s\b/g, "women")
    .replace(/\bwomen\b/g, "women")
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

  if (!A && !B) {
    return true;
  }

  if (!A || !B) {
    return true;
  }

  return A === B;
}


// ============================================================
// APPLY ALIASES
// ============================================================

function applyTeamAliases(value: string): string {
  let s = normalizeText(value);

  if (!s) {
    return "";
  }

  for (const alias of SORTED_ALIASES) {
    const canonical = TEAM_ALIASES[alias];

    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    const regex =
      new RegExp(
        `(^|\\s)${escaped}(?=\\s|$)`,
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

  return s
    .split(" ")
    .filter(Boolean)
    .filter(
      word => !GENERIC_WORDS.has(word)
    )
    .filter(
      word => !/^\d+$/.test(word)
    )
    .join(" ")
    .trim();
}


// ============================================================
// PREPARED TEAM
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
    .filter(token => token.length >= 2);

  return {
    raw,
    normalized,
    category: teamCategory(raw),
    tokens,
    tokenSet: new Set(tokens)
  };
}


// ============================================================
// PREPARED MATCH
// ============================================================

interface PreparedMatch {
  raw: AnyObj;
  home: PreparedTeam;
  away: PreparedTeam;
  competition: string;
  country: string;
  id: string;
}

function prepareMatch(
  match: AnyObj
): PreparedMatch {
  const home = extractHome(match) ?? "";
  const away = extractAway(match) ?? "";

  return {
    raw: match,

    home: prepareTeam(home),
    away: prepareTeam(away),

    competition: competitionText(match),
    country: countryText(match),

    id: String(
      match?.id ??
      match?.key ??
      ""
    )
  };
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

  let prev = new Array<number>(
    b.length + 1
  );

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

  const maxLength =
    Math.max(a.length, b.length);

  if (!maxLength) {
    return 0;
  }

  return (
    1 -
    levenshtein(a, b) /
      maxLength
  );
}


// ============================================================
// FAST TEAM SCORE
// ============================================================

function preparedTeamScore(
  A: PreparedTeam,
  B: PreparedTeam
): number {
  if (
    !A.normalized ||
    !B.normalized
  ) {
    return 0;
  }

  if (
    A.category &&
    B.category &&
    A.category !== B.category
  ) {
    return 0;
  }

  // Exact normalized match.
  if (A.normalized === B.normalized) {
    return 1;
  }

  const aTokens = A.tokens;
  const bTokens = B.tokens;

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

  // ----------------------------------------------------------
  // Exact subset.
  // ----------------------------------------------------------

  const shorter =
    aTokens.length <= bTokens.length
      ? aTokens
      : bTokens;

  const longer =
    aTokens.length <= bTokens.length
      ? bTokens
      : aTokens;

  if (shorter.length >= 2) {
    let allExact = true;

    for (const token of shorter) {
      if (!longer.includes(token)) {
        allExact = false;
        break;
      }
    }

    if (allExact) {
      const meaningfulExtra =
        longer.filter(
          token =>
            !shorter.includes(token) &&
            !/^u\d{2}$/.test(token) &&
            token !== "reserve" &&
            token !== "women" &&
            !/^team[234]$/.test(token)
        );

      if (!meaningfulExtra.length) {
        return 0.97;
      }
    }
  }

  let fuzzy = 0;
  let exact = 0;

  for (const aToken of aTokens) {
    if (B.tokenSet.has(aToken)) {
      fuzzy += 1;
      exact++;
      continue;
    }

    let best = 0;

    for (const bToken of bTokens) {
      const sim =
        tokenSimilarity(
          aToken,
          bToken
        );

      if (sim > best) {
        best = sim;
      }

      if (best >= 0.95) {
        break;
      }
    }

    if (best >= 0.90) {
      fuzzy += best;
    } else if (best >= 0.75) {
      fuzzy += best * 0.65;
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

  // Single-token match.
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

  // One token vs large club.
  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {
    score *= 0.50;
  }

  // Weak single token.
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
// SPLIT MATCH
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

function competitionSimilarityPrepared(
  a: PreparedMatch,
  b: PreparedMatch
): number {
  const A = a.competition;
  const B = b.competition;

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

function countrySimilarityPrepared(
  a: PreparedMatch,
  b: PreparedMatch
): number {
  if (
    !a.country ||
    !b.country
  ) {
    return 0;
  }

  return a.country === b.country
    ? 1
    : 0;
}


// ============================================================
// DETAILED SCORE
// ============================================================

function detailedPreparedScore(
  v27: PreparedMatch,
  cb: PreparedMatch
) {
  if (
    !v27.home.normalized ||
    !v27.away.normalized ||
    !cb.home.normalized ||
    !cb.away.normalized
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
    preparedTeamScore(
      v27.home,
      cb.home
    );

  const awayScore =
    preparedTeamScore(
      v27.away,
      cb.away
    );

  // Only calculate reverse when needed.
  let reverseHomeScore = 0;
  let reverseAwayScore = 0;

  if (
    homeScore < STRONG_TEAM_SCORE ||
    awayScore < STRONG_TEAM_SCORE
  ) {
    reverseHomeScore =
      preparedTeamScore(
        v27.home,
        cb.away
      );

    reverseAwayScore =
      preparedTeamScore(
        v27.away,
        cb.home
      );
  }

  const normal =
    (homeScore + awayScore) / 2;

  const reversed =
    (reverseHomeScore +
      reverseAwayScore) / 2;

  let direction = "NORMAL";
  let baseScore = normal;

  if (
    reversed > normal &&
    reverseHomeScore >=
      STRONG_TEAM_SCORE &&
    reverseAwayScore >=
      STRONG_TEAM_SCORE
  ) {
    direction = "REVERSED";
    baseScore = reversed;
  }

  const competitionScore =
    competitionSimilarityPrepared(
      v27,
      cb
    );

  const countryScore =
    countrySimilarityPrepared(
      v27,
      cb
    );

  let total = baseScore;

  if (
    competitionScore >= 0.80
  ) {
    total += COMPETITION_BONUS;
  }

  if (
    countryScore === 1
  ) {
    total += COUNTRY_BONUS;
  }

  return {
    total: Math.min(1, total),
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
// CLASSIFICATION
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
// TOKEN INDEX
// ============================================================

interface CloudbetIndex {
  home: Map<string, number[]>;
  away: Map<string, number[]>;
  all: Map<string, number[]>;
}

function addIndex(
  map: Map<string, number[]>,
  token: string,
  index: number
) {
  const existing =
    map.get(token);

  if (existing) {
    existing.push(index);
  } else {
    map.set(
      token,
      [index]
    );
  }
}


function buildCloudbetIndex(
  matches: PreparedMatch[]
): CloudbetIndex {
  const index: CloudbetIndex = {
    home: new Map(),
    away: new Map(),
    all: new Map()
  };

  for (
    let i = 0;
    i < matches.length;
    i++
  ) {
    const match = matches[i];

    for (const token of match.home.tokens) {
      addIndex(
        index.home,
        token,
        i
      );

      addIndex(
        index.all,
        token,
        i
      );
    }

    for (const token of match.away.tokens) {
      addIndex(
        index.away,
        token,
        i
      );

      addIndex(
        index.all,
        token,
        i
      );
    }
  }

  return index;
}


// ============================================================
// CANDIDATE COLLECTION
// ============================================================

function collectCandidates(
  v27: PreparedMatch,
  cloudbet: PreparedMatch[],
  index: CloudbetIndex,
  usedIds: Set<string> | undefined,
  ignoreUsed: boolean
): number[] {
  const candidates = new Set<number>();

  // Exact home token lookup.
  for (const token of v27.home.tokens) {
    const ids =
      index.home.get(token);

    if (ids) {
      for (const id of ids) {
        candidates.add(id);
      }
    }
  }

  // Exact away token lookup.
  for (const token of v27.away.tokens) {
    const ids =
      index.away.get(token);

    if (ids) {
      for (const id of ids) {
        candidates.add(id);
      }
    }
  }

  // Alias / normalized fallback.
  if (candidates.size === 0) {
    for (const token of v27.home.tokens) {
      const ids =
        index.all.get(token);

      if (ids) {
        for (const id of ids) {
          candidates.add(id);
        }
      }
    }

    for (const token of v27.away.tokens) {
      const ids =
        index.all.get(token);

      if (ids) {
        for (const id of ids) {
          candidates.add(id);
        }
      }
    }
  }

  const result: number[] = [];

  for (const id of candidates) {
    const cb = cloudbet[id];

    if (
      !ignoreUsed &&
      usedIds &&
      cb.id &&
      usedIds.has(cb.id)
    ) {
      continue;
    }

    result.push(id);
  }

  return result;
}


// ============================================================
// BEST MATCH
// ============================================================

function findBestPreparedMatch(
  v27: PreparedMatch,
  cloudbet: PreparedMatch[],
  index: CloudbetIndex,
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false
) {
  let best: PreparedMatch | null = null;
  let bestDetail: AnyObj | null = null;
  let bestScore = 0;

  let candidateIds =
    collectCandidates(
      v27,
      cloudbet,
      index,
      usedIds,
      ignoreUsed
    );

  // If token index finds nothing, use limited
  // fuzzy fallback instead of full quadratic scan.
  if (candidateIds.length === 0) {
    candidateIds = [];

    for (
      let i = 0;
      i < cloudbet.length;
      i++
    ) {
      const cb = cloudbet[i];

      if (
        !ignoreUsed &&
        usedIds &&
        cb.id &&
        usedIds.has(cb.id)
      ) {
        continue;
      }

      const homeFirst =
        v27.home.tokens[0];

      const awayFirst =
        v27.away.tokens[0];

      const cbHomeFirst =
        cb.home.tokens[0];

      const cbAwayFirst =
        cb.away.tokens[0];

      const homeSim =
        homeFirst &&
        cbHomeFirst
          ? tokenSimilarity(
              homeFirst,
              cbHomeFirst
            )
          : 0;

      const awaySim =
        awayFirst &&
        cbAwayFirst
          ? tokenSimilarity(
              awayFirst,
              cbAwayFirst
            )
          : 0;

      if (
        homeSim >= 0.65 ||
        awaySim >= 0.65
      ) {
        candidateIds.push(i);
      }
    }
  }

  for (const id of candidateIds) {
    const cb = cloudbet[id];

    const detail =
      detailedPreparedScore(
        v27,
        cb
      );

    if (
      detail.total >
      bestScore
    ) {
      bestScore =
        detail.total;

      best = cb;
      bestDetail = detail;
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
      candidateEvaluations:
        candidateIds.length
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

    candidateEvaluations:
      candidateIds.length
  };
}


// ============================================================
// EXTRACT ARRAYS
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
    status === "TRADING_LIVE"
  ) {
    return true;
  }

  return match?.live === true;
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
            accept:
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
// RECORD
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
        v27?.score ?? null
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
              result.best.home.normalized,

            normalized_away:
              result.best.away.normalized,

            competition:
              result.best.raw?.competition ??
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
// LOAD + PREPARE
// ============================================================

async function loadPrepared(
  env: Env
) {
  const [
    v27Data,
    cloudbetData
  ] = await Promise.all([
    fetchServiceJSON(
      env.V27,
      "/"
    ),

    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    )
  ]);

  const v27Raw =
    extractV27Matches(
      v27Data
    );

  const cloudbetRaw =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetLiveRaw =
    cloudbetRaw.filter(
      isCloudbetLive
    );

  const v27 =
    v27Raw.map(
      prepareMatch
    );

  const cloudbet =
    cloudbetLiveRaw.map(
      prepareMatch
    );

  const index =
    buildCloudbetIndex(
      cloudbet
    );

  return {
    v27Raw,
    cloudbetRaw,
    cloudbetLiveRaw,
    v27,
    cloudbet,
    index
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

  const data =
    await loadPrepared(env);

  const matches: AnyObj[] = [];
  const possibleMatches: AnyObj[] = [];
  const unmatched: AnyObj[] = [];
  const falsePositiveRisks: AnyObj[] = [];
  const reversedCandidates: AnyObj[] = [];

  const usedCloudbetIds =
    new Set<string>();

  let candidateEvaluations = 0;

  for (
    let i = 0;
    i < data.v27.length;
    i++
  ) {
    const v27 =
      data.v27[i];

    const result =
      findBestPreparedMatch(
        v27,
        data.cloudbet,
        data.index,
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

      const record =
        buildMatchRecord(
          v27.raw,
          cb.raw,
          result.detail
        );

      matches.push({
        ...record,

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

      unmatched.push(
        buildUnmatchedRecord(
          unmatched.length,
          v27.raw,
          result,
          threshold
        )
      );

      continue;
    }

    unmatched.push(
      buildUnmatchedRecord(
        unmatched.length,
        v27.raw,
        result,
        threshold
      )
    );
  }

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
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL",

      optimization:
        "PRE-NORMALIZED TEAMS + TOKEN INDEX + SAFE EXACT/ALIAS LOOKUP + LIMITED FUZZY FALLBACK"
    },

    stats: {
      v27_matches:
        data.v27Raw.length,

      cloudbet_raw_matches:
        data.cloudbetRaw.length,

      cloudbet_live_matches:
        data.cloudbetLiveRaw.length,

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

      prepared_v27:
        data.v27.length,

      prepared_cloudbet:
        data.cloudbet.length,

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

  const data =
    await loadPrepared(env);

  const usedCloudbetIds =
    new Set<string>();

  const normalMatched:
    AnyObj[] = [];

  const normalUnmatched:
    PreparedMatch[] = [];

  let candidateEvaluations = 0;

  // ----------------------------------------------------------
  // NORMAL PASS
  // ----------------------------------------------------------

  for (
    const v27 of data.v27
  ) {
    const result =
      findBestPreparedMatch(
        v27,
        data.cloudbet,
        data.index,
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

      normalMatched.push(
        v27.raw
      );
    } else {
      normalUnmatched.push(
        v27
      );
    }
  }

  // ----------------------------------------------------------
  // DIAGNOSTIC
  // ----------------------------------------------------------

  const diagnostics:
    AnyObj[] = [];

  let potentialMatches = 0;
  let closeBelowThreshold = 0;
  let reversedCandidates = 0;
  let trueUnmatched = 0;
  let falsePositiveRisk = 0;

  for (
    let i = 0;
    i < normalUnmatched.length;
    i++
  ) {
    const v27 =
      normalUnmatched[i];

    const result =
      findBestPreparedMatch(
        v27,
        data.cloudbet,
        data.index,
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
            extractHome(
              v27.raw
            ),

          away:
            extractAway(
              v27.raw
            ),

          normalized_home:
            v27.home.normalized,

          normalized_away:
            v27.away.normalized,

          category_home:
            v27.home.category,

          category_away:
            v27.away.category,

          minute:
            v27.raw?.minute ??
            v27.raw?.minute_display ??
            null,

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
            result.best.home.normalized,

          normalized_away:
            result.best.away.normalized,

          category_home:
            result.best.home.category,

          category_away:
            result.best.away.category,

          status:
            result.best.raw?.status ??
            null,

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
            extractHome(
              v27.raw
            ),

          away:
            extractAway(
              v27.raw
            ),

          normalized_home:
            v27.home.normalized,

          normalized_away:
            v27.away.normalized,

          category_home:
            v27.home.category,

          category_away:
            v27.away.category,

          minute:
            v27.raw?.minute ??
            v27.raw?.minute_display ??
            null,

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
        b?.scoring?.total ??
        0
      ) -
      Number(
        a?.scoring?.total ??
        0
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

      optimization:
        "PRE-NORMALIZED TEAMS + TOKEN INDEX + SAFE EXACT/ALIAS LOOKUP + LIMITED FUZZY FALLBACK",

      diagnostic_note:
        "Diagnostic ignores used Cloudbet IDs so every unmatched V27 match is compared against all eligible Cloudbet candidates."
    },

    stats: {
      v27_matches:
        data.v27Raw.length,

      cloudbet_raw_matches:
        data.cloudbetRaw.length,

      cloudbet_live_matches:
        data.cloudbetLiveRaw.length,

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

      prepared_v27:
        data.v27.length,

      prepared_cloudbet:
        data.cloudbet.length,

      candidate_evaluations:
        candidateEvaluations,

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
        "One team strong while the other is weak",

      reversed:
        "Home/Away reversed candidates are separately classified",

      category_protection:
        "U19/U21/U23/reserve/women categories are protected",

      aliases:
        "Aliases are applied inside larger team names",

      common_tokens:
        "Generic/common club tokens cannot create a strong match alone",

      optimization:
        "Exact token index first, limited fuzzy fallback second"
    },

    message:
      "V5 matcher uses V27 and CLOUDBET Service Bindings. No API key is required here.",

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

    } catch (error: any) {
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
