// ============================================================
// CLOUDBET MATCH MATCHER — DIAGNOSTIC V3
//
// V27 = Flashscore source
// CLOUDBET = Cloudbet HT OVER 0.5 source
//
// IMPORTANT:
// Flashscore ID != Cloudbet ID
// Matching is done by team names.
//
// V3 FIX:
// V27 sometimes returns only:
//   match: "HOME - AWAY"
// instead of separate home / away fields.
//
// This version extracts teams from match text automatically.
//
// READ ONLY.
// NO BETTING.
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
// READ JSON
// ============================================================

async function readJson(
  response: Response
): Promise<any> {

  const text =
    await response.text();

  try {

    return text
      ? JSON.parse(text)
      : {};

  } catch {

    return {
      invalid_json: true,
      raw: text.slice(
        0,
        10000
      )
    };

  }

}


// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeName(
  value: unknown
): string {

  if (
    value === null ||
    value === undefined
  ) {

    return "";

  }

  return String(value)

    .toLowerCase()

    .normalize("NFD")

    .replace(
      /[\u0300-\u036f]/g,
      ""
    )

    .replace(
      /&/g,
      " and "
    )

    .replace(
      /['’`]/g,
      ""
    )

    .replace(
      /[().,:;!?]/g,
      " "
    )

    .replace(
      /[-_/]/g,
      " "
    )

    .replace(
      /\s+/g,
      " "
    )

    .trim();

}


// ============================================================
// TEAM ALIASES
// ============================================================

const TEAM_ALIASES: Record<
  string,
  string
> = {

  // Manchester
  "man utd":
    "manchester united",

  "man united":
    "manchester united",

  "man u":
    "manchester united",

  "manchester utd":
    "manchester united",

  "manchester united fc":
    "manchester united",

  "man city":
    "manchester city",

  "manchester city fc":
    "manchester city",

  // England
  "spurs":
    "tottenham",

  "tottenham hotspur":
    "tottenham",

  "tottenham hotspur fc":
    "tottenham",

  "wolves":
    "wolverhampton",

  "wolverhampton wanderers":
    "wolverhampton",

  "west ham united":
    "west ham",

  "newcastle united":
    "newcastle",

  "brighton and hove albion":
    "brighton",

  "brighton hove albion":
    "brighton",

  // Italy
  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "internazionale milano":
    "inter milan",

  "ac milan":
    "milan",

  // France
  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  "paris saint germain fc":
    "paris saint germain",

  // Spain
  "ath madrid":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid",

  "atletico madrid cf":
    "atletico madrid",

  // Germany
  "bayern munich":
    "bayern munich",

  "fc bayern munich":
    "bayern munich",

  // Portugal
  "sporting lisbon":
    "sporting cp",

  "sporting cp":
    "sporting cp"

};


// ============================================================
// NORMALIZE TEAM
// ============================================================

function normalizeTeam(
  value: unknown
): string {

  const name =
    normalizeName(
      value
    );

  if (!name) {

    return "";

  }

  return (
    TEAM_ALIASES[name] ||
    name
  );

}


// ============================================================
// GET TEAM NAME
// ============================================================

function getTeamName(
  value: unknown
): string {

  if (
    typeof value === "string"
  ) {

    return value.trim();

  }

  if (
    value &&
    typeof value === "object"
  ) {

    const obj =
      value as Record<
        string,
        unknown
      >;

    return String(
      obj.name ||
      obj.key ||
      obj.abbreviation ||
      ""
    ).trim();

  }

  return "";

}


// ============================================================
// EXTRACT TEAMS FROM MATCH TEXT
// ============================================================

function extractTeamsFromMatch(
  value: unknown
): {
  home: string;
  away: string;
} {

  if (
    value === null ||
    value === undefined
  ) {

    return {
      home: "",
      away: ""
    };

  }

  const text =
    String(value)
      .trim();

  if (!text) {

    return {
      home: "",
      away: ""
    };

  }


  // ----------------------------------------------------------
  // "HOME - AWAY"
  // ----------------------------------------------------------

  let match =
    text.match(
      /^(.+?)\s+-\s+(.+)$/
    );

  if (match) {

    return {
      home: match[1].trim(),
      away: match[2].trim()
    };

  }


  // ----------------------------------------------------------
  // "HOME v AWAY"
  // ----------------------------------------------------------

  match =
    text.match(
      /^(.+?)\s+v\s+(.+)$/i
    );

  if (match) {

    return {
      home: match[1].trim(),
      away: match[2].trim()
    };

  }


  // ----------------------------------------------------------
  // "HOME vs AWAY"
  // ----------------------------------------------------------

  match =
    text.match(
      /^(.+?)\s+vs\.?\s+(.+)$/i
    );

  if (match) {

    return {
      home: match[1].trim(),
      away: match[2].trim()
    };

  }


  // ----------------------------------------------------------
  // "HOME @ AWAY"
  // ----------------------------------------------------------

  match =
    text.match(
      /^(.+?)\s+@\s+(.+)$/
    );

  if (match) {

    return {
      home: match[2].trim(),
      away: match[1].trim()
    };

  }


  return {
    home: "",
    away: ""
  };

}


// ============================================================
// RESOLVE MATCH TEAMS
// ============================================================

function resolveTeams(
  match: any
): {
  home: string;
  away: string;
  source: string;
} {

  const directHome =
    getTeamName(
      match?.home
    );

  const directAway =
    getTeamName(
      match?.away
    );

  if (
    directHome &&
    directAway
  ) {

    return {
      home: directHome,
      away: directAway,
      source: "fields"
    };

  }


  const text =
    match?.match ||
    match?.name ||
    match?.event_name ||
    match?.eventName ||
    "";

  const extracted =
    extractTeamsFromMatch(
      text
    );

  if (
    extracted.home &&
    extracted.away
  ) {

    return {
      home:
        extracted.home,

      away:
        extracted.away,

      source:
        "match_text"
    };

  }


  return {
    home:
      directHome,

    away:
      directAway,

    source:
      "partial"
  };

}


// ============================================================
// MATCH KEY
// ============================================================

function makeMatchKey(
  home: unknown,
  away: unknown
): string {

  const h =
    normalizeTeam(
      home
    );

  const a =
    normalizeTeam(
      away
    );

  if (
    !h ||
    !a
  ) {

    return "";

  }

  return `${h}|${a}`;

}


// ============================================================
// WORDS
// ============================================================

function words(
  value: string
): string[] {

  return value
    .split(" ")
    .map(
      x =>
        x.trim()
    )
    .filter(Boolean);

}


// ============================================================
// WORD OVERLAP
// ============================================================

function wordOverlap(
  a: string,
  b: string
): number {

  const wa =
    new Set(
      words(
        normalizeTeam(a)
      )
    );

  const wb =
    new Set(
      words(
        normalizeTeam(b)
      )
    );

  if (
    wa.size === 0 ||
    wb.size === 0
  ) {

    return 0;

  }

  let common = 0;

  for (
    const word of wa
  ) {

    if (
      wb.has(word)
    ) {

      common++;

    }

  }

  return (
    common /
    Math.max(
      wa.size,
      wb.size
    )
  );

}


// ============================================================
// TEAM SIMILARITY
// ============================================================

function teamSimilarity(
  a: string,
  b: string
): number {

  const na =
    normalizeTeam(a);

  const nb =
    normalizeTeam(b);

  if (
    !na ||
    !nb
  ) {

    return 0;

  }


  // Exact normalized name
  if (
    na === nb
  ) {

    return 1;

  }


  // One contains the other
  if (
    na.includes(nb) ||
    nb.includes(na)
  ) {

    return 0.92;

  }


  return wordOverlap(
    na,
    nb
  );

}


// ============================================================
// MATCH SIMILARITY
// ============================================================

function matchSimilarity(
  cloudHome: string,
  cloudAway: string,
  fsHome: string,
  fsAway: string
) {

  const homeScore =
    teamSimilarity(
      cloudHome,
      fsHome
    );

  const awayScore =
    teamSimilarity(
      cloudAway,
      fsAway
    );

  const score =
    (
      homeScore +
      awayScore
    ) / 2;

  return {

    score,

    homeScore,

    awayScore

  };

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
// GET CLOUDBET MATCHES
// ============================================================

function getCloudbetMatches(
  data: any
): any[] {

  const candidates = [

    data?.matches,

    data?.live_matches,

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
// FETCH V27
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

  const data =
    await readJson(
      response
    );

  return {

    http_status:
      response.status,

    data

  };

}


// ============================================================
// FETCH CLOUDBET
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

  const data =
    await readJson(
      response
    );

  return {

    http_status:
      response.status,

    data

  };

}


// ============================================================
// GET MINUTE
// ============================================================

function getMinute(
  match: any
): number | null {

  const values = [

    match?.minute,

    match?.match_minute,

    match?.elapsed,

    match?.minute_display,

    match?.time,

    match?.matchTime,

    match?.timer,

    match?.clock

  ];

  for (
    const value of values
  ) {

    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {

      return Math.floor(
        value
      );

    }

    if (
      typeof value === "string"
    ) {

      const text =
        value.trim();

      const m =
        text.match(
          /^(\d{1,3})/
        );

      if (m) {

        const n =
          Number(
            m[1]
          );

        if (
          n >= 0 &&
          n <= 130
        ) {

          return n;

        }

      }

    }

  }

  return null;

}


// ============================================================
// SCORE
// ============================================================

function getScore(
  match: any
) {

  const score =
    match?.score ||
    match?.scores ||
    match?.result ||
    null;

  if (
    !score ||
    typeof score !== "object"
  ) {

    return {
      home: null,
      away: null
    };

  }

  const home =
    Number(
      score.home ??
      score.homeScore ??
      score.home_score
    );

  const away =
    Number(
      score.away ??
      score.awayScore ??
      score.away_score
    );

  return {

    home:
      Number.isFinite(home)
        ? home
        : null,

    away:
      Number.isFinite(away)
        ? away
        : null

  };

}


// ============================================================
// CLOUD BET TARGET
// ============================================================

function isTargetCloudbetMatch(
  match: any
): boolean {

  const bet =
    match?.bet;

  if (!bet) {

    return false;

  }

  return (

    String(
      bet.market ||
      ""
    ) ===
    "soccer.total_goals_period_first_half"

    &&

    String(
      bet.outcome ||
      ""
    ).toUpperCase() ===
    "OVER"

    &&

    String(
      bet.total ||
      ""
    ) ===
    "0.5"

    &&

    String(
      bet.status ||
      ""
    ) ===
    "SELECTION_ENABLED"

  );

}


// ============================================================
// BUILD MATCH VIEW
// ============================================================

function buildMatchView(
  match: any,
  source: string
) {

  const teams =
    resolveTeams(
      match
    );

  return {

    id:
      match?.id ??
      match?.match_id ??
      null,

    key:
      match?.key ??
      null,

    raw_match:
      match?.match ||
      match?.name ||
      null,

    home:
      teams.home,

    away:
      teams.away,

    team_source:
      teams.source,

    normalized: {

      home:
        normalizeTeam(
          teams.home
        ),

      away:
        normalizeTeam(
          teams.away
        ),

      match_key:
        makeMatchKey(
          teams.home,
          teams.away
        )

    },

    minute:
      getMinute(
        match
      ),

    score:
      getScore(
        match
      ),

    source

  };

}


// ============================================================
// MAIN DIAGNOSTIC
// ============================================================

async function diagnostic(
  env: any
) {

  const [
    v27Result,
    cloudbetResult
  ] =
    await Promise.all([

      getV27(
        env
      ),

      getCloudbet(
        env
      )

    ]);


  const v27 =
    v27Result.data;

  const cloudbet =
    cloudbetResult.data;


  const flashscoreMatches =
    getV27Matches(
      v27
    );


  const allCloudbetMatches =
    getCloudbetMatches(
      cloudbet
    );


  const cloudbetMatches =
    allCloudbetMatches
      .filter(
        isTargetCloudbetMatch
      );


  // ==========================================================
  // DEBUG ARRAYS
  // ==========================================================

  const cloudbetDebug =
    cloudbetMatches.map(
      (cb: any) => {

        const view =
          buildMatchView(
            cb,
            "Cloudbet"
          );

        return {

          ...view,

          bet:
            cb?.bet ||
            null

        };

      }
    );


  const flashscoreDebug =
    flashscoreMatches
      .slice(
        0,
        100
      )
      .map(
        (fs: any) =>
          buildMatchView(
            fs,
            "V27"
          )
      );


  // ==========================================================
  // CANDIDATES
  // ==========================================================

  const candidateResults = [];


  for (
    const cb
    of cloudbetMatches
  ) {

    const cloud =
      buildMatchView(
        cb,
        "Cloudbet"
      );


    const candidates =
      flashscoreMatches

        .map(
          (fs: any) => {

            const flash =
              buildMatchView(
                fs,
                "V27"
              );


            const similarity =
              matchSimilarity(

                cloud.home,

                cloud.away,

                flash.home,

                flash.away

              );


            return {

              flashscore_id:
                flash.id,

              match:
                flash.raw_match,

              home:
                flash.home,

              away:
                flash.away,

              normalized:
                flash.normalized,

              minute:
                flash.minute,

              score:
                flash.score,

              similarity

            };

          }
        )

        .filter(
          (x: any) =>
            x.home &&
            x.away
        )

        .sort(
          (
            a: any,
            b: any
          ) =>
            b.similarity.score -
            a.similarity.score
        );


    candidateResults.push({

      cloudbet: {

        id:
          cloud.id,

        key:
          cloud.key,

        match:
          cloud.raw_match,

        home:
          cloud.home,

        away:
          cloud.away,

        normalized:
          cloud.normalized

      },

      top_candidates:
        candidates.slice(
          0,
          10
        )

    });

  }


  // ==========================================================
  // EXACT / ALIAS / NO MATCH
  // ==========================================================

  const exactMatches = [];

  const aliasMatches = [];

  const noMatches = [];


  for (
    const cb
    of cloudbetMatches
  ) {

    const cloud =
      buildMatchView(
        cb,
        "Cloudbet"
      );


    let exact =
      null;

    let best =
      null;


    for (
      const fs
      of flashscoreMatches
    ) {

      const flash =
        buildMatchView(
          fs,
          "V27"
        );


      if (
        !flash.home ||
        !flash.away ||
        !cloud.home ||
        !cloud.away
      ) {

        continue;

      }


      const similarity =
        matchSimilarity(

          cloud.home,

          cloud.away,

          flash.home,

          flash.away

        );


      const result = {

        flashscore_id:
          flash.id,

        match:
          flash.raw_match,

        home:
          flash.home,

        away:
          flash.away,

        normalized:
          flash.normalized,

        minute:
          flash.minute,

        score:
          flash.score,

        similarity

      };


      // ------------------------------------------------------
      // EXACT
      // ------------------------------------------------------

      if (
        similarity.homeScore === 1 &&
        similarity.awayScore === 1
      ) {

        exact =
          result;

        break;

      }


      // ------------------------------------------------------
      // BEST
      // ------------------------------------------------------

      if (
        !best ||
        similarity.score >
        best.similarity.score
      ) {

        best =
          result;

      }

    }


    // ----------------------------------------------------------
    // EXACT
    // ----------------------------------------------------------

    if (exact) {

      exactMatches.push({

        cloudbet_id:
          cb?.id ??
          null,

        cloudbet_key:
          cb?.key ??
          null,

        cloudbet_match:
          cb?.name ||
          cb?.match ||
          null,

        cloudbet_home:
          cloud.home,

        cloudbet_away:
          cloud.away,

        flashscore:
          exact

      });

      continue;

    }


    // ----------------------------------------------------------
    // ALIAS / STRONG MATCH
    // ----------------------------------------------------------

    if (
      best &&
      best.similarity.homeScore >= 0.75 &&
      best.similarity.awayScore >= 0.75
    ) {

      aliasMatches.push({

        cloudbet_id:
          cb?.id ??
          null,

        cloudbet_key:
          cb?.key ??
          null,

        cloudbet_match:
          cb?.name ||
          cb?.match ||
          null,

        cloudbet_home:
          cloud.home,

        cloudbet_away:
          cloud.away,

        flashscore:
          best

      });

      continue;

    }


    // ----------------------------------------------------------
    // NO MATCH
    // ----------------------------------------------------------

    noMatches.push({

      cloudbet_id:
        cb?.id ??
        null,

      cloudbet_key:
        cb?.key ??
        null,

      cloudbet_match:
        cb?.name ||
        cb?.match ||
        null,

      cloudbet_home:
        cloud.home,

      cloudbet_away:
        cloud.away,

      best_candidate:
        best

    });

  }


  // ==========================================================
  // RESULT
  // ==========================================================

  return {

    success:
      true,

    endpoint:
      "diagnostic-match-v3",

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
        v27Result.http_status,

      cloudbet_http_status:
        cloudbetResult.http_status,

      flashscore_matches:
        flashscoreMatches.length,

      flashscore_with_names:
        flashscoreMatches
          .filter(
            (m: any) => {

              const t =
                resolveTeams(
                  m
                );

              return (
                t.home &&
                t.away
              );

            }
          )
          .length,

      cloudbet_total_matches:
        allCloudbetMatches.length,

      cloudbet_ht_over05:
        cloudbetMatches.length,

      exact_matches:
        exactMatches.length,

      alias_matches:
        aliasMatches.length,

      no_matches:
        noMatches.length

    },


    cloudbet_matches:
      cloudbetDebug,


    exact_matches:
      exactMatches,


    alias_matches:
      aliasMatches,


    no_matches:
      noMatches,


    candidates:
      candidateResults,


    v27_preview:
      flashscoreDebug,


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
            "DIAGNOSTIC V3",

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
      // DIAGNOSTIC
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
