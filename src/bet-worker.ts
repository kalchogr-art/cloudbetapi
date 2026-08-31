// ============================================================
// CLOUDBET BET WORKER V2
// HUNTER TRACKER -> MATCHER -> CLOUDBET
//
// V2:
// - READ ONLY
// - NO REAL BET
// - REAL HUNTER ENTRY EXTRACTION
// - SUPPORTS NESTED TRACKER RESPONSES
// - SUPPORTS /signals AND /entries FALLBACK
// - MATCHER V7-FH
// - PREPARES FIRST_HALF OVER 0.5
// - DOES NOT PLACE BETS
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
}

type AnyObj = Record<string, any>;

const VERSION = "V2";

const SPORT = "SOCCER";
const PERIOD = "FIRST_HALF";
const OUTCOME = "OVER";
const LINE = 0.5;


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
// SAFE FETCH
// ============================================================
//
// Used for optional Tracker endpoints.
// 404 does NOT crash the worker.
// ============================================================

async function tryFetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<any | null> {

  try {

    return await fetchServiceJSON(
      service,
      path
    );

  } catch {

    return null;
  }
}


// ============================================================
// ARRAY EXTRACTION
// ============================================================

function collectArrays(
  data: any,
  output: AnyObj[][] = [],
  depth = 0
): AnyObj[][] {

  if (
    depth > 5 ||
    data === null ||
    data === undefined
  ) {
    return output;
  }

  if (
    Array.isArray(data)
  ) {

    if (
      data.length > 0 &&
      data.every(
        item =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item)
      )
    ) {

      output.push(data);
    }

    for (
      const item of data
    ) {

      collectArrays(
        item,
        output,
        depth + 1
      );
    }

    return output;
  }


  if (
    typeof data === "object"
  ) {

    for (
      const value of Object.values(data)
    ) {

      collectArrays(
        value,
        output,
        depth + 1
      );
    }
  }


  return output;
}


// ============================================================
// SIGNAL LIKENESS
// ============================================================

function looksLikeSignal(
  item: AnyObj
): boolean {

  if (!item || typeof item !== "object") {
    return false;
  }

  const values = [

    item?.type,
    item?.signal,
    item?.action,
    item?.status,
    item?.event,
    item?.result

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


  if (
    values.some(
      value =>
        value.includes("ENTRY") ||
        value.includes("HUNTER")
    )
  ) {
    return true;
  }


  return Boolean(

    item?.match ||
    item?.match_name ||
    item?.matchName ||
    item?.fixture ||
    item?.event_name

  );
}


// ============================================================
// SIGNAL EXTRACTION
// ============================================================

function extractSignals(
  data: AnyObj
): AnyObj[] {

  const directKeys = [

    "signals",
    "entries",
    "hunter_entries",
    "hunter_signals",
    "candidates",

    "data",
    "tracker",
    "result"

  ];


  const found: AnyObj[] = [];


  // ----------------------------------------------------------
  // DIRECT ARRAYS
  // ----------------------------------------------------------

  for (
    const key of directKeys
  ) {

    const value =
      data?.[key];


    if (
      Array.isArray(value)
    ) {

      for (
        const item of value
      ) {

        if (
          item &&
          typeof item === "object"
        ) {

          found.push(item);
        }
      }
    }
  }


  // ----------------------------------------------------------
  // NESTED ARRAYS
  // ----------------------------------------------------------

  const arrays =
    collectArrays(data);


  for (
    const array of arrays
  ) {

    for (
      const item of array
    ) {

      if (
        looksLikeSignal(item)
      ) {

        found.push(item);
      }
    }
  }


  // ----------------------------------------------------------
  // DEDUPLICATE
  // ----------------------------------------------------------

  const unique =
    new Map<string, AnyObj>();


  for (
    const signal of found
  ) {

    const id =
      signalMatchId(signal);


    const name =
      signalMatchName(signal);


    const minute =
      signalMinute(signal);


    const key =

      id
        ? `id:${id}`

        : `name:${name}|minute:${minute}`;
    

    if (
      !unique.has(key)
    ) {

      unique.set(
        key,
        signal
      );
    }
  }


  return Array.from(
    unique.values()
  );
}


// ============================================================
// HUNTER ENTRY CHECK
// ============================================================

function isHunterEntry(
  signal: AnyObj
): boolean {

  const values = [

    signal?.type,
    signal?.signal,
    signal?.action,
    signal?.status,
    signal?.event,
    signal?.result

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

  return (

    signal?.match ??

    signal?.match_name ??

    signal?.matchName ??

    signal?.fixture ??

    signal?.event_name ??

    signal?.name ??

    ""
  );
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

    signal?.id;


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
// MINUTE
// ============================================================

function signalMinute(
  signal: AnyObj
): number | null {

  const value =

    signal?.entry_minute ??

    signal?.entryMinute ??

    signal?.minute ??

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

    signal?.hunter?.score ??

    signal?.score;


  const score =
    Number(value);


  if (
    !Number.isFinite(score)
  ) {

    return null;
  }


  return score;
}


// ============================================================
// SCORE
// ============================================================

function signalScore(
  signal: AnyObj
): any {

  return (

    signal?.score_result ??

    signal?.result_score ??

    signal?.score ??

    null
  );
}


// ============================================================
// TRACKER LOAD
// ============================================================
//
// First:
//     /
//
// If root response contains no actual ENTRY:
//
//     /signals
//     /entries
//
// This prevents the previous problem where the Tracker
// reported entries but the Bet Worker saw zero.
// ============================================================

async function loadTrackerSignals(
  env: Env
): Promise<{
  root: AnyObj;
  signals: AnyObj[];
  endpoint: string;
}> {

  const endpoints = [
    "/",
    "/signals",
    "/entries"
  ];


  let lastData: AnyObj = {};
  let lastEndpoint = "/";


  for (
    const endpoint of endpoints
  ) {

    const data =
      await tryFetchServiceJSON(
        env.TRACKER,
        endpoint
      );


    if (!data) {
      continue;
    }


    lastData =
      data;

    lastEndpoint =
      endpoint;


    const signals =
      extractSignals(
        data
      );


    const entries =
      signals.filter(
        isHunterEntry
      );


    if (
      entries.length > 0
    ) {

      return {

        root:
          data,

        signals:
          signals,

        endpoint:
          endpoint

      };
    }
  }


  return {

    root:
      lastData,

    signals:
      extractSignals(
        lastData
      ),

    endpoint:
      lastEndpoint

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
// FIND MATCHER COUNTERPART
// ============================================================

function findMatcherMatch(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj | null {

  const signalId =
    signalMatchId(signal);


  const signalName =
    signalMatchName(signal)
      .toLowerCase()
      .trim();


  const matches =
    Array.isArray(
      matcherData?.matches
    )
      ? matcherData.matches
      : [];


  // ----------------------------------------------------------
  // EXACT ID
  // ----------------------------------------------------------

  if (signalId) {

    for (
      const item of matches
    ) {

      const v27Id =
        item?.v27?.id;

      const cbId =
        item?.cloudbet?.id;


      if (
        String(v27Id ?? "") ===
        signalId
      ) {

        return item;
      }


      if (
        String(cbId ?? "") ===
        signalId
      ) {

        return item;
      }
    }
  }


  // ----------------------------------------------------------
  // EXACT MATCH NAME
  // ----------------------------------------------------------

  if (signalName) {

    for (
      const item of matches
    ) {

      const names = [

        item?.match,
        item?.v27?.match,
        item?.cloudbet?.match

      ]
        .filter(Boolean)
        .map(
          value =>
            String(value)
              .toLowerCase()
              .trim()
        );


      if (
        names.includes(
          signalName
        )
      ) {

        return item;
      }
    }
  }


  // ----------------------------------------------------------
  // HOME / AWAY
  // ----------------------------------------------------------

  const signalHome =
    String(
      signal?.home ??
      signal?.home_team ??
      signal?.homeTeam ??
      ""
    )
      .toLowerCase()
      .trim();


  const signalAway =
    String(
      signal?.away ??
      signal?.away_team ??
      signal?.awayTeam ??
      ""
    )
      .toLowerCase()
      .trim();


  if (
    signalHome &&
    signalAway
  ) {

    for (
      const item of matches
    ) {

      const home =
        String(
          item?.v27?.home ??
          item?.cloudbet?.home ??
          ""
        )
          .toLowerCase()
          .trim();


      const away =
        String(
          item?.v27?.away ??
          item?.cloudbet?.away ??
          ""
        )
          .toLowerCase()
          .trim();


      if (
        home === signalHome &&
        away === signalAway
      ) {

        return item;
      }
    }
  }


  return null;
}


// ============================================================
// PREPARE BET
// ============================================================

function prepareBet(
  signal: AnyObj,
  matched: AnyObj | null
): AnyObj {

  const cloudbet =
    matched?.cloudbet ??
    null;


  return {

    status:
      matched
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
        "HUNTER_ENTRY",

      match:
        signalMatchName(signal),

      match_id:
        signalMatchId(signal),

      entry_minute:
        signalMinute(signal),

      hunter_score:
        signalHunterScore(signal),

      score:
        signalScore(signal)

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
              null,

            home:
              cloudbet?.home ??
              null,

            away:
              cloudbet?.away ??
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
              null

          }

        : null,


    matcher_scoring:
      matched?.scoring ??
      null,


    action:
      "NO_BET_IN_V2"

  };
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
    await loadTrackerSignals(
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
          0

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
  // PREPARE
  // ----------------------------------------------------------

  const prepared:
    AnyObj[] = [];


  for (
    const signal of hunterEntries
  ) {

    const matched =
      findMatcherMatch(
        signal,
        matcherData
      );


    prepared.push(
      prepareBet(
        signal,
        matched
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
        matcherData?.matches
          ?.length ??
        0

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
      "READ ONLY betting preparation worker. No bet can be placed.",


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


    message:
      "READ ONLY betting preparation worker. No bet can be placed.",


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
        path === "/bet"
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

            "/bet"

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
