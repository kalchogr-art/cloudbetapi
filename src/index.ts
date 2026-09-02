// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR
// V5.7.7
//
// FIX:
// - Cloudbet /events returns:
//     { competitions: [ { events: [...] } ] }
// - extractEvents() explicitly supports
//     competitions[].events[]
// - TRADING_LIVE is recognized as live
//
// NEW V5.7.7:
// - /diagnostic-target-market
// - Inspects every live event
// - Checks exact target market/submarket/selection
// - Shows disabled selections, price and maxStake
//
// READ ONLY
// NO BETTING
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
  "V5.7.7";

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


// ============================================================
// JSON
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
          "no-store",
      },
    }
  );
}


// ============================================================
// TIMEOUT
// ============================================================

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 8000
): Promise<Response> {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {

    return await fetch(
      url,
      {
        ...init,
        signal:
          controller.signal,
      }
    );

  } finally {

    clearTimeout(
      timer
    );

  }
}


// ============================================================
// CLOUDBET FETCH
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string
): Promise<{
  response: Response;
  elapsedMs: number;
}> {

  const started =
    Date.now();

  const apiKey =
    env.CLOUDBET_API_KEY;

  const url =
    `${API_BASE}${path}`;

  const response =
    await fetchWithTimeout(
      url,
      {
        method:
          "GET",

        headers: {
          "accept":
            "application/json",

          "x-api-key":
            apiKey || "",
        },
      },
      CLOUDBET_TIMEOUT_MS
    );

  return {
    response,

    elapsedMs:
      Date.now() -
      started,
  };
}


// ============================================================
// SAFE JSON
// ============================================================

async function parseJSON(
  response: Response
): Promise<any> {

  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {

    return JSON.parse(
      text
    );

  } catch {

    return null;

  }
}


// ============================================================
// GENERIC ARRAY EXTRACTION
// ============================================================

function extractEvents(
  data: any
): AnyObj[] {

  // ----------------------------------------------------------
  // PRIMARY CLOUDBET STRUCTURE
  //
  // {
  //   competitions: [
  //     {
  //       name: "...",
  //       key: "...",
  //       sport: {...},
  //       events: [...]
  //     }
  //   ]
  // }
  // ----------------------------------------------------------

  if (
    data &&
    Array.isArray(
      data.competitions
    )
  ) {

    const result:
      AnyObj[] = [];

    for (
      const competition
      of data.competitions
    ) {

      if (
        !competition ||
        !Array.isArray(
          competition.events
        )
      ) {
        continue;
      }

      for (
        const event
        of competition.events
      ) {

        if (
          event &&
          typeof event ===
            "object"
        ) {

          result.push({

            ...event,

            competition:
              event.competition ??
              {
                name:
                  competition.name ??
                  null,

                key:
                  competition.key ??
                  null,

                category:
                  competition.category ??
                  null,
              },

          });

        }

      }

    }

    return result;
  }


  // ----------------------------------------------------------
  // FALLBACK: direct events[]
  // ----------------------------------------------------------

  if (
    data &&
    Array.isArray(
      data.events
    )
  ) {

    return data.events.filter(
      (
        event: any
      ) =>
        event &&
        typeof event ===
          "object"
    );

  }


  // ----------------------------------------------------------
  // FALLBACK: array
  // ----------------------------------------------------------

  if (
    Array.isArray(
      data
    )
  ) {

    return data.filter(
      (
        event: any
      ) =>
        event &&
        typeof event ===
          "object"
    );

  }


  return [];
}


// ============================================================
// LIVE DETECTION
// ============================================================

function isLiveEvent(
  event: AnyObj
): boolean {

  const status =
    String(
      event?.status ??
      ""
    )
      .trim()
      .toUpperCase();

  return (
    status ===
      "TRADING_LIVE" ||
    status ===
      "LIVE" ||
    status.includes(
      "LIVE"
    )
  );
}


// ============================================================
// NUMBER
// ============================================================

function finiteNumber(
  value: any
): number | null {

  const n =
    Number(
      value
    );

  return Number.isFinite(
    n
  )
    ? n
    : null;
}


// ============================================================
// TARGET MARKET
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
// TARGET SELECTION
// ============================================================

function findTargetSelection(
  event: AnyObj
): AnyObj | null {

  const markets =
    event?.markets;

  if (
    !markets ||
    typeof markets !==
      "object"
  ) {

    return null;
  }

  const market =
    markets[
      TARGET_MARKET
    ];

  if (
    !market ||
    typeof market !==
      "object"
  ) {

    return null;
  }

  const submarkets =
    market.submarkets;

  if (
    !submarkets ||
    typeof submarkets !==
      "object"
  ) {

    return null;
  }

  const submarket =
    submarkets[
      TARGET_SUBMARKET
    ];

  if (
    !submarket ||
    typeof submarket !==
      "object"
  ) {

    return null;
  }

  const selections =
    Array.isArray(
      submarket.selections
    )
      ? submarket.selections
      : [];

  for (
    const selection
    of selections
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

    const status =
      String(
        selection?.status ??
        ""
      )
        .trim()
        .toUpperCase();

    if (
      status &&
      ![
        "SELECTION_ENABLED",
        "OPEN",
        "TRADING",
        "ACTIVE",
      ].includes(
        status
      )
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
      ...selection,

      target:
        true,

      target_market:
        TARGET_MARKET,

      target_submarket:
        TARGET_SUBMARKET,

      target_outcome:
        TARGET_OUTCOME,

      target_params:
        TARGET_PARAMS,
    };
  }

  return null;
}


// ============================================================
// BUILD LIVE MATCH
// ============================================================

function buildLiveMatch(
  event: AnyObj
): AnyObj {

  const target =
    findTargetSelection(
      event
    );

  return {

    id:
      event?.id ??
      null,

    event_id:
      event?.id ??
      null,

    home:
      event?.home?.name ??
      null,

    away:
      event?.away?.name ??
      null,

    home_key:
      event?.home?.key ??
      null,

    away_key:
      event?.away?.key ??
      null,

    status:
      event?.status ??
      null,

    competition:
      event?.competition ??
      null,

    target_1h_over_05:
      target,

    target_price:
      target?.price ??
      null,

    target_available:
      !!target,

  };
}


// ============================================================
// INTERESTING FIELDS
// ============================================================

function detectInterestingFields(
  data: any
): AnyObj {

  const result:
    AnyObj = {

    top_level_type:
      Array.isArray(data)
        ? "array"
        : typeof data,

    top_level_keys:
      data &&
      typeof data ===
        "object" &&
      !Array.isArray(data)
        ? Object.keys(
            data
          ).slice(
            0,
            100
          )
        : [],

  };

  if (
    data?.competitions &&
    Array.isArray(
      data.competitions
    )
  ) {

    result.competitions =
      data.competitions.length;

    result.competition_samples =
      data.competitions
        .slice(
          0,
          3
        )
        .map(
          (
            c: AnyObj
          ) => ({

            name:
              c?.name ??
              null,

            key:
              c?.key ??
              null,

            sport:
              c?.sport ??
              null,

            events:
              Array.isArray(
                c?.events
              )
                ? c.events.length
                : 0,

          })
        );

  }

  return result;
}


// ============================================================
// LIVE SOCCER
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

  const targetEvents =
    liveEvents.filter(
      (
        event
      ) =>
        !!findTargetSelection(
          event
        )
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

    target_1h_over_05_found:
      targetEvents.length,

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
// SEARCH NORMALIZE
// ============================================================

function normalize(
  value: any
): string {

  return String(
    value ??
      ""
  )
    .toLowerCase()
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .trim();
}


// ============================================================
// SEARCH
// ============================================================

function searchEvents(
  events: AnyObj[],
  query: string
): AnyObj[] {

  const q =
    normalize(
      query
    );

  if (!q) {
    return [];
  }

  return events
    .filter(
      (
        event
      ) => {

        const home =
          normalize(
            event?.home?.name
          );

        const away =
          normalize(
            event?.away?.name
          );

        const full =
          `${home} ${away}`;

        return (
          full.includes(q) ||
          home.includes(q) ||
          away.includes(q)
        );

      }
    )
    .map(
      buildLiveMatch
    );
}


// ============================================================
// EVENT LOOKUP
// ============================================================

async function getEvent(
  env: Env,
  id: string
): Promise<AnyObj> {

  const path =
    `/event?id=${encodeURIComponent(
      id
    )}`;

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    await parseJSON(
      result.response
    );

  return {

    request: {

      path,

      elapsed_ms:
        result.elapsedMs,

      http_status:
        result.response.status,

    },

    event:
      data,

    target:
      findTargetSelection(
        data
      ),

  };
}


// ============================================================
// CLOUD0007 PAGE
// ============================================================

async function fetchCloud0007Page():
  Promise<AnyObj> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      CLOUD0007_PAGE_TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        CLOUD0007_URL,
        {

          method:
            "GET",

          redirect:
            "follow",

          headers: {

            "accept":
              "text/html,application/xhtml+xml",

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

      url:
        CLOUD0007_URL,

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

      text_chars:
        text.length,

      next_data:
        text.includes(
          "__NEXT_DATA__"
        ),

      application_json_scripts:
        (
          text.match(
            /<script[^>]+type=["']application\/json["'][^>]*>/gi
          ) || []
        ).length,

      websocket:
        /WebSocket|socket\.io/i.test(
          text
        ),

      graphql:
        /graphql/i.test(
          text
        ),

      preview:
        text.slice(
          0,
          2000
        ),

    };

  } catch (
    error
  ) {

    return {

      url:
        CLOUD0007_URL,

      status:
        0,

      ok:
        false,

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
// CLOUD0007 SCRIPT URLS
// ============================================================

function extractScriptUrls(
  html: string
): string[] {

  const urls:
    string[] = [];

  const regex =
    /<script[^>]+src=["']([^"']+)["']/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(
        html
      ))
  ) {

    let url =
      match[1];

    if (
      url.startsWith(
        "//"
      )
    ) {

      url =
        "https:" +
        url;

    } else if (
      url.startsWith(
        "/"
      )
    ) {

      url =
        `${CLOUD0007_ORIGIN}${url}`;

    } else if (
      !url.startsWith(
        "http"
      )
    ) {

      url =
        `${CLOUD0007_ORIGIN}/${url}`;

    }

    urls.push(
      url
    );

  }

  return [
    ...new Set(
      urls
    ),
  ];
}


// ============================================================
// CONCURRENCY
// ============================================================

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (
    item: T,
    index: number
  ) => Promise<any>
): Promise<any[]> {

  const results =
    new Array(
      items.length
    );

  let nextIndex =
    0;

  async function worker() {

    while (true) {

      const index =
        nextIndex++;

      if (
        index >=
        items.length
      ) {

        break;

      }

      try {

        results[index] =
          await fn(
            items[index],
            index
          );

      } catch (
        error
      ) {

        results[index] = {

          error:
            error instanceof Error
              ? error.message
              : String(error),

        };

      }

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
          workers,
      },
      () =>
        worker()
    )
  );

  return results;
}


// ============================================================
// CLOUD0007 JS FETCH
// ============================================================

async function fetchCloud0007JS(
  url: string
): Promise<AnyObj> {

  const started =
    Date.now();

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

          method:
            "GET",

          redirect:
            "follow",

          headers: {

            "accept":
              "application/javascript,text/javascript,*/*",

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

      url,

      status:
        response.status,

      ok:
        response.ok,

      elapsed_ms:
        Date.now() -
        started,

      chars:
        text.length,

      text,

    };

  } catch (
    error
  ) {

    return {

      url,

      status:
        0,

      ok:
        false,

      elapsed_ms:
        Date.now() -
        started,

      chars:
        0,

      text:
        "",

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
// ENDPOINT CONTEXT EXTRACTION
// ============================================================

function extractContexts(
  source: string,
  keyword: string,
  radius = 2500,
  max = 10
): AnyObj[] {

  const results:
    AnyObj[] = [];

  let position =
    0;

  while (
    position <
      source.length &&
    results.length <
      max
  ) {

    const index =
      source.indexOf(
        keyword,
        position
      );

    if (
      index ===
        -1
    ) {

      break;

    }

    const start =
      Math.max(
        0,
        index -
          radius
      );

    const end =
      Math.min(
        source.length,
        index +
          keyword.length +
          radius
      );

    results.push({

      index,

      before:
        source.slice(
          start,
          index
        ),

      match:
        keyword,

      after:
        source.slice(
          index +
            keyword.length,
          end
        ),

      context:
        source.slice(
          start,
          end
        ),

    });

    position =
      index +
      keyword.length;

  }

  return results;
}


// ============================================================
// CLOUD0007 API DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007API():
  Promise<Response> {

  const started =
    Date.now();

  const page =
    await fetchCloud0007Page();

  if (
    !page?.ok
  ) {

    return json({

      success:
        false,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "DIAGNOSTIC_CLOUD0007_API",

      page,

    });

  }

  const pageResponse =
    await fetch(
      CLOUD0007_URL
    );

  const html =
    await pageResponse.text();

  const scriptUrls =
    extractScriptUrls(
      html
    );

  const scripts =
    await mapWithConcurrency(
      scriptUrls,
      CLOUD0007_JS_CONCURRENCY,
      async url =>
        fetchCloud0007JS(
          url
        )
    );

  const successful =
    scripts.filter(
      (
        x
      ) =>
        x?.ok &&
        x?.text
    );

  const combined =
    successful
      .map(
        (
          x
        ) =>
          `\n\n/* =====================================================\n   ${x.url}\n   ===================================================== */\n\n${x.text}`
      )
      .join(
        ""
      );

  const endpoints = [

    "/sports-api/v6/sports",

    "/sports-api/c/v6/sports",

    "/sports-betting/v4/lines",

    "/events",

    "/live",

    "/app-api/pulse/feed",

    "/app-api/pulse/feed-version",

  ];

  const endpointContexts:
    AnyObj = {};

  for (
    const endpoint
    of endpoints
  ) {

    endpointContexts[
      endpoint
    ] =
      extractContexts(
        combined,
        endpoint,
        3000,
        20
      );

  }

  return json({

    success:
      true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_CLOUD0007_API",

    read_only:
      true,

    performance: {

      total_elapsed_ms:
        Date.now() -
        started,

    },

    page: {

      status:
        page.status,

      elapsed_ms:
        page.elapsed_ms,

      next_data:
        page.next_data,

    },

    scripts: {

      discovered:
        scriptUrls.length,

      successful:
        successful.length,

      total_chars:
        combined.length,

    },

    endpoints_found:
      endpoints.map(
        endpoint => ({

          endpoint,

          occurrences:
            (
              combined.match(
                new RegExp(
                  endpoint.replace(
                    /[.*+?^${}()|[\]\\]/g,
                    "\\$&"
                  ),
                  "g"
                )
              ) || []
            ).length,

        })
      ),

    endpoint_contexts:
      endpointContexts,

    interpretation: {

      purpose:
        "Inspect frontend JavaScript around discovered Cloud0007 API routes.",

      important:
        "Cloud0007 restricted API endpoints must not be used to bypass Cloudbet API controls.",

      next_step:
        "Use endpoint contexts only for diagnostics and compare them with the official Cloudbet API.",

    },

  });
}


// ============================================================
// CLOUD0007 ROUTE PROBE
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

          method:
            "GET",

          redirect:
            "follow",

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

      parsed =
        null;

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

      status:
        0,

      ok:
        false,

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
// CLOUD0007 ROUTES DIAGNOSTIC
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

    success:
      true,

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
        "Use /diagnostic-cloud0007-api to inspect frontend request context.",

    },

  });
}


// ============================================================
// RAW EVENTS DIAGNOSTIC
// ============================================================

async function diagnosticEventsRaw(
  env: Env
): Promise<Response> {

  const started =
    Date.now();

  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const fullUrl =
    `${API_BASE}${path}`;

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const raw =
    await result.response.text();

  let parsed:
    any = null;

  let parseError:
    string | null = null;

  try {

    parsed =
      JSON.parse(
        raw
      );

  } catch (
    error
  ) {

    parseError =
      error instanceof Error
        ? error.message
        : String(error);

  }

  const candidates:
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
      ]
      of Object.entries(
        parsed
      )
    ) {

      if (
        Array.isArray(
          value
        )
      ) {

        candidates.push({

          key,

          length:
            value.length,

          first_item_keys:
            value[0] &&
            typeof value[0] ===
              "object"
              ? Object.keys(
                  value[0] as AnyObj
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
      true,

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
        fullUrl,

      method:
        "GET",

      requests_made:
        1,

      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      api_key_present:
        !!env.CLOUDBET_API_KEY,

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
        result.response.status,

      ok:
        result.response.ok,

      content_type:
        result.response.headers.get(
          "content-type"
        ),

      content_length_header:
        result.response.headers.get(
          "content-length"
        ),

      raw_chars:
        raw.length,

      raw_bytes:
        new TextEncoder().encode(
          raw
        ).length,

    },

    parsed: {

      json_parseable:
        !!parsed,

      parse_error:
        parseError,

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
            )
          : [],

      candidate_arrays:
        candidates,

    },

  });
}


// ============================================================
// TARGET MARKET DIAGNOSTIC
// ============================================================

function diagnoseTargetMarket(
  event: AnyObj
): AnyObj {

  const result:
    AnyObj = {

    event_id:
      event?.id ??
      null,

    home:
      event?.home?.name ??
      null,

    away:
      event?.away?.name ??
      null,

    status:
      event?.status ??
      null,

    target_market:
      TARGET_MARKET,

    target_submarket:
      TARGET_SUBMARKET,

    target_outcome:
      TARGET_OUTCOME,

    target_params:
      TARGET_PARAMS,

    market_exists:
      false,

    submarket_exists:
      false,

    selections:
      [],

    exact_target_found:
      false,

    exact_target_enabled:
      false,

    exact_target_price:
      null,

    exact_target_maxStake:
      null,

    reason:
      null,

  };


  // ----------------------------------------------------------
  // MARKETS
  // ----------------------------------------------------------

  const markets =
    event?.markets;

  if (
    !markets ||
    typeof markets !==
      "object"
  ) {

    result.reason =
      "NO_MARKETS_OBJECT";

    return result;
  }


  // ----------------------------------------------------------
  // TARGET MARKET
  // ----------------------------------------------------------

  const market =
    markets[
      TARGET_MARKET
    ];

  if (
    !market ||
    typeof market !==
      "object"
  ) {

    result.reason =
      "TARGET_MARKET_NOT_PRESENT";

    result.available_markets =
      Object.keys(
        markets
      );

    return result;
  }

  result.market_exists =
    true;


  // ----------------------------------------------------------
  // SUBMARKETS
  // ----------------------------------------------------------

  const submarkets =
    market.submarkets;

  if (
    !submarkets ||
    typeof submarkets !==
      "object"
  ) {

    result.reason =
      "NO_SUBMARKETS_OBJECT";

    return result;
  }


  const submarket =
    submarkets[
      TARGET_SUBMARKET
    ];

  if (
    !submarket ||
    typeof submarket !==
      "object"
  ) {

    result.reason =
      "TARGET_SUBMARKET_NOT_PRESENT";

    result.available_submarkets =
      Object.keys(
        submarkets
      );

    return result;
  }

  result.submarket_exists =
    true;


  // ----------------------------------------------------------
  // SELECTIONS
  // ----------------------------------------------------------

  const selections =
    Array.isArray(
      submarket.selections
    )
      ? submarket.selections
      : [];

  result.selections =
    selections.map(
      (
        selection: AnyObj
      ) => {

        const price =
          finiteNumber(
            selection?.price
          );

        const maxStake =
          finiteNumber(
            selection?.maxStake
          );

        const status =
          String(
            selection?.status ??
            ""
          )
            .trim()
            .toUpperCase();

        const exactOutcome =
          selection?.outcome ===
          TARGET_OUTCOME;

        const exactParams =
          selection?.params ===
          TARGET_PARAMS;

        const exact =
          exactOutcome &&
          exactParams;

        const enabledStatus =
          !status ||
          [
            "SELECTION_ENABLED",
            "OPEN",
            "TRADING",
            "ACTIVE",
          ].includes(
            status
          );

        return {

          outcome:
            selection?.outcome ??
            null,

          params:
            selection?.params ??
            null,

          marketUrl:
            selection?.marketUrl ??
            null,

          price,

          raw_price:
            selection?.price ??
            null,

          status:
            selection?.status ??
            null,

          maxStake,

          raw_maxStake:
            selection?.maxStake ??
            null,

          side:
            selection?.side ??
            null,

          exact_outcome:
            exactOutcome,

          exact_params:
            exactParams,

          exact_target:
            exact,

          enabled_status:
            enabledStatus,

          valid_price:
            price !== null &&
            price > 1,

          valid_maxStake:
            maxStake === null ||
            maxStake > 0,

          fully_usable:
            exact &&
            enabledStatus &&
            price !== null &&
            price > 1 &&
            (
              maxStake === null ||
              maxStake > 0
            ),

        };

      }
    );


  // ----------------------------------------------------------
  // EXACT TARGET
  // ----------------------------------------------------------

  const exactSelection =
    selections.find(
      (
        selection: AnyObj
      ) =>
        selection?.outcome ===
          TARGET_OUTCOME &&
        selection?.params ===
          TARGET_PARAMS
    );


  if (
    !exactSelection
  ) {

    result.reason =
      "TARGET_SELECTION_NOT_PRESENT";

    return result;
  }

  result.exact_target_found =
    true;


  const price =
    finiteNumber(
      exactSelection?.price
    );

  const maxStake =
    finiteNumber(
      exactSelection?.maxStake
    );

  const status =
    String(
      exactSelection?.status ??
      ""
    )
      .trim()
      .toUpperCase();


  result.exact_target_price =
    price;

  result.exact_target_maxStake =
    maxStake;

  result.exact_target_status =
    exactSelection?.status ??
    null;


  const enabledStatus =
    !status ||
    [
      "SELECTION_ENABLED",
      "OPEN",
      "TRADING",
      "ACTIVE",
    ].includes(
      status
    );


  const enabled =
    enabledStatus &&
    price !== null &&
    price > 1 &&
    (
      maxStake === null ||
      maxStake > 0
    );


  result.exact_target_enabled =
    enabled;


  if (
    enabled
  ) {

    result.reason =
      "TARGET_READY";

  } else if (
    !enabledStatus
  ) {

    result.reason =
      `TARGET_STATUS_${status}`;

  } else if (
    price === null ||
    price <= 1
  ) {

    result.reason =
      "TARGET_BAD_PRICE";

  } else if (
    maxStake !== null &&
    maxStake <= 0
  ) {

    result.reason =
      "TARGET_MAXSTAKE_ZERO";

  } else {

    result.reason =
      "TARGET_NOT_ACCEPTABLE";

  }


  return result;
}


// ============================================================
// TARGET MARKET DIAGNOSTIC ENDPOINT
// ============================================================

async function diagnosticTargetMarket(
  env: Env
): Promise<Response> {

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
    extractEvents(
      data
    );

  const liveEvents =
    events.filter(
      isLiveEvent
    );

  const diagnostics =
    liveEvents.map(
      diagnoseTargetMarket
    );


  const marketPresent =
    diagnostics.filter(
      (
        item
      ) =>
        item.market_exists
    ).length;


  const submarketPresent =
    diagnostics.filter(
      (
        item
      ) =>
        item.submarket_exists
    ).length;


  const exactTargetPresent =
    diagnostics.filter(
      (
        item
      ) =>
        item.exact_target_found
    ).length;


  const exactTargetEnabled =
    diagnostics.filter(
      (
        item
      ) =>
        item.exact_target_enabled
    ).length;


  const targetReady =
    diagnostics.filter(
      (
        item
      ) =>
        item.reason ===
        "TARGET_READY"
    ).length;


  return json({

    success:
      true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_TARGET_MARKET",

    read_only:
      true,

    betting:
      false,

    request: {

      path,

      requests_made:
        1,

      elapsed_ms:
        result.elapsedMs,

      http_status:
        result.response.status,

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

    summary: {

      events_received:
        events.length,

      live_events:
        liveEvents.length,

      market_present:
        marketPresent,

      submarket_present:
        submarketPresent,

      exact_target_present:
        exactTargetPresent,

      exact_target_enabled:
        exactTargetEnabled,

      target_ready:
        targetReady,

    },

    events:
      diagnostics,

    performance: {

      total_elapsed_ms:
        Date.now() -
        started,

    },

  });
}


// ============================================================
// MAIN
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


    // --------------------------------------------------------
    // HEALTH
    // --------------------------------------------------------

    if (
      pathname ===
      "/"
    ) {

      return json({

        success:
          true,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        mode:
          "READ_ONLY",

        betting:
          false,

        endpoints: [

          "/live",

          "/search?q=HOME%20AWAY",

          "/event?id=EVENT_ID",

          "/diagnostic-events-raw",

          "/diagnostic-target-market",

          "/diagnostic-cloud0007",

          "/diagnostic-cloud0007-api",

          "/diagnostic-cloud0007-routes",

        ],

      });

    }


    // --------------------------------------------------------
    // LIVE
    // --------------------------------------------------------

    if (
      pathname ===
      "/live"
    ) {

      try {

        const result =
          await getLiveSoccerEvents(
            env
          );

        return json({

          success:
            true,

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

          ...result,

        });

      } catch (
        error
      ) {

        return json({

          success:
            false,

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

        }, 500);

      }

    }


    // --------------------------------------------------------
    // SEARCH
    // --------------------------------------------------------

    if (
      pathname ===
      "/search"
    ) {

      const query =
        url.searchParams.get(
          "q"
        ) ??
        "";

      try {

        const result =
          await cloudbetFetch(
            env,
            "/events?sport=soccer&live=true&players=false&limit=10000"
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

        return json({

          success:
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "SEARCH",

          query,

          events_received:
            events.length,

          events_recognized_live:
            liveEvents.length,

          results:
            searchEvents(
              liveEvents,
              query
            ),

        });

      } catch (
        error
      ) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "SEARCH",

          query,

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // --------------------------------------------------------
    // EVENT
    // --------------------------------------------------------

    if (
      pathname ===
      "/event"
    ) {

      const id =
        url.searchParams.get(
          "id"
        );

      if (!id) {

        return json({

          success:
            false,

          error:
            "Missing id",

        }, 400);

      }

      try {

        const result =
          await getEvent(
            env,
            id
          );

        return json({

          success:
            true,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT",

          read_only:
            true,

          betting:
            false,

          ...result,

        });

      } catch (
        error
      ) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "EVENT",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // --------------------------------------------------------
    // RAW EVENTS
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-events-raw"
    ) {

      try {

        return await diagnosticEventsRaw(
          env
        );

      } catch (
        error
      ) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "DIAGNOSTIC_EVENTS_RAW",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // --------------------------------------------------------
    // TARGET MARKET
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-target-market"
    ) {

      try {

        return await diagnosticTargetMarket(
          env
        );

      } catch (
        error
      ) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "DIAGNOSTIC_TARGET_MARKET",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // --------------------------------------------------------
    // CLOUD0007 PAGE
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-cloud0007"
    ) {

      try {

        const result =
          await fetchCloud0007Page();

        return json({

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

          result,

        });

      } catch (
        error
      ) {

        return json({

          success:
            false,

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

        }, 500);

      }

    }


    // --------------------------------------------------------
    // CLOUD0007 API
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-cloud0007-api"
    ) {

      try {

        return await diagnosticCloud0007API();

      } catch (
        error
      ) {

        return json({

          success:
            false,

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

        }, 500);

      }

    }


    // --------------------------------------------------------
    // CLOUD0007 ROUTES
    // --------------------------------------------------------

    if (
      pathname ===
      "/diagnostic-cloud0007-routes"
    ) {

      try {

        return await diagnosticCloud0007Routes();

      } catch (
        error
      ) {

        return json({

          success:
            false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "DIAGNOSTIC_CLOUD0007_ROUTES",

          error:
            error instanceof Error
              ? error.message
              : String(error),

        }, 500);

      }

    }


    // --------------------------------------------------------
    // 404
    // --------------------------------------------------------

    return json({

      success:
        false,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      error:
        "Not found",

      path:
        pathname,

    }, 404);

  },

};
