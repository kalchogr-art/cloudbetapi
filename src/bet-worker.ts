// ============================================================
// CLOUDBET BET WORKER V5.8.1
// DRY RUN — PERSISTENT ODDS RETRY
// ============================================================

interface Env {
  TRACKER: Fetcher;
  MATCHER: Fetcher;
  CLOUDBET: Fetcher;
  DB: D1Database;
}

type AnyObj = Record<string, any>;

// ============================================================
// CONFIG
// ============================================================

const VERSION = "V5.8.1";
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

// Allow 3 consecutive missing /live checks.
// Invalidation happens on the 4th consecutive miss.
const MAX_MISSING_CHECKS = 3;

// ============================================================
// ALIASES
// ============================================================

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
  "fc", "cf", "sc", "ac", "afc", "ca", "cd", "sd", "ss",
  "as", "us", "ud", "aa", "ad", "rc", "fk", "sk", "ks",
  "sv", "vfb", "vfl", "club", "calcio", "football", "soccer"
]);

// ============================================================
// BASIC
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}

function safeString(v: any): string {
  return String(v ?? "").trim();
}

function normalizeText(v: any): string {
  return safeString(v)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyAliases(v: string): string {
  let result = normalizeText(v);

  for (const alias of Object.keys(TEAM_ALIASES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    result = result.replace(
      new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"),
      `$1${TEAM_ALIASES[alias]}`
    );
  }

  return result.replace(/\s+/g, " ").trim();
}

function normalizeTeam(v: any): string {
  return applyAliases(safeString(v))
    .split(" ")
    .filter(Boolean)
    .filter(x => !GENERIC_WORDS.has(x))
    .filter(x => !/^\d+$/.test(x))
    .join(" ")
    .trim();
}

function teamTokens(v: any): string[] {
  return normalizeTeam(v)
    .split(" ")
    .filter(x => x.length >= 3);
}

function splitMatchName(v: any): { home: string | null; away: string | null } {
  const text = safeString(v);

  for (const sep of [" - ", " v ", " vs ", " VS ", " @ "]) {
    const i = text.indexOf(sep);

    if (i >= 0) {
      return {
        home: text.slice(0, i).trim(),
        away: text.slice(i + sep.length).trim()
      };
    }
  }

  return { home: null, away: null };
}

// ============================================================
// MATCH EXTRACTION
// ============================================================

function extractHome(m: AnyObj): string {
  const values = [
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

  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return splitMatchName(
    m?.match ?? m?.name ?? m?.event_name ?? ""
  ).home ?? "";
}

function extractAway(m: AnyObj): string {
  const values = [
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

  for (const v of values) {
    if (typeof v === "string" && v.trim()) {
      return v.trim();
    }
  }

  return splitMatchName(
    m?.match ?? m?.name ?? m?.event_name ?? ""
  ).away ?? "";
}

function displayMatch(m: AnyObj): string {
  return (
    safeString(m?.match ?? m?.name ?? m?.event_name) ||
    `${extractHome(m)} - ${extractAway(m)}`
  );
}

function extractMatchId(m: AnyObj): string {
  return safeString(
    m?.id ??
    m?.match_id ??
    m?.matchId ??
    m?.key ??
    m?.event_id ??
    m?.eventId
  );
}

function teamsPresent(home: any, away: any): boolean {
  return !!normalizeTeam(home) && !!normalizeTeam(away);
}

// ============================================================
// LEVENSHTEIN / TEAM MATCH
// ============================================================

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

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

function characterSimilarity(a: any, b: any): number {
  const A = normalizeTeam(a);
  const B = normalizeTeam(b);

  if (!A || !B) return 0;
  if (A === B) return 1;

  return Math.max(
    0,
    1 - levenshtein(A, B) / Math.max(A.length, B.length)
  );
}

function teamMatchScore(a: any, b: any): AnyObj {
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
      accepted: score >= CONTAINMENT_MIN_SCORE
    };
  }

  const tokensA = teamTokens(A);
  const tokensB = teamTokens(B);
  const common = tokensA.filter(x => tokensB.includes(x));

  if (common.length >= TOKEN_MIN_COMMON) {
    const score =
      common.length /
      Math.max(tokensA.length, tokensB.length);

    if (score >= TOKEN_MATCH_MIN_SCORE) {
      return {
        score,
        method: "TOKEN_STRONG",
        accepted: true,
        common_tokens: common
      };
    }
  }

  const score = characterSimilarity(A, B);

  return {
    score,
    method: "CHARACTER_SIMILARITY",
    accepted: score >= CHARACTER_SIMILARITY_MIN_SCORE
  };
}

function twoSidedTeamScore(
  homeA: any,
  awayA: any,
  homeB: any,
  awayB: any
): AnyObj {
  const nh = teamMatchScore(homeA, homeB);
  const na = teamMatchScore(awayA, awayB);

  const rh = teamMatchScore(homeA, awayB);
  const ra = teamMatchScore(awayA, homeB);

  const normalScore = Math.min(nh.score, na.score);
  const reversedScore = Math.min(rh.score, ra.score);

  const normalValid =
    nh.accepted &&
    na.accepted &&
    nh.score >= TEAM_MATCH_MIN_SCORE &&
    na.score >= TEAM_MATCH_MIN_SCORE;

  const reversedValid =
    rh.accepted &&
    ra.accepted &&
    rh.score >= TEAM_MATCH_MIN_SCORE &&
    ra.score >= TEAM_MATCH_MIN_SCORE;

  if (normalValid && normalScore >= reversedScore) {
    return {
      matched: true,
      direction: "NORMAL",
      home_score: nh.score,
      away_score: na.score,
      combined_score: normalScore,
      both_teams_pass: true,
      home_method: nh.method,
      away_method: na.method
    };
  }

  if (reversedValid) {
    return {
      matched: true,
      direction: "REVERSED",
      home_score: rh.score,
      away_score: ra.score,
      combined_score: reversedScore,
      both_teams_pass: true,
      home_method: rh.method,
      away_method: ra.method
    };
  }

  return {
    matched: false,
    direction: normalScore >= reversedScore ? "NORMAL" : "REVERSED",
    home_score:
      normalScore >= reversedScore ? nh.score : rh.score,
    away_score:
      normalScore >= reversedScore ? na.score : ra.score,
    combined_score: Math.max(normalScore, reversedScore),
    both_teams_pass: false
  };
}

// ============================================================
// SERVICE
// ============================================================

async function fetchServiceJSON(
  service: Fetcher,
  path: string
): Promise<AnyObj> {
  const response = await service.fetch(
    new Request(`https://service${path}`, {
      method: "GET",
      headers: { accept: "application/json" }
    })
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${path}: ${text.slice(0, 500)}`
    );
  }

  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from ${path}`);
  }
}

// ============================================================
// TRACKER
// ============================================================

function extractSignals(data: AnyObj): AnyObj[] {
  const values =
    data?.signals ??
    data?.entries ??
    data?.hunter_entries ??
    data?.data ??
    [];

  return Array.isArray(values)
    ? values.filter(
        (x: any) => x && typeof x === "object"
      )
    : [];
}

function isHunterEntry(signal: AnyObj): boolean {
  return (
    safeString(
      signal?.type ??
      signal?.signal_type ??
      signal?.signalType
    ).toUpperCase() === ALLOWED_SIGNAL_TYPE
  );
}

function signalMatchId(s: AnyObj): string {
  return safeString(
    s?.match_id ??
    s?.matchId ??
    s?.id ??
    s?.v27?.id
  );
}

function signalMatchName(s: AnyObj): string {
  return safeString(
    s?.match ??
    s?.name ??
    s?.v27?.match
  );
}

function signalHome(s: AnyObj): string {
  return safeString(s?.v27?.home ?? extractHome(s));
}

function signalAway(s: AnyObj): string {
  return safeString(s?.v27?.away ?? extractAway(s));
}

// ============================================================
// MATCHER
// ============================================================

function extractMatcherMatches(data: AnyObj): AnyObj[] {
  const values =
    data?.matches ??
    data?.results ??
    data?.matched ??
    data?.candidates ??
    [];

  return Array.isArray(values) ? values : [];
}

function getMatcherScore(item: AnyObj): number {
  const scoring =
    item?.scoring ??
    item?.matcher_scoring ??
    item?.score_details ??
    {};

  const score = Number(
    scoring?.total ??
    scoring?.score ??
    item?.matcher_score ??
    item?.match_score ??
    item?.score ??
    0
  );

  return Number.isFinite(score) ? score : 0;
}

function getClassification(item: AnyObj): string {
  return safeString(
    item?.classification ??
    item?.match_classification ??
    item?.security?.classification
  ).toUpperCase();
}

function getMatchMethod(item: AnyObj): string {
  return safeString(
    item?.match_method ??
    item?.method ??
    item?.security?.match_method
  ).toUpperCase();
}

function extractV27FromMatcher(item: AnyObj): AnyObj {
  return item?.v27 ?? item?.source ?? item;
}

function extractCloudbetFromMatcher(
  item: AnyObj
): AnyObj | null {
  return (
    item?.cloudbet ??
    item?.target ??
    item?.matched_cloudbet ??
    null
  );
}

function validateMatcherCandidate(
  signal: AnyObj,
  item: AnyObj
): AnyObj {
  const v27 = extractV27FromMatcher(item);
  const cloudbet = extractCloudbetFromMatcher(item);

  const classification = getClassification(item);
  const method = getMatchMethod(item);
  const matcherScore = getMatcherScore(item);

  if (
    item?.security?.score_only_match === true ||
    item?.score_only_match === true
  ) {
    return {
      accepted: false,
      reason: "SCORE_ONLY_MATCH_REJECTED"
    };
  }

  const sHome = signalHome(signal);
  const sAway = signalAway(signal);
  const vHome = extractHome(v27);
  const vAway = extractAway(v27);

  if (!teamsPresent(sHome, sAway)) {
    return {
      accepted: false,
      reason: "SIGNAL_TEAMS_EMPTY"
    };
  }

  if (!teamsPresent(vHome, vAway)) {
    return {
      accepted: false,
      reason: "V27_TEAMS_EMPTY"
    };
  }

  const teamScore = twoSidedTeamScore(
    sHome,
    sAway,
    vHome,
    vAway
  );

  if (!teamScore.matched) {
    return {
      accepted: false,
      reason: "STRICT_SIGNAL_TEAMS_MISMATCH",
      team_scores: teamScore
    };
  }

  if (method === "EXACT_ID" && matcherScore <= 0) {
    return {
      accepted: false,
      reason: "EXACT_ID_WITH_ZERO_SCORE_REJECTED"
    };
  }

  if (matcherScore < MIN_MATCHER_SCORE) {
    return {
      accepted: false,
      reason: "MATCHER_SCORE_TOO_LOW"
    };
  }

  const confident =
    classification === REQUIRED_MATCH_CLASSIFICATION;

  const strong =
    matcherScore >= STRONG_MATCHER_SCORE;

  if (!confident && !strong) {
    return {
      accepted: false,
      reason: "NOT_CONFIDENT_AND_SCORE_NOT_STRONG"
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
    matcher_score: matcherScore,
    v27: {
      id: extractMatchId(v27),
      match: displayMatch(v27),
      home: vHome,
      away: vAway
    },
    cloudbet: cloudbet
      ? {
          id: extractMatchId(cloudbet),
          match: displayMatch(cloudbet),
          home: extractHome(cloudbet),
          away: extractAway(cloudbet)
        }
      : null,
    team_scores: teamScore
  };
}

function findBestMatcherCandidate(
  signal: AnyObj,
  matcherData: AnyObj
): AnyObj {
  const matches = extractMatcherMatches(matcherData);

  let best: AnyObj | null = null;
  const rejectionReasons: Record<string, number> = {};

  for (const item of matches) {
    const result = validateMatcherCandidate(signal, item);

    if (result.accepted) {
      if (
        !best ||
        result.matcher_score > best.matcher_score
      ) {
        best = result;
      }
    } else {
      const reason = result.reason ?? "UNKNOWN";
      rejectionReasons[reason] =
        (rejectionReasons[reason] ?? 0) + 1;
    }
  }

  if (!best) {
    return {
      found: false,
      reason: "NO_ACCEPTABLE_MATCHER_CANDIDATE",
      diagnostics: {
        candidates_checked: matches.length,
        rejection_reasons: rejectionReasons
      }
    };
  }

  return {
    found: true,
    ...best,
    diagnostics: {
      candidates_checked: matches.length,
      rejection_reasons: rejectionReasons
    }
  };
}

// ============================================================
// CLOUDBET
// ============================================================

function extractCloudbetMatches(data: AnyObj): AnyObj[] {
  const candidates = [
    data?.data?.matches,
    data?.matches,
    data?.live_matches,
    data?.events,
    data?.data
  ];

  for (const value of candidates) {
    if (Array.isArray(value)) {
      return value.filter(
        x => x && typeof x === "object"
      );
    }
  }

  return [];
}

function isCloudbetLive(m: AnyObj): boolean {
  const status = safeString(
    m?.status ??
    m?.event_status ??
    m?.trading_status
  ).toUpperCase();

  const state = safeString(m?.state).toUpperCase();

  return (
    status === "TRADING_LIVE" ||
    state === "LIVE" ||
    m?.live === true
  );
}

// ============================================================
// RAW CLOUDBET
// ============================================================

function findCloudbetRawJsonPresence(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  const sHome = signalHome(signal);
  const sAway = signalAway(signal);
  const signalId = signalMatchId(signal);

  const matches = extractCloudbetMatches(rawData);
  let best: AnyObj | null = null;

  for (const cb of matches) {
    const cbHome = extractHome(cb);
    const cbAway = extractAway(cb);

    if (
      !teamsPresent(sHome, sAway) ||
      !teamsPresent(cbHome, cbAway)
    ) {
      continue;
    }

    const score = twoSidedTeamScore(
      sHome,
      sAway,
      cbHome,
      cbAway
    );

    if (!score.matched) continue;

    const cbId = extractMatchId(cb);
    const idMatch =
      !!signalId &&
      !!cbId &&
      signalId === cbId;

    const candidate = {
      ...cb,
      _presence: {
        id_match: idMatch,
        direction: score.direction,
        home_score: score.home_score,
        away_score: score.away_score,
        combined_score: score.combined_score,
        live: isCloudbetLive(cb)
      }
    };

    if (idMatch) {
      return {
        found: true,
        source: "RAW_JSON",
        status: isCloudbetLive(cb)
          ? "JSON_PRESENT"
          : "JSON_PRESENT_NOT_LIVE",
        cloudbet: candidate
      };
    }

    if (
      !best ||
      score.combined_score >
        best?._presence?.combined_score
    ) {
      best = candidate;
    }
  }

  if (best) {
    return {
      found: true,
      source: "RAW_JSON",
      status: isCloudbetLive(best)
        ? "JSON_PRESENT"
        : "JSON_PRESENT_NOT_LIVE",
      cloudbet: best
    };
  }

  return {
    found: false,
    source: "RAW_JSON",
    status: "MISSING_FROM_LIVE_JSON",
    cloudbet: null
  };
}

function findDirectCloudbet(
  signal: AnyObj,
  liveMatches: AnyObj[]
): AnyObj {
  const signalId = signalMatchId(signal);
  const sHome = signalHome(signal);
  const sAway = signalAway(signal);

  if (signalId) {
    const byId = liveMatches.find(
      cb => extractMatchId(cb) === signalId
    );

    if (byId) {
      return {
        found: true,
        source: "CLOUDBET_ID",
        cloudbet: byId
      };
    }
  }

  let best: AnyObj | null = null;

  for (const cb of liveMatches) {
    const score = twoSidedTeamScore(
      sHome,
      sAway,
      extractHome(cb),
      extractAway(cb)
    );

    if (!score.matched || !isCloudbetLive(cb)) {
      continue;
    }

    const candidate = {
      ...cb,
      _match_score: score
    };

    if (
      !best ||
      score.combined_score >
        best?._match_score?.combined_score
    ) {
      best = candidate;
    }
  }

  if (!best) {
    return {
      found: false,
      source: "CLOUDBET_DIRECT",
      cloudbet: null
    };
  }

  return {
    found: true,
    source: "CLOUDBET_TEAMS",
    cloudbet: best
  };
}

function findRawCloudbetMatch(
  signal: AnyObj,
  rawData: AnyObj
): AnyObj {
  return findCloudbetRawJsonPresence(signal, rawData);
}

// ============================================================
// ODDS
// ============================================================

function normalizeOddsContext(value: any): string {
  return normalizeText(value)
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasFirstHalfContext(value: string): boolean {
  const s = normalizeOddsContext(value);

  return (
    /\b1h\b/.test(s) ||
    /\b1st half\b/.test(s) ||
    /\bfirst half\b/.test(s) ||
    /\bhalf 1\b/.test(s) ||
    /\bperiod 1\b/.test(s) ||
    /half=1\b/.test(s) ||
    /period=1\b/.test(s)
  );
}

function hasTotalGoalsContext(value: string): boolean {
  const s = normalizeOddsContext(value);

  return (
    s.includes("total goals") ||
    s.includes("total goal") ||
    s.includes("goals total") ||
    s.includes("totals")
  );
}

function hasOverContext(value: string): boolean {
  const s = normalizeOddsContext(value);

  return (
    /\bover\b/.test(s) ||
    /\bo\b/.test(s) ||
    /outcome=over\b/.test(s)
  );
}

function hasHalfGoalLine(value: string): boolean {
  const s = normalizeOddsContext(value);

  return (
    /\b0.5\b/.test(s) ||
    /\b05\b/.test(s) ||
    /total=0.5\b/.test(s) ||
    /line=0.5\b/.test(s) ||
    /handicap=0.5\b/.test(s)
  );
}

function isSelectionEnabled(selection: AnyObj): boolean {
  const status = safeString(
    selection?.status
  ).toUpperCase();

  if (!status) return true;

  return (
    status === "SELECTION_ENABLED" ||
    status === "ENABLED" ||
    status === "TRADING" ||
    status === "OPEN" ||
    status === "ACTIVE"
  );
}

function extractSelectionPrice(
  selection: AnyObj
): number | null {
  const price = Number(selection?.price);

  return Number.isFinite(price) && price > 1
    ? price
    : null;
}

function extractFirstHalfOver05Odds(
  m: AnyObj
): number | null {
  const markets = Array.isArray(m?.markets)
    ? m.markets
    : [];

  for (const market of markets) {
    if (!market || typeof market !== "object") {
      continue;
    }

    const marketContext = [
      market?.marketKey,
      market?.key,
      market?.name,
      market?.market,
      market?.marketUrl,
      market?.url
    ]
      .map(normalizeOddsContext)
      .join(" ");

    if (!hasTotalGoalsContext(marketContext)) {
      continue;
    }

    const submarkets = Array.isArray(
      market?.submarkets
    )
      ? market.submarkets
      : [];

    for (const submarket of submarkets) {
      if (
        !submarket ||
        typeof submarket !== "object"
      ) {
        continue;
      }

      const submarketContext = [
        marketContext,
        submarket?.submarketKey,
        submarket?.key,
        submarket?.name,
        submarket?.marketUrl,
        submarket?.url
      ]
        .map(normalizeOddsContext)
        .join(" ");

      if (!hasFirstHalfContext(submarketContext)) {
        continue;
      }

      const selections = Array.isArray(
        submarket?.selections
      )
        ? submarket.selections
        : [];

      for (const selection of selections) {
        if (
          !selection ||
          typeof selection !== "object"
        ) {
          continue;
        }

        const context = [
          submarketContext,
          selection?.marketUrl,
          selection?.name,
          selection?.outcome,
          selection?.side,
          selection?.selection,
          selection?.id
        ]
          .map(normalizeOddsContext)
          .join(" ");

        if (
          !hasFirstHalfContext(context) ||
          !hasOverContext(context) ||
          !hasHalfGoalLine(context) ||
          !isSelectionEnabled(selection)
        ) {
          continue;
        }

        const price =
          extractSelectionPrice(selection);

        if (price !== null) {
          return price;
        }
      }
    }
  }

  return extractOddsRecursive(m);
}

function extractOddsRecursive(
  root: any
): number | null {
  const visited = new Set<any>();

  function walk(
    node: any,
    context: string
  ): number | null {
    if (
      node === null ||
      node === undefined ||
      typeof node !== "object" ||
      visited.has(node)
    ) {
      return null;
    }

    visited.add(node);

    const ownContext = [
      context,
      node?.marketKey,
      node?.submarketKey,
      node?.marketUrl,
      node?.url,
      node?.name,
      node?.outcome,
      node?.selection,
      node?.side
    ]
      .map(normalizeOddsContext)
      .join(" ");

    if (
      node?.price !== undefined &&
      hasTotalGoalsContext(ownContext) &&
      hasFirstHalfContext(ownContext) &&
      hasOverContext(ownContext) &&
      hasHalfGoalLine(ownContext) &&
      isSelectionEnabled(node)
    ) {
      const price =
        extractSelectionPrice(node);

      if (price !== null) {
        return price;
      }
    }

    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child, ownContext);
        if (found !== null) return found;
      }

      return null;
    }

    for (const key of Object.keys(node)) {
      const child = node[key];

      if (
        !child ||
        typeof child !== "object"
      ) {
        continue;
      }

      const found = walk(
        child,
        `${ownContext} ${normalizeOddsContext(key)}`
      );

      if (found !== null) {
        return found;
      }
    }

    return null;
  }

  return walk(root, "");
}

function extractOdds(m: AnyObj): number | null {
  if (!m || typeof m !== "object") {
    return null;
  }

  return extractFirstHalfOver05Odds(m);
}

// ============================================================
// ODDS HELPERS
// ============================================================

function getCloudbetId(bet: AnyObj): string {
  return safeString(
    bet?.cloudbet?.id ??
    bet?.cloudbet_id ??
    bet?.cloudbet?.match_id
  );
}

function updateBetOdds(bet: AnyObj): boolean {
  const cloudbet = bet?.cloudbet;

  if (!cloudbet || typeof cloudbet !== "object") {
    return false;
  }

  const odds = extractOdds(cloudbet);

  if (odds === null) {
    return false;
  }

  cloudbet.odds = odds;
  cloudbet.odds_available = true;
  cloudbet.odds_source = "CLOUDBET_LIVE_MARKETS";

  bet.odds = odds;
  bet.odds_available = true;
  bet.candidate_complete = true;

  return true;
}

function buildCloudbetIdMap(
  matches: AnyObj[]
): Map<string, AnyObj> {
  const map = new Map<string, AnyObj>();

  for (const match of matches) {
    const id = extractMatchId(match);

    if (id) {
      map.set(id, match);
    }
  }

  return map;
}

// ============================================================
// MATCH STATE
// ============================================================

function extractNumber(v: any): number | null {
  if (
    v === null ||
    v === undefined ||
    v === ""
  ) {
    return null;
  }

  const n = Number(v);

  return Number.isFinite(n) ? n : null;
}

function extractScorePair(
  m: AnyObj
): {
  home: number | null;
  away: number | null;
} {
  const pairs = [
    [m?.home_score, m?.away_score],
    [m?.homeScore, m?.awayScore],
    [m?.score?.home, m?.score?.away],
    [
      m?.score?.home_score,
      m?.score?.away_score
    ],
    [m?.scores?.home, m?.scores?.away],
    [
      m?.scores?.home_score,
      m?.scores?.away_score
    ],
    [m?.result?.home, m?.result?.away],
    [
      m?.result?.home_score,
      m?.result?.away_score
    ],
    [m?.home?.score, m?.away?.score],
    [m?.homeTeam?.score, m?.awayTeam?.score]
  ];

  for (const pair of pairs) {
    const home = extractNumber(pair[0]);
    const away = extractNumber(pair[1]);

    if (home !== null && away !== null) {
      return { home, away };
    }
  }

  const text = safeString(
    m?.score ??
    m?.result ??
    m?.current_score
  );

  const match = text.match(
    /(\d+)\s*[-:]\s*(\d+)/
  );

  if (match) {
    return {
      home: Number(match[1]),
      away: Number(match[2])
    };
  }

  return {
    home: null,
    away: null
  };
}

function hasGoal(m: AnyObj): boolean {
  const score = extractScorePair(m);

  if (
    score.home !== null &&
    score.away !== null
  ) {
    return (
      score.home > 0 ||
      score.away > 0
    );
  }

  const text = normalizeText(
    [
      m?.score,
      m?.result,
      m?.status_text,
      m?.event_status
    ]
      .map(safeString)
      .join(" ")
  );

  return (
    /\b[1-9]\s*[-:]\s*[0-9]\b/.test(text) ||
    /\b[0-9]\s*[-:]\s*[1-9]\b/.test(text)
  );
}

function extractMinute(
  m: AnyObj
): number | null {
  const values = [
    m?.minute,
    m?.match_minute,
    m?.matchMinute,
    m?.clock?.minute,
    m?.time?.minute,
    m?.game_time,
    m?.elapsed
  ];

  for (const value of values) {
    const n = extractNumber(value);

    if (n !== null) {
      return n;
    }

    const match = safeString(value).match(
      /(\d{1,3})/
    );

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}

function isFirstHalf(m: AnyObj): boolean {
  if (hasGoal(m)) {
    return false;
  }

  const period = normalizeText(
    m?.period ??
    m?.match_period ??
    m?.phase ??
    m?.state ??
    m?.status ??
    ""
  );

  if (
    /\bfirst half\b/.test(period) ||
    /\b1st half\b/.test(period) ||
    /\b1h\b/.test(period)
  ) {
    return true;
  }

  const minute = extractMinute(m);

  return (
    minute !== null &&
    minute >= 0 &&
    minute <= 45
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
      reason: "CLOUDBET_EVENT_NOT_FOUND"
    };
  }

  if (!isCloudbetLive(cb)) {
    return {
      valid: false,
      reason: "CLOUDBET_NO_LONGER_LIVE"
    };
  }

  if (hasGoal(cb)) {
    return {
      valid: false,
      reason: "GOAL_ALREADY_SCORED"
    };
  }

  if (!isFirstHalf(cb)) {
    return {
      valid: false,
      reason: "FIRST_HALF_ENDED"
    };
  }

  return {
    valid: true,
    reason: "BET_STILL_VALID"
  };
}

// ============================================================
// ARCHIVE
// ============================================================

function archiveKey(bet: AnyObj): string {
  const signalId = safeString(
    bet?.signal_match_id
  );

  if (signalId) {
    return `signal:${signalId}`;
  }

  const home = normalizeTeam(
    bet?.v27?.home ??
    bet?.cloudbet?.home
  );

  const away = normalizeTeam(
    bet?.v27?.away ??
    bet?.cloudbet?.away
  );

  return `teams:${home}:${away}`;
}

async function archivePreparedBets(
  env: Env,
  bets: AnyObj[]
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      inserted: 0,
      skipped: bets.length,
      error: "DB_BINDING_MISSING"
    };
  }

  if (!bets.length) {
    return {
      success: true,
      inserted: 0,
      skipped: 0
    };
  }

  const statements: D1PreparedStatement[] = [];

  for (const bet of bets) {
    const matcherScore = Number(
      bet?.matcher?.matcher_score ?? 0
    );

    const entryMinute = Number(
      bet?.entry_minute ??
      bet?.minute ??
      bet?.signal?.minute ??
      null
    );

    statements.push(
      env.DB.prepare(`
        INSERT OR IGNORE INTO hunter_bet_archive
        (
          archive_key,
          signal_match_id,
          cloudbet_id,
          match,
          home,
          away,
          signal_type,
          classification,
          matcher_score,
          entry_minute,
          market,
          selection,
          odds,
          stake_eur,
          mode,
          created_at
        )
        VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        archiveKey(bet),
        safeString(bet?.signal_match_id) || null,
        getCloudbetId(bet) || null,
        safeString(bet?.match) || null,
        safeString(
          bet?.v27?.home ??
          bet?.cloudbet?.home
        ) || null,
        safeString(
          bet?.v27?.away ??
          bet?.cloudbet?.away
        ) || null,
        safeString(bet?.signal_type) || null,
        safeString(
          bet?.matcher?.classification
        ) || null,
        Number.isFinite(matcherScore)
          ? matcherScore
          : null,
        Number.isFinite(entryMinute)
          ? entryMinute
          : null,
        BET_MARKET,
        BET_SELECTION,
        extractOdds(bet?.cloudbet),
        BET_STAKE_EUR,
        MODE
      )
    );
  }

  try {
    const result =
      await env.DB.batch(statements);

    return {
      success: true,
      inserted: result.length,
      attempted: bets.length
    };
  } catch (error) {
    return {
      success: false,
      inserted: 0,
      attempted: bets.length,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }
}

// ============================================================
// PENDING ODDS
// ============================================================

async function savePendingOdds(
  env: Env,
  bet: AnyObj
): Promise<AnyObj> {
  if (!env.DB) {
    return {
      success: false,
      error: "DB_BINDING_MISSING"
    };
  }

  const archive = archiveKey(bet);
  const signalId = safeString(
    bet?.signal_match_id
  );
  const cloudbetId = getCloudbetId(bet);

  if (!cloudbetId) {
    return {
      success: false,
      error: "CLOUDBET_ID_MISSING"
    };
  }

  const home = safeString(
    bet?.v27?.home ??
    bet?.cloudbet?.home
  );

  const away = safeString(
    bet?.v27?.away ??
    bet?.cloudbet?.away
  );

  const match = safeString(bet?.match);

  const entryMinute = Number(
    bet?.entry_minute ??
    bet?.minute ??
    null
  );

  let payload = "{}";

  try {
    payload = JSON.stringify(bet);
  } catch {
    payload = "{}";
  }

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
      VALUES
      (
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
        retry_count = pending_odds.retry_count,
        missing_count = 0,
        updated_at = datetime('now'),
        next_check_at = datetime('now', '+1 minute')
    `).bind(
      archive,
      signalId || null,
      cloudbetId,
      match || null,
      home || null,
      away || null,
      Number.isFinite(entryMinute)
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
      status: "PENDING_ODDS",
      archive_key: archive,
      cloudbet_id: cloudbetId
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

async function deletePending(
  env: Env,
  id: number
): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM pending_odds
    WHERE id = ?
  `)
    .bind(id)
    .run();
}

async function invalidatePending(
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
  `)
    .bind(id)
    .run();
}

async function loadPendingRows(
  env: Env
): Promise<AnyObj[]> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM pending_odds
    WHERE status = 'PENDING_ODDS'
      AND (
        next_check_at IS NULL
        OR next_check_at <= datetime('now')
      )
    ORDER BY created_at ASC
  `).all();

  return (result.results ?? []) as AnyObj[];
}

async function reschedulePending(
  env: Env,
  id: number,
  retryCount: number,
  missingCount: number
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
  `)
    .bind(
      retryCount,
      missingCount,
      id
    )
    .run();
}

// ============================================================
// CRON — PERSISTENT ODDS RETRY
// ============================================================

async function processPendingOdds(
  env: Env
): Promise<AnyObj> {
  const started = Date.now();

  const diagnostics: AnyObj = {
    success: true,
    version: VERSION,
    action: "PENDING_ODDS_CRON",
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
      ...diagnostics,
      success: false,
      error: "DB_BINDING_MISSING"
    };
  }

  let pendingRows: AnyObj[];

  try {
    pendingRows =
      await loadPendingRows(env);
  } catch (error) {
    return {
      ...diagnostics,
      success: false,
      error:
        error instanceof Error
          ? error.message
          : String(error)
    };
  }

  diagnostics.pending_loaded =
    pendingRows.length;

  if (!pendingRows.length) {
    diagnostics.elapsed_ms =
      Date.now() - started;

    return diagnostics;
  }

  // ONE Cloudbet /live request per Cron run.
  let rawData: AnyObj;

  try {
    rawData =
      await fetchServiceJSON(
        env.CLOUDBET,
        "/live"
      );
  } catch (error) {
    // IMPORTANT:
    // If Cloudbet itself fails, do not invalidate
    // or modify pending candidates.
    diagnostics.success = false;
    diagnostics.errors =
      pendingRows.length;
    diagnostics.error =
      error instanceof Error
        ? error.message
        : String(error);
    diagnostics.elapsed_ms =
      Date.now() - started;

    return diagnostics;
  }

  const liveMatches =
    extractCloudbetMatches(rawData);

  const byId =
    buildCloudbetIdMap(liveMatches);

  diagnostics.cloudbet_live_matches =
    liveMatches.length;

  for (const row of pendingRows) {
    diagnostics.checked++;

    const rowId = Number(row?.id);
    const cloudbetId =
      safeString(row?.cloudbet_id);

    if (!Number.isInteger(rowId)) {
      diagnostics.errors++;

      continue;
    }

    if (!cloudbetId) {
      await invalidatePending(
        env,
        rowId
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id: rowId,
        status: "INVALIDATED",
        reason: "CLOUDBET_ID_MISSING"
      });

      continue;
    }

    // --------------------------------------------------------
    // ONLY previously confirmed Cloudbet ID.
    // NO new Cloudbet search.
    // --------------------------------------------------------

    const cb = byId.get(cloudbetId);

    // --------------------------------------------------------
    // EVENT TEMPORARILY MISSING
    // --------------------------------------------------------

    if (!cb) {
      const missingCount =
        Number(row?.missing_count ?? 0) + 1;

      if (missingCount > MAX_MISSING_CHECKS) {
        await invalidatePending(
          env,
          rowId
        );

        diagnostics.invalidated++;

        diagnostics.details.push({
          id: rowId,
          cloudbet_id: cloudbetId,
          status: "INVALIDATED",
          reason: "CLOUDBET_EVENT_NOT_FOUND",
          missing_count: missingCount
        });

        continue;
      }

      await reschedulePending(
        env,
        rowId,
        Number(row?.retry_count ?? 0),
        missingCount
      );

      diagnostics.still_pending++;

      diagnostics.details.push({
        id: rowId,
        cloudbet_id: cloudbetId,
        status: "PENDING_ODDS",
        reason: "CLOUDBET_EVENT_TEMPORARILY_MISSING",
        missing_count: missingCount
      });

      continue;
    }

    // Event returned — reset missing counter.
    const previousMissing =
      Number(row?.missing_count ?? 0);

    if (previousMissing > 0) {
      await env.DB.prepare(`
        UPDATE pending_odds
        SET
          missing_count = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `)
        .bind(rowId)
        .run();
    }

    // --------------------------------------------------------
    // MATCH STILL VALID?
    // --------------------------------------------------------

    const validity =
      pendingIsStillValid(cb);

    if (!validity.valid) {
      await invalidatePending(
        env,
        rowId
      );

      diagnostics.invalidated++;

      diagnostics.details.push({
        id: rowId,
        cloudbet_id: cloudbetId,
        status: "INVALIDATED",
        reason: validity.reason
      });

      continue;
    }

    // --------------------------------------------------------
    // ODDS STILL UNAVAILABLE
    // --------------------------------------------------------

    const odds = extractOdds(cb);

    if (odds === null) {
      const retryCount =
        Number(row?.retry_count ?? 0) + 1;

      await reschedulePending(
        env,
        rowId,
        retryCount,
        0
      );

      diagnostics.still_pending++;

      diagnostics.details.push({
        id: rowId,
        cloudbet_id: cloudbetId,
        status: "PENDING_ODDS",
        odds: null,
        retry_count: retryCount,
        missing_count: 0
      });

      continue;
    }

    // --------------------------------------------------------
    // ODDS FOUND
    // --------------------------------------------------------

    let bet: AnyObj = {};
    const payloadText =
      safeString(row?.payload_json);

    if (payloadText) {
      try {
        bet = JSON.parse(payloadText);
      } catch {
        bet = {};
      }
    }

    if (
      !bet ||
      typeof bet !== "object"
    ) {
      bet = {};
    }

    bet.cloudbet = {
      ...(bet.cloudbet ?? {}),
      ...cb,
      id: cloudbetId,
      odds,
      odds_available: true,
      odds_source: "CLOUDBET_LIVE_MARKETS"
    };

    bet.odds = odds;
    bet.odds_available = true;
    bet.candidate_complete = true;
    bet.cloudbet_id = cloudbetId;

    bet.signal_match_id =
      safeString(row?.signal_match_id);

    bet.match =
      safeString(row?.match) ||
      displayMatch(cb);

    bet.v27 = bet.v27 ?? {
      id: safeString(
        row?.signal_match_id
      ),
      home: safeString(row?.home),
      away: safeString(row?.away)
    };

    bet.market = BET_MARKET;
    bet.selection = BET_SELECTION;
    bet.stake_eur = BET_STAKE_EUR;

    // Archive only after real odds exist.
    const archive =
      await archivePreparedBets(
        env,
        [bet]
      );

    await deletePending(
      env,
      rowId
    );

    diagnostics.odds_found++;

    diagnostics.details.push({
      id: rowId,
      cloudbet_id: cloudbetId,
      status: "READY",
      odds,
      archive
    });
  }

  diagnostics.elapsed_ms =
    Date.now() - started;

  return diagnostics;
}

// ============================================================
// VERIFY CLOUDBET
// ============================================================

async function verifyCloudbet(
  signal: AnyObj,
  matcherResult: AnyObj,
  liveMatches: AnyObj[],
  rawData: AnyObj
): Promise<AnyObj> {
  const matcherCloudbet =
    matcherResult?.cloudbet;

  const matcherCloudbetId =
    extractMatchId(
      matcherCloudbet ?? {}
    );

  if (matcherCloudbetId) {
    const byId = liveMatches.find(
      cb =>
        extractMatchId(cb) ===
        matcherCloudbetId
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
          source: "MATCHER_CLOUDBET_ID",
          cloudbet: byId,
          cloudbet_id: matcherCloudbetId,
          team_scores: score
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
      source: direct.source,
      cloudbet: direct.cloudbet,
      cloudbet_id:
        extractMatchId(
          direct.cloudbet
        ),
      team_scores:
        direct.cloudbet?._match_score ??
        null
    };
  }

  const raw =
    findRawCloudbetMatch(
      signal,
      rawData
    );

  if (
    raw.found &&
    raw.cloudbet
  ) {
    const cb = raw.cloudbet;

    const score =
      twoSidedTeamScore(
        signalHome(signal),
        signalAway(signal),
        extractHome(cb),
        extractAway(cb)
      );

    if (score.matched) {
      return {
        verified: true,
        source:
          raw.status ===
          "JSON_PRESENT_NOT_LIVE"
            ? "RAW_JSON_NOT_LIVE"
            : "RAW_JSON",
        cloudbet: cb,
        cloudbet_id:
          extractMatchId(cb),
        team_scores: score,
        cloudbet_live:
          isCloudbetLive(cb)
      };
    }
  }

  return {
    verified: false,
    source: "NOT_VERIFIED",
    cloudbet: null,
    cloudbet_id: null
  };
}

// ============================================================
// PREPARED BET
// ============================================================

function buildPreparedBet(
  signal: AnyObj,
  matcherResult: AnyObj,
  verification: AnyObj
): AnyObj {
  const cb =
    verification?.cloudbet ??
    matcherResult?.cloudbet ??
    {};

  const odds = extractOdds(cb);

  return {
    status: "READY",
    mode: MODE,
    betting_enabled: BETTING_ENABLED,
    dry_run: DRY_RUN,

    signal_type: safeString(
      signal?.type ??
      signal?.signal_type ??
      signal?.signalType
    ),

    signal_match_id:
      signalMatchId(signal),

    match:
      signalMatchName(signal) ||
      `${signalHome(signal)} - ${signalAway(signal)}`,

    v27: {
      id: signalMatchId(signal),
      home: signalHome(signal),
      away: signalAway(signal)
    },

    matcher: {
      classification:
        matcherResult?.classification ?? null,
      method:
        matcherResult?.method ?? null,
      matcher_score:
        matcherResult?.matcher_score ?? null,
      direction:
        matcherResult?.team_scores?.direction ??
        null,
      home_score:
        matcherResult?.team_scores?.home_score ??
        null,
      away_score:
        matcherResult?.team_scores?.away_score ??
        null,
      combined_score:
        matcherResult?.team_scores?.combined_score ??
        null
    },

    cloudbet: {
      id: extractMatchId(cb),
      match: displayMatch(cb),
      home: extractHome(cb),
      away: extractAway(cb),
      status: cb?.status ?? null,
      state: cb?.state ?? null,
      live: isCloudbetLive(cb),
      odds,
      odds_available: odds !== null,
      odds_source:
        odds !== null
          ? "CLOUDBET_LIVE_MARKETS"
          : null,
      market: BET_MARKET,
      selection: BET_SELECTION
    },

    verification: {
      verified:
        verification?.verified === true,
      source:
        verification?.source ?? null,
      cloudbet_id:
        verification?.cloudbet_id ??
        extractMatchId(cb) ??
        null
    },

    stake_eur: BET_STAKE_EUR,
    bet_placed: false,
    simulated: true
  };
}

// ============================================================
// DRY RUN
// ============================================================

function buildDryRunCandidate(
  bet: AnyObj
): AnyObj {
  const odds =
    extractOdds(bet?.cloudbet);

  const oddsAvailable =
    odds !== null;

  if (oddsAvailable) {
    bet.cloudbet.odds = odds;
    bet.cloudbet.odds_available = true;
    bet.cloudbet.odds_source =
      "CLOUDBET_LIVE_MARKETS";
  }

  return {
    status: "BET_CANDIDATE",
    mode: MODE,
    betting_enabled: false,
    dry_run: true,
    bet_placed: false,
    bet_action: "SIMULATED_ONLY",

    match:
      bet?.match ??
      displayMatch(
        bet?.cloudbet ?? {}
      ),

    signal_match_id:
      bet?.signal_match_id ?? null,

    cloudbet_id:
      getCloudbetId(bet),

    market: BET_MARKET,
    selection: BET_SELECTION,
    stake_eur: BET_STAKE_EUR,

    odds,
    odds_available: oddsAvailable,
    candidate_complete: oddsAvailable,

    odds_source:
      oddsAvailable
        ? "CLOUDBET_LIVE_MARKETS"
        : null,

    cloudbet:
      bet?.cloudbet ?? null,

    matcher:
      bet?.matcher ?? null,

    verification:
      bet?.verification ?? null,

    simulated: true
  };
}

// ============================================================
// MAIN
// ============================================================

async function runV58(
  env: Env
): Promise<AnyObj> {
  const started = Date.now();

  const trackerPromise =
    fetchServiceJSON(
      env.TRACKER,
      "/entries"
    );

  const matcherPromise =
    fetchServiceJSON(
      env.MATCHER,
      `/match?threshold=${MATCHER_THRESHOLD}`
    );

  const cloudbetPromise =
    fetchServiceJSON(
      env.CLOUDBET,
      "/live"
    );

  let trackerData: AnyObj;
  let matcherData: AnyObj;
  let cloudbetData: AnyObj;

  try {
    [
      trackerData,
      matcherData,
      cloudbetData
    ] = await Promise.all([
      trackerPromise,
      matcherPromise,
      cloudbetPromise
    ]);
  } catch (error) {
    return {
      success: false,
      worker: "cloudbet-bet-worker",
      version: VERSION,
      mode: MODE,
      betting: "DISABLED",
      error:
        error instanceof Error
          ? error.message
          : String(error),
      elapsed_ms:
        Date.now() - started
    };
  }

  const allSignals =
    extractSignals(trackerData);

  const hunterEntries =
    allSignals.filter(
      isHunterEntry
    );

  const liveMatches =
    extractCloudbetMatches(
      cloudbetData
    );

  const preparedBets: AnyObj[] = [];
  const matcherFailures: AnyObj[] = [];
  const verificationFailures: AnyObj[] = [];

  for (const signal of hunterEntries) {
    const matcher =
      findBestMatcherCandidate(
        signal,
        matcherData
      );

    if (!matcher.found) {
      matcherFailures.push({
        match:
          signalMatchName(signal),
        signal_match_id:
          signalMatchId(signal),
        reason: matcher.reason,
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
          signalMatchName(signal),
        signal_match_id:
          signalMatchId(signal),
        reason:
          "CLOUDBET_NOT_VERIFIED"
      });

      continue;
    }

    const bet =
      buildPreparedBet(
        signal,
        matcher,
        verification
      );

    bet.entry_minute = Number(
      signal?.minute ??
      signal?.entry_minute ??
      signal?.v27?.minute ??
      null
    );

    preparedBets.push(bet);
  }

  const completeBets: AnyObj[] = [];
  const pendingBets: AnyObj[] = [];

  for (const bet of preparedBets) {
    if (updateBetOdds(bet)) {
      completeBets.push(bet);
    } else {
      pendingBets.push(bet);
    }
  }

  const pendingResults: AnyObj[] = [];

  for (const bet of pendingBets) {
    const result =
      await savePendingOdds(
        env,
        bet
      );

    pendingResults.push({
      match: bet?.match,
      cloudbet_id:
        getCloudbetId(bet),
      ...result
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
      c => c.candidate_complete === true
    );

  const incompleteCandidates =
    candidates.filter(
      c => c.candidate_complete !== true
    );

  return {
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    betting: "DISABLED",
    dry_run: true,
    action: "RUN",

    config: {
      stake_eur: BET_STAKE_EUR,
      market: BET_MARKET,
      selection: BET_SELECTION,
      target_sport: TARGET_SPORT,
      target_period: TARGET_PERIOD,
      target_outcome: TARGET_OUTCOME,
      target_line: TARGET_LINE,
      required_classification:
        REQUIRED_MATCH_CLASSIFICATION,
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
        verificationFailures.length
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
          x => x?.success === true
        ).length,
      pending:
        pendingResults
    },

    candidates: {
      total: candidates.length,
      complete:
        completeCandidates.length,
      incomplete:
        incompleteCandidates.length
    },

    archive,
    prepared_bets: preparedBets,
    bet_candidates: candidates,
    matcher_failures:
      matcherFailures,
    verification_failures:
      verificationFailures,

    elapsed_ms:
      Date.now() - started
  };
}

// ============================================================
// HEALTH
// ============================================================

function healthResponse(
  env: Env
): Response {
  return json({
    success: true,
    worker: "cloudbet-bet-worker",
    version: VERSION,
    mode: MODE,
    betting: "DISABLED",
    dry_run: DRY_RUN,

    bindings: {
      TRACKER: !!env.TRACKER,
      MATCHER: !!env.MATCHER,
      CLOUDBET: !!env.CLOUDBET,
      DB: !!env.DB
    },

    config: {
      market: BET_MARKET,
      selection: BET_SELECTION,
      stake_eur: BET_STAKE_EUR,
      pending_odds: true,
      retry: "CRON_EVERY_MINUTE",
      max_missing_checks:
        MAX_MISSING_CHECKS
    }
  });
}

// ============================================================
// WORKER
// ============================================================

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {
    const url =
      new URL(request.url);

    if (
      url.pathname === "/health" ||
      url.pathname === "/"
    ) {
      return healthResponse(env);
    }

    if (url.pathname === "/run") {
      if (request.method !== "GET") {
        return json(
          {
            success: false,
            error: "METHOD_NOT_ALLOWED"
          },
          405
        );
      }

      try {
        return json(
          await runV58(env)
        );
      } catch (error) {
        return json(
          {
            success: false,
            worker:
              "cloudbet-bet-worker",
            version: VERSION,
            mode: MODE,
            betting: "DISABLED",
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

    if (url.pathname === "/pending") {
      if (!env.DB) {
        return json(
          {
            success: false,
            error: "DB_BINDING_MISSING"
          },
          500
        );
      }

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
          version: VERSION,
          status:
            "PENDING_ODDS",
          count:
            result.results?.length ?? 0,
          pending:
            result.results ?? []
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

    return json(
      {
        success: false,
        error: "NOT_FOUND",
        path: url.pathname,
        available: [
          "/health",
          "/run",
          "/pending"
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
      processPendingOdds(env)
        .then(result => {
          console.log(
            JSON.stringify({
              cron: true,
              version: VERSION,
              ...result
            })
          );
        })
        .catch(error => {
          console.error(
            JSON.stringify({
              cron: true,
              version: VERSION,
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
