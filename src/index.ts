// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.5
//
// V5.5:
// - /live BEHAVIOR UNCHANGED
// - Competition concurrency remains 24
// - Full soccer competition scan
// - No early stop
// - No odds/matcher changes
//
// NEW:
// - /diagnostic-soccer
// - Makes ONLY ONE request to /sports/soccer
// - Does NOT scan individual competitions
// - Inspects the returned competition structure
// - Looks for fields that may allow future LIVE filtering
// - Does NOT modify /live
//
// READ ONLY
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

const VERSION =
  "V5.5";

const CLOUDBET_TIMEOUT_MS =
  8000;

// IMPORTANT:
// V5.4 tested 48 and it was worse.
// Keep the proven V5.3/V5.4 baseline.
const COMPETITION_CONCURRENCY =
  24;

// ============================================================
// TYPES
// ============================================================

type AnyObj =
  Record<string, any>;

// ============================================================
// BASIC HELPERS
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

function nowISO(): string {
  return new Date().toISOString();
}

function finiteNumber(
  value: any
): number | null {
  return Number.isFinite(
    Number(value)
  )
    ? Number(value)
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
          method: "GET",

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
        Date.now() - started
    };

  } catch (error: any) {

    const elapsed =
      Date.now() - started;

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
// PARSE JSON
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
// GET SOCCER CATEGORIES
// ============================================================
//
// This is the same discovery request used by /live.
// V5.5 does NOT change it.
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
// COMPETITION EXTRACTION
// ============================================================
//
// Cloudbet structures can change slightly.
// We intentionally inspect common structures without
// changing /live logic.
// ============================================================

function findCompetitionArrays(
  root: AnyObj
): Array<{
  path: string;
  value: any[];
}> {

  const found: Array<{
    path: string;
    value: any[];
  }> = [];

  const visited =
    new Set<any>();

  function walk(
    value: any,
    path: string,
    depth: number
  ) {

    if (
      value === null ||
      value === undefined ||
      depth > 6
    ) {
      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    if (
      visited.has(value)
    ) {
      return;
    }

    visited.add(
      value
    );

    if (
      Array.isArray(value)
    ) {

      if (
        value.length > 0
      ) {

        const sample =
          value
            .slice(0, 10)
            .filter(
              x =>
                x &&
                typeof x ===
                  "object" &&
                !Array.isArray(x)
            );

        if (
          sample.length > 0
        ) {

          const looksLikeCompetition =
            sample.some(
              item =>
                [
                  "competition",
                  "competitionKey",
                  "key",
                  "eventCount",
                  "events",
                  "name",
                  "sport"
                ].some(
                  key =>
                    Object.prototype.hasOwnProperty.call(
                      item,
                      key
                    )
                )
            );

          if (
            looksLikeCompetition
          ) {

            found.push({
              path,
              value
            });
          }
        }
      }

      value
        .slice(0, 2000)
        .forEach(
          (
            item,
            index
          ) =>
            walk(
              item,
              `${path}[${index}]`,
              depth + 1
            )
        );

      return;
    }

    for (
      const [
        key,
        child
      ] of Object.entries(
        value
      )
    ) {

      walk(
        child,
        path
          ? `${path}.${key}`
          : key,
        depth + 1
      );
    }
  }

  walk(
    root,
    "",
    0
  );

  return found;
}

// ============================================================
// OBJECT KEY INVENTORY
// ============================================================

function collectKeys(
  items: any[]
): Record<
  string,
  number
> {

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

// ============================================================
// FIELD VALUE SAMPLE
// ============================================================

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

    let signature: string;

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
      values.length >= max
    ) {
      break;
    }
  }

  return values;
}

// ============================================================
// POSSIBLE LIVE-RELATED FIELDS
// ============================================================

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
            pattern
              .replace(
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

// ============================================================
// /diagnostic-soccer
// ============================================================
//
// IMPORTANT:
//
// This endpoint DOES NOT call /competitions/{key}.
//
// It only calls:
//
//     /sports/soccer
//
// Therefore it is safe to use for discovering whether the
// soccer discovery response itself contains enough information
// to filter competitions before the expensive 186 requests.
// ============================================================

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

        path:
          "/sports/soccer",

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

  const data =
    soccer.data;

  const arrays =
    findCompetitionArrays(
      data
    );

  // Pick the largest plausible competition array.
  let selected:
    {
      path: string;
      value: any[];
    } | null =
      null;

  for (
    const candidate of arrays
  ) {

    if (
      !selected ||
      candidate.value.length >
        selected.value.length
    ) {
      selected =
        candidate;
    }
  }

  const competitions =
    selected?.value || [];

  const topLevelKeys =
    Object.keys(
      data || {}
    );

  const competitionKeys =
    collectKeys(
      competitions
    );

  const interestingFields =
    detectInterestingFields(
      competitions
    );

  // ----------------------------------------------------------
  // Detect numeric event-count-like fields
  // ----------------------------------------------------------

  const countFields:
    Record<
      string,
      {
        present: number;
        nonzero: number;
        zero: number;
        values: any[];
      }
    > = {};

  for (
    const key of Object.keys(
      competitionKeys
    )
  ) {

    const normalized =
      key
        .toLowerCase()
        .replace(
          /[^a-z0-9]/g,
          ""
        );

    if (
      !(
        normalized.includes(
          "count"
        ) ||
        normalized.includes(
          "event"
        ) ||
        normalized.includes(
          "live"
        )
      )
    ) {
      continue;
    }

    let nonzero =
      0;

    let zero =
      0;

    for (
      const item of competitions
    ) {

      if (
        !item ||
        typeof item !==
          "object"
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
        Number(
          item[key]
        );

      if (
        Number.isFinite(
          value
        )
      ) {

        if (
          value > 0
        ) {
          nonzero++;
        } else {
          zero++;
        }
      }
    }

    countFields[key] = {
      present:
        competitionKeys[key],

      nonzero,

      zero,

      values:
        sampleFieldValues(
          competitions,
          key,
          20
        )
    };
  }

  // ----------------------------------------------------------
  // Compact sample of the first competitions
  // ----------------------------------------------------------

  const sample =
    competitions
      .slice(
        0,
        10
      )
      .map(
        (item: AnyObj) => {

          if (
            !item ||
            typeof item !==
              "object"
          ) {
            return item;
          }

          const output:
            AnyObj = {};

          for (
            const [
              key,
              value
            ] of Object.entries(
              item
            )
          ) {

            // Keep diagnostic output useful,
            // but avoid dumping huge nested arrays.
            if (
              Array.isArray(
                value
              )
            ) {

              output[key] = {
                type:
                  "array",

                length:
                  value.length
              };

            } else if (
              value &&
              typeof value ===
                "object"
            ) {

              output[key] = {
                type:
                  "object",

                keys:
                  Object.keys(
                    value
                  ).slice(
                    0,
                    50
                  )
              };

            } else {

              output[key] =
                value;
            }
          }

          return output;
        }
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
          Array.isArray(data)
            ? "array"
            : typeof data,

        top_level_keys:
          topLevelKeys,

        candidate_competition_arrays:
          arrays.map(
            item => ({
              path:
                item.path,

              length:
                item.value.length
            })
          ),

        selected_competition_array:
          selected
            ? {
                path:
                  selected.path,

                length:
                  selected.value.length
              }
            : null
      },

      competitions: {

        detected:
          competitions.length,

        key_presence:
          competitionKeys,

        count_fields:
          countFields,

        interesting_fields:
          interestingFields
      },

      sample_first_10:
        sample,

      interpretation: {
        purpose:
          "Determine whether /sports/soccer already exposes enough information to safely filter competitions before the expensive per-competition requests.",

        important:
          "This diagnostic does NOT change /live and does NOT filter any competitions.",

        next_step:
          "If a reliable live-related field exists here, we can test a filtered /live strategy separately."
      },

      timestamp:
        nowISO()
    }
  );
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
// COMPETITION EXTRACTION FOR /LIVE
// ============================================================
//
// This keeps the normal /live path separate from the new
// diagnostic endpoint.
// ============================================================

function extractCompetitionsForLive(
  data: AnyObj
): AnyObj[] {

  const candidates:
    any[][] = [];

  function walk(
    value: any,
    depth: number
  ) {

    if (
      value === null ||
      value === undefined ||
      depth > 5
    ) {
      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    if (
      Array.isArray(value)
    ) {

      if (
        value.length > 0
      ) {

        const sample =
          value
            .slice(0, 5)
            .filter(
              x =>
                x &&
                typeof x ===
                  "object" &&
                !Array.isArray(x)
            );

        if (
          sample.some(
            item =>
              Object.prototype.hasOwnProperty.call(
                item,
                "eventCount"
              ) ||
              Object.prototype.hasOwnProperty.call(
                item,
                "competition"
              ) ||
              Object.prototype.hasOwnProperty.call(
                item,
                "key"
              )
          )
        ) {

          candidates.push(
            value
          );
        }
      }

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
      const value2 of Object.values(
        value
      )
    ) {

      walk(
        value2,
        depth + 1
      );
    }
  }

  walk(
    data,
    0
  );

  if (
    candidates.length === 0
  ) {
    return [];
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.length -
      a.length
  );

  return candidates[0];
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
// COMPETITION EVENT EXTRACTION
// ============================================================

function extractEvents(
  data: AnyObj
): AnyObj[] {

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
      "started"
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
  competition: AnyObj
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
      getCompetitionKey(
        competition
      ),

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
// ODDS EXTRACTION
// ============================================================
//
// EXACT TARGET ONLY
// ============================================================

function extractTargetOdds(
  event: AnyObj
): AnyObj | null {

  const TARGET_MARKET =
    "soccer.total_goals_period_first_half";

  const TARGET_SUBMARKET =
    "period=1h";

  const TARGET_OUTCOME =
    "over";

  const TARGET_PARAMS =
    "total=0.5";

  const market =
    event?.markets?.[
      TARGET_MARKET
    ] ??
    event?.submarkets?.[
      TARGET_MARKET
    ] ??
    null;

  if (!market) {
    return null;
  }

  const submarket =
    market?.submarkets?.[
      TARGET_SUBMARKET
    ] ??
    market?.[
      TARGET_SUBMARKET
    ] ??
    null;

  const selections =
    submarket?.selections ??
    market?.selections ??
    [];

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
// FETCH ONE COMPETITION
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
      elapsed_ms: 0,
      success: false,
      error:
        "Competition key not found",
      events: []
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

      events: []
    };
  }
}

// ============================================================
// /live
// ============================================================
//
// V5.5 IMPORTANT:
//
// This function intentionally preserves the V5.4 behavior:
//
// /sports/soccer
//      ↓
// all active soccer competitions
//      ↓
// all competition requests
//      ↓
// live filtering
//
// NO NEW FILTER IS APPLIED HERE.
// ============================================================

async function live(
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

        error:
          error?.message ||
          String(error)
      },
      502
    );
  }

  const competitions =
    extractCompetitionsForLive(
      soccer.data
    );

  // Keep original behavior:
  // only competitions with eventCount > 0
  const selectedCompetitions =
    competitions.filter(
      competition => {

        const eventCount =
          finiteNumber(
            competition?.eventCount
          );

        if (
          eventCount === null
        ) {
          return true;
        }

        return eventCount > 0;
      }
    );

  const competitionStarted =
    Date.now();

  const results =
    await mapWithConcurrency(
      selectedCompetitions,
      COMPETITION_CONCURRENCY,
      async competition =>
        fetchCompetition(
          env,
          competition
        )
    );

  const competitionScanMs =
    Date.now() -
    competitionStarted;

  const liveMatches:
    AnyObj[] = [];

  let successful =
    0;

  let failed =
    0;

  let totalEvents =
    0;

  let liveEvents =
    0;

  const latency =
    results
      .map(
        result =>
          result.elapsed_ms
      )
      .filter(
        value =>
          Number.isFinite(
            value
          )
      )
      .sort(
        (a, b) =>
          a - b
      );

  for (
    const result of results
  ) {

    if (
      result.success
    ) {
      successful++;
    } else {
      failed++;
    }

    totalEvents +=
      result.events.length;

    for (
      const event of result.events
    ) {

      if (
        !isLiveEvent(
          event
        )
      ) {
        continue;
      }

      liveEvents++;

      const match =
        buildLiveMatch(
          event,
          result.competition
        );

      if (
        match
      ) {

        const odds =
          extractTargetOdds(
            event
          );

        if (
          odds
        ) {
          match.target_odds =
            odds;
        }

        liveMatches.push(
          match
        );
      }
    }
  }

  // Sort by minute if available,
  // otherwise preserve Cloudbet order.
  liveMatches.sort(
    (a, b) => {

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

  const totalScanMs =
    Date.now() -
    started;

  function percentile(
    p: number
  ): number | null {

    if (
      latency.length === 0
    ) {
      return null;
    }

    const index =
      Math.min(
        latency.length - 1,
        Math.max(
          0,
          Math.ceil(
            p *
              latency.length
          ) - 1
        )
      );

    return latency[index];
  }

  const avg =
    latency.length
      ? Math.round(
          latency.reduce(
            (
              sum,
              value
            ) =>
              sum + value,
            0
          ) /
            latency.length
        )
      : null;

  const median =
    percentile(
      0.5
    );

  const p90 =
    percentile(
      0.9
    );

  const p95 =
    percentile(
      0.95
    );

  const p99 =
    percentile(
      0.99
    );

  const first10 =
    latency.slice(
      0,
      10
    );

  const first24 =
    latency.slice(
      0,
      24
    );

  const last24 =
    latency.slice(
      -24
    );

  const average =
    (
      values: number[]
    ) =>
      values.length
        ? Math.round(
            values.reduce(
              (
                s,
                v
              ) =>
                s + v,
              0
            ) /
              values.length
          )
        : null;

  return json(
    {
      success:
        true,

      test:
        "CLOUDBET ALL LIVE SOCCER",

      version:
        VERSION,

      filter:
        "SOCCER + LIVE ONLY",

      source:
        "Cloudbet",

      sport:
        "soccer",

      performance: {

        timeout_ms:
          CLOUDBET_TIMEOUT_MS,

        competition_concurrency:
          COMPETITION_CONCURRENCY,

        previous_concurrency:
          48,

        concurrency_change:
          "48 -> 24",

        soccer_fetch_ms:
          soccer.elapsed_ms,

        competition_scan_ms:
          competitionScanMs,

        event_processing_ms:
          totalScanMs -
          soccer.elapsed_ms -
          competitionScanMs,

        total_scan_ms:
          totalScanMs,

        scan_method:
          "ALL_COMPETITIONS_NO_EARLY_STOP",

        slow_competition_requests:
          latency.filter(
            value =>
              value >= 1000
          ).length,

        slowest_competition_ms:
          latency.length
            ? latency[
                latency.length - 1
              ]
            : null,

        latency_diagnostic: {

          requests: {

            total:
              results.length,

            successful,

            failed,

            concurrency:
              COMPETITION_CONCURRENCY
          },

          latency: {

            requests_measured:
              latency.length,

            min_ms:
              latency.length
                ? latency[0]
                : null,

            max_ms:
              latency.length
                ? latency[
                    latency.length - 1
                  ]
                : null,

            average_ms:
              avg,

            median_ms:
              median,

            p90_ms:
              p90,

            p95_ms:
              p95,

            p99_ms:
              p99
          },

          position: {

            first_10_average_ms:
              average(
                first10
              ),

            first_24_average_ms:
              average(
                first24
              ),

            last_24_average_ms:
              average(
                last24
              )
          },

          interpretation: {

            likely_fast:
              false,

            likely_cloudbet_or_network_latency:
              true,

            possible_concurrency_pressure:
              false,

            possible_systemic_slowdown:
              false
          }
        }
      },

      stats: {

        competition_count:
          competitions.length,

        competitions_with_events:
          selectedCompetitions.length,

        competitions_checked:
          results.length,

        competitions_successful:
          successful,

        competitions_failed:
          failed,

        total_events:
          totalEvents,

        live_events_detected:
          liveEvents,

        live_matches_found:
          liveMatches.length,

        live_matches_returned:
          returned.length,

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
          ).length,

        errors:
          failed
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

      competition_concurrency:
        COMPETITION_CONCURRENCY,

      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      endpoints: [
        "/",
        "/health",
        "/live",
        "/search",
        "/event",
        "/diagnostic-soccer"
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
          "/diagnostic-soccer"
      },

      note:
        "V5.5 adds /diagnostic-soccer only. /live behavior remains unchanged."
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
                "/diagnostic-soccer"
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
