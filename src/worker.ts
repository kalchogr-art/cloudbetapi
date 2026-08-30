// ============================================================
// CLOUDBET MATCH MATCHER V4
// V27 + CLOUDBET SERVICE BINDINGS
// READ ONLY
//
// V27      -> Flashscore live matches
// CLOUDBET -> /live
//
// NO CLOUDBET API KEY HERE
//
// V4 CHANGES:
// 1. STRICT TWO-SIDED TEAM MATCH
// 2. SINGLE-TEAM MATCH CANNOT BECOME CONFIDENT MATCH
// 3. HOME/AWAY DIRECTION CHECK
// 4. REVERSED MATCH DIAGNOSTIC
// 5. COMPETITION / COUNTRY SIGNAL WHEN AVAILABLE
// 6. CONFIDENT / POSSIBLE / TRUE UNMATCHED
// 7. FALSE POSITIVE RISK
// 8. DIAGNOSTIC MODE
// 9. READ ONLY
// 10. FAST TEAM INDEX FOR CLOUDBET
// 11. AVOID FULL MATCH MATRIX WHERE POSSIBLE
// 12. EXACT NORMALIZED TEAM MATCH GETS PRIORITY
// 13. UNIQUE CLOUDBET EVENT PROTECTION
// 14. DIAGNOSTIC COMPARES AGAINST ALL CLOUDBET EVENTS
// 15. SAME RESULT STRUCTURE COMPATIBLE WITH V3
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

  return String(
    value ?? ""
  )
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

  // France
  "psg":
    "paris saint germain",

  // Italy
  "inter":
    "inter milan",

  "inter milano":
    "inter milan",

  "internazionale":
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

  "depor":
    "deportivo",

  "dep":
    "deportivo"
};


// ============================================================
// GENERIC CLUB WORDS
// ============================================================

const GENERIC_WORDS =
  new Set<string>([

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

function normalizeTeam(
  value: any
): string {

  let s =
    normalizeText(
      value
    );

  if (!s) {
    return "";
  }

  if (
    TEAM_ALIASES[s]
  ) {
    s =
      TEAM_ALIASES[s];
  }

  let words =
    s
      .split(" ")
      .filter(Boolean)
      .filter(
        word =>
          !GENERIC_WORDS.has(
            word
          )
      );

  words =
    words.filter(
      word =>
        !/^\d+$/.test(word)
    );

  return words.join(" ").trim();
}


// ============================================================
// TEAM TOKENS
// ============================================================

function teamTokens(
  value: any
): Set<string> {

  const normalized =
    normalizeTeam(
      value
    );

  return new Set(
    normalized
      .split(" ")
      .filter(Boolean)
      .filter(
        word =>
          word.length >= 2
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

  if (A === B) {
    return 1;
  }

  if (
    A.length >= 5 &&
    B.length >= 5 &&
    (
      A.includes(B) ||
      B.includes(A)
    )
  ) {
    return 0.94;
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

      const similarity =
        tokenSimilarity(
          aToken,
          bToken
        );

      if (
        similarity > best
      ) {
        best =
          similarity;
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

    const similarity =
      tokenSimilarity(
        aTokens[0],
        bTokens[0]
      );

    if (
      similarity >= 0.90
    ) {

      score =
        Math.max(
          score,
          similarity
        );
    }
  }

  if (
    minTokens === 1 &&
    maxTokens >= 3 &&
    overlap === 0
  ) {

    score *= 0.65;
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
// COMPETITION EXTRACTION
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
    countryText(a);

  const B =
    countryText(b);

  if (!A || !B) {
    return 0;
  }

  return A === B
    ? 1
    : 0;
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
    Number(
      detail.homeScore ?? 0
    );

  const away =
    Number(
      detail.awayScore ?? 0
    );

  const total =
    Number(
      detail.total ?? 0
    );


  // ----------------------------------------------------------
  // REVERSED
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // CONFIDENT
  // ----------------------------------------------------------

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


  // ----------------------------------------------------------
  // POSSIBLE
  // ----------------------------------------------------------

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
// CLOUDbet ID
// ============================================================

function cloudbetId(
  match: AnyObj
): string {

  return String(
    match?.id ??
    match?.key ??
    ""
  );
}


// ============================================================
// BUILD CLOUDbet INDEX
//
// Instead of blindly treating every Cloudbet event as a
// candidate, create indexes using normalized home/away teams.
//
// Exact team hits become the first candidate pool.
// Full scan remains available as a fallback.
//
// This keeps correctness while reducing CPU.
// ============================================================

interface CloudbetIndex {
  home: Map<string, AnyObj[]>;
  away: Map<string, AnyObj[]>;
  team: Map<string, AnyObj[]>;
}


function addIndex(
  map: Map<string, AnyObj[]>,
  key: string,
  match: AnyObj
): void {

  if (!key) {
    return;
  }

  const current =
    map.get(key);

  if (current) {

    current.push(
      match
    );

  } else {

    map.set(
      key,
      [match]
    );
  }
}


function buildCloudbetIndex(
  matches: AnyObj[]
): CloudbetIndex {

  const index:
    CloudbetIndex = {

    home:
      new Map(),

    away:
      new Map(),

    team:
      new Map()
  };


  for (
    const match of matches
  ) {

    const home =
      normalizeTeam(
        extractHome(match)
      );

    const away =
      normalizeTeam(
        extractAway(match)
      );

    addIndex(
      index.home,
      home,
      match
    );

    addIndex(
      index.away,
      away,
      match
    );

    addIndex(
      index.team,
      home,
      match
    );

    addIndex(
      index.team,
      away,
      match
    );
  }

  return index;
}


// ============================================================
// CANDIDATE COLLECTION
// ============================================================

function getIndexedCandidates(
  v27: AnyObj,
  cloudbetMatches: AnyObj[],
  index: CloudbetIndex
): AnyObj[] {

  const home =
    normalizeTeam(
      extractHome(v27)
    );

  const away =
    normalizeTeam(
      extractAway(v27)
    );


  const candidates =
    new Map<string, AnyObj>();


  const add =
    (list: AnyObj[] | undefined) => {

      if (!list) {
        return;
      }

      for (
        const match of list
      ) {

        const id =
          cloudbetId(match);

        const key =
          id ||
          `${extractHome(match)}|${extractAway(match)}`;

        candidates.set(
          key,
          match
        );
      }
    };


  // Normal direction.
  add(
    index.home.get(
      home
    )
  );

  add(
    index.away.get(
      away
    )
  );


  // Reversed direction.
  add(
    index.away.get(
      home
    )
  );

  add(
    index.home.get(
      away
    )
  );


  // If exact normalized keys produced nothing,
  // fall back to the complete Cloudbet list.
  //
  // This preserves fuzzy matching for spelling,
  // abbreviations and aliases.
  if (
    candidates.size === 0
  ) {

    return cloudbetMatches;
  }


  return [
    ...candidates.values()
  ];
}


// ============================================================
// FIND BEST MATCH
// ============================================================

function findBestMatch(
  v27: AnyObj,
  cloudbetMatches: AnyObj[],
  threshold: number,
  usedIds?: Set<string>,
  ignoreUsed = false,
  index?: CloudbetIndex
) {

  const candidatePool =
    index
      ? getIndexedCandidates(
          v27,
          cloudbetMatches,
          index
        )
      : cloudbetMatches;


  let best:
    AnyObj | null = null;

  let bestDetail:
    AnyObj | null = null;

  let bestScore = 0;


  for (
    const cb of candidatePool
  ) {

    const cbId =
      cloudbetId(cb);


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
    match?.live === true
  ) {
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
          method:
            "GET",

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
// BUILD UNMATCHED RECORD
// ============================================================

function buildUnmatchedRecord(
  v27: AnyObj,
  result: AnyObj,
  threshold: number,
  index: number
) {

  if (
    !result.best ||
    !result.detail
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
    };
  }


  const detail =
    result.detail;


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
          detail.total.toFixed(3)
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
    },


    threshold,

    gap_to_threshold:
      Number(
        Math.max(
          0,
          threshold -
          detail.total
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


  // ==========================================================
  // EXTRACT
  // ==========================================================

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


  // ==========================================================
  // INDEX
  // ==========================================================

  const cloudbetIndex =
    buildCloudbetIndex(
      cloudbetMatches
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


  const usedCloudbetIds =
    new Set<string>();


  // ==========================================================
  // PROCESS
  // ==========================================================

  for (
    const v27 of v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        usedCloudbetIds,
        false,
        cloudbetIndex
      );


    // --------------------------------------------------------
    // CONFIDENT
    // --------------------------------------------------------

    if (
      result.matched &&
      result.best
    ) {

      const cbId =
        cloudbetId(
          result.best
        );


      if (cbId) {

        usedCloudbetIds.add(
          cbId
        );
      }


      matches.push({

        ...buildMatchRecord(
          v27,
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


    // --------------------------------------------------------
    // DIAGNOSTIC CLASSIFICATIONS
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
          v27,
          result,
          threshold,
          unmatched.length
        )
      );

      continue;
    }


    // --------------------------------------------------------
    // NO CANDIDATE
    // --------------------------------------------------------

    unmatched.push(
      buildUnmatchedRecord(
        v27,
        result,
        threshold,
        unmatched.length
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
      "V4",

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

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + TOKEN FUZZY + ALIAS + OPTIONAL COMPETITION/COUNTRY SIGNAL",

      optimization:
        "CLOUDBET TEAM INDEX + PARALLEL SERVICE FETCH"
    },


    stats: {

      v27_matches:
        v27Matches.length,

      cloudbet_live_matches:
        cloudbetMatches.length,

      confident_matched:
        matches.length,

      possible_matches:
        possibleMatches.length,

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


  // ==========================================================
  // LOAD IN PARALLEL
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


  const cloudbetMatches =
    extractCloudbetMatches(
      cloudbetData
    )
      .filter(
        isCloudbetLive
      );


  const cloudbetIndex =
    buildCloudbetIndex(
      cloudbetMatches
    );


  // ==========================================================
  // NORMAL MATCH FIRST
  // ==========================================================

  const usedCloudbetIds =
    new Set<string>();


  const normalMatched:
    AnyObj[] = [];


  const normalUnmatched:
    AnyObj[] = [];


  for (
    const v27 of v27Matches
  ) {

    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        usedCloudbetIds,
        false,
        cloudbetIndex
      );


    if (
      result.matched &&
      result.best
    ) {

      const cbId =
        cloudbetId(
          result.best
        );


      if (cbId) {

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
  // DIAGNOSTIC
  //
  // IMPORTANT:
  // used Cloudbet IDs are ignored.
  //
  // Every unmatched V27 event gets compared against
  // the complete live Cloudbet pool.
  //
  // This is intentionally more expensive than /match.
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
    i < normalUnmatched.length;
    i++
  ) {

    const v27 =
      normalUnmatched[i];


    // Diagnostic deliberately uses ALL Cloudbet events.
    const result =
      findBestMatch(
        v27,
        cloudbetMatches,
        threshold,
        undefined,
        true,
        undefined
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


      switch (
        classification.classification
      ) {

        case "POSSIBLE_MATCH":
          potentialMatches++;
          break;

        case "CLOSE_BELOW_THRESHOLD":
          closeBelowThreshold++;
          break;

        case "REVERSED_CANDIDATE":
          reversedCandidates++;
          break;

        case "FALSE_POSITIVE_RISK":
          falsePositiveRisk++;
          break;

        case "TRUE_UNMATCHED":
          trueUnmatched++;
          break;
      }


      diagnostics.push({

        index:
          i,

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
    (
      a,
      b
    ) =>
      Number(
        b?.scoring?.total ?? 0
      ) -
      Number(
        a?.scoring?.total ?? 0
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
      "V4",

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
        "STRICT TWO-SIDED TEAM NORMALIZATION + TOKEN FUZZY + ALIAS + OPTIONAL COMPETITION/COUNTRY SIGNAL",

      diagnostic_note:
        "Diagnostic ignores used Cloudbet IDs and compares every unmatched V27 match against every live Cloudbet event.",

      optimization_note:
        "Normal matching uses a Cloudbet team index. Diagnostic intentionally performs the full comparison."
    },


    stats: {

      v27_matches:
        v27Matches.length,

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
      "V4",

    mode:
      "READ ONLY",


    bindings: {

      V27:
        true,

      CLOUDBET:
        true
    },


    matcher:
      "V4 STRICT TWO-SIDED MATCH",


    rules: {

      confident:
        "Both teams >= 0.78 and total >= 0.80",

      possible:
        "Both teams >= 0.60 and total >= 0.72",

      false_positive:
        "One team strong while the other is weak",

      reversed:
        "Home/Away reversed candidates are separately classified",

      unique:
        "One Cloudbet event can be assigned to only one confident V27 match",

      optimization:
        "Indexed Cloudbet candidates + parallel V27/Cloudbet loading"
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
            "V4",

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
