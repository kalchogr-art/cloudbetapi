// ============================================================
// CLOUDBET MATCH MATCHER — DEBUG
// ============================================================

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
      invalid_json: true,
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

      // ========================================================
      // HEALTH
      // ========================================================

      if (
        path === "/" ||
        path === "/health"
      ) {

        return json({

          success: true,

          worker:
            "cloudbet-match-matcher",

          bindings: {

            V27:
              !!env.V27,

            CLOUDBET:
              !!env.CLOUDBET

          },

          timestamp:
            new Date().toISOString()

        });

      }


      // ========================================================
      // DEBUG CLOUDBET
      // ========================================================

      if (
        path === "/debug-cloudbet"
      ) {

        const response =
          await env.CLOUDBET.fetch(
            new Request(
              "https://cloudbet.internal/live"
            )
          );


        const data =
          await readJson(
            response
          );


        const matches =
          Array.isArray(
            data?.matches
          )
            ? data.matches
            : [];


        const liveEvents =
          Array.isArray(
            data?.live_events
          )
            ? data.live_events
            : [];


        return json({

          success: true,

          cloudbet_http_status:
            response.status,

          response_keys:
            Object.keys(
              data || {}
            ),

          filter:
            data?.filter ||
            null,

          catalogue:
            data?.catalogue ||
            null,

          total_events:
            data?.total_events ??
            null,

          live_events:
            data?.live_events ??
            null,

          live_events_array_length:
            liveEvents.length,

          matching_events:
            data?.matching_events ??
            null,

          matches_array_length:
            matches.length,

          first_match:
            matches[0] ||
            null,

          second_match:
            matches[1] ||
            null,

          first_live_event:
            liveEvents[0] ||
            null,

          errors:
            data?.errors ||
            [],

          timestamp:
            new Date().toISOString()

        });

      }


      // ========================================================
      // DEBUG V27
      // ========================================================

      if (
        path === "/debug-v27"
      ) {

        const response =
          await env.V27.fetch(
            new Request(
              "https://v27.internal/"
            )
          );


        const data =
          await readJson(
            response
          );


        const matches =
          Array.isArray(
            data?.matches
          )
            ? data.matches
            : [];


        const liveMatches =
          Array.isArray(
            data?.live_matches
          )
            ? data.live_matches
            : [];


        return json({

          success: true,

          v27_http_status:
            response.status,

          response_keys:
            Object.keys(
              data || {}
            ),

          matches_array_length:
            matches.length,

          live_matches_array_length:
            liveMatches.length,

          first_match:
            matches[0] ||
            liveMatches[0] ||
            null,

          timestamp:
            new Date().toISOString()

        });

      }


      return json({

        success: false,

        error:
          "Unknown endpoint",

        available_endpoints: [

          "/",

          "/health",

          "/debug-cloudbet",

          "/debug-v27"

        ]

      }, 404);


    } catch (error) {

      return json({

        success: false,

        worker:
          "cloudbet-match-matcher",

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
