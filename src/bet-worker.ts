// ============================================================
// CLOUDBET BET WORKER V1
// HUNTER TRACKER -> MATCHER -> CLOUDBET
//
// V1:
// - READ ONLY
// - NO REAL BET
// - Takes Hunter Tracker signal
// - Sends signal match to Matcher
// - Prepares FIRST_HALF OVER 0.5
// - Cloudbet API binding is present but NOT USED for betting
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

  // Present for the future real-bet version.
  // V1 NEVER sends a betting request.
  CLOUDBET: Fetcher;
}


type AnyObj = Record<string, any>;


// ============================================================
// CONSTANTS
// ============================================================

const VERSION = "V1";

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
// TRACKER SIGNAL EXTRACTION
// ============================================================
//
// Tracker implementations can expose signals in different
// arrays. V1 accepts the common forms without changing the
// tracker itself.
// ============================================================

function extractSignals(
  data: AnyObj
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
      data?.hunter_signals
    )
  ) {
    return data.hunter_signals;
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
// SIGNAL CHECK
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
      value.includes("ENTRY") ||
      value.includes("HUNTER_ENTRY")
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
// SIGNAL MATCH ID
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
// SIGNAL MINUTE
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
// RESULT / SCORE
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
// MATCHER
// ============================================================
//
// The matcher currently operates as:
//
// GET /
//
// because its V7-FH implementation reads V27 and Cloudbet
// through its own service bindings.
//
// V1 therefore sends the Hunter signal as diagnostic metadata
// only. It does NOT modify Matcher behaviour.
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
//
// Matcher returns:
//
// matches[]
//
// Each item contains:
//
// v27
// cloudbet
// scoring
//
// We compare the Hunter signal with the matcher results.
// ============================================================

function findMatcherMatch(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj | null {

  const signalsId =
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


  let best: AnyObj | null =
    null;


  // ----------------------------------------------------------
  // FIRST: EXACT MATCH ID
  // ----------------------------------------------------------

  if (signalsId) {

    for (
      const item of matches
    ) {

      const v27Id =
        item?.v27?.id;

      const cbId =
        item?.cloudbet?.id;


      if (
        String(v27Id ?? "") ===
        signalsId
      ) {

        return item;
      }


      if (
        String(cbId ?? "") ===
        signalsId
      ) {

        return item;
      }
    }
  }


  // ----------------------------------------------------------
  // SECOND: NORMALIZED NAME COMPARISON
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
  // THIRD: HOME/AWAY
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
          item?.cloudbet?.home ??
          item?.v27?.home ??
          ""
        )
          .toLowerCase()
          .trim();


      const away =
        String(
          item?.cloudbet?.away ??
          item?.v27?.away ??
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


  return best;
}


// ============================================================
// BET PREPARATION
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


    cloudbet: cloudbet
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
      "NO_BET_IN_V1"

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
  // GET TRACKER
  // ----------------------------------------------------------

  const trackerData =
    await fetchServiceJSON(
      env.TRACKER,
      "/"
    );


  const allSignals =
    extractSignals(
      trackerData
    );


  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );


  // ----------------------------------------------------------
  // NOTHING TO PROCESS
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
  // GET MATCHER
  // ----------------------------------------------------------

  const matcherData =
    await runMatcher(
      env
    );


  // ----------------------------------------------------------
  // PREPARE RESULTS
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
