// ============================================================
// CLOUDBET MATCH MATCHER — CLOUDBET RAW DEBUG
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

  const text =
    await response.text();

  try {

    return text
      ? JSON.parse(text)
      : {};

  } catch {

    return {
      invalid_json: true,
      raw: text.slice(0, 10000)
    };

  }
}


// ============================================================
// ROUTER
// ============================================================

export default {

  async fetch(
    request: Request,
    env: any
  ): Promise<Response> {

    const url =
      new URL(request.url);

    const path =
      url.pathname.replace(
        /\/+$/,
        ""
      ) || "/";


    try {

      // ======================================================
      // HEALTH
      // ======================================================

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


      // ======================================================
      // CLOUDBET RAW
      // ======================================================

      if (
        path === "/cloudbet-raw"
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


        return json({

          success: true,

          endpoint:
            "cloudbet-raw",

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

          matching_events:
            data?.matching_events ??
            null,

          matches_count:
            matches.length,

          // Показваме целия response
          // за да видим реалната структура.
          cloudbet_response:
            data,

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // 404
      // ======================================================

      return json({

        success: false,

        error:
          "Unknown endpoint",

        available_endpoints: [

          "/",

          "/health",

          "/cloudbet-raw"

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
