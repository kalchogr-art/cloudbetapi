// ============================================================
// CLOUDBET MATCH MATCHER — RAW DIAGNOSTIC
//
// PURPOSE:
// Show EXACTLY what Cloudbet /live returns.
//
// V27 = Flashscore source
// CLOUDBET = Cloudbet source
//
// IMPORTANT:
// - NO HT OVER 0.5 FILTER
// - NO MATCHING
// - NO BETTING
// - READ ONLY
//
// This version is ONLY to discover the real Cloudbet
// response structure.
// ============================================================


// ============================================================
// JSON
// ============================================================

function json(
  data: unknown,
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

        "cache-control":
          "no-store"
      }
    }
  );

}


// ============================================================
// READ RESPONSE
// ============================================================

async function readResponse(
  response: Response
) {

  const text =
    await response.text();

  let data: any = null;

  try {

    data =
      text
        ? JSON.parse(text)
        : null;

  } catch {

    data = null;

  }

  return {

    status:
      response.status,

    ok:
      response.ok,

    content_type:
      response.headers.get(
        "content-type"
      ),

    length:
      text.length,

    data,

    raw:
      text

  };

}


// ============================================================
// V27
// ============================================================

async function getV27(
  env: any
) {

  if (
    !env?.V27
  ) {

    throw new Error(
      "V27 binding missing"
    );

  }

  const response =
    await env.V27.fetch(
      new Request(
        "https://v27.internal/"
      )
    );

  return await readResponse(
    response
  );

}


// ============================================================
// CLOUDBET
// ============================================================

async function getCloudbet(
  env: any
) {

  if (
    !env?.CLOUDBET
  ) {

    throw new Error(
      "CLOUDBET binding missing"
    );

  }

  const response =
    await env.CLOUDBET.fetch(
      new Request(
        "https://cloudbet.internal/live"
      )
    );

  return await readResponse(
    response
  );

}


// ============================================================
// GET V27 MATCHES
// ============================================================

function getV27Matches(
  data: any
): any[] {

  const candidates = [

    data?.matches,

    data?.live_matches,

    data?.feed?.matches,

    data?.feed?.live_matches,

    data?.data?.matches,

    data?.data?.live_matches

  ];

  for (
    const value of candidates
  ) {

    if (
      Array.isArray(value)
    ) {

      return value;

    }

  }

  return [];

}


// ============================================================
// PREVIEW V27
// ============================================================

function previewV27(
  data: any
) {

  const matches =
    getV27Matches(
      data
    );

  return matches
    .slice(
      0,
      20
    )
    .map(
      (match: any) => {

        return {

          id:
            match?.id ??
            match?.match_id ??
            null,

          match:
            match?.match ??
            match?.name ??
            match?.event_name ??
            match?.eventName ??
            null,

          home:
            match?.home ??
            null,

          away:
            match?.away ??
            null,

          minute:
            match?.minute ??
            match?.match_minute ??
            match?.elapsed ??
            match?.time ??
            null,

          score:
            match?.score ??
            match?.scores ??
            match?.result ??
            null

        };

      }
    );

}


// ============================================================
// DISCOVER OBJECT STRUCTURE
// ============================================================

function inspectStructure(
  value: any,
  path = "root",
  depth = 0,
  output: any[] = []
): any[] {

  if (
    depth > 4
  ) {

    return output;

  }

  if (
    value === null ||
    value === undefined
  ) {

    output.push({

      path,

      type:
        value === null
          ? "null"
          : "undefined"

    });

    return output;

  }

  if (
    Array.isArray(value)
  ) {

    output.push({

      path,

      type:
        "array",

      length:
        value.length

    });

    if (
      value.length > 0
    ) {

      inspectStructure(
        value[0],
        `${path}[0]`,
        depth + 1,
        output
      );

    }

    return output;

  }

  if (
    typeof value === "object"
  ) {

    const keys =
      Object.keys(
        value
      );

    output.push({

      path,

      type:
        "object",

      keys:
        keys.slice(
          0,
          100
        )

    });

    for (
      const key of keys.slice(
        0,
        100
      )
    ) {

      inspectStructure(
        value[key],
        `${path}.${key}`,
        depth + 1,
        output
      );

    }

    return output;

  }

  output.push({

    path,

    type:
      typeof value

  });

  return output;

}


// ============================================================
// RAW DIAGNOSTIC
// ============================================================

async function diagnostic(
  env: any
) {

  const [
    v27,
    cloudbet
  ] =
    await Promise.all([

      getV27(
        env
      ),

      getCloudbet(
        env
      )

    ]);


  const v27Data =
    v27.data;

  const cloudbetData =
    cloudbet.data;


  const v27Matches =
    getV27Matches(
      v27Data
    );


  // ----------------------------------------------------------
  // RAW CLOUDBET RESPONSE
  // ----------------------------------------------------------

  let cloudbetRaw =
    cloudbet.raw;


  if (
    cloudbetRaw.length >
    30000
  ) {

    cloudbetRaw =
      cloudbetRaw.slice(
        0,
        30000
      );

  }


  // ----------------------------------------------------------
  // CLOUD BET STRUCTURE
  // ----------------------------------------------------------

  const cloudbetStructure =
    inspectStructure(
      cloudbetData
    );


  // ----------------------------------------------------------
  // RESULT
  // ----------------------------------------------------------

  return {

    success:
      true,

    test_mode:
      "RAW CLOUDBET DATA — NO FILTER — NO MATCHING",

    worker:
      "cloudbet-match-matcher",

    mode:
      "READ ONLY",

    source: {

      flashscore:
        "V27",

      cloudbet:
        "Cloudbet"

    },

    stats: {

      v27_http_status:
        v27.status,

      cloudbet_http_status:
        cloudbet.status,

      cloudbet_ok:
        cloudbet.ok,

      cloudbet_content_type:
        cloudbet.content_type,

      cloudbet_response_length:
        cloudbet.length,

      v27_matches:
        v27Matches.length

    },

    // ========================================================
    // THIS IS THE IMPORTANT PART
    // ========================================================

    cloudbet_raw_response:
      cloudbetRaw,

    // ========================================================
    // PARSED CLOUDBET JSON
    // ========================================================

    cloudbet_parsed:
      cloudbetData,

    // ========================================================
    // AUTOMATIC STRUCTURE INSPECTION
    // ========================================================

    cloudbet_structure:
      cloudbetStructure,

    // ========================================================
    // V27 PREVIEW
    // ========================================================

    v27_preview:
      previewV27(
        v27Data
      ),

    timestamp:
      new Date().toISOString()

  };

}


// ============================================================
// ROUTER
// ============================================================

export default {

  async fetch(
    request: Request,
    env: any
  ) {

    const url =
      new URL(
        request.url
      );


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

          success:
            true,

          worker:
            "cloudbet-match-matcher",

          mode:
            "RAW DIAGNOSTIC",

          description:
            "Shows raw Cloudbet /live response. No filters and no matching.",

          bindings: {

            V27:
              !!env?.V27,

            CLOUDBET:
              !!env?.CLOUDBET

          },

          endpoints: [

            "/",

            "/health",

            "/diagnostic"

          ],

          timestamp:
            new Date().toISOString()

        });

      }


      // ======================================================
      // RAW DIAGNOSTIC
      // ======================================================

      if (
        path ===
        "/diagnostic"
      ) {

        return json(
          await diagnostic(
            env
          )
        );

      }


      // ======================================================
      // UNKNOWN
      // ======================================================

      return json({

        success:
          false,

        error:
          "Unknown endpoint",

        available_endpoints: [

          "/",

          "/health",

          "/diagnostic"

        ]

      }, 404);


    } catch (
      error
    ) {

      return json({

        success:
          false,

        worker:
          "cloudbet-match-matcher",

        mode:
          "RAW DIAGNOSTIC",

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
