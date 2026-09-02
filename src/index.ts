// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR
// V5.7.2
//
// PURPOSE:
// - READ ONLY
// - Fast Cloudbet live soccer source
// - Exact 1H Total Goals OVER 0.5 detection
// - Cloud0007 __NEXT_DATA__ diagnostics
//
// V5.7.2:
// - Keeps /live unchanged
// - Keeps /search unchanged
// - Keeps /event unchanged
// - Keeps exact target odds logic unchanged
// - Adds /diagnostic-cloud0007-next
// - Inspects parsed __NEXT_DATA__ for possible API/feed/event
//   structures without returning the full 216 KB payload
//
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
  "V5.7.2";

const CLOUDBET_TIMEOUT_MS =
  8000;

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
// GENERIC HELPERS
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
          "no-store, no-cache, must-revalidate"
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
  ok: boolean;
  status: number;
  elapsed_ms: number;
  text: string;
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
    const apiKey =
      env[CLOUDBET_API_KEY as keyof Env];

    const response =
      await fetch(
        `${API_BASE}${path}`,
        {
          method: "GET",
          headers: {
            ...(apiKey
              ? {
                  "X-API-Key":
                    apiKey
                }
              : {}),
            "accept":
              "application/json",
            "cache-control":
              "no-cache",
            "user-agent":
              "cloudbet-live-soccer-detector/5.7.2"
          },
          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    return {
      ok:
        response.ok,
      status:
        response.status,
      elapsed_ms:
        Date.now() - started,
      text
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      elapsed_ms:
        Date.now() - started,
      text: "",
      error:
        error?.name === "AbortError"
          ? `TIMEOUT_${timeoutMs}MS`
          : String(
              error?.message ||
              error
            )
    };
  } finally {
    clearTimeout(timer);
  }
}

function parseJSON(
  text: string
): any {
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ============================================================
// SOCCER ROOT
// ============================================================

async function getSoccerData(
  env: Env
): Promise<{
  data: any;
  meta: AnyObj;
}> {
  const result =
    await cloudbetFetch(
      env,
      "/sports/soccer"
    );

  const data =
    parseJSON(result.text);

  return {
    data,
    meta: {
      ok:
        result.ok,
      status:
        result.status,
      elapsed_ms:
        result.elapsed_ms,
      error:
        result.error || null
    }
  };
}

// ============================================================
// FLATTEN SOCCER COMPETITIONS
// ============================================================

function flattenSoccerCompetitions(
  data: any
): AnyObj[] {
  const result: AnyObj[] = [];

  const categories =
    Array.isArray(data?.categories)
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
        typeof competition === "object"
      ) {
        result.push({
          ...competition,
          category_name:
            category?.name ?? null,
          category_key:
            category?.key ?? null
        });
      }
    }
  }

  return result;
}

// ============================================================
// COLLECT KEYS
// ============================================================

function collectKeys(
  value: any,
  prefix = "",
  depth = 0,
  maxDepth = 6,
  output: string[] = []
): string[] {
  if (
    value === null ||
    value === undefined ||
    depth > maxDepth
  ) {
    return output;
  }

  if (
    typeof value !== "object"
  ) {
    return output;
  }

  const keys =
    Array.isArray(value)
      ? Object.keys(value).slice(0, 100)
      : Object.keys(value);

  for (
    const key of keys
  ) {
    const path =
      prefix
        ? `${prefix}.${key}`
        : key;

    output.push(path);

    if (
      output.length >= 5000
    ) {
      return output;
    }

    try {
      collectKeys(
        value[key],
        path,
        depth + 1,
        maxDepth,
        output
      );
    } catch {
      // ignore malformed branches
    }
  }

  return output;
}

// ============================================================
// SAMPLE FIELD VALUES
// ============================================================

function sampleFieldValues(
  value: any,
  wanted: Set<string>,
  prefix = "",
  depth = 0,
  maxDepth = 8,
  output: AnyObj[] = []
): AnyObj[] {
  if (
    value === null ||
    value === undefined ||
    depth > maxDepth ||
    output.length >= 250
  ) {
    return output;
  }

  if (
    typeof value !== "object"
  ) {
    return output;
  }

  const keys =
    Array.isArray(value)
      ? Object.keys(value).slice(0, 200)
      : Object.keys(value);

  for (
    const key of keys
  ) {
    if (
      output.length >= 250
    ) {
      break;
    }

    const path =
      prefix
        ? `${prefix}.${key}`
        : key;

    const lowerKey =
      String(key).toLowerCase();

    if (
      wanted.has(lowerKey)
    ) {
      const raw =
        value[key];

      let sample: any =
        raw;

      if (
        typeof raw === "string"
      ) {
        sample =
          raw.length > 500
            ? raw.slice(0, 500) +
              "..."
            : raw;
      } else if (
        typeof raw === "object" &&
        raw !== null
      ) {
        try {
          const serialized =
            JSON.stringify(raw);

          sample =
            serialized.length > 1000
              ? serialized.slice(
                  0,
                  1000
                ) + "..."
              : raw;
        } catch {
          sample =
            "[object]";
        }
      }

      output.push({
        key,
        path,
        type:
          Array.isArray(raw)
            ? "array"
            : typeof raw,
        sample
      });
    }

    try {
      sampleFieldValues(
        value[key],
        wanted,
        path,
        depth + 1,
        maxDepth,
        output
      );
    } catch {
      // ignore
    }
  }

  return output;
}

// ============================================================
// INTERESTING STRING SEARCH
// ============================================================

function searchInterestingStrings(
  value: any,
  terms: string[],
  path = "",
  depth = 0,
  maxDepth = 10,
  output: AnyObj[] = []
): AnyObj[] {
  if (
    output.length >= 300 ||
    depth > maxDepth ||
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (
    typeof value === "string"
  ) {
    const lower =
      value.toLowerCase();

    const matches =
      terms.filter(
        term =>
          lower.includes(
            term
          )
      );

    if (
      matches.length
    ) {
      output.push({
        path,
        matches,
        value:
          value.length > 1000
            ? value.slice(
                0,
                1000
              ) + "..."
            : value
      });
    }

    return output;
  }

  if (
    typeof value !== "object"
  ) {
    return output;
  }

  const keys =
    Array.isArray(value)
      ? Object.keys(value).slice(
          0,
          500
        )
      : Object.keys(value);

  for (
    const key of keys
  ) {
    if (
      output.length >= 300
    ) {
      break;
    }

    const childPath =
      path
        ? `${path}.${key}`
        : key;

    try {
      searchInterestingStrings(
        value[key],
        terms,
        childPath,
        depth + 1,
        maxDepth,
        output
      );
    } catch {
      // ignore
    }
  }

  return output;
}

// ============================================================
// STRUCTURAL DETECTION
// ============================================================

function inspectPotentialEventArrays(
  value: any,
  path = "",
  depth = 0,
  maxDepth = 10,
  output: AnyObj[] = []
): AnyObj[] {
  if (
    output.length >= 100 ||
    depth > maxDepth ||
    value === null ||
    value === undefined ||
    typeof value !== "object"
  ) {
    return output;
  }

  if (
    Array.isArray(value)
  ) {
    if (
      value.length > 0 &&
      value.length <= 10000
    ) {
      const first =
        value[0];

      if (
        first &&
        typeof first === "object"
      ) {
        const keys =
          Object.keys(first);

        const lowerKeys =
          keys.map(
            k =>
              k.toLowerCase()
          );

        const eventSignals =
          [
            "id",
            "name",
            "home",
            "away",
            "event",
            "events",
            "status",
            "live",
            "market",
            "markets",
            "odds",
            "sport",
            "competition",
            "participant"
          ];

        const matched =
          eventSignals.filter(
            signal =>
              lowerKeys.some(
                key =>
                  key === signal ||
                  key.includes(
                    signal
                  )
              )
          );

        if (
          matched.length >= 2
        ) {
          output.push({
            path,
            type: "array",
            length:
              value.length,
            first_item_keys:
              keys.slice(0, 50),
            matched_signals:
              matched
          });
        }
      }
    }

    for (
      let i = 0;
      i <
        Math.min(
          value.length,
          50
        );
      i++
    ) {
      if (
        output.length >= 100
      ) {
        break;
      }

      try {
        inspectPotentialEventArrays(
          value[i],
          `${path}[${i}]`,
          depth + 1,
          maxDepth,
          output
        );
      } catch {
        // ignore
      }
    }

    return output;
  }

  const keys =
    Object.keys(value).slice(
      0,
      500
    );

  for (
    const key of keys
  ) {
    if (
      output.length >= 100
    ) {
      break;
    }

    const childPath =
      path
        ? `${path}.${key}`
        : key;

    try {
      inspectPotentialEventArrays(
        value[key],
        childPath,
        depth + 1,
        maxDepth,
        output
      );
    } catch {
      // ignore
    }
  }

  return output;
}

// ============================================================
// FIND POSSIBLE API URLS
// ============================================================

function extractUrlsFromObject(
  value: any,
  path = "",
  depth = 0,
  maxDepth = 10,
  output: AnyObj[] = []
): AnyObj[] {
  if (
    output.length >= 250 ||
    depth > maxDepth ||
    value === null ||
    value === undefined
  ) {
    return output;
  }

  if (
    typeof value === "string"
  ) {
    const trimmed =
      value.trim();

    const lower =
      trimmed.toLowerCase();

    const looksLikeUrl =
      lower.startsWith(
        "http://"
      ) ||
      lower.startsWith(
        "https://"
      ) ||
      lower.includes(
        "/api/"
      ) ||
      lower.includes(
        "/events"
      ) ||
      lower.includes(
        "/odds"
      ) ||
      lower.includes(
        "/live"
      ) ||
      lower.includes(
        "/sports"
      ) ||
      lower.includes(
        "endpoint"
      );

    if (
      looksLikeUrl
    ) {
      output.push({
        path,
        value:
          trimmed.length > 1000
            ? trimmed.slice(
                0,
                1000
              ) + "..."
            : trimmed
      });
    }

    return output;
  }

  if (
    typeof value !== "object"
  ) {
    return output;
  }

  const keys =
    Array.isArray(value)
      ? Object.keys(value).slice(
          0,
          500
        )
      : Object.keys(value);

  for (
    const key of keys
  ) {
    if (
      output.length >= 250
    ) {
      break;
    }

    const childPath =
      path
        ? `${path}.${key}`
        : key;

    try {
      extractUrlsFromObject(
        value[key],
        childPath,
        depth + 1,
        maxDepth,
        output
      );
    } catch {
      // ignore
    }
  }

  return output;
}

// ============================================================
// EXTRACT __NEXT_DATA__
// ============================================================

function extractNextData(
  html: string
): {
  present: boolean;
  parseable: boolean;
  chars: number;
  data: any;
  error?: string;
} {
  const match =
    html.match(
      /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
    );

  if (!match) {
    return {
      present: false,
      parseable: false,
      chars: 0,
      data: null
    };
  }

  const raw =
    match[1] || "";

  try {
    return {
      present: true,
      parseable: true,
      chars:
        raw.length,
      data:
        JSON.parse(raw)
    };
  } catch (error: any) {
    return {
      present: true,
      parseable: false,
      chars:
        raw.length,
      data: null,
      error:
        String(
          error?.message ||
          error
        )
    };
  }
}

// ============================================================
// CLOUD0007 FETCH
// ============================================================

async function fetchCloud0007Page(): Promise<{
  ok: boolean;
  status: number;
  elapsed_ms: number;
  final_url: string;
  content_type: string;
  html: string;
  bytes: number;
  error?: string;
}> {
  const url =
    "https://www.cloud0007.com/en/sports/live?s=soccer";

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      10000
    );

  try {
    const response =
      await fetch(
        url,
        {
          method: "GET",
          headers: {
            "accept":
              "text/html,application/xhtml+xml",
            "accept-language":
              "en-US,en;q=0.9",
            "cache-control":
              "no-cache",
            "user-agent":
              "Mozilla/5.0 (compatible; CloudbetLiveDiagnostic/5.7.2)"
          },
          redirect:
            "follow",
          signal:
            controller.signal
        }
      );

    const html =
      await response.text();

    return {
      ok:
        response.ok,
      status:
        response.status,
      elapsed_ms:
        Date.now() - started,
      final_url:
        response.url,
      content_type:
        response.headers.get(
          "content-type"
        ) || "",
      html,
      bytes:
        new TextEncoder().encode(
          html
        ).length
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      elapsed_ms:
        Date.now() - started,
      final_url:
        url,
      content_type: "",
      html: "",
      bytes: 0,
      error:
        error?.name === "AbortError"
          ? "TIMEOUT_10000MS"
          : String(
              error?.message ||
              error
            )
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// CLOUD0007 NEXT DATA DIAGNOSTIC
// ============================================================

async function diagnosticCloud0007Next(): Promise<Response> {
  const result =
    await fetchCloud0007Page();

  if (!result.ok) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        action:
          "DIAGNOSTIC_CLOUD0007_NEXT",

        read_only:
          true,

        request: {
          url:
            "https://www.cloud0007.com/en/sports/live?s=soccer",

          method:
            "GET",

          timeout_ms:
            10000,

          requests_made:
            1
        },

        performance: {
          elapsed_ms:
            result.elapsed_ms,

          http_status:
            result.status
        },

        error:
          result.error ||
          "CLOUD0007_FETCH_FAILED"
      },
      502
    );
  }

  const next =
    extractNextData(
      result.html
    );

  if (
    !next.present ||
    !next.parseable
  ) {
    return json({
      success: true,

      worker:
        "cloudbet-live-soccer-detector",

      version:
        VERSION,

      action:
        "DIAGNOSTIC_CLOUD0007_NEXT",

      read_only:
        true,

      request: {
        url:
          "https://www.cloud0007.com/en/sports/live?s=soccer",

        method:
          "GET",

        requests_made:
          1,

        timeout_ms:
          10000
      },

      performance: {
        elapsed_ms:
          result.elapsed_ms,

        http_status:
          result.status,

        response_bytes:
          result.bytes,

        html_chars:
          result.html.length
      },

      embedded_data: {
        next_data_present:
          next.present,

        next_data_parseable:
          next.parseable,

        next_data_chars:
          next.chars,

        error:
          next.error ||
          null
      },

      interpretation: {
        purpose:
          "Inspect Cloud0007 __NEXT_DATA__ for possible live-soccer data sources.",

        next_step:
          "No usable __NEXT_DATA__ found. Inspect page scripts/API calls instead."
      }
    });
  }

  const data =
    next.data;

  const rootKeys =
    data &&
    typeof data === "object"
      ? Object.keys(data)
      : [];

  const wantedFields =
    new Set([
      "api",
      "apis",
      "endpoint",
      "endpoints",
      "events",
      "event",
      "live",
      "soccer",
      "sports",
      "sport",
      "odds",
      "markets",
      "market",
      "feed",
      "feeds",
      "url",
      "urls",
      "baseurl",
      "base_url",
      "apiurl",
      "api_url",
      "graphql",
      "websocket",
      "ws",
      "host",
      "origin",
      "data"
    ]);

  const interestingTerms = [
    "api",
    "endpoint",
    "events",
    "event",
    "live",
    "soccer",
    "sports",
    "odds",
    "market",
    "feed",
    "baseurl",
    "api_url",
    "apiurl",
    "websocket",
    "wss://",
    "https://"
  ];

  const fieldSamples =
    sampleFieldValues(
      data,
      wantedFields
    );

  const stringMatches =
    searchInterestingStrings(
      data,
      interestingTerms
    );

  const possibleUrls =
    extractUrlsFromObject(
      data
    );

  const potentialArrays =
    inspectPotentialEventArrays(
      data
    );

  const allKeys =
    collectKeys(
      data,
      "",
      0,
      8
    );

  const relevantKeyPaths =
    allKeys
      .filter(
        path => {
          const lower =
            path.toLowerCase();

          return (
            lower.includes("api") ||
            lower.includes("endpoint") ||
            lower.includes("event") ||
            lower.includes("live") ||
            lower.includes("soccer") ||
            lower.includes("sport") ||
            lower.includes("odds") ||
            lower.includes("market") ||
            lower.includes("feed") ||
            lower.includes("url") ||
            lower.includes("websocket") ||
            lower.includes("socket")
          );
        }
      )
      .slice(
        0,
        500
      );

  // ----------------------------------------------------------
  // Find likely large event-like objects
  // ----------------------------------------------------------

  let eventLikeObjectSamples: AnyObj[] = [];

  function walkEventObjects(
    value: any,
    path = "",
    depth = 0
  ): void {
    if (
      eventLikeObjectSamples.length >= 100 ||
      depth > 10 ||
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
      !Array.isArray(value)
    ) {
      const keys =
        Object.keys(value);

      const lower =
        keys.map(
          k =>
            k.toLowerCase()
        );

      const hasHome =
        lower.some(
          k =>
            k === "home" ||
            k.includes(
              "home_team"
            ) ||
            k.includes(
              "hometeam"
            )
        );

      const hasAway =
        lower.some(
          k =>
            k === "away" ||
            k.includes(
              "away_team"
            ) ||
            k.includes(
              "awayteam"
            )
        );

      const hasEvent =
        lower.some(
          k =>
            k === "event" ||
            k === "eventid" ||
            k.includes(
              "event_id"
            )
        );

      const hasStatus =
        lower.some(
          k =>
            k === "status" ||
            k === "state" ||
            k === "live" ||
            k === "islive"
        );

      if (
        (hasHome && hasAway) ||
        (hasEvent && hasStatus)
      ) {
        const sample: AnyObj = {};

        for (
          const key of keys.slice(
            0,
            40
          )
        ) {
          const v =
            value[key];

          if (
            typeof v ===
              "string" ||
            typeof v ===
              "number" ||
            typeof v ===
              "boolean" ||
            v === null
          ) {
            sample[key] =
              v;
          }
        }

        eventLikeObjectSamples.push({
          path,
          keys:
            keys.slice(
              0,
              50
            ),
          sample
        });
      }
    }

    const keys =
      Array.isArray(value)
        ? Object.keys(value).slice(
            0,
            200
          )
        : Object.keys(value).slice(
            0,
            500
          );

    for (
      const key of keys
    ) {
      if (
        eventLikeObjectSamples.length >=
        100
      ) {
        break;
      }

      const childPath =
        path
          ? `${path}.${key}`
          : key;

      try {
        walkEventObjects(
          value[key],
          childPath,
          depth + 1
        );
      } catch {
        // ignore
      }
    }
  }

  walkEventObjects(
    data
  );

  // ----------------------------------------------------------
  // Look specifically inside props/page/query
  // ----------------------------------------------------------

  const focused: AnyObj = {};

  for (
    const root of [
      "props",
      "page",
      "query"
    ]
  ) {
    if (
      data &&
      Object.prototype.hasOwnProperty.call(
        data,
        root
      )
    ) {
      const value =
        data[root];

      focused[root] = {
        type:
          Array.isArray(value)
            ? "array"
            : typeof value,

        keys:
          value &&
          typeof value === "object"
            ? Object.keys(value).slice(
                0,
                100
              )
            : []
      };
    }
  }

  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "DIAGNOSTIC_CLOUD0007_NEXT",

    read_only:
      true,

    request: {
      url:
        "https://www.cloud0007.com/en/sports/live?s=soccer",

      method:
        "GET",

      requests_made:
        1,

      timeout_ms:
        10000
    },

    performance: {
      elapsed_ms:
        result.elapsed_ms,

      http_status:
        result.status,

      response_bytes:
        result.bytes,

      html_chars:
        result.html.length
    },

    embedded_data: {
      next_data_present:
        true,

      next_data_parseable:
        true,

      next_data_chars:
        next.chars,

      root_keys:
        rootKeys,

      focused_root_objects:
        focused
    },

    discovery: {
      relevant_key_paths:
        relevantKeyPaths,

      relevant_key_paths_count:
        relevantKeyPaths.length,

      field_samples:
        fieldSamples,

      field_samples_count:
        fieldSamples.length,

      possible_urls:
        possibleUrls.slice(
          0,
          150
        ),

      possible_urls_count:
        possibleUrls.length,

      potential_event_arrays:
        potentialArrays,

      potential_event_arrays_count:
        potentialArrays.length,

      event_like_objects:
        eventLikeObjectSamples,

      event_like_objects_count:
        eventLikeObjectSamples.length,

      string_matches:
        stringMatches.slice(
          0,
          150
        ),

      string_matches_count:
        stringMatches.length
    },

    interpretation: {
      purpose:
        "Find whether Cloud0007 embeds a usable live soccer API/feed/event structure inside __NEXT_DATA__.",

      current_live_path:
        "UNCHANGED",

      betting:
        "DISABLED",

      no_html_dump:
        true,

      no_full_next_data_dump:
        true,

      next_step:
        "Inspect returned paths, URLs, event-like objects and API/feed values. If a concrete live data endpoint appears, test it separately before replacing /live."
    }
  });
}

// ============================================================
// LIVE EVENTS
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
      data?.data?.items
    )
  ) {
    return data.data.items;
  }

  return [];
}

// ============================================================
// LIVE STATUS
// ============================================================

function isLiveEvent(
  event: AnyObj
): boolean {
  const directFlags = [
    event?.live,
    event?.isLive,
    event?.inPlay,
    event?.in_play
  ];

  if (
    directFlags.some(
      value =>
        value === true
    )
  ) {
    return true;
  }

  const statusValues = [
    event?.status,
    event?.state,
    event?.eventStatus,
    event?.event_status
  ];

  for (
    const raw of statusValues
  ) {
    const value =
      String(
        raw ?? ""
      ).toLowerCase();

    if (
      [
        "live",
        "inplay",
        "in-play",
        "started",
        "trading_live"
      ].includes(value)
    ) {
      return true;
    }
  }

  return false;
}

// ============================================================
// TARGET ODDS
// ============================================================

function extractTargetOdds(
  event: AnyObj
): number | null {
  const markets =
    Array.isArray(
      event?.markets
    )
      ? event.markets
      : [];

  for (
    const market of markets
  ) {
    const marketKey =
      market?.key ??
      market?.market ??
      market?.marketKey ??
      market?.market_key ??
      "";

    if (
      marketKey !==
      TARGET_MARKET
    ) {
      continue;
    }

    const submarkets =
      Array.isArray(
        market?.submarkets
      )
        ? market.submarkets
        : [];

    for (
      const submarket of submarkets
    ) {
      const submarketKey =
        submarket?.key ??
        submarket?.submarket ??
        "";

      if (
        submarketKey !==
        TARGET_SUBMARKET
      ) {
        continue;
      }

      const selections =
        Array.isArray(
          submarket?.selections
        )
          ? submarket.selections
          : [];

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

        const status =
          String(
            selection?.status ??
            ""
          ).toLowerCase();

        if (
          [
            "selection_disabled",
            "disabled",
            "closed",
            "suspended"
          ].includes(status)
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

        return price;
      }
    }
  }

  return null;
}

// ============================================================
// BUILD LIVE MATCH
// ============================================================

function buildLiveMatch(
  event: AnyObj
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
      null,

    away:
      event?.away ??
      event?.awayTeam ??
      event?.away_team ??
      null,

    status:
      event?.status ??
      event?.state ??
      null,

    live:
      isLiveEvent(event),

    target_1h_over_05:
      extractTargetOdds(event),

    raw:
      event
  };
}

// ============================================================
// GET DIRECT LIVE SOCCER EVENTS
// ============================================================

async function getLiveSoccerEvents(
  env: Env
): Promise<{
  events: AnyObj[];
  meta: AnyObj;
}> {
  const path =
    "/events?sport=soccer&live=true&players=false&limit=10000";

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    parseJSON(
      result.text
    );

  const events =
    extractLiveEvents(
      data
    );

  return {
    events,
    meta: {
      ok:
        result.ok,

      status:
        result.status,

      elapsed_ms:
        result.elapsed_ms,

      error:
        result.error || null
    }
  };
}

// ============================================================
// DIAGNOSTIC LIVE EVENTS
// ============================================================

async function diagnosticLiveEvents(
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
    parseJSON(
      result.text
    );

  const events =
    extractLiveEvents(
      data
    );

  const liveEvents =
    events.filter(
      event =>
        isLiveEvent(event)
    );

  const statuses: AnyObj = {};

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

  const targetMatches =
    events
      .map(event => ({
        id:
          event?.id ??
          event?.eventId ??
          null,

        name:
          event?.name ??
          null,

        target_odds:
          extractTargetOdds(
            event
          )
      }))
      .filter(
        x =>
          x.target_odds !==
          null
      );

  return json({
    success:
      result.ok,

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
        result.status
    },

    response: {
      top_level_type:
        Array.isArray(data)
          ? "array"
          : typeof data,

      top_level_keys:
        data &&
        typeof data === "object"
          ? Object.keys(data)
          : [],

      raw_response_chars:
        result.text.length
    },

    result: {
      events_received:
        events.length,

      events_recognized_live:
        liveEvents.length,

      statuses,

      target_1h_over_05_found:
        targetMatches.length,

      target_matches:
        targetMatches.slice(
          0,
          50
        ),

      first_10:
        events
          .slice(0, 10)
          .map(
            buildLiveMatch
          )
    },

    error:
      result.error ||
      null
  });
}

// ============================================================
// COMPETITION KEY
// ============================================================

function getCompetitionKey(
  competition: AnyObj
): string | null {
  return (
    competition?.key ??
    competition?.id ??
    competition?.competitionKey ??
    competition?.competition_key ??
    null
  );
}

// ============================================================
// EXTRACT COMPETITIONS FOR LIVE
// ============================================================

function extractCompetitionsForLive(
  data: any
): AnyObj[] {
  return flattenSoccerCompetitions(
    data
  );
}

// ============================================================
// EXTRACT EVENTS FROM COMPETITION
// ============================================================

function extractEvents(
  data: any
): AnyObj[] {
  return extractLiveEvents(
    data
  );
}

// ============================================================
// FETCH COMPETITION
// ============================================================

async function fetchCompetition(
  env: Env,
  competition: AnyObj
): Promise<{
  competition: AnyObj;
  events: AnyObj[];
  meta: AnyObj;
}> {
  const key =
    getCompetitionKey(
      competition
    );

  if (!key) {
    return {
      competition,
      events: [],
      meta: {
        ok: false,
        status: 0,
        elapsed_ms: 0,
        error:
          "MISSING_COMPETITION_KEY"
      }
    };
  }

  const path =
    `/events?sport=soccer&competition=${encodeURIComponent(
      key
    )}&players=false&limit=10000`;

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    parseJSON(
      result.text
    );

  return {
    competition,
    events:
      extractEvents(
        data
      ),
    meta: {
      ok:
        result.ok,

      status:
        result.status,

      elapsed_ms:
        result.elapsed_ms,

      error:
        result.error || null
    }
  };
}

// ============================================================
// CONCURRENCY MAP
// ============================================================

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results =
    new Array<R>(
      items.length
    );

  let nextIndex = 0;

  async function worker(): Promise<void> {
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
        await fn(
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
          )
      },
      () =>
        worker()
    );

  await Promise.all(
    workers
  );

  return results;
}

// ============================================================
// SEARCH
// ============================================================

async function searchSoccer(
  env: Env
): Promise<Response> {
  const started =
    Date.now();

  const soccer =
    await getSoccerData(
      env
    );

  const competitions =
    extractCompetitionsForLive(
      soccer.data
    );

  const results =
    await mapWithConcurrency(
      competitions,
      COMPETITION_CONCURRENCY,
      competition =>
        fetchCompetition(
          env,
          competition
        )
    );

  const allEvents: AnyObj[] =
    [];

  let failed =
    0;

  let requests =
    0;

  let requestTime =
    0;

  for (
    const result of results
  ) {
    requests++;

    requestTime +=
      Number(
        result.meta.elapsed_ms ||
        0
      );

    if (
      !result.meta.ok
    ) {
      failed++;
    }

    for (
      const event of result.events
    ) {
      allEvents.push(
        event
      );
    }
  }

  const unique =
    new Map<
      string,
      AnyObj
    >();

  for (
    const event of allEvents
  ) {
    const id =
      String(
        event?.id ??
        event?.eventId ??
        event?.event_id ??
        `${Math.random()}`
      );

    if (
      !unique.has(id)
    ) {
      unique.set(
        id,
        event
      );
    }
  }

  const liveEvents =
    Array.from(
      unique.values()
    ).filter(
      event =>
        isLiveEvent(
          event
        )
    );

  const matches =
    liveEvents.map(
      buildLiveMatch
    );

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

    performance: {
      total_elapsed_ms:
        Date.now() -
        started,

      root_fetch_ms:
        soccer.meta.elapsed_ms,

      competition_requests:
        requests,

      competition_failed:
        failed,

      competition_concurrency:
        COMPETITION_CONCURRENCY,

      competition_request_time_sum_ms:
        requestTime
    },

    result: {
      competitions:
        competitions.length,

      events:
        allEvents.length,

      unique_events:
        unique.size,

      live_events:
        liveEvents.length,

      target_1h_over_05:
        matches.filter(
          event =>
            event.target_1h_over_05 !==
            null
        ).length,

      matches:
        matches
    }
  });
}

// ============================================================
// LIVE
// ============================================================

async function live(
  env: Env
): Promise<Response> {
  const started =
    Date.now();

  const result =
    await getLiveSoccerEvents(
      env
    );

  const matches =
    result.events
      .filter(
        event =>
          isLiveEvent(
            event
          )
      )
      .map(
        buildLiveMatch
      );

  return json({
    success:
      result.meta.ok,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    action:
      "LIVE",

    read_only:
      true,

    performance: {
      elapsed_ms:
        Date.now() -
        started,

      cloudbet_events_fetch_ms:
        result.meta.elapsed_ms
    },

    request: {
      path:
        "/events?sport=soccer&live=true&players=false&limit=10000",

      requests_made:
        1,

      competition_requests_made:
        0
    },

    result: {
      events_received:
        result.events.length,

      live_events:
        matches.length,

      target_1h_over_05:
        matches.filter(
          match =>
            match.target_1h_over_05 !==
            null
        ).length,

      matches
    },

    error:
      result.meta.error ||
      null
  });
}

// ============================================================
// EVENT
// ============================================================

async function eventById(
  env: Env,
  id: string
): Promise<Response> {
  if (!id) {
    return json(
      {
        success: false,
        error:
          "MISSING_EVENT_ID"
      },
      400
    );
  }

  const path =
    `/events/${encodeURIComponent(
      id
    )}`;

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    parseJSON(
      result.text
    );

  return json({
    success:
      result.ok,

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
      requests_made:
        1,

      timeout_ms:
        CLOUDBET_TIMEOUT_MS
    },

    performance: {
      elapsed_ms:
        result.elapsed_ms,

      http_status:
        result.status
    },

    event:
      data,

    target_1h_over_05:
      data
        ? extractTargetOdds(
            data
          )
        : null,

    error:
      result.error ||
      null
  });
}

// ============================================================
// HEALTH
// ============================================================

function health(): Response {
  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    status:
      "OK",

    mode:
      "READ_ONLY",

    betting_enabled:
      false,

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

    endpoints: [
      "/",
      "/health",
      "/live",
      "/search",
      "/event?id=EVENT_ID",
      "/diagnostic-live-events",
      "/diagnostic-cloud0007",
      "/diagnostic-cloud0007-next"
    ],

    timestamp:
      nowISO()
  });
}

// ============================================================
// ROOT
// ============================================================

function root(): Response {
  return json({
    success: true,

    worker:
      "cloudbet-live-soccer-detector",

    version:
      VERSION,

    mode:
      "READ_ONLY",

    betting_enabled:
      false,

    purpose:
      "Cloudbet live soccer detection and exact 1H Total Goals OVER 0.5 diagnostics.",

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

    endpoints: {
      health:
        "/health",

      live:
        "/live",

      search:
        "/search",

      event:
        "/event?id=EVENT_ID",

      diagnostic_live_events:
        "/diagnostic-live-events",

      diagnostic_cloud0007:
        "/diagnostic-cloud0007",

      diagnostic_cloud0007_next:
        "/diagnostic-cloud0007-next"
    },

    timestamp:
      nowISO()
  });
}

// ============================================================
// OLD CLOUD0007 COMPACT DIAGNOSTIC
// ============================================================

function extractScriptSourcesCompact(
  html: string
): string[] {
  const output: string[] = [];

  const regex =
    /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(html)) !==
      null
  ) {
    output.push(
      match[1]
    );

    if (
      output.length >= 100
    ) {
      break;
    }
  }

  return output;
}

function extractPossibleUrlsCompact(
  html: string
): string[] {
  const set =
    new Set<string>();

  const regex =
    /https?:\/\/[^\s"'<>\\]+/gi;

  let match:
    RegExpExecArray | null;

  while (
    (match =
      regex.exec(html)) !==
      null
  ) {
    const url =
      match[0]
        .replace(
          /[),.;]+$/,
          ""
        );

    set.add(
      url
    );

    if (
      set.size >= 200
    ) {
      break;
    }
  }

  return Array.from(
    set
  );
}

function detectCloud0007Signals(
  html: string
): AnyObj {
  const lower =
    html.toLowerCase();

  return {
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
      lower.includes(
        "__next_data__"
      ),

    application_json:
      lower.includes(
        "application/json"
      ),

    websocket:
      lower.includes(
        "websocket"
      ),

    socket_io:
      lower.includes(
        "socket.io"
      ),

    graphql:
      lower.includes(
        "graphql"
      ),

    api:
      lower.includes(
        "/api/"
      )
  };
}

async function diagnosticCloud0007(): Promise<Response> {
  const result =
    await fetchCloud0007Page();

  if (!result.ok) {
    return json(
      {
        success: false,

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
            "https://www.cloud0007.com/en/sports/live?s=soccer",

          method:
            "GET",

          requests_made:
            1,

          timeout_ms:
            10000
        },

        performance: {
          elapsed_ms:
            result.elapsed_ms,

          http_status:
            result.status
        },

        error:
          result.error ||
          "FETCH_FAILED"
      },
      502
    );
  }

  const next =
    extractNextData(
      result.html
    );

  const titleMatch =
    result.html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
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
        "https://www.cloud0007.com/en/sports/live?s=soccer",

      method:
        "GET",

      requests_made:
        1,

      timeout_ms:
        10000
    },

    performance: {
      elapsed_ms:
        result.elapsed_ms,

      http_status:
        result.status,

      response_bytes:
        result.bytes,

      html_chars:
        result.html.length
    },

    page: {
      final_url:
        result.final_url,

      redirected:
        result.final_url !==
        "https://www.cloud0007.com/en/sports/live?s=soccer",

      title:
        titleMatch
          ? titleMatch[1].trim()
          : null,

      signals:
        detectCloud0007Signals(
          result.html
        )
    },

    embedded_data: {
      next_data_present:
        next.present,

      next_data_chars:
        next.chars,

      next_data_parseable:
        next.parseable,

      next_data_type:
        next.data === null
          ? "null"
          : Array.isArray(
              next.data
            )
            ? "array"
            : typeof next.data,

      next_data_keys:
        next.data &&
        typeof next.data ===
          "object"
          ? Object.keys(
              next.data
            )
          : [],

      application_json_script_count:
        (
          result.html.match(
            /<script[^>]+type=["']application\/json["'][^>]*>/gi
          ) || []
        ).length
    },

    scripts: {
      count:
        extractScriptSourcesCompact(
          result.html
        ).length,

      first_100:
        extractScriptSourcesCompact(
          result.html
        )
    },

    possible_urls: {
      count:
        extractPossibleUrlsCompact(
          result.html
        ).length,

      first_200:
        extractPossibleUrlsCompact(
          result.html
        )
    },

    html_analysis: {
      contains_event_word:
        result.html
          .toLowerCase()
          .includes(
            "event"
          ),

      contains_odds_word:
        result.html
          .toLowerCase()
          .includes(
            "odds"
          ),

      contains_live_word:
        result.html
          .toLowerCase()
          .includes(
            "live"
          ),

      contains_api_reference:
        result.html
          .toLowerCase()
          .includes(
            "/api/"
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
        "Use /diagnostic-cloud0007-next to inspect __NEXT_DATA__ for a concrete live data source."
    }
  });
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    try {
      const url =
        new URL(
          request.url
        );

      const pathname =
        url.pathname;

      if (
        pathname === "/" ||
        pathname === ""
      ) {
        return root();
      }

      if (
        pathname === "/health"
      ) {
        return health();
      }

      if (
        pathname === "/live"
      ) {
        return live(
          env
        );
      }

      if (
        pathname === "/search"
      ) {
        return searchSoccer(
          env
        );
      }

      if (
        pathname === "/diagnostic-live-events"
      ) {
        return diagnosticLiveEvents(
          env
        );
      }

      if (
        pathname === "/diagnostic-cloud0007"
      ) {
        return diagnosticCloud0007();
      }

      if (
        pathname ===
        "/diagnostic-cloud0007-next"
      ) {
        return diagnosticCloud0007Next();
      }

      if (
        pathname === "/event"
      ) {
        const id =
          url.searchParams.get(
            "id"
          ) || "";

        return eventById(
          env,
          id
        );
      }

      return json(
        {
          success: false,

          error:
            "NOT_FOUND",

          path:
            pathname,

          available_endpoints: [
            "/",
            "/health",
            "/live",
            "/search",
            "/event?id=EVENT_ID",
            "/diagnostic-live-events",
            "/diagnostic-cloud0007",
            "/diagnostic-cloud0007-next"
          ]
        },
        404
      );
    } catch (error: any) {
      return json(
        {
          success: false,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          error:
            String(
              error?.message ||
              error
            )
        },
        500
      );
    }
  }
};
