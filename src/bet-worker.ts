// ============================================================
// CLOUDBET BET WORKER V4
// HUNTER TRACKER -> MATCHER V7-FH -> CLOUDBET
//
// V4 SECURE CONNECTION FIX
//
// FIXES:
// 1. NO ACTIVE SIGNALS:
//    - MATCHER is NOT called
//    - CLOUDBET is NOT called
//    - returns NO_ACTIVE_SIGNALS immediately
//
// 2. SECURE MATCHING:
//    - EXACT ID has highest priority
//    - EXACT normalized match name
//    - EXACT HOME + AWAY
//    - TOKEN HOME + AWAY only with minimum score
//    - SCORE ONLY matching is NEVER accepted
//
// 3. MATCHER RESULT:
//    - accepts nested V7-FH structures
//    - preserves actual matcher object
//    - preserves match_method / matcher_score
//
// 4. CLOUDBET EXTRACTION:
//    - supports direct cloudbet object
//    - cloudbet_match
//    - cloudbet_match_data
//    - nested Cloudbet structures
//    - direct Cloudbet id/key fields
//
// 5. IMPORTANT:
//    - READ ONLY
//    - NO REAL BET
//    - Hunter entry minute unchanged
//    - Hunter score unchanged
//
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

// Token matching is never accepted without this score.
const TOKEN_TEAM_MIN_SCORE = 0.45;


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
// CLEAN TEAM NAME
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
// GET HOME
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
// GET AWAY
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
    item?.cloudbet?.matchId,

    item?.cloudbet_match?.id,
    item?.cloudbet_match?.match_id,

    item?.cloudbet_match_data?.id,
    item?.cloudbet_match_data?.match_id

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
// CLOUDbet ID / KEY
// ============================================================

function objectCloudbetId(
  item: AnyObj
): string | null {

  const values = [

    item?.cloudbet?.id,
    item?.cloudbet?.match_id,
    item?.cloudbet?.event_id,

    item?.cloudbet_match?.id,
    item?.cloudbet_match?.match_id,
    item?.cloudbet_match?.event_id,

    item?.cloudbet_match_data?.id,
    item?.cloudbet_match_data?.match_id,
    item?.cloudbet_match_data?.event_id,

    item?.cloudbet_id,
    item?.cloudbetId

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


function objectCloudbetKey(
  item: AnyObj
): string | null {

  const values = [

    item?.cloudbet?.key,
    item?.cloudbet_match?.key,
    item?.cloudbet_match_data?.key,

    item?.cloudbet_key,
    item?.cloudbetKey

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

function extractMatcherCandidates(
  data: any
): AnyObj[] {

  const result:
    AnyObj[] = [];

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
        objectMatchName(
          value
        );

      const id =
        objectId(
          value
        );

      const home =
        objectHome(
          value
        );

      const away =
        objectAway(
          value
        );


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
// MATCH METHOD
// ============================================================

function exactIdMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const signalId =
    signalMatchId(
      signal
    );


  const candidateId =
    objectId(
      item
    );


  return Boolean(
    signalId &&
    candidateId &&
    signalId === candidateId
  );
}


function exactNameMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const source =
    normalizeText(
      signalMatchName(
        signal
      )
    );


  const candidate =
    normalizeText(
      objectMatchName(
        item
      )
    );


  return Boolean(
    source &&
    candidate &&
    source === candidate
  );
}


function exactTeamsMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const sh =
    cleanTeamName(
      signalHome(
        signal
      )
    );


  const sa =
    cleanTeamName(
      signalAway(
        signal
      )
    );


  const ch =
    cleanTeamName(
      objectHome(
        item
      )
    );


  const ca =
    cleanTeamName(
      objectAway(
        item
      )
    );


  return Boolean(
    sh &&
    sa &&
    ch &&
    ca &&
    sh === ch &&
    sa === ca
  );
}


function tokenTeamsMatch(
  signal: AnyObj,
  item: AnyObj
): boolean {

  const sh =
    cleanTeamName(
      signalHome(
        signal
      )
    );


  const sa =
    cleanTeamName(
      signalAway(
        signal
      )
    );


  const ch =
    cleanTeamName(
      objectHome(
        item
      )
    );


  const ca =
    cleanTeamName(
      objectAway(
        item
      )
    );


  if (
    !sh ||
    !sa ||
    !ch ||
    !ca
  ) {

    return false;
  }


  const homeOK =
    sh.includes(ch) ||
    ch.includes(sh);


  const awayOK =
    sa.includes(ca) ||
    ca.includes(sa);


  return (
    homeOK &&
    awayOK
  );
}


// ============================================================
// FIND SECURE MATCH
// ============================================================
//
// PRIORITY:
//
// 1. EXACT_ID
// 2. EXACT_NAME
// 3. EXACT_HOME_AWAY
// 4. TOKEN_HOME_AWAY + matcher score >= 0.45
//
// NEVER:
// - score-only match
// - arbitrary highest-score candidate
//
// ============================================================

function findSecureMatcherMatch(
  signal: AnyObj,
  matcherData: AnyObj
): {
  match: AnyObj | null;
  method: string | null;
  score: number;
} {

  const candidates =
    extractMatcherCandidates(
      matcherData
    );


  // ----------------------------------------------------------
  // 1. EXACT ID
  // ----------------------------------------------------------

  for (
    const item of candidates
  ) {

    if (
      exactIdMatch(
        signal,
        item
      )
    ) {

      return {
        match: item,
        method: "EXACT_ID",
        score:
          getMatcherScore(
            item
          )
      };
    }
  }


  // ----------------------------------------------------------
  // 2. EXACT NAME
  // ----------------------------------------------------------

  for (
    const item of candidates
  ) {

    if (
      exactNameMatch(
        signal,
        item
      )
    ) {

      return {
        match: item,
        method: "EXACT_NAME",
        score:
          getMatcherScore(
            item
          )
      };
    }
  }


  // ----------------------------------------------------------
  // 3. EXACT HOME + AWAY
  // ----------------------------------------------------------

  for (
    const item of candidates
  ) {

    if (
      exactTeamsMatch(
        signal,
        item
      )
    ) {

      return {
        match: item,
        method: "EXACT_HOME_AWAY",
        score:
          getMatcherScore(
            item
          )
      };
    }
  }


  // ----------------------------------------------------------
  // 4. TOKEN HOME + AWAY
  // ----------------------------------------------------------

  let bestToken:
    AnyObj | null = null;

  let bestTokenScore =
    0;


  for (
    const item of candidates
  ) {

    if (
      tokenTeamsMatch(
        signal,
        item
      )
    ) {

      const score =
        getMatcherScore(
          item
        );


      if (
        score >= TOKEN_TEAM_MIN_SCORE &&
        score > bestTokenScore
      ) {

        bestToken =
          item;

        bestTokenScore =
          score;
      }
    }
  }


  if (
    bestToken
  ) {

    return {
      match:
        bestToken,

      method:
        "TOKEN_HOME_AWAY",

      score:
        bestTokenScore
    };
  }


  // ----------------------------------------------------------
  // NO SECURE MATCH
  // ----------------------------------------------------------

  return {
    match: null,
    method: null,
    score: 0
  };
}


// ============================================================
// CLOUDbet DATA EXTRACTION
// ============================================================
//
// Important:
//
// A successful matcher match is NOT automatically rejected
// merely because cloudbet is nested differently.
//
// We recursively search the matched object.
//
// ============================================================

function extractCloudbet(
  matched: AnyObj | null
): AnyObj | null {

  if (
    !matched
  ) {

    return null;
  }


  // Direct known structures.

  const direct = [

    matched?.cloudbet,

    matched?.cloudbet_match,

    matched?.cloudbet_match_data

  ];


  for (
    const candidate of direct
  ) {

    if (
      candidate &&
      typeof candidate === "object"
    ) {

      return candidate;
    }
  }


  const seen =
    new Set<any>();


  function search(
    value: any,
    depth: number
  ): AnyObj | null {

    if (
      depth > 8 ||
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

        const lower =
          key.toLowerCase();


        if (
          lower.includes("cloudbet")
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


        if (
          found
        ) {

          return found;
        }
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


      if (
        found
      ) {

        return found;
      }
    }


    return null;
  }


  return search(
    matched,
    0
  );
}


// ============================================================
// CLOUDbet DATA FALLBACK
// ============================================================
//
// Some matcher responses identify the Cloudbet match directly
// through cloudbet_id / cloudbet_key without returning a full
// cloudbet object.
//
// We preserve those fields.
//
// ============================================================

function buildCloudbetReference(
  matched: AnyObj | null
): AnyObj | null {

  if (
    !matched
  ) {

    return null;
  }


  const cloudbet =
    extractCloudbet(
      matched
    );


  if (
    cloudbet
  ) {

    return cloudbet;
  }


  const id =
    objectCloudbetId(
      matched
    );


  const key =
    objectCloudbetKey(
      matched
    );


  if (
    !id &&
    !key
  ) {

    return null;
  }


  return {

    id:
      id,

    key:
      key

  };
}


// ============================================================
// PREPARE BET
// ============================================================

function prepareBet(
  signal: AnyObj,
  matched: AnyObj | null,
  matchMethod: string | null,
  matcherScore: number
): AnyObj {

  const cloudbet =
    buildCloudbetReference(
      matched
    );


  const secureMatch =
    Boolean(
      matched &&
      matchMethod
    );


  return {

    status:
      secureMatch
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
              cloudbet?.match_id ??
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
      matched
        ? (
            matched?.scoring ??
            {
              score:
                matcherScore
            }
          )
        : null,


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
              matchMethod,

            matcher_score:
              matcherScore

          }

        : null,


    security: {

      secure_match:
        secureMatch,

      match_method:
        matchMethod,

      score_only_match:
        false,

      minimum_score_for_token_match:
        TOKEN_TEAM_MIN_SCORE

    },


    action:
      secureMatch
        ? "NO_BET_IN_V4_READY"
        : "NO_BET_IN_V4"

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


  // ==========================================================
  // TRACKER
  // ==========================================================

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


  // ==========================================================
  // IMPORTANT EARLY STOP
  // ==========================================================
  //
  // No Hunter ENTRY:
  //
  // - do not call Matcher
  // - do not call Cloudbet
  // - do not create NO_MATCH
  //
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
        "READ_ONLY",

      betting:
        "DISABLED",

      status:
        "NO_ACTIVE_SIGNALS",


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


      tracker: {

        endpoint:
          tracker.endpoint,

        total_signals:
          allSignals.length,

        hunter_entries:
          0,

        attempts:
          tracker.attempts

      },


      matcher: {

        called:
          false

      },


      cloudbet: {

        called:
          false

      },


      stats: {

        signals_received:
          0,

        bets_ready:
          0,

        no_match:
          0,

        processing_ms:
          Date.now() -
          started

      },


      message:
        "No active Hunter ENTRY signals.",


      timestamp:
        new Date()
          .toISOString()

    });
  }


  // ==========================================================
  // MATCHER
  // ==========================================================

  const matcherData =
    await runMatcher(
      env
    );


  // ==========================================================
  // MATCHER CANDIDATES
  // ==========================================================

  const matcherCandidates =
    extractMatcherCandidates(
      matcherData
    );


  // ==========================================================
  // PREPARE
  // ==========================================================

  const prepared:
    AnyObj[] = [];


  for (
    const signal of hunterEntries
  ) {

    const result =
      findSecureMatcherMatch(
        signal,
        matcherData
      );


    prepared.push(
      prepareBet(
        signal,

        result.match,

        result.method,

        result.score

      )
    );
  }


  const ready =
    prepared.filter(
      item =>
        item.status ===
        "READY"
    );


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


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        TOKEN_TEAM_MIN_SCORE

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


    tracker: {

      endpoint:
        tracker.endpoint,

      total_signals:
        allSignals.length,

      hunter_entries:
        hunterEntries.length

    },


    matcher: {

      called:
        true,

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


    security: {

      secure_matching:
        true,

      score_only_matching:
        false,

      token_team_min_score:
        TOKEN_TEAM_MIN_SCORE

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
