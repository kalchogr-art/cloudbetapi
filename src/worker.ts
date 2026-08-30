// ============================================================
// CLOUDBET MATCH MATCHER V5
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V5 PERFORMANCE:
// 1. PRE-NORMALIZED TEAM CACHE
// 2. PRE-BUILT TOKENS
// 3. PRE-BUILT CATEGORIES
// 4. FAST CANDIDATE GATE
// 5. EARLY TOKEN MATCH EXIT
// 6. FAST LEVENSHTEIN
// 7. NO REPEATED NORMALIZATION DURING SCORING
// 8. STRICT TWO-SIDED MATCH
// 9. STRONG ALIAS MATCHING
// 10. YOUTH / RESERVE / WOMEN PROTECTION
// 11. HOME/AWAY DIRECTION CHECK
// 12. COMPETITION / COUNTRY SIGNAL
// 13. POSSIBLE / FALSE POSITIVE / UNMATCHED
// 14. DIAGNOSTIC MODE
// 15. READ ONLY
// ============================================================

interface Env {
  V27: Fetcher;
  CLOUDBET: Fetcher;
}

type AnyObj = Record<string, any>;

type PreparedTeam = {
  raw: string;
  normalized: string;
  tokens: string[];
  tokenSet: Set<string>;
  category: string;
};

type PreparedMatch = {
  raw: AnyObj;
  id: string;
  home: PreparedTeam;
  away: PreparedTeam;
  competition: string;
  country: string;
  live: boolean;
};


// ============================================================
// CONFIG
// ============================================================

const DEFAULT_THRESHOLD = 0.45;

const STRONG_TEAM_SCORE = 0.78;
const POSSIBLE_TEAM_SCORE = 0.60;
const POSSIBLE_TOTAL_SCORE = 0.72;
const CONFIDENT_TOTAL_SCORE = 0.80;

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

  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  "inter":
    "inter milan",

  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "fc internazionale":
    "inter milan",

  "atletico":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid",

  "sporting cp":
    "sporting lisbon",

  "sporting lisboa":
    "sporting lisbon",

  "red star":
    "crvena zvezda",

  "red star belgrade":
    "crvena zvezda",

  "psv eindhoven":
    "psv",

  "bayern munchen":
    "bayern munich",

  "utd":
    "united",

  "ath":
    "athletic",

  "dep":
    "deportivo",

  "depor":
    "deportivo"
};


const SORTED_ALIASES =
  Object.keys(TEAM_ALIASES)
    .sort(
      (a, b) =>
        b.length - a.length
    );


// ============================================================
// GENERIC WORDS
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
        /\bwomen'?s\b/g,
        "women"
      )
      .replace(
        /\bwomen\b/g,
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
    s.split(" ")
      .filter(Boolean);

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

function applyTeamAliases(
  value: string
): string {

  let s =
    normalizeText(value);

  if (!s) {
    return "";
  }

  for (const alias of SORTED_ALIASES) {

    const canonical =
      TEAM_ALIASES[alias];

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

    s =
      s.replace(
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

  const words =
    s
      .split(" ")
      .filter(Boolean)
      .filter(
        w =>
          !GENERIC_WORDS.has(w)
      )
      .filter(
        w =>
          !/^\d+$/.test(w)
      );

  return words.join(" ").trim();
}


// ============================================================
// PREPARE TEAM
// ============================================================

function prepareTeam(
  value: any
): PreparedTeam {

  const raw =
    String(value ?? "");

  const normalized =
    normalizeTeam(raw);

  const category =
    normalizeCategory(raw);

  const tokens =
    normalized
      .split(" ")
      .filter(
        token =>
          token.length >= 2
      );

  return {
    raw,
    normalized,
    tokens,
    tokenSet:
      new Set(tokens),
    category
  };
}


// ============================================================
// CATEGORY COMPATIBILITY
// ============================================================

function categoryCompatiblePrepared(
  a: PreparedTeam,
  b: PreparedTeam
): boolean {

  if (
    !a.category &&
    !b.category
  ) {
    return true;
  }

  if (
    !a.category ||
    !b.category
  ) {
    return true;
  }

  return (
    a.category ===
    b.category
  );
}


// ============================================================
// FAST LEVENSHTEIN
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

  if (
    Math.abs(
      a.length - b.length
    ) > 5
  ) {
    return Math.max(
      a.length,
      b.length
    );
  }

  let previous =
    new Array<number>(
      b.length + 1
    );

  let current =
    new Array<number>(
      b.length + 1
    );

  for (
    let j = 0;
    j <= b.length;
    j++
  ) {
    previous[j] = j;
  }

  for (
    let i = 1;
    i <= a.length;
    i++
  ) {

    current[0] = i;

    let rowMin = current[0];

    for (
      let j = 1;
      j <= b.length;
      j++
    ) {

      const cost =
        a.charCodeAt(i - 1) ===
        b.charCodeAt(j - 1)
          ? 0
          : 1;

      const value =
        Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + cost
        );

      current[j] = value;

      if (value < rowMin) {
        rowMin = value;
      }
    }

    if (
      rowMin >
      Math.max(
        a.length,
        b.length
      )
    ) {
      return rowMin;
    }

    const temp =
      previous;

    previous =
      current;

    current =
      temp;
  }

  return previous[b.length];
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

  const lengthDiff =
    Math.abs(
      a.length - b.length
    );

  if (
    lengthDiff >
    Math.max(
      3,
      Math.floor(
        Math.max(
          a.length,
          b.length
        ) * 0.35
      )
    )
  ) {
    return 0;
  }

  const distance =
    levenshtein(a, b);

  const maxLength =
    Math.max(
      a.length,
      b.length
    );

  return (
    1 -
    distance / maxLength
  );
}


// ============================================================
// FAST TEAM SCORE
// ============================================================

function teamScorePrepared(
  a: PreparedTeam,
  b: PreparedTeam
): number {

  if (
    !a.normalized ||
    !b.normalized
  ) {
    return 0;
  }

  if (
    !categoryCompatiblePrepared(
      a,
      b
    )
  ) {
    return 0;
  }

  // ----------------------------------------------------------
  // Exact
  // ----------------------------------------------------------

  if (
    a.normalized ===
    b.normalized
  ) {
    return 1;
  }

  const aTokens =
    a.tokens;

  const bTokens =
    b.tokens;

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
    aTokens.length <=
    bTokens.length
      ? aTokens
      : bTokens;

  const longerSet =
    aTokens.length <=
    bTokens.length
      ? b.tokenSet
      : a.tokenSet;

  if (
    shorter.length >= 2
  ) {

    let allExact = true;

    for (
      const token of shorter
    ) {

      if (
        !longerSet.has(token)
      ) {
        allExact = false;
        break;
      }
    }

    if (allExact) {

      const longer =
        aTokens.length <=
        bTokens.length
          ? bTokens
          : aTokens;

      let meaningfulExtra =
        0;

      for (
        const token of longer
      ) {

        if (
          !shorter.includes(token) &&
          !/^u\d{2}$/.test(token) &&
          token !== "reserve" &&
          token !== "women" &&
          !/^team[234]$/.test(token)
        ) {
          meaningfulExtra++;
        }
      }

      if (
        meaningfulExtra === 0
      ) {
        return 0.97;
      }
    }
  }

  // ----------------------------------------------------------
  // Exact overlap
  // ----------------------------------------------------------

  let exact = 0;

  for (
    const token of aTokens
  ) {

    if (
      b.tokenSet.has(token)
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

  const overlap =
    exact /
    Math.max(
      1,
      minTokens
    );

  // ----------------------------------------------------------
  // Fast rejection
  //
  // If there are multiple tokens and
  // absolutely no exact overlap, do not
  // spend CPU on fuzzy matching unless
  // the names are very similar in length.
  // ----------------------------------------------------------

  if (
    exact === 0 &&
    minTokens >= 2
  ) {

    if (
      Math.abs(
        a.normalized.length -
        b.normalized.length
      ) >
      Math.max(
        8,
        Math.floor(
          Math.max(
            a.normalized.length,
            b.normalized.length
          ) * 0.40
        )
      )
    ) {
      return 0;
    }
  }

  // ----------------------------------------------------------
  // Fuzzy
  // ----------------------------------------------------------

  let fuzzy = 0;

  for (
    const aToken of aTokens
  ) {

    let best = 0;

    // Exact first
    if (
      b.tokenSet.has(aToken)
    ) {
      best = 1;
    } else {

      for (
        const bToken of bTokens
      ) {

        // Cheap first-character gate
        if (
          aToken.charCodeAt(0) !==
          bToken.charCodeAt(0)
        ) {
          continue;
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

          if (
            best >= 0.97
          ) {
            break;
          }
        }
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

  let score =
    precision * 0.40 +
    recall * 0.25 +
    overlap * 0.35;

  // ----------------------------------------------------------
  // SINGLE TOKEN
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // ONE TOKEN VS LARGE CLUB
  // ----------------------------------------------------------

  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {

    score *= 0.50;
  }

  // ----------------------------------------------------------
  // Weak token protection
  // ----------------------------------------------------------

  if (
    minTokens === 1 &&
    WEAK_TEAM_TOKENS.has(
      aTokens[0]
    )
  ) {

    score *= 0.35;
  }

  // ----------------------------------------------------------
  // Meaningful exact overlap
  // ----------------------------------------------------------

  let exactMeaningful = 0;

  for (
    const token of aTokens
  ) {

    if (
      b.tokenSet.has(token) &&
      !WEAK_TEAM_TOKENS.has(token)
    ) {
      exactMeaningful++;
    }
  }

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

  const text =
    match?.match ??
    match?.name ??
    "";

  return splitMatchName(
    text
  ).home;
}


// ============================================================
// EXTRACT AWAY
// ============================================================

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

  const text =
    match?.match ??
    match?.name ??
    "";

  return splitMatchName(
    text
  ).away;
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
    const separator of
    separators
  ) {

    const index =
      text.indexOf(separator);

    if (
      index >= 0
    ) {

      return {
        home:
          text
            .slice(0, index)
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
// COMPETITION
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


// ============================================================
// PREPARE MATCH
// ============================================================

function prepareMatch(
  match: AnyObj,
  live = false
): PreparedMatch {

  return {
    raw: match,

    id:
      String(
        match?.id ??
        match?.key ??
        ""
      ),

    home:
      prepareTeam(
        extractHome(match)
      ),

    away:
      prepareTeam(
        extractAway(match)
      ),

    competition:
      competitionText(match),

    country:
      countryText(match),

    live
  };
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

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  if (
    A === B
  ) {
    return 1;
  }

  const aWords =
    A.split(" ")
      .filter(Boolean);

  const bSet =
    new Set(
      B.split(" ")
        .filter(Boolean)
    );

  let overlap = 0;

  for (
    const word of aWords
  ) {

    if (
      bSet.has(word)
    ) {
      overlap++;
    }
  }

  return (
    overlap /
    Math.max(
      1,
      Math.min(
        aWords.length,
        bSet.size
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

  return (
    a.country ===
    b.country
      ? 1
      : 0
  );
}


// ============================================================
// FAST CANDIDATE GATE
//
// This is deliberately conservative.
// It only rejects obviously impossible
// candidates. It must NOT remove legitimate
// matches.
// ============================================================

function candidateGate(
  v27: PreparedMatch,
  cb: PreparedMatch
): boolean {

  const vh =
    v27.home;

  const va =
    v27.away;

  const ch =
    cb.home;

  const ca =
    cb.away;

  if (
    !vh.normalized ||
    !va.normalized ||
    !ch.normalized ||
    !ca.normalized
  ) {
    return false;
  }

  // Category protection
  if (
    !categoryCompatiblePrepared(
      vh,
      ch
    ) &&
    !categoryCompatiblePrepared(
      vh,
      ca
    )
  ) {
    return false;
  }

  if (
    !categoryCompatiblePrepared(
      va,
      ca
    ) &&
    !categoryCompatiblePrepared(
      va,
      ch
    )
  ) {
    return false;
  }

  // Fast exact-token directional check
  let normalPossible = false;
  let reversePossible = false;

  for (
    const token of vh.tokens
  ) {

    if (
      ch.tokenSet.has(token)
    ) {
      normalPossible = true;
      break;
    }
  }

  for (
    const token of va.tokens
  ) {

    if (
      ca.tokenSet.has(token)
    ) {
      normalPossible = true;
      break;
    }
  }

  for (
    const token of vh.tokens
  ) {

    if (
      ca.tokenSet.has(token)
    ) {
      reversePossible = true;
      break;
    }
  }

  for (
    const token of va.tokens
  ) {

    if (
      ch.tokenSet.has(token)
    ) {
      reversePossible = true;
      break;
    }
  }

  if (
    normalPossible ||
    reversePossible
  ) {
    return true;
  }

  // No exact overlap.
  // Permit only if normalized strings
  // are reasonably short/close.
  const homeLength =
    Math.abs(
      vh.normalized.length -
      ch.normalized.length
    );

  const awayLength =
    Math.abs(
      va.normalized.length -
      ca.normalized.length
    );

  if (
    homeLength <= 4 &&
    awayLength <= 4
  ) {
    return true;
  }

  // Also permit reverse length similarity.
  const reverseHomeLength =
    Math.abs(
      vh.normalized.length -
      ca.normalized.length
    );

  const reverseAwayLength =
    Math.abs(
      va.normalized.length -
      ch.normalized.length
    );

  return (
    reverseHomeLength <= 4 &&
    reverseAwayLength <= 4
  );
}


// ============================================================
// DETAILED MATCH SCORE
// ============================================================

function detailedMatchScorePrepared(
  v27: PreparedMatch,
  cb: PreparedMatch
) {

  const homeScore =
    teamScorePrepared(
      v27.home,
      cb.home
    );

  const awayScore =
    teamScorePrepared(
      v27.away,
      cb.away
    );

  const reverseHomeScore =
    teamScorePrepared(
      v27.home,
      cb.away
    );

  const reverseAwayScore =
    teamScorePrepared(
      v27.away,
      cb.home
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
    competitionSimilarityPrepared(
      v27,
      cb
    );

  const countryScore =
    countrySimilarityPrepared(
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
// FIND BEST MATCH V5
// ============================================================

function findBestMatchPrepared(
  v27: PreparedMatch,
  cloudbetMatches: PreparedMatch[],
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

  for (
    const cb of cloudbetMatches
  ) {

    if (
      !ignoreUsed &&
      usedIds &&
      cb.id &&
      usedIds.has(cb.id)
    ) {
      continue;
    }

    if (
      !candidateGate(
        v27,
        cb
      )
    ) {
      continue;
    }

    candidateEvaluations++;

    const detail =
      detailedMatchScorePrepared(
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
// EXTRACT CLOUDBET
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
  v27: PreparedMatch,
  cb: PreparedMatch,
  detail: AnyObj
) {

  const v =
    v27.raw;

  const c =
    cb.raw;

  return {

    match:
      matchDisplayName(v),

    v27: {

      id:
        v?.id ??
        null,

      home:
        extractHome(v),

      away:
        extractAway(v),

      normalized_home:
        v27.home.normalized,

      normalized_away:
        v27.away.normalized,

      category_home:
        v27.home.category,

      category_away:
        v27.away.category,

      minute:
        v?.minute ??
        v?.minute_display ??
        null,

      score:
        v?.score ??
        null
    },

    cloudbet: {

      id:
        c?.id ??
        null,

      key:
        c?.key ??
        null,

      match:
        matchDisplayName(c),

      home:
        extractHome(c),

      away:
        extractAway(c),

      normalized_home:
        cb.home.normalized,

      normalized_away:
        cb.away.normalized,

      category_home:
        cb.home.category,

      category_away:
        cb.away.category,

      status:
        c?.status ??
        null,

      minute:
        c?.minute ??
        c?.minute_display ??
        null,

      score:
        c?.score ??
        null,

      competition:
        c?.competition ??
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
// BUILD UNMATCHED
// ============================================================

function buildUnmatchedRecord(
  index: number,
  v27: PreparedMatch,
  result: AnyObj,
  threshold: number
) {

  const v =
    v27.raw;

  const best =
    result.best as
    PreparedMatch | null;

  const c =
    best?.raw;

  return {

    index,

    v27: {

      id:
        v?.id ??
        null,

      match:
        matchDisplayName(v),

      home:
        extractHome(v),

      away:
        extractAway(v),

      normalized_home:
        v27.home.normalized,

      normalized_away:
        v27.away.normalized,

      category_home:
        v27.home.category,

      category_away:
        v27.away.category,

      minute:
        v?.minute ??
        v?.minute_display ??
        null,

      score:
        v?.score ??
        null
    },

    best_cloudbet:
      best
        ? {

            id:
              c?.id ??
              null,

            key:
              c?.key ??
              null,

            match:
              matchDisplayName(c),

            home:
              extractHome(c),

            away:
              extractAway(c),

            normalized_home:
              best.home.normalized,

            normalized_away:
              best.away.normalized,

            competition:
              c?.competition ??
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
// PREPARE ALL
// ============================================================

function prepareAll(
  matches: AnyObj[],
  live = false
): PreparedMatch[] {

  const result:
    PreparedMatch[] = [];

  for (
    const match of matches
  ) {

    result.push(
      prepareMatch(
        match,
        live
      )
    );
  }

  return result;
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
    !Number.isFinite(
      threshold
    )
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

  // ----------------------------------------------------------
  // FETCH IN PARALLEL
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // EXTRACT
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // PREPARE
  // ----------------------------------------------------------

  const v27Matches =
    prepareAll(
      v27Raw,
      false
    );

  const cloudbetMatches =
    prepareAll(
      cloudbetLiveRaw,
      true
    );

  // ----------------------------------------------------------
  // ARRAYS
  // ----------------------------------------------------------

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

  let candidateEvaluations = 0;

  // ----------------------------------------------------------
  // PROCESS
  // ----------------------------------------------------------

  for (
    const v27 of
    v27Matches
  ) {

    const result =
      findBestMatchPrepared(
        v27,
        cloudbetMatches,
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
        result.best as
        PreparedMatch;

      if (
        cb.id
      ) {

        usedCloudbetIds.add(
          cb.id
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

    if (
      result.best &&
      result.detail
    ) {

      const cb =
        result.best as
        PreparedMatch;

      const item =
        buildMatchRecord(
          v27,
          cb,
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

  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------

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
        0.90,

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION + COMPETITION/COUNTRY SIGNAL",

      optimization:
        "PRE-NORMALIZED TEAMS + PRE-BUILT TOKENS + FAST CANDIDATE GATE + EARLY FUZZY EXIT"
    },

    stats: {

      v27_matches:
        v27Raw.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

      cloudbet_live_matches:
        cloudbetLiveRaw.length,

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
        v27Matches.length,

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

  const v27Matches =
    prepareAll(
      v27Raw,
      false
    );

  const cloudbetMatches =
    prepareAll(
      cloudbetLiveRaw,
      true
    );

  const usedCloudbetIds =
    new Set<string>();

  const normalMatched:
    PreparedMatch[] = [];

  const normalUnmatched:
    PreparedMatch[] = [];

  let candidateEvaluations = 0;

  // ----------------------------------------------------------
  // NORMAL PASS
  // ----------------------------------------------------------

  for (
    const v27 of
    v27Matches
  ) {

    const result =
      findBestMatchPrepared(
        v27,
        cloudbetMatches,
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
        result.best as
        PreparedMatch;

      if (
        cb.id
      ) {
        usedCloudbetIds.add(
          cb.id
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
    i <
    normalUnmatched.length;
    i++
  ) {

    const v27 =
      normalUnmatched[i];

    const result =
      findBestMatchPrepared(
        v27,
        cloudbetMatches,
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

      const cb =
        result.best as
        PreparedMatch;

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
            cb.home.normalized,

          normalized_away:
            cb.away.normalized,

          category_home:
            cb.home.category,

          category_away:
            cb.away.category,

          status:
            cb.raw?.status ??
            null,

          competition:
            cb.raw?.competition ??
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

      diagnostic_note:
        "Diagnostic ignores used Cloudbet IDs so every unmatched V27 match is compared against every live Cloudbet event.",

      optimization:
        "PRE-NORMALIZED TEAMS + PRE-BUILT TOKENS + FAST CANDIDATE GATE + EARLY FUZZY EXIT"
    },

    stats: {

      v27_matches:
        v27Raw.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

      cloudbet_live_matches:
        cloudbetLiveRaw.length,

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
        v27Matches.length,

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
        "Prepared teams + cached tokens + fast candidate gate + early fuzzy exit"
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
