// ============================================================
// CLOUDBET BET WORKER V3
// HUNTER TRACKER -> MATCHER -> CLOUDBET
//
// V3:
// - READ ONLY
// - NO REAL BET
// - Reads Hunter ENTRY signals robustly
// - Tries multiple Tracker endpoints
// - Supports multiple signal array formats
// - Sends signal match to Matcher
// - Prepares FIRST_HALF OVER 0.5
// - Keeps entry minute
// - Keeps Hunter score
// - Keeps Cloudbet match data
// - NO betting request is ever sent
//
// FLOW:
//
// HUNTER TRACKER
//       ↓
//   HUNTER ENTRY
//       ↓
//    BET WORKER
//       ↓
//     MATCHER
//       ↓
//   CLOUDBET MATCH
//       ↓
// FIRST HALF OVER 0.5
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

const VERSION = "V3";

const SPORT = "SOCCER";

const PERIOD = "FIRST_HALF";

const OUTCOME = "OVER";

const LINE = 0.5;


// Tracker endpoints checked in this order.
//
// /entries is the preferred endpoint.
// / is kept as fallback because older Tracker versions
// expose their data from the root endpoint.
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
// ARRAY HELPER
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
//
// Different Tracker versions can expose the same Hunter
// entries under different array names.
//
// V3 checks all known structures.
//
// IMPORTANT:
// We do not require "ENTRY" to be in the array name.
// The individual signal is checked separately.
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


  // ----------------------------------------------------------
  // Some Tracker responses can contain a single signal.
  // ----------------------------------------------------------

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
// SIGNAL CHECK
// ============================================================

function isHunterEntry(
  signal: AnyObj
): boolean {

  // ----------------------------------------------------------
  // Explicit boolean flags
  // ----------------------------------------------------------

  if (
    signal?.is_hunter_entry === true ||
    signal?.isHunterEntry === true ||
    signal?.hunter_entry === true ||
    signal?.hunterEntry === true
  ) {

    return true;
  }


  // ----------------------------------------------------------
  // Text fields
  // ----------------------------------------------------------

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

    signal?.v27Id ??

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
// HOME TEAM
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

    ""

  ).trim();
}


// ============================================================
// AWAY TEAM
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


  // ----------------------------------------------------------
  // Some Tracker responses use score as the Hunter score.
  // ----------------------------------------------------------

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
// FETCH TRACKER
// ============================================================
//
// We check /entries first.
//
// If /entries returns zero signals, we also check /.
//
// This prevents the Bet Worker from silently reporting zero
// when the Tracker exposes its entries through another route.
// ============================================================

async function fetchTracker(
  env: Env
): Promise<{
  data: AnyObj | null;
  endpoint: string | null;
  signals: AnyObj[];
  attempts: AnyObj[];
}> {

  const attempts: AnyObj[] = [];


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
        extractSignals(data);


      attempts.push({

        endpoint,

        success:
          true,

        extracted:
          signals.length,

        keys:
          Object.keys(data ?? {})
            .slice(0, 30)

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
// NORMALIZE TEXT
// ============================================================

function normalizeText(
  value: any
): string {

  return String(
    value ?? ""
  )
    .toLowerCase()
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
// MATCHER COUNTERPART
// ============================================================

function findMatcherMatch(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj | null {

  const signalId =
    signalMatchId(signal);


  const signalName =
    normalizeText(
      signalMatchName(signal)
    );


  const home =
    normalizeText(
      signalHome(signal)
    );


  const away =
    normalizeText(
      signalAway(signal)
    );


  const matches =
    asArray(
      matcherData?.matches
    );


  // ----------------------------------------------------------
  // 1. EXACT V27 / CLOUDBET ID
  // ----------------------------------------------------------

  if (
    signalId
  ) {

    for (
      const item of matches
    ) {

      const v27Id =
        String(
          item?.v27?.id ??
          ""
        );


      const cbId =
        String(
          item?.cloudbet?.id ??
          ""
        );


      if (
        v27Id === signalId ||
        cbId === signalId
      ) {

        return item;
      }
    }
  }


  // ----------------------------------------------------------
  // 2. EXACT MATCH NAME
  // ----------------------------------------------------------

  if (
    signalName
  ) {

    for (
      const item of matches
    ) {

      const names = [

        item?.match,

        item?.v27?.match,

        item?.cloudbet?.match

      ]
        .filter(Boolean)
        .map(normalizeText);


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
  // 3. HOME + AWAY
  // ----------------------------------------------------------

  if (
    home &&
    away
  ) {

    for (
      const item of matches
    ) {

      const candidateHome =
        normalizeText(
          item?.v27?.home ??
          item?.cloudbet?.home ??
          ""
        );


      const candidateAway =
        normalizeText(
          item?.v27?.away ??
          item?.cloudbet?.away ??
          ""
        );


      if (
        candidateHome === home &&
        candidateAway === away
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
      "NO_BET_IN_V3"

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
  // PREPARE
  // ----------------------------------------------------------

  const prepared: AnyObj[] = [];


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
        asArray(
          matcherData?.matches
        ).length

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
