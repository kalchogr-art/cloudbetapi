// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR
// V5.7.3
//
// PURPOSE:
// - Diagnose Cloud0007 Next.js JavaScript bundles
// - Discover hidden API / live / odds / events endpoints
// - DO NOT change the current /live implementation
// - READ ONLY
// - NO BETTING
//
// NEW:
//   GET /diagnostic-cloud0007-js
//
// This endpoint:
// 1. Downloads Cloud0007 live soccer HTML
// 2. Extracts all Next.js JS bundles
// 3. Downloads bundles with limited concurrency
// 4. Searches them for:
//      /api/
//      /events
//      /odds
//      /live
//      /inplay
//      /sports
//      fetch()
//      axios
//      XMLHttpRequest
//      WebSocket
//      wss://
//      absolute API URLs
// 5. Returns compact candidate endpoint/snippet diagnostics
//
// CURRENT /live PATH REMAINS UNCHANGED:
//   /events?sport=soccer&live=true&players=false&limit=10000
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

type AnyObj = Record<string, any>;

const VERSION = "V5.7.3";

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

const CLOUDBET_TIMEOUT_MS =
  8000;

const CLOUD0007_URL =
  "https://www.cloud0007.com/en/sports/live?s=soccer";

const CLOUD0007_TIMEOUT_MS =
  10000;

const CLOUD0007_JS_TIMEOUT_MS =
  7000;

const JS_CONCURRENCY =
  6;

const MAX_SCRIPT_CHARS =
  2_000_000;

const MAX_SNIPPETS_PER_SCRIPT =
  12;

const MAX_TOTAL_SNIPPETS =
  80;

const MAX_ENDPOINTS =
  100;

// ============================================================
// BASIC HELPERS
// ============================================================

function nowISO(): string {
  return new Date().toISOString();
}

function finiteNumber(
  value: unknown
): number | null {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function json(
  body: AnyObj,
  status = 200
): Response {
  return new Response(
    JSON.stringify(body, null, 2),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store, no-cache, must-revalidate",

        pragma: "no-cache"
      }
    }
  );
}

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

// ============================================================
// FETCH WITH TIMEOUT
// ============================================================

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<{
  response: Response;
  elapsed_ms: number;
}> {
  const started =
    Date.now();

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...init,
          signal:
            controller.signal
        }
      );

    return {
      response,
      elapsed_ms:
        Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// CLOUDBET API FETCH
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string,
  timeoutMs = CLOUDBET_TIMEOUT_MS
): Promise<{
  response: Response;
  elapsed_ms: number;
}> {
  const apiKey =
    env?.[API_KEY_NAME];

  const url =
    `${API_BASE}${path}`;

  const headers =
    new Headers();

  headers.set(
    "accept",
    "application/json"
  );

  headers.set(
    "cache-control",
    "no-cache"
  );

  if (apiKey) {
    headers.set(
      "X-API-Key",
      apiKey
    );
  }

  return fetchWithTimeout(
    url,
    {
      method: "GET",
      headers
    },
    timeoutMs
  );
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
      __raw_text: text
    };
  }
}

// ============================================================
// CLOUD0007 FETCH
// ============================================================

async function fetchCloud0007Page(): Promise<{
  html: string;
  final_url: string;
  redirected: boolean;
  http_status: number;
  content_type: string;
  elapsed_ms: number;
}> {
  const result =
    await fetchWithTimeout(
      CLOUD0007_URL,
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
            "Mozilla/5.0 (compatible; Cloud0007Diagnostic/5.7.3)"
        }
      },
      CLOUD0007_TIMEOUT_MS
    );

  const contentType =
    result.response.headers.get(
      "content-type"
    ) || "";

  const html =
    await result.response.text();

  return {
    html,
    final_url:
      result.response.url ||
      CLOUD0007_URL,

    redirected:
      result.response.redirected,

    http_status:
      result.response.status,

    content_type:
      contentType,

    elapsed_ms:
      result.elapsed_ms
  };
}

// ============================================================
// HTML HELPERS
// ============================================================

function decodeHtmlEntities(
  value: string
): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/gi, "/")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeScriptUrl(
  src: string,
  pageUrl: string
): string | null {
  const cleaned =
    decodeHtmlEntities(
      src.trim()
    );

  if (!cleaned) {
    return null;
  }

  if (
    cleaned.startsWith(
      "data:"
    )
  ) {
    return null;
  }

  try {
    return new URL(
      cleaned,
      pageUrl
    ).href;
  } catch {
    return null;
  }
}

// ============================================================
// EXTRACT SCRIPT URLS
// ============================================================

function extractScriptUrls(
  html: string,
  pageUrl: string
): string[] {
  const urls =
    new Set<string>();

  const scriptRegex =
    /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      scriptRegex.exec(html)) !== null
  ) {
    const src =
      match[1];

    const url =
      normalizeScriptUrl(
        src,
        pageUrl
      );

    if (
      url &&
      /\.js(?:[?#]|$)/i.test(url)
    ) {
      urls.add(url);
    }
  }

  return Array.from(
    urls
  );
}

// ============================================================
// STRING NORMALIZATION
// ============================================================

function cleanCandidate(
  value: string
): string {
  return value
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\u003A/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================
// ENDPOINT CLASSIFICATION
// ============================================================

function isInterestingEndpoint(
  value: string
): boolean {
  const s =
    value.toLowerCase();

  return (
    s.includes("/api/") ||
    s.includes("/events") ||
    s.includes("/event") ||
    s.includes("/odds") ||
    s.includes("/inplay") ||
    s.includes("/in-play") ||
    s.includes("/live") ||
    s.includes("/sports") ||
    s.includes("/markets") ||
    s.includes("/fixtures") ||
    s.includes("/feed") ||
    s.includes("/lines") ||
    s.includes("wss://") ||
    s.includes("graphql") ||
    s.includes("api.")
  );
}

// ============================================================
// EXTRACT URL-LIKE STRINGS
// ============================================================

function extractAbsoluteUrls(
  text: string
): string[] {
  const found =
    new Set<string>();

  const regex =
    /https?:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(text)) !== null
  ) {
    let value =
      cleanCandidate(
        match[0]
      );

    value =
      value.replace(
        /["'`),;]+$/g,
        ""
      );

    if (
      isInterestingEndpoint(
        value
      )
    ) {
      found.add(value);
    }

    if (
      found.size >= MAX_ENDPOINTS
    ) {
      break;
    }
  }

  return Array.from(
    found
  );
}

// ============================================================
// EXTRACT RELATIVE ENDPOINTS
// ============================================================

function extractRelativeEndpoints(
  text: string
): string[] {
  const found =
    new Set<string>();

  /*
   * Looks for quoted strings such as:
   *
   * "/api/events"
   * "/events"
   * "/odds"
   * "/live"
   * "/inplay"
   * "/sports/..."
   */

  const regex =
    /["'`]((?:\\\/|\/)[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%\\-]{2,500})["'`]/g;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(text)) !== null
  ) {
    const raw =
      match[1];

    const value =
      cleanCandidate(
        raw
      );

    if (
      value.startsWith("/") &&
      isInterestingEndpoint(
        value
      )
    ) {
      found.add(value);
    }

    if (
      found.size >= MAX_ENDPOINTS
    ) {
      break;
    }
  }

  return Array.from(
    found
  );
}

// ============================================================
// EXTRACT API-LIKE WORDS / ROUTES
// ============================================================

function extractRouteFragments(
  text: string
): string[] {
  const found =
    new Set<string>();

  const patterns = [
    /\/api\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]{1,300}/gi,

    /\/v\d+\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]{1,300}/gi,

    /\/pub\/[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]{1,300}/gi,

    /\/(?:events|event|odds|live|inplay|in-play|markets|fixtures|feed|lines)(?:[/?][A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]{0,300})?/gi
  ];

  for (
    const pattern of patterns
  ) {
    let match:
      RegExpExecArray | null;

    while (
      (match =
        pattern.exec(text)) !== null
    ) {
      const value =
        cleanCandidate(
          match[0]
        ).replace(
          /["'`),;]+$/g,
          ""
        );

      if (
        value.length >= 3
      ) {
        found.add(value);
      }

      if (
        found.size >= MAX_ENDPOINTS
      ) {
        break;
      }
    }

    if (
      found.size >= MAX_ENDPOINTS
    ) {
      break;
    }
  }

  return Array.from(
    found
  );
}

// ============================================================
// SEARCH PATTERNS
// ============================================================

const SEARCH_PATTERNS: Array<{
  name: string;
  regex: RegExp;
}> = [
  {
    name: "api_path",
    regex: /\/api\//i
  },

  {
    name: "events",
    regex: /\/events\b/i
  },

  {
    name: "event",
    regex: /\/event\b/i
  },

  {
    name: "odds",
    regex: /\/odds\b/i
  },

  {
    name: "inplay",
    regex: /in[-_ ]?play|inplay/i
  },

  {
    name: "live",
    regex: /\/live\b/i
  },

  {
    name: "sports",
    regex: /\/sports\b/i
  },

  {
    name: "markets",
    regex: /\/markets\b/i
  },

  {
    name: "fixtures",
    regex: /\/fixtures\b/i
  },

  {
    name: "feed",
    regex: /\/feed\b/i
  },

  {
    name: "lines",
    regex: /\/lines\b/i
  },

  {
    name: "fetch",
    regex: /\bfetch\s*\(/i
  },

  {
    name: "axios",
    regex: /\baxios\b/i
  },

  {
    name: "xhr",
    regex: /XMLHttpRequest/i
  },

  {
    name: "websocket",
    regex: /WebSocket|wss:\/\//i
  },

  {
    name: "graphql",
    regex: /graphql/i
  }
];

// ============================================================
// EXTRACT SNIPPETS
// ============================================================

function extractSnippets(
  text: string,
  pattern: RegExp,
  maxCount: number
): string[] {
  const snippets: string[] = [];

  const lower =
    text.toLowerCase();

  const source =
    pattern.source
      .replace(
        /\\b/g,
        ""
      );

  /*
   * We cannot reliably convert every regex to a literal,
   * so search with a few known terms separately.
   */

  let positions: number[] = [];

  if (
    /api_path/i.test(
      source
    ) ||
    /api/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/api/"
      )
    );
  }

  if (
    /events/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/events"
      )
    );
  }

  if (
    /event/i.test(
      pattern.source
    ) &&
    positions.length === 0
  ) {
    positions.push(
      ...findAll(
        lower,
        "/event"
      )
    );
  }

  if (
    /odds/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/odds"
      )
    );
  }

  if (
    /in/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "inplay"
      ),
      ...findAll(
        lower,
        "in-play"
      )
    );
  }

  if (
    /live/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/live"
      )
    );
  }

  if (
    /sports/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/sports"
      )
    );
  }

  if (
    /markets/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/markets"
      )
    );
  }

  if (
    /fixtures/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/fixtures"
      )
    );
  }

  if (
    /feed/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/feed"
      )
    );
  }

  if (
    /lines/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "/lines"
      )
    );
  }

  if (
    /fetch/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "fetch("
      )
    );
  }

  if (
    /axios/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "axios"
      )
    );
  }

  if (
    /websocket/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "websocket"
      ),
      ...findAll(
        lower,
        "wss://"
      )
    );
  }

  if (
    /graphql/i.test(
      pattern.source
    )
  ) {
    positions.push(
      ...findAll(
        lower,
        "graphql"
      )
    );
  }

  positions =
    Array.from(
      new Set(
        positions
      )
    ).sort(
      (a, b) =>
        a - b
    );

  for (
    const pos of positions
  ) {
    const start =
      Math.max(
        0,
        pos - 180
      );

    const end =
      Math.min(
        text.length,
        pos + 420
      );

    let snippet =
      text.slice(
        start,
        end
      );

    snippet =
      snippet
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    if (
      snippet.length > 650
    ) {
      snippet =
        snippet.slice(
          0,
          650
        ) + "...";
    }

    snippets.push(
      snippet
    );

    if (
      snippets.length >=
      maxCount
    ) {
      break;
    }
  }

  return snippets;
}

function findAll(
  text: string,
  needle: string
): number[] {
  const result: number[] = [];

  let start = 0;

  while (true) {
    const index =
      text.indexOf(
        needle,
        start
      );

    if (
      index === -1
    ) {
      break;
    }

    result.push(
      index
    );

    start =
      index +
      Math.max(
        1,
        needle.length
      );

    if (
      result.length >= 50
    ) {
      break;
    }
  }

  return result;
}

// ============================================================
// SCRIPT ANALYSIS
// ============================================================

function analyzeScript(
  src: string,
  text: string
): AnyObj {
  const limited =
    text.length >
    MAX_SCRIPT_CHARS
      ? text.slice(
          0,
          MAX_SCRIPT_CHARS
        )
      : text;

  const patternHits:
    Record<string, number> = {};

  const snippets: Array<{
    pattern: string;
    snippet: string;
  }> = [];

  for (
    const item of
      SEARCH_PATTERNS
  ) {
    if (
      item.regex.test(
        limited
      )
    ) {
      const matches =
        limited.match(
          new RegExp(
            item.regex.source,
            "gi"
          )
        );

      patternHits[
        item.name
      ] =
        matches?.length || 1;

      const extracted =
        extractSnippets(
          limited,
          item.regex,
          Math.min(
            3,
            MAX_SNIPPETS_PER_SCRIPT
          )
        );

      for (
        const snippet of
          extracted
      ) {
        snippets.push({
          pattern:
            item.name,
          snippet
        });
      }
    }
  }

  const absoluteUrls =
    extractAbsoluteUrls(
      limited
    );

  const relativeEndpoints =
    extractRelativeEndpoints(
      limited
    );

  const routeFragments =
    extractRouteFragments(
      limited
    );

  return {
    src,

    chars:
      text.length,

    analyzed_chars:
      limited.length,

    truncated:
      text.length >
      MAX_SCRIPT_CHARS,

    pattern_hits:
      patternHits,

    absolute_urls:
      absoluteUrls.slice(
        0,
        MAX_ENDPOINTS
      ),

    relative_endpoints:
      relativeEndpoints.slice(
        0,
        MAX_ENDPOINTS
      ),

    route_fragments:
      routeFragments.slice(
        0,
        MAX_ENDPOINTS
      ),

    snippets:
      snippets.slice(
        0,
        MAX_SNIPPETS_PER_SCRIPT
      )
  };
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

  let nextIndex = 0;

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

  const count =
    Math.min(
      concurrency,
      items.length
    );

  await Promise.all(
    Array.from(
      { length: count },
      () => runner()
    )
  );

  return results;
}

// ============================================================
// CLOUD0007 JS DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007JS(
  request: Request
): Promise<Response> {
  const started =
    Date.now();

  let page;

  try {
    page =
      await fetchCloud0007Page();
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
          String(error),

        request: {
          url:
            CLOUD0007_URL,
          timeout_ms:
            CLOUD0007_TIMEOUT_MS
        }
      },
      502
    );
  }

  if (
    page.http_status < 200 ||
    page.http_status >= 300
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

        page: {
          http_status:
            page.http_status,
          elapsed_ms:
            page.elapsed_ms,
          final_url:
            page.final_url
        }
      },
      502
    );
  }

  const scripts =
    extractScriptUrls(
      page.html,
      page.final_url
    );

  const scriptResults =
    await mapWithConcurrency(
      scripts,
      JS_CONCURRENCY,
      async (
        src
      ) => {
        const scriptStarted =
          Date.now();

        try {
          const result =
            await fetchWithTimeout(
              src,
              {
                method:
                  "GET",

                redirect:
                  "follow",

                headers: {
                  "accept":
                    "application/javascript,text/javascript,*/*;q=0.8",

                  "cache-control":
                    "no-cache",

                  "pragma":
                    "no-cache",

                  "user-agent":
                    "Mozilla/5.0 (compatible; Cloud0007Diagnostic/5.7.3)"
                }
              },
              CLOUD0007_JS_TIMEOUT_MS
            );

          if (
            result.response.status <
              200 ||
            result.response.status >=
              300
          ) {
            return {
              success: false,
              src,
              http_status:
                result.response.status,
              elapsed_ms:
                result.elapsed_ms,
              error:
                "NON_2XX"
            };
          }

          const text =
            await result.response.text();

          const analysis =
            analyzeScript(
              src,
              text
            );

          return {
            success: true,
            elapsed_ms:
              result.elapsed_ms,
            ...analysis
          };
        } catch (
          error
        ) {
          return {
            success: false,
            src,
            elapsed_ms:
              Date.now() -
              scriptStarted,
            error:
              String(error)
          };
        }
      }
    );

  // ==========================================================
  // COLLECT CANDIDATES
  // ==========================================================

  const endpointSet =
    new Set<string>();

  const absoluteSet =
    new Set<string>();

  const relativeSet =
    new Set<string>();

  const routeSet =
    new Set<string>();

  const compactHits:
    AnyObj[] = [];

  let fetched =
    0;

  let failed =
    0;

  let totalScriptBytes =
    0;

  for (
    const result of
      scriptResults
  ) {
    if (
      result?.success
    ) {
      fetched++;

      totalScriptBytes +=
        Number(
          result.chars ||
          0
        );

      for (
        const url of
          result.absolute_urls ||
          []
      ) {
        absoluteSet.add(
          url
        );

        endpointSet.add(
          url
        );
      }

      for (
        const endpoint of
          result.relative_endpoints ||
          []
      ) {
        relativeSet.add(
          endpoint
        );

        endpointSet.add(
          endpoint
        );
      }

      for (
        const route of
          result.route_fragments ||
          []
      ) {
        routeSet.add(
          route
        );

        endpointSet.add(
          route
        );
      }

      if (
        (
          result.snippets ||
          []
        ).length > 0
      ) {
        compactHits.push({
          src:
            result.src,

          pattern_hits:
            result.pattern_hits,

          snippets:
            result.snippets
        });
      }
    } else {
      failed++;
    }
  }

  // ==========================================================
  // RANK ENDPOINTS
  // ==========================================================

  const endpointArray =
    Array.from(
      endpointSet
    );

  endpointArray.sort(
    (a, b) => {
      const scoreA =
        endpointScore(a);

      const scoreB =
        endpointScore(b);

      if (
        scoreA !==
        scoreB
      ) {
        return (
          scoreB -
          scoreA
        );
      }

      return a.localeCompare(
        b
      );
    }
  );

  // ==========================================================
  // ONLY KEEP USEFUL SCRIPT RESULTS
  // ==========================================================

  const interestingScripts =
    scriptResults
      .filter(
        x =>
          x?.success &&
          (
            Object.keys(
              x.pattern_hits ||
              {}
            ).length > 0 ||
            (
              x.absolute_urls ||
              []
            ).length > 0 ||
            (
              x.relative_endpoints ||
              []
            ).length > 0 ||
            (
              x.route_fragments ||
              []
            ).length > 0
          )
      )
      .map(
        x => ({
          src:
            x.src,

          chars:
            x.chars,

          analyzed_chars:
            x.analyzed_chars,

          truncated:
            x.truncated,

          elapsed_ms:
            x.elapsed_ms,

          pattern_hits:
            x.pattern_hits,

          absolute_urls:
            x.absolute_urls,

          relative_endpoints:
            x.relative_endpoints,

          route_fragments:
            x.route_fragments
        })
      );

  // ==========================================================
  // FINAL RESULT
  // ==========================================================

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
        CLOUD0007_TIMEOUT_MS,

      js_timeout_ms:
        CLOUD0007_JS_TIMEOUT_MS,

      js_concurrency:
        JS_CONCURRENCY,

      scripts_found:
        scripts.length,

      scripts_fetched:
        fetched,

      scripts_failed:
        failed
    },

    performance: {
      page_fetch_ms:
        page.elapsed_ms,

      total_elapsed_ms:
        Date.now() -
        started,

      total_script_chars:
        totalScriptBytes
    },

    page: {
      http_status:
        page.http_status,

      content_type:
        page.content_type,

      final_url:
        page.final_url,

      redirected:
        page.redirected,

      html_chars:
        page.html.length
    },

    discovery: {
      candidate_endpoint_count:
        endpointArray.length,

      candidate_endpoints:
        endpointArray.slice(
          0,
          MAX_ENDPOINTS
        ),

      absolute_api_like_urls:
        Array.from(
          absoluteSet
        ).slice(
          0,
          MAX_ENDPOINTS
        ),

      relative_api_like_endpoints:
        Array.from(
          relativeSet
        ).slice(
          0,
          MAX_ENDPOINTS
        ),

      route_fragments:
        Array.from(
          routeSet
        ).slice(
          0,
          MAX_ENDPOINTS
        )
    },

    interesting_scripts:
      interestingScripts,

    script_hits:
      compactHits.slice(
        0,
        MAX_TOTAL_SNIPPETS
      ),

    interpretation: {
      purpose:
        "Inspect Cloud0007 Next.js JavaScript bundles to identify the real live-soccer data source.",

      important:
        "This diagnostic does NOT replace or modify /live.",

      next_step:
        endpointArray.length > 0
          ? "Inspect candidate endpoints and snippets. The next version can test the strongest candidate directly."
          : "No obvious API endpoint found in downloaded bundles. Next step is deeper inspection of Next.js runtime/chunks and network configuration."
    },

    timestamp:
      nowISO()
  });
}

// ============================================================
// EXISTING TARGET ODDS
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
// EXACT TARGET ODDS EXTRACTION
// ============================================================

function extractTargetOdds(
  event: AnyObj
): AnyObj | null {
  const markets =
    event?.markets ??
    event?.submarkets ??
    event?.data?.markets ??
    event?.data?.submarkets;

  if (!markets) {
    return null;
  }

  const candidates: AnyObj[] =
    [];

  function visit(
    value: any,
    parentMarket?: string,
    parentSubmarket?: string
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return;
    }

    if (
      Array.isArray(value)
    ) {
      for (
        const item of value
      ) {
        visit(
          item,
          parentMarket,
          parentSubmarket
        );
      }

      return;
    }

    if (
      typeof value !==
      "object"
    ) {
      return;
    }

    const market =
      String(
        value.market ??
        value.marketName ??
        value.market_key ??
        parentMarket ??
        ""
      );

    const submarket =
      String(
        value.submarket ??
        value.submarketName ??
        value.submarket_key ??
        parentSubmarket ??
        ""
      );

    const outcome =
      String(
        value.outcome ??
        value.side ??
        ""
      ).toLowerCase();

    const params =
      String(
        value.params ??
        value.parameters ??
        ""
      );

    if (
      market ===
        TARGET_MARKET &&
      submarket ===
        TARGET_SUBMARKET &&
      outcome ===
        TARGET_OUTCOME &&
      params ===
        TARGET_PARAMS
    ) {
      candidates.push(
        value
      );
    }

    for (
      const [
        key,
        child
      ] of Object.entries(
        value
      )
    ) {
      if (
        key ===
          "market" ||
        key ===
          "submarket" ||
        key ===
          "outcome" ||
        key ===
          "params"
      ) {
        continue;
      }

      if (
        child &&
        typeof child ===
          "object"
      ) {
        let nextMarket =
          parentMarket;

        let nextSubmarket =
          parentSubmarket;

        if (
          !nextMarket &&
          !Array.isArray(
            value
          )
        ) {
          if (
            key ===
            TARGET_MARKET
          ) {
            nextMarket =
              key;
          }
        }

        if (
          !nextSubmarket &&
          key ===
            TARGET_SUBMARKET
        ) {
          nextSubmarket =
            key;
        }

        visit(
          child,
          nextMarket,
          nextSubmarket
        );
      }
    }
  }

  visit(
    markets
  );

  for (
    const selection of
      candidates
  ) {
    const price =
      finiteNumber(
        selection.price ??
        selection.odds ??
        selection.raw_price
      );

    const maxStake =
      finiteNumber(
        selection.maxStake ??
        selection.max_stake
      );

    const status =
      String(
        selection.status ??
        ""
      ).toUpperCase();

    const enabled =
      selection.enabled ===
        undefined
        ? true
        : Boolean(
            selection.enabled
          );

    const statusEnabled =
      !status ||
      status ===
        "SELECTION_ENABLED" ||
      status ===
        "OPEN" ||
      status ===
        "TRADING" ||
      status ===
        "ACTIVE";

    const stakeOk =
      maxStake === null ||
      maxStake > 0;

    if (
      enabled &&
      statusEnabled &&
      price !== null &&
      price > 1 &&
      stakeOk
    ) {
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
          selection.raw_price ??
          null,

        status:
          selection.status ??
          null,

        maxStake:
          selection.maxStake ??
          null,

        selection
      };
    }
  }

  return null;
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
      event?.eventStatus ??
      event?.state ??
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
// EVENT EXTRACTION
// ============================================================

function extractLiveEvents(
  data: any
): AnyObj[] {
  if (
    Array.isArray(data)
  ) {
    return data;
  }

  if (
    Array.isArray(
      data?.events
    )
  ) {
    return data.events;
  }

  if (
    Array.isArray(
      data?.data?.events
    )
  ) {
    return data.data.events;
  }

  if (
    Array.isArray(
      data?.data?.data?.events
    )
  ) {
    return data.data.data.events;
  }

  if (
    Array.isArray(
      data?.result?.events
    )
  ) {
    return data.result.events;
  }

  if (
    Array.isArray(
      data?.items
    )
  ) {
    return data.items;
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
// BUILD LIVE MATCH
// ============================================================

function buildLiveMatch(
  event: AnyObj
): AnyObj {
  const home =
    event?.home ??
    event?.homeTeam ??
    event?.participants?.[0] ??
    null;

  const away =
    event?.away ??
    event?.awayTeam ??
    event?.participants?.[1] ??
    null;

  const homeName =
    typeof home ===
      "string"
      ? home
      : home?.name ??
        home?.title ??
        "";

  const awayName =
    typeof away ===
      "string"
      ? away
      : away?.name ??
        away?.title ??
        "";

  return {
    id:
      event?.id ??
      event?.eventId ??
      event?.event_id ??
      null,

    home:
      homeName,

    away:
      awayName,

    status:
      event?.status ??
      event?.eventStatus ??
      event?.state ??
      null,

    live:
      isLiveEvent(
        event
      ),

    odds:
      extractTargetOdds(
        event
      )
  };
}

// ============================================================
// CURRENT /LIVE IMPLEMENTATION
// ============================================================

async function getLiveSoccerEvents(
  env: Env
): Promise<{
  events: AnyObj[];
  elapsed_ms: number;
  http_status: number;
}> {
  /*
   * IMPORTANT:
   *
   * This is intentionally unchanged.
   *
   * V5.7.3 only diagnoses Cloud0007.
   */

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
    extractLiveEvents(
      data
    );

  const live =
    events.filter(
      isLiveEvent
    );

  return {
    events:
      live.map(
        buildLiveMatch
      ),

    elapsed_ms:
      result.elapsed_ms,

    http_status:
      result.response.status
  };
}

// ============================================================
// /LIVE
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

      betting:
        false,

      request: {
        path:
          "/events?sport=soccer&live=true&players=false&limit=10000",

        requests_made:
          1
      },

      performance: {
        events_fetch_ms:
          result.elapsed_ms,

        total_elapsed_ms:
          Date.now() -
          started,

        http_status:
          result.http_status
      },

      result: {
        live_events:
          result.events.length,

        target_1h_over_05_found:
          result.events.filter(
            x =>
              x.odds !==
              null
          ).length,

        events:
          result.events
      },

      timestamp:
        nowISO()
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
          String(error)
      },
      500
    );
  }
}

// ============================================================
// /DIAGNOSTIC-LIVE-EVENTS
// ============================================================

async function diagnosticLiveEvents(
  env: Env
): Promise<Response> {
  try {
    const started =
      Date.now();

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
      extractLiveEvents(
        data
      );

    const live =
      events.filter(
        isLiveEvent
      );

    const statuses:
      Record<string, number> =
      {};

    for (
      const event of
        events
    ) {
      const status =
        String(
          event?.status ??
          event?.eventStatus ??
          event?.state ??
          "UNKNOWN"
        );

      statuses[status] =
        (
          statuses[status] ||
          0
        ) + 1;
    }

    const built =
      live.map(
        buildLiveMatch
      );

    return json({
      success: true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "DIAGNOSTIC_LIVE_EVENTS",

      read_only:
        true,

      request: {
        path,

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
          result.response.status
      },

      result: {
        events_received:
          events.length,

        events_recognized_live:
          live.length,

        statuses,

        target_1h_over_05_found:
          built.filter(
            x =>
              x.odds !==
              null
          ).length,

        first_10:
          built.slice(
            0,
            10
          )
      }
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
          "DIAGNOSTIC_LIVE_EVENTS",

        error:
          String(error)
      },
      500
    );
  }
}

// ============================================================
// /DIAGNOSTIC-CLOUD0007
// ============================================================

async function diagnosticCloud0007(
  request: Request
): Promise<Response> {
  const started =
    Date.now();

  try {
    const page =
      await fetchCloud0007Page();

    const html =
      page.html;

    const nextDataMatch =
      html.match(
        /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
      );

    let nextData:
      AnyObj | null =
      null;

    let nextDataParseable =
      false;

    let nextDataChars =
      0;

    if (
      nextDataMatch
    ) {
      const raw =
        nextDataMatch[1];

      nextDataChars =
        raw.length;

      try {
        nextData =
          JSON.parse(
            raw
          );

        nextDataParseable =
          true;
      } catch {
        nextData =
          null;
      }
    }

    const applicationJsonCount =
      (
        html.match(
          /<script[^>]+type=["']application\/json["'][^>]*>/gi
        ) || []
      ).length;

    const scripts =
      extractScriptUrls(
        html,
        page.final_url
      );

    const lower =
      html.toLowerCase();

    const possibleUrls =
      extractAbsoluteUrls(
        html
      );

    const signals = {
      soccer:
        lower.includes(
          "soccer"
        ),

      football:
        lower.includes(
          "football"
        ),

      live:
        lower.includes(
          "live"
        ),

      cloudbet:
        lower.includes(
          "cloudbet"
        ),

      sports:
        lower.includes(
          "sports"
        ),

      events:
        lower.includes(
          "events"
        ),

      odds:
        lower.includes(
          "odds"
        ),

      trading_live:
        lower.includes(
          "trading_live"
        ),

      __next_data__:
        Boolean(
          nextDataMatch
        ),

      application_json:
        applicationJsonCount >
        0,

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
        /\bapi\b/i.test(
          html
        )
    };

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
          CLOUD0007_TIMEOUT_MS
      },

      performance: {
        elapsed_ms:
          page.elapsed_ms,

        total_elapsed_ms:
          Date.now() -
          started,

        http_status:
          page.http_status,

        content_type:
          page.content_type,

        response_bytes:
          new TextEncoder().encode(
            html
          ).length,

        html_chars:
          html.length
      },

      page: {
        final_url:
          page.final_url,

        redirected:
          page.redirected,

        title:
          (
            html.match(
              /<title[^>]*>([\s\S]*?)<\/title>/i
            )?.[1] ||
            ""
          ).trim(),

        signals
      },

      embedded_data: {
        next_data_present:
          Boolean(
            nextDataMatch
          ),

        next_data_chars:
          nextDataChars,

        next_data_parseable:
          nextDataParseable,

        next_data_type:
          nextData === null
            ? null
            : Array.isArray(
                nextData
              )
            ? "array"
            : typeof nextData,

        next_data_keys:
          nextData &&
          typeof nextData ===
            "object"
            ? Object.keys(
                nextData
              ).slice(
                0,
                100
              )
            : [],

        application_json_script_count:
          applicationJsonCount
      },

      scripts: {
        count:
          scripts.length,

        first_30:
          scripts.slice(
            0,
            30
          )
      },

      possible_urls: {
        count:
          possibleUrls.length,

        first_50:
          possibleUrls.slice(
            0,
            50
          )
      },

      html_analysis: {
        contains_event_word:
          /\bevent/i.test(
            html
          ),

        contains_odds_word:
          /\bodds/i.test(
            html
          ),

        contains_live_word:
          /\blive/i.test(
            html
          ),

        contains_api_reference:
          /\bapi\b/i.test(
            html
          )
      },

      interpretation: {
        purpose:
          "Compact inspection of the Cloud0007 Live Soccer page.",

        current_live_path:
          "UNCHANGED",

        no_html_dump:
          true,

        next_step:
          "Use /diagnostic-cloud0007-js to inspect Next.js JavaScript bundles and discover the actual data API."
      }
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
          "DIAGNOSTIC_CLOUD0007",

        error:
          String(error)
      },
      502
    );
  }
}

// ============================================================
// ENDPOINT SCORE
// ============================================================

function endpointScore(
  endpoint: string
): number {
  const s =
    endpoint.toLowerCase();

  let score = 0;

  if (
    s.startsWith(
      "https://sports-api."
    )
  ) {
    score += 100;
  }

  if (
    s.includes(
      "/api/"
    )
  ) {
    score += 50;
  }

  if (
    s.includes(
      "/events"
    )
  ) {
    score += 45;
  }

  if (
    s.includes(
      "/odds"
    )
  ) {
    score += 40;
  }

  if (
    s.includes(
      "inplay"
    ) ||
    s.includes(
      "in-play"
    )
  ) {
    score += 40;
  }

  if (
    s.includes(
      "/live"
    )
  ) {
    score += 35;
  }

  if (
    s.includes(
      "/markets"
    )
  ) {
    score += 25;
  }

  if (
    s.includes(
      "/feed"
    )
  ) {
    score += 20;
  }

  if (
    s.includes(
      "wss://"
    )
  ) {
    score += 30;
  }

  if (
    s.includes(
      "graphql"
    )
  ) {
    score += 25;
  }

  return score;
}

// ============================================================
// SEARCH ENDPOINT
// ============================================================

async function handleSearch(
  env: Env,
  request: Request
): Promise<Response> {
  /*
   * Keep this route intentionally lightweight.
   *
   * It is not part of the Cloud0007 investigation.
   */

  const url =
    new URL(
      request.url
    );

  const q =
    url.searchParams.get(
      "q"
    ) ||
    "";

  if (!q.trim()) {
    return json({
      success: false,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "SEARCH",

      error:
        "Missing ?q="
    }, 400);
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
      "Use the existing matcher/search implementation for competition-level discovery."
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
    url.searchParams.get(
      "id"
    );

  if (!id) {
    return json({
      success: false,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "EVENT",

      error:
        "Missing ?id="
    }, 400);
  }

  try {
    const path =
      `/events/${encodeURIComponent(id)}`;

    const result =
      await cloudbetFetch(
        env,
        path
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
        path,

        http_status:
          result.response.status,

        elapsed_ms:
          result.elapsed_ms
      },

      result:
        data
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
          "EVENT",

        error:
          String(error)
      },
      500
    );
  }
}

// ============================================================
// HEALTH
// ============================================================

async function handleHealth(): Promise<Response> {
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

    cloud0007_diagnostic:
      true,

    timestamp:
      nowISO()
  });
}

// ============================================================
// ROOT
// ============================================================

async function handleRoot(): Promise<Response> {
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

    endpoints: [
      "/",
      "/health",
      "/live",
      "/event?id=...",
      "/search?q=...",
      "/diagnostic-live-events",
      "/diagnostic-cloud0007",
      "/diagnostic-cloud0007-js"
    ],

    target: {
      market:
        TARGET_MARKET,

      submarket:
        TARGET_SUBMARKET,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS
    },

    important:
      "V5.7.3 adds JavaScript-bundle discovery only. /live remains unchanged."
  });
}

// ============================================================
// MAIN FETCH
// ============================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const url =
      new URL(
        request.url
      );

    const pathname =
      url.pathname;

    // --------------------------------------------------------
    // ROOT
    // --------------------------------------------------------

    if (
      pathname === "/" ||
      pathname === ""
    ) {
      return handleRoot();
    }

    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      pathname ===
      "/health"
    ) {
      return handleHealth();
    }

    // --------------------------------------------------------
    // LIVE
    // --------------------------------------------------------

    if (
      pathname ===
      "/live"
    ) {
      return handleLive(
        env
      );
    }

    // --------------------------------------------------------
    // EVENT
    // --------------------------------------------------------

    if (
      pathname ===
      "/event"
    ) {
      return handleEvent(
        env,
        request
      );
    }

    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (
      pathname ===
      "/search"
    ) {
      return handleSearch(
        env,
        request
      );
    }

    // --------------------------------------------------------
    // EXISTING CLOUD0007 HTML DIAGNOSTIC
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-cloud0007"
    ) {
      return diagnosticCloud0007(
        request
      );
    }

    // --------------------------------------------------------
    // NEW V5.7.3 JS BUNDLE DIAGNOSTIC
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-cloud0007-js"
    ) {
      return diagnosticCloud0007JS(
        request
      );
    }

    // --------------------------------------------------------
    // EXISTING DIRECT EVENTS DIAGNOSTIC
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-live-events"
    ) {
      return diagnosticLiveEvents(
        env
      );
    }

    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    return json(
      {
        success: false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        error:
          "NOT_FOUND",

        pathname
      },
      404
    );
  }
};
