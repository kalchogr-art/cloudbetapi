// ============================================================
// CLOUDBET — FAST LIVE SOCCER DETECTOR V5.3
// READ ONLY
//
// V5.3 LATENCY DIAGNOSTIC
//
// - /search остава търсене на САМИЯ МАЧ по HOME + AWAY
// - /live проверява ВСИЧКИ активни soccer competitions
// - limit ограничава само върнатите live мачове
// - НЕ се използва early-stop
// - НЕ се пропуска competition
//
// V5.3 CHANGE:
// - запазена concurrency = 24
// - запазен пълният scan
// - добавена подробна latency диагностика
// - min / max / average / median / p90 / p95 / p99
// - latency buckets
// - измерване по launch order
// - измерване на първите/последните заявки
//
// НЕ променя matcher логиката
// НЕ поставя залог
// READ ONLY
//
// ============================================================

const API_BASE =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const API_KEY_NAME =
  "CLOUDBET_API_KEY";

// ============================================================
// V5.3 PERFORMANCE CONFIG
// ============================================================

const CLOUDBET_TIMEOUT_MS =
  8000;

const COMPETITION_CONCURRENCY =
  24;


// ============================================================
// JSON
// ============================================================

function json(
  data,
  status = 200
) {
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
// BASIC
// ============================================================

function safeString(v) {
  return String(
    v ?? ""
  ).trim();
}


// ============================================================
// NORMALIZATION
// ============================================================

const TEAM_ALIASES = {
  "man city":
    "manchester city",
  "man utd":
    "manchester united",
  "man united":
    "manchester united",
  "man u":
    "manchester united",
  "manchester utd":
    "manchester united",
  "psg":
    "paris saint germain",
  "paris sg":
    "paris saint germain",
  "inter":
    "inter milan",
  "inter milano":
    "inter milan",
  "internazionale":
    "inter milan",
  "fc internazionale":
    "inter milan",
  "atletico":
    "atletico madrid",
  "atletico de madrid":
    "atletico madrid",
  "sporting cp":
    "sporting lisbon",
  "sporting lisboa":
    "sporting lisbon",
  "red star":
    "crvena zvezda",
  "red star belgrade":
    "crvena zvezda",
  "psv eindhoven":
    "psv",
  "bayern munchen":
    "bayern munich",
  "utd":
    "united",
  "ath":
    "athletic",
  "dep":
    "deportivo",
  "depor":
    "deportivo"
};

const GENERIC_WORDS =
  new Set([
    "fc",
    "cf",
    "sc",
    "ac",
    "afc",
    "ca",
    "cd",
    "sd",
    "ss",
    "as",
    "us",
    "ud",
    "aa",
    "ad",
    "rc",
    "fk",
    "sk",
    "ks",
    "sv",
    "vfb",
    "vfl",
    "club",
    "calcio",
    "football",
    "soccer"
  ]);

function normalizeText(v) {
  return safeString(v)
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(
      /&/g,
      " and "
    )
    .replace(
      /['’`]/g,
      ""
    )
    .replace(
      /[^a-z0-9]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function applyAliases(v) {
  let r =
    normalizeText(v);

  for (
    const alias of Object.keys(
      TEAM_ALIASES
    )
  ) {
    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    r =
      r.replace(
        new RegExp(
          `(^|\\s)${escaped}(?=\\s|$)`,
          "g"
        ),
        `$1${TEAM_ALIASES[alias]}`
      );
  }

  return r
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function normalizeTeam(v) {
  return applyAliases(v)
    .split(" ")
    .filter(Boolean)
    .filter(
      x =>
        !GENERIC_WORDS.has(x)
    )
    .filter(
      x =>
        !/^\d+$/.test(x)
    )
    .join(" ")
    .trim();
}

function teamTokens(v) {
  return normalizeTeam(v)
    .split(" ")
    .filter(
      x =>
        x.length >= 3
    );
}


// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(
  a,
  b
) {
  if (a === b) {
    return 0;
  }

  if (!a.length) {
    return b.length;
  }

  if (!b.length) {
    return a.length;
  }

  let prev =
    Array.from(
      {
        length:
          b.length + 1
      },
      (_, i) => i
    );

  let curr =
    new Array(
      b.length + 1
    );

  for (
    let i = 1;
    i <= a.length;
    i++
  ) {
    curr[0] = i;

    for (
      let j = 1;
      j <= b.length;
      j++
    ) {
      const cost =
        a[i - 1] ===
        b[j - 1]
          ? 0
          : 1;

      curr[j] =
        Math.min(
          curr[j - 1] + 1,
          prev[j] + 1,
          prev[j - 1] + cost
        );
    }

    [
      prev,
      curr
    ] = [
      curr,
      prev
    ];
  }

  return prev[
    b.length
  ];
}

function characterSimilarity(
  a,
  b
) {
  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);

  if (!A || !B) {
    return 0;
  }

  if (A === B) {
    return 1;
  }

  return Math.max(
    0,
    1 -
      levenshtein(
        A,
        B
      ) /
      Math.max(
        A.length,
        B.length
      )
  );
}


// ============================================================
// TEAM MATCH
// ============================================================

function teamScore(
  a,
  b
) {
  const A =
    normalizeTeam(a);

  const B =
    normalizeTeam(b);

  if (!A || !B) {
    return {
      score: 0,
      method: "EMPTY"
    };
  }

  if (A === B) {
    return {
      score: 1,
      method: "EXACT"
    };
  }

  if (
    A.includes(B) ||
    B.includes(A)
  ) {
    return {
      score:
        Math.max(
          0.75,
          Math.min(
            A.length,
            B.length
          ) /
          Math.max(
            A.length,
            B.length
          )
        ),
      method:
        "CONTAINMENT"
    };
  }

  const common =
    teamTokens(A).filter(
      x =>
        teamTokens(B)
          .includes(x)
    );

  if (
    common.length >= 1
  ) {
    const score =
      common.length /
      Math.max(
        teamTokens(A).length,
        teamTokens(B).length
      );

    if (
      score >= 0.75
    ) {
      return {
        score,
        method:
          "TOKEN_STRONG",
        common_tokens:
          common
      };
    }
  }

  return {
    score:
      characterSimilarity(
        A,
        B
      ),
    method:
      "CHARACTER_SIMILARITY"
  };
}

function strictMatch(
  homeA,
  awayA,
  homeB,
  awayB
) {
  const normalHome =
    teamScore(
      homeA,
      homeB
    );

  const normalAway =
    teamScore(
      awayA,
      awayB
    );

  const reverseHome =
    teamScore(
      homeA,
      awayB
    );

  const reverseAway =
    teamScore(
      awayA,
      homeB
    );

  const normalScore =
    Math.min(
      normalHome.score,
      normalAway.score
    );

  const reverseScore =
    Math.min(
      reverseHome.score,
      reverseAway.score
    );

  const normalValid =
    normalHome.score >= 0.70 &&
    normalAway.score >= 0.70;

  const reverseValid =
    reverseHome.score >= 0.70 &&
    reverseAway.score >= 0.70;

  if (
    normalValid &&
    normalScore >= reverseScore
  ) {
    return {
      matched: true,
      direction:
        "NORMAL",
      home_score:
        normalHome.score,
      away_score:
        normalAway.score,
      combined_score:
        normalScore
    };
  }

  if (reverseValid) {
    return {
      matched: true,
      direction:
        "REVERSED",
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      combined_score:
        reverseScore
    };
  }

  return {
    matched: false,
    direction:
      normalScore >= reverseScore
        ? "NORMAL"
        : "REVERSED",
    home_score:
      normalScore >= reverseScore
        ? normalHome.score
        : reverseHome.score,
    away_score:
      normalScore >= reverseScore
        ? normalAway.score
        : reverseAway.score,
    combined_score:
      Math.max(
        normalScore,
        reverseScore
      )
  };
}


// ============================================================
// API KEY
// ============================================================

function getApiKey(env) {
  const key =
    env?.[API_KEY_NAME];

  if (
    !key ||
    typeof key !== "string"
  ) {
    throw new Error(
      `${API_KEY_NAME} secret is missing`
    );
  }

  return key.trim();
}


// ============================================================
// CLOUDBET FETCH
// ============================================================

async function cloudbetFetch(
  path,
  env
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      CLOUDBET_TIMEOUT_MS
    );

  const started =
    Date.now();

  try {
    const response =
      await fetch(
        `${API_BASE}${path}`,
        {
          method:
            "GET",

          headers: {
            "accept":
              "application/json",

            "X-API-Key":
              getApiKey(env),

            "cache-control":
              "no-cache"
          },

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let data = {};

    try {
      data =
        text
          ? JSON.parse(text)
          : {};
    } catch {
      data = {
        raw: text
      };
    }

    if (
      !response.ok
    ) {
      throw new Error(
        `Cloudbet HTTP ${response.status}`
      );
    }

    return data;

  } catch (
    error
  ) {
    const elapsed =
      Date.now() -
      started;

    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        `Cloudbet ${path} timed out after ${elapsed}ms`
      );
    }

    throw new Error(
      `Cloudbet ${path} failed after ${elapsed}ms: ${
        error?.message ||
        String(error)
      }`
    );

  } finally {
    clearTimeout(
      timeout
    );
  }
}


// ============================================================
// LATENCY DIAGNOSTIC HELPERS
// ============================================================

function percentile(
  values,
  p
) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return null;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const index =
    (sorted.length - 1) * p;

  const lower =
    Math.floor(index);

  const upper =
    Math.ceil(index);

  if (
    lower === upper
  ) {
    return sorted[lower];
  }

  return Math.round(
    sorted[lower] +
      (
        sorted[upper] -
        sorted[lower]
      ) *
        (index - lower)
  );
}

function buildLatencyStats(
  records
) {
  const successful =
    records.filter(
      x =>
        Number.isFinite(
          x.elapsed_ms
        )
    );

  const values =
    successful.map(
      x =>
        x.elapsed_ms
    );

  if (
    values.length === 0
  ) {
    return {
      requests_measured: 0,
      min_ms: null,
      max_ms: null,
      average_ms: null,
      median_ms: null,
      p90_ms: null,
      p95_ms: null,
      p99_ms: null,
      buckets: {
        under_500ms: 0,
        ms_500_to_999: 0,
        ms_1000_to_1499: 0,
        ms_1500_to_1999: 0,
        over_2000ms: 0
      }
    };
  }

  const total =
    values.reduce(
      (sum, value) =>
        sum + value,
      0
    );

  let under500 = 0;
  let b500 = 0;
  let b1000 = 0;
  let b1500 = 0;
  let over2000 = 0;

  for (
    const value
    of values
  ) {
    if (
      value < 500
    ) {
      under500++;
    } else if (
      value < 1000
    ) {
      b500++;
    } else if (
      value < 1500
    ) {
      b1000++;
    } else if (
      value < 2000
    ) {
      b1500++;
    } else {
      over2000++;
    }
  }

  return {
    requests_measured:
      values.length,

    min_ms:
      Math.min(
        ...values
      ),

    max_ms:
      Math.max(
        ...values
      ),

    average_ms:
      Math.round(
        total /
          values.length
      ),

    median_ms:
      percentile(
        values,
        0.50
      ),

    p90_ms:
      percentile(
        values,
        0.90
      ),

    p95_ms:
      percentile(
        values,
        0.95
      ),

    p99_ms:
      percentile(
        values,
        0.99
      ),

    buckets: {
      under_500ms:
        under500,

      ms_500_to_999:
        b500,

      ms_1000_to_1499:
        b1000,

      ms_1500_to_1999:
        b1500,

      over_2000ms:
        over2000
    }
  };
}

function buildPositionStats(
  records
) {
  const successful =
    records
      .filter(
        x =>
          Number.isFinite(
            x.elapsed_ms
          )
      )
      .sort(
        (a, b) =>
          a.launch_order -
          b.launch_order
      );

  const first10 =
    successful.slice(
      0,
      10
    );

  const first24 =
    successful.slice(
      0,
      24
    );

  const last24 =
    successful.slice(
      -24
    );

  const avg =
    list => {

      if (
        !list.length
      ) {
        return null;
      }

      return Math.round(
        list.reduce(
          (sum, x) =>
            sum +
            x.elapsed_ms,
          0
        ) /
          list.length
      );
    };

  return {
    first_10_average_ms:
      avg(first10),

    first_24_average_ms:
      avg(first24),

    last_24_average_ms:
      avg(last24),

    first_request_ms:
      successful[0]?.elapsed_ms ??
      null,

    last_request_ms:
      successful[
        successful.length - 1
      ]?.elapsed_ms ??
      null
  };
}

function buildLatencyDiagnostic(
  records,
  concurrency,
  competitionCount,
  scanElapsed
) {
  const latency =
    buildLatencyStats(
      records
    );

  const position =
    buildPositionStats(
      records
    );

  const failed =
    records.filter(
      x =>
        x.error
    );

  return {
    requests: {
      total:
        records.length,

      successful:
        records.length -
        failed.length,

      failed:
        failed.length,

      concurrency
    },

    latency,

    position,

    scan: {
      competition_count:
        competitionCount,

      wall_clock_ms:
        scanElapsed,

      theoretical_note:
        "With dynamic concurrency, launch order is diagnostic only; it is not a strict batch number."
    },

    interpretation: {
      likely_fast:
        latency.p95_ms !== null &&
        latency.p95_ms < 1000,

      likely_cloudbet_or_network_latency:
        latency.p95_ms !== null &&
        latency.p95_ms >= 1500,

      possible_concurrency_pressure:
        position.first_24_average_ms !== null &&
        position.last_24_average_ms !== null &&
        position.last_24_average_ms >
          position.first_24_average_ms * 1.25,

      possible_systemic_slowdown:
        latency.buckets.over_2000ms +
          latency.buckets.ms_1500_to_1999 >
          latency.requests_measured * 0.50
    }
  };
}


// ============================================================
// LIMITED CONCURRENCY
// ============================================================

async function mapWithConcurrency(
  items,
  worker,
  concurrency
) {
  const results =
    new Array(
      items.length
    );

  if (
    items.length === 0
  ) {
    return results;
  }

  let nextIndex = 0;
  let launchOrder = 0;

  const workerLoop =
    async () => {
      while (true) {
        const index =
          nextIndex++;

        if (
          index >=
          items.length
        ) {
          return;
        }

        const currentLaunchOrder =
          launchOrder++;

        results[index] =
          await worker(
            items[index],
            index,
            currentLaunchOrder
          );
      }
    };

  const workerCount =
    Math.min(
      Math.max(
        1,
        Math.floor(
          concurrency
        )
      ),
      items.length
    );

  await Promise.all(
    Array.from(
      {
        length:
          workerCount
      },
      () =>
        workerLoop()
    )
  );

  return results;
}


// ============================================================
// SOCCER
// ============================================================

async function getSoccer(
  env
) {
  return cloudbetFetch(
    "/sports/soccer",
    env
  );
}


// ============================================================
// COMPETITIONS
// ============================================================

function getCompetitions(
  soccer
) {
  const result = [];

  const categories =
    Array.isArray(
      soccer?.categories
    )
      ? soccer.categories
      : [];

  for (
    const category
    of categories
  ) {
    const competitions =
      Array.isArray(
        category?.competitions
      )
        ? category.competitions
        : [];

    for (
      const competition
      of competitions
    ) {
      if (
        !competition?.key
      ) {
        continue;
      }

      result.push({
        key:
          competition.key,

        name:
          competition.name ||
          competition.key,

        eventCount:
          Number(
            competition.eventCount ||
            0
          )
      });
    }
  }

  return result;
}


// ============================================================
// COMPETITION
// ============================================================

async function getCompetition(
  env,
  key
) {
  return cloudbetFetch(
    `/competitions/${encodeURIComponent(key)}`,
    env
  );
}


// ============================================================
// EVENT
// ============================================================

async function getEvent(
  env,
  id
) {
  return cloudbetFetch(
    `/events/${encodeURIComponent(id)}`,
    env
  );
}


// ============================================================
// LIVE
// ============================================================

function isLive(
  event
) {
  if (
    event?.status ===
    "TRADING_LIVE"
  ) {
    return true;
  }

  if (
    event?.live === true
  ) {
    return true;
  }

  if (
    event?.isLive === true
  ) {
    return true;
  }

  if (
    event?.inPlay === true
  ) {
    return true;
  }

  if (
    event?.in_play === true
  ) {
    return true;
  }

  if (
    event?.state ===
    "LIVE"
  ) {
    return true;
  }

  if (
    event?.state ===
    "IN_PLAY"
  ) {
    return true;
  }

  return false;
}


// ============================================================
// TEAM NAME
// ============================================================

function teamName(
  value
) {
  if (
    typeof value ===
    "string"
  ) {
    return value.trim();
  }

  if (
    value &&
    typeof value ===
    "object"
  ) {
    return String(
      value.name ||
      value.key ||
      value.label ||
      ""
    ).trim();
  }

  return "";
}


// ============================================================
// MATCH NAME
// ============================================================

function getMatchName(
  event
) {
  const direct =
    event?.name ||
    event?.match ||
    event?.event_name ||
    event?.eventName;

  if (direct) {
    return String(
      direct
    );
  }

  const home =
    teamName(
      event?.home
    );

  const away =
    teamName(
      event?.away
    );

  if (
    home &&
    away
  ) {
    return `${home} - ${away}`;
  }

  return null;
}


// ============================================================
// MINUTE
// ============================================================

function findMinute(
  event
) {
  const values = [
    event?.minute,
    event?.matchMinute,
    event?.match_minute,
    event?.elapsed,
    event?.elapsedMinute,
    event?.elapsed_minute,
    event?.clock,
    event?.matchTime,
    event?.match_time,
    event?.gameTime,
    event?.game_time,
    event?.currentMinute,
    event?.current_minute,
    event?.time
  ];

  for (
    const value
    of values
  ) {
    if (
      typeof value ===
        "number" &&
      Number.isFinite(
        value
      )
    ) {
      if (
        value >= 0 &&
        value <= 130
      ) {
        return Math.floor(
          value
        );
      }
    }

    if (
      typeof value ===
      "string"
    ) {
      const text =
        value.trim();

      let match =
        text.match(
          /^(\d{1,3})\s*:\s*\d{1,2}/
        );

      if (match) {
        return Number(
          match[1]
        );
      }

      match =
        text.match(
          /^(\d{1,3})\s*['′]/
        );

      if (match) {
        return Number(
          match[1]
        );
      }

      if (
        /^\d{1,3}$/.test(
          text
        )
      ) {
        const n =
          Number(
            text
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
  event
) {
  const score =
    event?.score ||
    event?.scores ||
    event?.result ||
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
      Number.isFinite(
        home
      )
        ? home
        : null,

    away:
      Number.isFinite(
        away
      )
        ? away
        : null
  };
}


// ============================================================
// ODDS HELPERS
// ============================================================

function normalizeOddsText(
  value
) {
  return safeString(
    value
  )
    .toLowerCase()
    .replace(
      /[_-]+/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function getNumericPrice(
  value
) {
  if (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    )
  ) {
    return value > 1
      ? value
      : null;
  }

  if (
    typeof value ===
    "string"
  ) {
    const n =
      Number(
        value.trim()
      );

    if (
      Number.isFinite(
        n
      ) &&
      n > 1
    ) {
      return n;
    }
  }

  return null;
}

function isOverSelection(
  node
) {
  if (
    !node ||
    typeof node !==
      "object"
  ) {
    return false;
  }

  const values = [
    normalizeOddsText(
      node?.outcome
    ),
    normalizeOddsText(
      node?.key
    ),
    normalizeOddsText(
      node?.name
    ),
    normalizeOddsText(
      node?.label
    ),
    normalizeOddsText(
      node?.side
    ),
    normalizeOddsText(
      node?.type
    )
  ];

  return values.some(
    value =>
      value === "over" ||
      value.startsWith(
        "over "
      ) ||
      value.includes(
        " over "
      )
  );
}

function isHalfTimeMarketText(
  value
) {
  const text =
    normalizeOddsText(
      value
    );

  if (!text) {
    return false;
  }

  return (
    text.includes(
      "total goals period first half"
    ) ||
    text.includes(
      "first half total goals"
    ) ||
    text.includes(
      "first half goals"
    ) ||
    text.includes(
      "1st half total goals"
    ) ||
    text.includes(
      "total goals 1st half"
    ) ||
    text.includes(
      "period=1h"
    ) ||
    text.includes(
      "period 1h"
    ) ||
    text === "1h" ||
    text.includes(
      "first half"
    )
  );
}

function isOver05Text(
  value
) {
  const text =
    normalizeOddsText(
      value
    );

  if (!text) {
    return false;
  }

  return (
    text.includes(
      "total=0.5"
    ) ||
    text.includes(
      "total 0.5"
    ) ||
    text.includes(
      "over 0.5"
    ) ||
    text.includes(
      "over0.5"
    ) ||
    text.includes(
      "0.5 over"
    ) ||
    text === "0.5"
  );
}


// ============================================================
// DIRECT MARKET EXTRACTION
// ============================================================

function extractPriceFromSelection(
  selection
) {
  if (
    !selection ||
    typeof selection !==
    "object"
  ) {
    return null;
  }

  const priceCandidates = [
    selection?.price,
    selection?.odds,
    selection?.decimal,
    selection?.decimal_odds
  ];

  for (
    const value
    of priceCandidates
  ) {
    const price =
      getNumericPrice(
        value
      );

    if (
      price !== null
    ) {
      return price;
    }
  }

  return null;
}


// ============================================================
// RECURSIVE ODDS SEARCH
// ============================================================

function findOver05OddsRecursive(
  node,
  context = {},
  depth = 0
) {
  if (
    node === null ||
    node === undefined
  ) {
    return null;
  }

  if (
    depth > 12
  ) {
    return null;
  }

  if (
    typeof node !==
    "object"
  ) {
    return null;
  }

  const localTexts = [];

  const contextKeys = [
    "key",
    "name",
    "label",
    "market",
    "marketKey",
    "market_key",
    "type",
    "typeKey",
    "type_key",
    "group",
    "groupKey",
    "group_key",
    "period",
    "periodKey",
    "period_key",
    "params",
    "parameter",
    "parameters",
    "line",
    "handicap",
    "total",
    "outcome",
    "side"
  ];

  for (
    const key
    of contextKeys
  ) {
    if (
      node?.[key] !==
      undefined
    ) {
      localTexts.push(
        safeString(
          node[key]
        )
      );
    }
  }

  const combinedText =
    [
      ...localTexts,
      ...(context?.texts || [])
    ]
      .join(" ")
      .toLowerCase();

  const hasFirstHalf =
    isHalfTimeMarketText(
      combinedText
    );

  const hasOver05 =
    isOver05Text(
      combinedText
    );

  const selectionLike =
    isOverSelection(
      node
    );

  if (
    selectionLike
  ) {
    const price =
      extractPriceFromSelection(
        node
      );

    if (
      price !== null
    ) {
      const ownText =
        localTexts.join(
          " "
        );

      const validLine =
        hasOver05 ||
        isOver05Text(
          ownText
        );

      const validHalf =
        hasFirstHalf ||
        isHalfTimeMarketText(
          ownText
        );

      if (
        validLine &&
        validHalf
      ) {
        return price;
      }

      if (
        validLine &&
        context?.firstHalf ===
        true
      ) {
        return price;
      }
    }
  }

  const nextTexts =
    [
      ...(context?.texts || []),
      ...localTexts
    ];

  const nextContext = {
    texts:
      nextTexts,

    firstHalf:
      context?.firstHalf ===
      true ||
      hasFirstHalf
  };

  if (
    Array.isArray(
      node
    )
  ) {
    for (
      const child
      of node
    ) {
      const result =
        findOver05OddsRecursive(
          child,
          nextContext,
          depth + 1
        );

      if (
        result !== null
      ) {
        return result;
      }
    }

    return null;
  }

  for (
    const key
    of Object.keys(
      node
    )
  ) {
    const child =
      node[key];

    const keyText =
      normalizeOddsText(
        key
      );

    const childContext = {
      texts: [
        ...nextTexts,
        keyText
      ],

      firstHalf:
        nextContext.firstHalf ||
        isHalfTimeMarketText(
          keyText
        )
    };

    const result =
      findOver05OddsRecursive(
        child,
        childContext,
        depth + 1
      );

    if (
      result !== null
    ) {
      return result;
    }
  }

  return null;
}


// ============================================================
// TARGETED CLOUDBET MARKET PARSER
// ============================================================

function extractOver05Odds(
  event
) {
  if (
    !event ||
    typeof event !==
    "object"
  ) {
    return null;
  }

  const markets =
    event?.markets;

  if (!markets) {
    return null;
  }

  const firstHalfMarket =
    markets?.[
      "soccer.total_goals_period_first_half"
    ];

  if (
    firstHalfMarket
  ) {
    const periodCandidates = [
      firstHalfMarket?.[
        "period=1h"
      ],
      firstHalfMarket?.[
        "period_1h"
      ],
      firstHalfMarket?.[
        "1h"
      ],
      firstHalfMarket?.[
        "period1h"
      ]
    ];

    for (
      const period
      of periodCandidates
    ) {
      if (!period) {
        continue;
      }

      const selections =
        period?.selections;

      if (
        Array.isArray(
          selections
        )
      ) 
      {
        for (
          const selection
          of selections
        ) {
          if (
            isOverSelection(
              selection
            ) &&
            isOver05Text(
              JSON.stringify(
                selection
              )
            )
          ) {
            const price =
              extractPriceFromSelection(
                selection
              );

            if (
              price !== null
            ) {
              return price;
            }
          }
        }
      }

      if (
        selections &&
        typeof selections ===
        "object"
      ) {
        for (
          const key
          of Object.keys(
            selections
          )
        ) {
          const selection =
            selections[key];

          if (
            !isOverSelection(
              selection
            )
          ) {
            continue;
          }

          const text =
            JSON.stringify(
              selection
            );

          if (
            !isOver05Text(
              text
            )
          ) {
            continue;
          }

          const price =
            extractPriceFromSelection(
              selection
            );

          if (
            price !== null
          ) {
            return price;
          }
        }
      }
    }
  }

  return findOver05OddsRecursive(
    markets
  );
}


// ============================================================
// BUILD MATCH
// ============================================================

function buildMatch(
  event,
  competition
) {
  const home =
    teamName(
      event?.home
    );

  const away =
    teamName(
      event?.away
    );

  const minute =
    findMinute(
      event
    );

  const over05Odds =
    extractOver05Odds(
      event
    );

  return {
    id:
      event?.id ??
      null,

    key:
      event?.key ??
      null,

    match:
      getMatchName(
        event
      ),

    home,
    away,

    status:
      event?.status ??
      null,

    live:
      event?.live ??
      null,

    is_live:
      isLive(
        event
      ),

    minute,

    minute_display:
      minute !== null
        ? `${minute}'`
        : null,

    score:
      getScore(
        event
      ),

    odds: {
      over_05:
        over05Odds
    },

    odds_1h_over_05:
      over05Odds,

    competition: {
      key:
        competition?.key ??
        null,

      name:
        competition?.name ??
        null
    }
  };
}


// ============================================================
// /LIVE SCAN
// ============================================================

async function scan(
  env,
  request
) {
  const scanStarted =
    Date.now();

  const soccerStarted =
    Date.now();

  const soccer =
    await getSoccer(
      env
    );

  const soccerElapsed =
    Date.now() -
    soccerStarted;

  const competitions =
    getCompetitions(
      soccer
    );

  const url =
    new URL(
      request.url
    );

  let limit =
    Number(
      url.searchParams.get(
        "limit"
      ) ||
      "100"
    );

  if (
    !Number.isFinite(
      limit
    )
  ) {
    limit = 100;
  }

  limit =
    Math.max(
      1,
      Math.min(
        100,
        Math.floor(
          limit
        )
      )
    );

  const selected =
    competitions.filter(
      c =>
        Number(
          c.eventCount ||
          0
        ) > 0
    );

  const matches = [];
  const errors = [];

  let totalEvents = 0;
  let liveEvents = 0;

  // ==========================================================
  // COMPETITION SCAN
  // ==========================================================

  const competitionStarted =
    Date.now();

  const results =
    await mapWithConcurrency(
      selected,

      async (
        competition,
        index,
        launchOrder
      ) => {
        const requestStarted =
          Date.now();

        try {
          const data =
            await getCompetition(
              env,
              competition.key
            );

          const requestElapsed =
            Date.now() -
            requestStarted;

          const events =
            Array.isArray(
              data?.events
            )
              ? data.events
              : [];

          return {
            competition,
            events,
            error: null,

            elapsed_ms:
              requestElapsed,

            launch_order:
              launchOrder,

            index
          };

        } catch (
          error
        ) {
          const requestElapsed =
            Date.now() -
            requestStarted;

          return {
            competition,
            events: [],

            error:
              error?.message ||
              String(error),

            elapsed_ms:
              requestElapsed,

            launch_order:
              launchOrder,

            index
          };
        }
      },

      COMPETITION_CONCURRENCY
    );

  const competitionElapsed =
    Date.now() -
    competitionStarted;

  // ==========================================================
  // LATENCY DIAGNOSTIC
  // ==========================================================

  const latencyDiagnostic =
    buildLatencyDiagnostic(
      results,
      COMPETITION_CONCURRENCY,
      selected.length,
      competitionElapsed
    );

  // ==========================================================
  // RESULTS / EVENTS
  // ==========================================================

  const processingStarted =
    Date.now();

  let competitionsSuccessful =
    0;

  let competitionsFailed =
    0;

  let slowCompetitionRequests =
    0;

  let slowestCompetitionMs =
    0;

  let slowestCompetitionKey =
    null;

  for (
    const result
    of results
  ) {
    totalEvents +=
      result.events.length;

    if (
      result.error
    ) {
      competitionsFailed++;

      errors.push({
        competition:
          result.competition.key,

        name:
          result.competition.name,

        error:
          result.error,

        elapsed_ms:
          result.elapsed_ms,

        launch_order:
          result.launch_order
      });

      continue;
    }

    competitionsSuccessful++;

    if (
      Number.isFinite(
        result.elapsed_ms
      )
    ) {
      if (
        result.elapsed_ms >=
        1000
      ) {
        slowCompetitionRequests++;
      }

      if (
        result.elapsed_ms >
        slowestCompetitionMs
      ) {
        slowestCompetitionMs =
          result.elapsed_ms;

        slowestCompetitionKey =
          result.competition.key;
      }
    }

    for (
      const event
      of result.events
    ) {
      if (
        !isLive(
          event
        )
      ) {
        continue;
      }

      liveEvents++;

      const match =
        buildMatch(
          event,
          result.competition
        );

      if (
        !match.home ||
        !match.away
      ) {
        continue;
      }

      matches.push(
        match
      );
    }
  }

  const processingElapsed =
    Date.now() -
    processingStarted;

  matches.sort(
    (
      a,
      b
    ) => {
      const am =
        a.minute === null
          ? 999
          : a.minute;

      const bm =
        b.minute === null
          ? 999
          : b.minute;

      return am - bm;
    }
  );

  const limitedMatches =
    matches.slice(
      0,
      limit
    );

  const oddsFound =
    limitedMatches.filter(
      match =>
        match?.odds?.over_05 !==
          null &&
        match?.odds?.over_05 !==
          undefined
    ).length;

  const oddsMissing =
    limitedMatches.filter(
      match =>
        match?.odds?.over_05 ===
          null ||
        match?.odds?.over_05 ===
          undefined
    ).length;

  const totalElapsed =
    Date.now() -
    scanStarted;

  return {
    success: true,

    test:
      "CLOUDBET ALL LIVE SOCCER",

    version:
      "V5.3",

    filter:
      "SOCCER + LIVE ONLY",

    source:
      "Cloudbet",

    sport:
      "soccer",

    performance: {
      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      competition_concurrency:
        COMPETITION_CONCURRENCY,

      soccer_fetch_ms:
        soccerElapsed,

      competition_scan_ms:
        competitionElapsed,

      event_processing_ms:
        processingElapsed,

      total_scan_ms:
        totalElapsed,

      scan_method:
        "ALL_COMPETITIONS_NO_EARLY_STOP",

      slow_competition_requests:
        slowCompetitionRequests,

      slowest_competition_ms:
        slowestCompetitionMs,

      slowest_competition:
        slowestCompetitionKey,

      latency_diagnostic:
        latencyDiagnostic
    },

    stats: {
      competition_count:
        competitions.length,

      competitions_with_events:
        selected.length,

      competitions_checked:
        selected.length,

      competitions_successful:
        competitionsSuccessful,

      competitions_failed:
        competitionsFailed,

      total_events:
        totalEvents,

      live_events_detected:
        liveEvents,

      live_matches_found:
        matches.length,

      live_matches_returned:
        limitedMatches.length,

      result_limit:
        limit,

      odds_1h_over_05_found:
        oddsFound,

      odds_1h_over_05_missing:
        oddsMissing,

      errors:
        errors.length
    },

    matches:
      limitedMatches,

    errors,

    timestamp:
      new Date().toISOString()
  };
}


// ============================================================
// SEARCH MATCH
// ============================================================

async function searchMatch(
  env,
  request
) {
  const started =
    Date.now();

  const url =
    new URL(
      request.url
    );

  const requestedHome =
    safeString(
      url.searchParams.get(
        "home"
      )
    );

  const requestedAway =
    safeString(
      url.searchParams.get(
        "away"
      )
    );

  if (
    !requestedHome ||
    !requestedAway
  ) {
    return {
      success: false,

      search: {
        performed: false
      },

      error:
        "home and away are required",

      example:
        "/search?home=Fakel%20Voronezh&away=Krasnodar"
    };
  }

  const soccer =
    await getSoccer(
      env
    );

  const competitions =
    getCompetitions(
      soccer
    );

  const selected =
    competitions.filter(
      c =>
        Number(
          c.eventCount ||
          0
        ) > 0
    );

  const candidates = [];
  const errors = [];

  let totalEventsChecked =
    0;

  let competitionsSuccessful =
    0;

  let competitionsFailed =
    0;

  const results =
    await mapWithConcurrency(
      selected,

      async competition => {
        try {
          const data =
            await getCompetition(
              env,
              competition.key
            );

          const events =
            Array.isArray(
              data?.events
            )
              ? data.events
              : [];

          return {
            competition,
            events,
            error: null
          };

        } catch (
          error
        ) {
          return {
            competition,
            events: [],

            error:
              error?.message ||
              String(error)
          };
        }
      },

      COMPETITION_CONCURRENCY
    );

  for (
    const result
    of results
  ) {
    totalEventsChecked +=
      result.events.length;

    if (
      result.error
    ) {
      competitionsFailed++;

      errors.push({
        competition:
          result.competition.key,

        name:
          result.competition.name,

        error:
          result.error
      });

      continue;
    }

    competitionsSuccessful++;

    for (
      const event
      of result.events
    ) {
      const eventHome =
        teamName(
          event?.home
        );

      const eventAway =
        teamName(
          event?.away
        );

      if (
        !eventHome ||
        !eventAway
      ) {
        continue;
      }

      const score =
        strictMatch(
          requestedHome,
          requestedAway,
          eventHome,
          eventAway
        );

      if (
        !score.matched
      ) {
        continue;
      }

      candidates.push({
        match:
          buildMatch(
            event,
            result.competition
          ),

        direction:
          score.direction,

        home_score:
          score.home_score,

        away_score:
          score.away_score,

        combined_score:
          score.combined_score
      });
    }
  }

  candidates.sort(
    (
      a,
      b
    ) =>
      b.combined_score -
      a.combined_score
  );

  const best =
    candidates[0] ??
    null;

  if (!best) {
    return {
      success: true,

      search: {
        performed: true,

        type:
          "MATCH_HOME_AWAY",

        requested_home:
          requestedHome,

        requested_away:
          requestedAway,

        normalized_home:
          normalizeTeam(
            requestedHome
          ),

        normalized_away:
          normalizeTeam(
            requestedAway
          )
      },

      found: false,

      match: null,

      candidates_checked:
        totalEventsChecked,

      matching_candidates:
        0,

      errors:
        errors.length,

      error_details:
        errors,

      performance: {
        timeout_ms:
          CLOUDBET_TIMEOUT_MS,

        competition_concurrency:
          COMPETITION_CONCURRENCY,

        competitions_checked:
          selected.length,

        competitions_successful:
          competitionsSuccessful,

        competitions_failed:
          competitionsFailed,

        total_ms:
          Date.now() -
          started
      },

      timestamp:
        new Date().toISOString()
    };
  }

  return {
    success: true,

    search: {
      performed: true,

      type:
        "MATCH_HOME_AWAY",

      requested_home:
        requestedHome,

      requested_away:
        requestedAway,

      normalized_home:
        normalizeTeam(
          requestedHome
        ),

      normalized_away:
        normalizeTeam(
          requestedAway
        )
    },

    found: true,

    match:
      best.match,

    direction:
      best.direction,

    home_score:
      best.home_score,

    away_score:
      best.away_score,

    combined_score:
      best.combined_score,

    candidates_checked:
      totalEventsChecked,

    matching_candidates:
      candidates.length,

    candidates:
      candidates
        .slice(
          0,
          5
        )
        .map(
          x => ({
            match:
              x.match,

            direction:
              x.direction,

            home_score:
              x.home_score,

            away_score:
              x.away_score,

            combined_score:
              x.combined_score,

            odds:
              x.match?.odds ??
              null
          })
        ),

    errors:
      errors.length,

    error_details:
      errors,

    performance: {
      timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      competition_concurrency:
        COMPETITION_CONCURRENCY,

      competitions_checked:
        selected.length,

      competitions_successful:
        competitionsSuccessful,

      competitions_failed:
        competitionsFailed,

      total_ms:
        Date.now() -
        started
    },

    timestamp:
      new Date().toISOString()
  };
}


// ============================================================
// HEALTH
// ============================================================

function health(
  env
) {
  let secret = false;
  let length = 0;

  try {
    const key =
      getApiKey(
        env
      );

    secret = true;
    length =
      key.length;

  } catch {
    secret = false;
  }

  return {
    success: true,

    worker:
      "cloudbet-live-soccer",

    version:
      "V5.3",

    mode:
      "READ ONLY",

    performance: {
      cloudbet_timeout_ms:
        CLOUDBET_TIMEOUT_MS,

      competition_concurrency:
        COMPETITION_CONCURRENCY
    },

    secret: {
      name:
        API_KEY_NAME,

      exists:
        secret,

      length
    },

    endpoints: [
      "/",
      "/health",
      "/live",
      "/live?limit=100",
      "/search?home=TEAM&away=TEAM",
      "/event?id=EVENT_ID"
    ],

    live: {
      scans:
        "ALL_ACTIVE_SOCCER_COMPETITIONS",

      limit:
        "RESULT_LIMIT_ONLY",

      concurrency:
        COMPETITION_CONCURRENCY,

      early_stop:
        false
    },

    odds: {
      enabled: true,

      market:
        "1H TOTAL GOALS",

      selection:
        "OVER 0.5",

      output:
        "odds.over_05",

      fallback:
        "RECURSIVE_MARKET_SEARCH"
    },

    search: {
      enabled: true,

      searches_for:
        "MATCH",

      searches_by:
        "HOME + AWAY",

      searches_result:
        false,

      live_required:
        false
    },

    event_test: {
      enabled: true,

      endpoint:
        "/event?id=EVENT_ID",

      purpose:
        "RAW CLOUDBET EVENT WITH MARKETS",

      betting:
        false
    },

    diagnostic: {
      enabled: true,

      measures:
        [
          "min",
          "max",
          "average",
          "median",
          "p90",
          "p95",
          "p99",
          "latency_buckets",
          "launch_order"
        ]
    },

    timestamp:
      new Date().toISOString()
  };
}


// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(
    request,
    env
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
      if (
        path === "/" ||
        path === "/health"
      ) {
        return json(
          health(
            env
          )
        );
      }

      if (
        path === "/live"
      ) {
        return json(
          await scan(
            env,
            request
          )
        );
      }

      if (
        path === "/search"
      ) {
        return json(
          await searchMatch(
            env,
            request
          )
        );
      }

      if (
        path === "/event"
      ) {
        const id =
          url.searchParams.get(
            "id"
          );

        if (
          !id ||
          !/^\d+$/.test(id)
        ) {
          return json(
            {
              success: false,

              error:
                "id is required and must be numeric",

              example:
                "/event?id=36106008"
            },
            400
          );
        }

        const event =
          await getEvent(
            env,
            id
          );

        return json({
          success: true,

          test:
            "CLOUDBET EVENT",

          version:
            "V5.3",

          event_id:
            id,

          endpoint:
            `/events/${id}`,

          data:
            event,

          extracted_odds: {
            over_05:
              extractOver05Odds(
                event
              )
          },

          timestamp:
            new Date().toISOString()
        });
      }

      return json(
        {
          success: false,

          error:
            "Unknown endpoint",

          available_endpoints: [
            "/",
            "/health",
            "/live",
            "/live?limit=100",
            "/search?home=TEAM&away=TEAM",
            "/event?id=EVENT_ID"
          ]
        },
        404
      );

    } catch (
      error
    ) {
      return json(
        {
          success: false,

          worker:
            "cloudbet-live-soccer",

          version:
            "V5.3",

          error:
            error?.message ||
            String(error),

          timestamp:
            new Date().toISOString()
        },
        500
      );
    }
  }
};
