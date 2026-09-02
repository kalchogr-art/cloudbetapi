// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.6
//
// V5.6:
// - NEW FAST LIVE PATH
// - /live now uses Cloudbet /events endpoint
// - 1 Cloudbet request instead of ~186 competition requests
// - sport=soccer
// - live=true
// - players=false
// - limit=10000
//
// PRESERVED:
// - READ ONLY
// - betting disabled
// - exact 1H OVER 0.5 odds detection
// - /search
// - /event
// - /health
// - /diagnostic-soccer
//
// IMPORTANT:
// - No matcher changes
// - No odds target changes
// - No betting
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

const VERSION =
  "V5.6";

const CLOUDBET_TIMEOUT_MS =
  8000;

// Kept for /search compatibility.
// /live no longer uses competition concurrency.
const COMPETITION_CONCURRENCY =
  24;

// ============================================================
// EXACT TARGET
// ============================================================

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

// ============================================================
// BASIC TYPES
// ============================================================

type AnyObj =
  Record<string, any>;

// ============================================================
// JSON RESPONSE
// ============================================================

function json(
  data: AnyObj,
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
          "application/json; charset=utf-8",

        "cache-control":
          "no-store"
      }
    }
  );
}

// ============================================================
// TIME
// ============================================================

function nowISO(): string {
  return new Date().toISOString();
}

// ============================================================
// NUMBER
// ============================================================

function finiteNumber(
  value: any
): number | null {

  const number =
    Number(value);

  return Number.isFinite(
    number
  )
    ? number
    : null;
}

// ============================================================
// CLOUDBET FETCH
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string,
  timeoutMs = CLOUDBET_TIMEOUT_MS
): Promise<{
  response: Response;
  text: string;
  elapsed_ms: number;
}> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {

    const apiKey =
      env[API_KEY_NAME as keyof Env];

    if (!apiKey) {

      throw new Error(
        `${API_KEY_NAME} is not configured`
      );
    }

    const response =
      await fetch(
        `${API_BASE}${path}`,
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json",

            "x-api-key":
              apiKey
          },

          cache:
            "no-store",

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    return {
      response,

      text,

      elapsed_ms:
        Date.now() -
        started
    };

  } catch (error: any) {

    const elapsed =
      Date.now() -
      started;

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        `Cloudbet request timed out after ${timeoutMs}ms: ${path}`
      );
    }

    throw new Error(
      `Cloudbet request failed after ${elapsed}ms: ${path} — ${
        error?.message ||
        String(error)
      }`
    );

  } finally {

    clearTimeout(
      timer
    );
  }
}

// ============================================================
// JSON PARSER
// ============================================================

function parseJSON(
  text: string,
  path: string
): AnyObj {

  try {

    return JSON.parse(
      text
    );

  } catch {

    throw new Error(
      `Invalid JSON from Cloudbet: ${path}`
    );
  }
}

// ============================================================
// /sports/soccer
// ============================================================

async function getSoccerData(
  env: Env
): Promise<{
  data: AnyObj;
  elapsed_ms: number;
  response_status: number;
}> {

  const result =
    await cloudbetFetch(
      env,
      "/sports/soccer"
    );

  if (
    !result.response.ok
  ) {

    throw new Error(
      `Cloudbet /sports/soccer returned HTTP ${
        result.response.status
      }`
    );
  }

  return {
    data:
      parseJSON(
        result.text,
        "/sports/soccer"
      ),

    elapsed_ms:
      result.elapsed_ms,

    response_status:
      result.response.status
  };
}

// ============================================================
// DIAGNOSTIC: /sports/soccer
// ============================================================

function flattenSoccerCompetitions(
  data: AnyObj
): AnyObj[] {

  const result:
    AnyObj[] = [];

  const categories =
    Array.isArray(
      data?.categories
    )
      ? data.categories
      : [];

  for (
    const category of categories
  ) {

    const competitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition of competitions
    ) {

      if (
        competition &&
        typeof competition ===
          "object"
      ) {

        result.push(
          {
            ...competition,

            category_name:
              category?.name ??
              null,

            category_key:
              category?.key ??
              null
          }
        );
      }
    }
  }

  return result;
}

function collectKeys(
  items: any[]
): Record<string, number> {

  const counts:
    Record<string, number> =
      {};

  for (
    const item of items
  ) {

    if (
      !item ||
      typeof item !==
        "object" ||
      Array.isArray(item)
    ) {
      continue;
    }

    for (
      const key of Object.keys(
        item
      )
    ) {

      counts[key] =
        (counts[key] || 0) + 1;
    }
  }

  return counts;
}

function sampleFieldValues(
  items: any[],
  key: string,
  max = 20
): any[] {

  const values:
    any[] = [];

  const seen =
    new Set<string>();

  for (
    const item of items
  ) {

    if (
      !item ||
      typeof item !==
        "object" ||
      Array.isArray(item)
    ) {
      continue;
    }

    if (
      !Object.prototype.hasOwnProperty.call(
        item,
        key
      )
    ) {
      continue;
    }

    const value =
      item[key];

    let signature:
      string;

    try {

      signature =
        JSON.stringify(
          value
        );

    } catch {

      signature =
        String(value);
    }

    if (
      seen.has(
        signature
      )
    ) {
      continue;
    }

    seen.add(
      signature
    );

    values.push(
      value
    );

    if (
      values.length >=
      max
    ) {
      break;
    }
  }

  return values;
}

function detectInterestingFields(
  items: any[]
): AnyObj {

  const allKeys =
    collectKeys(
      items
    );

  const interesting:
    Record<
      string,
      {
        present: number;
        values: any[];
      }
    > = {};

  const patterns =
    [
      "live",
      "event",
      "count",
      "status",
      "state",
      "active",
      "inplay",
      "in_play",
      "started",
      "start",
      "sport",
      "category",
      "competition"
    ];

  for (
    const key of Object.keys(
      allKeys
    )
  ) {

    const normalized =
      key
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        );

    const matches =
      patterns.some(
        pattern =>
          normalized.includes(
            pattern.replace(
              /[^a-z0-9]/g,
              ""
            )
          )
      );

    if (
      !matches
    ) {
      continue;
    }

    interesting[key] = {
      present:
        allKeys[key],

      values:
        sampleFieldValues(
          items,
          key,
          20
        )
    };
  }

  return interesting;
}

async function diagnosticSoccer(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  let soccer: {
    data: AnyObj;
    elapsed_ms: number;
    response_status: number;
  };

  try {

    soccer =
      await getSoccerData(
        env
      );

  } catch (error: any) {

    return json(
      {
        success:
          false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        action:
          "DIAGNOSTIC_SOCCER",

        error:
          error?.message ||
          String(error),

        timestamp:
          nowISO()
      },
      502
    );
  }

  const competitions =
    flattenSoccerCompetitions(
      soccer.data
    );

  const keys =
    collectKeys(
      competitions
    );

  return json(
    {
      success:
        true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "DIAGNOSTIC_SOCCER",

      read_only:
        true,

      live_unchanged:
        true,

      request: {
        path:
          "/sports/soccer",

        requests_made:
          1,

        competition_requests_made:
          0,

        timeout_ms:
          CLOUDBET_TIMEOUT_MS
      },

      performance: {
        soccer_fetch_ms:
          soccer.elapsed_ms,

        total_elapsed_ms:
          Date.now() -
          started,

        http_status:
          soccer.response_status
      },

      response_structure: {

        top_level_type:
          Array.isArray(
            soccer.data
          )
            ? "array"
            : typeof soccer.data,

        top_level_keys:
          Object.keys(
            soccer.data || {}
          )
      },

      competitions: {

        detected:
          competitions.length,

        key_presence:
          keys,

        interesting_fields:
          detectInterestingFields(
            competitions
          )
      },

      sample_first_20:
        competitions.slice(
          0,
          20
        ),

      interpretation: {

        live_filter_available:
          false,

        reason:
          "The /sports/soccer competition objects expose eventCount but no reliable live-event count/status field.",

        next_step:
          "Use Cloudbet /events?sport=soccer&live=true instead of scanning every competition."
      },

      timestamp:
        nowISO()
    }
  );
}

// ============================================================
// COMPETITION KEY
// ============================================================

function getCompetitionKey(
  competition: AnyObj
): string | null {

  const candidates =
    [
      competition?.key,

      competition?.competitionKey,

      competition?.competition,

      competition?.id
    ];

  for (
    const value of candidates
  ) {

    if (
      typeof value ===
        "string" &&
      value.trim()
    ) {

      return value.trim();
    }
  }

  return null;
}

// ============================================================
// COMPETITION EXTRACTION
// ============================================================

function extractCompetitionsForLive(
  data: AnyObj
): AnyObj[] {

  const categories =
    Array.isArray(
      data?.categories
    )
      ? data.categories
      : [];

  const result:
    AnyObj[] = [];

  for (
    const category of categories
  ) {

    const competitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition of competitions
    ) {

      if (
        competition &&
        typeof competition ===
          "object"
      ) {

        result.push(
          competition
        );
      }
    }
  }

  return result;
}

// ============================================================
// EVENTS EXTRACTION FROM COMPETITION
// ============================================================

function extractEvents(
  data: AnyObj
): AnyObj[] {

  if (
    Array.isArray(data)
  ) {

    return data;
  }

  const possible =
    [
      data?.events,

      data?.data?.events,

      data?.competition?.events,

      data?.result?.events
    ];

  for (
    const value of possible
  ) {

    if (
      Array.isArray(value)
    ) {

      return value;
    }
  }

  return [];
}

// ============================================================
// COMPETITION FETCH
// ============================================================

async function fetchCompetition(
  env: Env,
  competition: AnyObj
): Promise<{
  competition: AnyObj;
  elapsed_ms: number;
  success: boolean;
  error?: string;
  events: AnyObj[];
}> {

  const key =
    getCompetitionKey(
      competition
    );

  if (!key) {

    return {
      competition,

      elapsed_ms:
        0,

      success:
        false,

      error:
        "Competition key not found",

      events:
        []
    };
  }

  const started =
    Date.now();

  try {

    const result =
      await cloudbetFetch(
        env,
        `/competitions/${encodeURIComponent(
          key
        )}`
      );

    if (
      !result.response.ok
    ) {

      throw new Error(
        `HTTP ${result.response.status}`
      );
    }

    const data =
      parseJSON(
        result.text,
        `/competitions/${key}`
      );

    return {
      competition,

      elapsed_ms:
        Date.now() -
        started,

      success:
        true,

      events:
        extractEvents(
          data
        )
    };

  } catch (error: any) {

    return {
      competition,

      elapsed_ms:
        Date.now() -
        started,

      success:
        false,

      error:
        error?.message ||
        String(error),

      events:
        []
    };
  }
}

// ============================================================
// CONCURRENCY MAP
// ============================================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (
    item: T,
    index: number
  ) => Promise<R>
): Promise<R[]> {

  const results =
    new Array<R>(
      items.length
    );

  let nextIndex =
    0;

  async function runner() {

    while (true) {

      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {
        return;
      }

      results[index] =
        await worker(
          items[index],
          index
        );
    }
  }

  const workers =
    Math.min(
      concurrency,
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workers
      },
      () =>
        runner()
    )
  );

  return results;
}

// ============================================================
// LIVE EVENT DETECTION
// ============================================================

function isLiveEvent(
  event: AnyObj
): boolean {

  if (
    event?.live === true ||
    event?.isLive === true ||
    event?.inPlay === true ||
    event?.in_play === true
  ) {

    return true;
  }

  const status =
    String(
      event?.status ??
      event?.state ??
      event?.eventStatus ??
      ""
    ).toLowerCase();

  if (
    [
      "live",
      "inplay",
      "in-play",
      "started",
      "trading_live"
    ].includes(
      status
    )
  ) {

    return true;
  }

  return false;
}

// ============================================================
// BUILD LIVE MATCH
// ============================================================

function buildLiveMatch(
  event: AnyObj,
  competition?: AnyObj
): AnyObj | null {

  const home =
    event?.home ??
    event?.homeTeam ??
    event?.teams?.home ??
    event?.participants?.home ??
    null;

  const away =
    event?.away ??
    event?.awayTeam ??
    event?.teams?.away ??
    event?.participants?.away ??
    null;

  const homeName =
    typeof home ===
      "string"

      ? home

      : home?.name ??
        home?.title ??
        null;

  const awayName =
    typeof away ===
      "string"

      ? away

      : away?.name ??
        away?.title ??
        null;

  if (
    !homeName ||
    !awayName
  ) {

    return null;
  }

  return {

    id:
      event?.id ??
      event?.eventId ??
      event?.key ??
      null,

    event_id:
      event?.id ??
      event?.eventId ??
      event?.key ??
      null,

    home:
      homeName,

    away:
      awayName,

    competition:
      event?.competition?.key ??
      event?.competitionKey ??
      getCompetitionKey(
        competition || {}
      ),

    competition_name:
      event?.competition?.name ??
      null,

    category:
      event?.competition?.category?.key ??
      null,

    status:
      event?.status ??
      event?.state ??
      null,

    live:
      true,

    raw_event:
      event
  };
}

// ============================================================
// EXACT TARGET ODDS
// ============================================================
//
// IMPORTANT:
// Exact target only.
//
// Never accepts:
// soccer.total_goals
//
// Never uses marketUrl as fallback.
//
// Requires:
// market
// submarket
// outcome
// params
// valid price
// valid maxStake
// ============================================================

function extractTargetOdds(
  event: AnyObj
): AnyObj | null {

  const market =
    event?.markets?.[
      TARGET_MARKET
    ];

  if (!market) {
    return null;
  }

  const submarket =
    market?.submarkets?.[
      TARGET_SUBMARKET
    ];

  if (!submarket) {
    return null;
  }

  const selections =
    submarket?.selections;

  if (
    !Array.isArray(
      selections
    )
  ) {

    return null;
  }

  for (
    const selection of selections
  ) {

    if (
      selection?.outcome !==
      TARGET_OUTCOME
    ) {
      continue;
    }

    if (
      selection?.params !==
      TARGET_PARAMS
    ) {
      continue;
    }

    const price =
      finiteNumber(
        selection?.price
      );

    if (
      price === null ||
      price <= 1
    ) {

      continue;
    }

    const status =
      String(
        selection?.status ??
        ""
      ).toUpperCase();

    if (
      status &&
      [
        "SELECTION_DISABLED",
        "DISABLED",
        "CLOSED",
        "SUSPENDED"
      ].includes(
        status
      )
    ) {

      continue;
    }

    if (
      selection?.enabled ===
      false
    ) {

      continue;
    }

    const maxStake =
      finiteNumber(
        selection?.maxStake
      );

    if (
      maxStake !== null &&
      maxStake <= 0
    ) {

      continue;
    }

    return {

      market:
        TARGET_MARKET,

      submarket:
        TARGET_SUBMARKET,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS,

      price,

      raw_price:
        selection?.raw_price ??
        null,

      status:
        selection?.status ??
        null,

      maxStake:
        selection?.maxStake ??
        null
    };
  }

  return null;
}

// ============================================================
// NEW: /events? SPORT=SOCCER & LIVE=TRUE
// ============================================================
//
// This is the important V5.6 optimization.
//
// OLD:
//
// /sports/soccer
//   -> ~186 competitions
//   -> ~186 /competitions/{key} requests
//
// NEW:
//
// /events?sport=soccer&live=true&players=false&limit=10000
//   -> ONE request
//
// Cloudbet exposes GET /v2/odds/events for listing events,
// including live events.
// ============================================================

async function getLiveSoccerEvents(
  env: Env
): Promise<{
  data: AnyObj;
  events: AnyObj[];
  elapsed_ms: number;
  response_status: number;
  path: string;
}> {

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const result =
    await cloudbetFetch(
      env,
      path
    );

  if (
    !result.response.ok
  ) {

    throw new Error(
      `Cloudbet /events returned HTTP ${
        result.response.status
      }`
    );
  }

  const data =
    parseJSON(
      result.text,
      path
    );

  const events =
    extractLiveEvents(
      data
    );

  return {

    data,

    events,

    elapsed_ms:
      result.elapsed_ms,

    response_status:
      result.response.status,

    path
  };
}

// ============================================================
// EXTRACT LIVE EVENTS RESPONSE
// ============================================================
//
// Supports:
//
// [
//   {...event}
// ]
//
// and:
//
// {
//   events: [...]
// }
//
// and common wrapped variants.
// ============================================================

function extractLiveEvents(
  data: any
): AnyObj[] {

  if (
    Array.isArray(data)
  ) {

    return data.filter(
      item =>
        item &&
        typeof item ===
          "object"
    );
  }

  const direct =
    [
      data?.events,

      data?.data?.events,

      data?.result?.events,

      data?.items,

      data?.data
    ];

  for (
    const candidate of direct
  ) {

    if (
      Array.isArray(
        candidate
      )
    ) {

      return candidate.filter(
        item =>
          item &&
          typeof item ===
            "object"
      );
    }
  }

  return [];
}

// ============================================================
// DIAGNOSTIC LIVE EVENTS
// ============================================================
//
// This endpoint makes ONE request only.
//
// It is safe to test before relying on /live.
// ============================================================

async function diagnosticLiveEvents(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  try {

    const result =
      await getLiveSoccerEvents(
        env
      );

    const events =
      result.events;

    const liveDetected =
      events.filter(
        event =>
          isLiveEvent(
            event
          )
      );

    const statuses:
      Record<string, number> =
      {};

    for (
      const event of events
    ) {

      const status =
        String(
          event?.status ??
          event?.state ??
          "UNKNOWN"
        );

      statuses[status] =
        (statuses[status] || 0) +
        1;
    }

    const targetOddsCount =
      events.filter(
        event =>
          extractTargetOdds(
            event
          ) !== null
      ).length;

    return json(
      {

        success:
          true,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        action:
          "DIAGNOSTIC_LIVE_EVENTS",

        read_only:
          true,

        request: {

          path:
            result.path,

          requests_made:
            1,

          competition_requests_made:
            0,

          timeout_ms:
            CLOUDBET_TIMEOUT_MS
        },

        performance: {

          events_fetch_ms:
            result.elapsed_ms,

          total_elapsed_ms:
            Date.now() -
            started,

          http_status:
            result.response_status
        },

        result: {

          events_received:
            events.length,

          events_recognized_live:
            liveDetected.length,

          statuses,

          target_1h_over_05_found:
            targetOddsCount,

          first_10:
            events
              .slice(
                0,
                10
              )
              .map(
                event => ({
                  id:
                    event?.id ??
                    event?.eventId ??
                    event?.key ??
                    null,

                  name:
                    event?.name ??
                    null,

                  home:
                    event?.home ??
                    null,

                  away:
                    event?.away ??
                    null,

                  status:
                    event?.status ??
                    event?.state ??
                    null,

                  competition:
                    event?.competition ??
                    null,

                  target_odds:
                    extractTargetOdds(
                      event
                    )
                })
              )
        },

        interpretation: {

          old_method:
            "sports/soccer -> approximately 186 competition requests",

          new_method:
            "events?sport=soccer&live=true -> 1 request",

          expected:
            "The new method should be dramatically faster if Cloudbet returns all current live soccer events in this response."
        },

        timestamp:
          nowISO()
      }
    );

  } catch (error: any) {

    return json(
      {

        success:
          false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        action:
          "DIAGNOSTIC_LIVE_EVENTS",

        error:
          error?.message ||
          String(error),

        elapsed_ms:
          Date.now() -
          started,

        timestamp:
          nowISO()
      },
      502
    );
  }
}

// ============================================================
// NEW FAST /live
// ============================================================

async function live(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  let result: {
    data: AnyObj;
    events: AnyObj[];
    elapsed_ms: number;
    response_status: number;
    path: string;
  };

  try {

    result =
      await getLiveSoccerEvents(
        env
      );

  } catch (error: any) {

    return json(
      {

        success:
          false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        error:
          error?.message ||
          String(error),

        method:
          "DIRECT_LIVE_EVENTS"
      },
      502
    );
  }

  const events =
    result.events;

  const liveMatches:
    AnyObj[] = [];

  let liveEventsDetected =
    0;

  let invalidEvents =
    0;

  let oddsFound =
    0;

  for (
    const event of events
  ) {

    // Because Cloudbet was explicitly asked
    // for live=true, treat returned events as
    // the live candidate set.
    //
    // We still inspect status for diagnostics.
    if (
      !isLiveEvent(
        event
      )
    ) {

      // Do NOT throw away the event.
      //
      // Some Cloudbet responses can expose
      // a live event through the live filter
      // without using one of our recognized
      // textual status values.
    }

    liveEventsDetected++;

    const match =
      buildLiveMatch(
        event
      );

    if (
      !match
    ) {

      invalidEvents++;
      continue;
    }

    const odds =
      extractTargetOdds(
        event
      );

    if (
      odds
    ) {

      match.target_odds =
        odds;

      oddsFound++;
    }

    // Preserve minute if Cloudbet exposes it.
    if (
      event?.minute !==
      undefined
    ) {

      match.minute =
        event.minute;
    }

    // Preserve scores if available.
    if (
      event?.scores !==
      undefined
    ) {

      match.scores =
        event.scores;
    }

    liveMatches.push(
      match
    );
  }

  // ==========================================================
  // SORT
  // ==========================================================

  liveMatches.sort(
    (
      a,
      b
    ) => {

      const am =
        finiteNumber(
          a?.minute
        );

      const bm =
        finiteNumber(
          b?.minute
        );

      if (
        am === null &&
        bm === null
      ) {

        return 0;
      }

      if (
        am === null
      ) {

        return 1;
      }

      if (
        bm === null
      ) {

        return -1;
      }

      return am - bm;
    }
  );

  const returned =
    liveMatches.slice(
      0,
      100
    );

  const totalElapsed =
    Date.now() -
    started;

  return json(
    {

      success:
        true,

      test:
        "CLOUDBET LIVE SOCCER DIRECT EVENTS",

      version:
        VERSION,

      filter:
        "SOCCER + LIVE ONLY",

      source:
        "Cloudbet",

      sport:
        "soccer",

      method:
        "GET /events?sport=soccer&live=true&players=false&limit=10000",

      performance: {

        timeout_ms:
          CLOUDBET_TIMEOUT_MS,

        requests_total:
          1,

        competition_requests:
          0,

        events_request:
          result.path,

        events_fetch_ms:
          result.elapsed_ms,

        total_elapsed_ms:
          totalElapsed,

        speed_model:
          "ONE_REQUEST_INSTEAD_OF_FULL_COMPETITION_SCAN"
      },

      stats: {

        events_received:
          events.length,

        live_events_detected:
          liveEventsDetected,

        live_matches_found:
          liveMatches.length,

        live_matches_returned:
          returned.length,

        invalid_events:
          invalidEvents,

        result_limit:
          100,

        odds_1h_over_05_found:
          returned.filter(
            match =>
              match?.target_odds
          ).length,

        odds_1h_over_05_missing:
          returned.filter(
            match =>
              !match?.target_odds
          ).length
      },

      matches:
        returned
    }
  );
}

// ============================================================
// /health
// ============================================================

async function health(
  env: Env
): Promise<Response> {

  return json(
    {

      success:
        true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      mode:
        "READ_ONLY",

      betting:
        "DISABLED",

      api:
        "Cloudbet Sports API",

      live_method:
        "DIRECT_EVENTS",

      live_endpoint:
        "/events?sport=soccer&live=true&players=false&limit=10000",

      old_competition_concurrency:
        COMPETITION_CONCURRENCY,

      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      endpoints: [

        "/",

        "/health",

        "/live",

        "/search",

        "/event",

        "/diagnostic-soccer",

        "/diagnostic-live-events"
      ]
    }
  );
}

// ============================================================
// /event
// ============================================================

async function event(
  env: Env,
  url: URL
): Promise<Response> {

  const id =
    url.searchParams.get(
      "id"
    );

  if (!id) {

    return json(
      {
        success:
          false,

        error:
          "Missing ?id="
      },
      400
    );
  }

  try {

    const result =
      await cloudbetFetch(
        env,
        `/events/${encodeURIComponent(
          id
        )}`
      );

    const data =
      parseJSON(
        result.text,
        `/events/${id}`
      );

    return json(
      {

        success:
          result.response.ok,

        version:
          VERSION,

        elapsed_ms:
          result.elapsed_ms,

        http_status:
          result.response.status,

        event:
          data
      },

      result.response.ok
        ? 200
        : result.response.status
    );

  } catch (error: any) {

    return json(
      {

        success:
          false,

        version:
          VERSION,

        error:
          error?.message ||
          String(error)
      },
      502
    );
  }
}

// ============================================================
// /search
// ============================================================
//
// /search remains the old competition-based search.
// We are NOT changing it in V5.6.
// ============================================================

async function search(
  env: Env,
  url: URL
): Promise<Response> {

  const home =
    (
      url.searchParams.get(
        "home"
      ) ||
      ""
    )
      .trim()
      .toLowerCase();

  const away =
    (
      url.searchParams.get(
        "away"
      ) ||
      ""
    )
      .trim()
      .toLowerCase();

  if (
    !home ||
    !away
  ) {

    return json(
      {

        success:
          false,

        error:
          "Missing ?home= and ?away="
      },
      400
    );
  }

  try {

    const soccer =
      await getSoccerData(
        env
      );

    const competitions =
      extractCompetitionsForLive(
        soccer.data
      );

    const selected =
      competitions.filter(
        competition => {

          const eventCount =
            finiteNumber(
              competition?.eventCount
            );

          return (
            eventCount === null ||
            eventCount > 0
          );
        }
      );

    const results =
      await mapWithConcurrency(
        selected,
        COMPETITION_CONCURRENCY,
        async competition =>
          fetchCompetition(
            env,
            competition
          )
      );

    const matches:
      AnyObj[] = [];

    for (
      const result of results
    ) {

      for (
        const event of result.events
      ) {

        const rawHome =
          String(
            event?.home?.name ??
            event?.home ??
            event?.homeTeam?.name ??
            event?.homeTeam ??
            ""
          )
            .trim()
            .toLowerCase();

        const rawAway =
          String(
            event?.away?.name ??
            event?.away ??
            event?.awayTeam?.name ??
            event?.awayTeam ??
            ""
          )
            .trim()
            .toLowerCase();

        if (
          rawHome === home &&
          rawAway === away
        ) {

          matches.push(
            {

              event_id:
                event?.id ??
                event?.eventId ??
                event?.key ??
                null,

              home:
                event?.home ??
                event?.homeTeam ??
                null,

              away:
                event?.away ??
                event?.awayTeam ??
                null,

              competition:
                event?.competition?.key ??
                getCompetitionKey(
                  result.competition
                ),

              live:
                isLiveEvent(
                  event
                )
            }
          );
        }
      }
    }

    return json(
      {

        success:
          true,

        version:
          VERSION,

        home,

        away,

        matches
      }
    );

  } catch (error: any) {

    return json(
      {

        success:
          false,

        version:
          VERSION,

        error:
          error?.message ||
          String(error)
      },
      502
    );
  }
}

// ============================================================
// ROOT
// ============================================================

async function root(
  env: Env
): Promise<Response> {

  return json(
    {

      success:
        true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      mode:
        "READ_ONLY",

      betting:
        "DISABLED",

      endpoints: {

        health:
          "/health",

        live:
          "/live",

        search:
          "/search?home=HOME&away=AWAY",

        event:
          "/event?id=EVENT_ID",

        diagnostic_soccer:
          "/diagnostic-soccer",

        diagnostic_live_events:
          "/diagnostic-live-events"
      },

      live_optimization: {

        old:
          "sports/soccer -> competitions -> ~186 requests",

        new:
          "events?sport=soccer&live=true -> 1 request",

        expected:
          "Major reduction in Cloudbet loading time."
      },

      note:
        "V5.6 replaces the expensive full competition scan used by /live with Cloudbet's direct live-events endpoint. /search remains competition based."
    }
  );
}

// ============================================================
// FETCH HANDLER
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

      switch (
        path
      ) {

        case "/":
          return root(
            env
          );

        case "/health":
          return health(
            env
          );

        case "/live":
          return live(
            env
          );

        case "/search":
          return search(
            env,
            url
          );

        case "/event":
          return event(
            env,
            url
          );

        case "/diagnostic-soccer":
          return diagnosticSoccer(
            env
          );

        case "/diagnostic-live-events":
          return diagnosticLiveEvents(
            env
          );

        default:

          return json(
            {

              success:
                false,

              version:
                VERSION,

              error:
                "Not found",

              available_endpoints: [

                "/",

                "/health",

                "/live",

                "/search",

                "/event",

                "/diagnostic-soccer",

                "/diagnostic-live-events"
              ]
            },
            404
          );
      }

    } catch (error: any) {

      return json(
        {

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          error:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};
