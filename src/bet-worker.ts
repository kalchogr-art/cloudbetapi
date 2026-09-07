// ============================================================
// CLOUDBET MATCH MATCHER V7.4.2
// FAST HUNTER + SEPARATE EVENT DISCOVERY / ODDS LOOKUP
// LIVE + 1H + 0:0 + CLOSE MINUTE FILTER
// V27 SERVICE BINDING + DIRECT CLOUDBET PUBLIC SPORTS API
// READ ONLY
//
// FEATURES:
// - /live
//   -> current Cloudbet LIVE soccer
//   -> only 1H + 0:0
//   -> exact 1H Over 0.5 odds
//
// - /match?signals=...
//   -> FAST_HUNTER mode
//   -> DOES NOT fetch/process V27
//   -> discovers ALL live soccer WITHOUT market filter
//   -> Cloudbet candidates then filtered to:
//      LIVE + 1H + 0:0 + valid minute
//   -> per Hunter signal: only candidates within +/-5 minutes
//   -> then strict two-sided team matching
//   -> aliases + fuzzy + category protection
//   -> only CONFIDENT_MATCH => secure_match=true
//   -> preserves event_id even when odds are unavailable
//   -> exact 1H Over 0.5 odds queried separately AFTER match
//
// - /diagnostic
//   -> light V27 + Cloudbet diagnostic
//
// READ ONLY:
// - no login
// - no auth
// - no cookies
// - no POST to Cloudbet
// - no betting
// - no orders
// ============================================================

interface Env {
  V27: Fetcher;
}

type AnyObj = Record<string, any>;

const VERSION =
  "V7.4.2-GENERAL-DISTINCTIVE-TOKEN-MATCH";

const DEFAULT_THRESHOLD =
  0.45;

const STRONG_TEAM_SCORE =
  0.78;

const POSSIBLE_TEAM_SCORE =
  0.60;

const POSSIBLE_TOTAL_SCORE =
  0.72;

const CONFIDENT_TOTAL_SCORE =
  0.80;

const REVERSED_CONFIDENT_SCORE =
  0.90;

const WEAK_SIDE_LIMIT =
  0.50;

const COMPETITION_BONUS =
  0.05;

const COUNTRY_BONUS =
  0.02;

const MATCH_MINUTE_TOLERANCE =
  5;


// ============================================================
// CLOUDBET DIRECT ODDS READER
// ============================================================

const CLOUDBET_BASE =
  "https://www.cloudbet.com";

const SPORTS_BASE =
  "/sports-api/c/v6/sports";

const ODDS_MARKET =
  "soccer.total_goals_period_first_half";

const ODDS_SUBMARKET =
  "period=1h";

const ODDS_OUTCOME =
  "over";

const ODDS_PARAMS =
  "total=0.5";

const LIVE_LIMIT =
  100;

const CLOUDBET_TIMEOUT_MS =
  8000;


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
// NORMALIZATION
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
// ALIASES
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
    "deportivo",

  "oster":
    "osters",

  "osters":
    "osters",

  "osters if":
    "osters",

  "floridsdorfer ac":
    "fac wien",

  "floridsdorfer":
    "fac wien",

  "fac wien":
    "fac wien",

  "bregenz":
    "schwarz weiss bregenz",

  "sw bregenz":
    "schwarz weiss bregenz",

  "schwarz weiss bregenz":
    "schwarz weiss bregenz",

  // Bulgaria
  "dunav ruse":
    "dunav 2010",

  "dunav 2010":
    "dunav 2010",

  "fc dunav 2010":
    "dunav 2010",

  "fc dunav ruse":
    "dunav 2010",

  "slavia sofia":
    "slavia sofia",

  "pfc slavia sofia":
    "slavia sofia"
};


const GENERIC_WORDS =
  new Set([
    "fc",
    "pfc",
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


const WEAK_TEAM_TOKENS =
  new Set([
    "city",
    "united",
    "athletic",
    "sporting",
    "racing",
    "real",
    "deportivo",
    "olympic",
    "olympique"
  ]);


// ============================================================
// TEAM NORMALIZATION
// ============================================================

function applyAlias(
  value: string
): string {

  return (
    TEAM_ALIASES[value] ??
    value
  );
}


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

  s =
    applyAlias(
      s
    );

  const tokens =
    s
      .split(" ")
      .filter(Boolean)
      .map(
        token =>
          TEAM_ALIASES[token] ??
          token
      )
      .filter(
        token =>
          !GENERIC_WORDS.has(
            token
          )
      );

  s =
    tokens.join(" ");

  s =
    applyAlias(
      s
    );

  return s;
}


function teamTokens(
  value: any
): string[] {

  return normalizeTeam(
    value
  )
    .split(" ")
    .filter(Boolean);
}


// ============================================================
// CATEGORY PROTECTION
// ============================================================

function teamCategory(
  value: any
): string {

  const s =
    normalizeText(
      value
    );

  if (
    /\bu\s*\d{2}\b/.test(
      s
    )
  ) {
    return (
      s.match(
        /\bu\s*(\d{2})\b/
      )?.[1] ??
      ""
    )
      ? "U" +
        (
          s.match(
            /\bu\s*(\d{2})\b/
          )?.[1] ??
          ""
        )
      : "";
  }

  if (
    /\bwomen\b|\bw\b/.test(
      s
    )
  ) {
    return "WOMEN";
  }

  if (
    /\breserve\b|\breserves\b|\bii\b|\b2\b/.test(
      s
    )
  ) {
    return "RESERVE";
  }

  return "SENIOR";
}


function categoryCompatible(
  a: any,
  b: any
): boolean {

  const ca =
    teamCategory(
      a
    );

  const cb =
    teamCategory(
      b
    );

  if (
    ca === "SENIOR" ||
    cb === "SENIOR"
  ) {
    return true;
  }

  return ca === cb;
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
    new Array(
      b.length + 1
    );

  const curr =
    new Array(
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

    curr[0] = i;

    for (
      let j = 1;
      j <= b.length;
      j++
    ) {

      const cost =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;

      curr[j] =
        Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
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


function tokenSimilarity(
  a: string,
  b: string
): number {

  if (
    !a ||
    !b
  ) {
    return 0;
  }

  if (
    a === b
  ) {
    return 1;
  }

  if (
    a.length >= 4 &&
    b.length >= 4 &&
    (
      a.includes(b) ||
      b.includes(a)
    )
  ) {

    return (
      Math.min(
        a.length,
        b.length
      ) /
      Math.max(
        a.length,
        b.length
      )
    );
  }

  const distance =
    levenshtein(
      a,
      b
    );

  return Math.max(
    0,
    1 -
      distance /
      Math.max(
        a.length,
        b.length
      )
  );
}


// ============================================================
// DISTINCTIVE TOKEN BRIDGE
// ============================================================
//
// General abbreviation protection.
//
// Examples that may receive the bridge:
//   Atletico Colina <-> AC Colina
//   SC Freiburg     <-> Freiburg
//   CD Example      <-> Example
//
// The bridge is intentionally NOT allowed for weak/common tokens
// such as city, united, sporting, real, deportivo, etc.
//
// It does not by itself create a match. classifyMatch() still
// requires a strong TWO-SIDED match and all existing live/category/
// minute protections remain active.
// ============================================================

function distinctiveSingleTokenBridge(
  aTokens: string[],
  bTokens: string[]
): number | null {

  const shorter =
    aTokens.length <= bTokens.length
      ? aTokens
      : bTokens;

  const longer =
    aTokens.length <= bTokens.length
      ? bTokens
      : aTokens;

  if (
    shorter.length !== 1 ||
    longer.length < 2
  ) {
    return null;
  }

  const token =
    shorter[0];

  if (
    !token ||
    token.length < 4 ||
    WEAK_TEAM_TOKENS.has(token)
  ) {
    return null;
  }

  if (
    !longer.includes(token)
  ) {
    return null;
  }

  // A unique, exact, meaningful token is a strong abbreviation bridge,
  // but deliberately below an exact full-name match.
  return 0.88;
}


// ============================================================
// TEAM SCORE
// ============================================================

function teamScore(
  a: any,
  b: any
): number {

  const A =
    normalizeTeam(
      a
    );

  const B =
    normalizeTeam(
      b
    );

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

  if (
    !categoryCompatible(
      a,
      b
    )
  ) {
    return 0;
  }

  const aTokens =
    A.split(" ")
      .filter(Boolean);

  const bTokens =
    B.split(" ")
      .filter(Boolean);

  if (
    !aTokens.length ||
    !bTokens.length
  ) {
    return 0;
  }

  const distinctiveBridge =
    distinctiveSingleTokenBridge(
      aTokens,
      bTokens
    );

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
          !/^u\d{2}$/.test(
            token
          ) &&
          token !==
            "reserve" &&
          token !==
            "women" &&
          !/^team[234]$/.test(
            token
          )
      );

    if (
      !meaningfulExtra.length
    ) {
      return 0.97;
    }
  }

  let fuzzy = 0;
  let exact = 0;

  for (
    const aToken
    of aTokens
  ) {

    let best = 0;

    for (
      const bToken
      of bTokens
    ) {

      if (
        aToken ===
        bToken
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
    }
    else if (
      best >= 0.75
    ) {
      fuzzy +=
        best * 0.65;
    }
  }

  for (
    const token
    of aTokens
  ) {

    if (
      bTokens.includes(
        token
      )
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
        bTokens.includes(
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

  if (
    distinctiveBridge !== null
  ) {
    score =
      Math.max(
        score,
        distinctiveBridge
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
    const separator
    of separators
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
    const value
    of fields
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
    competitionText(
      a
    );

  const B =
    competitionText(
      b
    );

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
    const word
    of aWords
  ) {
    if (
      bWords.has(
        word
      )
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


function countrySimilarity(
  a: AnyObj,
  b: AnyObj
): number {

  const A =
    countryText(
      a
    );

  const B =
    countryText(
      b
    );

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
// SCORE
// ============================================================

function detailedMatchScore(
  v27: AnyObj,
  cb: AnyObj
): AnyObj {

  const vHome =
    extractHome(
      v27
    );

  const vAway =
    extractAway(
      v27
    );

  const cHome =
    extractHome(
      cb
    );

  const cAway =
    extractAway(
      cb
    );

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
// CLASSIFY
// ============================================================

function classifyMatch(
  detail: AnyObj,
  threshold: number
): AnyObj {

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
      detail.reverseHomeScore >=
        REVERSED_CONFIDENT_SCORE &&
      detail.reverseAwayScore >=
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

  if (
    (
      home >= 0.80 &&
      away <
        WEAK_SIDE_LIMIT
    ) ||
    (
      away >= 0.80 &&
      home <
        WEAK_SIDE_LIMIT
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
}


function prepareMatch(
  match: AnyObj
): PreparedMatch {

  const home =
    extractHome(
      match
    ) ?? "";

  const away =
    extractAway(
      match
    ) ?? "";

  return {
    raw:
      match,

    id:
      String(
        match?.id ??
        match?.event_id ??
        match?.key ??
        ""
      ),

    home,
    away,

    normalizedHome:
      normalizeTeam(
        home
      ),

    normalizedAway:
      normalizeTeam(
        away
      ),

    homeTokens:
      teamTokens(
        home
      ),

    awayTokens:
      teamTokens(
        away
      )
  };
}


// ============================================================
// CLOUDBET LIVE DETECTION
// ============================================================

function isCloudbetLive(
  match: AnyObj
): boolean {

  const status =
    String(
      match?.status ??
      ""
    )
      .trim()
      .toUpperCase();

  if (
    status ===
      "TRADING_LIVE" ||
    status ===
      "LIVE" ||
    status.includes(
      "LIVE"
    )
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
// NUMBER
// ============================================================

function numericOrNull(
  value: any
): number | null {

  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    )
  ) {
    return value;
  }

  if (
    typeof value ===
      "string" &&
    value.trim() !==
      ""
  ) {

    const number =
      Number(
        value
      );

    if (
      Number.isFinite(
        number
      )
    ) {
      return number;
    }
  }

  return null;
}


// ============================================================
// HUNTER LIVE STATE FILTER
// LIVE + 1H + 0:0 + CLOSE MINUTE
// ============================================================

function parseMatchMinute(
  value: any
): number | null {

  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    )
  ) {
    return Math.floor(
      value
    );
  }

  const text =
    String(
      value ?? ""
    ).trim();

  if (!text) {
    return null;
  }

  const match =
    text.match(
      /^(\d{1,3})/
    );

  if (!match) {
    return null;
  }

  const minute =
    Number(
      match[1]
    );

  return Number.isFinite(
    minute
  )
    ? minute
    : null;
}


function cloudbetMinute(
  event: AnyObj
): number | null {

  return parseMatchMinute(
    event?.metadata
      ?.eventTimeExtended ??
    event?.metadata
      ?.eventTime ??
    event?.minute_extended ??
    event?.minute ??
    null
  );
}


function hunterReferenceMinute(
  signal: AnyObj
): number | null {

  return parseMatchMinute(
    signal?.current_minute ??
    signal?.minute ??
    signal?.entry_minute ??
    null
  );
}


function isCloudbetFirstHalf(
  event: AnyObj
): boolean {

  const status =
    String(
      event?.metadata
        ?.eventStatus ??
      event?.event_status ??
      ""
    )
      .trim()
      .toLowerCase();

  return (
    status === "1p" ||
    status === "1h" ||
    status === "first_half" ||
    status === "first half"
  );
}


// ============================================================
// CLOUD BET SCORE
// ============================================================

function cloudbetScore(
  score: any
): AnyObj | null {

  if (
    !Array.isArray(
      score
    ) ||
    score.length < 2
  ) {
    return null;
  }

  return {
    home:
      numericOrNull(
        score[0]
      ),

    away:
      numericOrNull(
        score[1]
      )
  };
}


function isCloudbetZeroZero(
  event: AnyObj
): boolean {

  const score =
    cloudbetScore(
      event?.metadata
        ?.score
    );

  return (
    score !== null &&
    score.home === 0 &&
    score.away === 0
  );
}


function isHunterEligibleCloudbetEvent(
  event: AnyObj
): boolean {

  if (
    !isCloudbetLive(
      event
    )
  ) {
    return false;
  }

  if (
    !isCloudbetFirstHalf(
      event
    )
  ) {
    return false;
  }

  if (
    !isCloudbetZeroZero(
      event
    )
  ) {
    return false;
  }

  if (
    cloudbetMinute(
      event
    ) === null
  ) {
    return false;
  }

  return true;
}


function minuteDifference(
  signal: AnyObj,
  event: AnyObj
): number | null {

  const hunterMinute =
    hunterReferenceMinute(
      signal
    );

  const cbMinute =
    cloudbetMinute(
      event
    );

  if (
    hunterMinute === null ||
    cbMinute === null
  ) {
    return null;
  }

  return Math.abs(
    hunterMinute -
    cbMinute
  );
}


function minuteCompatible(
  signal: AnyObj,
  event: AnyObj
): boolean {

  const difference =
    minuteDifference(
      signal,
      event
    );

  if (
    difference === null
  ) {
    return false;
  }

  return (
    difference <=
    MATCH_MINUTE_TOLERANCE
  );
}


// ============================================================
// CLOUDBET HTTP GET
// ============================================================

async function fetchCloudbetJson(
  url: string
): Promise<any> {

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      CLOUDBET_TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          signal:
            controller.signal,

          headers: {
            accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {

      return {
        ok: false,

        status:
          response.status,

        error:
          `HTTP_${response.status}`,

        data:
          null
      };
    }

    const data =
      await response.json();

    return {
      ok: true,

      status:
        response.status,

      error:
        null,

      data
    };

  } catch (
    error: any
  ) {

    return {
      ok: false,

      status:
        0,

      error:
        error?.name ===
          "AbortError"
          ? "TIMEOUT"
          : error?.message ||
            String(error),

      data:
        null
    };

  } finally {

    clearTimeout(
      timeout
    );
  }
}


// ============================================================
// DIRECT CLOUDBET LIVE EVENTS
// sports[].competitions[].events[]
// ============================================================

async function getDirectCloudbetLive(
  includeOddsMarket = false
): Promise<AnyObj[]> {

  const url =
    new URL(
      SPORTS_BASE +
      "/events",
      CLOUDBET_BASE
    );

  url.searchParams.set(
    "sports",
    "soccer"
  );

  // V7.4.1:
  // Event discovery MUST NOT depend on odds/market availability.
  // Only the separate odds lookup uses markets=ODDS_MARKET.
  if (
    includeOddsMarket
  ) {
    url.searchParams.set(
      "markets",
      ODDS_MARKET
    );
  }

  url.searchParams.set(
    "live",
    "true"
  );

  url.searchParams.set(
    "limit",
    String(
      LIVE_LIMIT
    )
  );

  url.searchParams.set(
    "locale",
    "en"
  );

  const result =
    await fetchCloudbetJson(
      url.toString()
    );

  if (!result.ok) {

    throw new Error(
      result.error ||
      `CLOUDBET_HTTP_${result.status}`
    );
  }

  const events:
    AnyObj[] = [];

  const sports =
    Array.isArray(
      result.data?.sports
    )
      ? result.data.sports
      : [];

  for (
    const sport
    of sports
  ) {

    const competitions =
      Array.isArray(
        sport?.competitions
      )
        ? sport.competitions
        : [];

    for (
      const competition
      of competitions
    ) {

      const competitionEvents =
        Array.isArray(
          competition?.events
        )
          ? competition.events
          : [];

      for (
        const event
        of competitionEvents
      ) {

        events.push({
          ...event,

          sport:
            event?.sport ??
            {
              name:
                sport?.name ??
                null,

              key:
                sport?.key ??
                null
            },

          competition:
            event?.competition ??
            {
              name:
                competition?.name ??
                null,

              key:
                competition?.key ??
                null
            }
        });
      }
    }
  }

  return events;
}


// ============================================================
// EXACT:
// markets[ODDS_MARKET]
// -> submarkets["period=1h"]
// -> selections[]
// -> over + total=0.5
// ============================================================

function extractOver05(
  event: AnyObj
): AnyObj | null {

  const market =
    event?.markets?.[
      ODDS_MARKET
    ];

  if (!market) {
    return null;
  }

  const submarket =
    market?.submarkets?.[
      ODDS_SUBMARKET
    ];

  if (!submarket) {
    return null;
  }

  const selections =
    Array.isArray(
      submarket?.selections
    )
      ? submarket.selections
      : [];

  const selection =
    selections.find(
      (
        item: AnyObj
      ) =>
        String(
          item?.outcome ??
          ""
        )
          .toLowerCase()
          .trim() ===
          ODDS_OUTCOME &&
        String(
          item?.params ??
          ""
        )
          .toLowerCase()
          .replace(
            /\s+/g,
            ""
          )
          .trim() ===
          ODDS_PARAMS
    );

  if (!selection) {
    return null;
  }

  const price =
    numericOrNull(
      selection?.price
    );

  const status =
    selection?.status ??
    null;

  return {
    market:
      ODDS_MARKET,

    submarket:
      ODDS_SUBMARKET,

    outcome:
      selection?.outcome ??
      null,

    params:
      selection?.params ??
      null,

    price,

    raw_price:
      numericOrNull(
        selection?.rawPrice ??
        selection?.raw_price ??
        selection?.price
      ),

    status,

    min_stake:
      numericOrNull(
        selection?.minStake
      ),

    max_stake:
      numericOrNull(
        selection?.maxStake
      ),

    probability:
      numericOrNull(
        selection?.probability
      ),

    market_url:
      selection?.marketUrl ??
      null,

    available:
      status ===
        "SELECTION_ENABLED" &&
      price !== null &&
      price > 1
  };
}


// ============================================================
// EVENT NAME
// ============================================================

function matchDisplayName(
  match: AnyObj
): string {

  const home =
    extractHome(
      match
    );

  const away =
    extractAway(
      match
    );

  return (
    match?.match ??
    match?.name ??
    `${home ?? ""} - ${away ?? ""}`
  );
}


// ============================================================
// CLOUDBET EVENT ID
// ============================================================

function cloudbetEventId(
  event: AnyObj
): string | null {

  const value =
    event?.event_id ??
    event?.id ??
    null;

  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const id =
    String(
      value
    ).trim();

  return id || null;
}


function buildOddsEventMap(
  events: AnyObj[]
): Map<string, AnyObj> {

  const map =
    new Map<
      string,
      AnyObj
    >();

  for (
    const event
    of events
  ) {

    const id =
      cloudbetEventId(
        event
      );

    if (!id) {
      continue;
    }

    map.set(
      id,
      event
    );
  }

  return map;
}


// ============================================================
// LIVE DISPLAY RECORD
// ============================================================

function buildCloudbetLiveRecord(
  event: AnyObj,
  oddsEvent: AnyObj | null = null
): AnyObj {

  const odds =
    extractOver05(
      oddsEvent ??
      event
    );

  return {
    event_id:
      String(
        event?.id ??
        event?.event_id ??
        ""
      ),

    match:
      matchDisplayName(
        event
      ),

    home:
      extractHome(
        event
      ),

    away:
      extractAway(
        event
      ),

    competition:
      event?.competition ??
      null,

    status:
      event?.status ??
      null,

    event_status:
      event?.metadata
        ?.eventStatus ??
      null,

    minute:
      event?.metadata
        ?.eventTime ??
      null,

    minute_extended:
      event?.metadata
        ?.eventTimeExtended ??
      null,

    parsed_minute:
      cloudbetMinute(
        event
      ),

    score:
      cloudbetScore(
        event?.metadata
          ?.score
      ),

    odds:
      odds
        ? {
            market:
              ODDS_MARKET,

            selection:
              "OVER 0.5",

            period:
              "1H",

            price:
              odds.price,

            raw_price:
              odds.raw_price,

            available:
              odds.available,

            selection_status:
              odds.status,

            min_stake:
              odds.min_stake,

            max_stake:
              odds.max_stake,

            probability:
              odds.probability,

            market_url:
              odds.market_url
          }
        : null
  };
}


// ============================================================
// V27 SERVICE FETCH
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
        400
      )}`
    );
  }

  try {
    return JSON.parse(
      text
    );
  }
  catch {
    throw new Error(
      `Invalid JSON from ${path}`
    );
  }
}


// ============================================================
// SIGNAL NORMALIZATION
// ============================================================

function normalizeHunterSignal(
  item: AnyObj
): AnyObj | null {

  const signal =
    item?.signal &&
    typeof item.signal ===
      "object" &&
    !Array.isArray(
      item.signal
    )
      ? item.signal
      : item;

  if (
    !signal ||
    typeof signal !==
      "object"
  ) {
    return null;
  }

  const split =
    splitMatchName(
      signal?.match ??
      signal?.match_name ??
      signal?.name ??
      ""
    );

  const home =
    String(
      signal?.home ??
      signal?.homeTeam ??
      signal?.home_name ??
      split.home ??
      ""
    ).trim();

  const away =
    String(
      signal?.away ??
      signal?.awayTeam ??
      signal?.away_name ??
      split.away ??
      ""
    ).trim();

  if (
    !home ||
    !away
  ) {
    return null;
  }

  return {
    ...signal,

    type:
      signal?.type ??
      signal?.signal ??
      "HUNTER_ENTRY",

    match:
      signal?.match ??
      signal?.match_name ??
      `${home} - ${away}`,

    match_id:
      signal?.match_id ??
      signal?.id ??
      null,

    home,
    away,

    entry_minute:
      signal?.entry_minute ??
      null,

    current_minute:
      signal?.current_minute ??
      null,

    period:
      signal?.period ??
      null,

    hunter_score:
      signal?.hunter_score ??
      null
  };
}


function parseSignalsParam(
  request: Request
): {
  rawPresent: boolean;
  signals: AnyObj[];
} {

  const url =
    new URL(
      request.url
    );

  const value =
    url.searchParams.get(
      "signals"
    );

  if (
    value === null
  ) {
    return {
      rawPresent:
        false,
      signals:
        []
    };
  }

  try {

    const parsed =
      JSON.parse(
        value
      );

    if (
      !Array.isArray(
        parsed
      )
    ) {

      return {
        rawPresent:
          true,
        signals:
          []
      };
    }

    return {
      rawPresent:
        true,

      signals:
        parsed
          .map(
            normalizeHunterSignal
          )
          .filter(
            Boolean
          ) as AnyObj[]
    };
  }
  catch {

    return {
      rawPresent:
        true,
      signals:
        []
    };
  }
}


// ============================================================
// FAST CANDIDATE INDEX
// ============================================================

function buildTokenIndex(
  cloudbet: PreparedMatch[]
): Map<string, number[]> {

  const index =
    new Map<
      string,
      number[]
    >();

  for (
    let i = 0;
    i <
      cloudbet.length;
    i++
  ) {

    const tokens =
      new Set([
        ...cloudbet[i]
          .homeTokens,
        ...cloudbet[i]
          .awayTokens
      ]);

    for (
      const token
      of tokens
    ) {

      if (
        !token ||
        token.length < 3
      ) {
        continue;
      }

      const list =
        index.get(
          token
        );

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


function candidateIndexesForSignal(
  signal: PreparedMatch,
  tokenIndex:
    Map<string, number[]>,
  cloudbetCount: number
): number[] {

  const set =
    new Set<number>();

  const tokens =
    new Set([
      ...signal.homeTokens,
      ...signal.awayTokens
    ]);

  for (
    const token
    of tokens
  ) {

    if (
      !token ||
      token.length < 3
    ) {
      continue;
    }

    const rows =
      tokenIndex.get(
        token
      );

    if (!rows) {
      continue;
    }

    for (
      const index
      of rows
    ) {
      set.add(index);
    }
  }

  // Important:
  // If name tokens fail because names are very different,
  // evaluate the already-small LIVE+1H+0:0 list.
  if (
    set.size === 0
  ) {

    for (
      let i = 0;
      i <
        cloudbetCount;
      i++
    ) {
      set.add(i);
    }
  }

  return [
    ...set
  ];
}


// ============================================================
// HUNTER MATCH
// ============================================================

function scoringRecord(
  detail: AnyObj
): AnyObj {

  return {
    total:
      Number(
        detail.total
          .toFixed(3)
      ),

    base_score:
      Number(
        detail.baseScore
          .toFixed(3)
      ),

    home_score:
      Number(
        detail.homeScore
          .toFixed(3)
      ),

    away_score:
      Number(
        detail.awayScore
          .toFixed(3)
      ),

    reverse_home_score:
      Number(
        detail.reverseHomeScore
          .toFixed(3)
      ),

    reverse_away_score:
      Number(
        detail.reverseAwayScore
          .toFixed(3)
      ),

    direction:
      detail.direction,

    competition_score:
      Number(
        detail.competitionScore
          .toFixed(3)
      ),

    country_score:
      Number(
        detail.countryScore
          .toFixed(3)
      )
  };
}


function findHunterTargetMatch(
  signal: AnyObj,
  cloudbet:
    PreparedMatch[],
  tokenIndex:
    Map<string, number[]>,
  threshold: number
): AnyObj {

  const target =
    prepareMatch({
      id:
        signal?.match_id ??
        "",

      home:
        signal?.home ??
        "",

      away:
        signal?.away ??
        "",

      match:
        signal?.match ??
        `${signal?.home ?? ""} - ${signal?.away ?? ""}`,

      competition:
        signal?.competition ??
        signal?.league ??
        null,

      country:
        signal?.country ??
        null
    });

  if (
    !target.home ||
    !target.away
  ) {

    return {
      found:
        false,

      best:
        null,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "HUNTER_SIGNAL_MISSING_HOME_OR_AWAY",

      candidateEvaluations:
        0,

      candidates:
        0,

      minuteCandidates:
        0,

      targetMinute:
        hunterReferenceMinute(
          signal
        ),

      bestMinute:
        null,

      bestMinuteDifference:
        null
    };
  }

  const targetMinute =
    hunterReferenceMinute(
      signal
    );

  if (
    targetMinute === null
  ) {

    return {
      found:
        false,

      best:
        null,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        "HUNTER_SIGNAL_MINUTE_MISSING",

      candidateEvaluations:
        0,

      candidates:
        0,

      minuteCandidates:
        0,

      targetMinute:
        null,

      bestMinute:
        null,

      bestMinuteDifference:
        null
    };
  }

  const candidates =
    candidateIndexesForSignal(
      target,
      tokenIndex,
      cloudbet.length
    );

  let best:
    PreparedMatch | null =
    null;

  let bestDetail:
    AnyObj | null =
    null;

  let bestScore =
    -1;

  let candidateEvaluations =
    0;

  let minuteCandidates =
    0;

  let bestMinute:
    number | null =
    null;

  let bestMinuteDifference:
    number | null =
    null;

  for (
    const index
    of candidates
  ) {

    const cb =
      cloudbet[index];

    if (!cb) {
      continue;
    }

    // HARD FILTER:
    // candidate must be within +/-5 minutes
    // of the Hunter current/entry minute.
    if (
      !minuteCompatible(
        signal,
        cb.raw
      )
    ) {
      continue;
    }

    minuteCandidates++;
    candidateEvaluations++;

    const detail =
      detailedMatchScore(
        target.raw,
        cb.raw
      );

    if (
      detail.total >
      bestScore
    ) {

      best =
        cb;

      bestDetail =
        detail;

      bestScore =
        detail.total;

      bestMinute =
        cloudbetMinute(
          cb.raw
        );

      bestMinuteDifference =
        minuteDifference(
          signal,
          cb.raw
        );
    }
  }

  if (
    !best ||
    !bestDetail
  ) {

    return {
      found:
        false,

      best:
        null,

      detail:
        null,

      classification:
        "TRUE_UNMATCHED",

      reason:
        minuteCandidates === 0
          ? "NO_CLOUDBET_CANDIDATE_WITHIN_MINUTE_WINDOW"
          : "NO_VALID_CLOUDBET_CANDIDATE",

      candidateEvaluations,

      candidates:
        candidates.length,

      minuteCandidates,

      targetMinute,

      bestMinute:
        null,

      bestMinuteDifference:
        null
    };
  }

  const classification =
    classifyMatch(
      bestDetail,
      threshold
    );

  return {
    found:
      classification
        .classification ===
      "CONFIDENT_MATCH",

    best,

    detail:
      bestDetail,

    classification:
      classification
        .classification,

    reason:
      classification.reason,

    candidateEvaluations,

    candidates:
      candidates.length,

    minuteCandidates,

    targetMinute,

    bestMinute,

    bestMinuteDifference
  };
}


// ============================================================
// FAST HUNTER MODE
// ============================================================

async function runFastHunter(
  env: Env,
  request: Request,
  signals: AnyObj[],
  threshold: number
): Promise<Response> {

  const started =
    Date.now();

  // ==========================================================
  // STEP 1 — DISCOVER EVENTS
  // IMPORTANT:
  // NO markets= filter here.
  // A missing/disabled O0.5 market must NEVER hide the match.
  // ==========================================================

  const discoveryStarted =
    Date.now();

  const rawCloudbet =
    await getDirectCloudbetLive(
      false
    );

  const cloudbetDiscoveryMs =
    Date.now() -
    discoveryStarted;

  // HARD PRE-FILTER:
  // LIVE + FIRST HALF + 0:0 + valid minute.
  const cloudbetLive =
    rawCloudbet.filter(
      isHunterEligibleCloudbetEvent
    );

  const prepareStarted =
    Date.now();

  const preparedCloudbet =
    cloudbetLive.map(
      prepareMatch
    );

  const tokenIndex =
    buildTokenIndex(
      preparedCloudbet
    );

  const prepareMs =
    Date.now() -
    prepareStarted;


  // ==========================================================
  // STEP 2 — MATCH HUNTER SIGNALS TO EVENTS
  // Still NO odds dependency.
  // ==========================================================

  const matchStarted =
    Date.now();

  const matchedRows:
    {
      signal: AnyObj;
      result: AnyObj;
    }[] = [];

  let totalCandidateEvaluations =
    0;

  for (
    const signal
    of signals
  ) {

    const result =
      findHunterTargetMatch(
        signal,
        preparedCloudbet,
        tokenIndex,
        threshold
      );

    totalCandidateEvaluations +=
      result.candidateEvaluations;

    matchedRows.push({
      signal,
      result
    });
  }

  const matchingMs =
    Date.now() -
    matchStarted;


  // ==========================================================
  // STEP 3 — SEPARATE ODDS LOOKUP
  //
  // Only now, after the match/event_id was found, query the
  // exact 1H O0.5 market feed.
  //
  // If the event is absent from this odds feed:
  // - MATCH remains valid
  // - event_id remains valid
  // - odds.available = false
  //
  // This is the critical V7.4.1 behavior.
  // ==========================================================

  const hasSecureMatch =
    matchedRows.some(
      row =>
        row.result?.found ===
        true
    );

  let oddsEvents:
    AnyObj[] = [];

  let oddsFetchMs =
    0;

  if (
    hasSecureMatch
  ) {

    const oddsStarted =
      Date.now();

    try {

      oddsEvents =
        await getDirectCloudbetLive(
          true
        );

    } catch {

      // Odds failure must NOT destroy a secure event match.
      oddsEvents = [];
    }

    oddsFetchMs =
      Date.now() -
      oddsStarted;
  }

  const oddsByEventId =
    buildOddsEventMap(
      oddsEvents
    );


  // ==========================================================
  // STEP 4 — BUILD RESPONSE
  // ==========================================================

  const hunterResults:
    AnyObj[] = [];

  for (
    const row
    of matchedRows
  ) {

    const signal =
      row.signal;

    const result =
      row.result;

    const detail =
      result.detail;

    const cb =
      result.best;

    const matchedEventId =
      cb
        ? cloudbetEventId(
            cb.raw
          )
        : null;

    const oddsEvent =
      matchedEventId
        ? oddsByEventId.get(
            matchedEventId
          ) ??
          null
        : null;

    const odds =
      result.found &&
      oddsEvent
        ? extractOver05(
            oddsEvent
          )
        : null;

    hunterResults.push({

      status:
        result.found
          ? "MATCH"
          : "NO_MATCH",

      signal: {
        type:
          signal?.type ??
          "HUNTER_ENTRY",

        match:
          signal?.match ??
          null,

        match_id:
          signal?.match_id ??
          null,

        home:
          signal?.home ??
          null,

        away:
          signal?.away ??
          null,

        entry_minute:
          signal?.entry_minute ??
          null,

        current_minute:
          signal?.current_minute ??
          null,

        period:
          signal?.period ??
          null,

        hunter_score:
          signal?.hunter_score ??
          null
      },

      cloudbet:
        cb
          ? {
              id:
                cb.raw?.id ??
                cb.raw?.event_id ??
                null,

              event_id:
                cb.raw?.event_id ??
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

              status:
                cb.raw?.status ??
                null,

              event_status:
                cb.raw?.metadata
                  ?.eventStatus ??
                null,

              minute:
                cb.raw?.metadata
                  ?.eventTime ??
                null,

              minute_extended:
                cb.raw?.metadata
                  ?.eventTimeExtended ??
                null,

              parsed_minute:
                cloudbetMinute(
                  cb.raw
                ),

              score:
                cloudbetScore(
                  cb.raw?.metadata
                    ?.score
                ),

              competition:
                cb.raw?.competition ??
                null
            }
          : null,

      odds:
        odds
          ? {
              market:
                ODDS_MARKET,

              selection:
                "OVER 0.5",

              period:
                "1H",

              price:
                odds.price,

              raw_price:
                odds.raw_price,

              available:
                odds.available,

              selection_status:
                odds.status,

              min_stake:
                odds.min_stake,

              max_stake:
                odds.max_stake,

              probability:
                odds.probability,

              market_url:
                odds.market_url
            }
          : {
              market:
                ODDS_MARKET,

              selection:
                "OVER 0.5",

              period:
                "1H",

              price:
                null,

              raw_price:
                null,

              available:
                false,

              selection_status:
                null,

              min_stake:
                null,

              max_stake:
                null,

              probability:
                null,

              market_url:
                null
            },

      matcher_scoring:
        detail
          ? scoringRecord(
              detail
            )
          : {
              total: 0,
              base_score: 0,
              home_score: 0,
              away_score: 0,
              reverse_home_score: 0,
              reverse_away_score: 0,
              direction:
                "NONE",
              competition_score: 0,
              country_score: 0
            },

      classification:
        result.classification,

      reason:
        result.reason,

      security: {
        secure_match:
          result.found === true,

        match_method:
          result.found
            ? "FAST_HUNTER_LIVE_00_CLOSE_MINUTE_TWO_SIDED"
            : null,

        score_only_match:
          false,

        exact_id_alone:
          false,

        provider_id_match_used:
          false,

        required_classification:
          "CONFIDENT_MATCH",

        candidate_discovery:
          "ALL_LIVE_SOCCER_THEN_1H_00_MINUTE_THEN_NAME_MATCH"
      },

      diagnostics: {
        candidate_evaluations:
          result.candidateEvaluations,

        candidates:
          result.candidates,

        minute_candidates:
          result.minuteCandidates ??
          0,

        target_minute:
          result.targetMinute ??
          null,

        cloudbet_minute:
          result.bestMinute ??
          null,

        minute_difference:
          result.bestMinuteDifference ??
          null,

        minute_tolerance:
          MATCH_MINUTE_TOLERANCE,

        live_filter:
          "LIVE + 1H + 0:0 + CLOSE_MINUTE",

        event_discovery:
          "ALL_LIVE_SOCCER_WITHOUT_MARKET_FILTER",

        odds_lookup:
          "SEPARATE_AFTER_SECURE_MATCH",

        odds_event_found:
          oddsEvent !==
          null,

        target_normalized_home:
          normalizeTeam(
            signal?.home
          ),

        target_normalized_away:
          normalizeTeam(
            signal?.away
          )
      }
    });
  }


  return json({
    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      VERSION,

    mode:
      "READ ONLY",

    execution_mode:
      "FAST_HUNTER",

    source: {
      v27:
        "SKIPPED_IN_FAST_HUNTER",

      cloudbet:
        "DIRECT CLOUDBET PUBLIC SPORTS API",

      event_discovery:
        "ALL LIVE SOCCER — NO MARKET FILTER",

      odds:
        "SEPARATE EXACT 1H OVER 0.5 LOOKUP AFTER MATCH"
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

      minute_tolerance:
        MATCH_MINUTE_TOLERANCE,

      prefilter:
        "LIVE + 1H + 0:0 + VALID MINUTE",

      discovery_market_filter:
        false,

      odds_lookup_after_match:
        true,

      preserve_event_id_without_odds:
        true,

      matcher:
        "STRICT TWO-SIDED TEAM NORMALIZATION + ALIAS + TOKEN FUZZY + CATEGORY PROTECTION",

      hunter_security:
        "ONLY CONFIDENT_MATCH IS ACCEPTED",

      fast_hunter:
        true,

      direct_odds:
        true,

      odds_market:
        ODDS_MARKET,

      odds_selection:
        "1H OVER 0.5"
    },

    stats: {
      hunter_signals:
        signals.length,

      cloudbet_raw_matches:
        rawCloudbet.length,

      cloudbet_live_1h_00_matches:
        cloudbetLive.length,

      cloudbet_odds_feed_matches:
        oddsEvents.length,

      hunter_secure_matches:
        hunterResults.filter(
          x =>
            x?.security
              ?.secure_match ===
            true
        ).length,

      hunter_no_matches:
        hunterResults.filter(
          x =>
            x?.security
              ?.secure_match !==
            true
        ).length,

      hunter_odds_found:
        hunterResults.filter(
          x =>
            x?.odds
              ?.price !==
            null
        ).length,

      hunter_odds_available:
        hunterResults.filter(
          x =>
            x?.odds
              ?.available ===
            true
        ).length,

      hunter_candidate_evaluations:
        totalCandidateEvaluations,

      cloudbet_discovery_ms:
        cloudbetDiscoveryMs,

      odds_fetch_ms:
        oddsFetchMs,

      prepare_ms:
        prepareMs,

      matching_ms:
        matchingMs,

      processing_ms:
        Date.now() -
        started
    },

    hunter_results:
      hunterResults,

    timestamp:
      new Date()
        .toISOString()
  });
}


// ============================================================
// LIGHT DIAGNOSTIC MODE
// ============================================================

async function runLightDiagnostic(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  const [
    v27Data,
    cloudbetEvents
  ] =
    await Promise.all([
      fetchServiceJSON(
        env.V27,
        "/"
      ),

      getDirectCloudbetLive(
        false
      )
    ]);

  const v27Matches =
    Array.isArray(
      v27Data?.matches
    )
      ? v27Data.matches
      : Array.isArray(
          v27Data?.live_matches
        )
      ? v27Data.live_matches
      : Array.isArray(
          v27Data?.events
        )
      ? v27Data.events
      : [];

  const live =
    cloudbetEvents.filter(
      isCloudbetLive
    );

  const live1h00 =
    cloudbetEvents.filter(
      isHunterEligibleCloudbetEvent
    );

  let oddsEvents:
    AnyObj[] = [];

  try {

    oddsEvents =
      await getDirectCloudbetLive(
        true
      );

  } catch {

    oddsEvents = [];
  }

  const withOdds =
    oddsEvents.filter(
      event =>
        extractOver05(
          event
        ) !== null
    );

  return json({
    success:
      true,

    worker:
      "cloudbet-match-matcher",

    version:
      VERSION,

    mode:
      "READ ONLY",

    execution_mode:
      "LIGHT_DIAGNOSTIC",

    source: {
      v27:
        "V27 SERVICE BINDING",

      cloudbet:
        "DIRECT CLOUDBET PUBLIC SPORTS API",

      event_discovery:
        "ALL LIVE SOCCER — NO MARKET FILTER",

      odds:
        "SEPARATE MARKET QUERY"
    },

    note:
      "Event discovery is independent from odds availability. Full all-vs-all diagnostic matching is disabled to avoid CPU limit.",

    settings: {
      prefilter:
        "LIVE + 1H + 0:0 + VALID MINUTE",

      minute_tolerance:
        MATCH_MINUTE_TOLERANCE,

      discovery_market_filter:
        false
    },

    stats: {
      v27_matches:
        v27Matches.length,

      cloudbet_raw_matches:
        cloudbetEvents.length,

      cloudbet_live_matches:
        live.length,

      cloudbet_live_1h_00_matches:
        live1h00.length,

      cloudbet_odds_feed_matches:
        oddsEvents.length,

      cloudbet_over_05_found:
        withOdds.length,

      cloudbet_over_05_enabled:
        withOdds.filter(
          event =>
            extractOver05(
              event
            )?.available ===
            true
        ).length,

      processing_ms:
        Date.now() -
        started
    },

    hunter_results:
      [],

    timestamp:
      new Date()
        .toISOString()
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
// MAIN
// ============================================================

export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const started =
      Date.now();

    const url =
      new URL(
        request.url
      );

    const pathname =
      url.pathname;


    // ========================================================
    // ROOT
    // ========================================================

    if (
      pathname ===
      "/"
    ) {

      return json({
        success:
          true,

        worker:
          "cloudbet-match-matcher",

        version:
          VERSION,

        mode:
          "READ ONLY",

        fast_hunter:
          true,

        direct_cloudbet:
          true,

        filter:
          "ALL LIVE SOCCER -> 1H + 0:0 + +/-5 MINUTES -> NAME MATCH",

        discovery_market_filter:
          false,

        odds:
          "SEPARATE 1H OVER 0.5 LOOKUP AFTER MATCH",

        routes: [
          "/live",
          "/match?signals=[...]",
          "/diagnostic"
        ]
      });
    }


    // ========================================================
    // LIVE + ODDS
    // ========================================================

    if (
      pathname ===
      "/live"
    ) {

      try {

        const liveStarted =
          Date.now();

        const events =
          await getDirectCloudbetLive(
            false
          );

        let oddsEvents:
          AnyObj[] = [];

        try {

          oddsEvents =
            await getDirectCloudbetLive(
              true
            );

        } catch {

          oddsEvents = [];
        }

        const oddsByEventId =
          buildOddsEventMap(
            oddsEvents
          );

        const matches =
          events
            .filter(
              isHunterEligibleCloudbetEvent
            )
            .map(
              event => {

                const id =
                  cloudbetEventId(
                    event
                  );

                const oddsEvent =
                  id
                    ? oddsByEventId.get(
                        id
                      ) ??
                      null
                    : null;

                return buildCloudbetLiveRecord(
                  event,
                  oddsEvent
                );
              }
            );

        const withOdds =
          matches.filter(
            x =>
              x?.odds !==
              null
          );

        return json({
          success:
            true,

          worker:
            "cloudbet-match-matcher",

          version:
            VERSION,

          mode:
            "READ ONLY",

          execution_mode:
            "LIVE_ODDS",

          source:
            "DIRECT CLOUDBET PUBLIC SPORTS API",

          event_discovery:
            "ALL LIVE SOCCER — NO MARKET FILTER",

          odds_lookup:
            "SEPARATE MARKET QUERY",

          target: {
            sport:
              "soccer",

            live:
              true,

            period:
              "1H",

            score:
              "0:0",

            market:
              ODDS_MARKET,

            submarket:
              ODDS_SUBMARKET,

            selection:
              "OVER 0.5"
          },

          summary: {
            live_1h_00_matches:
              matches.length,

            odds_found:
              withOdds.length,

            odds_enabled:
              withOdds.filter(
                x =>
                  x?.odds
                    ?.available ===
                  true
              ).length
          },

          matches,

          processing_ms:
            Date.now() -
            liveStarted,

          timestamp:
            new Date()
              .toISOString()
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-match-matcher",

            version:
              VERSION,

            action:
              "LIVE",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),

            processing_ms:
              Date.now() -
              started
          },
          500
        );
      }
    }


    // ========================================================
    // MATCH
    // ========================================================

    if (
      pathname ===
      "/match"
    ) {

      try {

        const threshold =
          getThreshold(
            request
          );

        const parsed =
          parseSignalsParam(
            request
          );

        if (
          parsed.rawPresent
        ) {

          if (
            parsed.signals.length ===
            0
          ) {

            return json({
              success:
                true,

              worker:
                "cloudbet-match-matcher",

              version:
                VERSION,

              mode:
                "READ ONLY",

              execution_mode:
                "FAST_HUNTER",

              stats: {
                hunter_signals:
                  0,

                hunter_secure_matches:
                  0,

                hunter_no_matches:
                  0,

                hunter_odds_found:
                  0,

                hunter_odds_available:
                  0,

                hunter_candidate_evaluations:
                  0,

                processing_ms:
                  Date.now() -
                  started
              },

              hunter_results:
                [],

              warning:
                "signals parameter was present but contained no valid Hunter signals"
            });
          }

          return await runFastHunter(
            env,
            request,
            parsed.signals,
            threshold
          );
        }

        return await runLightDiagnostic(
          env
        );

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-match-matcher",

            version:
              VERSION,

            action:
              "MATCH",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),

            processing_ms:
              Date.now() -
              started
          },
          500
        );
      }
    }


    // ========================================================
    // DIAGNOSTIC
    // ========================================================

    if (
      pathname ===
      "/diagnostic"
    ) {

      try {

        return await runLightDiagnostic(
          env
        );

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-match-matcher",

            version:
              VERSION,

            action:
              "DIAGNOSTIC",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  )
          },
          500
        );
      }
    }


    // ========================================================
    // NOT FOUND
    // ========================================================

    return json(
      {
        success:
          false,

        worker:
          "cloudbet-match-matcher",

        version:
          VERSION,

        error:
          "NOT_FOUND"
      },
      404
    );
  }
};
