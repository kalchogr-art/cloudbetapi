// ============================================================
// CLOUDBET BET WORKER V4
// HUNTER TRACKER -> MATCHER V7-FH -> CLOUDBET
//
// V4 SECURE MATCH FIX:
// - FIXED HUNTER TRACKER -> MATCHER CONNECTION
// - Keeps Hunter entry minute unchanged
// - Keeps Hunter score unchanged
// - Supports V7-FH matcher response structures
// - Supports nested matcher candidates
// - Supports V27 / Cloudbet IDs
// - Supports exact normalized match name
// - Supports exact HOME + AWAY matching
// - Supports token HOME + AWAY matching
// - Matcher scoring is used ONLY as secondary confirmation
// - Matcher score alone CANNOT produce READY
// - Prevents unsafe score-only Cloudbet match selection
// - READ ONLY
// - NO REAL BET
//
// FLOW:
//
// HUNTER TRACKER
//       ↓
//   HUNTER ENTRY
//       ↓
//    BET WORKER V4
//       ↓
//   MATCHER V7-FH
//       ↓
//   SECURE MATCH VALIDATION
//       ↓
//   MATCHED V27/CLOUDBET
//       ↓
// FIRST_HALF OVER 0.5
//       ↓
//     READ ONLY
// ============================================================


interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
}


type AnyObj = Record<string, any>;


// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "V4";

const SPORT = "SOCCER";

const PERIOD = "FIRST_HALF";

const OUTCOME = "OVER";

const LINE = 0.5;

// Minimum matcher score used only as secondary confirmation
const MATCHER_MIN_SCORE = 0.45;


// ============================================================
// TRACKER ENDPOINTS
// ============================================================

const TRACKER_ENDPOINTS = [
  "/entries",
  "/"
];


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
      `HTTP ${response.status}: ${text.slice(0, 500)}`
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
// ARRAY
// ============================================================

function asArray(
  value: any
): AnyObj[] {

  return Array.isArray(value)
    ? value
    : [];
}


// ============================================================
// TRACKER SIGNAL EXTRACTION
// ============================================================

function extractSignals(
  data: AnyObj
): AnyObj[] {

  const possibleArrays = [

    data?.entries,

    data?.hunter_entries,

    data?.hunterEntries,

    data?.hunter_signals,

    data?.hunterSignals,

    data?.signals,

    data?.candidates,

    data?.results

  ];


  for (
    const value of possibleArrays
  ) {

    const arr =
      asArray(value);


    if (
      arr.length > 0
    ) {

      return arr;
    }
  }


  if (
    data?.entry &&
    typeof data.entry === "object"
  ) {

    return [
      data.entry
    ];
  }


  if (
    data?.hunter_entry &&
    typeof data.hunter_entry === "object"
  ) {

    return [
      data.hunter_entry
    ];
  }


  return [];
}


// ============================================================
// HUNTER ENTRY CHECK
// ============================================================

function isHunterEntry(
  signal: AnyObj
): boolean {

  if (
    signal?.is_hunter_entry === true ||
    signal?.isHunterEntry === true ||
    signal?.hunter_entry === true ||
    signal?.hunterEntry === true
  ) {

    return true;
  }


  const values = [

    signal?.type,
    signal?.signal,
    signal?.action,
    signal?.status,
    signal?.event,
    signal?.result,
    signal?.signal_type,
    signal?.signalType

  ]
    .filter(
      value =>
        value !== undefined &&
        value !== null
    )
    .map(
      value =>
        String(value).toUpperCase()
    );


  return values.some(
    value =>
      value === "ENTRY" ||
      value === "HUNTER_ENTRY" ||
      value.includes("HUNTER ENTRY") ||
      value.includes("HUNTER_ENTRY") ||
      value.includes("ENTRY")
  );
}


// ============================================================
// MATCH NAME
// ============================================================

function signalMatchName(
  signal: AnyObj
): string {

  return String(

    signal?.match ??

    signal?.match_name ??

    signal?.matchName ??

    signal?.fixture ??

    signal?.fixture_name ??

    signal?.fixtureName ??

    signal?.event_name ??

    signal?.eventName ??

    signal?.name ??

    ""

  ).trim();
}


// ============================================================
// MATCH ID
// ============================================================

function signalMatchId(
  signal: AnyObj
): string | null {

  const value =

    signal?.match_id ??

    signal?.matchId ??

    signal?.fixture_id ??

    signal?.fixtureId ??

    signal?.event_id ??

    signal?.eventId ??

    signal?.v27_id ??

    signal?.v27Id;


  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {

    return null;
  }


  return String(value);
}


// ============================================================
// HOME
// ============================================================

function signalHome(
  signal: AnyObj
): string {

  return String(

    signal?.home ??

    signal?.home_team ??

    signal?.homeTeam ??

    signal?.home_name ??

    signal?.homeName ??

    signal?.v27?.home ??

    signal?.v27?.home_team ??

    ""

  ).trim();
}


// ============================================================
// AWAY
// ============================================================

function signalAway(
  signal: AnyObj
): string {

  return String(

    signal?.away ??

    signal?.away_team ??

    signal?.awayTeam ??

    signal?.away_name ??

    signal?.awayName ??

    signal?.v27?.away ??

    signal?.v27?.away_team ??

    ""

  ).trim();
}


// ============================================================
// MINUTE
// ============================================================

function signalMinute(
  signal: AnyObj
): number | null {

  const value =

    signal?.entry_minute ??

    signal?.entryMinute ??

    signal?.hunter_entry_minute ??

    signal?.hunterEntryMinute ??

    signal?.minute ??

    signal?.match_minute ??

    signal?.matchMinute ??

    signal?.entry;


  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {

    return Math.floor(value);
  }


  const text =
    String(value ?? "");


  const match =
    text.match(
      /(\d{1,3})/
    );


  if (!match) {

    return null;
  }


  const minute =
    Number(match[1]);


  return Number.isFinite(minute)
    ? minute
    : null;
}


// ============================================================
// HUNTER SCORE
// ============================================================

function signalHunterScore(
  signal: AnyObj
): number | null {

  const value =

    signal?.hunter_score ??

    signal?.hunterScore ??

    signal?.hunter_score_value ??

    signal?.hunterScoreValue;


  const direct =
    Number(value);


  if (
    Number.isFinite(direct)
  ) {

    return direct;
  }


  if (
    typeof signal?.score === "number"
  ) {

    return signal.score;
  }


  const nested =
    Number(
      signal?.score?.hunter ??
      signal?.score?.hunter_score ??
      signal?.score?.value
    );


  if (
    Number.isFinite(nested)
  ) {

    return nested;
  }


  return null;
}


// ============================================================
// SCORE / RESULT
// ============================================================

function signalScore(
  signal: AnyObj
): any {

  return (

    signal?.score_result ??

    signal?.result_score ??

    signal?.score ??

    signal?.result ??

    null

  );
}


// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(
  value: any
): string {

  return String(
    value ?? ""
  )
    .toLowerCase()
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\([^)]*\)/g,
      " "
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
// REMOVE COUNTRY / BRACKET NOISE
// ============================================================

function cleanTeamName(
  value: any
): string {

  return normalizeText(
    String(value ?? "")
      .replace(
        /\([^)]*\)/g,
        " "
      )
  );
}


// ============================================================
// GET MATCH NAME FROM ANY OBJECT
// ============================================================

function objectMatchName(
  item: AnyObj
): string {

  const direct = [

    item?.match,

    item?.match_name,

    item?.matchName,

    item?.fixture,

    item?.fixture_name,

    item?.fixtureName,

    item?.event_name,

    item?.eventName,

    item?.name,

    item?.title

  ];


  for (
    const value of direct
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      return String(value).trim();
    }
  }


  const nested = [

    item?.v27?.match,

    item?.v27?.match_name,

    item?.v27?.matchName,

    item?.cloudbet?.match,

    item?.cloudbet?.match_name,

    item?.cloudbet?.matchName

  ];


  for (
    const value of nested
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      return String(value).trim();
    }
  }


  return "";
}


// ============================================================
// GET HOME FROM ANY OBJECT
// ============================================================

function objectHome(
  item: AnyObj
): string {

  const values = [

    item?.home,
    item?.home_team,
    item?.homeTeam,
    item?.home_name,
    item?.homeName,

    item?.v27?.home,
    item?.v27?.home_team,
    item?.v27?.homeTeam,
    item?.v27?.home_name,

    item?.cloudbet?.home,
    item?.cloudbet?.home_team,
    item?.cloudbet?.homeTeam,
    item?.cloudbet?.home_name

  ];


  for (
    const value of values
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      return String(value).trim();
    }
  }


  return "";
}


// ============================================================
// GET AWAY FROM ANY OBJECT
// ============================================================

function objectAway(
  item: AnyObj
): string {

  const values = [

    item?.away,
    item?.away_team,
    item?.awayTeam,
    item?.away_name,
    item?.awayName,

    item?.v27?.away,
    item?.v27?.away_team,
    item?.v27?.awayTeam,
    item?.v27?.away_name,

    item?.cloudbet?.away,
    item?.cloudbet?.away_team,
    item?.cloudbet?.awayTeam,
    item?.cloudbet?.away_name

  ];


  for (
    const value of values
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      return String(value).trim();
    }
  }


  return "";
}


// ============================================================
// OBJECT ID
// ============================================================

function objectId(
  item: AnyObj
): string | null {

  const values = [

    item?.match_id,
    item?.matchId,

    item?.fixture_id,
    item?.fixtureId,

    item?.event_id,
    item?.eventId,

    item?.v27_id,
    item?.v27Id,

    item?.id,

    item?.v27?.id,
    item?.v27?.match_id,
    item?.v27?.matchId,

    item?.cloudbet?.id,
    item?.cloudbet?.match_id,
    item?.cloudbet?.matchId

  ];


  for (
    const value of values
  ) {

    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {

      return String(value).trim();
    }
  }


  return null;
}


// ============================================================
// MATCHER CANDIDATE EXTRACTION
// ============================================================
//
// V7-FH can expose matches in different structures.
// We collect all object candidates recursively.
//
// ============================================================

function extractMatcherCandidates(
  data: any
): AnyObj[] {

  const result: AnyObj[] = [];

  const seen =
    new Set<any>();


  function walk(
    value: any,
    depth: number
  ) {

    if (
      depth > 8 ||
      value === null ||
      value === undefined
    ) {

      return;
    }


    if (
      typeof value !== "object"
    ) {

      return;
    }


    if (
      seen.has(value)
    ) {

      return;
    }


    seen.add(value);


    if (
      !Array.isArray(value)
    ) {

      const name =
        objectMatchName(value);


      const id =
        objectId(value);


      const home =
        objectHome(value);


      const away =
        objectAway(value);


      if (
        name ||
        id ||
        home ||
        away
      ) {

        result.push(
          value
        );
      }
    }


    if (
      Array.isArray(value)
    ) {

      for (
        const item of value
      ) {

        walk(
          item,
          depth + 1
        );
      }

      return;
    }


    for (
      const key of Object.keys(value)
    ) {

      walk(
        value[key],
        depth + 1
      );
    }

  }


  walk(
    data,
    0
  );


  return result;
}


// ============================================================
// MATCHER SCORING
// ============================================================

function getMatcherScore(
  item: AnyObj
): number {

  const values = [

    item?.score,

    item?.confidence,

    item?.match_score,

    item?.matchScore,

    item?.similarity,

    item?.scoring?.score,

    item?.scoring?.confidence,

    item?.scoring?.similarity,

    item?.matcher_score,

    item?.matcherScore

  ];


  for (
    const value of values
  ) {

    const n =
      Number(value);


    if (
      Number.isFinite(n)
    ) {

      return n;
    }
  }


  return 0;
}


// ============================================================
// ID MATCH
// ============================================================

function idMatches(
  signalId: string | null,
  item: AnyObj
): boolean {

  if (!signalId)
    return false;


  const candidateId =
    objectId(item);


  if (!candidateId)
    return false;


  return (
    candidateId === signalId
  );
}


// ============================================================
// NAME MATCH
// ============================================================

function nameMatches(
  signalName: string,
  item: AnyObj
): boolean {

  if (!signalName)
    return false;


  const source =
    normalizeText(
      signalName
    );


  const candidate =
    normalizeText(
      objectMatchName(item)
    );


  if (
    !source ||
    !candidate
  ) {

    return false;
  }


  return (
    source === candidate
  );
}


// ============================================================
// TEAM MATCH
// ============================================================

function teamsMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const signalHomeName =
    cleanTeamName(
      signalHome(signal)
    );


  const signalAwayName =
    cleanTeamName(
      signalAway(signal)
    );


  const candidateHome =
    cleanTeamName(
      objectHome(item)
    );


  const candidateAway =
    cleanTeamName(
      objectAway(item)
    );


  if (
    !signalHomeName ||
    !signalAwayName ||
    !candidateHome ||
    !candidateAway
  ) {

    return false;
  }


  return (

    signalHomeName ===
    candidateHome &&

    signalAwayName ===
    candidateAway

  );
}


// ============================================================
// TOKEN MATCH
// ============================================================

function tokenTeamMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const signalHomeName =
    cleanTeamName(
      signalHome(signal)
    );


  const signalAwayName =
    cleanTeamName(
      signalAway(signal)
    );


  const candidateHome =
    cleanTeamName(
      objectHome(item)
    );


  const candidateAway =
    cleanTeamName(
      objectAway(item)
    );


  if (
    !signalHomeName ||
    !signalAwayName ||
    !candidateHome ||
    !candidateAway
  ) {

    return false;
  }


  const homeOK =
    signalHomeName.includes(
      candidateHome
    ) ||
    candidateHome.includes(
      signalHomeName
    );


  const awayOK =
    signalAwayName.includes(
      candidateAway
    ) ||
    candidateAway.includes(
      signalAwayName
    );


  return (
    homeOK &&
    awayOK
  );
}


// ============================================================
// SECURE MATCH RESULT
// ============================================================
//
// Returns:
// - matched object
// - match method
// - matcher score
//
// SECURITY RULE:
//
// Matcher score alone is NEVER enough.
//
// Allowed:
//
// 1. EXACT_ID
// 2. EXACT_NAME
// 3. EXACT_TEAMS
// 4. TOKEN_TEAMS + score >= 0.45
//
// This prevents an unrelated Cloudbet match from becoming READY
// merely because the matcher returned a high numerical score.
// ============================================================

interface MatchResult {
  matched: AnyObj | null;
  method: string;
  matcherScore: number;
}


// ============================================================
// FIND MATCHER MATCH
// ============================================================

function findMatcherMatch(
  signal: AnyObj,
  matcherData: AnyObj
): MatchResult {

  const candidates =
    extractMatcherCandidates(
      matcherData
    );


  const signalId =
    signalMatchId(signal);


  const signalName =
    signalMatchName(signal);


  // ----------------------------------------------------------
  // 1. EXACT ID
  // ----------------------------------------------------------

  if (
    signalId
  ) {

    for (
      const item of candidates
    ) {

      if (
        idMatches(
          signalId,
          item
        )
      ) {

        return {

          matched:
            item,

          method:
            "EXACT_ID",

          matcherScore:
            getMatcherScore(
              item
            )

        };
      }
    }
  }


  // ----------------------------------------------------------
  // 2. EXACT NORMALIZED NAME
  // ----------------------------------------------------------

  if (
    signalName
  ) {

    for (
      const item of candidates
    ) {

      if (
        nameMatches(
          signalName,
          item
        )
      ) {

        return {

          matched:
            item,

          method:
            "EXACT_NAME",

          matcherScore:
            getMatcherScore(
              item
            )

        };
      }
    }
  }


  // ----------------------------------------------------------
  // 3. EXACT HOME + AWAY
  // ----------------------------------------------------------

  for (
    const item of candidates
  ) {

    if (
      teamsMatch(
        signal,
        item
      )
    ) {

      return {

        matched:
          item,

        method:
          "EXACT_TEAMS",

        matcherScore:
          getMatcherScore(
            item
          )

      };
    }
  }


  // ----------------------------------------------------------
  // 4. TOKEN HOME + AWAY
  //
  // IMPORTANT:
  // Token match MUST also have sufficient Matcher score.
  // ----------------------------------------------------------

  let bestTokenMatch:
    AnyObj | null = null;

  let bestTokenScore =
    0;


  for (
    const item of candidates
  ) {

    if (
      !tokenTeamMatch(
        signal,
        item
      )
    ) {

      continue;
    }


    const score =
      getMatcherScore(
        item
      );


    if (
      score > bestTokenScore
    ) {

      bestTokenScore =
        score;

      bestTokenMatch =
        item;
    }
  }


  if (
    bestTokenMatch &&
    bestTokenScore >=
      MATCHER_MIN_SCORE
  ) {

    return {

      matched:
        bestTokenMatch,

      method:
        "TOKEN_TEAMS_SCORE_CONFIRMED",

      matcherScore:
        bestTokenScore

    };
  }


  // ----------------------------------------------------------
  // 5. SCORE-ONLY MATCH
  //
  // DISABLED FOR SECURITY.
  //
  // A high score without matching identity/team information
  // cannot safely identify the Cloudbet event.
  // ----------------------------------------------------------

  return {

    matched:
      null,

    method:
      "NO_SECURE_MATCH",

    matcherScore:
      0

  };
}


// ============================================================
// CLOUDABET DATA EXTRACTION
// ============================================================

function extractCloudbet(
  matched: AnyObj | null
): AnyObj | null {

  if (!matched)
    return null;


  // ----------------------------------------------------------
  // Direct Cloudbet object
  // ----------------------------------------------------------

  if (
    matched.cloudbet &&
    typeof matched.cloudbet === "object"
  ) {

    return matched.cloudbet;
  }


  // ----------------------------------------------------------
  // Direct cloudbet_match object
  // ----------------------------------------------------------

  if (
    matched.cloudbet_match &&
    typeof matched.cloudbet_match === "object"
  ) {

    return matched.cloudbet_match;
  }


  // ----------------------------------------------------------
  // Direct Cloudbet data
  // ----------------------------------------------------------

  if (
    matched.cloudbet_match_data &&
    typeof matched.cloudbet_match_data === "object"
  ) {

    return matched.cloudbet_match_data;
  }


  // ----------------------------------------------------------
  // Sometimes matcher returns object under "match"
  // ----------------------------------------------------------

  if (
    matched.match &&
    typeof matched.match === "object"
  ) {

    if (
      matched.match.cloudbet
    ) {

      return matched.match.cloudbet;
    }
  }


  // ----------------------------------------------------------
  // Recursive Cloudbet search
  // ----------------------------------------------------------

  const seen =
    new Set<any>();


  function search(
    value: any,
    depth: number
  ): AnyObj | null {

    if (
      depth > 6 ||
      value === null ||
      value === undefined ||
      typeof value !== "object"
    ) {

      return null;
    }


    if (
      seen.has(value)
    ) {

      return null;
    }


    seen.add(value);


    if (
      !Array.isArray(value)
    ) {

      for (
        const key of Object.keys(value)
      ) {

        if (
          key.toLowerCase()
            .includes("cloudbet")
        ) {

          const candidate =
            value[key];


          if (
            candidate &&
            typeof candidate === "object"
          ) {

            return candidate;
          }
        }
      }
    }


    if (
      Array.isArray(value)
    ) {

      for (
        const item of value
      ) {

        const found =
          search(
            item,
            depth + 1
          );


        if (found)
          return found;
      }


      return null;
    }


    for (
      const key of Object.keys(value)
    ) {

      const found =
        search(
          value[key],
          depth + 1
        );


      if (found)
        return found;
    }


    return null;
  }


  return search(
    matched,
    0
  );
}


// ============================================================
// PREPARE BET
// ============================================================

function prepareBet(
  signal: AnyObj,
  matchResult: MatchResult
): AnyObj {

  const matched =
    matchResult.matched;


  const cloudbet =
    extractCloudbet(
      matched
    );


  const matcherScore =
    matched
      ? getMatcherScore(
          matched
        )
      : matchResult.matcherScore;


  // ----------------------------------------------------------
  // SECURITY CHECK
  //
  // A matcher object is READY only when:
  //
  // 1. It passed secure identity validation
  // 2. A Cloudbet object can actually be extracted
  //
  // This prevents a partial matcher object from being exposed
  // as a usable Cloudbet betting target.
  // ----------------------------------------------------------

  const secureReady =
    !!matched &&
    !!cloudbet;


  return {

    status:
      secureReady
        ? "READY"
        : "NO_MATCH",


    betting:
      "DISABLED",


    sport:
      SPORT,


    period:
      PERIOD,


    outcome:
      OUTCOME,


    line:
      LINE,


    signal: {

      type:
        signal?.type ??
        signal?.signal ??
        signal?.action ??
        "HUNTER_ENTRY",

      match:
        signalMatchName(
          signal
        ),

      match_id:
        signalMatchId(
          signal
        ),

      home:
        signalHome(
          signal
        ),

      away:
        signalAway(
          signal
        ),

      entry_minute:
        signalMinute(
          signal
        ),

      hunter_score:
        signalHunterScore(
          signal
        ),

      score:
        signalScore(
          signal
        )

    },


    cloudbet:
      cloudbet
        ? {

            id:
              cloudbet?.id ??
              null,

            key:
              cloudbet?.key ??
              null,

            match:
              cloudbet?.match ??
              cloudbet?.name ??
              null,

            home:
              cloudbet?.home ??
              cloudbet?.home_team ??
              null,

            away:
              cloudbet?.away ??
              cloudbet?.away_team ??
              null,

            status:
              cloudbet?.status ??
              null,

            minute:
              cloudbet?.minute ??
              null,

            score:
              cloudbet?.score ??
              null,

            competition:
              cloudbet?.competition ??
              cloudbet?.league ??
              null

          }

        : null,


    matcher_scoring:
      matched?.scoring ??
      (
        matched
          ? {
              score:
                matcherScore
            }
          : {
              score:
                null
            }
      ),


    matcher_match:
      matched
        ? {

            id:
              objectId(
                matched
              ),

            match:
              objectMatchName(
                matched
              ),

            home:
              objectHome(
                matched
              ),

            away:
              objectAway(
                matched
              ),

            match_method:
              matchResult.method,

            matcher_score:
              matcherScore

          }

        : null,


    security: {

      secure_match:
        secureReady,

      match_method:
        matchResult.method,

      score_only_match:
        false,

      minimum_score_for_token_match:
        MATCHER_MIN_SCORE

    },


    action:
      "NO_BET_IN_V4"

  };
}


// ============================================================
// FETCH TRACKER
// ============================================================

async function fetchTracker(
  env: Env
): Promise<{
  data: AnyObj | null;
  endpoint: string | null;
  signals: AnyObj[];
  attempts: AnyObj[];
}> {

  const attempts:
    AnyObj[] = [];


  for (
    const endpoint of TRACKER_ENDPOINTS
  ) {

    try {

      const data =
        await fetchServiceJSON(
          env.TRACKER,
          endpoint
        );


      const signals =
        extractSignals(
          data
        );


      attempts.push({

        endpoint,

        success:
          true,

        extracted:
          signals.length,

        keys:
          Object.keys(
            data ?? {}
          )
          .slice(
            0,
            30
          )

      });


      if (
        signals.length > 0
      ) {

        return {

          data,

          endpoint,

          signals,

          attempts

        };
      }


    } catch (
      error: any
    ) {

      attempts.push({

        endpoint,

        success:
          false,

        error:
          error?.message ??
          String(error)

      });
    }
  }


  return {

    data:
      null,

    endpoint:
      null,

    signals:
      [],

    attempts

  };
}


// ============================================================
// MATCHER
// ============================================================

async function runMatcher(
  env: Env
): Promise<any> {

  return fetchServiceJSON(
    env.MATCHER,
    "/match"
  );
}


// ============================================================
// PROCESS
// ============================================================

async function process(
  env: Env
): Promise<Response> {

  const started =
    Date.now();


  // ----------------------------------------------------------
  // TRACKER
  // ----------------------------------------------------------

  const tracker =
    await fetchTracker(
      env
    );


  const allSignals =
    tracker.signals;


  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );


  // ----------------------------------------------------------
  // NO ENTRY
  // ----------------------------------------------------------

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
        "READ_ONLY",

      betting:
        "DISABLED",


      tracker: {

        endpoint:
          tracker.endpoint,

        signals:
          allSignals.length,

        hunter_entries:
          0,

        attempts:
          tracker.attempts

      },


      target: {

        sport:
          SPORT,

        period:
          PERIOD,

        outcome:
          OUTCOME,

        line:
          LINE

      },


      bets_ready:
        0,


      message:
        "No Hunter ENTRY signal available.",


      diagnostics: {

        tracker_endpoints_checked:
          TRACKER_ENDPOINTS,

        tracker_attempts:
          tracker.attempts

      },


      processing_ms:
        Date.now() -
        started,


      timestamp:
        new Date()
          .toISOString()

    });
  }


  // ----------------------------------------------------------
  // MATCHER
  // ----------------------------------------------------------

  const matcherData =
    await runMatcher(
      env
    );


  // ----------------------------------------------------------
  // MATCHER CANDIDATES
  // ----------------------------------------------------------

  const matcherCandidates =
    extractMatcherCandidates(
      matcherData
    );


  // ----------------------------------------------------------
  // PREPARE
  // ----------------------------------------------------------

  const prepared:
    AnyObj[] = [];


  for (
    const signal of hunterEntries
  ) {

    const matchResult =
      findMatcherMatch(
        signal,
        matcherData
      );


    prepared.push(
      prepareBet(
        signal,
        matchResult
      )
    );
  }


  const ready =
    prepared.filter(
      item =>
        item.status ===
        "READY"
    );


  // ----------------------------------------------------------
  // RESPONSE
  // ----------------------------------------------------------

  return json({

    success:
      true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      "READ_ONLY",

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
        SPORT,

      period:
        PERIOD,

      outcome:
        OUTCOME,

      line:
        LINE

    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        MATCHER_MIN_SCORE

    },


    tracker: {

      endpoint:
        tracker.endpoint,

      total_signals:
        allSignals.length,

      hunter_entries:
        hunterEntries.length

    },


    matcher: {

      success:
        matcherData?.success ??
        false,

      version:
        matcherData?.version ??
        null,

      confident_matched:
        matcherData?.stats
          ?.confident_matched ??
        asArray(
          matcherData?.matches
        ).length,

      candidates_detected:
        matcherCandidates.length

    },


    stats: {

      signals_received:
        hunterEntries.length,

      bets_ready:
        ready.length,

      no_match:
        prepared.length -
        ready.length,

      processing_ms:
        Date.now() -
        started

    },


    prepared_bets:
      prepared,


    message:
      "READ ONLY secure betting preparation worker. No bet can be placed.",


    timestamp:
      new Date()
        .toISOString()

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
      "READ_ONLY",

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
        SPORT,

      period:
        PERIOD,

      outcome:
        OUTCOME,

      line:
        LINE

    },


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        MATCHER_MIN_SCORE

    },


    message:
      "READ ONLY secure betting preparation worker. No bet can be placed.",


    timestamp:
      new Date()
        .toISOString()

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
      // PREPARE
      // ------------------------------------------------------

      if (
        path === "/prepare" ||
        path === "/bet" ||
        path === "/entries"
      ) {

        return process(
          env
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

          error:
            "Unknown endpoint",

          available_endpoints: [

            "/",

            "/health",

            "/prepare",

            "/bet",

            "/entries"

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
            "READ_ONLY",

          betting:
            "DISABLED",

          error:
            error?.message ??
            String(error),

          timestamp:
            new Date()
              .toISOString()

        },

        500

      );
    }
  }
};
