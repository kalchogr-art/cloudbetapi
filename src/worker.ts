export default {
  async fetch(
    request: Request,
    env: any
  ): Promise<Response> {

    const result: any = {
      success: true,
      worker: "cloudbet-match-matcher",
      bindings: {}
    };

    // ==========================================================
    // TEST V27
    // ==========================================================

    try {

      const response =
        await env.V27.fetch(
          new Request(
            "https://v27.internal/"
          )
        );

      const text =
        await response.text();

      result.bindings.V27 = {
        success: response.ok,
        status: response.status,
        response_length: text.length,
        response_preview:
          text.slice(0, 500)
      };

    } catch (error) {

      result.bindings.V27 = {
        success: false,
        error:
          error?.message ||
          String(error)
      };

    }


    // ==========================================================
    // TEST CLOUDBET
    // ==========================================================

    try {

      const response =
        await env.CLOUDBET.fetch(
          new Request(
            "https://cloudbet.internal/live"
          )
        );

      const text =
        await response.text();

      result.bindings.CLOUDBET = {
        success: response.ok,
        status: response.status,
        response_length: text.length,
        response_preview:
          text.slice(0, 500)
      };

    } catch (error) {

      result.bindings.CLOUDBET = {
        success: false,
        error:
          error?.message ||
          String(error)
      };

    }


    return new Response(
      JSON.stringify(
        result,
        null,
        2
      ),
      {
        status: 200,
        headers: {
          "content-type":
            "application/json; charset=UTF-8",
          "cache-control":
            "no-store"
        }
      }
    );

  }
};
