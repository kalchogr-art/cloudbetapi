// ============================================================
// CLOUDBET BET WORKER V5.9.0
// DRY RUN · EXACT 1H TOTAL GOALS OVER 0.5
//
// FLOW:
// TRACKER → MATCHER → CLOUDBET EVENT → EXACT TARGET
//
// V5.9.0 FIX:
// - V5.8.9 behavior preserved
// - /run service timeout protection
// - TRACKER / MATCHER / CLOUDBET independently diagnosed
// - Promise.allSettled() prevents one service from hanging /run
// - NEW /diagnostic endpoint
// - /diagnostic calls TRACKER → MATCHER → CLOUDBET sequentially
// - exact elapsed_ms / HTTP status / response bytes
// - EXACT target only
// - /lines diagnostic
// - Real betting disabled
//
// IMPORTANT V5.9.0 RUN FIX:
// - /run uses SINGLE Cloudbet /event attempt
// - /run DOES NOT wait 20 × 30 sec for odds
// - processPending() keeps persistent retry:
//   20 attempts / 30 sec between attempts
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type Obj = Record<string, any>;

const VERSION = "V5.9.0";

const MODE = "DRY_RUN";
const DRY_RUN = true;
const BETTING_ENABLED = false;

const BET_STAKE_EUR = 10;
const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

// ─── EXACT TARGET ──────────────────────────────────────────

const TARGET_MARKET =
  "soccer.total_goals_period_first_half";

const TARGET_SUBMARKET =
  "period=1h";

const TARGET_OUTCOME =
  "over";

const TARGET_PARAMS =
  "total=0.5";

// ─── TIMEOUT / RETRY ──────────────────────────────────────

const SERVICE_TIMEOUT_MS = 10_000;

const ODDS_EVENT_MAX_RETRIES = 20;
const ODDS_EVENT_RETRY_DELAY_MS = 30_000;

const MAX_MISSING_CHECKS = 3;

// ─── MATCHER ───────────────────────────────────────────────

const MATCHER_THRESHOLD = 0.20;
const MIN_MATCHER_SCORE = 0.20;
const TEAM_MATCH_MIN_SCORE = 0.70;
const CHARACTER_SIMILARITY_MIN_SCORE = 0.70;
const CONTAINMENT_MIN_SCORE = 0.75;
const TOKEN_MATCH_MIN_SCORE = 0.75;

const REQUIRED_MATCH_CLASSIFICATION =
  "CONFIDENT_MATCH";

const ALLOWED_SIGNAL_TYPE =
  "HUNTER_ENTRY";

// ─── TEAM ALIASES ──────────────────────────────────────────

const TEAM_ALIASES: Record<string, string> = {
  "man city": "manchester city",
  "man utd": "manchester united",
  "man united": "manchester united",
  "man u": "manchester united",
  "manchester utd": "manchester united",

  "psg": "paris saint germain",
  "paris sg": "paris saint germain",

  "inter": "inter milan",
  "inter milano": "inter milan",
  "internazionale": "inter milan",
  "fc internazionale": "inter milan",

  "atletico": "atletico madrid",
  "atletico de madrid": "atletico madrid",

  "sporting cp": "sporting lisbon",
  "sporting lisboa": "sporting lisbon",

  "red star": "crvena zvezda",
  "red star belgrade": "crvena zvezda",

  "psv eindhoven": "psv",
  "bayern munchen": "bayern munich",

  "utd": "united",
  "ath": "athletic",
  "dep": "deportivo",
  "depor": "deportivo"
};

const GENERIC_WORDS = new Set([
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

// ─── BASIC ─────────────────────────────────────────────────

function safe(v: any): string {
  return String(v ?? "").trim();
}

function norm(v: any): string {
  return safe(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function json(
  data: any,
  status = 200
): Response {
  return new Response(
    JSON.stringify(data, null, 2),
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

function sleep(
  ms: number
): Promise<void> {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

// ─── TEAM NORMALIZATION ────────────────────────────────────

function normalizeTeam(
  value: any
): string {
  let result = norm(value);

  for (
    const [alias, full]
    of Object.entries(TEAM_ALIASES)
  ) {
    const escaped =
      alias.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
      );

    result =
      result.replace(
        new RegExp(
          `(^|\\s)${escaped}(?=\\s|$)`,
          "g"
        ),
        `$1${full}`
      );
  }

  return result
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(
      x =>
        x &&
        !GENERIC_WORDS.has(x) &&
        !/^\d+$/.test(x)
    )
    .join(" ")
    .trim();
}

function teamTokens(
  value: any
): string[] {
  return normalizeTeam(value)
    .split(" ")
    .filter(
      x => x.length >= 3
    );
}

function splitMatch(
  value: any
): {
  home: string;
  away: string;
} {
  const text = safe(value);

  for (
    const separator of [
      " - ",
      " v ",
      " vs ",
      " VS ",
      " @ "
    ]
  ) {
    const i =
      text.indexOf(separator);

    if (i >= 0) {
      return {
        home:
          text.slice(0, i).trim(),
        away:
          text
            .slice(
              i + separator.length
            )
            .trim()
      };
    }
  }

  return {
    home: "",
    away: ""
  };
}

function extractHome(
  m: Obj
): string {
  const direct =
    m?.v27?.home ??
    m?.v27?.homeTeam ??
    m?.v27?.home_name ??
    m?.home ??
    m?.homeTeam ??
    m?.home_name ??
    m?.home?.name ??
    m?.home_team?.name ??
    m?.teams?.home?.name;

  if (
    typeof direct === "string" &&
    direct.trim()
  ) {
    return direct.trim();
  }

  return splitMatch(
    m?.match ??
    m?.name ??
    m?.event_name
  ).home;
}

function extractAway(
  m: Obj
): string {
  const direct =
    m?.v27?.away ??
    m?.v27?.awayTeam ??
    m?.v27?.away_name ??
    m?.away ??
    m?.awayTeam ??
    m?.away_name ??
    m?.away?.name ??
    m?.away_team?.name ??
    m?.teams?.away?.name;

  if (
    typeof direct === "string" &&
    direct.trim()
  ) {
    return direct.trim();
  }

  return splitMatch(
    m?.match ??
    m?.name ??
    m?.event_name
  ).away;
}

function displayMatch(
  m: Obj
): string {
  const direct =
    safe(
      m?.match ??
      m?.name ??
      m?.event_name
    );

  if (direct) {
    return direct;
  }

  return `${extractHome(m)} - ${extractAway(m)}`.trim();
}

function extractMatchId(
  m: Obj
): string {
  return safe(
    m?.id ??
    m?.match_id ??
    m?.matchId ??
    m?.event_id ??
    m?.eventId ??
    m?.key
  );
}

function teamsPresent(
  home: any,
  away: any
): boolean {
  return (
    normalizeTeam(home).length > 0 &&
    normalizeTeam(away).length > 0
  );
}

// ─── TEAM MATCHING ─────────────────────────────────────────

function levenshtein(
  a: string,
  b: string
): number {
  const aa = norm(a);
  const bb = norm(b);

  const previous =
    Array.from(
      {
        length:
          bb.length + 1
      },
      (_, i) => i
    );

  for (
    let i = 1;
    i <= aa.length;
    i++
  ) {
    const current = [i];

    for (
      let j = 1;
      j <= bb.length;
      j++
    ) {
      current[j] =
        aa[i - 1] === bb[j - 1]
          ? previous[j - 1]
          : Math.min(
              previous[j - 1] + 1,
              current[j - 1] + 1,
              previous[j] + 1
            );
    }

    for (
      let j = 0;
      j < current.length;
      j++
    ) {
      previous[j] = current[j];
    }
  }

  return previous[bb.length];
}

function characterSimilarity(
  a: string,
  b: string
): number {
  const aa =
    normalizeTeam(a);

  const bb =
    normalizeTeam(b);

  if (!aa || !bb) {
    return 0;
  }

  if (aa === bb) {
    return 1;
  }

  const max =
    Math.max(
      aa.length,
      bb.length
    );

  if (!max) {
    return 0;
  }

  return Math.max(
    0,
    1 -
      levenshtein(
        aa,
        bb
      ) / max
  );
}

function teamScore(
  a: string,
  b: string
): Obj {
  const aa =
    normalizeTeam(a);

  const bb =
    normalizeTeam(b);

  if (!aa || !bb) {
    return {
      score: 0,
      method: "EMPTY",
      accepted: false
    };
  }

  if (aa === bb) {
    return {
      score: 1,
      method: "EXACT",
      accepted: true
    };
  }

  if (
    aa.includes(bb) ||
    bb.includes(aa)
  ) {
    const score =
      Math.max(
        CONTAINMENT_MIN_SCORE,
        Math.min(
          aa.length,
          bb.length
        ) /
          Math.max(
            aa.length,
            bb.length
          )
      );

    return {
      score,
      method: "CONTAINMENT",
      accepted:
        score >=
        TEAM_MATCH_MIN_SCORE
    };
  }

  const aTokens =
    new Set(
      teamTokens(aa)
    );

  const bTokens =
    new Set(
      teamTokens(bb)
    );

  const common =
    [...aTokens].filter(
      x => bTokens.has(x)
    ).length;

  const denominator =
    Math.max(
      aTokens.size,
      bTokens.size
    );

  const ratio =
    denominator > 0
      ? common / denominator
      : 0;

  if (
    common >= 1 &&
    ratio >= TOKEN_MATCH_MIN_SCORE
  ) {
    return {
      score: ratio,
      method: "TOKEN",
      accepted: true
    };
  }

  const score =
    characterSimilarity(
      aa,
      bb
    );

  return {
    score,
    method: "CHARACTER",
    accepted:
      score >=
      CHARACTER_SIMILARITY_MIN_SCORE
  };
}

function twoSidedTeamScore(
  homeA: string,
  awayA: string,
  homeB: string,
  awayB: string
): Obj {
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

  const normal =
    Math.min(
      normalHome.score,
      normalAway.score
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

  const reverse =
    Math.min(
      reverseHome.score,
      reverseAway.score
    );

  const normalAccepted =
    normalHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    normalAway.score >=
      TEAM_MATCH_MIN_SCORE;

  const reverseAccepted =
    reverseHome.score >=
      TEAM_MATCH_MIN_SCORE &&
    reverseAway.score >=
      TEAM_MATCH_MIN_SCORE;

  if (
    normalAccepted &&
    normal >= reverse
  ) {
    return {
      matched: true,
      direction: "NORMAL",
      combined_score: normal,
      home_score:
        normalHome.score,
      away_score:
        normalAway.score,
      home_method:
        normalHome.method,
      away_method:
        normalAway.method
    };
  }

  if (reverseAccepted) {
    return {
      matched: true,
      direction: "REVERSED",
      combined_score: reverse,
      home_score:
        reverseHome.score,
      away_score:
        reverseAway.score,
      home_method:
        reverseHome.method,
      away_method:
        reverseAway.method
    };
  }

  return {
    matched: false,
    direction: null,
    combined_score:
      Math.max(
        normal,
        reverse
      ),
    home_score:
      Math.max(
        normalHome.score,
        reverseHome.score
      ),
    away_score:
      Math.max(
        normalAway.score,
        reverseAway.score
      )
  };
}

// ─── SERVICE ERROR ─────────────────────────────────────────

class ServiceRequestError
  extends Error {
  service: string;
  path: string;
  code: string;
  status: number | null;

  constructor(
    service: string,
    path: string,
    code: string,
    message: string,
    status: number | null = null
  ) {
    super(message);

    this.name =
      "ServiceRequestError";

    this.service =
      service;

    this.path =
      path;

    this.code =
      code;

    this.status =
      status;
  }

  toJSON(): Obj {
    return {
      service:
        this.service,
      path:
        this.path,
      code:
        this.code,
      status:
        this.status,
      message:
        this.message
    };
  }
}

// ─── SERVICE FETCH WITH TIMEOUT ────────────────────────────

async function fetchServiceJSON(
  service: Fetcher,
  path: string,
  serviceName = "UNKNOWN",
  timeoutMs =
    SERVICE_TIMEOUT_MS
): Promise<Obj> {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const response =
      await service.fetch(
        new Request(
          `https://service${path}`,
          {
            method: "GET",
            headers: {
              accept:
                "application/json"
            },
            signal:
              controller.signal
          }
        )
      );

    const text =
      await response.text();

    if (!response.ok) {
      throw new ServiceRequestError(
        serviceName,
        path,
        "HTTP_ERROR",
        `HTTP ${response.status}: ${text.slice(
          0,
          500
        )}`,
        response.status
      );
    }

    if (!text.trim()) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new ServiceRequestError(
        serviceName,
        path,
        "INVALID_JSON",
        `Invalid JSON from ${serviceName} ${path}`
      );
    }
  } catch (error) {
    if (
      error instanceof
      ServiceRequestError
    ) {
      throw error;
    }

    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new ServiceRequestError(
        serviceName,
        path,
        "SERVICE_TIMEOUT",
        `${serviceName} ${path} timed out after ${timeoutMs}ms`
      );
    }

    throw new ServiceRequestError(
      serviceName,
      path,
      "SERVICE_FETCH_ERROR",
      error instanceof Error
        ? error.message
        : String(error)
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCloudbetEvent(
  env: Env,
  eventId: string
): Promise<Obj> {
  if (
    !eventId ||
    !/^\d+$/.test(eventId)
  ) {
    throw new ServiceRequestError(
      "CLOUDBET",
      `/event?id=${eventId}`,
      "INVALID_CLOUDBET_EVENT_ID",
      `INVALID_CLOUDBET_EVENT_ID:${eventId}`
    );
  }

  const data =
    await fetchServiceJSON(
      env.CLOUDBET,
      `/event?id=${encodeURIComponent(
        eventId
      )}`,
      "CLOUDBET",
      SERVICE_TIMEOUT_MS
    );

  if (
    data?.data &&
    typeof data.data ===
      "object" &&
    !Array.isArray(
      data.data
    )
  ) {
    return data.data;
  }

  return data;
}

// ─── TRACKER ───────────────────────────────────────────────

function extractSignals(
  data: Obj
): Obj[] {
  const source =
    data?.signals ??
    data?.entries ??
    data?.hunter_entries ??
    data?.data ??
    [];

  return Array.isArray(source)
    ? source.filter(
        x =>
          x &&
          typeof x ===
            "object"
      )
    : [];
}

function isHunterEntry(
  signal: Obj
): boolean {
  return (
    safe(
      signal?.type ??
        signal?.signal_type ??
        signal?.signalType
    ).toUpperCase() ===
    ALLOWED_SIGNAL_TYPE
  );
}

function signalId(
  signal: Obj
): string {
  return safe(
    signal?.match_id ??
      signal?.matchId ??
      signal?.v27?.id ??
      signal?.id
  );
}

function signalHome(
  signal: Obj
): string {
  return safe(
    signal?.v27?.home ??
      extractHome(signal)
  );
}

function signalAway(
  signal: Obj
): string {
  return safe(
    signal?.v27?.away ??
      extractAway(signal)
  );
}

function signalMatch(
  signal: Obj
): string {
  return safe(
    signal?.match ??
      signal?.name ??
      signal?.v27?.match
  );
}

// ─── MATCHER ───────────────────────────────────────────────

function matcherMatches(
  data: Obj
): Obj[] {
  const source =
    data?.matches ??
    data?.results ??
    data?.matched ??
    data?.candidates ??
    [];

  return Array.isArray(source)
    ? source
    : [];
}

function matcherScore(
  item: Obj
): number {
  const n =
    Number(
      item?.scoring?.total ??
        item?.scoring?.score ??
        item?.matcher_score ??
        item?.match_score ??
        item?.score ??
        0
    );

  return Number.isFinite(n)
    ? n
    : 0;
}

function matcherV27(
  item: Obj
): Obj {
  return (
    item?.v27 ??
    item?.source ??
    item
  );
}

function matcherCloudbet(
  item: Obj
): Obj | null {
  return (
    item?.cloudbet ??
    item?.target ??
    item?.matched_cloudbet ??
    null
  );
}

function matcherClassification(
  item: Obj
): string {
  return safe(
    item?.classification ??
      item?.match_classification ??
      item?.security?.classification
  );
}

function matcherMethod(
  item: Obj
): string {
  return safe(
    item?.match_method ??
      item?.method ??
      item?.security?.match_method
  );
}

function validateMatcher(
  signal: Obj,
  item: Obj
): Obj {
  const v27 =
    matcherV27(item);

  const sh =
    signalHome(signal);

  const sa =
    signalAway(signal);

  const vh =
    extractHome(v27);

  const va =
    extractAway(v27);

  if (
    !teamsPresent(sh, sa) ||
    !teamsPresent(vh, va)
  ) {
    return {
      accepted: false,
      reason:
        "TEAMS_MISSING"
    };
  }

  const teams =
    twoSidedTeamScore(
      sh,
      sa,
      vh,
      va
    );

  if (!teams.matched) {
    return {
      accepted: false,
      reason:
        "STRICT_TWO_SIDED_TEAM_VALIDATION_FAILED",
      team_scores:
        teams
    };
  }

  const score =
    matcherScore(item);

  if (
    score <
    MIN_MATCHER_SCORE
  ) {
    return {
      accepted: false,
      reason:
        "MATCHER_SCORE_BELOW_MINIMUM",
      matcher_score:
        score
    };
  }

  const classification =
    matcherClassification(item);

  if (
    classification !==
      REQUIRED_MATCH_CLASSIFICATION &&
    score <
      MATCHER_THRESHOLD
  ) {
    return {
      accepted: false,
      reason:
        "MATCH_NOT_CONFIDENT"
    };
  }

  return {
    accepted: true,
    source: "MATCHER",
    classification:
      classification || null,
    method:
      matcherMethod(item) ||
      null,
    matcher_score:
      score,
    v27,
    cloudbet:
      matcherCloudbet(item),
    team_scores:
      teams
  };
}

function findBestMatcher(
  signal: Obj,
  data: Obj
): Obj {
  let best: Obj | null =
    null;

  const diagnostics: Obj[] =
    [];

  for (
    const item of
    matcherMatches(data)
  ) {
    const result =
      validateMatcher(
        signal,
        item
      );

    if (!result.accepted) {
      diagnostics.push({
        reason:
          result.reason,
        score:
          matcherScore(item),
        match:
          displayMatch(
            matcherV27(item)
          ),
        team_scores:
          result.team_scores ??
          null
      });

      continue;
    }

    if (
      !best ||
      result.matcher_score >
        best.matcher_score
    ) {
      best = result;
    }
  }

  if (!best) {
    return {
      found: false,
      reason:
        "NO_ACCEPTABLE_MATCHER_OR_STRICT_CLOUDBET_MATCH",
      diagnostics
    };
  }

  return {
    found: true,
    ...best
  };
}

// ─── CLOUDBET LIVE ─────────────────────────────────────────

function cloudbetMatches(
  data: Obj
): Obj[] {
  for (
    const source of [
      data?.data?.matches,
      data?.matches,
      data?.live_matches,
      data?.events,
      data?.data
    ]
  ) {
    if (
      Array.isArray(source)
    ) {
      return source;
    }
  }

  return [];
}

function isCloudbetLive(
  m: Obj
): boolean {
  const status =
    safe(m?.status)
      .toUpperCase();

  const state =
    safe(m?.state)
      .toUpperCase();

  return (
    status ===
      "TRADING_LIVE" ||
    state === "LIVE" ||
    m?.live === true
  );
}

function findCloudbet(
  signal: Obj,
  liveMatches: Obj[]
): Obj {
  const id =
    signalId(signal);

  if (id) {
    const exact =
      liveMatches.find(
        m =>
          extractMatchId(m) ===
          id
      );

    if (exact) {
      return {
        found: true,
        source:
          "CLOUDBET_ID",
        cloudbet: exact
      };
    }
  }

  let best: Obj | null =
    null;

  for (
    const match of
    liveMatches
  ) {
    const score =
      twoSidedTeamScore(
        signalHome(signal),
        signalAway(signal),
        extractHome(match),
        extractAway(match)
      );

    if (
      score.matched &&
      (
        !best ||
        score.combined_score >
          best.team_scores
            .combined_score
      )
    ) {
      best = {
        cloudbet: match,
        team_scores: score
      };
    }
  }

  if (!best) {
    return {
      found: false,
      source:
        "NOT_FOUND",
      cloudbet: null
    };
  }

  return {
    found: true,
    source:
      "STRICT_TWO_SIDED_TEAMS",
    cloudbet:
      best.cloudbet,
    team_scores:
      best.team_scores
  };
}

function verifyCloudbet(
  signal: Obj,
  matcher: Obj,
  liveMatches: Obj[]
): Obj {
  const matcherCloudbet =
    matcher?.cloudbet;

  const matcherId =
    extractMatchId(
      matcherCloudbet ?? {}
    );

  if (matcherId) {
    const exact =
      liveMatches.find(
        m =>
          extractMatchId(m) ===
          matcherId
      );

    if (exact) {
      const score =
        twoSidedTeamScore(
          signalHome(signal),
          signalAway(signal),
          extractHome(exact),
          extractAway(exact)
        );

      if (score.matched) {
        return {
          verified: true,
          source:
            "MATCHER_CLOUDBET_ID",
          cloudbet: exact,
          cloudbet_id:
            matcherId,
          team_scores:
            score
        };
      }
    }
  }

  const direct =
    findCloudbet(
      signal,
      liveMatches
    );

  if (direct.found) {
    return {
      verified: true,
      source:
        direct.source,
      cloudbet:
        direct.cloudbet,
      cloudbet_id:
        extractMatchId(
          direct.cloudbet
        ),
      team_scores:
        direct.team_scores ??
        null
    };
  }

  return {
    verified: false,
    source:
      "NOT_VERIFIED",
    cloudbet: null,
    cloudbet_id: null
  };
}

// ─── EXACT TARGET EXTRACTION ───────────────────────────────

function enabled(
  selection: Obj
): boolean {
  const status =
    safe(
      selection?.status
    ).toUpperCase();

  return (
    !status ||
    [
      "SELECTION_ENABLED",
      "ENABLED",
      "TRADING",
      "OPEN",
      "ACTIVE"
    ].includes(status)
  );
}

function targetSelection(
  selection: Obj
): boolean {
  return (
    safe(
      selection?.outcome
    ).toLowerCase() ===
      TARGET_OUTCOME &&
    safe(
      selection?.params
    ).toLowerCase() ===
      TARGET_PARAMS
  );
}

function validTarget(
  selection: Obj
): boolean {
  if (
    !targetSelection(
      selection
    )
  ) {
    return false;
  }

  if (
    !enabled(selection)
  ) {
    return false;
  }

  const price =
    Number(
      selection?.price
    );

  if (
    !Number.isFinite(price) ||
    price <= 1
  ) {
    return false;
  }

  const maxStake =
    Number(
      selection?.maxStake
    );

  if (
    Number.isFinite(maxStake) &&
    maxStake <= 0
  ) {
    return false;
  }

  return true;
}

function marketEntries(
  event: Obj
): Obj[] {
  const result: Obj[] =
    [];

  if (
    Array.isArray(
      event?.markets
    )
  ) {
    for (
      const market of
      event.markets
    ) {
      result.push({
        ...market,
        _market_key:
          safe(
            market?.market_key ??
              market?.marketKey ??
              market?.key ??
              market?.market
          )
      });
    }
  } else if (
    event?.markets &&
    typeof event.markets ===
      "object"
  ) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        event.markets
      )
    ) {
      if (
        value &&
        typeof value ===
          "object"
      ) {
        result.push({
          ...(value as Obj),
          _market_key:
            safe(
              (value as Obj)
                ?.market_key ??
                (value as Obj)
                  ?.marketKey ??
                key
            )
        });
      }
    }
  }

  return result;
}

function submarketEntries(
  market: Obj
): Obj[] {
  const result: Obj[] =
    [];

  if (
    Array.isArray(
      market?.submarkets
    )
  ) {
    for (
      const sub of
      market.submarkets
    ) {
      result.push({
        ...sub,
        _submarket_key:
          safe(
            sub?.submarket_key ??
              sub?.submarketKey ??
              sub?.key ??
              sub?.market
          )
      });
    }
  } else if (
    market?.submarkets &&
    typeof market.submarkets ===
      "object"
  ) {
    for (
      const [
        key,
        value
      ] of Object.entries(
        market.submarkets
      )
    ) {
      if (
        value &&
        typeof value ===
          "object"
      ) {
        result.push({
          ...(value as Obj),
          _submarket_key:
            safe(
              (value as Obj)
                ?.submarket_key ??
                (value as Obj)
                  ?.submarketKey ??
                key
            )
        });
      }
    }
  }

  return result;
}

function findExactSelection(
  event: Obj
): Obj | null {
  for (
    const market of
    marketEntries(event)
  ) {
    if (
      safe(
        market?._market_key
      ).toLowerCase() !==
      TARGET_MARKET
    ) {
      continue;
    }

    for (
      const sub of
      submarketEntries(
        market
      )
    ) {
      if (
        safe(
          sub?._submarket_key
        ).toLowerCase() !==
        TARGET_SUBMARKET
      ) {
        continue;
      }

      const selections =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      for (
        const selection of
        selections
      ) {
        if (
          validTarget(
            selection
          )
        ) {
          return selection;
        }
      }
    }
  }

  return null;
}

function extractOdds(
  event: Obj
): number | null {
  const selection =
    findExactSelection(
      event
    );

  if (!selection) {
    return null;
  }

  const price =
    Number(
      selection.price
    );

  return Number.isFinite(
    price
  )
    ? price
    : null;
}

// ─── EXACT DIAGNOSTIC ──────────────────────────────────────

function buildOddsDiagnostic(
  event: Obj
): Obj {
  let marketFound = false;
  let submarketFound = false;
  let selectionPresent = false;
  let selectionValid = false;

  const rows: Obj[] =
    [];

  for (
    const market of
    marketEntries(event)
  ) {
    const marketKey =
      safe(
        market?._market_key
      ).toLowerCase();

    if (
      marketKey !==
      TARGET_MARKET
    ) {
      continue;
    }

    marketFound = true;

    for (
      const sub of
      submarketEntries(
        market
      )
    ) {
      const subKey =
        safe(
          sub?._submarket_key
        ).toLowerCase();

      if (
        subKey !==
        TARGET_SUBMARKET
      ) {
        continue;
      }

      submarketFound = true;

      const selections =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      for (
        const selection of
        selections
      ) {
        const outcome =
          safe(
            selection?.outcome
          ).toLowerCase();

        const params =
          safe(
            selection?.params
          ).toLowerCase();

        const price =
          Number(
            selection?.price
          );

        const maxStake =
          Number(
            selection?.maxStake
          );

        const exact =
          outcome ===
            TARGET_OUTCOME &&
          params ===
            TARGET_PARAMS;

        const valid =
          exact &&
          enabled(
            selection
          ) &&
          Number.isFinite(
            price
          ) &&
          price > 1 &&
          (
            !Number.isFinite(
              maxStake
            ) ||
            maxStake > 0
          );

        if (exact) {
          selectionPresent =
            true;
        }

        if (valid) {
          selectionValid =
            true;
        }

        rows.push({
          market_key:
            marketKey,

          submarket_key:
            subKey,

          outcome,

          params,

          price:
            Number.isFinite(
              price
            )
              ? price
              : null,

          raw_price:
            selection?.price ??
            null,

          status:
            selection?.status ??
            null,

          enabled:
            selection?.enabled ??
            null,

          maxStake:
            Number.isFinite(
              maxStake
            )
              ? maxStake
              : null,

          exact_target:
            exact,

          target:
            valid,

          raw_selection:
            selection
        });
      }
    }
  }

  let reason =
    "TARGET_MARKET_MISSING";

  if (marketFound) {
    reason =
      "TARGET_SUBMARKET_MISSING";
  }

  if (submarketFound) {
    reason =
      selectionPresent
        ? "TARGET_SELECTION_INVALID"
        : "TARGET_SELECTION_MISSING";
  }

  if (selectionValid) {
    reason = "VALID";
  } else if (
    selectionPresent
  ) {
    const target =
      rows.find(
        x =>
          x.exact_target
      );

    if (
      target?.status &&
      ![
        "SELECTION_ENABLED",
        "ENABLED",
        "TRADING",
        "OPEN",
        "ACTIVE"
      ].includes(
        String(
          target.status
        ).toUpperCase()
      )
    ) {
      reason =
        "SELECTION_DISABLED";
    } else if (
      !Number.isFinite(
        Number(
          target?.price
        )
      ) ||
      Number(
        target?.price
      ) <= 1
    ) {
      reason =
        "INVALID_PRICE";
    } else if (
      Number.isFinite(
        Number(
          target?.maxStake
        )
      ) &&
      Number(
        target?.maxStake
      ) <= 0
    ) {
      reason =
        "MAX_STAKE_ZERO";
    }
  }

  return {
    target: {
      market:
        TARGET_MARKET,
      submarket:
        TARGET_SUBMARKET,
      outcome:
        TARGET_OUTCOME,
      params:
        TARGET_PARAMS
    },

    reason,

    extractor_result:
      extractOdds(event),

    target_market_found:
      marketFound,

    target_submarket_found:
      submarketFound,

    target_selection_present:
      selectionPresent,

    target_selection_valid:
      selectionValid,

    selections:
      rows,

    event_id:
      extractMatchId(event),

    match:
      displayMatch(event)
  };
}

// ─── RETRY SAME EVENT ──────────────────────────────────────
//
// Used by PENDING CRON.
// NOT used by /run.
//
// /run uses resolveOddsOnce() below.
// ───────────────────────────────────────────────────────────

async function resolveOddsWithRetry(
  env: Env,
  cloudbet: Obj
): Promise<Obj> {
  const eventId =
    extractMatchId(
      cloudbet
    );

  if (!eventId) {
    return {
      success: false,
      event: cloudbet,
      odds: null,
      attempts: 0,
      error:
        "CLOUDBET_EVENT_ID_MISSING",
      attempts_detail: []
    };
  }

  const attempts: Obj[] =
    [];

  let lastEvent:
    Obj | null = null;

  let lastDiagnostic:
    Obj | null = null;

  for (
    let attempt = 1;
    attempt <=
    ODDS_EVENT_MAX_RETRIES;
    attempt++
  ) {
    try {
      const event =
        await fetchCloudbetEvent(
          env,
          eventId
        );

      lastEvent =
        event;

      const diagnostic =
        buildOddsDiagnostic(
          event
        );

      lastDiagnostic =
        diagnostic;

      const odds =
        extractOdds(
          event
        );

      attempts.push({
        attempt,

        event_id:
          eventId,

        success:
          true,

        odds,

        reason:
          diagnostic.reason,

        target_selection_present:
          diagnostic
            .target_selection_present,

        target_selection_valid:
          diagnostic
            .target_selection_valid
      });

      if (
        odds !== null
      ) {
        return {
          success: true,

          source:
            "CLOUDBET_EVENT_SAME_EVENT_RETRY",

          event,

          odds,

          attempts:
            attempt,

          error: null,

          retry: {
            max_attempts:
              ODDS_EVENT_MAX_RETRIES,

            delay_ms:
              ODDS_EVENT_RETRY_DELAY_MS,

            attempts_used:
              attempt,

            valid_on_attempt:
              attempt
          },

          attempts_detail:
            attempts,

          diagnostic
        };
      }
    } catch (error) {
      attempts.push({
        attempt,

        event_id:
          eventId,

        success:
          false,

        odds: null,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        service:
          error instanceof
          ServiceRequestError
            ? error.service
            : "CLOUDBET",

        path:
          error instanceof
          ServiceRequestError
            ? error.path
            : null,

        code:
          error instanceof
          ServiceRequestError
            ? error.code
            : null
      });
    }

    if (
      attempt <
      ODDS_EVENT_MAX_RETRIES
    ) {
      await sleep(
        ODDS_EVENT_RETRY_DELAY_MS
      );
    }
  }

  return {
    success: false,

    source:
      "CLOUDBET_EVENT_RETRY_EXHAUSTED",

    event:
      lastEvent ??
      cloudbet,

    odds: null,

    attempts:
      attempts.length,

    error:
      "TARGET_1H_OVER_0_5_NOT_FOUND_AFTER_20_ATTEMPTS",

    retry: {
      max_attempts:
        ODDS_EVENT_MAX_RETRIES,

      delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      attempts_used:
        attempts.length,

      valid_on_attempt:
        null
    },

    attempts_detail:
      attempts,

    diagnostic:
      lastDiagnostic ??
      buildOddsDiagnostic(
        lastEvent ??
        cloudbet
      )
  };
}

// ─── SINGLE ODDS ATTEMPT ───────────────────────────────────
//
// V5.9.0 FIX.
//
// Used by /run so the HTTP request cannot be held for
// approximately 9.5 minutes by the persistent retry.
//
// If the exact target is not available on this attempt,
// /run returns immediately and savePending() stores it.
//
// Persistent retry remains in processPending().
// ───────────────────────────────────────────────────────────

async function resolveOddsOnce(
  env: Env,
  cloudbet: Obj
): Promise<Obj> {
  const eventId =
    extractMatchId(
      cloudbet
    );

  if (!eventId) {
    return {
      success: false,

      source:
        "CLOUDBET_EVENT_SINGLE_ATTEMPT",

      event:
        cloudbet,

      odds: null,

      attempts: 0,

      error:
        "CLOUDBET_EVENT_ID_MISSING",

      attempts_detail: []
    };
  }

  try {
    const event =
      await fetchCloudbetEvent(
        env,
        eventId
      );

    const diagnostic =
      buildOddsDiagnostic(
        event
      );

    const odds =
      extractOdds(
        event
      );

    return {
      success:
        odds !== null,

      source:
        "CLOUDBET_EVENT_SINGLE_ATTEMPT",

      event,

      odds,

      attempts: 1,

      error:
        odds !== null
          ? null
          : diagnostic.reason,

      retry: {
        max_attempts: 1,
        delay_ms: 0,
        attempts_used: 1,
        valid_on_attempt:
          odds !== null
            ? 1
            : null
      },

      attempts_detail: [
        {
          attempt: 1,

          event_id:
            eventId,

          success:
            true,

          odds,

          reason:
            diagnostic.reason,

          target_selection_present:
            diagnostic
              .target_selection_present,

          target_selection_valid:
            diagnostic
              .target_selection_valid
        }
      ],

      diagnostic
    };
  } catch (error) {
    return {
      success: false,

      source:
        "CLOUDBET_EVENT_SINGLE_ATTEMPT",

      event:
        cloudbet,

      odds: null,

      attempts: 1,

      error:
        error instanceof Error
          ? error.message
          : String(error),

      retry: {
        max_attempts: 1,
        delay_ms: 0,
        attempts_used: 1,
        valid_on_attempt: null
      },

      attempts_detail: [
        {
          attempt: 1,

          event_id:
            eventId,

          success:
            false,

          odds: null,

          error:
            error instanceof Error
              ? error.message
              : String(error)
        }
      ],

      diagnostic:
        null
    };
  }
}

// ─── BET OBJECT ────────────────────────────────────────────

function buildBet(
  signal: Obj,
  matcher: Obj,
  verification: Obj,
  oddsResult: Obj
): Obj {
  const event =
    oddsResult.event ??
    verification.cloudbet ??
    {};

  const odds =
    oddsResult.odds ??
    extractOdds(event);

  return {
    status:
      odds !== null
        ? "READY"
        : "ODDS_UNAVAILABLE",

    mode:
      MODE,

    betting_enabled:
      BETTING_ENABLED,

    dry_run:
      DRY_RUN,

    signal_type:
      safe(
        signal?.type ??
          signal?.signal_type ??
          signal?.signalType
      ),

    signal_match_id:
      signalId(signal),

    hunter_score:
      Number(
        signal?.hunter_score ??
          signal?.v27?.hunter_score ??
          signal?.score ??
          null
      ),

    match:
      signalMatch(signal) ||
      `${signalHome(signal)} - ${signalAway(signal)}`,

    entry_minute:
      Number(
        signal?.minute ??
          signal?.entry_minute ??
          signal?.v27?.minute ??
          null
      ),

    v27: {
      id:
        signalId(signal),

      home:
        signalHome(signal),

      away:
        signalAway(signal)
    },

    matcher: {
      classification:
        matcher.classification ??
        null,

      method:
        matcher.method ??
        null,

      matcher_score:
        matcher.matcher_score ??
        null,

      team_scores:
        matcher.team_scores ??
        null,

      source:
        matcher.source ??
        "MATCHER"
    },

    cloudbet: {
      id:
        extractMatchId(event),

      match:
        displayMatch(event),

      home:
        extractHome(event),

      away:
        extractAway(event),

      status:
        event?.status ??
        null,

      state:
        event?.state ??
        null,

      live:
        isCloudbetLive(
          event
        ),

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      odds,

      odds_available:
        odds !== null,

      odds_source:
        odds !== null
          ? "CLOUDBET_EVENT"
          : null
    },

    odds_diagnostic:
      oddsResult.diagnostic ??
      buildOddsDiagnostic(
        event
      ),

    full_event_fetch: {
      success:
        oddsResult.success,

      source:
        oddsResult.source,

      attempts:
        oddsResult.attempts,

      retry:
        oddsResult.retry ??
        null,

      error:
        oddsResult.error ??
        null,

      attempts_detail:
        oddsResult.attempts_detail ??
        []
    },

    stake_eur:
      BET_STAKE_EUR,

    bet_placed:
      false,

    simulated:
      true
  };
}

function buildCandidate(
  bet: Obj
): Obj {
  const odds =
    extractOdds(
      bet?.cloudbet ??
        {}
    );

  const complete =
    odds !== null;

  return {
    status:
      "BET_CANDIDATE",

    mode:
      MODE,

    betting_enabled:
      false,

    dry_run:
      true,

    bet_placed:
      false,

    bet_action:
      "SIMULATED_ONLY",

    match:
      bet?.match ??
      null,

    signal_match_id:
      bet?.signal_match_id ??
      null,

    hunter_score:
      bet?.hunter_score ??
      null,

    cloudbet_id:
      extractMatchId(
        bet?.cloudbet ??
          {}
      ),

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    stake_eur:
      BET_STAKE_EUR,

    odds,

    odds_available:
      odds !== null,

    candidate_complete:
      complete,

    odds_source:
      odds !== null
        ? "CLOUDBET_EVENT"
        : null,

    cloudbet:
      bet?.cloudbet ??
      null,

    odds_diagnostic:
      bet?.odds_diagnostic ??
      null,

    full_event_fetch:
      bet?.full_event_fetch ??
      null,

    matcher:
      bet?.matcher ??
      null,

    simulated:
      true
  };
}

// ─── D1 ARCHIVE ────────────────────────────────────────────

function archiveKey(
  bet: Obj
): string {
  const id =
    safe(
      bet?.signal_match_id
    );

  if (id) {
    return `signal:${id}`;
  }

  return `teams:${normalizeTeam(
    bet?.v27?.home ??
      bet?.cloudbet?.home
  )}:${normalizeTeam(
    bet?.v27?.away ??
      bet?.cloudbet?.away
  )}`;
}

async function archiveBets(
  env: Env,
  bets: Obj[]
): Promise<Obj> {
  if (!env.DB) {
    return {
      success: false,
      inserted: 0,
      error:
        "DB_BINDING_MISSING"
    };
  }

  if (!bets.length) {
    return {
      success: true,
      inserted: 0
    };
  }

  const statements =
    bets.map(bet => {
      const matcherScore =
        Number(
          bet?.matcher
            ?.matcher_score
        );

      const hunterScore =
        Number(
          bet?.hunter_score
        );

      const combined =
        Number(
          bet?.matcher
            ?.team_scores
            ?.combined_score
        );

      const minute =
        Number(
          bet?.entry_minute
        );

      return env.DB.prepare(`
        INSERT OR IGNORE INTO hunter_bet_archive
        (
          archive_key,
          match_id,
          match,
          home,
          away,
          entry_minute,
          hunter_score,
          cloudbet_id,
          cloudbet_match,
          matcher_source,
          matcher_score,
          cloudbet_combined_score,
          direction,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        archiveKey(bet),

        safe(
          bet?.signal_match_id
        ) || null,

        safe(
          bet?.match
        ) || null,

        safe(
          bet?.v27?.home
        ) || null,

        safe(
          bet?.v27?.away
        ) || null,

        Number.isFinite(
          minute
        )
          ? minute
          : null,

        Number.isFinite(
          hunterScore
        )
          ? hunterScore
          : null,

        safe(
          bet?.cloudbet?.id
        ) || null,

        safe(
          bet?.cloudbet?.match
        ) || null,

        safe(
          bet?.matcher?.source
        ) || "MATCHER",

        Number.isFinite(
          matcherScore
        )
          ? matcherScore
          : null,

        Number.isFinite(
          combined
        )
          ? combined
          : null,

        safe(
          bet?.matcher
            ?.team_scores
            ?.direction
        ) || null
      );
    });

  try {
    const result =
      await env.DB.batch(
        statements
      );

    return {
      success: true,
      inserted:
        result.length,
      attempted:
        bets.length
    };
  } catch (error) {
    return {
      success: false,
      inserted: 0,
      attempted:
        bets.length,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

// ─── PENDING ODDS ──────────────────────────────────────────

async function savePending(
  env: Env,
  bet: Obj
): Promise<Obj> {
  if (!env.DB) {
    return {
      success: false,
      error:
        "DB_BINDING_MISSING"
    };
  }

  const cloudbetId =
    safe(
      bet?.cloudbet?.id
    );

  if (!cloudbetId) {
    return {
      success: false,
      error:
        "CLOUDBET_ID_MISSING"
    };
  }

  let payload = "{}";

  try {
    payload =
      JSON.stringify(bet);
  } catch {}

  try {
    await env.DB.prepare(`
      INSERT INTO pending_odds
      (
        archive_key,
        signal_match_id,
        cloudbet_id,
        match,
        home,
        away,
        entry_minute,
        market,
        selection,
        stake_eur,
        mode,
        status,
        retry_count,
        missing_count,
        last_checked_at,
        next_check_at,
        payload_json,
        created_at,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'PENDING_ODDS',
        0,
        0,
        NULL,
        datetime('now', '+1 minute'),
        ?,
        datetime('now'),
        datetime('now')
      )
      ON CONFLICT(archive_key)
      DO UPDATE SET
        cloudbet_id = excluded.cloudbet_id,
        signal_match_id = excluded.signal_match_id,
        match = excluded.match,
        home = excluded.home,
        away = excluded.away,
        entry_minute = excluded.entry_minute,
        market = excluded.market,
        selection = excluded.selection,
        stake_eur = excluded.stake_eur,
        mode = excluded.mode,
        payload_json = excluded.payload_json,
        status = 'PENDING_ODDS',
        missing_count = 0,
        next_check_at =
          datetime('now', '+1 minute'),
        updated_at = datetime('now')
    `).bind(
      archiveKey(bet),

      safe(
        bet?.signal_match_id
      ) || null,

      cloudbetId,

      safe(
        bet?.match
      ) || null,

      safe(
        bet?.v27?.home
      ) || null,

      safe(
        bet?.v27?.away
      ) || null,

      Number.isFinite(
        Number(
          bet?.entry_minute
        )
      )
        ? Number(
            bet.entry_minute
          )
        : null,

      BET_MARKET,
      BET_SELECTION,
      BET_STAKE_EUR,
      MODE,
      payload
    ).run();

    return {
      success: true,
      status:
        "PENDING_ODDS",
      archive_key:
        archiveKey(bet),
      cloudbet_id:
        cloudbetId
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

async function pendingRows(
  env: Env
): Promise<Obj[]> {
  const result =
    await env.DB.prepare(`
      SELECT *
      FROM pending_odds
      WHERE
        status = 'PENDING_ODDS'
        AND (
          next_check_at IS NULL
          OR next_check_at <= datetime('now')
        )
      ORDER BY created_at ASC
    `).all();

  return (
    result.results ??
    []
  ) as Obj[];
}

async function invalidate(
  env: Env,
  id: number
): Promise<void> {
  await env.DB.prepare(`
    UPDATE pending_odds
    SET
      status = 'INVALIDATED',
      updated_at = datetime('now'),
      last_checked_at = datetime('now'),
      next_check_at = NULL
    WHERE id = ?
  `).bind(id).run();
}

async function removePending(
  env: Env,
  id: number
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM pending_odds WHERE id = ?`
  ).bind(id).run();
}

async function reschedule(
  env: Env,
  id: number,
  retry: number,
  missing: number
): Promise<void> {
  await env.DB.prepare(`
    UPDATE pending_odds
    SET
      retry_count = ?,
      missing_count = ?,
      last_checked_at = datetime('now'),
      next_check_at = datetime('now', '+1 minute'),
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    retry,
    missing,
    id
  ).run();
}

// ─── PENDING VALIDATION ────────────────────────────────────

function numberValue(
  v: any
): number | null {
  const n = Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function scorePair(
  m: Obj
): {
  home: number | null;
  away: number | null;
} {
  const pairs = [
    [
      m?.home_score,
      m?.away_score
    ],
    [
      m?.homeScore,
      m?.awayScore
    ],
    [
      m?.score?.home,
      m?.score?.away
    ],
    [
      m?.scores?.home,
      m?.scores?.away
    ],
    [
      m?.result?.home,
      m?.result?.away
    ],
    [
      m?.home?.score,
      m?.away?.score
    ]
  ];

  for (
    const [h, a] of pairs
  ) {
    const home =
      numberValue(h);

    const away =
      numberValue(a);

    if (
      home !== null &&
      away !== null
    ) {
      return {
        home,
        away
      };
    }
  }

  const text =
    safe(
      m?.score ??
        m?.result ??
        m?.current_score
    );

  const match =
    text.match(
      /(\d+)\s*[-:]\s*(\d+)/
    );

  if (match) {
    return {
      home:
        Number(match[1]),
      away:
        Number(match[2])
    };
  }

  return {
    home: null,
    away: null
  };
}

function hasGoal(
  m: Obj
): boolean {
  const score =
    scorePair(m);

  return (
    score.home !== null &&
    score.away !== null &&
    (
      score.home > 0 ||
      score.away > 0
    )
  );
}

function isFirstHalf(
  m: Obj
): boolean {
  if (
    hasGoal(m)
  ) {
    return false;
  }

  const period =
    norm(
      m?.period ??
        m?.match_period ??
        m?.phase ??
        m?.state ??
        m?.status
    );

  if (
    /\bfirst half\b|\b1st half\b|\b1h\b/.test(
      period
    )
  ) {
    return true;
  }

  const minute =
    numberValue(
      m?.minute ??
        m?.match_minute ??
        m?.matchMinute ??
        m?.clock?.minute ??
        m?.time?.minute ??
        m?.elapsed
    );

  return (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
  );
}

function pendingValid(
  cloudbet: Obj
): Obj {
  if (!cloudbet) {
    return {
      valid: false,
      reason:
        "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  if (
    !isCloudbetLive(
      cloudbet
    )
  ) {
    return {
      valid: false,
      reason:
        "CLOUDBET_NO_LONGER_LIVE"
    };
  }

  if (
    hasGoal(cloudbet)
  ) {
    return {
      valid: false,
      reason:
        "GOAL_ALREADY_SCORED"
    };
  }

  if (
    !isFirstHalf(
      cloudbet
    )
  ) {
    return {
      valid: false,
      reason:
        "FIRST_HALF_ENDED"
    };
  }

  return {
    valid: true,
    reason:
      "BET_STILL_VALID"
  };
}

// ─── PENDING CRON ──────────────────────────────────────────

async function processPending(
  env: Env
): Promise<Obj> {
  const started =
    Date.now();

  const result: Obj = {
    success: true,
    version:
      VERSION,
    action:
      "PENDING_ODDS_CRON",
    pending_loaded: 0,
    checked: 0,
    odds_found: 0,
    invalidated: 0,
    still_pending: 0,
    errors: 0,
    details: []
  };

  const rows =
    await pendingRows(
      env
    );

  result.pending_loaded =
    rows.length;

  if (!rows.length) {
    result.elapsed_ms =
      Date.now() -
      started;

    return result;
  }

  let liveData: Obj;

  try {
    liveData =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/live",
        "CLOUDBET",
        SERVICE_TIMEOUT_MS
      );
  } catch (error) {
    return {
      ...result,
      success: false,
      errors:
        rows.length,
      error:
        error instanceof Error
          ? error.message
          : String(error),

      service_error:
        error instanceof
        ServiceRequestError
          ? error.toJSON()
          : null
    };
  }

  const liveMatches =
    cloudbetMatches(
      liveData
    );

  const byId =
    new Map<
      string,
      Obj
    >();

  for (
    const match of
    liveMatches
  ) {
    const id =
      extractMatchId(
        match
      );

    if (id) {
      byId.set(
        id,
        match
      );
    }
  }

  for (
    const row of rows
  ) {
    result.checked++;

    const id =
      Number(
        row?.id
      );

    const cloudbetId =
      safe(
        row?.cloudbet_id
      );

    if (
      !Number.isInteger(id) ||
      !cloudbetId
    ) {
      result.errors++;
      continue;
    }

    const live =
      byId.get(
        cloudbetId
      );

    if (!live) {
      const missing =
        Number(
          row?.missing_count ??
            0
        ) + 1;

      if (
        missing >
        MAX_MISSING_CHECKS
      ) {
        await invalidate(
          env,
          id
        );

        result.invalidated++;

        result.details.push({
          id,

          cloudbet_id:
            cloudbetId,

          status:
            "INVALIDATED",

          reason:
            "CLOUDBET_EVENT_NOT_FOUND"
        });
      } else {
        await reschedule(
          env,
          id,
          Number(
            row?.retry_count ??
              0
          ),
          missing
        );

        result.still_pending++;

        result.details.push({
          id,

          cloudbet_id:
            cloudbetId,

          status:
            "PENDING_ODDS",

          reason:
            "CLOUDBET_EVENT_TEMPORARILY_MISSING",

          missing_count:
            missing
        });
      }

      continue;
    }

    const validity =
      pendingValid(
        live
      );

    if (
      !validity.valid
    ) {
      await invalidate(
        env,
        id
      );

      result.invalidated++;

      result.details.push({
        id,

        cloudbet_id:
          cloudbetId,

        status:
          "INVALIDATED",

        reason:
          validity.reason
      });

      continue;
    }

    // IMPORTANT:
    // Persistent retry is intentionally preserved here.
    const oddsResult =
      await resolveOddsWithRetry(
        env,
        live
      );

    if (
      !oddsResult.success ||
      oddsResult.odds === null
    ) {
      await reschedule(
        env,
        id,
        Number(
          row?.retry_count ??
            0
        ) + 1,
        0
      );

      result.still_pending++;

      result.details.push({
        id,

        cloudbet_id:
          cloudbetId,

        status:
          "PENDING_ODDS",

        reason:
          oddsResult.error,

        attempts:
          oddsResult.attempts,

        retry:
          oddsResult.retry,

        attempts_detail:
          oddsResult.attempts_detail,

        diagnostic:
          oddsResult.diagnostic
      });

      continue;
    }

    let bet: Obj = {};

    try {
      bet =
        JSON.parse(
          safe(
            row?.payload_json
          ) || "{}"
        );
    } catch {
      bet = {};
    }

    bet.cloudbet = {
      ...(bet.cloudbet ??
        {}),

      ...(oddsResult.event ??
        {}),

      id:
        cloudbetId,

      odds:
        oddsResult.odds,

      odds_available:
        true,

      odds_source:
        "CLOUDBET_EVENT"
    };

    bet.odds =
      oddsResult.odds;

    bet.odds_available =
      true;

    bet.candidate_complete =
      true;

    bet.full_event_fetch = {
      success:
        oddsResult.success,

      source:
        oddsResult.source,

      attempts:
        oddsResult.attempts,

      retry:
        oddsResult.retry,

      error:
        oddsResult.error
    };

    bet.odds_diagnostic =
      oddsResult.diagnostic;

    await archiveBets(
      env,
      [bet]
    );

    await removePending(
      env,
      id
    );

    result.odds_found++;

    result.details.push({
      id,

      cloudbet_id:
        cloudbetId,

      status:
        "READY",

      odds:
        oddsResult.odds,

      attempts:
        oddsResult.attempts,

      retry:
        oddsResult.retry
    });
  }

  result.elapsed_ms =
    Date.now() -
    started;

  return result;
}

// ─── MAIN RUN ──────────────────────────────────────────────

async function runWorker(
  env: Env
): Promise<Obj> {
  const started =
    Date.now();

  const results =
    await Promise.allSettled([
      fetchServiceJSON(
        env.TRACKER,
        "/entries",
        "TRACKER",
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.MATCHER,
        `/match?threshold=${MATCHER_THRESHOLD}`,
        "MATCHER",
        SERVICE_TIMEOUT_MS
      ),

      fetchServiceJSON(
        env.CLOUDBET,
        "/live",
        "CLOUDBET",
        SERVICE_TIMEOUT_MS
      )
    ]);

  const trackerResult =
    results[0];

  const matcherResult =
    results[1];

  const cloudbetResult =
    results[2];

  const serviceDiagnostics: Obj[] =
    [];

  if (
    trackerResult.status ===
    "rejected"
  ) {
    serviceDiagnostics.push({
      service:
        "TRACKER",

      ...(trackerResult.reason instanceof
      ServiceRequestError
        ? trackerResult.reason.toJSON()
        : {
            code:
              "UNKNOWN_ERROR",

            message:
              trackerResult.reason instanceof
              Error
                ? trackerResult.reason.message
                : String(
                    trackerResult.reason
                  )
          })
    });
  }

  if (
    matcherResult.status ===
    "rejected"
  ) {
    serviceDiagnostics.push({
      service:
        "MATCHER",

      ...(matcherResult.reason instanceof
      ServiceRequestError
        ? matcherResult.reason.toJSON()
        : {
            code:
              "UNKNOWN_ERROR",

            message:
              matcherResult.reason instanceof
              Error
                ? matcherResult.reason.message
                : String(
                    matcherResult.reason
                  )
          })
    });
  }

  if (
    cloudbetResult.status ===
    "rejected"
  ) {
    serviceDiagnostics.push({
      service:
        "CLOUDBET",

      ...(cloudbetResult.reason instanceof
      ServiceRequestError
        ? cloudbetResult.reason.toJSON()
        : {
            code:
              "UNKNOWN_ERROR",

            message:
              cloudbetResult.reason instanceof
              Error
                ? cloudbetResult.reason.message
                : String(
                    cloudbetResult.reason
                  )
          })
    });
  }

  if (
    serviceDiagnostics.length
  ) {
    return {
      success: false,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      mode:
        MODE,

      betting:
        "DISABLED",

      dry_run:
        true,

      action:
        "RUN",

      error:
        "REQUIRED_SERVICE_FAILED",

      timeout_ms:
        SERVICE_TIMEOUT_MS,

      failed_services:
        serviceDiagnostics,

      services: {
        TRACKER:
          trackerResult.status ===
          "fulfilled"
            ? "OK"
            : "FAILED",

        MATCHER:
          matcherResult.status ===
          "fulfilled"
            ? "OK"
            : "FAILED",

        CLOUDBET:
          cloudbetResult.status ===
          "fulfilled"
            ? "OK"
            : "FAILED"
      },

      elapsed_ms:
        Date.now() -
        started
    };
  }

  const trackerData =
    trackerResult.value as Obj;

  const matcherData =
    matcherResult.value as Obj;

  const cloudbetData =
    cloudbetResult.value as Obj;

  const signals =
    extractSignals(
      trackerData
    ).filter(
      isHunterEntry
    );

  const liveMatches =
    cloudbetMatches(
      cloudbetData
    );

  const prepared: Obj[] =
    [];

  const matcherFailures: Obj[] =
    [];

  const verificationFailures: Obj[] =
    [];

  const oddsFailures: Obj[] =
    [];

  for (
    const signal of signals
  ) {
    const matcher =
      findBestMatcher(
        signal,
        matcherData
      );

    if (!matcher.found) {
      matcherFailures.push({
        match:
          signalMatch(
            signal
          ),

        signal_match_id:
          signalId(
            signal
          ),

        reason:
          matcher.reason,

        diagnostics:
          matcher.diagnostics
      });

      continue;
    }

    const verification =
      verifyCloudbet(
        signal,
        matcher,
        liveMatches
      );

    if (
      !verification.verified
    ) {
      verificationFailures.push({
        match:
          signalMatch(
            signal
          ),

        signal_match_id:
          signalId(
            signal
          ),

        reason:
          "CLOUDBET_NOT_VERIFIED"
      });

      continue;
    }

    // ========================================================
    // V5.9.0 FIX:
    //
    // DO NOT use resolveOddsWithRetry() here.
    //
    // One /run request must not wait:
    // 20 attempts × 30 seconds.
    //
    // One Cloudbet event request only.
    // ========================================================

    const oddsResult =
      await resolveOddsOnce(
        env,
        verification.cloudbet
      );

    if (
      !oddsResult.success
    ) {
      oddsFailures.push({
        match:
          signalMatch(
            signal
          ),

        signal_match_id:
          signalId(
            signal
          ),

        cloudbet_id:
          verification.cloudbet_id,

        error:
          oddsResult.error,

        attempts:
          oddsResult.attempts,

        retry:
          oddsResult.retry,

        attempts_detail:
          oddsResult.attempts_detail,

        diagnostic:
          oddsResult.diagnostic
      });
    }

    prepared.push(
      buildBet(
        signal,
        matcher,
        verification,
        oddsResult
      )
    );
  }

  const complete =
    prepared.filter(
      bet =>
        bet?.cloudbet
          ?.odds_available ===
        true
    );

  const incomplete =
    prepared.filter(
      bet =>
        bet?.cloudbet
          ?.odds_available !==
        true
    );

  const pendingResults: Obj[] =
    [];

  for (
    const bet of incomplete
  ) {
    pendingResults.push(
      await savePending(
        env,
        bet
      )
    );
  }

  const archive =
    await archiveBets(
      env,
      complete
    );

  const candidates =
    prepared.map(
      buildCandidate
    );

  return {
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",

    dry_run:
      true,

    action:
      "RUN",

    config: {
      stake_eur:
        BET_STAKE_EUR,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      exact_market:
        TARGET_MARKET,

      exact_submarket:
        TARGET_SUBMARKET,

      exact_outcome:
        TARGET_OUTCOME,

      exact_params:
        TARGET_PARAMS,

      service_timeout_ms:
        SERVICE_TIMEOUT_MS,

      odds_endpoint:
        "/event?id=CLOUDBET_EVENT_ID",

      odds_event_retry:
        false,

      odds_event_max_retries:
        1,

      odds_event_retry_delay_ms:
        0,

      retry_same_event:
        false,

      persistent_pending_retry:
        true,

      pending_retry_max_attempts:
        ODDS_EVENT_MAX_RETRIES,

      pending_retry_delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      switch_event_on_retry:
        false,

      switch_market_on_retry:
        false,

      switch_line_on_retry:
        false,

      ui_odds_comparison:
        false,

      real_betting:
        false
    },

    services: {
      TRACKER:
        "OK",

      MATCHER:
        "OK",

      CLOUDBET:
        "OK"
    },

    tracker: {
      signals_received:
        extractSignals(
          trackerData
        ).length,

      hunter_entries:
        signals.length
    },

    matcher: {
      candidates:
        signals.length,

      matched:
        prepared.length,

      failures:
        matcherFailures.length
    },

    cloudbet: {
      live_matches:
        liveMatches.length,

      verified:
        prepared.length,

      verification_failures:
        verificationFailures.length,

      odds_failures:
        oddsFailures.length
    },

    odds: {
      prepared:
        prepared.length,

      available:
        complete.length,

      unavailable:
        incomplete.length,

      pending_saved:
        pendingResults.filter(
          x =>
            x?.success ===
            true
        ).length,

      pending:
        pendingResults
    },

    candidates: {
      total:
        candidates.length,

      complete:
        candidates.filter(
          x =>
            x?.candidate_complete ===
            true
        ).length,

      incomplete:
        candidates.filter(
          x =>
            x?.candidate_complete !==
            true
        ).length
    },

    archive,

    prepared_bets:
      prepared,

    bet_candidates:
      candidates,

    matcher_failures:
      matcherFailures,

    verification_failures:
      verificationFailures,

    odds_fetch_failures:
      oddsFailures,

    elapsed_ms:
      Date.now() -
      started
  };
}

// ─── /DIAGNOSTIC ───────────────────────────────────────────

async function diagnosticService(
  service: Fetcher,
  serviceName: string,
  path: string
): Promise<Obj> {
  const started =
    Date.now();

  const startedAt =
    new Date().toISOString();

  try {
    const data =
      await fetchServiceJSON(
        service,
        path,
        serviceName,
        SERVICE_TIMEOUT_MS
      );

    const elapsed =
      Date.now() -
      started;

    let serialized = "";

    try {
      serialized =
        JSON.stringify(data);
    } catch {
      serialized = "";
    }

    const result: Obj = {
      service:
        serviceName,

      path,

      success:
        true,

      elapsed_ms:
        elapsed,

      http_status:
        200,

      response_bytes:
        new TextEncoder()
          .encode(serialized)
          .length,

      started_at:
        startedAt
    };

    if (
      serviceName ===
      "TRACKER"
    ) {
      result.signals =
        extractSignals(
          data
        ).length;
    }

    if (
      serviceName ===
      "MATCHER"
    ) {
      result.matches =
        matcherMatches(
          data
        ).length;
    }

    if (
      serviceName ===
      "CLOUDBET"
    ) {
      result.live_events =
        cloudbetMatches(
          data
        ).length;
    }

    return result;
  } catch (error) {
    const elapsed =
      Date.now() -
      started;

    const serviceError =
      error instanceof
      ServiceRequestError
        ? error.toJSON()
        : null;

    return {
      service:
        serviceName,

      path,

      success:
        false,

      elapsed_ms:
        elapsed,

      http_status:
        serviceError?.status ??
        null,

      response_bytes:
        null,

      started_at:
        startedAt,

      error:
        error instanceof Error
          ? error.message
          : String(error),

      service_error:
        serviceError
    };
  }
}

async function diagnosticResponse(
  env: Env
): Promise<Response> {
  const started =
    Date.now();

  const tracker =
    await diagnosticService(
      env.TRACKER,
      "TRACKER",
      "/entries"
    );

  const matcher =
    await diagnosticService(
      env.MATCHER,
      "MATCHER",
      `/match?threshold=${MATCHER_THRESHOLD}`
    );

  const cloudbet =
    await diagnosticService(
      env.CLOUDBET,
      "CLOUDBET",
      "/live"
    );

  const total =
    Date.now() -
    started;

  return json({
    success:
      tracker.success &&
      matcher.success &&
      cloudbet.success,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",

    dry_run:
      true,

    action:
      "DIAGNOSTIC",

    diagnostic_mode:
      "SEQUENTIAL",

    timeout_ms:
      SERVICE_TIMEOUT_MS,

    order: [
      "TRACKER",
      "MATCHER",
      "CLOUDBET"
    ],

    services: {
      TRACKER:
        tracker.success
          ? "OK"
          : "FAILED",

      MATCHER:
        matcher.success
          ? "OK"
          : "FAILED",

      CLOUDBET:
        cloudbet.success
          ? "OK"
          : "FAILED"
    },

    tracker,

    matcher,

    cloudbet,

    total_elapsed_ms:
      total,

    analysis: {
      slowest_service:
        [
          tracker,
          matcher,
          cloudbet
        ].reduce(
          (
            slowest,
            current
          ) =>
            current.elapsed_ms >
            slowest.elapsed_ms
              ? current
              : slowest
        ).service,

      slowest_elapsed_ms:
        Math.max(
          tracker.elapsed_ms,
          matcher.elapsed_ms,
          cloudbet.elapsed_ms
        ),

      expected_relationship:
        "TOTAL ≈ TRACKER + MATCHER + CLOUDBET because diagnostic is sequential"
    }
  });
}

// ─── /LINES ────────────────────────────────────────────────

async function linesResponse(
  env: Env,
  request: Request
): Promise<Response> {
  const id =
    safe(
      new URL(request.url)
        .searchParams
        .get("id")
    );

  if (!id) {
    return json(
      {
        success: false,
        error:
          "CLOUDBET_EVENT_ID_MISSING"
      },
      400
    );
  }

  try {
    const event =
      await fetchCloudbetEvent(
        env,
        id
      );

    return json({
      success: true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      endpoint:
        "/lines",

      read_only:
        true,

      event_id:
        id,

      target: {
        market:
          TARGET_MARKET,

        submarket:
          TARGET_SUBMARKET,

        outcome:
          TARGET_OUTCOME,

        params:
          TARGET_PARAMS
      },

      diagnostic:
        buildOddsDiagnostic(
          event
        ),

      raw_event:
        event
    });
  } catch (error) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-bet-worker",

        version:
          VERSION,

        event_id:
          id,

        error:
          error instanceof Error
            ? error.message
            : String(error),

        service_error:
          error instanceof
          ServiceRequestError
            ? error.toJSON()
            : null
      },
      500
    );
  }
}

// ─── /HEALTH ───────────────────────────────────────────────

function healthResponse(
  env: Env
): Response {
  return json({
    success: true,

    worker:
      "cloudbet-bet-worker",

    version:
      VERSION,

    mode:
      MODE,

    betting:
      "DISABLED",

    dry_run:
      DRY_RUN,

    bindings: {
      TRACKER:
        !!env.TRACKER,

      MATCHER:
        !!env.MATCHER,

      CLOUDBET:
        !!env.CLOUDBET,

      DB:
        !!env.DB
    },

    service_timeout_ms:
      SERVICE_TIMEOUT_MS,

    exact_target: {
      market:
        TARGET_MARKET,

      submarket:
        TARGET_SUBMARKET,

      outcome:
        TARGET_OUTCOME,

      params:
        TARGET_PARAMS
    },

    run_odds: {
      mode:
        "SINGLE_ATTEMPT",

      max_attempts:
        1,

      delay_ms:
        0,

      persistent_pending_retry:
        true
    },

    retry: {
      max_attempts:
        ODDS_EVENT_MAX_RETRIES,

      delay_ms:
        ODDS_EVENT_RETRY_DELAY_MS,

      delay_seconds:
        ODDS_EVENT_RETRY_DELAY_MS /
        1000,

      retry_same_event:
        true,

      switch_event:
        false,

      switch_market:
        false,

      switch_line:
        false
    },

    endpoints: [
      "/health",
      "/lines?id=EVENT_ID",
      "/diagnostic",
      "/run",
      "/pending",
      "/archive"
    ]
  });
}

// ─── /PENDING ──────────────────────────────────────────────

async function pendingResponse(
  env: Env
): Promise<Response> {
  try {
    const result =
      await env.DB.prepare(`
        SELECT
          id,
          archive_key,
          signal_match_id,
          cloudbet_id,
          match,
          home,
          away,
          entry_minute,
          market,
          selection,
          stake_eur,
          mode,
          status,
          retry_count,
          missing_count,
          last_checked_at,
          next_check_at,
          created_at,
          updated_at
        FROM pending_odds
        WHERE status = 'PENDING_ODDS'
        ORDER BY created_at ASC
      `).all();

    return json({
      success: true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      status:
        "PENDING_ODDS",

      count:
        result.results?.length ??
        0,

      pending:
        result.results ??
        []
    });
  } catch (error) {
    return json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}

// ─── /ARCHIVE ──────────────────────────────────────────────

async function archiveResponse(
  env: Env
): Promise<Response> {
  try {
    const totalResult =
      await env.DB.prepare(`
        SELECT COUNT(*) AS total
        FROM hunter_bet_archive
      `).first();

    const result =
      await env.DB.prepare(`
        SELECT
          id,
          archive_key,
          match_id,
          match,
          home,
          away,
          entry_minute,
          hunter_score,
          cloudbet_id,
          cloudbet_match,
          matcher_source,
          matcher_score,
          cloudbet_combined_score,
          direction,
          created_at
        FROM hunter_bet_archive
        ORDER BY id DESC
        LIMIT 200
      `).all();

    return json({
      success: true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      status:
        "ARCHIVE",

      table:
        "hunter_bet_archive",

      total:
        Number(
          totalResult?.total ??
            0
        ),

      returned:
        result.results?.length ??
        0,

      archive:
        result.results ??
        []
    });
  } catch (error) {
    return json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : String(error)
      },
      500
    );
  }
}

// ─── WORKER ────────────────────────────────────────────────

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/" ||
      url.pathname === "/health"
    ) {
      return healthResponse(
        env
      );
    }

    if (
      url.pathname ===
      "/diagnostic"
    ) {
      if (
        request.method !==
        "GET"
      ) {
        return json(
          {
            success: false,
            error:
              "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      try {
        return await diagnosticResponse(
          env
        );
      } catch (error) {
        return json(
          {
            success: false,

            worker:
              "cloudbet-bet-worker",

            version:
              VERSION,

            action:
              "DIAGNOSTIC",

            error:
              error instanceof Error
                ? error.message
                : String(error)
          },
          500
        );
      }
    }

    if (
      url.pathname ===
      "/lines"
    ) {
      if (
        request.method !==
        "GET"
      ) {
        return json(
          {
            success: false,
            error:
              "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      return linesResponse(
        env,
        request
      );
    }

    if (
      url.pathname ===
      "/run"
    ) {
      if (
        request.method !==
        "GET"
      ) {
        return json(
          {
            success: false,
            error:
              "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      try {
        return json(
          await runWorker(
            env
          )
        );
      } catch (error) {
        return json(
          {
            success: false,

            worker:
              "cloudbet-bet-worker",

            version:
              VERSION,

            mode:
              MODE,

            betting:
              "DISABLED",

            error:
              error instanceof Error
                ? error.message
                : String(error),

            stack:
              error instanceof Error
                ? error.stack
                : null
          },
          500
        );
      }
    }

    if (
      url.pathname ===
      "/pending"
    ) {
      return pendingResponse(
        env
      );
    }

    if (
      url.pathname ===
      "/archive"
    ) {
      if (
        request.method !==
        "GET"
      ) {
        return json(
          {
            success: false,
            error:
              "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      return archiveResponse(
        env
      );
    }

    return json(
      {
        success: false,

        error:
          "NOT_FOUND",

        path:
          url.pathname,

        available: [
          "/health",
          "/lines?id=EVENT_ID",
          "/diagnostic",
          "/run",
          "/pending",
          "/archive"
        ]
      },
      404
    );
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(
      processPending(env)
        .then(result => {
          console.log(
            JSON.stringify({
              cron: true,
              version:
                VERSION,
              ...result
            })
          );
        })
        .catch(error => {
          console.error(
            JSON.stringify({
              cron: true,
              version:
                VERSION,
              success: false,
              error:
                error instanceof Error
                  ? error.message
                  : String(error)
            })
          );
        })
    );
  }
};
