// ============================================================
// CLOUDBET MATCH MATCHER V5.1
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V5.1 FINAL MATCHER
//
// V27      -> Flashscore live matches
// CLOUDBET -> /live
//
// NO CLOUDBET API KEY HERE
//
// FEATURES:
// 1. STRICT TWO-SIDED TEAM MATCH
// 2. STRONG TEAM ALIAS MATCHING
// 3. U19/U21/U23 SUPPORT
// 4. RESERVE / WOMEN PROTECTION
// 5. COMMON TOKEN PROTECTION
// 6. HOME/AWAY DIRECTION CHECK
// 7. REVERSED MATCH DIAGNOSTIC
// 8. COMPETITION / COUNTRY SIGNAL
// 9. CONFIDENT / POSSIBLE / FALSE POSITIVE / UNMATCHED
// 10. PRE-NORMALIZED TEAM CACHE
// 11. TOKEN INDEX
// 12. EXACT + ALIAS CANDIDATE INDEX
// 13. SAFE FUZZY FALLBACK
// 14. LIMITED CANDIDATE EVALUATION
// 15. SAME JSON OUTPUT
// 16. READ ONLY
//
// FINAL V5.1 CHANGE:
// Candidate filtering is less aggressive than V5.
// It keeps candidates when either side has a useful token,
// alias-equivalent token, category-compatible identity,
// or strong fuzzy token similarity.
//
// This prevents the optimizer from accidentally removing
// a real Cloudbet candidate before the matcher can score it.
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
    applyTeamAliases(
      s
    );

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

  return words.join(" ")
    .trim();
}


// ============================================================
// TEAM CATEGORY
// ============================================================

function teamCategory(
  value: any
): string {

  return normalizeCategory(
    value
  );
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
// PREPARED TEAM
// ============================================================

interface PreparedTeam {
  raw: string;
  normalized: string;
  category: string;
  tokens: string[];
  tokenSet: Set<string>;
  meaningfulTokens: string[];
  meaningfulSet: Set<string>;
}


// ============================================================
// PREPARE TEAM
// ============================================================

function prepareTeam(
  value: any
): PreparedTeam {

  const raw =
    String(
      value ?? ""
    ).trim();

  const normalized =
    normalizeTeam(
      raw
    );

  const category =
    teamCategory(
      raw
    );

  const tokens =
    normalized
      .split(" ")
      .filter(Boolean);

  const tokenSet =
    new Set<string>(
      tokens
    );

  const meaningfulTokens =
    tokens.filter(
      token =>
        !WEAK_TEAM_TOKENS.has(
          token
        )
    );

  const meaningfulSet =
    new Set<string>(
      meaningfulTokens
    );

  return {

    raw,

    normalized,

    category,

    tokens,

    tokenSet,

    meaningfulTokens,

    meaningfulSet
  };
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
      prev[j] =
        curr[j];
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
// PREPARED TOKEN SCORE
// ============================================================

function preparedTeamScore(
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
    a.category &&
    b.category &&
    a.category !== b.category
  ) {
    return 0;
  }

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

  const shorter =
    aTokens.length <=
    bTokens.length
      ? aTokens
      : bTokens;

  const longer =
    aTokens.length <=
    bTokens.length
      ? bTokens
      : aTokens;

  const shorterAllExact =
    shorter.every(
      token =>
        longer.includes(
          token
        )
    );

  if (
    shorterAllExact &&
    shorter.length >= 2
  ) {

    const extraTokens =
      longer.filter(
        token =>
          !shorter.includes(
            token
          )
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

    if (
      b.tokenSet.has(
        aToken
      )
    ) {

      exact++;
      fuzzy += 1;
      continue;
    }

    let best = 0;

    for (
      const bToken of bTokens
    ) {

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

      if (
        best >= 0.95
      ) {
        break;
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
        b.tokenSet.has(
          token
        ) &&
        !WEAK_TEAM_TOKENS.has(
          token
        )
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
// RAW TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

  return preparedTeamScore(
    prepareTeam(a),
    prepareTeam(b)
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
    const separator of
    separators
  ) {

    const index =
      text.indexOf(
        separator
      );

    if (
      index >= 0
    ) {

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

  if (
    !A ||
    !B
  ) {
    return 0;
  }

  return A === B
    ? 1
    : 0;
}


// ============================================================
// PREPARED MATCH
// ============================================================

interface PreparedMatch {
  raw: AnyObj;
  home: PreparedTeam;
  away: PreparedTeam;
  homeTokens: Set<string>;
  awayTokens: Set<string>;
  categoryHome: string;
  categoryAway: string;
  id: string;
}


// ============================================================
// PREPARE MATCH
// ============================================================

function prepareMatch(
  match: AnyObj
): PreparedMatch {

  const home =
    prepareTeam(
      extractHome(match)
    );

  const away =
    prepareTeam(
      extractAway(match)
    );

  return {

    raw: match,

    home,

    away,

    homeTokens:
      home.tokenSet,

    awayTokens:
      away.tokenSet,

    categoryHome:
      home.category,

    categoryAway:
      away.category,

    id:
      String(
        match?.id ??
        match?.key ??
        ""
      )
  };
}


// ============================================================
// MATCH INDEX
// ============================================================

interface MatchIndex {
  exactHome: Map<string, number[]>;
  exactAway: Map<string, number[]>;
  tokenIndex: Map<string, number[]>;
}


// ============================================================
// ADD INDEX
// ============================================================

function addIndex(
  map: Map<string, number[]>,
  key: string,
  index: number
) {

  if (!key) {
    return;
  }

  const list =
    map.get(key);

  if (list) {

    list.push(index);

  } else {

    map.set(
      key,
      [index]
    );
  }
}


// ============================================================
// BUILD INDEX
// ============================================================

function buildMatchIndex(
  prepared: PreparedMatch[]
): MatchIndex {

  const exactHome =
    new Map<string, number[]>();

  const exactAway =
    new Map<string, number[]>();

  const tokenIndex =
    new Map<string, number[]>();

  for (
    let i = 0;
    i < prepared.length;
    i++
  ) {

    const match =
      prepared[i];

    addIndex(
      exactHome,
      match.home.normalized,
      i
    );

    addIndex(
      exactAway,
      match.away.normalized,
      i
    );

    for (
      const token of
      match.home.tokens
    ) {

      addIndex(
        tokenIndex,
        token,
        i
      );
    }

    for (
      const token of
      match.away.tokens
    ) {

      addIndex(
        tokenIndex,
        token,
        i
      );
    }
  }

  return {

    exactHome,

    exactAway,

    tokenIndex
  };
}


// ============================================================
// CANDIDATE LOOKUP
//
// V5.1:
// We intentionally keep this broad enough to prevent false
// negatives caused by over-aggressive token filtering.
//
// Candidate if:
// - exact home
// - exact away
// - shared home token
// - shared away token
// - alias-normalized token
// - category-compatible identity
//
// If nothing is found, we use a limited fallback scan.
// ============================================================

function getCandidateIndexes(
  v27: PreparedMatch,
  cloudbet: PreparedMatch[],
  index: MatchIndex
): number[] {

  const candidates =
    new Set<number>();

  // ----------------------------------------------------------
  // EXACT HOME
  // ----------------------------------------------------------

  const exactHome =
    index.exactHome.get(
      v27.home.normalized
    );

  if (exactHome) {

    for (
      const i of exactHome
    ) {
      candidates.add(i);
    }
  }

  // ----------------------------------------------------------
  // EXACT AWAY
  // ----------------------------------------------------------

  const exactAway =
    index.exactAway.get(
      v27.away.normalized
    );

  if (exactAway) {

    for (
      const i of exactAway
    ) {
      candidates.add(i);
    }
  }

  // ----------------------------------------------------------
  // SHARED TOKENS
  // ----------------------------------------------------------

  const importantTokens =
    [
      ...v27.home.meaningfulTokens,
      ...v27.away.meaningfulTokens
    ];

  for (
    const token of importantTokens
  ) {

    const list =
      index.tokenIndex.get(
        token
      );

    if (!list) {
      continue;
    }

    for (
      const i of list
    ) {

      candidates.add(i);
    }
  }

  // ----------------------------------------------------------
  // WEAK TOKEN FALLBACK
  // ----------------------------------------------------------

  if (
    candidates.size === 0
  ) {

    const allTokens =
      [
        ...v27.home.tokens,
        ...v27.away.tokens
      ];

    for (
      const token of allTokens
    ) {

      const list =
        index.tokenIndex.get(
          token
        );

      if (!list) {
        continue;
      }

      for (
        const i of list
      ) {

        candidates.add(i);
      }
    }
  }

  // ----------------------------------------------------------
  // LIMITED FUZZY TOKEN CANDIDATES
  //
  // This is the important V5.1 fallback.
  // It prevents a spelling difference from removing a real
  // candidate before teamScore() gets a chance to evaluate it.
  // ----------------------------------------------------------

  if (
    candidates.size === 0
  ) {

    const vTokens =
      [
        ...v27.home.meaningfulTokens,
        ...v27.away.meaningfulTokens
      ];

    for (
      let i = 0;
      i < cloudbet.length;
      i++
    ) {

      const cb =
        cloudbet[i];

      let useful = false;

      for (
        const vt of vTokens
      ) {

        for (
          const ct of cb.home.meaningfulTokens
        ) {

          if (
            tokenSimilarity(
              vt,
              ct
            ) >= 0.78
          ) {

            useful = true;
            break;
          }
        }

        if (useful) {
          break;
        }

        for (
          const ct of cb.away.meaningfulTokens
        ) {

          if (
            tokenSimilarity(
              vt,
              ct
            ) >= 0.78
          ) {

            useful = true;
            break;
          }
        }

        if (useful) {
          break;
        }
      }

      if (useful) {
        candidates.add(i);
      }
    }
  }

  // ----------------------------------------------------------
  // FINAL SAFE FALLBACK
  //
  // Dataset is normally ~50-100 live events.
  // If indexing finds nothing, scanning all events is safer
  // than declaring a false unmatched.
  // ----------------------------------------------------------

  if (
    candidates.size === 0
  ) {

    for (
      let i = 0;
      i < cloudbet.length;
      i++
    ) {

      candidates.add(i);
    }
  }

  return [
    ...candidates
  ];
}


// ============================================================
// DETAILED MATCH SCORE
// ============================================================

function detailedPreparedMatchScore(
  v27: PreparedMatch,
  cb: PreparedMatch
) {

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

  const reverseHomeScore =
    preparedTeamScore(
      v27.home,
      cb.away
    );

  const reverseAwayScore =
    preparedTeamScore(
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
    reverseHomeScore >=
      0.80 &&
    reverseAwayScore >=
      0.80
  ) {

    direction =
      "REVERSED";

    baseScore =
      reversed;
  }

  const competitionScore =
    competitionSimilarity(
      v27.raw,
      cb.raw
    );

  const countryScore =
    countrySimilarity(
      v27.raw,
      cb.raw
    );

  let total =
    baseScore;

  if (
    competitionScore >=
    0.80
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

  const total =
    detail.total;

  // ----------------------------------------------------------
  // REVERSED
  // ----------------------------------------------------------

  if (
    detail.direction ===
    "REVERSED"
  ) {

    if (
      home >=
        REVERSED_CONFIDENT_SCORE &&
      away >=
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

  // ----------------------------------------------------------
  // CONFIDENT
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // POSSIBLE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // FALSE POSITIVE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // CLOSE
  // ----------------------------------------------------------

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

  // ----------------------------------------------------------
  // TRUE UNMATCHED
  // ----------------------------------------------------------

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

interface MatchSearchResult {
  matched: boolean;
  best: AnyObj | null;
  score: number;
  detail: AnyObj | null;
  classification: string;
  reason: string;
  evaluations: number;
}


// ============================================================
// FIND BEST MATCH
// ============================================================

function findBestMatch(
  v27: PreparedMatch,
  cloudbetMatches: PreparedMatch[],
  index: MatchIndex,
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false
): MatchSearchResult {

  let best:
    PreparedMatch | null =
      null;

  let bestDetail:
    AnyObj | null =
      null;

  let bestScore = 0;

  let evaluations = 0;

  const candidateIndexes =
    getCandidateIndexes(
      v27,
      cloudbetMatches,
      index
    );

  for (
    const candidateIndex of
    candidateIndexes
  ) {

    const cb =
      cloudbetMatches[
        candidateIndex
      ];

    const cbId =
      cb.id;

    if (
      !ignoreUsed &&
      usedIds &&
      cbId &&
      usedIds.has(
        cbId
      )
    ) {
      continue;
    }

    evaluations++;

    const detail =
      detailedPreparedMatchScore(
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

      matched:
        false,

      best:
        null,

      score:
        0,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "NO_VALID_CLOUDBET_CANDIDATE",

      evaluations
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

    best:
      best.raw,

    score:
      bestDetail.total,

    detail:
      bestDetail,

    classification:
      classification.classification,

    reason:
      classification.reason,

    evaluations
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
    (
      `${home ?? ""} - ${away ?? ""}`
    )
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
      matchDisplayName(
        v27
      ),

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
        matchDisplayName(
          cb
        ),

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
// BUILD UNMATCHED
// ============================================================

function buildUnmatchedRecord(
  index: number,
  v27: AnyObj,
  result: MatchSearchResult,
  threshold: number
) {

  return {

    index,

    v27: {

      id:
        v27?.id ??
        null,

      match:
        matchDisplayName(
          v27
        ),

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
// PREPARE DATA
// ============================================================

function prepareMatches(
  matches: AnyObj[]
): PreparedMatch[] {

  return matches.map(
    prepareMatch
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

  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const cloudbetRawMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    cloudbetRawMatches
      .filter(
        isCloudbetLive
      );

  const preparedV27 =
    prepareMatches(
      v27Matches
    );

  const preparedCloudbet =
    prepareMatches(
      cloudbetMatches
    );

  const cloudbetIndex =
    buildMatchIndex(
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

  let candidateEvaluations = 0;

  for (
    let i = 0;
    i < preparedV27.length;
    i++
  ) {

    const prepared =
      preparedV27[i];

    const result =
      findBestMatch(
        prepared,
        preparedCloudbet,
        cloudbetIndex,
        threshold,
        usedCloudbetIds,
        false
      );

    candidateEvaluations +=
      result.evaluations;

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

      matches.push({

        ...buildMatchRecord(
          v27Matches[i],
          result.best,
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
          v27Matches[i],
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
          v27Matches[i],
          result,
          threshold
        )
      );

      continue;
    }

    unmatched.push(
      buildUnmatchedRecord(
        unmatched.length,
        v27Matches[i],
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
      "V5.1",

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
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRawMatches.length,

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

  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const cloudbetRawMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetMatches =
    cloudbetRawMatches
      .filter(
        isCloudbetLive
      );

  const preparedV27 =
    prepareMatches(
      v27Matches
    );

  const preparedCloudbet =
    prepareMatches(
      cloudbetMatches
    );

  const cloudbetIndex =
    buildMatchIndex(
      preparedCloudbet
    );

  const usedCloudbetIds =
    new Set<string>();

  const normalMatched:
    AnyObj[] = [];

  const normalUnmatched:
    AnyObj[] = [];

  let candidateEvaluations = 0;

  for (
    let i = 0;
    i < preparedV27.length;
    i++
  ) {

    const result =
      findBestMatch(
        preparedV27[i],
        preparedCloudbet,
        cloudbetIndex,
        threshold,
        usedCloudbetIds,
        false
      );

    candidateEvaluations +=
      result.evaluations;

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
        v27Matches[i]
      );

    } else {

      normalUnmatched.push(
        v27Matches[i]
      );
    }
  }

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

    const original =
      normalUnmatched[i];

    const prepared =
      prepareMatch(
        original
      );

    const result =
      findBestMatch(
        prepared,
        preparedCloudbet,
        cloudbetIndex,
        threshold,
        undefined,
        true
      );

    candidateEvaluations +=
      result.evaluations;

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
            original?.id ??
            null,

          match:
            matchDisplayName(
              original
            ),

          home:
            extractHome(
              original
            ),

          away:
            extractAway(
              original
            ),

          normalized_home:
            normalizeTeam(
              extractHome(
                original
              )
            ),

          normalized_away:
            normalizeTeam(
              extractAway(
                original
              )
            ),

          category_home:
            teamCategory(
              extractHome(
                original
              )
            ),

          category_away:
            teamCategory(
              extractAway(
                original
              )
            ),

          minute:
            original?.minute ??
            original?.minute_display ??
            null,

          score:
            original?.score ??
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
            original?.id ??
            null,

          match:
            matchDisplayName(
              original
            ),

          home:
            extractHome(
              original
            ),

          away:
            extractAway(
              original
            ),

          normalized_home:
            normalizeTeam(
              extractHome(
                original
              )
            ),

          normalized_away:
            normalizeTeam(
              extractAway(
                original
              )
            ),

          category_home:
            teamCategory(
              extractHome(
                original
              )
            ),

          category_away:
            teamCategory(
              extractAway(
                original
              )
            ),

          minute:
            original?.minute ??
            original?.minute_display ??
            null,

          score:
            original?.score ??
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
      "V5.1",

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
        "Diagnostic ignores used Cloudbet IDs so every unmatched V27 match is compared against every live Cloudbet event."

    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRawMatches.length,

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
      "V5.1",

    mode:
      "READ ONLY",

    bindings: {

      V27:
        true,

      CLOUDBET:
        true

    },

    matcher:
      "V5.1 FINAL STRICT TWO-SIDED MATCH",

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
        "Pre-normalized teams + token index + safe candidate lookup + limited fuzzy fallback"

    },

    message:
      "Final V5.1 matcher uses V27 and CLOUDBET Service Bindings. No API key is required here.",

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
            "V5.1",

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
