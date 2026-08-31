// ============================================================
// CLOUDBET BET WORKER V4.3
// SECURE SIGNAL -> MATCHER -> CLOUDBET PIPELINE
//
// V4.3 MATCHER CANDIDATE SELECTION FIX
//
// FLOW:
//
// TRACKER /entries
//        |
//        v
// HUNTER_ENTRY FILTER
//        |
//        v
// MATCHER /match       <-- ONE CALL
//        |
//        v
// MATCHER CANDIDATE SELECTION PER SIGNAL
//        |
//        +--> EXACT V27 ID
//        |
//        +--> EXACT TWO-SIDED TEAMS
//        |
//        v
// STRICT SECURITY VALIDATION
//        |
//        v
// CLOUDBET /live       <-- ONE CALL
//        |
//        v
// LOCAL VERIFICATION FOR ALL SIGNALS
//        |
//        v
// READY / NO_MATCH
//
// IMPORTANT:
// - READ ONLY
// - BETTING DISABLED
// - NO BET IS PLACED
// - EXACT_ID ALONE IS NOT ENOUGH
// - score_only_match IS NEVER ACCEPTED
// - MATCHER CONFIDENT_MATCH IS REQUIRED
// - secure_match=true IS REQUIRED
// - TWO-SIDED TEAM VALIDATION IS REQUIRED
// - CLOUDBET SECOND VERIFICATION IS REQUIRED
// - CLOUDBET /live IS FETCHED ONLY ONCE
//
// V4.3 FIX:
// Matcher may return many candidates.
// We now select the candidate belonging to the CURRENT
// Hunter signal before applying the strict security checks.
// ============================================================


interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
}


type AnyObj =
  Record<string, any>;


// ============================================================
// CONFIG
// ============================================================

const VERSION =
  "V4.3";

const MODE =
  "READ_ONLY";

const BETTING_ENABLED =
  false;

const MATCHER_THRESHOLD =
  0.45;

const TOKEN_TEAM_MIN_SCORE =
  0.45;

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const REQUIRED_SECURE_MATCH =
  true;

const ALLOWED_SIGNAL_TYPE =
  "HUNTER_ENTRY";

const TARGET_SPORT =
  "SOCCER";

const TARGET_PERIOD =
  "FIRST_HALF";

const TARGET_OUTCOME =
  "OVER";

const TARGET_LINE =
  0.5;


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
          "no-store, no-cache, must-revalidate",

        "pragma":
          "no-cache",

        "expires":
          "0"
      }
    }
  );
}


// ============================================================
// SERVICE FETCH
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  options: RequestInit = {}
): Promise<any> {

  const response =
    await service.fetch(
      new Request(
        `https://service${path}`,
        {
          method:
            options.method ??
            "GET",

          headers: {
            "accept":
              "application/json",

            ...(options.headers ?? {})
          },

          body:
            options.body
        }
      )
    );


  const text =
    await response.text();


  if (
    !response.ok
  ) {

    throw new Error(
      `HTTP ${response.status} ${path}: ${text.slice(0, 500)}`
    );
  }


  if (
    !text.trim()
  ) {

    return {};
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
// SAFE STRING
// ============================================================

function safeString(
  value: any
): string {

  return String(
    value ?? ""
  ).trim();
}


// ============================================================
// NORMALIZATION
// ============================================================

function normalizeText(
  value: any
): string {

  return safeString(
    value
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
// TEAM EXTRACTION
// ============================================================

function splitMatchName(
  value: any
): {
  home: string | null;
  away: string | null;
} {

  const text =
    safeString(
      value
    );


  if (
    !text
  ) {

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


// ============================================================
// HOME
// ============================================================

function extractHome(
  match: AnyObj
): string {

  if (
    typeof match?.home ===
    "string"
  ) {

    return match.home.trim();
  }


  if (
    typeof match?.homeTeam ===
    "string"
  ) {

    return match.homeTeam.trim();
  }


  if (
    typeof match?.home_name ===
    "string"
  ) {

    return match.home_name.trim();
  }


  if (
    typeof match?.home?.name ===
    "string"
  ) {

    return match.home.name.trim();
  }


  if (
    typeof match?.teams?.home ===
    "string"
  ) {

    return match.teams.home.trim();
  }


  if (
    typeof match?.teams?.home?.name ===
    "string"
  ) {

    return match.teams.home.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
      ""
    ).home ?? ""
  );
}


// ============================================================
// AWAY
// ============================================================

function extractAway(
  match: AnyObj
): string {

  if (
    typeof match?.away ===
    "string"
  ) {

    return match.away.trim();
  }


  if (
    typeof match?.awayTeam ===
    "string"
  ) {

    return match.awayTeam.trim();
  }


  if (
    typeof match?.away_name ===
    "string"
  ) {

    return match.away_name.trim();
  }


  if (
    typeof match?.away?.name ===
    "string"
  ) {

    return match.away.name.trim();
  }


  if (
    typeof match?.teams?.away ===
    "string"
  ) {

    return match.teams.away.trim();
  }


  if (
    typeof match?.teams?.away?.name ===
    "string"
  ) {

    return match.teams.away.name.trim();
  }


  return (
    splitMatchName(
      match?.match ??
      match?.name ??
      ""
    ).away ?? ""
  );
}


// ============================================================
// DISPLAY MATCH
// ============================================================

function displayMatch(
  match: AnyObj
): string {

  const direct =
    safeString(
      match?.match ??
      match?.name
    );


  if (
    direct
  ) {

    return direct;
  }


  const home =
    extractHome(
      match
    );


  const away =
    extractAway(
      match
    );


  return `${home} - ${away}`;
}


// ============================================================
// MATCH ID
// ============================================================

function extractMatchId(
  match: AnyObj
): string {

  return safeString(
    match?.id ??
    match?.match_id ??
    match?.matchId ??
    match?.key ??
    match?.fixture_id ??
    match?.event_id
  );
}


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
// APPLY ALIASES
// ============================================================

function applyAliases(
  value: string
): string {

  let result =
    normalizeText(
      value
    );


  if (
    !result
  ) {

    return "";
  }


  const aliases =
    Object.keys(
      TEAM_ALIASES
    ).sort(
      (a, b) =>
        b.length -
        a.length
    );


  for (
    const alias
    of aliases
  ) {

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


    result =
      result.replace(
        regex,
        `$1${TEAM_ALIASES[alias]}`
      );
  }


  return result
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}


// ============================================================
// NORMALIZE TEAM
// ============================================================

function normalizeTeam(
  value: any
): string {

  const normalized =
    applyAliases(
      safeString(
        value
      )
    );


  if (
    !normalized
  ) {

    return "";
  }


  return normalized
    .split(" ")
    .filter(Boolean)
    .filter(
      word =>
        !GENERIC_WORDS.has(
          word
        )
    )
    .filter(
      word =>
        !/^\d+$/.test(
          word
        )
    )
    .join(" ")
    .trim();
}


// ============================================================
// TEAM VALIDATION
// ============================================================

function teamsPresent(
  home: any,
  away: any
): boolean {

  return (
    normalizeTeam(home).length > 0 &&
    normalizeTeam(away).length > 0
  );
}


function sameNormalizedTeam(
  a: any,
  b: any
): boolean {

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

    return false;
  }


  return A === B;
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractSignals(
  data: any
): AnyObj[] {

  if (
    Array.isArray(
      data?.signals
    )
  ) {

    return data.signals;
  }


  if (
    Array.isArray(
      data?.entries
    )
  ) {

    return data.entries;
  }


  if (
    Array.isArray(
      data?.hunter_entries
    )
  ) {

    return data.hunter_entries;
  }


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;
  }


  return [];
}


// ============================================================
// HUNTER ENTRY FILTER
// ============================================================

function isHunterEntry(
  signal: AnyObj
): boolean {

  const type =
    safeString(
      signal?.type ??
      signal?.signal_type ??
      signal?.signalType
    ).toUpperCase();


  return (
    type ===
    ALLOWED_SIGNAL_TYPE
  );
}


// ============================================================
// SIGNAL ID
// ============================================================

function signalMatchId(
  signal: AnyObj
): string {

  return safeString(
    signal?.match_id ??
    signal?.matchId ??
    signal?.id
  );
}


// ============================================================
// SIGNAL NAME
// ============================================================

function signalMatchName(
  signal: AnyObj
): string {

  return safeString(
    signal?.match ??
    signal?.name
  );
}


// ============================================================
// SIGNAL HOME
// ============================================================

function signalHome(
  signal: AnyObj
): string {

  return extractHome(
    signal
  );
}


// ============================================================
// SIGNAL AWAY
// ============================================================

function signalAway(
  signal: AnyObj
): string {

  return extractAway(
    signal
  );
}


// ============================================================
// MATCHER RESPONSE
// ============================================================

function extractMatcherMatches(
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
      data?.results
    )
  ) {

    return data.results;
  }


  if (
    Array.isArray(
      data?.matched
    )
  ) {

    return data.matched;
  }


  if (
    Array.isArray(
      data?.candidates
    )
  ) {

    return data.candidates;
  }


  return [];
}


// ============================================================
// CANDIDATE CONTAINER
//
// Matcher V7 may place the actual V27/Cloudbet objects
// at different levels.
//
// This helper keeps V4.3 strict while being more tolerant
// about response structure.
// ============================================================

function unwrapMatcherCandidate(
  item: AnyObj
): {
  item: AnyObj;
  v27: AnyObj;
  cloudbet: AnyObj | null;
} {

  const v27 =
    item?.v27 ??
    item?.source ??
    item?.source_match ??
    item?.sourceMatch ??
    item?.tracker ??
    item;


  const cloudbet =
    item?.cloudbet ??
    item?.target ??
    item?.matched ??
    item?.cloudbet_match ??
    item?.cloudbetMatch ??
    null;


  return {
    item,
    v27,
    cloudbet
  };
}


// ============================================================
// GET CLASSIFICATION
// ============================================================

function getClassification(
  item: AnyObj
): string {

  return safeString(
    item?.classification ??
    item?.match_classification ??
    item?.matchClassification ??
    item?.security?.classification ??
    item?.security?.match_classification ??
    item?.scoring?.classification ??
    item?.matcher?.classification
  ).toUpperCase();
}


// ============================================================
// GET MATCHER SCORE
// ============================================================

function getMatcherScore(
  item: AnyObj
): number {

  const values = [

    item?.scoring?.total,

    item?.scoring?.score,

    item?.matcher_scoring?.total,

    item?.matcher_scoring?.score,

    item?.matcher?.score,

    item?.matcher_score,

    item?.match_score,

    item?.score

  ];


  for (
    const value
    of values
  ) {

    const n =
      Number(
        value
      );


    if (
      Number.isFinite(n)
    ) {

      return n;
    }
  }


  return 0;
}


// ============================================================
// GET METHOD
// ============================================================

function getMatchMethod(
  item: AnyObj
): string {

  return safeString(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method ??
    item?.security?.method ??
    item?.matcher?.match_method ??
    item?.matcher?.method
  ).toUpperCase();
}


// ============================================================
// GET SECURITY FLAG
// ============================================================

function getSecureFlag(
  item: AnyObj
): boolean {

  return (
    item?.security?.secure_match === true ||
    item?.security?.secureMatch === true ||
    item?.secure_match === true ||
    item?.secureMatch === true
  );
}


// ============================================================
// GET SCORE ONLY FLAG
// ============================================================

function getScoreOnlyFlag(
  item: AnyObj
): boolean {

  return (
    item?.security?.score_only_match === true ||
    item?.security?.scoreOnlyMatch === true ||
    item?.score_only_match === true ||
    item?.scoreOnlyMatch === true
  );
}


// ============================================================
// SIGNAL -> CANDIDATE MATCH
//
// IMPORTANT:
//
// This function ONLY determines whether a candidate belongs
// to the current Hunter signal.
//
// It does NOT grant security.
//
// Security is checked later.
//
// Priority:
//
// 1. exact signal ID == V27 candidate ID
// 2. exact normalized Home + Away
//
// No fuzzy acceptance here.
// ============================================================

function candidateBelongsToSignal(
  signal: AnyObj,
  candidate: AnyObj
): {
  belongs: boolean;
  method: string;
  score: number;
} {

  const signalId =
    signalMatchId(
      signal
    );


  const signalHomeName =
    normalizeTeam(
      signalHome(
        signal
      )
    );


  const signalAwayName =
    normalizeTeam(
      signalAway(
        signal
      )
    );


  const unwrapped =
    unwrapMatcherCandidate(
      candidate
    );


  const v27 =
    unwrapped.v27;


  const candidateId =
    extractMatchId(
      v27
    );


  // ----------------------------------------------------------
  // EXACT ID
  // ----------------------------------------------------------

  if (
    signalId &&
    candidateId &&
    signalId === candidateId
  ) {

    return {

      belongs:
        true,

      method:
        "SIGNAL_ID_TO_V27_ID",

      score:
        100
    };
  }


  // ----------------------------------------------------------
  // EXACT TWO-SIDED TEAM MATCH
  // ----------------------------------------------------------

  const candidateHome =
    normalizeTeam(
      extractHome(
        v27
      )
    );


  const candidateAway =
    normalizeTeam(
      extractAway(
        v27
      )
    );


  if (
    signalHomeName &&
    signalAwayName &&
    candidateHome &&
    candidateAway &&
    signalHomeName === candidateHome &&
    signalAwayName === candidateAway
  ) {

    return {

      belongs:
        true,

      method:
        "SIGNAL_TWO_SIDED_TEAMS",

      score:
        95
    };
  }


  return {

    belongs:
      false,

    method:
      "NO_SIGNAL_CANDIDATE_MATCH",

    score:
      0
  };
}


// ============================================================
// MATCHER CANDIDATE DIAGNOSTIC
//
// Strict rejection reasons are exposed so we can see exactly
// which security rule rejected each candidate.
// ============================================================

function inspectMatcherCandidate(
  signal: AnyObj,
  candidate: AnyObj
): AnyObj {

  const unwrapped =
    unwrapMatcherCandidate(
      candidate
    );


  const item =
    unwrapped.item;


  const v27 =
    unwrapped.v27;


  const cloudbet =
    unwrapped.cloudbet;


  const classification =
    getClassification(
      item
    );


  const matcherScore =
    getMatcherScore(
      item
    );


  const method =
    getMatchMethod(
      item
    );


  const secureFlag =
    getSecureFlag(
      item
    );


  const scoreOnly =
    getScoreOnlyFlag(
      item
    );


  const vHome =
    extractHome(
      v27
    );


  const vAway =
    extractAway(
      v27
    );


  const cHome =
    cloudbet
      ? extractHome(
          cloudbet
        )
      : "";


  const cAway =
    cloudbet
      ? extractAway(
          cloudbet
        )
      : "";


  const signalHomeName =
    signalHome(
      signal
    );


  const signalAwayName =
    signalAway(
      signal
    );


  const signalDirectionOk =
    !signalHomeName ||
    !signalAwayName
      ? true
      : (
          sameNormalizedTeam(
            signalHomeName,
            vHome
          ) &&
          sameNormalizedTeam(
            signalAwayName,
            vAway
          )
        );


  const candidateLink =
    candidateBelongsToSignal(
      signal,
      candidate
    );


  const reasons:
    string[] = [];


  if (
    !candidateLink.belongs
  ) {

    reasons.push(
      "CANDIDATE_NOT_FOR_THIS_SIGNAL"
    );
  }


  if (
    classification !==
    REQUIRED_MATCH_CLASSIFICATION
  ) {

    reasons.push(
      "CLASSIFICATION_NOT_CONFIDENT_MATCH"
    );
  }


  if (
    scoreOnly
  ) {

    reasons.push(
      "SCORE_ONLY_MATCH_REJECTED"
    );
  }


  if (
    !secureFlag
  ) {

    reasons.push(
      "SECURE_MATCH_FLAG_FALSE"
    );
  }


  if (
    !teamsPresent(
      vHome,
      vAway
    )
  ) {

    reasons.push(
      "V27_TEAMS_EMPTY"
    );
  }


  if (
    !cloudbet ||
    !teamsPresent(
      cHome,
      cAway
    )
  ) {

    reasons.push(
      "CLOUDBET_TEAMS_EMPTY"
    );
  }


  if (
    !signalDirectionOk
  ) {

    reasons.push(
      "SIGNAL_DIRECTION_MISMATCH"
    );
  }


  if (
    method ===
    "EXACT_ID" &&
    matcherScore <= 0
  ) {

    reasons.push(
      "EXACT_ID_WITH_ZERO_SCORE"
    );
  }


  return {

    candidate_match:
      displayMatch(
        v27
      ),

    candidate_id:
      extractMatchId(
        v27
      ) ||
      null,

    signal_id:
      signalMatchId(
        signal
      ) ||
      null,

    signal_match:
      signalMatchName(
        signal
      ) ||
      null,

    candidate_link:
      candidateLink,

    classification:
      classification ||
      null,

    matcher_score:
      matcherScore,

    match_method:
      method ||
      null,

    secure_match:
      secureFlag,

    score_only_match:
      scoreOnly,

    v27: {

      home:
        vHome ||
        null,

      away:
        vAway ||
        null
    },

    cloudbet: {

      home:
        cHome ||
        null,

      away:
        cAway ||
        null
    },

    accepted:
      reasons.length === 0,

    reject_reasons:
      reasons
  };
}


// ============================================================
// SELECT BEST MATCHER CANDIDATE FOR SIGNAL
//
// IMPORTANT:
//
// This does NOT weaken security.
//
// It simply finds the candidate belonging to this signal,
// then applies the existing strict security rules.
//
// A candidate is accepted ONLY when every required condition
// passes.
// ============================================================

function validateSecureMatcherResult(
  signal: AnyObj,
  matcherResult: AnyObj
): AnyObj {

  const matches =
    extractMatcherMatches(
      matcherResult
    );


  const rootSuccess =
    matcherResult?.success === true;


  const confidentFromRoot =
    Number(
      matcherResult?.confident_matched ??
      matcherResult?.confidentMatches ??
      0
    );


  if (
    !rootSuccess
  ) {

    return {

      secure:
        false,

      reason:
        "MATCHER_NOT_SUCCESSFUL",

      matcher_confident_matched:
        confidentFromRoot,

      candidates_checked:
        0,

      candidate_diagnostics:
        []
    };
  }


  const candidates =
    matches.length
      ? matches
      : (
        matcherResult?.match
          ? [matcherResult.match]
          : []
      );


  if (
    candidates.length === 0
  ) {

    return {

      secure:
        false,

      reason:
        "MATCHER_RETURNED_NO_CANDIDATES",

      matcher_confident_matched:
        confidentFromRoot,

      candidates_checked:
        0,

      candidate_diagnostics:
        []
    };
  }


  const diagnostics:
    AnyObj[] = [];


  const validCandidates:
    AnyObj[] = [];


  // ----------------------------------------------------------
  // CHECK EVERY CANDIDATE
  // ----------------------------------------------------------

  for (
    const candidate
    of candidates
  ) {

    const inspection =
      inspectMatcherCandidate(
        signal,
        candidate
      );


    diagnostics.push(
      inspection
    );


    if (
      inspection.accepted
    ) {

      validCandidates.push(
        {
          candidate,
          inspection
        }
      );
    }
  }


  // ----------------------------------------------------------
  // NO VALID CANDIDATE
  // ----------------------------------------------------------

  if (
    validCandidates.length === 0
  ) {

    return {

      secure:
        false,

      reason:
        "NO_SECURE_CONFIDENT_TWO_SIDED_MATCH",

      matcher_confident_matched:
        confidentFromRoot,

      candidates_checked:
        candidates.length,

      candidate_diagnostics:
        diagnostics
    };
  }


  // ----------------------------------------------------------
  // SORT VALID CANDIDATES
  //
  // Highest matcher score first.
  // Signal ID link gets priority.
  // ----------------------------------------------------------

  validCandidates.sort(
    (a, b) => {

      const aLink =
        a.inspection.candidate_link?.score ??
        0;

      const bLink =
        b.inspection.candidate_link?.score ??
        0;


      const aMatcher =
        Number(
          a.inspection.matcher_score ??
          0
        );


      const bMatcher =
        Number(
          b.inspection.matcher_score ??
          0
        );


      const aTotal =
        aLink * 1000 +
        aMatcher;


      const bTotal =
        bLink * 1000 +
        bMatcher;


      return bTotal - aTotal;
    }
  );


  const selected =
    validCandidates[0];


  const candidate =
    selected.candidate;


  const item =
    candidate;


  const unwrapped =
    unwrapMatcherCandidate(
      candidate
    );


  const v27 =
    unwrapped.v27;


  const cloudbet =
    unwrapped.cloudbet;


  return {

    secure:
      true,

    reason:
      "SECURE_CONFIDENT_MATCH",

    item,

    classification:
      selected.inspection.classification,

    method:
      selected.inspection.match_method,

    matcher_score:
      selected.inspection.matcher_score,

    secure_match:
      true,

    score_only_match:
      false,

    candidate_link_method:
      selected.inspection.candidate_link?.method ??
      null,

    candidate_link_score:
      selected.inspection.candidate_link?.score ??
      null,

    v27: {

      id:
        extractMatchId(
          v27
        ),

      match:
        displayMatch(
          v27
        ),

      home:
        extractHome(
          v27
        ),

      away:
        extractAway(
          v27
        )
    },

    cloudbet: cloudbet
      ? {

          id:
            extractMatchId(
              cloudbet
            ),

          match:
            displayMatch(
              cloudbet
            ),

          home:
            extractHome(
              cloudbet
            ),

          away:
            extractAway(
              cloudbet
            )
        }
      : null,

    candidates_checked:
      candidates.length,

    valid_secure_candidates:
      validCandidates.length,

    candidate_diagnostics:
      diagnostics
  };
}


// ============================================================
// CLOUDBET MATCH EXTRACTION
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


  if (
    Array.isArray(
      data?.data
    )
  ) {

    return data.data;
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
    safeString(
      match?.status
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
// CLOUDBET SECURE VERIFICATION
// ============================================================

function verifyCloudbetMatch(
  secureMatcher: AnyObj,
  cloudbetMatches: AnyObj[]
): AnyObj {

  const target =
    secureMatcher?.cloudbet;


  if (
    !target
  ) {

    return {

      verified:
        false,

      reason:
        "MATCHER_DID_NOT_RETURN_CLOUDBET_MATCH"
    };
  }


  const targetId =
    safeString(
      target?.id
    );


  const targetHome =
    normalizeTeam(
      target?.home
    );


  const targetAway =
    normalizeTeam(
      target?.away
    );


  if (
    !targetHome ||
    !targetAway
  ) {

    return {

      verified:
        false,

      reason:
        "MATCHER_CLOUDBET_TEAMS_EMPTY"
    };
  }


  // ==========================================================
  // FIRST:
  // EXACT CLOUDBET ID + TEAMS
  // ==========================================================

  if (
    targetId
  ) {

    for (
      const cb
      of cloudbetMatches
    ) {

      const cbId =
        extractMatchId(
          cb
        );


      if (
        cbId &&
        cbId === targetId
      ) {

        const cbHome =
          normalizeTeam(
            extractHome(
              cb
            )
          );


        const cbAway =
          normalizeTeam(
            extractAway(
              cb
            )
          );


        if (
          cbHome ===
            targetHome &&
          cbAway ===
            targetAway
        ) {

          return {

            verified:
              true,

            method:
              "CLOUDBET_ID_AND_TEAMS",

            match:
              cb
          };
        }
      }
    }
  }


  // ==========================================================
  // SECOND:
  // EXACT TWO-SIDED TEAMS
  // ==========================================================

  for (
    const cb
    of cloudbetMatches
  ) {

    const cbHome =
      normalizeTeam(
        extractHome(
          cb
        )
      );


    const cbAway =
      normalizeTeam(
        extractAway(
          cb
        )
      );


    if (
      cbHome ===
        targetHome &&
      cbAway ===
        targetAway
    ) {

      return {

        verified:
          true,

        method:
          "CLOUDBET_EXACT_TEAMS",

        match:
          cb
      };
    }
  }


  return {

    verified:
      false,

    reason:
      "CLOUDBET_MATCH_NOT_CONFIRMED"
  };
}


// ============================================================
// BUILD READY BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  secureMatcher: AnyObj,
  cloudbetVerification: AnyObj
): AnyObj {

  const cb =
    cloudbetVerification.match;


  const signalId =
    signalMatchId(
      signal
    );


  return {

    status:
      "READY",

    betting:
      BETTING_ENABLED
        ? "ENABLED"
        : "DISABLED",

    sport:
      TARGET_SPORT,

    period:
      TARGET_PERIOD,

    outcome:
      TARGET_OUTCOME,

    line:
      TARGET_LINE,


    signal: {

      type:
        safeString(
          signal?.type ??
          signal?.signal_type
        ),

      match:
        signalMatchName(
          signal
        ),

      match_id:
        signalId ||
        null,

      home:
        signalHome(
          signal
        ) ||
        null,

      away:
        signalAway(
          signal
        ) ||
        null,

      entry_minute:
        signal?.entry_minute ??
        signal?.entryMinute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        null
    },


    cloudbet: {

      id:
        extractMatchId(
          cb
        ) ||
        null,

      key:
        cb?.key ??
        null,

      match:
        displayMatch(
          cb
        ),

      home:
        extractHome(
          cb
        ),

      away:
        extractAway(
          cb
        ),

      status:
        cb?.status ??
        null,

      live:
        cb?.live ??
        null,

      score:
        cb?.score ??
        null,

      minute:
        cb?.minute ??
        null,

      competition:
        cb?.competition ??
        null
    },


    matcher: {

      classification:
        secureMatcher.classification,

      match_method:
        secureMatcher.method,

      matcher_score:
        secureMatcher.matcher_score,

      reason:
        secureMatcher.reason,

      candidate_link_method:
        secureMatcher.candidate_link_method,

      candidate_link_score:
        secureMatcher.candidate_link_score
    },


    security: {

      secure_match:
        true,

      score_only_match:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      matcher_confident:
        true,

      two_sided_team_validation:
        true,

      cloudbet_verified:
        true,

      cloudbet_verification_method:
        cloudbetVerification.method,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    action:
      "NO_BET_IN_V4_READY"
  };
}


// ============================================================
// BUILD NO MATCH
// ============================================================

function buildNoMatch(
  signal: AnyObj,
  reason: string,
  secureMatcher: AnyObj | null = null,
  cloudbetVerification: AnyObj | null = null
): AnyObj {

  return {

    status:
      "NO_MATCH",

    betting:
      "DISABLED",

    sport:
      TARGET_SPORT,

    period:
      TARGET_PERIOD,

    outcome:
      TARGET_OUTCOME,

    line:
      TARGET_LINE,


    signal: {

      type:
        safeString(
          signal?.type ??
          signal?.signal_type
        ),

      match:
        signalMatchName(
          signal
        ),

      match_id:
        signalMatchId(
          signal
        ) ||
        null,

      home:
        signalHome(
          signal
        ) ||
        null,

      away:
        signalAway(
          signal
        ) ||
        null,

      entry_minute:
        signal?.entry_minute ??
        signal?.entryMinute ??
        null,

      hunter_score:
        signal?.hunter_score ??
        signal?.hunterScore ??
        signal?.score ??
        null,

      score:
        signal?.score ??
        null
    },


    cloudbet:
      cloudbetVerification?.match ??
      null,


    matcher_scoring: {

      score:
        secureMatcher?.matcher_score ??
        0
    },


    matcher_match:
      secureMatcher?.v27 ??
      null,


    security: {

      secure_match:
        secureMatcher?.secure === true,

      match_method:
        secureMatcher?.method ??
        null,

      score_only_match:
        secureMatcher?.score_only_match === true,

      cloudbet_verified:
        cloudbetVerification?.verified === true,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    diagnostics: {

      candidates_checked:
        secureMatcher?.candidates_checked ??
        0,

      valid_secure_candidates:
        secureMatcher?.valid_secure_candidates ??
        0,

      candidate_link_method:
        secureMatcher?.candidate_link_method ??
        null,

      candidate_link_score:
        secureMatcher?.candidate_link_score ??
        null,

      candidate_diagnostics:
        secureMatcher?.candidate_diagnostics ??
        []
    },


    action:
      "NO_BET_IN_V4_3",

    reason
  };
}


// ============================================================
// PROCESS
// ============================================================

async function runV4(
  env: Env,
  request: Request
): Promise<Response> {

  const started =
    Date.now();


  // ==========================================================
  // TRACKER — ONE CALL
  // ==========================================================

  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );


  const allSignals =
    extractSignals(
      trackerData
    );


  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );


  // ==========================================================
  // NO ACTIVE SIGNALS
  // ==========================================================

  if (
    hunterEntries.length === 0
  ) {

    return json({

      success:
        true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      mode:
        MODE,

      betting:
        "DISABLED",


      bindings: {

        TRACKER:
          true,

        MATCHER:
          true,

        CLOUDBET:
          true
      },


      target: {

        sport:
          TARGET_SPORT,

        period:
          TARGET_PERIOD,

        outcome:
          TARGET_OUTCOME,

        line:
          TARGET_LINE
      },


      security: {

        secure_matching:
          true,

        score_only_matching:
          false,

        token_team_min_score:
          TOKEN_TEAM_MIN_SCORE,

        exact_id_alone_is_not_secure:
          true,

        exact_id_requires_positive_matcher_score:
          true,

        required_match_classification:
          REQUIRED_MATCH_CLASSIFICATION,

        required_secure_match:
          REQUIRED_SECURE_MATCH,

        two_sided_team_validation:
          true,

        cloudbet_second_verification:
          true
      },


      tracker: {

        endpoint:
          "/entries",

        total_signals:
          allSignals.length,

        hunter_entries:
          0,

        active_signals:
          false
      },


      matcher: {

        called:
          false,

        reason:
          "NO_ACTIVE_HUNTER_ENTRIES"
      },


      cloudbet: {

        called:
          false,

        reason:
          "NO_ACTIVE_HUNTER_ENTRIES"
      },


      stats: {

        signals_received:
          allSignals.length,

        hunter_entries:
          0,

        matcher_secure_matches:
          0,

        cloudbet_verified_matches:
          0,

        bets_ready:
          0,

        no_match:
          0,

        processing_ms:
          Date.now() -
          started
      },


      prepared_bets:
        [],

      no_match:
        [],


      optimization: {

        version:
          VERSION,

        tracker_calls:
          1,

        matcher_calls:
          0,

        cloudbet_live_calls:
          0
      },


      message:
        "No active HUNTER_ENTRY signals.",


      timestamp:
        new Date().toISOString()
    });
  }


  // ==========================================================
  // MATCHER — ONE CALL
  // ==========================================================

  const matcherData =
    await fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    );


  const matcherMatches =
    extractMatcherMatches(
      matcherData
    );


  // ==========================================================
  // CLOUDBET — ONE CALL
  // ==========================================================

  const cloudbetData =
    await fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );


  const rawCloudbet =
    extractCloudbetMatches(
      cloudbetData
    );


  const liveCloudbet =
    rawCloudbet.filter(
      isCloudbetLive
    );


  // ==========================================================
  // RESULT ARRAYS
  // ==========================================================

  const preparedBets:
    AnyObj[] = [];


  const noMatch:
    AnyObj[] = [];


  let matcherSecureMatches =
    0;


  let cloudbetVerifiedMatches =
    0;


  // ==========================================================
  // DIAGNOSTIC COUNTERS
  // ==========================================================

  const rejectionReasons:
    Record<string, number> = {};


  function countReason(
    reason: string
  ) {

    rejectionReasons[reason] =
      (
        rejectionReasons[reason] ??
        0
      ) + 1;
  }


  // ==========================================================
  // PROCESS EVERY HUNTER SIGNAL LOCALLY
  // ==========================================================

  for (
    const signal
    of hunterEntries
  ) {

    // --------------------------------------------------------
    // MATCHER SECURITY
    // --------------------------------------------------------

    const secureMatcher =
      validateSecureMatcherResult(
        signal,
        matcherData
      );


    // --------------------------------------------------------
    // MATCHER FAILED
    // --------------------------------------------------------

    if (
      !secureMatcher.secure
    ) {

      countReason(
        secureMatcher.reason
      );


      for (
        const diagnostic
        of (
          secureMatcher.candidate_diagnostics ??
          []
        )
      ) {

        for (
          const rejectReason
          of (
            diagnostic.reject_reasons ??
            []
          )
        ) {

          countReason(
            rejectReason
          );
        }
      }


      noMatch.push(
        buildNoMatch(
          signal,
          secureMatcher.reason,
          secureMatcher,
          null
        )
      );


      continue;
    }


    // --------------------------------------------------------
    // SECURE MATCH
    // --------------------------------------------------------

    matcherSecureMatches++;


    // --------------------------------------------------------
    // CLOUDBET VERIFICATION
    //
    // NO NETWORK REQUEST HERE.
    // Uses the single /live response.
    // --------------------------------------------------------

    const cloudbetVerification =
      verifyCloudbetMatch(
        secureMatcher,
        liveCloudbet
      );


    // --------------------------------------------------------
    // CLOUDBET FAILED
    // --------------------------------------------------------

    if (
      !cloudbetVerification.verified
    ) {

      countReason(
        cloudbetVerification.reason
      );


      noMatch.push(
        buildNoMatch(
          signal,
          cloudbetVerification.reason,
          secureMatcher,
          cloudbetVerification
        )
      );


      continue;
    }


    // --------------------------------------------------------
    // CLOUDBET VERIFIED
    // --------------------------------------------------------

    cloudbetVerifiedMatches++;


    // --------------------------------------------------------
    // READY
    // --------------------------------------------------------

    preparedBets.push(
      buildPreparedBet(
        signal,
        secureMatcher,
        cloudbetVerification
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
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",


    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET:
        true
    },


    target: {

      sport:
        TARGET_SPORT,

      period:
        TARGET_PERIOD,

      outcome:
        TARGET_OUTCOME,

      line:
        TARGET_LINE
    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        TOKEN_TEAM_MIN_SCORE,

      exact_id_alone_is_not_secure:
        true,

      exact_id_requires_positive_matcher_score:
        true,

      required_match_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      required_secure_match:
        REQUIRED_SECURE_MATCH,

      two_sided_team_validation:
        true,

      cloudbet_second_verification:
        true
    },


    tracker: {

      endpoint:
        "/entries",

      total_signals:
        allSignals.length,

      hunter_entries:
        hunterEntries.length
    },


    matcher: {

      called:
        true,

      success:
        matcherData?.success === true,

      version:
        matcherData?.version ??
        null,

      confident_matched:
        matcherData?.confident_matched ??
        matcherData?.confidentMatches ??
        null,

      candidates_detected:
        matcherData?.candidates_detected ??
        matcherMatches.length,

      secure_matches:
        matcherSecureMatches,

      candidates_available:
        matcherMatches.length
    },


    cloudbet: {

      called:
        true,

      raw_matches:
        rawCloudbet.length,

      live_matches:
        liveCloudbet.length,

      verified_matches:
        cloudbetVerifiedMatches
    },


    stats: {

      signals_received:
        allSignals.length,

      hunter_entries:
        hunterEntries.length,

      matcher_secure_matches:
        matcherSecureMatches,

      cloudbet_verified_matches:
        cloudbetVerifiedMatches,

      bets_ready:
        preparedBets.length,

      no_match:
        noMatch.length,

      matcher_candidates:
        matcherMatches.length,

      processing_ms:
        Date.now() -
        started
    },


    diagnostics: {

      rejection_reasons:
        rejectionReasons,

      signals_with_matcher_failure:
        noMatch.filter(
          x =>
            x.reason ===
            "NO_SECURE_CONFIDENT_TWO_SIDED_MATCH"
        ).length,

      signals_with_cloudbet_failure:
        noMatch.filter(
          x =>
            String(
              x.reason ??
              ""
            ).startsWith(
              "CLOUDBET_"
            )
        ).length
    },


    optimization: {

      version:
        VERSION,

      tracker_calls:
        1,

      matcher_calls:
        1,

      cloudbet_live_calls:
        1,

      cloudbet_reused_for_all_signals:
        true,

      sequential_cloudbet_calls_per_signal:
        false
    },


    prepared_bets:
      preparedBets,


    no_match:
      noMatch,


    message:
      "V4.3 READ ONLY secure signal-to-matcher-to-Cloudbet preparation worker. Matcher candidates are selected per Hunter signal before strict security validation. No bet can be placed.",


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
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",


    bindings: {

      TRACKER:
        true,

      MATCHER:
        true,

      CLOUDBET:
        true
    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      exact_id_alone_is_secure:
        false,

      exact_id_requires_positive_matcher_score:
        true,

      required_match_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      two_sided_team_validation:
        true,

      cloudbet_second_verification:
        true,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE
    },


    optimization: {

      version:
        VERSION,

      tracker_calls:
        1,

      matcher_calls:
        1,

      cloudbet_live_calls:
        1,

      cloudbet_reused_for_all_signals:
        true
    },


    endpoints: {

      tracker:
        "/entries",

      matcher:
        "/match",

      cloudbet:
        "/live"
    },


    rules: {

      no_active_signals:
        "NO MATCHER CALL / NO CLOUDBET CALL / NO BET",

      matcher:
        "CONFIDENT_MATCH required",

      candidate_selection:
        "Candidate must belong to current Hunter signal",

      exact_id:
        "EXACT_ID alone is not sufficient",

      matcher_score:
        "EXACT_ID with matcher score 0 is rejected",

      score_only:
        "score_only_match is always rejected",

      teams:
        "Both home and away must be present and compatible",

      cloudbet:
        "Cloudbet live event must be independently verified",

      cloudbet_fetch:
        "Cloudbet /live is called once per worker execution",

      betting:
        "DISABLED"
    },


    message:
      "V4.3 secure matcher candidate selection worker is healthy.",


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
        ) ||
      "/";


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
      // MATCH / PREPARE
      // ------------------------------------------------------

      if (
        path === "/match" ||
        path === "/live" ||
        path === "/bet"
      ) {

        return runV4(
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

        return runV4(
          env,
          request
        );
      }


      // ------------------------------------------------------
      // UNKNOWN
      // ------------------------------------------------------

      return json(

        {

          success:
            false,

          worker:
            "cloudbet-bet-worker",

          version:
            VERSION,

          mode:
            MODE,

          error:
            "Unknown endpoint",

          available_endpoints: [

            "/",

            "/health",

            "/match",

            "/live",

            "/bet",

            "/diagnostic"
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
            "cloudbet-bet-worker",

          version:
            VERSION,

          mode:
            MODE,

          betting:
            "DISABLED",

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
