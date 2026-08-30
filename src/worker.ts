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
// 4. HOME/AWAY DIRECTION CHECK
// 5. REVERSED MATCH DIAGNOSTIC
// 6. COMPETITION / COUNTRY SIGNAL
// 7. CONFIDENT / POSSIBLE / FALSE POSITIVE / UNMATCHED
// 8. PRE-NORMALIZED CLOUDbet CACHE
// 9. TOKEN INDEX
// 10. FAST CANDIDATE FILTER
// 11. NO REPEATED NORMALIZATION
// 12. READ ONLY
// 13. DIAGNOSTIC MODE
// 14. NO DB
// 15. NO EXTERNAL API
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
    applyTeamAliases(s);

  let words =
    s
      .split(" ")
      .filter(Boolean)
      .filter(
        w =>
          !GENERIC_WORDS.has(w)
      );

  words =
    words.filter(
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
// TOKEN SET
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
    !categoryCompatible(a, b)
  ) {
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
      text.indexOf(separator);

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
    a.__competition ??
    competitionText(a);

  const B =
    b.__competition ??
    competitionText(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
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
    a.__country ??
    countryText(a);

  const B =
    b.__country ??
    countryText(b);

  if (!A || !B) {
    return 0;
  }

  return A === B
    ? 1
    : 0;
}


// ============================================================
// PREPARED CLOUDBET MATCH
// ============================================================

interface PreparedCloudbet {
  raw: AnyObj;

  id: string;

  home: string;

  away: string;

  normalizedHome: string;

  normalizedAway: string;

  homeTokens: Set<string>;

  awayTokens: Set<string>;

  categoryHome: string;

  categoryAway: string;

  competition: string;

  country: string;
}


// ============================================================
// PREPARE CLOUDBET
// ============================================================

function prepareCloudbet(
  match: AnyObj
): PreparedCloudbet {

  const home =
    extractHome(match) ?? "";

  const away =
    extractAway(match) ?? "";

  const normalizedHome =
    normalizeTeam(home);

  const normalizedAway =
    normalizeTeam(away);

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

    normalizedHome,

    normalizedAway,

    homeTokens:
      teamTokens(normalizedHome),

    awayTokens:
      teamTokens(normalizedAway),

    categoryHome:
      teamCategory(home),

    categoryAway:
      teamCategory(away),

    competition:
      competitionText(match),

    country:
      countryText(match)
  };
}


// ============================================================
// PREPARED TEAM SCORE
//
// Same scoring logic, but uses cached normalized values.
// ============================================================

function preparedTeamScore(
  value: string,
  valueTokens: Set<string>,
  valueCategory: string,
  candidate: string,
  candidateTokens: Set<string>,
  candidateCategory: string
): number {

  if (
    !value ||
    !candidate
  ) {
    return 0;
  }

  if (
    valueCategory &&
    candidateCategory &&
    valueCategory !== candidateCategory
  ) {
    return 0;
  }

  if (
    value === candidate
  ) {
    return 1;
  }

  const aTokens =
    [...valueTokens];

  const bTokens =
    [...candidateTokens];

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
// FAST TOKEN CANDIDATE TEST
//
// We only enter expensive fuzzy scoring when:
// - at least one meaningful token overlaps, OR
// - token prefixes are very close, OR
// - normalized names are close in length and share structure.
//
// This is only a CANDIDATE filter.
// It does NOT decide the final match.
// ============================================================

function hasFastCandidateSignal(
  vHomeTokens: Set<string>,
  vAwayTokens: Set<string>,
  cb: PreparedCloudbet
): boolean {

  const checkSide =
    (
      aTokens: Set<string>,
      bTokens: Set<string>
    ): boolean => {

      for (
        const a of aTokens
      ) {

        if (
          bTokens.has(a)
        ) {
          return true;
        }

        if (
          WEAK_TEAM_TOKENS.has(a)
        ) {
          continue;
        }

        for (
          const b of bTokens
        ) {

          if (
            b.length < 3
          ) {
            continue;
          }

          if (
            a.length >= 4 &&
            b.length >= 4 &&
            (
              a.slice(0, 4) ===
              b.slice(0, 4)
            )
          ) {
            return true;
          }
        }
      }

      return false;
    };

  const homeSignal =
    checkSide(
      vHomeTokens,
      cb.homeTokens
    );

  const awaySignal =
    checkSide(
      vAwayTokens,
      cb.awayTokens
    );

  return (
    homeSignal &&
    awaySignal
  );
}


// ============================================================
// BUILD PREPARED V27
// ============================================================

interface PreparedV27 {
  raw: AnyObj;

  home: string;

  away: string;

  normalizedHome: string;

  normalizedAway: string;

  homeTokens: Set<string>;

  awayTokens: Set<string>;

  categoryHome: string;

  categoryAway: string;

  competition: string;

  country: string;
}


// ============================================================
// PREPARE V27
// ============================================================

function prepareV27(
  match: AnyObj
): PreparedV27 {

  const home =
    extractHome(match) ?? "";

  const away =
    extractAway(match) ?? "";

  return {

    raw: match,

    home,

    away,

    normalizedHome:
      normalizeTeam(home),

    normalizedAway:
      normalizeTeam(away),

    homeTokens:
      teamTokens(home),

    awayTokens:
      teamTokens(away),

    categoryHome:
      teamCategory(home),

    categoryAway:
      teamCategory(away),

    competition:
      competitionText(match),

    country:
      countryText(match)
  };
}


// ============================================================
// DETAILED PREPARED SCORE
// ============================================================

function detailedPreparedScore(
  v27: PreparedV27,
  cb: PreparedCloudbet
): AnyObj {

  if (
    !v27.home ||
    !v27.away ||
    !cb.home ||
    !cb.away
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
      v27.normalizedHome,
      v27.homeTokens,
      v27.categoryHome,
      cb.normalizedHome,
      cb.homeTokens,
      cb.categoryHome
    );

  const awayScore =
    preparedTeamScore(
      v27.normalizedAway,
      v27.awayTokens,
      v27.categoryAway,
      cb.normalizedAway,
      cb.awayTokens,
      cb.categoryAway
    );

  const reverseHomeScore =
    preparedTeamScore(
      v27.normalizedHome,
      v27.homeTokens,
      v27.categoryHome,
      cb.normalizedAway,
      cb.awayTokens,
      cb.categoryAway
    );

  const reverseAwayScore =
    preparedTeamScore(
      v27.normalizedAway,
      v27.awayTokens,
      v27.categoryAway,
      cb.normalizedHome,
      cb.homeTokens,
      cb.categoryHome
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
    (
      v27.competition &&
      cb.competition
    )
      ? competitionSimilarity(
          {
            __competition:
              v27.competition
          },
          {
            __competition:
              cb.competition
          }
        )
      : 0;

  const countryScore =
    (
      v27.country &&
      cb.country &&
      v27.country === cb.country
    )
      ? 1
      : 0;

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
// INDEX
// ============================================================

interface CloudbetIndex {
  all: PreparedCloudbet[];

  tokenIndex:
    Map<string, Set<number>>;
}


// ============================================================
// BUILD INDEX
// ============================================================

function buildCloudbetIndex(
  matches: AnyObj[]
): CloudbetIndex {

  const all:
    PreparedCloudbet[] = [];

  const tokenIndex =
    new Map<
      string,
      Set<number>
    >();

  for (
    const match of matches
  ) {

    const prepared =
      prepareCloudbet(match);

    const index =
      all.length;

    all.push(prepared);

    const tokens =
      new Set<string>([
        ...prepared.homeTokens,
        ...prepared.awayTokens
      ]);

    for (
      const token of tokens
    ) {

      let bucket =
        tokenIndex.get(token);

      if (!bucket) {

        bucket =
          new Set<number>();

        tokenIndex.set(
          token,
          bucket
        );
      }

      bucket.add(index);
    }
  }

  return {
    all,
    tokenIndex
  };
}


// ============================================================
// GET CANDIDATES FROM INDEX
// ============================================================

function getCandidateIndexes(
  v27: PreparedV27,
  index: CloudbetIndex
): Set<number> {

  const result =
    new Set<number>();

  const tokens =
    new Set<string>([
      ...v27.homeTokens,
      ...v27.awayTokens
    ]);

  for (
    const token of tokens
  ) {

    if (
      WEAK_TEAM_TOKENS.has(token)
    ) {
      continue;
    }

    const bucket =
      index.tokenIndex.get(token);

    if (!bucket) {
      continue;
    }

    for (
      const i of bucket
    ) {
      result.add(i);
    }
  }

  return result;
}


// ============================================================
// FIND BEST MATCH
// ============================================================

function findBestPreparedMatch(
  v27: PreparedV27,
  index: CloudbetIndex,
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false
) {

  let best:
    PreparedCloudbet | null =
    null;

  let bestDetail:
    AnyObj | null =
    null;

  let bestScore = 0;

  let candidateIndexes =
    getCandidateIndexes(
      v27,
      index
    );

  // If token index found nothing,
  // do a tiny fallback scan.
  //
  // This prevents the index from hiding
  // unusual aliases while keeping normal
  // processing fast.
  if (
    candidateIndexes.size === 0
  ) {

    candidateIndexes =
      new Set<number>();

    for (
      let i = 0;
      i < index.all.length;
      i++
    ) {

      candidateIndexes.add(i);
    }
  }

  for (
    const i of candidateIndexes
  ) {

    const cb =
      index.all[i];

    if (
      !ignoreUsed &&
      usedIds &&
      cb.id &&
      usedIds.has(cb.id)
    ) {
      continue;
    }

    // Cheap candidate filter.
    if (
      !hasFastCandidateSignal(
        v27.homeTokens,
        v27.awayTokens,
        cb
      )
    ) {
      continue;
    }

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
// EXTRACT V27
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
// EXTRACT CLOUDBET
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
  cb: PreparedCloudbet,
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
        cb.home,

      away:
        cb.away,

      normalized_home:
        cb.normalizedHome,

      normalized_away:
        cb.normalizedAway,

      category_home:
        cb.categoryHome,

      category_away:
        cb.categoryAway,

      status:
        cb.raw?.status ??
        null,

      minute:
        cb.raw?.minute ??
        cb.raw?.minute_display ??
        null,

      score:
        cb.raw?.score ??
        null,

      competition:
        cb.raw?.competition ??
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
// UNMATCHED
// ============================================================

function buildUnmatchedRecord(
  index: number,
  v27: AnyObj,
  result: AnyObj,
  threshold: number
) {

  const cb =
    result.best as
    PreparedCloudbet | null;

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
      cb
        ? {

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
              cb.home,

            away:
              cb.away,

            normalized_home:
              cb.normalizedHome,

            normalized_away:
              cb.normalizedAway,

            category_home:
              cb.categoryHome,

            category_away:
              cb.categoryAway,

            competition:
              cb.raw?.competition ??
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
// PARSE THRESHOLD
// ============================================================

function getThreshold(
  request: Request
): number {

  const url =
    new URL(request.url);

  let threshold =
    Number(
      url.searchParams.get(
        "threshold"
      ) ??
      DEFAULT_THRESHOLD
    );

  if (
    !Number.isFinite(threshold)
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

  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const cloudbetRaw =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetLive =
    cloudbetRaw.filter(
      isCloudbetLive
    );

  const cloudbetIndex =
    buildCloudbetIndex(
      cloudbetLive
    );

  const matches:
    AnyObj[] = [];

  const possibleMatches:
    AnyObj[] = [];

  const reversedCandidates:
    AnyObj[] = [];

  const unmatched:
    AnyObj[] = [];

  const falsePositiveRisks:
    AnyObj[] = [];

  const usedCloudbetIds =
    new Set<string>();

  let preparedV27Count = 0;

  let candidateEvaluations = 0;

  for (
    const rawV27 of v27Matches
  ) {

    const v27 =
      prepareV27(rawV27);

    preparedV27Count++;

    const result =
      findBestPreparedMatch(
        v27,
        cloudbetIndex,
        threshold,
        usedCloudbetIds,
        false
      );

    if (
      result.best
    ) {
      candidateEvaluations++;
    }

    if (
      result.matched &&
      result.best
    ) {

      const cb =
        result.best as
        PreparedCloudbet;

      if (
        cb.id
      ) {
        usedCloudbetIds.add(
          cb.id
        );
      }

      matches.push({

        ...buildMatchRecord(
          rawV27,
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
          rawV27,
          result.best as PreparedCloudbet,
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
          rawV27,
          result,
          threshold
        )
      );

      continue;
    }

    unmatched.push(
      buildUnmatchedRecord(
        unmatched.length,
        rawV27,
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
        "PRE-NORMALIZED TEAMS + TOKEN INDEX + FAST TWO-SIDED CANDIDATE FILTER"
    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

      cloudbet_live_matches:
        cloudbetLive.length,

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
        preparedV27Count,

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

  const v27Matches =
    extractV27Matches(
      v27Data
    );

  const cloudbetRaw =
    extractCloudbetMatches(
      cloudbetData
    );

  const cloudbetLive =
    cloudbetRaw.filter(
      isCloudbetLive
    );

  const cloudbetIndex =
    buildCloudbetIndex(
      cloudbetLive
    );

  const usedCloudbetIds =
    new Set<string>();

  const normalMatched:
    AnyObj[] = [];

  const normalUnmatched:
    AnyObj[] = [];

  for (
    const rawV27 of v27Matches
  ) {

    const v27 =
      prepareV27(rawV27);

    const result =
      findBestPreparedMatch(
        v27,
        cloudbetIndex,
        threshold,
        usedCloudbetIds,
        false
      );

    if (
      result.matched &&
      result.best
    ) {

      const cb =
        result.best as
        PreparedCloudbet;

      if (
        cb.id
      ) {
        usedCloudbetIds.add(
          cb.id
        );
      }

      normalMatched.push(
        rawV27
      );

    } else {

      normalUnmatched.push(
        rawV27
      );
    }
  }

  const diagnostics:
    AnyObj[] = [];

  let potentialMatches = 0;

  let closeBelowThreshold = 0;

  let reversedCandidates = 0;

  let falsePositiveRisk = 0;

  let trueUnmatched = 0;

  let diagnosticCandidateEvaluations = 0;

  for (
    let i = 0;
    i < normalUnmatched.length;
    i++
  ) {

    const rawV27 =
      normalUnmatched[i];

    const v27 =
      prepareV27(rawV27);

    const result =
      findBestPreparedMatch(
        v27,
        cloudbetIndex,
        threshold,
        undefined,
        true
      );

    if (
      result.best
    ) {
      diagnosticCandidateEvaluations++;
    }

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
            rawV27?.id ??
            null,

          match:
            matchDisplayName(
              rawV27
            ),

          home:
            extractHome(rawV27),

          away:
            extractAway(rawV27),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.categoryHome,

          category_away:
            v27.categoryAway,

          minute:
            rawV27?.minute ??
            rawV27?.minute_display ??
            null,

          score:
            rawV27?.score ??
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
            result.best.home,

          away:
            result.best.away,

          normalized_home:
            result.best.normalizedHome,

          normalized_away:
            result.best.normalizedAway,

          category_home:
            result.best.categoryHome,

          category_away:
            result.best.categoryAway,

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
            rawV27?.id ??
            null,

          match:
            matchDisplayName(
              rawV27
            ),

          home:
            extractHome(rawV27),

          away:
            extractAway(rawV27),

          normalized_home:
            v27.normalizedHome,

          normalized_away:
            v27.normalizedAway,

          category_home:
            v27.categoryHome,

          category_away:
            v27.categoryAway,

          minute:
            rawV27?.minute ??
            rawV27?.minute_display ??
            null,

          score:
            rawV27?.score ??
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
        "PRE-NORMALIZED TEAMS + TOKEN INDEX + FAST TWO-SIDED CANDIDATE FILTER",

      diagnostic_note:
        "Diagnostic ignores used Cloudbet IDs and compares unmatched V27 matches against the indexed live Cloudbet events."
    },

    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetRaw.length,

      cloudbet_live_matches:
        cloudbetLive.length,

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

      candidate_evaluations:
        diagnosticCandidateEvaluations,

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
        "Cloudbet teams are normalized once and searched through a token index"
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
