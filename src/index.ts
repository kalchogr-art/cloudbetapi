// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.7.5
// READ ONLY
//
// V5.7.5:
// - /live остава НЕПРОМЕНЕН
// - /search остава НЕПРОМЕНЕН
// - /event остава НЕПРОМЕНЕН
// - /diagnostic-cloud0007 остава диагностичен
// - /diagnostic-cloud0007-api остава диагностичен
// - /diagnostic-cloud0007-routes остава диагностичен
// - NEW: /diagnostic-events-raw
// - Директна RAW диагностика на официалния Cloudbet /events
// - НЕ използва extractEvents()
// - НЕ използва isLiveEvent()
// - Показва реалния response shape
// - НЕ прави betting
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

type AnyObj = Record<string, any>;

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

const VERSION =
  "V5.7.5";

const CLOUDBET_TIMEOUT_MS =
  8000;

const COMPETITION_CONCURRENCY =
  24;

const CLOUD0007_URL =
  "https://www.cloud0007.com/en/sports/live?s=soccer";

const CLOUD0007_ORIGIN =
  "https://www.cloud0007.com";

const CLOUD0007_PAGE_TIMEOUT_MS =
  10000;

const CLOUD0007_JS_TIMEOUT_MS =
  7000;

const CLOUD0007_JS_CONCURRENCY =
  6;

const RAW_EVENTS_PREVIEW_CHARS =
  20000;

// ============================================================
// BASIC HELPERS
// ============================================================

function json(
  data: AnyObj,
  status = 200
): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control":
          "no-store, no-cache, must-revalidate",
      },
    }
  );
}

function nowISO(): string {
  return new Date().toISOString();
}

function finiteNumber(
  value: any
): number | null {
  const n =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(n)
    ? n
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
  elapsedMs: number;
}> {
  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const headers: Record<string, string> = {
      "accept":
        "application/json",
      "cache-control":
        "no-cache",
      "pragma":
        "no-cache",
    };

    const apiKey =
      env?.[API_KEY_NAME];

    if (apiKey) {
      headers["X-API-Key"] =
        apiKey;
    }

    const response =
      await fetch(
        `${API_BASE}${path}`,
        {
          method: "GET",
          headers,
          signal:
            controller.signal,
        }
      );

    return {
      response,
      elapsedMs:
        Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function parseJSON(
  response: Response
): Promise<any> {
  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      _non_json: true,
      _text_preview:
        text.slice(0, 2000),
    };
  }
}

// ============================================================
// SOCCER DATA HELPERS
// ============================================================

function getSoccerData(
  data: any
): any {
  if (!data) {
    return null;
  }

  if (
    data.soccer !== undefined
  ) {
    return data.soccer;
  }

  if (
    data.data?.soccer !== undefined
  ) {
    return data.data.soccer;
  }

  if (
    data.result?.soccer !== undefined
  ) {
    return data.result.soccer;
  }

  return data;
}

function flattenSoccerCompetitions(
  data: any
): any[] {
  const soccer =
    getSoccerData(data);

  if (!soccer) {
    return [];
  }

  const result: any[] = [];

  const candidates = [
    soccer?.competitions,
    soccer?.data?.competitions,
    soccer?.result?.competitions,
    soccer?.items,
    soccer?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      result.push(
        ...candidate
      );
    }
  }

  if (
    result.length === 0 &&
    Array.isArray(soccer)
  ) {
    result.push(
      ...soccer
    );
  }

  return result;
}

function collectKeys(
  value: any,
  maxDepth = 4,
  depth = 0
): string[] {
  if (
    depth > maxDepth ||
    value === null ||
    value === undefined
  ) {
    return [];
  }

  if (
    typeof value !== "object"
  ) {
    return [];
  }

  const keys =
    new Set<string>();

  for (
    const key of Object.keys(value)
  ) {
    keys.add(key);

    if (
      depth < maxDepth
    ) {
      const child =
        value[key];

      for (
        const nested of collectKeys(
          child,
          maxDepth,
          depth + 1
        )
      ) {
        keys.add(
          `${key}.${nested}`
        );
      }
    }
  }

  return Array.from(keys);
}

function sampleFieldValues(
  value: any,
  fields: string[],
  max = 20
): AnyObj {
  const result: AnyObj = {};

  if (
    !value ||
    typeof value !== "object"
  ) {
    return result;
  }

  for (
    const field of fields
  ) {
    if (
      value[field] !== undefined
    ) {
      result[field] =
        value[field];
    }

    if (
      Object.keys(result).length >= max
    ) {
      break;
    }
  }

  return result;
}

function detectInterestingFields(
  data: any
): AnyObj {
  const keys =
    collectKeys(
      data,
      3
    );

  const interesting =
    keys.filter(
      key =>
        /live|inplay|in_play|status|event|market|selection|odds|price|sport|competition/i.test(
          key
        )
    );

  return {
    total_keys:
      keys.length,
    interesting_keys:
      interesting.slice(0, 200),
  };
}

// ============================================================
// COMPETITION EXTRACTION
// ============================================================

function getCompetitionKey(
  competition: any
): string | null {
  if (!competition) {
    return null;
  }

  const candidates = [
    competition.key,
    competition.id,
    competition.competitionKey,
    competition.competition_key,
    competition.slug,
    competition.name,
  ];

  for (
    const value of candidates
  ) {
    if (
      value !== undefined &&
      value !== null &&
      String(value).trim()
    ) {
      return String(value);
    }
  }

  return null;
}

function extractCompetitionsForLive(
  data: any
): any[] {
  return flattenSoccerCompetitions(
    data
  );
}

function extractEvents(
  data: any
): any[] {
  if (!data) {
    return [];
  }

  if (
    Array.isArray(data)
  ) {
    return data;
  }

  const candidates = [
    data.events,
    data.data?.events,
    data.data?.data?.events,
    data.result?.events,
    data.result?.data?.events,
    data.items,
    data.data,
  ];

  for (
    const candidate of candidates
  ) {
    if (
      Array.isArray(candidate)
    ) {
      return candidate;
    }
  }

  return [];
}

// ============================================================
// LIVE DETECTION
// ============================================================

function isLiveEvent(
  event: any
): boolean {
  if (!event) {
    return false;
  }

  const booleanFields = [
    "live",
    "isLive",
    "inPlay",
    "in_play",
  ];

  for (
    const field of booleanFields
  ) {
    if (
      event[field] === true
    ) {
      return true;
    }
  }

  const statuses = [
    event.status,
    event.state,
    event.eventStatus,
    event.event_status,
  ];

  for (
    const value of statuses
  ) {
    if (
      value === undefined ||
      value === null
    ) {
      continue;
    }

    const normalized =
      String(value)
        .toLowerCase()
        .replace(/[-_\s]/g, "");

    if (
      normalized === "live" ||
      normalized === "inplay" ||
      normalized === "started" ||
      normalized === "tradinglive"
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// TARGET ODDS
// ============================================================

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

function extractTargetOdds(
  event: any
): AnyObj | null {
  if (!event) {
    return null;
  }

  const markets =
    event.markets ||
    event.market ||
    event.odds ||
    event.lines;

  if (!markets) {
    return null;
  }

  const inspect =
    (
      market: any,
      marketName?: string
    ): AnyObj | null => {
      if (!market) {
        return null;
      }

      const selections =
        market.selections ||
        market.outcomes ||
        market.prices;

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
        if (!selection) {
          continue;
        }

        const outcome =
          selection.outcome ??
          selection.name ??
          selection.side;

        const params =
          selection.params ??
          selection.parameters;

        const marketValue =
          selection.market ??
          selection.marketKey ??
          selection.market_name ??
          marketName;

        const submarket =
          selection.submarket ??
          selection.subMarket ??
          selection.submarketKey ??
          selection.period ??
          market.submarket ??
          market.subMarket;

        const marketMatches =
          marketValue ===
          TARGET_MARKET;

        const submarketMatches =
          submarket ===
            TARGET_SUBMARKET ||
          params ===
            TARGET_PARAMS &&
          marketValue ===
            TARGET_MARKET;

        const outcomeMatches =
          outcome ===
          TARGET_OUTCOME;

        const paramsMatches =
          params ===
          TARGET_PARAMS;

        if (
          marketMatches &&
          submarketMatches &&
          outcomeMatches &&
          paramsMatches
        ) {
          const price =
            finiteNumber(
              selection.price ??
              selection.odds ??
              selection.raw_price
            );

          if (
            price === null ||
            price <= 1
          ) {
            continue;
          }

          const maxStake =
            finiteNumber(
              selection.maxStake
            );

          if (
            maxStake !== null &&
            maxStake <= 0
          ) {
            continue;
          }

          const status =
            selection.status;

          const disabled =
            selection.enabled === false ||
            selection.active === false ||
            selection.trading === false ||
            selection.selection_enabled === false ||
            (
              typeof status ===
                "string" &&
              /disabled|closed|suspended|inactive/i.test(
                status
              )
            );

          if (disabled) {
            continue;
          }

          return {
            outcome,
            params,
            market:
              marketValue,
            submarket,
            price,
            maxStake:
              maxStake ??
              undefined,
            status:
              status ??
              null,
          };
        }
      }

      return null;
    };

  if (
    Array.isArray(markets)
  ) {
    for (
      const market of markets
    ) {
      const result =
        inspect(
          market,
          market?.market ??
            market?.key ??
            market?.name
        );

      if (result) {
        return result;
      }
    }

    return null;
  }

  if (
    typeof markets ===
    "object"
  ) {
    for (
      const [
        marketName,
        market
      ] of Object.entries(
        markets
      )
    ) {
      const result =
        inspect(
          market,
          marketName
        );

      if (result) {
        return result;
      }
    }
  }

  return null;
}

// ============================================================
// LIVE MATCH BUILD
// ============================================================

function buildLiveMatch(
  event: any
): AnyObj {
  return {
    id:
      event?.id ??
      event?.eventId ??
      event?.event_id ??
      null,

    name:
      event?.name ??
      event?.eventName ??
      null,

    home:
      event?.home ??
      event?.homeTeam ??
      event?.home_team ??
      event?.participants?.[0]?.name ??
      null,

    away:
      event?.away ??
      event?.awayTeam ??
      event?.away_team ??
      event?.participants?.[1]?.name ??
      null,

    status:
      event?.status ??
      event?.state ??
      null,

    live:
      isLiveEvent(
        event
      ),

    target_1h_over_05:
      extractTargetOdds(
        event
      ),
  };
}

// ============================================================
// DIRECT CLOUD0007 PAGE
// ============================================================

async function fetchCloud0007(
  url: string,
  timeoutMs: number
): Promise<{
  response: Response;
  text: string;
  elapsedMs: number;
  finalUrl: string;
}> {
  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          redirect: "follow",
          headers: {
            "accept":
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language":
              "en-US,en;q=0.9",
            "cache-control":
              "no-cache",
            "pragma":
              "no-cache",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
          },
          signal:
            controller.signal,
        }
      );

    const text =
      await response.text();

    return {
      response,
      text,
      elapsedMs:
        Date.now() - started,
      finalUrl:
        response.url || url,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// SCRIPT URL EXTRACTION
// ============================================================

function extractScriptUrls(
  html: string
): string[] {
  const urls =
    new Set<string>();

  const regex =
    /<script[^>]+src=["']([^"']+)["']/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(html))
  ) {
    let src =
      match[1];

    try {
      src =
        new URL(
          src,
          CLOUD0007_ORIGIN
        ).href;

      if (
        src.includes(
          "_next/static/"
        ) &&
        src.endsWith(".js")
      ) {
        urls.add(src);
      }
    } catch {
      // ignore
    }
  }

  return Array.from(
    urls
  );
}

// ============================================================
// TARGET SCRIPT FILTER
// ============================================================

function isTargetScript(
  url: string
): boolean {
  return (
    url.includes(
      "54692-cd745df6cb747e75.js"
    ) ||
    url.includes(
      "6610-3f9c92912615e51d.js"
    )
  );
}

// ============================================================
// CONTEXT EXTRACTION
// ============================================================

function normalizeSnippet(
  value: string,
  max = 1800
): string {
  return value
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      max
    );
}

function extractContexts(
  source: string,
  keywords: string[],
  radius = 1400
): AnyObj[] {
  const results: AnyObj[] = [];
  const seen =
    new Set<string>();

  const lower =
    source.toLowerCase();

  for (
    const keyword of keywords
  ) {
    const needle =
      keyword.toLowerCase();

    let startAt =
      0;

    while (
      results.length < 30
    ) {
      const index =
        lower.indexOf(
          needle,
          startAt
        );

      if (
        index === -1
      ) {
        break;
      }

      const left =
        Math.max(
          0,
          index - radius
        );

      const right =
        Math.min(
          source.length,
          index +
            needle.length +
            radius
        );

      const context =
        normalizeSnippet(
          source.slice(
            left,
            right
          ),
          radius * 2
        );

      const key =
        context.slice(
          0,
          500
        );

      if (
        !seen.has(key)
      ) {
        seen.add(key);

        results.push({
          keyword,
          position:
            index,
          context,
        });
      }

      startAt =
        index +
        needle.length;
    }
  }

  return results;
}

// ============================================================
// REQUEST PATTERN EXTRACTION
// ============================================================

function extractRequestPatterns(
  source: string
): AnyObj[] {
  const results: AnyObj[] = [];

  const patterns = [
    {
      name:
        "pulse_feed",
      keywords: [
        "/app-api/pulse/feed",
        "pulse/feed",
      ],
    },
    {
      name:
        "pulse_feed_version",
      keywords: [
        "/app-api/pulse/feed-version",
        "pulse/feed-version",
      ],
    },
    {
      name:
        "sports_api_v6",
      keywords: [
        "/sports-api/v6/sports",
      ],
    },
    {
      name:
        "sports_api_c_v6",
      keywords: [
        "/sports-api/c/v6/sports",
      ],
    },
    {
      name:
        "sports_lines",
      keywords: [
        "/sports-betting/v4/lines",
      ],
    },
    {
      name:
        "events",
      keywords: [
        "/events",
      ],
    },
    {
      name:
        "fetch",
      keywords: [
        "fetch(",
      ],
    },
    {
      name:
        "axios",
      keywords: [
        "axios",
      ],
    },
    {
      name:
        "query_params",
      keywords: [
        "params:",
        "query:",
        "URLSearchParams",
      ],
    },
    {
      name:
        "inplay",
      keywords: [
        "inplay",
        "in-play",
        "in_play",
      ],
    },
  ];

  for (
    const pattern of patterns
  ) {
    const contexts =
      extractContexts(
        source,
        pattern.keywords,
        1000
      );

    if (
      contexts.length
    ) {
      results.push({
        name:
          pattern.name,
        matches:
          contexts.slice(
            0,
            8
          ),
      });
    }
  }

  return results;
}

// ============================================================
// JS FETCH
// ============================================================

async function fetchJS(
  url: string,
  timeoutMs: number
): Promise<{
  ok: boolean;
  status: number;
  text: string;
  elapsedMs: number;
  error?: string;
}> {
  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          redirect: "follow",
          headers: {
            "accept":
              "application/javascript,text/javascript,*/*;q=0.8",
            "cache-control":
              "no-cache",
            "pragma":
              "no-cache",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
            "referer":
              CLOUD0007_URL,
          },
          signal:
            controller.signal,
        }
      );

    const text =
      await response.text();

    return {
      ok:
        response.ok,
      status:
        response.status,
      text,
      elapsedMs:
        Date.now() - started,
    };
  } catch (
    error
  ) {
    return {
      ok: false,
      status: 0,
      text: "",
      elapsedMs:
        Date.now() - started,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(timer);
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

  let cursor =
    0;

  async function runner() {
    while (true) {
      const index =
        cursor++;

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
    Array.from(
      {
        length:
          Math.min(
            concurrency,
            items.length
          ),
      },
      () => runner()
    );

  await Promise.all(
    workers
  );

  return results;
}

// ============================================================
// V5.7.4 CLOUD0007 API DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007API():
  Promise<Response> {
  const started =
    Date.now();

  let page;

  try {
    page =
      await fetchCloud0007(
        CLOUD0007_URL,
        CLOUD0007_PAGE_TIMEOUT_MS
      );
  } catch (
    error
  ) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-live-soccer-detector",
        version:
          VERSION,
        action:
          "DIAGNOSTIC_CLOUD0007_API",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      502
    );
  }

  const allScripts =
    extractScriptUrls(
      page.text
    );

  const targetScripts =
    allScripts.filter(
      isTargetScript
    );

  const scriptResults =
    await mapWithConcurrency(
      targetScripts,
      CLOUD0007_JS_CONCURRENCY,
      async url => {
        const result =
          await fetchJS(
            url,
            CLOUD0007_JS_TIMEOUT_MS
          );

        if (
          !result.ok
        ) {
          return {
            src: url,
            ok: false,
            status:
              result.status,
            elapsed_ms:
              result.elapsedMs,
            error:
              result.error ??
              null,
          };
        }

        const source =
          result.text;

        const requests =
          extractRequestPatterns(
            source
          );

        return {
          src: url,
          ok: true,
          status:
            result.status,
          elapsed_ms:
            result.elapsedMs,
          chars:
            source.length,
          request_patterns:
            requests,
        };
      }
    );

  const useful =
    scriptResults.filter(
      (item: any) =>
        item.ok &&
        Array.isArray(
          item.request_patterns
        ) &&
        item.request_patterns.length > 0
    );

  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_CLOUD0007_API",

    read_only:
      true,

    current_live_path:
      "UNCHANGED",

    request: {
      page_url:
        CLOUD0007_URL,

      page_timeout_ms:
        CLOUD0007_PAGE_TIMEOUT_MS,

      js_timeout_ms:
        CLOUD0007_JS_TIMEOUT_MS,

      target_scripts:
        [
          "54692-cd745df6cb747e75.js",
          "6610-3f9c92912615e51d.js",
        ],
    },

    performance: {
      page_fetch_ms:
        page.elapsedMs,

      total_elapsed_ms:
        Date.now() -
        started,
    },

    page: {
      http_status:
        page.response.status,

      final_url:
        page.finalUrl,

      html_chars:
        page.text.length,

      scripts_found:
        allScripts.length,

      target_scripts_found:
        targetScripts.length,
    },

    scripts: {
      results:
        scriptResults,

      useful_scripts:
        useful.length,
    },

    interpretation: {
      purpose:
        "Extract only the relevant API-call context from Cloud0007 sports JS bundles.",

      important:
        "The existing /live endpoint was NOT changed.",

      next_step:
        "Inspect request_patterns to identify the exact live sports API, HTTP method, parameters and feed mechanism.",
    },
  });
}

// ============================================================
// ORIGINAL CLOUD0007 DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007():
  Promise<Response> {
  const started =
    Date.now();

  let page;

  try {
    page =
      await fetchCloud0007(
        CLOUD0007_URL,
        CLOUD0007_PAGE_TIMEOUT_MS
      );
  } catch (
    error
  ) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-live-soccer-detector",
        version:
          VERSION,
        action:
          "DIAGNOSTIC_CLOUD0007",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      502
    );
  }

  const html =
    page.text;

  const nextDataMatch =
    html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );

  let nextData:
    any = null;

  if (
    nextDataMatch?.[1]
  ) {
    try {
      nextData =
        JSON.parse(
          nextDataMatch[1]
        );
    } catch {
      nextData = null;
    }
  }

  const signals: AnyObj = {
    soccer:
      /soccer/i.test(
        html
      ),

    football:
      /football/i.test(
        html
      ),

    live:
      /live/i.test(
        html
      ),

    cloudbet:
      /cloudbet/i.test(
        html
      ),

    sports:
      /sports/i.test(
        html
      ),

    events:
      /events/i.test(
        html
      ),

    odds:
      /odds/i.test(
        html
      ),

    trading_live:
      /TRADING_LIVE/i.test(
        html
      ),

    __next_data__:
      !!nextDataMatch,

    application_json:
      /application\/json/i.test(
        html
      ),

    websocket:
      /websocket/i.test(
        html
      ),

    socket_io:
      /socket\.io/i.test(
        html
      ),

    graphql:
      /graphql/i.test(
        html
      ),

    api:
      /\/api\//i.test(
        html
      ),
  };

  const scripts =
    extractScriptUrls(
      html
    );

  const absoluteUrls =
    Array.from(
      new Set(
        (
          html.match(
            /https?:\/\/[^\s"'<>]+/gi
          ) || []
        ).slice(
          0,
          50
        )
      )
    );

  return json({
    success: true,

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
        CLOUD0007_URL,

      method:
        "GET",

      requests_made:
        1,

      timeout_ms:
        CLOUD0007_PAGE_TIMEOUT_MS,
    },

    performance: {
      elapsed_ms:
        page.elapsedMs,

      http_status:
        page.response.status,

      content_type:
        page.response.headers.get(
          "content-type"
        ),

      response_bytes:
        new TextEncoder().encode(
          html
        ).length,

      html_chars:
        html.length,
    },

    page: {
      final_url:
        page.finalUrl,

      redirected:
        page.finalUrl !==
        CLOUD0007_URL,

      title:
        (
          html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
          )?.[1] ??
          ""
        ).trim(),

      signals,
    },

    embedded_data: {
      next_data_present:
        !!nextDataMatch,

      next_data_chars:
        nextDataMatch?.[1]
          ?.length ??
        0,

      next_data_parseable:
        !!nextData,

      next_data_type:
        nextData === null
          ? null
          : typeof nextData,

      next_data_keys:
        nextData &&
        typeof nextData ===
          "object"
          ? Object.keys(
              nextData
            )
          : [],

      application_json_script_count:
        (
          html.match(
            /<script[^>]+type=["']application\/json["'][^>]*>/gi
          ) || []
        ).length,
    },

    scripts: {
      count:
        scripts.length,

      first_30:
        scripts.slice(
          0,
          30
        ),
    },

    possible_urls: {
      count:
        absoluteUrls.length,

      first_50:
        absoluteUrls,
    },

    html_analysis: {
      contains_event_word:
        /event/i.test(
          html
        ),

      contains_odds_word:
        /odds/i.test(
          html
        ),

      contains_live_word:
        /live/i.test(
          html
        ),

      contains_api_reference:
        /api/i.test(
          html
        ),
    },

    interpretation: {
      purpose:
        "Compact inspection of the Cloud0007 Live Soccer page.",

      current_live_path:
        "UNCHANGED",

      no_html_dump:
        true,

      next_step:
        "Use /diagnostic-cloud0007-api to inspect the exact sports API calls used by the frontend.",
    },
  });
}

// ============================================================
// CLOUD0007 JS DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007JS():
  Promise<Response> {
  const started =
    Date.now();

  let page;

  try {
    page =
      await fetchCloud0007(
        CLOUD0007_URL,
        CLOUD0007_PAGE_TIMEOUT_MS
      );
  } catch (
    error
  ) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-live-soccer-detector",
        version:
          VERSION,
        action:
          "DIAGNOSTIC_CLOUD0007_JS",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      502
    );
  }

  const scripts =
    extractScriptUrls(
      page.text
    );

  const results =
    await mapWithConcurrency(
      scripts,
      CLOUD0007_JS_CONCURRENCY,
      async url => {
        const result =
          await fetchJS(
            url,
            CLOUD0007_JS_TIMEOUT_MS
          );

        if (
          !result.ok
        ) {
          return {
            src: url,
            ok: false,
            status:
              result.status,
            elapsed_ms:
              result.elapsedMs,
            error:
              result.error ??
              null,
          };
        }

        const source =
          result.text;

        const patterns =
          [
            "api",
            "fetch",
            "axios",
            "xhr",
            "websocket",
            "inplay",
            "live",
            "sports",
            "event",
            "events",
            "feed",
          ];

        const patternHits:
          AnyObj = {};

        for (
          const pattern of patterns
        ) {
          const count =
            source
              .toLowerCase()
              .split(
                pattern
              ).length - 1;

          if (
            count > 0
          ) {
            patternHits[
              pattern
            ] = count;
          }
        }

        const relativeEndpoints =
          Array.from(
            new Set(
              (
                source.match(
                  /["'`]\/(?:api|app-api|sports-api|sports-betting|events|event|lines|live|sports)[^"'`]*/gi
                ) || []
              )
                .map(
                  value =>
                    value.slice(
                      1
                    )
                )
                .slice(
                  0,
                  100
                )
            )
          );

        return {
          src: url,
          chars:
            source.length,
          analyzed_chars:
            source.length,
          truncated:
            false,
          elapsed_ms:
            result.elapsedMs,
          pattern_hits:
            patternHits,
          relative_endpoints:
            relativeEndpoints,
        };
      }
    );

  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_CLOUD0007_JS",

    read_only:
      true,

    current_live_path:
      "UNCHANGED",

    request: {
      page_url:
        CLOUD0007_URL,

      page_timeout_ms:
        CLOUD0007_PAGE_TIMEOUT_MS,

      js_timeout_ms:
        CLOUD0007_JS_TIMEOUT_MS,

      js_concurrency:
        CLOUD0007_JS_CONCURRENCY,

      scripts_found:
        scripts.length,

      scripts_fetched:
        results.filter(
          (item: any) =>
            item.status === 200
        ).length,

      scripts_failed:
        results.filter(
          (item: any) =>
            item.status !== 200
        ).length,
    },

    performance: {
      page_fetch_ms:
        page.elapsedMs,

      total_elapsed_ms:
        Date.now() -
        started,

      total_script_chars:
        results.reduce(
          (
            sum: number,
            item: any
          ) =>
            sum +
            (
              item.chars ??
              0
            ),
          0
        ),
    },

    page: {
      http_status:
        page.response.status,

      content_type:
        page.response.headers.get(
          "content-type"
        ),

      final_url:
        page.finalUrl,

      html_chars:
        page.text.length,
    },

    interesting_scripts:
      results
        .filter(
          (item: any) =>
            Object.keys(
              item.pattern_hits ??
                {}
            ).length >
            0 ||
            (
              item.relative_endpoints ??
                []
            ).length >
            0
        )
        .sort(
          (
            a: any,
            b: any
          ) =>
            (
              Object.keys(
                b.pattern_hits ??
                  {}
              ).length +
              (
                b.relative_endpoints ??
                  []
              ).length
            ) -
            (
              Object.keys(
                a.pattern_hits ??
                  {}
              ).length +
              (
                a.relative_endpoints ??
                  []
              ).length
            )
        )
        .slice(
          0,
          100
        ),

    interpretation: {
      purpose:
        "Discover sports/live API endpoints used by Cloud0007 frontend JS.",

      current_live_path:
        "UNCHANGED",

      important:
        "This endpoint is diagnostic only and does not replace /live.",

      next_step:
        "Use /diagnostic-cloud0007-api for focused request-context extraction.",
    },
  });
}

// ============================================================
// DIRECT CLOUD0007 API PROBE
// ============================================================

async function probeCloud0007Path(
  path: string
): Promise<AnyObj> {
  const started =
    Date.now();

  const url =
    `${CLOUD0007_ORIGIN}${path}`;

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      CLOUD0007_JS_TIMEOUT_MS
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          redirect: "follow",
          headers: {
            "accept":
              "application/json,text/plain,*/*",
            "cache-control":
              "no-cache",
            "pragma":
              "no-cache",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
            "referer":
              CLOUD0007_URL,
          },
          signal:
            controller.signal,
        }
      );

    const text =
      await response.text();

    let parsed:
      any = null;

    try {
      parsed =
        JSON.parse(
          text
        );
    } catch {
      parsed = null;
    }

    return {
      path,
      url,
      status:
        response.status,
      ok:
        response.ok,
      elapsed_ms:
        Date.now() -
        started,
      content_type:
        response.headers.get(
          "content-type"
        ),
      bytes:
        new TextEncoder().encode(
          text
        ).length,
      text_chars:
        text.length,
      json:
        !!parsed,
      top_level_type:
        parsed === null
          ? null
          : Array.isArray(
              parsed
            )
          ? "array"
          : typeof parsed,
      top_level_keys:
        parsed &&
        typeof parsed ===
          "object" &&
        !Array.isArray(
          parsed
        )
          ? Object.keys(
              parsed
            ).slice(
              0,
              100
            )
          : [],
      preview:
        text.slice(
          0,
          1500
        ),
    };
  } catch (
    error
  ) {
    return {
      path,
      url,
      status: 0,
      ok: false,
      elapsed_ms:
        Date.now() -
        started,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    };
  } finally {
    clearTimeout(
      timer
    );
  }
}

// ============================================================
// CLOUD0007 ROUTE PROBE DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007Routes():
  Promise<Response> {
  const started =
    Date.now();

  const paths = [
    "/sports-api/v6/sports",
    "/sports-api/c/v6/sports",
    "/sports-betting/v4/lines",
    "/events",
    "/live",
    "/app-api/pulse/feed",
    "/app-api/pulse/feed-version",
  ];

  const results =
    await mapWithConcurrency(
      paths,
      4,
      async path =>
        probeCloud0007Path(
          path
        )
    );

  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_CLOUD0007_ROUTES",

    read_only:
      true,

    current_live_path:
      "UNCHANGED",

    performance: {
      total_elapsed_ms:
        Date.now() -
        started,
    },

    probes:
      results,

    interpretation: {
      purpose:
        "Read-only probe of discovered Cloud0007 sports/live routes.",

      warning:
        "A route returning HTML, 404 or an error does not by itself mean the route is invalid; some endpoints require parameters or authentication.",

      next_step:
        "Use the request context from /diagnostic-cloud0007-api to determine the exact frontend request.",
    },
  });
}

// ============================================================
// NEW V5.7.5 RAW OFFICIAL CLOUDBET /EVENTS DIAGNOSTIC
// ============================================================

async function diagnosticEventsRaw(
  env: Env
): Promise<Response> {
  const started =
    Date.now();

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  let result;

  try {
    result =
      await cloudbetFetch(
        env,
        path,
        CLOUDBET_TIMEOUT_MS
      );
  } catch (
    error
  ) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        action:
          "DIAGNOSTIC_EVENTS_RAW",

        read_only:
          true,

        request: {
          path,
          requests_made:
            1,
        },

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      502
    );
  }

  const response =
    result.response;

  const rawText =
    await response.text();

  let parsed:
    any = null;

  let parseError:
    string | null = null;

  if (
    rawText.length > 0
  ) {
    try {
      parsed =
        JSON.parse(
          rawText
        );
    } catch (
      error
    ) {
      parseError =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  const topLevelType =
    parsed === null
      ? null
      : Array.isArray(
          parsed
        )
      ? "array"
      : typeof parsed;

  const topLevelKeys =
    parsed &&
    typeof parsed ===
      "object" &&
    !Array.isArray(
      parsed
    )
      ? Object.keys(
          parsed
        )
      : [];

  const firstArrayKeys:
    AnyObj[] = [];

  const firstArraySamples:
    AnyObj[] = [];

  if (
    Array.isArray(
      parsed
    )
  ) {
    for (
      const item of parsed.slice(
        0,
        5
      )
    ) {
      if (
        item &&
        typeof item ===
          "object" &&
        !Array.isArray(
          item
        )
      ) {
        firstArrayKeys.push(
          Object.keys(
            item
          )
        );
        firstArraySamples.push(
          item
        );
      }
    }
  }

  const candidateArrays:
    AnyObj[] = [];

  if (
    parsed &&
    typeof parsed ===
      "object"
  ) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        parsed
      )
    ) {
      if (
        Array.isArray(
          value
        )
      ) {
        candidateArrays.push({
          key,
          length:
            value.length,
          first_item_keys:
            value[0] &&
            typeof value[0] ===
              "object" &&
            !Array.isArray(
              value[0]
            )
              ? Object.keys(
                  value[0]
                )
              : [],
          first_item:
            value[0] ??
            null,
        });
      }
    }
  }

  return json({
    success:
      response.ok,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_EVENTS_RAW",

    read_only:
      true,

    betting:
      false,

    request: {
      path,

      full_url:
        `${API_BASE}${path}`,

      method:
        "GET",

      requests_made:
        1,

      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      api_key_present:
        !!env?.[API_KEY_NAME],
    },

    performance: {
      events_fetch_ms:
        result.elapsedMs,

      total_elapsed_ms:
        Date.now() -
        started,
    },

    response: {
      http_status:
        response.status,

      ok:
        response.ok,

      content_type:
        response.headers.get(
          "content-type"
        ),

      content_length_header:
        response.headers.get(
          "content-length"
        ),

      raw_chars:
        rawText.length,

      raw_bytes:
        new TextEncoder().encode(
          rawText
        ).length,
    },

    parsed: {
      json_parseable:
        parseError === null &&
        rawText.length > 0,

      parse_error:
        parseError,

      top_level_type:
        topLevelType,

      top_level_keys:
        topLevelKeys,

      candidate_arrays:
        candidateArrays,

      first_array_item_keys:
        firstArrayKeys,

      first_array_samples:
        firstArraySamples,
    },

    raw_response_preview: {
      max_chars:
        RAW_EVENTS_PREVIEW_CHARS,

      truncated:
        rawText.length >
        RAW_EVENTS_PREVIEW_CHARS,

      text:
        rawText.slice(
          0,
          RAW_EVENTS_PREVIEW_CHARS
        ),
    },

    parser_test: {
      extractEvents_was_used:
        false,

      isLiveEvent_was_used:
        false,

      purpose:
        "This endpoint intentionally bypasses the existing parser so we can inspect the real Cloudbet /events response shape.",
    },

    interpretation: {
      key_question:
        "Why does /events return HTTP 200 but extractEvents() produce zero events?",

      if_raw_response_contains_events:
        "The problem is inside our response parser/shape assumptions.",

      if_raw_response_is_empty:
        "Cloudbet returned an empty live-event response for this request.",

      if_raw_response_has_unexpected_shape:
        "We need to adapt extractEvents() to the actual Cloudbet response structure.",

      next_step:
        "Send the complete JSON result of /diagnostic-events-raw for analysis.",
    },
  });
}

// ============================================================
// EXISTING /LIVE
// ============================================================

async function getLiveSoccerEvents(
  env: Env
): Promise<AnyObj> {
  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    await parseJSON(
      result.response
    );

  const events =
    extractEvents(
      data
    );

  const liveEvents =
    events.filter(
      isLiveEvent
    );

  return {
    request: {
      path,
      requests_made:
        1,
      elapsed_ms:
        result.elapsedMs,
      http_status:
        result.response.status,
    },

    events_received:
      events.length,

    events_recognized_live:
      liveEvents.length,

    events:
      liveEvents.map(
        buildLiveMatch
      ),

    raw_shape:
      detectInterestingFields(
        data
      ),
  };
}

// ============================================================
// ORIGINAL /LIVE HANDLER
// ============================================================

async function handleLive(
  env: Env
): Promise<Response> {
  try {
    const started =
      Date.now();

    const result =
      await getLiveSoccerEvents(
        env
      );

    return json({
      success: true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "LIVE",

      read_only:
        true,

      performance: {
        total_elapsed_ms:
          Date.now() -
          started,
      },

      ...result,
    });
  } catch (
    error
  ) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-live-soccer-detector",
        version:
          VERSION,
        action:
          "LIVE",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      500
    );
  }
}

// ============================================================
// /HEALTH
// ============================================================

async function handleHealth():
  Promise<Response> {
  return json({
    success: true,
    worker:
      "cloudbet-live-soccer-detector",
    version:
      VERSION,
    mode:
      "READ_ONLY",
    betting:
      false,
    timestamp:
      nowISO(),
  });
}

// ============================================================
// /ROOT
// ============================================================

async function handleRoot():
  Promise<Response> {
  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    mode:
      "READ_ONLY",

    betting:
      false,

    endpoints: {
      "/":
        "worker info",

      "/health":
        "health",

      "/live":
        "direct Cloudbet live soccer",

      "/diagnostic-events-raw":
        "RAW official Cloudbet /events diagnostic",

      "/diagnostic-cloud0007":
        "Cloud0007 live page diagnostic",

      "/diagnostic-cloud0007-js":
        "Cloud0007 JavaScript endpoint discovery",

      "/diagnostic-cloud0007-api":
        "Focused API-call context from JS bundles",

      "/diagnostic-cloud0007-routes":
        "Read-only probe of discovered Cloud0007 routes",

      "/search":
        "Cloudbet competition search",

      "/event":
        "Cloudbet event lookup",
    },

    target: {
      market:
        TARGET_MARKET,

      submarket:
        TARGET_SUBMARKET,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS,
    },
  });
}

// ============================================================
// /SEARCH
// ============================================================

async function handleSearch(
  env: Env,
  request: Request
): Promise<Response> {
  const url =
    new URL(
      request.url
    );

  const q =
    (
      url.searchParams.get(
        "q"
      ) ??
      ""
    ).trim();

  if (!q) {
    return json(
      {
        success: false,
        error:
          "Missing q",
      },
      400
    );
  }

  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "SEARCH",

    read_only:
      true,

    query:
      q,

    note:
      "Competition scan/search logic remains unchanged in V5.7.4.",
  });
}

// ============================================================
// /EVENT
// ============================================================

async function handleEvent(
  env: Env,
  request: Request
): Promise<Response> {
  const url =
    new URL(
      request.url
    );

  const id =
    (
      url.searchParams.get(
        "id"
      ) ??
      ""
    ).trim();

  if (!id) {
    return json(
      {
        success: false,
        error:
          "Missing id",
      },
      400
    );
  }

  const result =
    await cloudbetFetch(
      env,
      `/events/${encodeURIComponent(id)}`
    );

  const data =
    await parseJSON(
      result.response
    );

  return json({
    success:
      result.response.ok,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "EVENT",

    read_only:
      true,

    request: {
      id,
      elapsed_ms:
        result.elapsedMs,
      http_status:
        result.response.status,
    },

    data,
  });
}

// ============================================================
// FETCH ROUTER
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

    const pathname =
      url.pathname;

    try {
      switch (
        pathname
      ) {
        case "/":
          return handleRoot();

        case "/health":
          return handleHealth();

        case "/live":
          return handleLive(
            env
          );

        case "/search":
          return handleSearch(
            env,
            request
          );

        case "/event":
          return handleEvent(
            env,
            request
          );

        case "/diagnostic-events-raw":
          return diagnosticEventsRaw(
            env
          );

        case "/diagnostic-cloud0007":
          return diagnosticCloud0007();

        case "/diagnostic-cloud0007-js":
          return diagnosticCloud0007JS();

        case "/diagnostic-cloud0007-api":
          return diagnosticCloud0007API();

        case "/diagnostic-cloud0007-routes":
          return diagnosticCloud0007Routes();

        default:
          return json(
            {
              success: false,
              worker:
                "cloudbet-live-soccer-detector",
              version:
                VERSION,
              error:
                "NOT_FOUND",
              path:
                pathname,
            },
            404
          );
      }
    } catch (
      error
    ) {
      return json(
        {
          success: false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        500
      );
    }
  },
};
