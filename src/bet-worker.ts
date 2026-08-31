// ============================================================
// CLOUDBET BET WORKER V4.2
// SECURE SIGNAL -> MATCHER -> CLOUDBET PIPELINE
//
// V4.2 SPEED OPTIMIZATION
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
// - TWO-SIDED TEAM VALIDATION IS REQUIRED
// - CLOUDBET IS FETCHED ONLY ONCE
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
  "V4.2";

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
    match?.key
  );
}


// ============================================================
// TEAM NORMALIZATION
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


  return [];
}


// ============================================================
// SECURE MATCH VALIDATION
//
// REQUIRED:
//
// 1. matcher success
// 2. CONFIDENT_MATCH
// 3. secure_match=true
// 4. score_only_match=false
// 5. valid matcher match
// 6. both teams present
// 7. signal teams compatible
// 8. Cloudbet candidate exists
// 9. EXACT_ID + score 0 rejected
// ============================================================

function validateSecureMatcherResult(
  signal: AnyObj,
  matcherResult: AnyObj
): AnyObj {

  const matches =
    extractMatcherMatches(
      matcherResult
    );


  const confidentFromRoot =
    Number(
      matcherResult?.confident_matched ??
      matcherResult?.confidentMatches ??
      0
    );


  const rootSuccess =
    matcherResult?.success === true;


  if (
    !rootSuccess
  ) {

    return {

      secure:
        false,

      reason:
        "MATCHER_NOT_SUCCESSFUL"
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


  let selected:
    AnyObj | null = null;


  for (
    const item
    of candidates
  ) {

    const v27 =
      item?.v27 ??
      item?.source ??
      item;


    const cloudbet =
      item?.cloudbet ??
      item?.matched ??
      item?.target ??
      null;


    const classification =
      safeString(
        item?.classification ??
        item?.match_classification
      ).toUpperCase();


    const reason =
      safeString(
        item?.reason
      );


    const security =
      item?.security ??
      {};


    const scoring =
      item?.scoring ??
      item?.matcher_scoring ??
      {};


    const matcherScore =
      Number(
        scoring?.total ??
        scoring?.score ??
        item?.matcher_score ??
        item?.score ??
        0
      );


    const method =
      safeString(
        item?.match_method ??
        item?.method ??
        security?.match_method
      ).toUpperCase();


    const secureFlag =
      security?.secure_match === true ||
      item?.secure_match === true;


    const scoreOnly =
      security?.score_only_match === true ||
      item?.score_only_match === true;


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


    // --------------------------------------------------------
    // CLASSIFICATION
    // --------------------------------------------------------

    if (
      classification !==
      REQUIRED_MATCH_CLASSIFICATION
    ) {

      continue;
    }


    // --------------------------------------------------------
    // SCORE ONLY
    // --------------------------------------------------------

    if (
      scoreOnly
    ) {

      continue;
    }


    // --------------------------------------------------------
    // SECURE FLAG
    // --------------------------------------------------------

    if (
      !secureFlag
    ) {

      continue;
    }


    // --------------------------------------------------------
    // V27 TEAMS
    // --------------------------------------------------------

    if (
      !teamsPresent(
        vHome,
        vAway
      )
    ) {

      continue;
    }


    // --------------------------------------------------------
    // CLOUDBET TEAMS
    // --------------------------------------------------------

    if (
      !cloudbet ||
      !teamsPresent(
        cHome,
        cAway
      )
    ) {

      continue;
    }


    // --------------------------------------------------------
    // EXACT ID SECURITY
    // --------------------------------------------------------

    if (
      method ===
      "EXACT_ID" &&
      matcherScore <= 0
    ) {

      continue;
    }


    // --------------------------------------------------------
    // SIGNAL -> V27 DIRECTION
    // --------------------------------------------------------

    const sHome =
      signalHome(
        signal
      );


    const sAway =
      signalAway(
        signal
      );


    if (
      sHome &&
      sAway
    ) {

      const normalDirection =
        sameNormalizedTeam(
          sHome,
          vHome
        ) &&
        sameNormalizedTeam(
          sAway,
          vAway
        );


      if (
        !normalDirection
      ) {

        continue;
      }
    }


    selected = {

      item,

      classification,

      method,

      matcher_score:
        matcherScore,

      secure_match:
        true,

      score_only_match:
        false,

      reason,

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
          vHome,

        away:
          vAway
      },

      cloudbet: {

        id:
          extractMatchId(
            cloudbet
          ),

        match:
          displayMatch(
            cloudbet
          ),

        home:
          cHome,

        away:
          cAway
      }
    };


    break;
  }


  if (
    !selected
  ) {

    return {

      secure:
        false,

      reason:
        "NO_SECURE_CONFIDENT_TWO_SIDED_MATCH",

      matcher_confident_matched:
        confidentFromRoot
    };
  }


  return {

    secure:
      true,

    reason:
      "SECURE_CONFIDENT_MATCH",

    ...selected
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
        secureMatcher.reason
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

        tracker_calls:
          1,

        matcher_calls:
          0,

        cloudbet_live_calls:
          0
      },


      message:
        "No active HUNTER_ENTRY signals. No matcher or Cloudbet verification was performed. No bet can be placed.",


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
  //
  // THIS IS THE MAIN V4.2 SPEED FIX.
  //
  // OLD:
  //
  // for every secure signal:
  //     CLOUDBET /live
  //
  // NEW:
  //
  // CLOUDBET /live ONCE
  // then reuse liveCloudbet
  // for every signal.
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
  // PROCESS EVERY HUNTER SIGNAL
  // LOCALLY
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

      noMatch.push({

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
            null,

          score:
            signal?.score ??
            null
        },


        cloudbet:
          null,


        matcher_scoring: {

          score:
            0
        },


        matcher_match:
          null,


        security: {

          secure_match:
            false,

          match_method:
            null,

          score_only_match:
            false,

          cloudbet_verified:
            false,

          minimum_score_for_token_match:
            TOKEN_TEAM_MIN_SCORE
        },


        action:
          "NO_BET_IN_V4",


        reason:
          secureMatcher.reason
      });


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
    //
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

      noMatch.push({

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
            null,

          score:
            signal?.score ??
            null
        },


        cloudbet:
          null,


        matcher_scoring: {

          score:
            secureMatcher.matcher_score
        },


        matcher_match:
          secureMatcher.cloudbet ??
          null,


        security: {

          secure_match:
            true,

          match_method:
            secureMatcher.method,

          score_only_match:
            false,

          cloudbet_verified:
            false,

          minimum_score_for_token_match:
            TOKEN_TEAM_MIN_SCORE
        },


        action:
          "NO_BET_IN_V4",


        reason:
          cloudbetVerification.reason
      });


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
        matcherSecureMatches,

      candidates_detected:
        matcherData?.candidates_detected ??
        null,

      secure_matches:
        matcherSecureMatches
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
      "READ ONLY optimized secure betting preparation worker. Cloudbet /live is fetched once and reused for all signals. No bet can be placed.",


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
      "V4.2 optimized secure signal-to-matcher-to-Cloudbet preparation worker is healthy.",


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
