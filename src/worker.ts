// ============================================================
// CLOUDBET MATCH MATCHER — DIAGNOSTIC V2
//
// V27 = Flashscore source
// CLOUDBET = Cloudbet HT OVER 0.5 source
//
// IMPORTANT:
// Flashscore ID != Cloudbet ID
// Matching is done by team names.
//
// THIS VERSION IS DIAGNOSTIC ONLY.
// It does NOT place bets.
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
// NORMALIZE
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

  "man utd":
    "manchester united",

  "man united":
    "manchester united",

  "man u":
    "manchester united",

  "man city":
    "manchester city",

  "spurs":
    "tottenham",

  "tottenham hotspur":
    "tottenham",

  "wolves":
    "wolverhampton",

  "west ham united":
    "west ham",

  "newcastle united":
    "newcastle",

  "inter milano":
    "inter milan",

  "internazionale":
    "inter milan",

  "psg":
    "paris saint germain",

  "paris sg":
    "paris saint germain",

  "ath madrid":
    "atletico madrid",

  "atletico de madrid":
    "atletico madrid"

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

  return (
    TEAM_ALIASES[name] ||
    name
  );

}


// ============================================================
// TEAM NAME
// ============================================================

function getTeamName(
  value: unknown
): string {

  if (
    typeof value === "string"
  ) {

    return value;

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
    );

  }

  return "";

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
// WORD SIMILARITY
// ============================================================

function words(
  value: string
): string[] {

  return value
    .split(" ")
    .map(
      x => x.trim()
    )
    .filter(Boolean);

}


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
// TEAM MATCH SCORE
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

  if (
    na === nb
  ) {

    return 1;

  }

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

  if (
    Array.isArray(
      data?.matches
    )
  ) {

    return data.matches;

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
      typeof value ===
      "number" &&
      Number.isFinite(value)
    ) {

      return Math.floor(
        value
      );

    }

    if (
      typeof value ===
      "string"
    ) {

      const text =
        value.trim();

      const m =
        text.match(
          /^(\d{1,3})/
        );

      if (
        m
      ) {

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
    typeof score !==
    "object"
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
// CLOUD BET BET
// ============================================================

function isTargetCloudbetMatch(
  match: any
): boolean {

  const bet =
    match?.bet;

  if (
    !bet
  ) {

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
  // CLOUD BET DEBUG
  // ==========================================================

  const cloudbetDebug =
    cloudbetMatches.map(
      (cb: any) => {

        const home =
          getTeamName(
            cb?.home
          );

        const away =
          getTeamName(
            cb?.away
          );

        const key =
          makeMatchKey(
            home,
            away
          );

        return {

          cloudbet_id:
            cb?.id ??
            null,

          cloudbet_key:
            cb?.key ??
            null,

          match:
            cb?.name ||
            `${home} v ${away}`,

          home,

          away,

          normalized: {

            home:
              normalizeTeam(
                home
              ),

            away:
              normalizeTeam(
                away
              ),

            match_key:
              key

          },

          minute:
            getMinute(
              cb
            ),

          score:
            getScore(
              cb
            ),

          bet:
            cb?.bet ||
            null

        };

      }
    );


  // ==========================================================
  // FIND CANDIDATES
  // ==========================================================

  const candidateResults = [];


  for (
    const cb
    of cloudbetMatches
  ) {

    const cloudHome =
      getTeamName(
        cb?.home
      );

    const cloudAway =
      getTeamName(
        cb?.away
      );


    const candidates =
      flashscoreMatches
        .map(
          (fs: any) => {

            const fsHome =
              getTeamName(
                fs?.home
              );

            const fsAway =
              getTeamName(
                fs?.away
              );


            const similarity =
              matchSimilarity(

                cloudHome,

                cloudAway,

                fsHome,

                fsAway

              );


            return {

              flashscore_id:
                fs?.id ??
                fs?.match_id ??
                null,

              match:
                fs?.name ||
                `${fsHome} - ${fsAway}`,

              home:
                fsHome,

              away:
                fsAway,

              normalized: {

                home:
                  normalizeTeam(
                    fsHome
                  ),

                away:
                  normalizeTeam(
                    fsAway
                  )

              },

              minute:
                getMinute(
                  fs
                ),

              score:
                getScore(
                  fs
                ),

              similarity

            };

          }
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
          cb?.id ??
          null,

        key:
          cb?.key ??
          null,

        match:
          cb?.name ??
          null,

        home:
          cloudHome,

        away:
          cloudAway

      },

      top_candidates:
        candidates.slice(
          0,
          10
        )

    });

  }


  // ==========================================================
  // EXACT MATCH TEST
  // ==========================================================

  const exactMatches = [];

  const aliasMatches = [];

  const noMatches = [];


  for (
    const cb
    of cloudbetMatches
  ) {

    const cloudHome =
      getTeamName(
        cb?.home
      );

    const cloudAway =
      getTeamName(
        cb?.away
      );


    let exact =
      null;

    let best =
      null;


    for (
      const fs
      of flashscoreMatches
    ) {

      const fsHome =
        getTeamName(
          fs?.home
        );

      const fsAway =
        getTeamName(
          fs?.away
        );


      const similarity =
        matchSimilarity(

          cloudHome,

          cloudAway,

          fsHome,

          fsAway

        );


      if (
        similarity.score === 1
      ) {

        exact = {

          flashscore_id:
            fs?.id ??
            fs?.match_id ??
            null,

          match:
            fs?.name ??
            `${fsHome} - ${fsAway}`,

          home:
            fsHome,

          away:
            fsAway,

          minute:
            getMinute(
              fs
            ),

          score:
            getScore(
              fs
            ),

          similarity

        };

        break;

      }


      if (
        !best ||
        similarity.score >
        best.similarity.score
      ) {

        best = {

          flashscore_id:
            fs?.id ??
            fs?.match_id ??
            null,

          match:
            fs?.name ??
            `${fsHome} - ${fsAway}`,

          home:
            fsHome,

          away:
            fsAway,

          minute:
            getMinute(
              fs
            ),

          score:
            getScore(
              fs
            ),

          similarity

        };

      }

    }


    if (
      exact
    ) {

      exactMatches.push({

        cloudbet_id:
          cb?.id ??
          null,

        cloudbet_match:
          cb?.name ??
          null,

        flashscore:
          exact

      });

      continue;

    }


    if (
      best &&
      best.similarity.homeScore >= 0.75 &&
      best.similarity.awayScore >= 0.75
    ) {

      aliasMatches.push({

        cloudbet_id:
          cb?.id ??
          null,

        cloudbet_match:
          cb?.name ??
          null,

        flashscore:
          best

      });

      continue;

    }


    noMatches.push({

      cloudbet_id:
        cb?.id ??
        null,

      cloudbet_match:
        cb?.name ??
        null,

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
      "diagnostic-match",

    worker:
      "cloudbet-match-matcher",

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
      flashscoreMatches
        .slice(
          0,
          20
        )
        .map(
          (fs: any) => {

            const home =
              getTeamName(
                fs?.home
              );

            const away =
              getTeamName(
                fs?.away
              );

            return {

              id:
                fs?.id ??
                fs?.match_id ??
                null,

              match:
                fs?.name ??
                `${home} - ${away}`,

              home,

              away,

              minute:
                getMinute(
                  fs
                ),

              score:
                getScore(
                  fs
                )

            };

          }
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
            "DIAGNOSTIC",

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
