function json(data: unknown, status = 200): Response {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json; charset=UTF-8",
        "cache-control": "no-store"
      }
    }
  );
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {
      _invalid_json: true,
      raw: text.slice(0, 5000)
    };
  }
}

export default {
  async fetch(
    request: Request,
    env: any
  ): Promise<Response> {

    const url = new URL(request.url);
    const path =
      url.pathname.replace(/\/+$/, "") || "/";

    try {

      if (path === "/" || path === "/health") {

        return json({
          success: true,
          worker: "cloudbet-match-matcher",
          bindings: {
            V27: !!env.V27,
            CLOUDBET: !!env.CLOUDBET
          }
        });

      }

      if (path === "/debug-cloudbet") {

        const response =
          await env.CLOUDBET.fetch(
            new Request(
              "https://cloudbet.internal/live"
            )
          );

        const data =
          await readJson(response);

        const liveEvents =
          Array.isArray(data?.live_events)
            ? data.live_events
            : [];

        const first =
          liveEvents.length > 0
            ? liveEvents[0]
            : null;

        const markets =
          first?.markets &&
          typeof first.markets === "object"
            ? first.markets
            : {};

        const totalGoals =
          markets?.["soccer.total_goals_period_first_half"] ||
          null;

        const submarkets =
          totalGoals?.submarkets &&
          typeof totalGoals.submarkets === "object"
            ? totalGoals.submarkets
            : {};

        const firstHalf =
          submarkets?.["period=ft"] ||
          submarkets?.["period=first_half"] ||
          submarkets?.["period=1h"] ||
          null;

        return json({

          success: true,

          cloudbet_http_status:
            response.status,

          cloudbet_response_keys:
            Object.keys(data || {}),

          live_events_count:
            liveEvents.length,

          first_event: first,

          first_event_market_keys:
            Object.keys(markets),

          target_market:
            totalGoals,

          target_submarket_keys:
            Object.keys(submarkets),

          possible_first_half:
            firstHalf,

          timestamp:
            new Date().toISOString()

        });

      }

      return json({
        success: false,
        error: "Unknown endpoint",
        available_endpoints: [
          "/",
          "/health",
          "/debug-cloudbet"
        ]
      }, 404);

    } catch (error) {

      return json({
        success: false,
        worker: "cloudbet-match-matcher",
        error:
          error instanceof Error
            ? error.message
            : String(error),
        timestamp:
          new Date().toISOString()
      }, 500);

    }

  }
};
