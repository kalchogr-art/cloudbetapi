// ============================================================
// CLOUDBET LIVE SOCCER DETECTOR V5.9.0 — FAST LIVE
//
// PURPOSE:
// - fast /live for matcher
// - ONE official Cloudbet request
// - NO market scanning in /live
// - compact event objects only
// - /event uses direct event endpoint
// - /line-test keeps exact 1H O0.5 read-only lookup
//
// READ ONLY — NO BET PLACEMENT
// ============================================================

interface Env {
  CLOUDBET_API_KEY?: string;
}

type AnyObj = Record<string, any>;

const VERSION = "V5.9.0 FAST LIVE";
const API_BASE = "https://sports-api.cloudbet.com/pub/v2/odds";
const TIMEOUT_MS = 8000;

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_MARKET_URL =
  "soccer.total_goals_period_first_half/over?total=0.5";


// ============================================================
// RESPONSE
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(
    JSON.stringify(data, null, 2),
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
// FETCH
// ============================================================

async function cloudbetFetch(
  env: Env,
  path: string,
  init: RequestInit = {}
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
      () =>
        controller.abort(),
      TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        API_BASE + path,
        {
          ...init,

          headers: {
            "accept":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              "",

            ...(init.headers || {})
          },

          signal:
            controller.signal
        }
      );

    return {
      response,
      elapsedMs:
        Date.now() -
        started
    };

  } finally {

    clearTimeout(
      timer
    );
  }
}


async function readJson(
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
    throw new Error(
      "INVALID_CLOUDBET_JSON"
    );
  }
}


// ============================================================
// EVENTS
// ============================================================

function extractEvents(
  data: any
): AnyObj[] {

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
        !Array.isArray(
          competition?.events
        )
      ) {
        continue;
      }

      for (
        const event
        of competition.events
      ) {

        if (
          !event ||
          typeof event !==
            "object"
        ) {
          continue;
        }

        result.push({
          ...event,

          competition:
            event.competition ??
            {
              name:
                competition?.name ??
                null,

              key:
                competition?.key ??
                null,

              category:
                competition?.category ??
                null
            }
        });
      }
    }

    return result;
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
      data
    )
  ) {
    return data;
  }

  return [];
}


function isLive(
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
// COMPACT EVENT
// IMPORTANT: /live deliberately does NOT inspect event.markets.
// ============================================================

function compactEvent(
  event: AnyObj
): AnyObj {

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
      event?.competition
        ? {
            name:
              event.competition
                ?.name ??
              null,

            key:
              event.competition
                ?.key ??
              null,

            category:
              event.competition
                ?.category ??
              null
          }
        : null
  };
}


// ============================================================
// FAST LIVE
// ============================================================

async function getFastLive(
  env: Env
): Promise<AnyObj> {

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

    const body =
      await result.response
        .text();

    throw new Error(
      "CLOUDBET_HTTP_" +
      result.response.status +
      ": " +
      body.slice(
        0,
        300
      )
    );
  }

  const data =
    await readJson(
      result.response
    );

  const events =
    extractEvents(
      data
    );

  const live:
    AnyObj[] = [];

  for (
    const event
    of events
  ) {

    if (
      isLive(
        event
      )
    ) {

      live.push(
        compactEvent(
          event
        )
      );
    }
  }

  return {
    request: {
      path,
      requests_made:
        1,
      elapsed_ms:
        result.elapsedMs,
      http_status:
        result.response.status
    },

    events_received:
      events.length,

    events_recognized_live:
      live.length,

    events:
      live
  };
}


// ============================================================
// SEARCH
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

  return events.filter(
    event => {

      const home =
        normalize(
          event?.home
        );

      const away =
        normalize(
          event?.away
        );

      return (
        home.includes(q) ||
        away.includes(q) ||
        `${home} ${away}`
          .includes(q)
      );
    }
  );
}


// ============================================================
// DIRECT EVENT
// ============================================================

async function getEventDirect(
  env: Env,
  id: string
): Promise<AnyObj> {

  const eventId =
    String(id)
      .trim();

  const path =
    "/events/" +
    encodeURIComponent(
      eventId
    );

  const result =
    await cloudbetFetch(
      env,
      path
    );

  const data =
    await readJson(
      result.response
    );

  const event =
    data?.event &&
    typeof data.event ===
      "object"
      ? data.event
      : data &&
        typeof data ===
          "object" &&
        !Array.isArray(
          data
        )
      ? data
      : null;

  return {
    request: {
      path,
      requested_event_id:
        eventId,
      http_status:
        result.response.status,
      ok:
        result.response.ok,
      elapsed_ms:
        result.elapsedMs
    },

    found:
      result.response.ok &&
      !!event,

    event
  };
}


// ============================================================
// EXACT TARGET SELECTION
// Supports legacy exact market and generic total_goals period=1h.
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


function inspectSelections(
  marketKey: string,
  market: AnyObj,
  require1h: boolean
): AnyObj | null {

  const submarkets =
    market?.submarkets;

  if (
    !submarkets ||
    typeof submarkets !==
      "object"
  ) {
    return null;
  }

  for (
    const [
      submarketKey,
      submarket
    ]
    of Object.entries(
      submarkets
    )
  ) {

    if (
      require1h &&
      !String(
        submarketKey
      )
        .toLowerCase()
        .includes(
          "period=1h"
        )
    ) {
      continue;
    }

    const selections =
      Array.isArray(
        (submarket as AnyObj)
          ?.selections
      )
        ? (submarket as AnyObj)
            .selections
        : [];

    for (
      const selection
      of selections
    ) {

      if (
        String(
          selection?.outcome ??
          ""
        )
          .toLowerCase() !==
        "over"
      ) {
        continue;
      }

      const params =
        String(
          selection?.params ??
          ""
        )
          .toLowerCase();

      if (
        !params.includes(
          "total=0.5"
        )
      ) {
        continue;
      }

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

      const enabled =
        !status ||
        [
          "SELECTION_ENABLED",
          "OPEN",
          "TRADING",
          "ACTIVE"
        ].includes(
          status
        );

      return {
        market:
          marketKey,

        submarket:
          submarketKey,

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

        enabled:
          enabled &&
          price !== null &&
          price > 1 &&
          (
            maxStake === null ||
            maxStake > 0
          ),

        target:
          true
      };
    }
  }

  return null;
}


function findExactTarget(
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

  // 1) Legacy exact market.
  const legacy =
    markets[
      "soccer.total_goals_period_first_half"
    ];

  if (
    legacy &&
    typeof legacy ===
      "object"
  ) {

    const found =
      inspectSelections(
        "soccer.total_goals_period_first_half",
        legacy,
        false
      );

    if (found) {
      return found;
    }
  }

  // 2) Generic market with explicit 1H submarket.
  const generic =
    markets[
      "soccer.total_goals"
    ];

  if (
    generic &&
    typeof generic ===
      "object"
  ) {

    const found =
      inspectSelections(
        "soccer.total_goals",
        generic,
        true
      );

    if (found) {
      return found;
    }
  }

  return null;
}


// ============================================================
// LINE TEST
// ============================================================

async function lineTest(
  env: Env,
  eventId: string
): Promise<AnyObj> {

  const started =
    Date.now();

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS
    );

  try {

    const response =
      await fetch(
        API_BASE +
        "/lines",
        {
          method:
            "POST",

          headers: {
            "accept":
              "application/json",

            "content-type":
              "application/json",

            "x-api-key":
              env.CLOUDBET_API_KEY ||
              ""
          },

          body:
            JSON.stringify({
              eventId:
                String(
                  eventId
                ),

              marketUrl:
                TARGET_MARKET_URL
            }),

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let data:
      any = null;

    try {
      data =
        text
          ? JSON.parse(
              text
            )
          : null;
    } catch {
      data =
        null;
    }

    return {
      success:
        response.ok,

      response: {
        status:
          response.status,

        elapsed_ms:
          Date.now() -
          started
      },

      data,

      raw:
        data === null
          ? text.slice(
              0,
              2000
            )
          : null
    };

  } finally {

    clearTimeout(
      timer
    );
  }
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

    const path =
      url.pathname;

    if (
      path ===
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

        fast_live:
          true,

        endpoints: [
          "/live",
          "/search?q=TEAM",
          "/event?id=EVENT_ID",
          "/event-direct?id=EVENT_ID",
          "/line-test?id=EVENT_ID"
        ]
      });
    }


    // ========================================================
    // FAST /live
    // ========================================================

    if (
      path ===
      "/live"
    ) {

      const started =
        Date.now();

      try {

        const result =
          await getFastLive(
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

          fast_mode:
            true,

          market_scan:
            false,

          ...result,

          performance: {
            total_elapsed_ms:
              Date.now() -
              started
          }
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "LIVE",

            fast_mode:
              true,

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  ),

            performance: {
              total_elapsed_ms:
                Date.now() -
                started
            }
          },
          500
        );
      }
    }


    // ========================================================
    // SEARCH — reuses same compact fast feed
    // ========================================================

    if (
      path ===
      "/search"
    ) {

      const q =
        url.searchParams
          .get(
            "q"
          ) ??
        "";

      try {

        const live =
          await getFastLive(
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
            "SEARCH",

          query:
            q,

          events_received:
            live
              .events_received,

          events_recognized_live:
            live
              .events_recognized_live,

          results:
            searchEvents(
              live.events,
              q
            )
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "SEARCH",

            query:
              q,

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  )
          },
          500
        );
      }
    }


    // ========================================================
    // EVENT — now DIRECT instead of downloading all live events
    // ========================================================

    if (
      path ===
        "/event" ||
      path ===
        "/event-direct"
    ) {

      const id =
        url.searchParams
          .get(
            "id"
          );

      if (!id) {
        return json(
          {
            success:
              false,

            error:
              "Missing id"
          },
          400
        );
      }

      try {

        const result =
          await getEventDirect(
            env,
            id
          );

        const target =
          result.event
            ? findExactTarget(
                result.event
              )
            : null;

        return json({
          success:
            result.found,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            path ===
              "/event"
              ? "EVENT"
              : "EVENT_DIRECT",

          read_only:
            true,

          betting:
            false,

          ...result,

          target,

          target_available:
            !!target
        });

      } catch (
        error
      ) {

        return json(
          {
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
                : String(
                    error
                  )
          },
          500
        );
      }
    }


    // ========================================================
    // LINE TEST
    // ========================================================

    if (
      path ===
      "/line-test"
    ) {

      const id =
        url.searchParams
          .get(
            "id"
          );

      if (!id) {
        return json(
          {
            success:
              false,

            error:
              "Missing id"
          },
          400
        );
      }

      try {

        const result =
          await lineTest(
            env,
            id
          );

        return json({
          success:
            result.success,

          worker:
            "cloudbet-live-soccer-detector",

          version:
            VERSION,

          action:
            "LINE_TEST",

          read_only:
            true,

          betting:
            false,

          target: {
            event_id:
              id,

            market:
              TARGET_MARKET,

            outcome:
              "over",

            params:
              "total=0.5",

            marketUrl:
              TARGET_MARKET_URL
          },

          line:
            result
        });

      } catch (
        error
      ) {

        return json(
          {
            success:
              false,

            worker:
              "cloudbet-live-soccer-detector",

            version:
              VERSION,

            action:
              "LINE_TEST",

            error:
              error instanceof Error
                ? error.message
                : String(
                    error
                  )
          },
          500
        );
      }
    }


    return json(
      {
        success:
          false,

        worker:
          "cloudbet-live-soccer-detector",

        version:
          VERSION,

        error:
          "NOT_FOUND"
      },
      404
    );
  }
};
