// ============================================================
// AI MATCHER — V0.1
// WORKERS AI CONNECTION TEST
// READ ONLY
// NO BETTING
// ============================================================

interface Env {
  AI: Ai;
}

const VERSION = "AI-MATCHER-V0.1-TEST";

const MODEL =
  "@cf/google/gemma-4-26b-a4b-it";


function json(
  data: any,
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
          "application/json; charset=UTF-8",
        "access-control-allow-origin":
          "*"
      }
    }
  );
}


export default {

  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    const url =
      new URL(
        request.url
      );


    // ========================================================
    // STATUS
    // ========================================================

    if (
      url.pathname === "/"
    ) {

      return json({
        success: true,

        worker:
          "ai-matcher",

        version:
          VERSION,

        mode:
          "READ_ONLY",

        betting:
          "DISABLED",

        ai_binding:
          Boolean(
            env.AI
          ),

        model:
          MODEL,

        endpoints: {
          status:
            "/",

          test:
            "/test"
        }
      });
    }


    // ========================================================
    // AI TEST
    // ========================================================

    if (
      url.pathname === "/test"
    ) {

      if (
        !env.AI
      ) {

        return json(
          {
            success: false,

            error:
              "AI_BINDING_MISSING"
          },
          500
        );
      }


      try {

        const started =
          Date.now();


        const result: any =
          await env.AI.run(
            MODEL,
            {
              messages: [
                {
                  role:
                    "system",

                  content:
                    [
                      "You are a football match identity matcher.",
                      "Your only task is to decide whether two football fixture names refer to the same clubs.",
                      "Do not discuss betting.",
                      "Answer very briefly."
                    ].join(" ")
                },

                {
                  role:
                    "user",

                  content:
                    [
                      "Hunter fixture:",
                      "Levski Sofia - CSKA Sofia",
                      "",
                      "Cloudbet fixture:",
                      "Levski 1914 - CSKA Sofia",
                      "",
                      "Are these the same football fixture?",
                      "Answer YES or NO and give one short reason."
                    ].join("\n")
                }
              ],

              chat_template_kwargs: {
                enable_thinking:
                  false
              }
            }
          );


        const processingMs =
          Date.now() -
          started;


        return json({
          success: true,

          worker:
            "ai-matcher",

          version:
            VERSION,

          mode:
            "READ_ONLY",

          betting:
            "DISABLED",

          test: {
            hunter:
              "Levski Sofia - CSKA Sofia",

            cloudbet:
              "Levski 1914 - CSKA Sofia"
          },

          model:
            MODEL,

          processing_ms:
            processingMs,

          ai_response:
            result
        });

      } catch (
        error: any
      ) {

        return json(
          {
            success: false,

            worker:
              "ai-matcher",

            version:
              VERSION,

            error:
              "AI_REQUEST_FAILED",

            message:
              String(
                error?.message ??
                error
              )
          },
          500
        );
      }
    }


    return json(
      {
        success: false,

        error:
          "NOT_FOUND"
      },
      404
    );
  }

} satisfies ExportedHandler<Env>;
