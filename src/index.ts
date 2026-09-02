// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.7.1
//
// V5.7.1:
// - PRESERVED V5.6 FAST LIVE PATH
// - /live uses Cloudbet /events endpoint
// - 1 request instead of ~186 competition requests
// - PRESERVED /search
// - PRESERVED /event
// - PRESERVED exact 1H OVER 0.5 odds detection
// - NEW /diagnostic-cloud0007
// - COMPACT Cloud0007 diagnostic
//
// IMPORTANT:
// - READ ONLY
// - BETTING DISABLED
// - /live is NOT changed by Cloud0007 diagnostic
// - No odds target changes
// - No betting
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

// ============================================================
// CONFIG
// ============================================================

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

const VERSION =
  "V5.7.1";

const CLOUDBET_TIMEOUT_MS =
  8000;

const COMPETITION_CONCURRENCY =
  24;

// ============================================================
// CLOUD0007
// ============================================================

const CLOUD0007_LIVE_SOCCER_URL =
  "https://www.cloud0007.com/en/sports/live?s=soccer";

const CLOUD0007_TIMEOUT_MS =
  10000;

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
// TYPES
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
      env[
        API_KEY_NAME as keyof Env
      ];

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

    if (
      error?.name ===
      "AbortError"
    ) {

      throw new Error(
        `Cloudbet request timed out after ${timeoutMs}ms: ${path}`
      );
    }

    throw new Error(
      `Cloudbet request failed: ${path} — ${
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
// GET SOCCER
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
// FLATTEN COMPETITIONS
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

// ============================================================
// COLLECT KEYS
// ============================================================

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

// ============================================================
// SAMPLE VALUES
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

// ============================================================
// INTERESTING FIELDS
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
          10
        )
    };
  }

  return interesting;
}

// ============================================================
// DIAGNOSTIC SOCCER
// ============================================================

async function diagnosticSoccer(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  try {

    const soccer =
      await getSoccerData(
        env
      );

    const competitions =
      flattenSoccerCompetitions(
        soccer.data
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
            ),

          categories:
            Array.isArray(
              soccer.data?.categories
            )
              ? soccer.data.categories.length
              : 0
        },

        competitions: {

          detected:
            competitions.length,

          key_presence:
            collectKeys(
              competitions
            ),

          interesting_fields:
            detectInterestingFields(
              competitions
            )
        },

        sample_first_10:
          competitions.slice(
            0,
            10
          ),

        interpretation: {

          live_filter_available:
            false,

          reason:
            "The /sports/soccer competition objects do not expose a reliable live-event count/status field.",

          recommended:
            "Use direct /events?sport=soccer&live=true."
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
// COMPETITIONS FOR SEARCH
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
// EXTRACT EVENTS
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
// FETCH COMPETITION
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
// CONCURRENCY
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
// LIVE EVENT
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

  return [
    "live",
    "inplay",
    "in-play",
    "started",
    "trading_live"
  ].includes(
    status
  );
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
// DIRECT LIVE EVENTS
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

  return {

    data,

    events:
      extractLiveEvents(
        data
      ),

    elapsed_ms:
      result.elapsed_ms,

    response_status:
      result.response.status,

    path
  };
}

// ============================================================
// EXTRACT LIVE EVENTS
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

  const candidates =
    [

      data?.events,

      data?.data?.events,

      data?.data?.data?.events,

      data?.result?.events,

      data?.items,

      data?.data
    ];

  for (
    const candidate of candidates
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

    const liveCount =
      events.filter(
        event =>
          isLiveEvent(
            event
          )
      ).length;

    const oddsCount =
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
            liveCount,

          statuses,

          target_1h_over_05_found:
            oddsCount,

          first_10:
            events.slice(
              0,
              10
            ).map(
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
                  event?.home?.name ??
                  event?.home ??
                  null,

                away:
                  event?.away?.name ??
                  event?.away ??
                  null,

                status:
                  event?.status ??
                  event?.state ??
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
            "events?sport=soccer&live=true -> 1 request"
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

        timestamp:
          nowISO()
      },
      502
    );
  }
}

// ============================================================
// CLOUD0007 — COMPACT HELPERS
// ============================================================

function extractScriptSourcesCompact(
  html: string
): string[] {

  const result:
    string[] = [];

  const regex =
    /<script[^>]+src=["']([^"']+)["']/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(html)) !== null
  ) {

    const src =
      match[1];

    if (
      src &&
      !result.includes(
        src
      )
    ) {

      result.push(
        src
      );
    }

    if (
      result.length >=
      30
    ) {

      break;
    }
  }

  return result;
}

// ============================================================
// CLOUD0007 URL EXTRACTION
// ============================================================

function extractPossibleUrlsCompact(
  html: string
): string[] {

  const urls =
    new Set<string>();

  const patterns = [

    /https?:\/\/[^"'\\\s<>]+/gi,

    /\/(?:api|pub|v\d+|sports|events|odds|live|graphql)[^"'\\\s<>]*/gi
  ];

  for (
    const pattern of patterns
  ) {

    const matches =
      html.match(
        pattern
      ) || [];

    for (
      const value of matches
    ) {

      const cleaned =
        value
          .replace(
            /[),;]+$/,
            ""
          );

      if (
        cleaned.length >= 8
      ) {

        urls.add(
          cleaned
        );
      }

      if (
        urls.size >=
        50
      ) {

        return Array.from(
          urls
        );
      }
    }
  }

  return Array.from(
    urls
  );
}

// ============================================================
// CLOUD0007 SIGNALS
// ============================================================

function detectCloud0007Signals(
  html: string
): AnyObj {

  const lower =
    html.toLowerCase();

  const terms = [

    "soccer",

    "football",

    "live",

    "cloudbet",

    "sports",

    "events",

    "odds",

    "trading_live",

    "__next_data__",

    "application/json",

    "websocket",

    "socket.io",

    "graphql",

    "api"
  ];

  const signals:
    Record<string, boolean> =
    {};

  for (
    const term of terms
  ) {

    signals[term] =
      lower.includes(
        term
      );
  }

  return signals;
}

// ============================================================
// CLOUD0007 EMBEDDED DATA — COMPACT
// ============================================================

function inspectEmbeddedDataCompact(
  html: string
): AnyObj {

  const result:
    AnyObj = {};

  const nextData =
    html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );

  result.next_data_present =
    !!nextData;

  if (
    nextData?.[1]
  ) {

    result.next_data_chars =
      nextData[1].length;

    try {

      const parsed =
        JSON.parse(
          nextData[1]
        );

      result.next_data_parseable =
        true;

      result.next_data_type =
        Array.isArray(
          parsed
        )
          ? "array"
          : typeof parsed;

      if (
        parsed &&
        typeof parsed ===
          "object"
      ) {

        result.next_data_keys =
          Object.keys(
            parsed
          ).slice(
            0,
            30
          );
      }

    } catch {

      result.next_data_parseable =
        false;
    }
  }

  const applicationJsonCount =
    (
      html.match(
        /<script[^>]*type=["']application\/json["']/gi
      ) || []
    ).length;

  result.application_json_script_count =
    applicationJsonCount;

  return result;
}

// ============================================================
// CLOUD0007 DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      CLOUD0007_TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        CLOUD0007_LIVE_SOCCER_URL,
        {

          method:
            "GET",

          headers: {

            "accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

            "user-agent":
              "Mozilla/5.0 (compatible; CloudbetLiveDiagnostic/5.7.1)"
          },

          redirect:
            "follow",

          cache:
            "no-store",

          signal:
            controller.signal
        }
      );

    const html =
      await response.text();

    const elapsed =
      Date.now() -
      started;

    const responseBytes =
      new TextEncoder()
        .encode(
          html
        ).length;

    const titleMatch =
      html.match(
        /<title[^>]*>([\s\S]*?)<\/title>/i
      );

    const title =
      titleMatch?.[1]
        ?.replace(
          /\s+/g,
          " "
        )
        ?.trim() ||
      null;

    const scripts =
      extractScriptSourcesCompact(
        html
      );

    const possibleUrls =
      extractPossibleUrlsCompact(
        html
      );

    const signals =
      detectCloud0007Signals(
        html
      );

    const embedded =
      inspectEmbeddedDataCompact(
        html
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
          "DIAGNOSTIC_CLOUD0007",

        read_only:
          true,

        request: {

          url:
            CLOUD0007_LIVE_SOCCER_URL,

          method:
            "GET",

          requests_made:
            1,

          timeout_ms:
            CLOUD0007_TIMEOUT_MS
        },

        performance: {

          elapsed_ms:
            elapsed,

          http_status:
            response.status,

          content_type:
            response.headers.get(
              "content-type"
            ),

          response_bytes:
            responseBytes,

          html_chars:
            html.length
        },

        page: {

          final_url:
            response.url,

          redirected:
            response.url !==
            CLOUD0007_LIVE_SOCCER_URL,

          title,

          signals
        },

        embedded_data:
          embedded,

        scripts: {

          count:
            scripts.length,

          first_30:
            scripts
        },

        possible_urls: {

          count:
            possibleUrls.length,

          first_50:
            possibleUrls
        },

        html_analysis: {

          contains_event_word:
            html
              .toLowerCase()
              .includes(
                "event"
              ),

          contains_odds_word:
            html
              .toLowerCase()
              .includes(
                "odds"
              ),

          contains_live_word:
            html
              .toLowerCase()
              .includes(
                "live"
              ),

          contains_api_reference:
            possibleUrls.length >
            0
        },

        interpretation: {

          purpose:
            "Compact inspection of the Cloud0007 Live Soccer page.",

          current_live_path:
            "UNCHANGED",

          no_html_dump:
            true,

          next_step:
            "Use discovered API URLs, embedded data or script references to identify a faster live soccer source."
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
          "DIAGNOSTIC_CLOUD0007",

        url:
          CLOUD0007_LIVE_SOCCER_URL,

        elapsed_ms:
          Date.now() -
          started,

        error:
          error?.name ===
          "AbortError"

            ? `Cloud0007 request timed out after ${CLOUD0007_TIMEOUT_MS}ms`

            : (
                error?.message ||
                String(error)
              ),

        timestamp:
          nowISO()
      },
      502
    );

  } finally {

    clearTimeout(
      timer
    );
  }
}

// ============================================================
// /LIVE
// ============================================================

async function live(
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

    const matches:
      AnyObj[] = [];

    let invalidEvents =
      0;

    let oddsFound =
      0;

    for (
      const event of events
    ) {

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

      if (
        event?.minute !==
        undefined
      ) {

        match.minute =
          event.minute;
      }

      if (
        event?.scores !==
        undefined
      ) {

        match.scores =
          event.scores;
      }

      matches.push(
        match
      );
    }

    matches.sort(
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
      matches.slice(
        0,
        100
      );

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

          events_fetch_ms:
            result.elapsed_ms,

          total_elapsed_ms:
            Date.now() -
            started,

          speed_model:
            "ONE_REQUEST_INSTEAD_OF_FULL_COMPETITION_SCAN"
        },

        stats: {

          events_received:
            events.length,

          live_matches_found:
            matches.length,

          live_matches_returned:
            returned.length,

          invalid_events:
            invalidEvents,

          odds_1h_over_05_found:
            oddsFound,

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
}

// ============================================================
// /HEALTH
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

      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      endpoints: [

        "/",

        "/health",

        "/live",

        "/search",

        "/event",

        "/diagnostic-soccer",

        "/diagnostic-live-events",

        "/diagnostic-cloud0007"
      ]
    }
  );
}

// ============================================================
// /EVENT
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
// /SEARCH
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
        const currentEvent of result.events
      ) {

        const rawHome =
          String(
            currentEvent?.home?.name ??
            currentEvent?.home ??
            currentEvent?.homeTeam?.name ??
            currentEvent?.homeTeam ??
            ""
          )
            .trim()
            .toLowerCase();

        const rawAway =
          String(
            currentEvent?.away?.name ??
            currentEvent?.away ??
            currentEvent?.awayTeam?.name ??
            currentEvent?.awayTeam ??
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
                currentEvent?.id ??
                currentEvent?.eventId ??
                currentEvent?.key ??
                null,

              home:
                currentEvent?.home ??
                currentEvent?.homeTeam ??
                null,

              away:
                currentEvent?.away ??
                currentEvent?.awayTeam ??
                null,

              competition:
                currentEvent?.competition?.key ??
                getCompetitionKey(
                  result.competition
                ),

              live:
                isLiveEvent(
                  currentEvent
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
          "/diagnostic-live-events",

        diagnostic_cloud0007:
          "/diagnostic-cloud0007"
      },

      live_optimization: {

        old:
          "sports/soccer -> competitions -> approximately 186 requests",

        new:
          "events?sport=soccer&live=true -> 1 request",

        current:
          "V5.7.1 keeps the V5.6 direct-events /live path unchanged."
      },

      cloud0007_diagnostic: {

        url:
          CLOUD0007_LIVE_SOCCER_URL,

        timeout_ms:
          CLOUD0007_TIMEOUT_MS,

        purpose:
          "Inspect the Live Soccer page for API URLs, scripts and embedded data.",

        response_mode:
          "COMPACT",

        html_dump:
          false,

        changes_live:
          false
      }
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

        case "/diagnostic-cloud0007":
          return diagnosticCloud0007(
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

                "/diagnostic-live-events",

                "/diagnostic-cloud0007"
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
