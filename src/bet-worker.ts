// ============================================================
// CLOUDBET BET WORKER V5.8.6
// DRY RUN · PERSISTENT ODDS RETRY
// EXACT 1H TOTAL GOALS OVER 0.5
//
// V5.8.6:
// - /lines diagnostic endpoint
// - READ-ONLY Cloudbet /event inspection
// - Shows exact market/submarket/selections
// - Does NOT change Matcher logic
// - Does NOT place bets
// - Does NOT change pending odds logic
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type AnyObj = Record<string, any>;

// ─── CONFIG ────────────────────────────────────────────────

const VERSION = "V5.8.6";
const MODE = "DRY_RUN";
const BETTING_ENABLED = false;
const DRY_RUN = true;

const BET_STAKE_EUR = 10;
const BET_MARKET = "1H Total Goals";
const BET_SELECTION = "OVER 0.5";

const MATCHER_THRESHOLD = 0.20;
const STRONG_MATCHER_SCORE = 0.20;
const MIN_MATCHER_SCORE = 0.20;

const TEAM_MATCH_MIN_SCORE = 0.70;
const CHARACTER_SIMILARITY_MIN_SCORE = 0.70;
const CONTAINMENT_MIN_SCORE = 0.75;
const EXACT_TEAM_SCORE = 1.00;

const TOKEN_MATCH_MIN_SCORE = 0.75;
const TOKEN_MIN_COMMON = 1;

const REQUIRED_MATCH_CLASSIFICATION = "CONFIDENT_MATCH";
const ALLOWED_SIGNAL_TYPE = "HUNTER_ENTRY";

const TARGET_SPORT = "SOCCER";
const TARGET_PERIOD = "FIRST_HALF";
const TARGET_OUTCOME = "OVER";
const TARGET_LINE = 0.5;

const TARGET_MARKET_KEYS = new Set([
  "soccer.total_goals",
  "soccer.total_goals_period_first_half"
]);

const TARGET_SUBMARKET_KEY = "period=1h";
const TARGET_OUTCOME_KEY = "over";
const TARGET_PARAMS = "total=0.5";

const TARGET_MARKET_URLS = new Set([
  "soccer.total_goals/over?total=0.5",
  "soccer.total_goals_period_first_half/over?total=0.5"
]);

const MAX_MISSING_CHECKS = 3;

// ─── ALIASES ───────────────────────────────────────────────

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

// ─── BASIC HELPERS ─────────────────────────────────────────

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });

const safe = (v: any) => String(v ?? "").trim();

const norm = (v: any) =>
  safe(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function applyAliases(value: string): string {
  let r = norm(value);

  for (const [alias, full] of Object.entries(TEAM_ALIASES)) {
    const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const re = new RegExp(
      `(^|\\s)${escapedAlias}(?=\\s|$)`,
      "g"
    );

    r = r.replace(re, `$1${full}`);
  }

  return r.replace(/\s+/g, " ").trim();
}

function normalizeTeam(v: any): string {
  return applyAliases(safe(v))
    .split(" ")
    .filter(
      w =>
        w &&
        !GENERIC_WORDS.has(w) &&
        !/^\d+$/.test(w)
    )
    .join(" ")
    .trim();
}

function teamTokens(v: any): string[] {
  return normalizeTeam(v)
    .split(" ")
    .filter(w => w.length >= 3);
}

function splitMatchName(
  v: any
): { home: string | null; away: string | null } {
  const text = safe(v);

  for (const sep of [
    " - ",
    " v ",
    " vs ",
    " VS ",
    " @ "
  ]) {
    const i = text.indexOf(sep);

    if (i >= 0) {
      return {
        home: text.slice(0, i).trim(),
        away: text.slice(i + sep.length).trim()
      };
    }
  }

  return {
    home: null,
    away: null
  };
}

// ─── MATCH EXTRACTION ──────────────────────────────────────

function extractHome(m: AnyObj): string {
  const vals = [
    m?.v27?.home,
    m?.v27?.homeTeam,
    m?.v27?.home_name,

    m?.home,
    m?.homeTeam,
    m?.home_name,

    m?.home?.name,
    m?.home_team?.name,

    m?.teams?.home?.name
  ];

  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return (
    splitMatchName(
      m?.match ??
      m?.name ??
      m?.event_name ??
      ""
    ).home ?? ""
  );
}

function extractAway(m: AnyObj): string {
  const vals = [
    m?.v27?.away,
    m?.v27?.awayTeam,
    m?.v27?.away_name,

    m?.away,
    m?.awayTeam,
    m?.away_name,

    m?.away?.name,
    m?.away_team?.name,

    m?.teams?.away?.name
  ];

  for (const v of vals) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return (
    splitMatchName(
      m?.match ??
      m?.name ??
      m?.event_name ??
      ""
    ).away ?? ""
  );
}

const displayMatch = (m: AnyObj) =>
  safe(
    m?.match ??
    m?.name ??
    m?.event_name
  ) ||
  `${extractHome(m)} - ${extractAway(m)}`;

const extractMatchId = (m: AnyObj) =>
  safe(
    m?.id ??
    m?.match_id ??
    m?.matchId ??
    m?.key ??
    m?.event_id ??
    m?.eventId
  );

const teamsPresent = (h: any, a: any) =>
  !!normalizeTeam(h) &&
  !!normalizeTeam(a);

// ─── TEAM MATCHING ─────────────────────────────────────────

function levenshtein(
  a: string,
  b: string
): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  );

  let curr = new Array<number>(
    b.length + 1
  );

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost =
        a[i - 1] === b[j - 1]
          ? 0
          : 1;

      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }

    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
}

function characterSimilarity(
  a: any,
  b: any
): number {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  return Math.max(
    0,
    1 -
      levenshtein(A, B) /
        Math.max(A.length, B.length)
  );
}

function teamMatchScore(
  a: any,
  b: any
): AnyObj {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) {
    return {
      score: 0,
      method: "EMPTY",
      accepted: false
    };
  }

  if (A === B) {
    return {
      score: EXACT_TEAM_SCORE,
      method: "EXACT",
      accepted: true
    };
  }

  if (A.includes(B) || B.includes(A)) {
    const score = Math.max(
      CONTAINMENT_MIN_SCORE,
      Math.min(A.length, B.length) /
        Math.max(A.length, B.length)
    );

    return {
      score,
      method: "CONTAINMENT",
      accepted:
        score >= CONTAINMENT_MIN_SCORE
    };
  }

  const tA = teamTokens(A);
  const tB = teamTokens(B);

  const common = tA.filter(
    t => tB.includes(t)
  );

  if (common.length >= TOKEN_MIN_COMMON) {
    const score =
      common.length /
      Math.max(tA.length, tB.length);

    if (
      score >= TOKEN_MATCH_MIN_SCORE
    ) {
      return {
        score,
        method: "TOKEN_STRONG",
        accepted: true,
        common_tokens: common
      };
    }
  }

  const score =
    characterSimilarity(A, B);

  return {
    score,
    method: "CHARACTER_SIMILARITY",
    accepted:
      score >=
      CHARACTER_SIMILARITY_MIN_SCORE
  };
}

function twoSidedTeamScore(
  hA: any,
  aA: any,
  hB: any,
  aB: any
): AnyObj {
  const nH = teamMatchScore(hA, hB);
  const nA = teamMatchScore(aA, aB);

  const rH = teamMatchScore(hA, aB);
  const rA = teamMatchScore(aA, hB);

  const nScore = Math.min(
    nH.score,
    nA.score
  );

  const rScore = Math.min(
    rH.score,
    rA.score
  );

  const nValid =
    nH.accepted &&
    nA.accepted &&
    nH.score >= TEAM_MATCH_MIN_SCORE &&
    nA.score >= TEAM_MATCH_MIN_SCORE;

  const rValid =
    rH.accepted &&
    rA.accepted &&
    rH.score >= TEAM_MATCH_MIN_SCORE &&
    rA.score >= TEAM_MATCH_MIN_SCORE;

  if (nValid && nScore >= rScore) {
    return {
      matched: true,
      direction: "NORMAL",
      home_score: nH.score,
      away_score: nA.score,
      combined_score: nScore,
      both_teams_pass: true,
      home_method: nH.method,
      away_method: nA.method
    };
  }

  if (rValid) {
    return {
      matched: true,
      direction: "REVERSED",
      home_score: rH.score,
      away_score: rA.score,
      combined_score: rScore,
      both_teams_pass: true,
      home_method: rH.method,
      away_method: rA.method
    };
  }

  return {
    matched: false,
    direction:
      nScore >= rScore
        ? "NORMAL"
        : "REVERSED",
    home_score:
      nScore >= rScore
        ? nH.score
        : rH.score,
    away_score:
      nScore >= rScore
        ? nA.score
        : rA.score,
    combined_score:
      Math.max(nScore, rScore),
    both_teams_pass: false
  };
}

// ─── SERVICE ────────────────────────────────────────────────

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<AnyObj> {
  const res = await service.fetch(
    new Request(
      `https://service${path}`,
      {
        method: "GET",
        headers: {
          accept: "application/json"
        }
      }
    )
  );

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status} ${path}: ${text.slice(
        0,
        500
      )}`
    );
  }

  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Invalid JSON from ${path}`
    );
  }
}

async function fetchCloudbetEvent(
  service: Fetcher,
  eventId: string
): Promise<AnyObj> {
  const id = safe(eventId);

  if (!id || !/^\d+$/.test(id)) {
    throw new Error(
      `INVALID_CLOUDBET_EVENT_ID: ${id}`
    );
  }

  const res =
    await fetchServiceJSON(
      service,
      `/event?id=${encodeURIComponent(id)}`
    );

  return (
    res?.data &&
    typeof res.data === "object"
  )
    ? res.data
    : res;
}

// ─── TRACKER ───────────────────────────────────────────────

const extractSignals = (
  d: AnyObj
): AnyObj[] => {
  const v =
    d?.signals ??
    d?.entries ??
    d?.hunter_entries ??
    d?.data ??
    [];

  return Array.isArray(v)
    ? v.filter(
        x =>
          x &&
          typeof x === "object"
      )
    : [];
};

const isHunterEntry = (
  s: AnyObj
) =>
  safe(
    s?.type ??
    s?.signal_type ??
    s?.signalType
  ).toUpperCase() ===
  ALLOWED_SIGNAL_TYPE;

const signalMatchId = (
  s: AnyObj
) =>
  safe(
    s?.match_id ??
    s?.matchId ??
    s?.id ??
    s?.v27?.id
  );

const signalMatchName = (
  s: AnyObj
) =>
  safe(
    s?.match ??
    s?.name ??
    s?.v27?.match
  );

const signalHome = (
  s: AnyObj
) =>
  safe(
    s?.v27?.home ??
    extractHome(s)
  );

const signalAway = (
  s: AnyObj
) =>
  safe(
    s?.v27?.away ??
    extractAway(s)
  );

// ─── MATCHER ───────────────────────────────────────────────

const extractMatcherMatches = (
  d: AnyObj
): AnyObj[] => {
  const v =
    d?.matches ??
    d?.results ??
    d?.matched ??
    d?.candidates ??
    [];

  return Array.isArray(v)
    ? v
    : [];
};

const getMatcherScore = (
  item: AnyObj
) => {
  const s =
    item?.scoring ??
    item?.matcher_scoring ??
    item?.score_details ??
    {};

  const n = Number(
    s?.total ??
    s?.score ??
    item?.matcher_score ??
    item?.match_score ??
    item?.score ??
    0
  );

  return Number.isFinite(n)
    ? n
    : 0;
};

const getClassification = (
  item: AnyObj
) =>
  safe(
    item?.classification ??
    item?.match_classification ??
    item?.security?.classification
  ).toUpperCase();

const getMatchMethod = (
  item: AnyObj
) =>
  safe(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method
  ).toUpperCase();

const extractV27 = (
  item: AnyObj
) =>
  item?.v27 ??
  item?.source ??
  item;

const extractCloudbetFromMatcher = (
  item: AnyObj
) =>
  item?.cloudbet ??
  item?.target ??
  item?.matched_cloudbet ??
  null;

function validateMatcherCandidate(
  signal: AnyObj,
  item: AnyObj
): AnyObj {
  if (
    item?.security?.score_only_match === true ||
    item?.score_only_match === true
  ) {
    return {
      accepted: false,
      reason:
        "SCORE_ONLY_MATCH_REJECTED"
    };
  }

  const v27 =
    extractV27(item);

  const cloudbet =
    extractCloudbetFromMatcher(item);

  const classification =
    getClassification(item);

  const method =
    getMatchMethod(item);

  const matcherScore =
    getMatcherScore(item);

  const sH = signalHome(signal);
  const sA = signalAway(signal);

  const vH = extractHome(v27);
  const vA = extractAway(v27);

  if (!teamsPresent(sH, sA)) {
    return {
      accepted: false,
      reason:
        "SIGNAL_TEAMS_EMPTY"
    };
  }

  if (!teamsPresent(vH, vA)) {
    return {
      accepted: false,
      reason:
        "V27_TEAMS_EMPTY"
    };
  }

  const teamScore =
    twoSidedTeamScore(
      sH,
      sA,
      vH,
      vA
    );

  if (!teamScore.matched) {
    return {
      accepted: false,
      reason:
        "STRICT_SIGNAL_TEAMS_MISMATCH",
      team_scores: teamScore
    };
  }

  if (
    method === "EXACT_ID" &&
    matcherScore <= 0
  ) {
    return {
      accepted: false,
      reason:
        "EXACT_ID_WITH_ZERO_SCORE_REJECTED"
    };
  }

  if (
    matcherScore <
    MIN_MATCHER_SCORE
  ) {
    return {
      accepted: false,
      reason:
        "MATCHER_SCORE_TOO_LOW"
    };
  }

  const confident =
    classification ===
    REQUIRED_MATCH_CLASSIFICATION;

  const strong =
    matcherScore >=
    STRONG_MATCHER_SCORE;

  if (!confident && !strong) {
    return {
      accepted: false,
      reason:
        "NOT_CONFIDENT_AND_SCORE_NOT_STRONG"
    };
  }

  return {
    accepted: true,
    reason: confident
      ? "CONFIDENT_MATCH_ACCEPTED"
      : "STRICT_TWO_SIDED_MATCH_ACCEPTED",

    source: "MATCHER",

    classification,
    method,

    matcher_score:
      matcherScore,

    v27: {
      id: extractMatchId(v27),
      match: displayMatch(v27),
      home: vH,
      away: vA
    },

    cloudbet: cloudbet
      ? {
          id: extractMatchId(
            cloudbet
          ),
          match:
            displayMatch(cloudbet),
          home:
            extractHome(cloudbet),
          away:
            extractAway(cloudbet)
        }
      : null,

    team_scores:
      teamScore
  };
}

function findBestMatcherCandidate(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj {
  const matches =
    extractMatcherMatches(
      matcherData
    );

  let best: AnyObj | null =
    null;

  const rejectionReasons:
    Record<string, number> = {};

  for (const item of matches) {
    const r =
      validateMatcherCandidate(
        signal,
        item
      );

    if (r.accepted) {
      if (
        !best ||
        r.matcher_score >
          best.matcher_score
      ) {
        best = r;
      }

      continue;
    }

    const reason =
      r.reason ??
      "UNKNOWN";

    rejectionReasons[reason] =
      (rejectionReasons[reason] ??
        0) + 1;
  }

  if (!best) {
    return {
      found: false,
      reason:
        "NO_ACCEPTABLE_MATCHER_CANDIDATE",
      diagnostics: {
        candidates_checked:
          matches.length,
        rejection_reasons:
          rejectionReasons
      }
    };
  }

  return {
    found: true,
    ...best,
    diagnostics: {
      candidates_checked:
        matches.length,
      rejection_reasons:
        rejectionReasons
    }
  };
}

// ─── CLOUDBET ──────────────────────────────────────────────

function extractCloudbetMatches(
  data: AnyObj
): AnyObj[] {
  for (const v of [
    data?.data?.matches,
    data?.matches,
    data?.live_matches,
    data?.events,
    data?.data
  ]) {
    if (Array.isArray(v)) {
      return v.filter(
        x =>
          x &&
          typeof x === "object"
      );
    }
  }

  return [];
}

function isCloudbetLive(
  m: AnyObj
): boolean {
  const status =
    safe(
      m?.status ??
      m?.event_status ??
      m?.trading_status
    ).toUpperCase();

  const state =
    safe(m?.state).toUpperCase();

  return (
    status === "TRADING_LIVE" ||
    state === "LIVE" ||
    m?.live === true
  );
}

function findCloudbetRawJsonPresence(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  const sH =
    signalHome(signal);

  const sA =
    signalAway(signal);

  const signalId =
    signalMatchId(signal);

  const matches =
    extractCloudbetMatches(
      rawData
    );

  let best: AnyObj | null =
    null;

  for (const cb of matches) {
    const cbH =
      extractHome(cb);

    const cbA =
      extractAway(cb);

    if (
      !teamsPresent(sH, sA) ||
      !teamsPresent(cbH, cbA)
    ) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sH,
        sA,
        cbH,
        cbA
      );

    if (!score.matched) {
      continue;
    }

    const cbId =
      extractMatchId(cb);

    const idMatch =
      !!signalId &&
      !!cbId &&
      signalId === cbId;

    const candidate = {
      ...cb,

      _presence: {
        id_match: idMatch,
        ...score,
        live:
          isCloudbetLive(cb)
      }
    };

    if (idMatch) {
      return {
        found: true,
        source: "RAW_JSON",

        status:
          isCloudbetLive(cb)
            ? "JSON_PRESENT"
            : "JSON_PRESENT_NOT_LIVE",

        cloudbet: candidate
      };
    }

    if (
      !best ||
      score.combined_score >
        best?._presence
          ?.combined_score
    ) {
      best = candidate;
    }
  }

  if (best) {
    return {
      found: true,
      source: "RAW_JSON",

      status:
        isCloudbetLive(best)
          ? "JSON_PRESENT"
          : "JSON_PRESENT_NOT_LIVE",

      cloudbet: best
    };
  }

  return {
    found: false,
    source: "RAW_JSON",
    status:
      "MISSING_FROM_LIVE_JSON",
    cloudbet: null
  };
}

function findDirectCloudbet(
  signal: AnyObj,
  liveMatches: AnyObj[]
): AnyObj {
  const signalId =
    signalMatchId(signal);

  const sH =
    signalHome(signal);

  const sA =
    signalAway(signal);

  if (signalId) {
    const byId =
      liveMatches.find(
        c =>
          extractMatchId(c) ===
          signalId
      );

    if (byId) {
      return {
        found: true,
        source:
          "CLOUDBET_ID",
        cloudbet: byId
      };
    }
  }

  let best: AnyObj | null =
    null;

  for (const cb of liveMatches) {
    if (!isCloudbetLive(cb)) {
      continue;
    }

    const score =
      twoSidedTeamScore(
        sH,
        sA,
        extractHome(cb),
        extractAway(cb)
      );

    if (!score.matched) {
      continue;
    }

    const cand = {
      ...cb,
      _match_score: score
    };

    if (
      !best ||
      score.combined_score >
        best?._match_score
          ?.combined_score
    ) {
      best = cand;
    }
  }

  return best
    ? {
        found: true,
        source:
          "CLOUDBET_TEAMS",
        cloudbet: best
      }
    : {
        found: false,
        source:
          "CLOUDBET_DIRECT",
        cloudbet: null
      };
}

// ─── ODDS EXTRACTION ───────────────────────────────────────

const isTargetMarketKey = (
  k: any
) =>
  TARGET_MARKET_KEYS.has(
    safe(k).toLowerCase()
  );

function isSelectionEnabled(
  sel: AnyObj
): boolean {
  const s =
    safe(sel?.status)
      .toUpperCase();

  return (
    !s ||
    [
      "SELECTION_ENABLED",
      "ENABLED",
      "TRADING",
      "OPEN",
      "ACTIVE"
    ].includes(s)
  );
}

function extractSelectionPrice(
  sel: AnyObj
): number | null {
  const p =
    Number(sel?.price);

  return Number.isFinite(p) &&
    p > 1
    ? p
    : null;
}

function extractMarketEntries(
  match: AnyObj
): AnyObj[] {
  const result: AnyObj[] = [];

  if (
    !match ||
    typeof match !== "object"
  ) {
    return result;
  }

  const add = (
    v: any,
    key = ""
  ) => {
    if (
      v &&
      typeof v === "object"
    ) {
      result.push({
        ...v,
        _market_key: safe(
          key ||
          v?.marketKey ||
          v?.key ||
          v?.market
        )
      });
    }
  };

  const markets =
    match?.markets;

  if (Array.isArray(markets)) {
    for (const m of markets) {
      add(m);
    }
  } else if (
    markets &&
    typeof markets === "object"
  ) {
    for (const [k, v] of Object.entries(
      markets
    )) {
      add(v, k);
    }
  }

  for (const [k, v] of Object.entries(
    match
  )) {
    if (
      k === "markets" ||
      !v ||
      typeof v !== "object" ||
      Array.isArray(v)
    ) {
      continue;
    }

    if (k.startsWith("soccer.")) {
      add(v, k);
    }
  }

  return result;
}

function extractSubmarketEntries(
  market: AnyObj
): AnyObj[] {
  const raw =
    market?.submarkets;

  if (Array.isArray(raw)) {
    return raw
      .filter(
        x =>
          x &&
          typeof x === "object"
      )
      .map(item => ({
        ...item,
        _submarket_key: safe(
          item?._submarket_key ??
          item?.submarketKey ??
          item?.key
        )
      }));
  }

  if (
    raw &&
    typeof raw === "object"
  ) {
    return Object.entries(raw)
      .filter(
        ([, v]) =>
          v &&
          typeof v === "object"
      )
      .map(([k, v]) => ({
        ...(v as AnyObj),
        _submarket_key: k
      }));
  }

  return [];
}

function isTargetFirstHalfSubmarket(
  key: string
): boolean {
  const n =
    safe(key).toLowerCase();

  return (
    n ===
      TARGET_SUBMARKET_KEY ||
    (
      n.includes("period=1h") &&
      !n.includes("team=")
    )
  );
}

function isTargetOver05Selection(
  sel: AnyObj
): boolean {
  if (
    safe(sel?.outcome)
      .toLowerCase() !==
    TARGET_OUTCOME_KEY
  ) {
    return false;
  }

  if (
    safe(sel?.params)
      .toLowerCase() ===
    TARGET_PARAMS
  ) {
    return true;
  }

  return TARGET_MARKET_URLS.has(
    safe(
      sel?.marketUrl
    ).toLowerCase()
  );
}

function extractFirstHalfOver05Odds(
  match: AnyObj
): number | null {
  if (
    !match ||
    typeof match !== "object"
  ) {
    return null;
  }

  for (const market of extractMarketEntries(
    match
  )) {
    const mKey =
      safe(
        market?._market_key ??
        market?.marketKey ??
        market?.key ??
        market?.market
      ).toLowerCase();

    if (!isTargetMarketKey(mKey)) {
      continue;
    }

    for (const sub of extractSubmarketEntries(
      market
    )) {
      const subKey =
        safe(
          sub?._submarket_key ??
          sub?.submarketKey ??
          sub?.key
        );

      if (
        !isTargetFirstHalfSubmarket(
          subKey
        )
      ) {
        continue;
      }

      const sels =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      for (const sel of sels) {
        if (
          !sel ||
          typeof sel !== "object"
        ) {
          continue;
        }

        if (
          !isTargetOver05Selection(
            sel
          )
        ) {
          continue;
        }

        if (
          !isSelectionEnabled(sel)
        ) {
          continue;
        }

        const price =
          extractSelectionPrice(
            sel
          );

        if (price === null) {
          continue;
        }

        const maxStake =
          Number(sel?.maxStake);

        if (
          Number.isFinite(maxStake) &&
          maxStake <= 0
        ) {
          continue;
        }

        return price;
      }
    }
  }

  return null;
}

function extractOddsRecursive(
  root: any
): number | null {
  const visited =
    new Set<any>();

  function walk(
    node: any,
    ctx: string,
    mKey = "",
    sKey = ""
  ): number | null {
    if (
      node == null ||
      typeof node !== "object" ||
      visited.has(node)
    ) {
      return null;
    }

    visited.add(node);

    let curM = safe(
      node?.marketKey ??
      node?.market ??
      mKey
    );

    let curS = safe(
      node?.submarketKey ??
      sKey
    );

    if (
      safe(node?.key)
        .toLowerCase()
        .startsWith("soccer.")
    ) {
      curM = safe(node.key);
    }

    if (
      safe(node?._market_key)
        .toLowerCase()
        .startsWith("soccer.")
    ) {
      curM =
        safe(node._market_key);
    }

    if (
      safe(node?.submarketKey)
    ) {
      curS =
        safe(node.submarketKey);
    }

    if (
      safe(node?._submarket_key)
    ) {
      curS =
        safe(node._submarket_key);
    }

    const outcome =
      safe(node?.outcome)
        .toLowerCase();

    const params =
      safe(node?.params)
        .toLowerCase();

    const mUrl =
      safe(node?.marketUrl)
        .toLowerCase();

    const exactM =
      isTargetMarketKey(curM);

    const exactS =
      curS.toLowerCase() ===
        TARGET_SUBMARKET_KEY ||
      (
        norm(
          [
            ctx,
            curM,
            curS,
            node?.marketUrl,
            node?.url,
            node?.name,
            node?.outcome,
            node?.selection,
            node?.side,
            node?.params
          ].join(" ")
        ).includes(
          "period 1h"
        ) &&
        !norm(ctx).includes(
          "team="
        )
      );

    const exactO =
      outcome ===
      TARGET_OUTCOME_KEY;

    const exactP =
      params ===
      TARGET_PARAMS;

    const exactU =
      TARGET_MARKET_URLS.has(
        mUrl
      );

    if (
      node?.price !== undefined &&
      exactM &&
      exactS &&
      exactO &&
      exactP &&
      isSelectionEnabled(node)
    ) {
      const p =
        extractSelectionPrice(
          node
        );

      const ms =
        Number(node?.maxStake);

      if (
        p !== null &&
        (
          !Number.isFinite(ms) ||
          ms > 0
        )
      ) {
        return p;
      }
    }

    if (
      node?.price !== undefined &&
      exactU &&
      isSelectionEnabled(node)
    ) {
      const p =
        extractSelectionPrice(
          node
        );

      const ms =
        Number(node?.maxStake);

      if (
        p !== null &&
        (
          !Number.isFinite(ms) ||
          ms > 0
        )
      ) {
        return p;
      }
    }

    if (Array.isArray(node)) {
      for (const c of node) {
        const f =
          walk(
            c,
            ctx,
            curM,
            curS
          );

        if (f !== null) {
          return f;
        }
      }

      return null;
    }

    for (const [
      k,
      child
    ] of Object.entries(node)) {
      if (
        !child ||
        typeof child !== "object"
      ) {
        continue;
      }

      let nextM = curM;
      let nextS = curS;

      if (
        k.startsWith("soccer.")
      ) {
        nextM = k;
      }

      if (
        k.startsWith("period=")
      ) {
        nextS = k;
      }

      if (
        k === "_market_key" &&
        safe(node[k])
          .toLowerCase()
          .startsWith("soccer.")
      ) {
        nextM =
          safe(node[k]);
      }

      if (
        k === "_submarket_key" &&
        safe(node[k])
          .toLowerCase()
          .startsWith("period=")
      ) {
        nextS =
          safe(node[k]);
      }

      const f =
        walk(
          child,
          `${ctx} ${norm(k)}`,
          nextM,
          nextS
        );

      if (f !== null) {
        return f;
      }
    }

    return null;
  }

  return walk(
    root,
    ""
  );
}

const extractOdds = (
  m: AnyObj
): number | null =>
  extractFirstHalfOver05Odds(m) ??
  extractOddsRecursive(m);

// ============================================================
// V5.8.6 — /lines DIAGNOSTIC
// ============================================================

function buildLinesDiagnostic(
  match: AnyObj
): AnyObj {
  const markets =
    extractMarketEntries(match);

  const marketRows: AnyObj[] = [];

  for (const market of markets) {
    const marketKey =
      safe(
        market?._market_key ??
        market?.marketKey ??
        market?.key ??
        market?.market
      );

    const submarkets =
      extractSubmarketEntries(
        market
      );

    const subRows: AnyObj[] = [];

    for (const sub of submarkets) {
      const subKey =
        safe(
          sub?._submarket_key ??
          sub?.submarketKey ??
          sub?.key
        );

      const selections =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      const selectionRows =
        selections.map(
          (sel: AnyObj) => {
            const outcome =
              safe(
                sel?.outcome
              ).toLowerCase();

            const params =
              safe(
                sel?.params
              ).toLowerCase();

            const marketUrl =
              safe(
                sel?.marketUrl
              ).toLowerCase();

            const price =
              extractSelectionPrice(
                sel
              );

            const enabled =
              isSelectionEnabled(
                sel
              );

            const exactMarket =
              isTargetMarketKey(
                marketKey
              );

            const exactSub =
              isTargetFirstHalfSubmarket(
                subKey
              );

            const exactOutcome =
              outcome ===
              TARGET_OUTCOME_KEY;

            const exactParams =
              params ===
              TARGET_PARAMS;

            const exactUrl =
              TARGET_MARKET_URLS.has(
                marketUrl
              );

            const exactTarget =
              exactMarket &&
              exactSub &&
              exactOutcome &&
              (
                exactParams ||
                exactUrl
              );

            return {
              outcome:
                outcome || null,

              params:
                params || null,

              marketUrl:
                marketUrl || null,

              price,

              raw_price:
                sel?.price ??
                null,

              status:
                safe(
                  sel?.status
                ) || null,

              enabled,

              maxStake:
                sel?.maxStake ??
                null,

              exact_checks: {
                market:
                  exactMarket,

                submarket:
                  exactSub,

                outcome:
                  exactOutcome,

                params:
                  exactParams,

                market_url:
                  exactUrl,

                enabled,

                target:
                  exactTarget
              },

              raw_selection:
                sel
            };
          }
        );

      subRows.push({
        key:
          subKey || null,

        target_first_half:
          isTargetFirstHalfSubmarket(
            subKey
          ),

        selection_count:
          selectionRows.length,

        selections:
          selectionRows
      });
    }

    marketRows.push({
      market_key:
        marketKey || null,

      target_market:
        isTargetMarketKey(
          marketKey
        ),

      submarket_count:
        subRows.length,

      submarkets:
        subRows
    });
  }

  const extracted =
    extractOdds(match);

  return {
    diagnostic_version:
      "V5.8.6_LINES",

    cloudbet_id:
      extractMatchId(match),

    match:
      displayMatch(match),

    home:
      extractHome(match),

    away:
      extractAway(match),

    live:
      isCloudbetLive(match),

    status:
      match?.status ??
      null,

    state:
      match?.state ??
      null,

    target: {
      market_keys:
        [...TARGET_MARKET_KEYS],

      submarket:
        TARGET_SUBMARKET_KEY,

      outcome:
        TARGET_OUTCOME_KEY,

      params:
        TARGET_PARAMS,

      market_urls:
        [...TARGET_MARKET_URLS]
    },

    extractor_result: {
      odds:
        extracted,

      found:
        extracted !== null
    },

    markets: {
      count:
        marketRows.length,

      keys:
        marketRows
          .map(
            x =>
              x.market_key
          )
          .filter(Boolean),

      rows:
        marketRows
    },

    raw_event_keys:
      Object.keys(match ?? {}),

    raw_event:
      match
  };
}

async function linesResponse(
  env: Env,
  request: Request
): Promise<Response> {
  const url =
    new URL(request.url);

  const requestedId =
    safe(
      url.searchParams.get(
        "id"
      )
    );

  if (!requestedId) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-bet-worker",
        version: VERSION,
        endpoint: "/lines",

        error:
          "MISSING_EVENT_ID",

        usage:
          "/lines?id=CLOUDBET_EVENT_ID"
      },
      400
    );
  }

  if (
    !/^\d+$/.test(
      requestedId
    )
  ) {
    return json(
      {
        success: false,
        worker:
          "cloudbet-bet-worker",
        version: VERSION,
        endpoint: "/lines",

        error:
          "INVALID_EVENT_ID",

        event_id:
          requestedId
      },
      400
    );
  }

  const started =
    Date.now();

  try {
    const result =
      await fetchCloudbetEvent(
        env.CLOUDBET,
        requestedId
      );

    const event =
      result &&
      typeof result === "object"
        ? result
        : {};

    const diagnostic =
      buildLinesDiagnostic(
        event
      );

    return json({
      success: true,

      worker:
        "cloudbet-bet-worker",

      version:
        VERSION,

      mode:
        "READ_ONLY_DIAGNOSTIC",

      endpoint:
        "/lines",

      event_id:
        requestedId,

      fetched:
        true,

      elapsed_ms:
        Date.now() - started,

      diagnostic
    });
  } catch (e) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-bet-worker",

        version:
          VERSION,

        mode:
          "READ_ONLY_DIAGNOSTIC",

        endpoint:
          "/lines",

        event_id:
          requestedId,

        error:
          e instanceof Error
            ? e.message
            : String(e),

        elapsed_ms:
          Date.now() - started
      },
      500
    );
  }
}

// ─── ODDS DIAGNOSTIC ───────────────────────────────────────

function buildOddsDiagnostic(
  match: AnyObj
): AnyObj {
  const markets =
    extractMarketEntries(match);

  const marketKeys = [
    ...new Set(
      markets
        .map(
          m =>
            safe(
              m?._market_key ??
              m?.marketKey ??
              m?.key ??
              m?.market
            )
        )
        .filter(Boolean)
    )
  ];

  const targetMarkets =
    markets.filter(m =>
      isTargetMarketKey(
        safe(
          m?._market_key ??
          m?.marketKey ??
          m?.key ??
          m?.market
        )
      )
    );

  const soccerTG =
    markets.filter(
      m =>
        safe(
          m?._market_key ??
          m?.marketKey ??
          m?.key ??
          m?.market
        ).toLowerCase() ===
        "soccer.total_goals"
    );

  const soccerTGSubs:
    AnyObj[] = [];

  for (const m of soccerTG) {
    for (const sub of extractSubmarketEntries(
      m
    )) {
      const key =
        safe(
          sub?._submarket_key ??
          sub?.submarketKey ??
          sub?.key
        );

      const sels =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      soccerTGSubs.push({
        key:
          key || null,

        target_first_half:
          isTargetFirstHalfSubmarket(
            key
          ),

        selections:
          sels.map(
            (s: AnyObj) => ({
              outcome:
                safe(
                  s?.outcome
                ) || null,

              params:
                safe(
                  s?.params
                ) || null,

              marketUrl:
                safe(
                  s?.marketUrl
                ) || null,

              price:
                extractSelectionPrice(
                  s
                ),

              raw_price:
                s?.price ??
                null,

              status:
                safe(
                  s?.status
                ) || null,

              maxStake:
                s?.maxStake ??
                null,

              enabled:
                isSelectionEnabled(
                  s
                ),

              target_outcome:
                safe(
                  s?.outcome
                ).toLowerCase() ===
                TARGET_OUTCOME_KEY,

              target_params:
                safe(
                  s?.params
                ).toLowerCase() ===
                TARGET_PARAMS,

              target_market_url:
                TARGET_MARKET_URLS.has(
                  safe(
                    s?.marketUrl
                  ).toLowerCase()
                )
            })
          )
      });
    }
  }

  let targetSubFound =
    false;

  let targetSelFound =
    false;

  let targetPrice:
    number | null = null;

  const targetSubs:
    AnyObj[] = [];

  for (const m of targetMarkets) {
    for (const sub of extractSubmarketEntries(
      m
    )) {
      const key =
        safe(
          sub?._submarket_key ??
          sub?.submarketKey ??
          sub?.key
        );

      const isTargetSub =
        isTargetFirstHalfSubmarket(
          key
        );

      const sels =
        Array.isArray(
          sub?.selections
        )
          ? sub.selections
          : [];

      const selInfo:
        AnyObj[] = [];

      for (const s of sels) {
        if (
          !s ||
          typeof s !== "object"
        ) {
          continue;
        }

        const outcome =
          safe(
            s?.outcome
          ).toLowerCase();

        const params =
          safe(
            s?.params
          ).toLowerCase();

        const mUrl =
          safe(
            s?.marketUrl
          ).toLowerCase();

        const price =
          extractSelectionPrice(
            s
          );

        const isTarget =
          isTargetSub &&
          outcome ===
            TARGET_OUTCOME_KEY &&
          (
            params ===
              TARGET_PARAMS ||
            TARGET_MARKET_URLS.has(
              mUrl
            )
          );

        if (isTarget) {
          targetSelFound = true;

          if (
            price !== null
          ) {
            targetPrice =
              price;
          }
        }

        selInfo.push({
          outcome:
            outcome || null,

          params:
            params || null,

          marketUrl:
            mUrl || null,

          price,

          raw_price:
            s?.price ??
            null,

          status:
            safe(
              s?.status
            ) || null,

          maxStake:
            s?.maxStake ??
            null,

          enabled:
            isSelectionEnabled(
              s
            ),

          target:
            isTarget
        });
      }

      if (isTargetSub) {
        targetSubFound = true;
      }

      targetSubs.push({
        key:
          key || null,

        target:
          isTargetSub,

        selections:
          selInfo
      });
    }
  }

  const hasMarkets =
    Array.isArray(
      match?.markets
    ) ||
    (
      match?.markets &&
      typeof match.markets ===
        "object"
    ) ||
    markets.length > 0;

  return {
    cloudbet_id:
      extractMatchId(match),

    has_markets:
      hasMarkets,

    markets_type:
      Array.isArray(
        match?.markets
      )
        ? "array"
        : (
            match?.markets &&
            typeof match.markets ===
              "object"
          )
          ? "object"
          : markets.length
            ? "derived"
            : "missing",

    market_count:
      markets.length,

    market_keys:
      marketKeys.slice(
        0,
        100
      ),

    target_markets:
      [...TARGET_MARKET_KEYS],

    target_market_found:
      targetMarkets.length > 0,

    target_submarket:
      TARGET_SUBMARKET_KEY,

    target_submarket_found:
      targetSubFound,

    target_selection:
      `${TARGET_OUTCOME_KEY}?${TARGET_PARAMS}`,

    target_selection_found:
      targetSelFound,

    target_price:
      targetPrice,

    target_submarkets:
      targetSubs,

    soccer_total_goals_found:
      soccerTG.length > 0,

    soccer_total_goals_market_count:
      soccerTG.length,

    soccer_total_goals_submarkets:
      soccerTGSubs
  };
}

// ─── RESOLVE FULL EVENT ────────────────────────────────────

async function resolveCloudbetOddsEvent(
  env: Env,
  cloudbet: AnyObj
): Promise<AnyObj> {
  const id =
    extractMatchId(
      cloudbet
    );

  if (!id) {
    return {
      event: cloudbet,
      source:
        "LIVE_EVENT_FALLBACK",
      success: false,
      error:
        "CLOUDBET_EVENT_ID_MISSING",
      diagnostic:
        buildOddsDiagnostic(
          cloudbet
        )
    };
  }

  try {
    const full =
      await fetchCloudbetEvent(
        env.CLOUDBET,
        id
      );

    const event =
      full &&
      typeof full === "object"
        ? full
        : cloudbet;

    return {
      event,
      source:
        "CLOUDBET_FULL_EVENT",
      success: true,
      error: null,
      diagnostic:
        buildOddsDiagnostic(
          event
        )
    };
  } catch (e) {
    return {
      event: cloudbet,
      source:
        "LIVE_EVENT_FALLBACK",
      success: false,
      error:
        e instanceof Error
          ? e.message
          : String(e),
      diagnostic:
        buildOddsDiagnostic(
          cloudbet
        )
    };
  }
}

// ─── ODDS HELPERS ──────────────────────────────────────────

const getCloudbetId = (
  bet: AnyObj
) =>
  safe(
    bet?.cloudbet?.id ??
    bet?.cloudbet_id ??
    bet?.cloudbet?.match_id
  );

function updateBetOdds(
  bet: AnyObj
): boolean {
  const cb =
    bet?.cloudbet;

  if (
    !cb ||
    typeof cb !== "object"
  ) {
    return false;
  }

  const odds =
    extractOdds(cb);

  if (odds === null) {
    return false;
  }

  cb.odds =
    odds;

  cb.odds_available =
    true;

  cb.odds_source =
    "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS";

  bet.odds =
    odds;

  bet.odds_available =
    true;

  bet.candidate_complete =
    true;

  return true;
}

function buildCloudbetIdMap(
  matches: AnyObj[]
): Map<string, AnyObj> {
  const map =
    new Map<
      string,
      AnyObj
    >();

  for (const m of matches) {
    const id =
      extractMatchId(m);

    if (id) {
      map.set(id, m);
    }
  }

  return map;
}

// ─── MATCH STATE ───────────────────────────────────────────

function extractNumber(
  v: any
): number | null {
  if (
    v == null ||
    v === ""
  ) {
    return null;
  }

  const n =
    Number(v);

  return Number.isFinite(n)
    ? n
    : null;
}

function extractScorePair(
  m: AnyObj
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
      m?.score?.home_score,
      m?.score?.away_score
    ],
    [
      m?.scores?.home,
      m?.scores?.away
    ],
    [
      m?.scores?.home_score,
      m?.scores?.away_score
    ],
    [
      m?.result?.home,
      m?.result?.away
    ],
    [
      m?.result?.home_score,
      m?.result?.away_score
    ],
    [
      m?.home?.score,
      m?.away?.score
    ],
    [
      m?.homeTeam?.score,
      m?.awayTeam?.score
    ]
  ];

  for (const [h, a] of pairs) {
    const home =
      extractNumber(h);

    const away =
      extractNumber(a);

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
  m: AnyObj
): boolean {
  const s =
    extractScorePair(m);

  if (
    s.home !== null &&
    s.away !== null
  ) {
    return (
      s.home > 0 ||
      s.away > 0
    );
  }

  const text =
    norm(
      [
        m?.score,
        m?.result,
        m?.status_text,
        m?.event_status
      ]
        .map(safe)
        .join(" ")
    );

  return (
    /\b[1-9]\s*[-:]\s*[0-9]\b/.test(
      text
    ) ||
    /\b[0-9]\s*[-:]\s*[1-9]\b/.test(
      text
    )
  );
}

function extractMinute(
  m: AnyObj
): number | null {
  for (const v of [
    m?.minute,
    m?.match_minute,
    m?.matchMinute,
    m?.clock?.minute,
    m?.time?.minute,
    m?.game_time,
    m?.elapsed
  ]) {
    const n =
      extractNumber(v);

    if (n !== null) {
      return n;
    }

    const match =
      safe(v).match(
        /(\d{1,3})/
      );

    if (match) {
      return Number(
        match[1]
      );
    }
  }

  return null;
}

function isFirstHalf(
  m: AnyObj
): boolean {
  if (hasGoal(m)) {
    return false;
  }

  const period =
    norm(
      m?.period ??
      m?.match_period ??
      m?.phase ??
      m?.state ??
      m?.status ??
      ""
    );

  if (
    /\bfirst half\b|\b1st half\b|\b1h\b/.test(
      period
    )
  ) {
    return true;
  }

  const min =
    extractMinute(m);

  return (
    min !== null &&
    min >= 0 &&
    min <= 45
  );
}

function pendingIsStillValid(
  cb: AnyObj
): {
  valid: boolean;
  reason: string;
} {
  if (!cb) {
    return {
      valid: false,
      reason:
        "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  if (
    !isCloudbetLive(cb)
  ) {
    return {
      valid: false,
      reason:
        "CLOUDBET_NO_LONGER_LIVE"
    };
  }

  if (hasGoal(cb)) {
    return {
      valid: false,
      reason:
        "GOAL_ALREADY_SCORED"
    };
  }

  if (!isFirstHalf(cb)) {
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

// ─── ARCHIVE ───────────────────────────────────────────────

function archiveKey(
  bet: AnyObj
): string {
  const sid =
    safe(
      bet?.signal_match_id
    );

  if (sid) {
    return `signal:${sid}`;
  }

  const h =
    normalizeTeam(
      bet?.v27?.home ??
      bet?.cloudbet?.home
    );

  const a =
    normalizeTeam(
      bet?.v27?.away ??
      bet?.cloudbet?.away
    );

  return `teams:${h}:${a}`;
}

async function archivePreparedBets(
  env: Env,
  bets: AnyObj[]
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      inserted: 0,
      skipped:
        bets.length,
      error:
        "DB_BINDING_MISSING"
    };
  }

  if (!bets.length) {
    return {
      success: true,
      inserted: 0,
      skipped: 0
    };
  }

  const stmts:
    D1PreparedStatement[] = [];

  for (const bet of bets) {
    const matcherScore =
      Number(
        bet?.matcher?.matcher_score ??
        bet?.matcher_score ??
        0
      );

    const entryMinute =
      Number(
        bet?.entry_minute ??
        bet?.minute ??
        bet?.signal?.minute ??
        null
      );

    const hunterScore =
      Number(
        bet?.hunter_score ??
        bet?.signal?.hunter_score ??
        bet?.signal?.v27?.hunter_score ??
        bet?.signal?.score ??
        null
      );

    const cbCombined =
      Number(
        bet?.cloudbet_combined_score ??
        bet?.matcher?.cloudbet_combined_score ??
        bet?.matcher?.team_scores?.combined_score ??
        null
      );

    const direction =
      safe(
        bet?.direction ??
        bet?.matcher?.direction
      ) || null;

    const matcherSource =
      safe(
        bet?.matcher_source ??
        bet?.matcher?.source
      ) || "MATCHER";

    stmts.push(
      env.DB.prepare(`
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
          bet?.v27?.home ??
          bet?.home ??
          bet?.cloudbet?.home
        ) || null,

        safe(
          bet?.v27?.away ??
          bet?.away ??
          bet?.cloudbet?.away
        ) || null,

        Number.isFinite(
          entryMinute
        )
          ? entryMinute
          : null,

        Number.isFinite(
          hunterScore
        )
          ? hunterScore
          : null,

        getCloudbetId(bet) ||
          null,

        safe(
          bet?.cloudbet_match ??
          bet?.cloudbet?.match ??
          bet?.match
        ) || null,

        matcherSource,

        Number.isFinite(
          matcherScore
        )
          ? matcherScore
          : null,

        Number.isFinite(
          cbCombined
        )
          ? cbCombined
          : null,

        direction
      )
    );
  }

  try {
    const result =
      await env.DB.batch(
        stmts
      );

    return {
      success: true,
      inserted:
        result.length,
      attempted:
        bets.length
    };
  } catch (e) {
    return {
      success: false,
      inserted: 0,
      attempted:
        bets.length,
      error:
        e instanceof Error
          ? e.message
          : String(e)
    };
  }
}

// ─── PENDING ODDS ──────────────────────────────────────────

async function savePendingOdds(
  env: Env,
  bet: AnyObj
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      error:
        "DB_BINDING_MISSING"
    };
  }

  const archive =
    archiveKey(bet);

  const signalId =
    safe(
      bet?.signal_match_id
    );

  const cloudbetId =
    getCloudbetId(bet);

  if (!cloudbetId) {
    return {
      success: false,
      error:
        "CLOUDBET_ID_MISSING"
    };
  }

  const home =
    safe(
      bet?.v27?.home ??
      bet?.cloudbet?.home
    );

  const away =
    safe(
      bet?.v27?.away ??
      bet?.cloudbet?.away
    );

  const match =
    safe(bet?.match);

  const entryMinute =
    Number(
      bet?.entry_minute ??
      bet?.minute ??
      null
    );

  let payload =
    "{}";

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
        cloudbet_id =
          excluded.cloudbet_id,

        signal_match_id =
          excluded.signal_match_id,

        match =
          excluded.match,

        home =
          excluded.home,

        away =
          excluded.away,

        entry_minute =
          excluded.entry_minute,

        market =
          excluded.market,

        selection =
          excluded.selection,

        stake_eur =
          excluded.stake_eur,

        mode =
          excluded.mode,

        payload_json =
          excluded.payload_json,

        status =
          'PENDING_ODDS',

        retry_count =
          pending_odds.retry_count,

        missing_count =
          0,

        updated_at =
          datetime('now'),

        next_check_at =
          datetime('now', '+1 minute')
    `).bind(
      archive,
      signalId || null,
      cloudbetId,
      match || null,
      home || null,
      away || null,

      Number.isFinite(
        entryMinute
      )
        ? entryMinute
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
        archive,
      cloudbet_id:
        cloudbetId
    };
  } catch (e) {
    return {
      success: false,
      error:
        e instanceof Error
          ? e.message
          : String(e)
    };
  }
}

const deletePending = (
  env: Env,
  id: number
) =>
  env.DB
    .prepare(
      `DELETE FROM pending_odds WHERE id = ?`
    )
    .bind(id)
    .run();

const invalidatePending = (
  env: Env,
  id: number
) =>
  env.DB
    .prepare(`
      UPDATE pending_odds
      SET
        status = 'INVALIDATED',
        updated_at = datetime('now'),
        last_checked_at = datetime('now'),
        next_check_at = NULL
      WHERE id = ?
    `)
    .bind(id)
    .run();

async function loadPendingRows(
  env: Env
): Promise<AnyObj[]> {
  const r =
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
    r.results ?? []
  ) as AnyObj[];
}

const reschedulePending = (
  env: Env,
  id: number,
  retry: number,
  missing: number
) =>
  env.DB.prepare(`
    UPDATE pending_odds
    SET
      retry_count = ?,
      missing_count = ?,
      last_checked_at = datetime('now'),
      next_check_at = datetime('now', '+1 minute'),
      updated_at = datetime('now')
    WHERE id = ?
  `)
    .bind(
      retry,
      missing,
      id
    )
    .run();

// ─── PENDING CRON ──────────────────────────────────────────

async function processPendingOdds(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  const diag: AnyObj = {
    success: true,
    version: VERSION,
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

  if (!env.DB) {
    return {
      ...diag,
      success: false,
      error:
        "DB_BINDING_MISSING"
    };
  }

  let rows:
    AnyObj[];

  try {
    rows =
      await loadPendingRows(
        env
      );
  } catch (e) {
    return {
      ...diag,
      success: false,
      error:
        e instanceof Error
          ? e.message
          : String(e)
    };
  }

  diag.pending_loaded =
    rows.length;

  if (!rows.length) {
    diag.elapsed_ms =
      Date.now() - started;

    return diag;
  }

  let rawData:
    AnyObj;

  try {
    rawData =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      );
  } catch (e) {
    diag.success = false;
    diag.errors =
      rows.length;

    diag.error =
      e instanceof Error
        ? e.message
        : String(e);

    diag.elapsed_ms =
      Date.now() - started;

    return diag;
  }

  const liveMatches =
    extractCloudbetMatches(
      rawData
    );

  const byId =
    buildCloudbetIdMap(
      liveMatches
    );

  diag.cloudbet_live_matches =
    liveMatches.length;

  for (const row of rows) {
    diag.checked++;

    const rowId =
      Number(row?.id);

    const cbId =
      safe(row?.cloudbet_id);

    if (!Number.isInteger(rowId)) {
      diag.errors++;
      continue;
    }

    if (!cbId) {
      await invalidatePending(
        env,
        rowId
      );

      diag.invalidated++;

      diag.details.push({
        id: rowId,
        status:
          "INVALIDATED",
        reason:
          "CLOUDBET_ID_MISSING"
      });

      continue;
    }

    const liveCb =
      byId.get(cbId);

    if (!liveCb) {
      const missing =
        Number(
          row?.missing_count ??
          0
        ) + 1;

      if (
        missing >
        MAX_MISSING_CHECKS
      ) {
        await invalidatePending(
          env,
          rowId
        );

        diag.invalidated++;

        diag.details.push({
          id: rowId,
          cloudbet_id:
            cbId,
          status:
            "INVALIDATED",
          reason:
            "CLOUDBET_EVENT_NOT_FOUND",
          missing_count:
            missing
        });
      } else {
        await reschedulePending(
          env,
          rowId,
          Number(
            row?.retry_count ??
            0
          ),
          missing
        );

        diag.still_pending++;

        diag.details.push({
          id: rowId,
          cloudbet_id:
            cbId,
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

    if (
      Number(
        row?.missing_count ??
        0
      ) > 0
    ) {
      await env.DB
        .prepare(`
          UPDATE pending_odds
          SET
            missing_count = 0,
            updated_at = datetime('now')
          WHERE id = ?
        `)
        .bind(rowId)
        .run();
    }

    const validity =
      pendingIsStillValid(
        liveCb
      );

    if (!validity.valid) {
      await invalidatePending(
        env,
        rowId
      );

      diag.invalidated++;

      diag.details.push({
        id: rowId,
        cloudbet_id:
          cbId,
        status:
          "INVALIDATED",
        reason:
          validity.reason
      });

      continue;
    }

    const oddsRes =
      await resolveCloudbetOddsEvent(
        env,
        liveCb
      );

    const odds =
      extractOdds(
        oddsRes.event
      );

    if (odds === null) {
      const retry =
        Number(
          row?.retry_count ??
          0
        ) + 1;

      await reschedulePending(
        env,
        rowId,
        retry,
        0
      );

      diag.still_pending++;

      diag.details.push({
        id: rowId,
        cloudbet_id:
          cbId,
        status:
          "PENDING_ODDS",
        odds: null,
        retry_count:
          retry,
        missing_count:
          0,

        reason:
          "TARGET_1H_TOTAL_GOALS_OVER_0_5_NOT_FOUND",

        full_event_fetch: {
          success:
            oddsRes.success,
          source:
            oddsRes.source,
          error:
            oddsRes.error
        },

        odds_diagnostic:
          oddsRes.diagnostic
      });

      continue;
    }

    let bet:
      AnyObj = {};

    try {
      if (
        safe(
          row?.payload_json
        )
      ) {
        bet =
          JSON.parse(
            row.payload_json
          );
      }
    } catch {}

    if (
      !bet ||
      typeof bet !==
        "object"
    ) {
      bet = {};
    }

    bet.cloudbet = {
      ...(bet.cloudbet ??
        {}),

      ...oddsRes.event,

      id:
        cbId,

      odds,
      odds_available:
        true,

      odds_source:
        "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
    };

    bet.odds =
      odds;

    bet.odds_available =
      true;

    bet.candidate_complete =
      true;

    bet.cloudbet_id =
      cbId;

    bet.signal_match_id =
      safe(
        row?.signal_match_id
      );

    bet.match =
      safe(row?.match) ||
      displayMatch(
        oddsRes.event
      );

    bet.v27 =
      bet.v27 ??
      {
        id: safe(
          row?.signal_match_id
        ),
        home:
          safe(row?.home),
        away:
          safe(row?.away)
      };

    bet.market =
      BET_MARKET;

    bet.selection =
      BET_SELECTION;

    bet.stake_eur =
      BET_STAKE_EUR;

    bet.odds_diagnostic =
      oddsRes.diagnostic;

    bet.full_event_fetch = {
      success:
        oddsRes.success,
      source:
        oddsRes.source,
      error:
        oddsRes.error
    };

    const archive =
      await archivePreparedBets(
        env,
        [bet]
      );

    await deletePending(
      env,
      rowId
    );

    diag.odds_found++;

    diag.details.push({
      id: rowId,
      cloudbet_id:
        cbId,
      status:
        "READY",
      odds,

      odds_source:
        "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS",

      odds_diagnostic:
        oddsRes.diagnostic,

      archive
    });
  }

  diag.elapsed_ms =
    Date.now() - started;

  return diag;
}

// ─── VERIFY CLOUDBET ───────────────────────────────────────

async function verifyCloudbet(
  signal: AnyObj,
  matcherResult: AnyObj,
  liveMatches: AnyObj[],
  rawData: AnyObj
): Promise<AnyObj> {
  const matcherCbId =
    extractMatchId(
      matcherResult?.cloudbet ??
      {}
    );

  if (matcherCbId) {
    const byId =
      liveMatches.find(
        c =>
          extractMatchId(c) ===
          matcherCbId
      );

    if (byId) {
      const score =
        twoSidedTeamScore(
          signalHome(signal),
          signalAway(signal),
          extractHome(byId),
          extractAway(byId)
        );

      if (score.matched) {
        return {
          verified: true,
          source:
            "MATCHER_CLOUDBET_ID",
          cloudbet:
            byId,
          cloudbet_id:
            matcherCbId,
          team_scores:
            score
        };
      }
    }
  }

  const direct =
    findDirectCloudbet(
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
        direct.cloudbet
          ?._match_score ??
        null
    };
  }

  const raw =
    findCloudbetRawJsonPresence(
      signal,
      rawData
    );

  if (
    raw.found &&
    raw.cloudbet
  ) {
    const score =
      twoSidedTeamScore(
        signalHome(signal),
        signalAway(signal),
        extractHome(
          raw.cloudbet
        ),
        extractAway(
          raw.cloudbet
        )
      );

    if (score.matched) {
      return {
        verified: true,

        source:
          raw.status ===
          "JSON_PRESENT_NOT_LIVE"
            ? "RAW_JSON_NOT_LIVE"
            : "RAW_JSON",

        cloudbet:
          raw.cloudbet,

        cloudbet_id:
          extractMatchId(
            raw.cloudbet
          ),

        team_scores:
          score,

        cloudbet_live:
          isCloudbetLive(
            raw.cloudbet
          )
      };
    }
  }

  return {
    verified: false,
    source:
      "NOT_VERIFIED",
    cloudbet: null,
    cloudbet_id: null
  };
}

// ─── PREPARED BET ──────────────────────────────────────────

function buildPreparedBet(
  signal: AnyObj,
  matcherResult: AnyObj,
  verification: AnyObj,
  oddsEvent?: AnyObj,
  oddsDiagnostic?: AnyObj,
  fullEventError?:
    string | null
): AnyObj {
  const cb =
    oddsEvent ??
    verification?.cloudbet ??
    matcherResult?.cloudbet ??
    {};

  const odds =
    extractOdds(cb);

  const hunterScore =
    Number(
      signal?.hunter_score ??
      signal?.v27?.hunter_score ??
      signal?.score ??
      null
    );

  return {
    status:
      "READY",

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
      signalMatchId(signal),

    hunter_score:
      Number.isFinite(
        hunterScore
      )
        ? hunterScore
        : null,

    match:
      signalMatchName(
        signal
      ) ||
      `${signalHome(signal)} - ${signalAway(signal)}`,

    v27: {
      id:
        signalMatchId(
          signal
        ),

      home:
        signalHome(signal),

      away:
        signalAway(signal)
    },

    matcher: {
      classification:
        matcherResult?.classification ??
        null,

      method:
        matcherResult?.method ??
        null,

      matcher_score:
        matcherResult?.matcher_score ??
        null,

      direction:
        matcherResult
          ?.team_scores
          ?.direction ??
        null,

      home_score:
        matcherResult
          ?.team_scores
          ?.home_score ??
        null,

      away_score:
        matcherResult
          ?.team_scores
          ?.away_score ??
        null,

      combined_score:
        matcherResult
          ?.team_scores
          ?.combined_score ??
        null,

      source:
        matcherResult?.source ??
        "MATCHER"
    },

    cloudbet: {
      id:
        extractMatchId(cb),

      match:
        displayMatch(cb),

      home:
        extractHome(cb),

      away:
        extractAway(cb),

      status:
        cb?.status ??
        null,

      state:
        cb?.state ??
        null,

      live:
        isCloudbetLive(cb),

      odds,

      odds_available:
        odds !== null,

      odds_source:
        odds !== null
          ? "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
          : null,

      market:
        BET_MARKET,

      selection:
        BET_SELECTION
    },

    odds_diagnostic:
      oddsDiagnostic ??
      buildOddsDiagnostic(cb),

    full_event_fetch: {
      success:
        fullEventError
          ? false
          : !!oddsEvent,

      source:
        oddsEvent
          ? "CLOUDBET_FULL_EVENT"
          : "LIVE_EVENT_FALLBACK",

      error:
        fullEventError ??
        null
    },

    verification: {
      verified:
        verification?.verified ===
        true,

      source:
        verification?.source ??
        null,

      cloudbet_id:
        verification?.cloudbet_id ??
        extractMatchId(cb) ??
        null
    },

    stake_eur:
      BET_STAKE_EUR,

    bet_placed:
      false,

    simulated:
      true
  };
}

function buildDryRunCandidate(
  bet: AnyObj
): AnyObj {
  const odds =
    extractOdds(
      bet?.cloudbet
    );

  const oddsAvailable =
    odds !== null;

  if (oddsAvailable) {
    bet.cloudbet.odds =
      odds;

    bet.cloudbet.odds_available =
      true;

    bet.cloudbet.odds_source =
      "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS";
  }

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
      displayMatch(
        bet?.cloudbet ??
        {}
      ),

    signal_match_id:
      bet?.signal_match_id ??
      null,

    hunter_score:
      bet?.hunter_score ??
      null,

    cloudbet_id:
      getCloudbetId(bet),

    market:
      BET_MARKET,

    selection:
      BET_SELECTION,

    stake_eur:
      BET_STAKE_EUR,

    odds,

    odds_available:
      oddsAvailable,

    candidate_complete:
      oddsAvailable,

    odds_source:
      oddsAvailable
        ? "CLOUDBET_FULL_EVENT_FIRST_HALF_TOTAL_GOALS"
        : null,

    cloudbet:
      bet?.cloudbet ??
      null,

    odds_diagnostic:
      bet?.odds_diagnostic ??
      buildOddsDiagnostic(
        bet?.cloudbet ??
        {}
      ),

    full_event_fetch:
      bet?.full_event_fetch ??
      null,

    matcher:
      bet?.matcher ??
      null,

    verification:
      bet?.verification ??
      null,

    simulated:
      true
  };
}

// ─── MAIN RUN ──────────────────────────────────────────────

async function runV58(
  env: Env
): Promise<AnyObj> {
  const started =
    Date.now();

  const [
    trackerData,
    matcherData,
    cloudbetData
  ] = await Promise.all([
    fetchServiceJSON(
      env.TRACKER,
      "/entries"
    ),

    fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    ),

    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    )
  ]);

  const allSignals =
    extractSignals(
      trackerData
    );

  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );

  const liveMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const preparedBets:
    AnyObj[] = [];

  const matcherFailures:
    AnyObj[] = [];

  const verificationFailures:
    AnyObj[] = [];

  const oddsFetchFailures:
    AnyObj[] = [];

  for (const signal of hunterEntries) {
    const matcher =
      findBestMatcherCandidate(
        signal,
        matcherData
      );

    if (!matcher.found) {
      matcherFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
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
      await verifyCloudbet(
        signal,
        matcher,
        liveMatches,
        cloudbetData
      );

    if (!verification.verified) {
      verificationFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
            signal
          ),

        reason:
          "CLOUDBET_NOT_VERIFIED"
      });

      continue;
    }

    const oddsRes =
      await resolveCloudbetOddsEvent(
        env,
        verification.cloudbet
      );

    if (!oddsRes.success) {
      oddsFetchFailures.push({
        match:
          signalMatchName(
            signal
          ),

        signal_match_id:
          signalMatchId(
            signal
          ),

        cloudbet_id:
          verification.cloudbet_id,

        error:
          oddsRes.error
      });
    }

    const bet =
      buildPreparedBet(
        signal,
        matcher,
        verification,
        oddsRes.event,
        oddsRes.diagnostic,
        oddsRes.error
      );

    bet.entry_minute =
      Number(
        signal?.minute ??
        signal?.entry_minute ??
        signal?.v27?.minute ??
        null
      );

    preparedBets.push(
      bet
    );
  }

  const completeBets:
    AnyObj[] = [];

  const pendingBets:
    AnyObj[] = [];

  for (const bet of preparedBets) {
    if (
      updateBetOdds(bet)
    ) {
      completeBets.push(
        bet
      );
    } else {
      pendingBets.push(
        bet
      );
    }
  }

  const pendingResults:
    AnyObj[] = [];

  for (const bet of pendingBets) {
    const r =
      await savePendingOdds(
        env,
        bet
      );

    pendingResults.push({
      match:
        bet?.match,

      cloudbet_id:
        getCloudbetId(
          bet
        ),

      odds_diagnostic:
        bet?.odds_diagnostic ??
        null,

      full_event_fetch:
        bet?.full_event_fetch ??
        null,

      ...r
    });
  }

  const archive =
    await archivePreparedBets(
      env,
      completeBets
    );

  const candidates =
    preparedBets.map(
      buildDryRunCandidate
    );

  const completeCandidates =
    candidates.filter(
      c =>
        c.candidate_complete ===
        true
    );

  const incompleteCandidates =
    candidates.filter(
      c =>
        c.candidate_complete !==
        true
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

      target_sport:
        TARGET_SPORT,

      target_period:
        TARGET_PERIOD,

      target_outcome:
        TARGET_OUTCOME,

      target_line:
        TARGET_LINE,

      exact_market_keys:
        [...TARGET_MARKET_KEYS],

      exact_submarket:
        TARGET_SUBMARKET_KEY,

      exact_outcome:
        TARGET_OUTCOME_KEY,

      exact_params:
        TARGET_PARAMS,

      exact_market_urls:
        [...TARGET_MARKET_URLS],

      required_classification:
        REQUIRED_MATCH_CLASSIFICATION,

      live_source:
        "/live",

      odds_source:
        "/event?id=CLOUDBET_EVENT_ID",

      pending_retry:
        "CRON_EVERY_MINUTE",

      max_missing_checks:
        MAX_MISSING_CHECKS
    },

    tracker: {
      signals_received:
        allSignals.length,

      hunter_entries:
        hunterEntries.length
    },

    matcher: {
      candidates_checked:
        hunterEntries.length,

      matched:
        preparedBets.length,

      failures:
        matcherFailures.length
    },

    cloudbet: {
      live_matches:
        liveMatches.length,

      verified:
        preparedBets.length,

      verification_failures:
        verificationFailures.length,

      full_event_fetch_failures:
        oddsFetchFailures.length
    },

    odds: {
      prepared:
        preparedBets.length,

      available:
        completeBets.length,

      unavailable:
        pendingBets.length,

      pending_saved:
        pendingResults.filter(
          r =>
            r?.success === true
        ).length,

      pending:
        pendingResults
    },

    candidates: {
      total:
        candidates.length,

      complete:
        completeCandidates.length,

      incomplete:
        incompleteCandidates.length
    },

    archive,

    prepared_bets:
      preparedBets,

    bet_candidates:
      candidates,

    matcher_failures:
      matcherFailures,

    verification_failures:
      verificationFailures,

    odds_fetch_failures:
      oddsFetchFailures,

    elapsed_ms:
      Date.now() - started
  };
}

// ─── HEALTH ────────────────────────────────────────────────

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

    config: {
      market:
        BET_MARKET,

      selection:
        BET_SELECTION,

      stake_eur:
        BET_STAKE_EUR,

      exact_market_keys:
        [...TARGET_MARKET_KEYS],

      exact_submarket:
        TARGET_SUBMARKET_KEY,

      exact_outcome:
        TARGET_OUTCOME_KEY,

      exact_params:
        TARGET_PARAMS,

      exact_market_urls:
        [...TARGET_MARKET_URLS],

      full_event_endpoint:
        "/event?id=EVENT_ID",

      pending_odds:
        true,

      retry:
        "CRON_EVERY_MINUTE",

      max_missing_checks:
        MAX_MISSING_CHECKS,

      lines_diagnostic:
        "/lines?id=EVENT_ID"
    }
  });
}

// ─── ARCHIVE RESPONSE ─────────────────────────────────────

async function archiveResponse(
  env: Env
): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        success: false,
        error:
          "DB_BINDING_MISSING"
      },
      500
    );
  }

  try {
    const countResult =
      await env.DB
        .prepare(`
          SELECT COUNT(*) AS total
          FROM hunter_bet_archive
        `)
        .first();

    const total =
      Number(
        countResult?.total ??
        0
      );

    const result =
      await env.DB
        .prepare(`
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
        `)
        .all();

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

      total,

      returned:
        result.results?.length ??
        0,

      archive:
        result.results ??
        []
    });
  } catch (e) {
    return json(
      {
        success: false,

        worker:
          "cloudbet-bet-worker",

        version:
          VERSION,

        error:
          e instanceof Error
            ? e.message
            : String(e)
      },
      500
    );
  }
}

// ─── PENDING RESPONSE ─────────────────────────────────────

async function pendingResponse(
  env: Env
): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        success: false,
        error:
          "DB_BINDING_MISSING"
      },
      500
    );
  }

  try {
    const result =
      await env.DB
        .prepare(`
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
        `)
        .all();

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
  } catch (e) {
    return json(
      {
        success: false,

        error:
          e instanceof Error
            ? e.message
            : String(e)
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
      new URL(
        request.url
      );

    if (
      url.pathname ===
        "/health" ||
      url.pathname === "/"
    ) {
      return healthResponse(
        env
      );
    }

    // ======================================================
    // V5.8.6 /lines
    //
    // Example:
    // /lines?id=123456789
    //
    // READ ONLY
    // Calls Cloudbet /event?id=...
    // and returns complete market diagnostics.
    // ======================================================

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
          await runV58(
            env
          )
        );
      } catch (e) {
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
              e instanceof Error
                ? e.message
                : String(e),

            stack:
              e instanceof Error
                ? e.stack
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
      processPendingOdds(
        env
      )
        .then(r =>
          console.log(
            JSON.stringify({
              cron: true,
              version:
                VERSION,
              ...r
            })
          )
        )
        .catch(e =>
          console.error(
            JSON.stringify({
              cron: true,
              version:
                VERSION,
              success: false,
              error:
                e instanceof Error
                  ? e.message
                  : String(e)
            })
          )
        )
    );
  }
};
