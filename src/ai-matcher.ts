// ============================================================
// V1.3.7 AI-FIRST MATCHING — NO HARD NAME/METADATA FILTER
// - Generic fallback gives AI ALL usable RAW Cloudbet LIVE soccer events.
// - Name similarity, score, period, minute and competition are context only.
// - No name shortlist/cutoff can hide the real fixture from AI.
// - AI selects one event_id; returned id must exist in the supplied set.
// - Hard youth/women/reserve guard still runs after AI selection.
// - Direct locked-candidate verification from V1.3.5 is preserved.
// - READ ONLY / NO BETTING.
// ============================================================

// ============================================================
// AI MATCHER V1.3.5 — LOCKED CANDIDATE FIRST + 1H 0:0 FALLBACK
// READ ONLY / NO BETTING
//
// V1.3.5:
// 1) VERIFY_LOCKED_EVENT can verify matcher_sync.weak_candidate / locked_candidate
//    directly, without first loading 200 raw Cloudbet events.
// 2) Generic AI fallback is reduced before AI to LIVE + 1H + 0:0.
// 3) Missing Cloudbet period is tolerated only when minute is known <= 45.
// 4) Explicit non-1H periods and explicit non-0:0 scores are rejected.
// 5) Existing hard category guard (youth/women/reserve) is preserved.
// 6) Same D1 history schema/endpoints are preserved.
// 7) No betting action exists in this Worker.
// ============================================================

type AnyObj = Record<string, any>;

interface Env {
  AI: any;
  DB: any;
  TRACKER: any;
}

const VERSION = "AI-MATCHER-V1.3.7-AI-FIRST-NO-HARD-NAME-FILTER";
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const CLOUDBET_BASE = "https://www.cloudbet.com";
const SPORTS_EVENTS_PATH = "/sports-api/c/v6/sports/events";
const CLOUDBET_TIMEOUT_MS = 8000;
const LIVE_LIMIT = 200;

const AI_BATCH_SIZE = 35;
const AI_FINALISTS_LIMIT = 12;
const AI_ACCEPT_CONFIDENCE = 0.90;

const HISTORY_LIMIT = 500;
const TRACKER_TIMEOUT_MS = 8000;
const MAX_SIGNALS_PER_SCAN = 5;

// ============================================================
// RESPONSE / GENERIC HELPERS
// ============================================================

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type"
    }
  });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

function str(value: any): string {
  return String(value ?? "").trim();
}

function numOrNull(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseMinute(value: any): number | null {
  const n = numOrNull(value);
  if (n !== null) return Math.floor(n);

  const text = str(value);
  const match = text.match(/^(\d{1,3})/);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function splitMatchName(value: any): { home: string | null; away: string | null } {
  const text = str(value);
  if (!text) return { home: null, away: null };

  for (const separator of [" - ", " v ", " vs ", " – ", " — "]) {
    const index = text.toLowerCase().indexOf(separator.toLowerCase());
    if (index >= 0) {
      return {
        home: text.slice(0, index).trim() || null,
        away: text.slice(index + separator.length).trim() || null
      };
    }
  }

  return { home: null, away: null };
}

function extractHome(match: AnyObj): string | null {
  if (typeof match?.home === "string") return str(match.home) || null;
  if (typeof match?.homeTeam === "string") return str(match.homeTeam) || null;
  if (typeof match?.home_name === "string") return str(match.home_name) || null;
  if (typeof match?.home?.name === "string") return str(match.home.name) || null;
  return splitMatchName(match?.match ?? match?.name ?? "").home;
}

function extractAway(match: AnyObj): string | null {
  if (typeof match?.away === "string") return str(match.away) || null;
  if (typeof match?.awayTeam === "string") return str(match.awayTeam) || null;
  if (typeof match?.away_name === "string") return str(match.away_name) || null;
  if (typeof match?.away?.name === "string") return str(match.away.name) || null;
  return splitMatchName(match?.match ?? match?.name ?? "").away;
}

function competitionName(match: AnyObj): string | null {
  if (typeof match?.competition === "string") return str(match.competition) || null;
  if (typeof match?.competition?.name === "string") return str(match.competition.name) || null;
  if (typeof match?.league === "string") return str(match.league) || null;
  if (typeof match?.league?.name === "string") return str(match.league.name) || null;
  return null;
}

function competitionKey(match: AnyObj): string | null {
  if (typeof match?.competition?.key === "string") return str(match.competition.key) || null;
  if (typeof match?.league?.key === "string") return str(match.league.key) || null;
  return null;
}

function eventMinute(match: AnyObj): number | null {
  return parseMinute(
    match?.metadata?.eventTimeExtended ??
    match?.metadata?.eventTime ??
    match?.minute_extended ??
    match?.minute ??
    null
  );
}

function scoreOf(match: AnyObj): { home: number | null; away: number | null } {
  const candidates = [match?.score, match?.scores, match?.result];

  for (const score of candidates) {
    if (!score || typeof score !== "object") continue;

    const home = numOrNull(
      score?.home ?? score?.homeScore ?? score?.home_score ?? score?.participant1
    );
    const away = numOrNull(
      score?.away ?? score?.awayScore ?? score?.away_score ?? score?.participant2
    );

    if (home !== null || away !== null) return { home, away };
  }

  return {
    home: numOrNull(match?.homeScore ?? match?.home_score ?? match?.score_home),
    away: numOrNull(match?.awayScore ?? match?.away_score ?? match?.score_away)
  };
}

function isLive(match: AnyObj): boolean {
  const status = str(match?.status).toUpperCase();
  return (
    match?.live === true ||
    status === "LIVE" ||
    status === "TRADING_LIVE" ||
    status.includes("LIVE")
  );
}

function periodText(match: AnyObj): string | null {
  const value =
    match?.event_status ??
    match?.eventStatus ??
    match?.period ??
    match?.metadata?.period ??
    match?.metadata?.eventStatus ??
    null;

  const text = str(value);
  return text || null;
}

function eventId(match: AnyObj): string {
  return str(match?.id ?? match?.event_id ?? match?.eventId ?? match?.key ?? "");
}

function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// HUNTER SIGNAL
// ============================================================

function normalizeSignal(input: AnyObj): AnyObj {
  const raw = input?.signal && typeof input.signal === "object"
    ? input.signal
    : input;

  const parsed = splitMatchName(raw?.match ?? raw?.match_name ?? raw?.name ?? "");
  const home = str(raw?.home ?? raw?.home_team ?? parsed.home ?? "");
  const away = str(raw?.away ?? raw?.away_team ?? parsed.away ?? "");

  return {
    id: str(raw?.id ?? raw?.signal_id ?? raw?.match_id ?? "") || null,
    match: str(raw?.match ?? raw?.match_name ?? (home && away ? `${home} - ${away}` : "")) || null,
    home: home || null,
    away: away || null,
    competition:
      str(raw?.competition?.name ?? raw?.competition ?? raw?.league?.name ?? raw?.league ?? "") || null,
    minute: parseMinute(raw?.current_minute ?? raw?.minute ?? raw?.entry_minute ?? null),
    period: str(raw?.period ?? "") || null,
    score: raw?.score ?? null,
    hunter_score: numOrNull(raw?.hunter_score ?? raw?.goal_signal?.score ?? raw?.score_value ?? null)
  };
}

function signalValid(signal: AnyObj): boolean {
  return Boolean(signal?.home && signal?.away);
}

// ============================================================
// CLOUDBET LIVE
// ============================================================

async function fetchCloudbetJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLOUDBET_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP_${response.status}`,
        preview: text.slice(0, 500),
        data: null
      };
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: response.status,
        error: "INVALID_JSON",
        preview: text.slice(0, 500),
        data: null
      };
    }

    return { ok: true, status: response.status, error: null, data };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      error: error?.name === "AbortError" ? "TIMEOUT" : String(error?.message ?? error),
      data: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getRawCloudbetLive(): Promise<AnyObj[]> {
  const url = new URL(SPORTS_EVENTS_PATH, CLOUDBET_BASE);
  url.searchParams.set("sports", "soccer");
  url.searchParams.set("live", "true");
  url.searchParams.set("limit", String(LIVE_LIMIT));
  url.searchParams.set("locale", "en");

  const result = await fetchCloudbetJson(url.toString());
  if (!result.ok) throw new Error(`CLOUDBET_LIVE_FAILED:${result.error}`);

  const events: AnyObj[] = [];
  const sports = Array.isArray(result.data?.sports) ? result.data.sports : [];

  for (const sport of sports) {
    const competitions = Array.isArray(sport?.competitions) ? sport.competitions : [];

    for (const competition of competitions) {
      const competitionEvents = Array.isArray(competition?.events) ? competition.events : [];

      for (const event of competitionEvents) {
        events.push({
          ...event,
          sport: event?.sport ?? {
            name: sport?.name ?? null,
            key: sport?.key ?? null
          },
          competition: event?.competition ?? {
            name: competition?.name ?? null,
            key: competition?.key ?? null
          }
        });
      }
    }
  }

  return events;
}

function compactCandidate(event: AnyObj, index: number): AnyObj {
  const score = scoreOf(event);

  return {
    index,
    event_id: eventId(event),
    home: extractHome(event),
    away: extractAway(event),
    competition: competitionName(event),
    competition_key: competitionKey(event),
    status: str(event?.status) || null,
    live: isLive(event),
    period: periodText(event),
    minute: eventMinute(event),
    score_home: score.home,
    score_away: score.away
  };
}

// ============================================================
// V1.3.5 GENERIC FALLBACK FILTER: LIVE + 1H + 0:0
// ============================================================

function normalizedPeriod(value: any): string {
  return str(value)
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function explicitFirstHalf(value: any): boolean | null {
  const p = normalizedPeriod(value);
  if (!p) return null;

  if (
    ["1p", "1h", "1", "first half", "firsthalf", "first period", "firstperiod"].includes(p) ||
    p.includes("first half")
  ) {
    return true;
  }

  if (
    ["2p", "2h", "2", "second half", "secondhalf", "half time", "halftime", "ht"].includes(p) ||
    p.includes("second half")
  ) {
    return false;
  }

  return null;
}

function fallbackCandidateDecision(candidate: AnyObj): AnyObj {
  if (!candidate?.event_id || !candidate?.home || !candidate?.away) {
    return { ok: false, reason: "IDENTITY_FIELDS_MISSING" };
  }

  // Reject only explicit terminal/non-live states. Missing or unusual status is tolerated
  // because this endpoint is already requested with live=true.
  const status = str(candidate?.status).toUpperCase();
  if (
    /(FINISHED|RESULTED|CANCELLED|CANCELED|ABANDONED|POSTPONED|ENDED)/.test(status)
  ) {
    return { ok: false, reason: "EXPLICIT_TERMINAL_STATUS" };
  }

  if (status && !candidate?.live && !status.includes("TRADING")) {
    return { ok: false, reason: "EXPLICIT_NOT_LIVE" };
  }

  // V1.3.6 TOLERANT SCORE RULE:
  // - explicit non-zero score => reject
  // - 0:0 => accept score gate
  // - one/both score sides missing => keep as UNKNOWN instead of rejecting
  const sh = numOrNull(candidate?.score_home);
  const sa = numOrNull(candidate?.score_away);

  if ((sh !== null && sh > 0) || (sa !== null && sa > 0)) {
    return { ok: false, reason: "EXPLICIT_NON_0_0_SCORE" };
  }

  const scoreState =
    sh === 0 && sa === 0
      ? "EXPLICIT_0_0"
      : sh === null && sa === null
        ? "SCORE_UNKNOWN"
        : "SCORE_PARTIAL_UNKNOWN";

  const firstHalf = explicitFirstHalf(candidate?.period);
  if (firstHalf === false) {
    return { ok: false, reason: "EXPLICIT_NOT_FIRST_HALF" };
  }

  if (firstHalf === true) {
    return { ok: true, reason: `${scoreState}_EXPLICIT_1H` };
  }

  // Missing period metadata: use minute when available.
  const minute = parseMinute(candidate?.minute);
  if (minute !== null) {
    if (minute >= 0 && minute <= 45) {
      return { ok: true, reason: `${scoreState}_MINUTE_RECOVERY_1H` };
    }

    return { ok: false, reason: "MINUTE_OUTSIDE_FIRST_HALF" };
  }

  // Both period and minute are missing. Keep the candidate only for the name
  // shortlist; AI still has to prove identity. This prevents metadata omissions
  // from deleting the real fixture before AI sees it.
  return { ok: true, reason: `${scoreState}_PERIOD_MINUTE_UNKNOWN` };
}

function normalizedNameTokens(value: any): string[] {
  const stop = new Set([
    "fc", "afc", "cf", "sc", "ac", "fk", "sk", "nk", "club", "football",
    "futbol", "calcio", "de", "the"
  ]);

  return normalizedCategoryText(value)
    .replace(/\b(18|19|20)\d{2}\b/g, " ")
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length > 1 && !stop.has(t));
}

function tokenNameScore(a: any, b: any): number {
  const aa = normalizedNameTokens(a);
  const bb = normalizedNameTokens(b);
  if (!aa.length || !bb.length) return 0;

  const A = new Set(aa);
  const B = new Set(bb);
  let intersection = 0;
  for (const token of A) if (B.has(token)) intersection++;

  const dice = (2 * intersection) / (A.size + B.size);
  const na = aa.join(" ");
  const nb = bb.join(" ");
  const containment = na.includes(nb) || nb.includes(na) ? 1 : 0;

  return Math.max(dice, containment);
}

function fixtureNameScore(signal: AnyObj, candidate: AnyObj): AnyObj {
  const normalHome = tokenNameScore(signal?.home, candidate?.home);
  const normalAway = tokenNameScore(signal?.away, candidate?.away);
  const normal = (normalHome + normalAway) / 2;

  const reversedHome = tokenNameScore(signal?.home, candidate?.away);
  const reversedAway = tokenNameScore(signal?.away, candidate?.home);
  const reversed = (reversedHome + reversedAway) / 2;

  const useReversed = reversed > normal;

  return {
    score: Math.max(normal, reversed),
    orientation: useReversed ? "REVERSED" : "NORMAL",
    home_score: useReversed ? reversedHome : normalHome,
    away_score: useReversed ? reversedAway : normalAway
  };
}

// ============================================================
// HARD CATEGORY GUARD
// ============================================================

type TeamCategoryProfile = {
  youth_age: string | null;
  women: boolean;
  reserve: boolean;
  reserve_marker: string | null;
};

function normalizedCategoryText(value: any): string {
  return str(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function teamCategoryProfile(value: any): TeamCategoryProfile {
  const text = normalizedCategoryText(value);

  const youthMatch =
    text.match(/(?:^|\s)u[\s-]?(\d{2})(?:\s|$)/i) ??
    text.match(/(?:^|\s)under[\s-]?(\d{2})(?:\s|$)/i);

  const youthAge = youthMatch ? `U${youthMatch[1]}` : null;

  const women =
    /(?:^|\s)(women|woman|womens|ladies|female|femenino|femenina)(?:\s|$)/i.test(text) ||
    /(?:^|\s)w(?:\s|$)/i.test(text);

  const reservePatterns: Array<[RegExp, string]> = [
    [/(?:^|\s)(reserve|reserves|res)(?:\s|$)/i, "RESERVE"],
    [/(?:^|\s)(academy)(?:\s|$)/i, "ACADEMY"],
    [/(?:^|\s)(ii)(?:\s|$)/i, "II"],
    [/(?:^|\s)(b team|team b)(?:\s|$)/i, "B_TEAM"],
    [/\s+b\s*$/i, "B_SUFFIX"],
    [/(?:^|\s)(second team)(?:\s|$)/i, "SECOND_TEAM"]
  ];

  let reserve = false;
  let reserveMarker: string | null = null;

  for (const [pattern, marker] of reservePatterns) {
    if (pattern.test(text)) {
      reserve = true;
      reserveMarker = marker;
      break;
    }
  }

  return {
    youth_age: youthAge,
    women,
    reserve,
    reserve_marker: reserveMarker
  };
}

function compareTeamCategory(
  hunterTeam: any,
  cloudbetTeam: any,
  side: "HOME" | "AWAY"
): AnyObj | null {
  const hunter = teamCategoryProfile(hunterTeam);
  const cloudbet = teamCategoryProfile(cloudbetTeam);

  if (hunter.youth_age !== cloudbet.youth_age && (hunter.youth_age || cloudbet.youth_age)) {
    return {
      side,
      type: "YOUTH_CATEGORY_CONFLICT",
      hunter_team: str(hunterTeam),
      cloudbet_team: str(cloudbetTeam),
      hunter_category: hunter,
      cloudbet_category: cloudbet
    };
  }

  if (hunter.women !== cloudbet.women) {
    return {
      side,
      type: "WOMEN_CATEGORY_CONFLICT",
      hunter_team: str(hunterTeam),
      cloudbet_team: str(cloudbetTeam),
      hunter_category: hunter,
      cloudbet_category: cloudbet
    };
  }

  if (hunter.reserve !== cloudbet.reserve) {
    return {
      side,
      type: "RESERVE_CATEGORY_CONFLICT",
      hunter_team: str(hunterTeam),
      cloudbet_team: str(cloudbetTeam),
      hunter_category: hunter,
      cloudbet_category: cloudbet
    };
  }

  return null;
}

function hardCategoryGuard(signal: AnyObj, candidate: AnyObj): AnyObj {
  const conflicts: AnyObj[] = [];

  const homeConflict = compareTeamCategory(signal?.home, candidate?.home, "HOME");
  const awayConflict = compareTeamCategory(signal?.away, candidate?.away, "AWAY");

  if (homeConflict) conflicts.push(homeConflict);
  if (awayConflict) conflicts.push(awayConflict);

  return { ok: conflicts.length === 0, conflicts };
}

// ============================================================
// AI
// ============================================================

function aiText(result: any): string {
  const choiceContent = result?.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") return choiceContent.trim();
  if (typeof result?.response === "string") return result.response.trim();
  if (typeof result?.result?.response === "string") return result.result.response.trim();
  return "";
}

function parseAiJson(text: string): AnyObj | null {
  if (!text) return null;

  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        const parsed = JSON.parse(cleaned.slice(first, last + 1));
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function boundedConfidence(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function systemPrompt(): string {
  return [
    "You are a football fixture identity matcher.",
    "Your ONLY job is to identify whether a Hunter fixture corresponds to one of the supplied Cloudbet LIVE events.",
    "Provider names can differ because of abbreviations, aliases, sponsorship names, club founding years, transliteration, punctuation, country suffixes, youth notation, women notation, reserve notation, or city/club naming conventions.",
    "Do NOT invent an event_id.",
    "Do NOT select a candidate just because one team matches.",
    "Do NOT treat different youth ages, women vs men, reserve/II/B/Academy vs senior, or clearly different clubs as the same fixture.",
    "Competition, minute, period and score are supporting context only. Missing metadata is not by itself a reason to reject an otherwise clear identity match.",
    "Never discuss betting or whether a wager should be placed.",
    "Return JSON only.",
    "Required schema: {\"matched\":boolean,\"event_id\":string|null,\"confidence\":number,\"reason\":string}.",
    "Confidence must be between 0 and 1.",
    "If there is no sufficiently clear candidate, return matched=false and event_id=null."
  ].join(" ");
}

async function askAiForBatch(env: Env, signal: AnyObj, candidates: AnyObj[]): Promise<AnyObj> {
  const prompt = [
    "HUNTER SIGNAL:",
    JSON.stringify(signal),
    "",
    "CLOUDBET CANDIDATES:",
    JSON.stringify(candidates),
    "",
    "Choose at most one candidate. Return the required JSON object only."
  ].join("\n");

  const started = Date.now();

  const raw = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: prompt }
    ],
    chat_template_kwargs: { enable_thinking: false }
  });

  const text = aiText(raw);

  return {
    processing_ms: Date.now() - started,
    text,
    parsed: parseAiJson(text),
    usage: raw?.usage ?? null
  };
}

function validateAiSelection(parsed: AnyObj | null, candidates: AnyObj[]): AnyObj {
  if (!parsed) {
    return {
      valid: false,
      matched: false,
      event_id: null,
      confidence: 0,
      reason: "AI_JSON_PARSE_FAILED",
      candidate: null
    };
  }

  const wantsMatch = parsed?.matched === true;
  const selectedId = str(parsed?.event_id);
  const confidence = boundedConfidence(parsed?.confidence);
  const reason = str(parsed?.reason) || "AI_NO_REASON";

  if (!wantsMatch || !selectedId) {
    return {
      valid: true,
      matched: false,
      event_id: null,
      confidence,
      reason,
      candidate: null
    };
  }

  const candidate = candidates.find(c => str(c?.event_id) === selectedId) ?? null;
  if (!candidate) {
    return {
      valid: false,
      matched: false,
      event_id: null,
      confidence: 0,
      reason: "AI_RETURNED_EVENT_ID_OUTSIDE_CANDIDATE_SET",
      candidate: null
    };
  }

  return {
    valid: true,
    matched: true,
    event_id: selectedId,
    confidence,
    reason,
    candidate
  };
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function matchWithAi(env: Env, signal: AnyObj, rawEvents: AnyObj[]): Promise<AnyObj> {
  // V1.3.7 AI-FIRST:
  // Every usable RAW Cloudbet LIVE soccer event reaches AI.
  // We intentionally do NOT use name score, minute, score, period or competition
  // as a hard pre-filter. Those fields are evidence for AI, not a gate.
  const candidates = rawEvents
    .map((event, index) => compactCandidate(event, index))
    .filter(candidate => Boolean(candidate.event_id && candidate.home && candidate.away));

  if (candidates.length === 0) {
    return {
      matched: false,
      accepted: false,
      event_id: null,
      confidence: 0,
      reason: "NO_RAW_CLOUDBET_CANDIDATES",
      cloudbet_match: null,
      candidate: null,
      category_guard: { ok: false, conflicts: [] },
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: 0,
        candidate_filter: "AI_FIRST_ALL_RAW_LIVE_NO_HARD_NAME_FILTER",
        batches: 0,
        ai_calls: 0
      }
    };
  }

  const batches = chunks(candidates, AI_BATCH_SIZE);
  const batchResults: AnyObj[] = [];
  const finalists: AnyObj[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const ai = await askAiForBatch(env, signal, batch);
    const checked = validateAiSelection(ai.parsed, batch);

    batchResults.push({
      batch: i + 1,
      candidate_count: batch.length,
      processing_ms: ai.processing_ms,
      usage: ai.usage,
      ai_text: ai.text,
      selection: checked
    });

    if (checked.valid && checked.matched && checked.candidate) {
      finalists.push({
        ...checked.candidate,
        batch_confidence: checked.confidence,
        batch_reason: checked.reason
      });
    }
  }

  if (finalists.length === 0) {
    return {
      matched: false,
      accepted: false,
      event_id: null,
      confidence: 0,
      reason: "AI_NO_MATCH_ACROSS_ALL_RAW_LIVE_BATCHES",
      cloudbet_match: null,
      candidate: null,
      category_guard: { ok: false, conflicts: [] },
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: candidates.length,
        candidate_filter: "AI_FIRST_ALL_RAW_LIVE_NO_HARD_NAME_FILTER",
        batches: batches.length,
        ai_calls: batches.length,
        finalists: 0,
        batch_results: batchResults
      }
    };
  }

  const finalPool = finalists
    .sort((a, b) => Number(b.batch_confidence ?? 0) - Number(a.batch_confidence ?? 0))
    .slice(0, AI_FINALISTS_LIMIT);

  const finalAi = await askAiForBatch(env, signal, finalPool);
  const finalChecked = validateAiSelection(finalAi.parsed, finalPool);

  if (!finalChecked.valid || !finalChecked.matched || !finalChecked.candidate) {
    return {
      matched: false,
      accepted: false,
      event_id: null,
      confidence: finalChecked.confidence,
      reason: finalChecked.reason || "AI_FINAL_CONFIRMATION_FAILED",
      cloudbet_match: null,
      candidate: null,
      category_guard: { ok: false, conflicts: [] },
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: candidates.length,
        candidate_filter: "AI_FIRST_ALL_RAW_LIVE_NO_HARD_NAME_FILTER",
        batches: batches.length,
        ai_calls: batches.length + 1,
        finalists: finalists.length,
        final_processing_ms: finalAi.processing_ms,
        final_ai_text: finalAi.text,
        batch_results: batchResults
      }
    };
  }

  const candidate = finalChecked.candidate;

  // Deterministic safety guard only AFTER AI has selected the fixture.
  const categoryGuard = hardCategoryGuard(signal, candidate);

  if (!categoryGuard.ok) {
    const firstConflict = categoryGuard.conflicts[0] ?? null;
    return {
      matched: true,
      accepted: false,
      event_id: finalChecked.event_id,
      confidence: finalChecked.confidence,
      threshold: AI_ACCEPT_CONFIDENCE,
      reason: firstConflict
        ? `HARD_CATEGORY_GUARD:${firstConflict.type}:${firstConflict.side}`
        : "HARD_CATEGORY_GUARD",
      ai_reason: finalChecked.reason,
      cloudbet_match: `${candidate.home} v ${candidate.away}`,
      candidate,
      category_guard: categoryGuard,
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: candidates.length,
        candidate_filter: "AI_FIRST_ALL_RAW_LIVE_NO_HARD_NAME_FILTER",
        batches: batches.length,
        ai_calls: batches.length + 1,
        finalists: finalists.length,
        final_processing_ms: finalAi.processing_ms,
        final_usage: finalAi.usage,
        batch_results: batchResults
      }
    };
  }

  const accepted = finalChecked.confidence >= AI_ACCEPT_CONFIDENCE;

  return {
    matched: true,
    accepted,
    event_id: finalChecked.event_id,
    confidence: finalChecked.confidence,
    threshold: AI_ACCEPT_CONFIDENCE,
    reason: accepted ? finalChecked.reason : "AI_MATCH_BELOW_ACCEPT_CONFIDENCE",
    ai_reason: finalChecked.reason,
    cloudbet_match: `${candidate.home} v ${candidate.away}`,
    candidate,
    category_guard: categoryGuard,
    diagnostics: {
      raw_events: rawEvents.length,
      usable_candidates: candidates.length,
      candidate_filter: "AI_FIRST_ALL_RAW_LIVE_NO_HARD_NAME_FILTER",
      batches: batches.length,
      ai_calls: batches.length + 1,
      finalists: finalists.length,
      final_processing_ms: finalAi.processing_ms,
      final_usage: finalAi.usage,
      batch_results: batchResults
    }
  };
}

// ============================================================
// V1.3.5 — LOCKED CANDIDATE FIRST
// ============================================================

function requestedResolveMode(input: AnyObj): string {
  return str(input?.resolve_mode ?? input?.matcher_sync?.ai_mode ?? "").toUpperCase();
}

function requestedLockedEventId(input: AnyObj): string | null {
  const id = str(
    input?.locked_event_id ??
    input?.matcher_sync?.old_matcher_event_id ??
    ""
  );
  return id || null;
}

function requestedLockedCandidate(input: AnyObj): AnyObj | null {
  const candidate =
    input?.locked_candidate ??
    input?.matcher_sync?.weak_candidate ??
    input?.matcher_sync?.old_matcher_candidate ??
    null;

  return candidate && typeof candidate === "object" ? candidate : null;
}

function normalizeSuppliedCandidate(raw: AnyObj): AnyObj {
  const parsed = splitMatchName(raw?.match ?? raw?.name ?? "");
  const score = scoreOf(raw);

  return {
    index: 0,
    event_id: str(raw?.event_id ?? raw?.eventId ?? raw?.id ?? raw?.key ?? ""),
    home: str(raw?.home ?? raw?.home_team ?? raw?.homeTeam ?? parsed.home ?? "") || null,
    away: str(raw?.away ?? raw?.away_team ?? raw?.awayTeam ?? parsed.away ?? "") || null,
    competition: competitionName(raw),
    competition_key: competitionKey(raw),
    status: str(raw?.status) || null,
    live: raw?.live === true || isLive(raw),
    period: periodText(raw),
    minute: parseMinute(
      raw?.minute ??
      raw?.minute_extended ??
      raw?.cloudbet_minute ??
      raw?.metadata?.eventTimeExtended ??
      null
    ),
    score_home: score.home ?? numOrNull(raw?.score_home),
    score_away: score.away ?? numOrNull(raw?.score_away)
  };
}

async function verifyCandidateObjectWithAi(
  env: Env,
  signal: AnyObj,
  lockedEventId: string,
  candidate: AnyObj,
  source: string
): Promise<AnyObj> {
  if (!candidate?.event_id || candidate.event_id !== lockedEventId) {
    return {
      matched: false,
      accepted: false,
      event_id: lockedEventId,
      confidence: 0,
      reason: "LOCKED_CANDIDATE_EVENT_ID_MISMATCH",
      cloudbet_match: null,
      candidate,
      category_guard: { ok: false, conflicts: [] },
      locked_event_id: lockedEventId,
      diagnostics: {
        mode: "VERIFY_LOCKED_EVENT",
        candidate_source: source,
        raw_feed_used: false,
        candidates_given_to_ai: 0
      }
    };
  }

  if (!candidate.home || !candidate.away) {
    return {
      matched: false,
      accepted: false,
      event_id: lockedEventId,
      confidence: 0,
      reason: "LOCKED_CANDIDATE_TEAMS_MISSING",
      cloudbet_match: null,
      candidate,
      category_guard: { ok: false, conflicts: [] },
      locked_event_id: lockedEventId,
      diagnostics: {
        mode: "VERIFY_LOCKED_EVENT",
        candidate_source: source,
        raw_feed_used: false,
        candidates_given_to_ai: 0
      }
    };
  }

  const categoryGuard = hardCategoryGuard(signal, candidate);
  if (!categoryGuard.ok) {
    const firstConflict = categoryGuard.conflicts[0] ?? null;
    return {
      matched: true,
      accepted: false,
      event_id: lockedEventId,
      confidence: 0,
      reason: firstConflict
        ? `HARD_CATEGORY_GUARD:${firstConflict.type}:${firstConflict.side}`
        : "HARD_CATEGORY_GUARD",
      cloudbet_match: `${candidate.home} v ${candidate.away}`,
      candidate,
      category_guard: categoryGuard,
      locked_event_id: lockedEventId,
      diagnostics: {
        mode: "VERIFY_LOCKED_EVENT",
        candidate_source: source,
        raw_feed_used: false,
        candidates_given_to_ai: 0
      }
    };
  }

  const aiResult = await askAiForBatch(env, signal, [candidate]);
  const checked = validateAiSelection(aiResult.parsed, [candidate]);

  const sameEvent =
    checked?.valid === true &&
    checked?.matched === true &&
    str(checked?.event_id) === lockedEventId;

  const confidence = boundedConfidence(checked?.confidence);
  const accepted = sameEvent && confidence >= AI_ACCEPT_CONFIDENCE;

  return {
    matched: sameEvent,
    accepted,
    event_id: lockedEventId,
    confidence,
    threshold: AI_ACCEPT_CONFIDENCE,
    reason: accepted
      ? (checked?.reason || "AI_CONFIRMED_LOCKED_EVENT")
      : (checked?.reason || "AI_DID_NOT_CONFIRM_LOCKED_EVENT"),
    cloudbet_match: `${candidate.home} v ${candidate.away}`,
    candidate,
    category_guard: categoryGuard,
    locked_event_id: lockedEventId,
    diagnostics: {
      mode: "VERIFY_LOCKED_EVENT",
      candidate_source: source,
      raw_feed_used: false,
      candidates_given_to_ai: 1,
      ai_processing_ms: aiResult?.processing_ms ?? null,
      ai_usage: aiResult?.usage ?? null
    }
  };
}

async function verifyLockedCandidateDirect(
  env: Env,
  rawInput: AnyObj,
  signal: AnyObj
): Promise<AnyObj | null> {
  const lockedEventId = requestedLockedEventId(rawInput);
  const suppliedRaw = requestedLockedCandidate(rawInput);

  if (!lockedEventId || !suppliedRaw) return null;

  const candidate = normalizeSuppliedCandidate(suppliedRaw);

  return verifyCandidateObjectWithAi(
    env,
    signal,
    lockedEventId,
    candidate,
    "LOCKED_CANDIDATE_FROM_MATCHER"
  );
}

async function verifyLockedEventFromRawFeed(
  env: Env,
  rawInput: AnyObj,
  signal: AnyObj,
  rawEvents: AnyObj[]
): Promise<AnyObj> {
  const lockedEventId = requestedLockedEventId(rawInput);

  if (!lockedEventId) {
    return {
      matched: false,
      accepted: false,
      event_id: null,
      confidence: 0,
      reason: "LOCKED_EVENT_ID_MISSING",
      cloudbet_match: null,
      candidate: null,
      category_guard: { ok: false, conflicts: [] }
    };
  }

  const rawCandidate = rawEvents.find(event => eventId(event) === lockedEventId);

  if (!rawCandidate) {
    return {
      matched: false,
      accepted: false,
      event_id: lockedEventId,
      confidence: 0,
      reason: "LOCKED_EVENT_NOT_IN_CURRENT_LIVE_FEED",
      cloudbet_match: null,
      candidate: null,
      category_guard: { ok: false, conflicts: [] },
      locked_event_id: lockedEventId,
      diagnostics: {
        mode: "VERIFY_LOCKED_EVENT",
        candidate_source: "RAW_LIVE_FEED_EVENT_ID_LOOKUP",
        raw_feed_used: true,
        raw_events: rawEvents.length,
        candidates_given_to_ai: 0
      }
    };
  }

  const candidate = compactCandidate(rawCandidate, 0);
  const result = await verifyCandidateObjectWithAi(
    env,
    signal,
    lockedEventId,
    candidate,
    "RAW_LIVE_FEED_EVENT_ID_LOOKUP"
  );

  result.diagnostics = {
    ...(result.diagnostics ?? {}),
    raw_feed_used: true,
    raw_events: rawEvents.length
  };

  return result;
}

// ============================================================
// D1 HISTORY / TRACKER
// ============================================================

async function ensureSchema(env: Env): Promise<void> {
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS ai_match_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signal_key TEXT NOT NULL UNIQUE,
      signal_id TEXT,
      match_id TEXT,
      hunter_match TEXT NOT NULL,
      hunter_home TEXT NOT NULL,
      hunter_away TEXT NOT NULL,
      competition TEXT,
      hunter_minute INTEGER,
      hunter_score REAL,
      ai_matched INTEGER NOT NULL DEFAULT 0,
      ai_accepted INTEGER NOT NULL DEFAULT 0,
      cloudbet_event_id TEXT,
      cloudbet_match TEXT,
      confidence REAL NOT NULL DEFAULT 0,
      reason TEXT,
      cloudbet_period TEXT,
      cloudbet_minute INTEGER,
      raw_events INTEGER,
      usable_candidates INTEGER,
      ai_calls INTEGER,
      processing_ms INTEGER,
      matcher_version TEXT,
      category_guard_ok INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  for (const migration of [
    "ALTER TABLE ai_match_history ADD COLUMN matcher_version TEXT",
    "ALTER TABLE ai_match_history ADD COLUMN category_guard_ok INTEGER"
  ]) {
    try {
      await env.DB.prepare(migration).run();
    } catch (error: any) {
      const message = String(error?.message ?? error).toLowerCase();
      if (!message.includes("duplicate column") && !message.includes("already exists")) throw error;
    }
  }

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_ai_match_history_created_at
     ON ai_match_history(created_at DESC)`
  ).run();
}

function trackerEntries(data: any): AnyObj[] {
  if (!data) return [];
  if (Array.isArray(data.entries)) return data.entries;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.signals)) return data.signals;
  if (Array.isArray(data.data?.entries)) return data.data.entries;
  if (Array.isArray(data.data?.signals)) return data.data.signals;
  return [];
}

function trackerSignalEligible(raw: AnyObj): boolean {
  const signal = normalizeSignal(raw);
  if (!signalValid(signal)) return false;

  const status = str(raw?.status ?? raw?.state ?? "").toUpperCase();
  if (status && !["ENTRY", "TRACKING", "ACTIVE", "SIGNAL", "HUNTER"].includes(status)) {
    return false;
  }

  return true;
}

function signalKey(raw: AnyObj, signal: AnyObj): string {
  const explicit = str(raw?.id ?? raw?.signal_id ?? "");
  if (explicit) return `id:${explicit}`;

  const matchId = str(raw?.match_id ?? signal?.id ?? "");
  const entryMinute = parseMinute(raw?.entry_minute ?? signal?.minute ?? null);
  const entryTime = str(raw?.entry_time ?? raw?.created_at ?? raw?.timestamp ?? "");

  if (matchId) return `match:${matchId}:${entryMinute ?? "x"}:${entryTime || "x"}`;

  return [
    "fixture",
    str(signal?.home).toLowerCase(),
    str(signal?.away).toLowerCase(),
    str(signal?.competition).toLowerCase(),
    String(entryMinute ?? "x"),
    entryTime || "x"
  ].join("|");
}

async function fetchTrackerEntries(env: Env): Promise<AnyObj[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TRACKER_TIMEOUT_MS);

  try {
    const response = await env.TRACKER.fetch("https://tracker.internal/entries", {
      method: "GET",
      signal: controller.signal,
      headers: { accept: "application/json" }
    });

    if (!response.ok) throw new Error(`TRACKER_HTTP_${response.status}`);
    const data = await response.json();
    return trackerEntries(data);
  } finally {
    clearTimeout(timeout);
  }
}

async function historyHasKey(env: Env, key: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT id FROM ai_match_history WHERE signal_key = ? LIMIT 1"
  ).bind(key).first();
  return Boolean(row);
}

async function getHistoryRowByKey(env: Env, key: string): Promise<AnyObj | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM ai_match_history WHERE signal_key = ? LIMIT 1`
  ).bind(key).first();
  return row ? row as AnyObj : null;
}

function cachedResultFromRow(row: AnyObj): AnyObj {
  const categoryGuardOk = Number(row?.category_guard_ok) === 1;

  return {
    matched: Number(row?.ai_matched) === 1,
    accepted: Number(row?.ai_accepted) === 1 && categoryGuardOk,
    event_id: str(row?.cloudbet_event_id) || null,
    confidence: boundedConfidence(row?.confidence),
    reason: str(row?.reason) || null,
    cloudbet_match: str(row?.cloudbet_match) || null,
    candidate: {
      event_id: str(row?.cloudbet_event_id) || null,
      period: row?.cloudbet_period ?? null,
      minute: parseMinute(row?.cloudbet_minute)
    },
    category_guard: { ok: categoryGuardOk, conflicts: [] },
    cache: {
      hit: true,
      matcher_version: row?.matcher_version ?? null,
      signal_key: row?.signal_key ?? null,
      created_at: row?.created_at ?? null
    }
  };
}

async function storeHistory(
  env: Env,
  rawSignal: AnyObj,
  signal: AnyObj,
  result: AnyObj,
  processingMs: number,
  forcedKey?: string
): Promise<void> {
  const key = forcedKey || signalKey(rawSignal, signal);
  const candidate = result?.candidate ?? null;
  const diagnostics = result?.diagnostics ?? {};
  const categoryGuardOk = result?.category_guard?.ok === true ? 1 : 0;

  await env.DB.prepare(`
    INSERT INTO ai_match_history (
      signal_key, signal_id, match_id, hunter_match, hunter_home, hunter_away,
      competition, hunter_minute, hunter_score, ai_matched, ai_accepted,
      cloudbet_event_id, cloudbet_match, confidence, reason, cloudbet_period,
      cloudbet_minute, raw_events, usable_candidates, ai_calls, processing_ms,
      matcher_version, category_guard_ok
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(signal_key) DO UPDATE SET
      signal_id = excluded.signal_id,
      match_id = excluded.match_id,
      hunter_match = excluded.hunter_match,
      hunter_home = excluded.hunter_home,
      hunter_away = excluded.hunter_away,
      competition = excluded.competition,
      hunter_minute = excluded.hunter_minute,
      hunter_score = excluded.hunter_score,
      ai_matched = excluded.ai_matched,
      ai_accepted = excluded.ai_accepted,
      cloudbet_event_id = excluded.cloudbet_event_id,
      cloudbet_match = excluded.cloudbet_match,
      confidence = excluded.confidence,
      reason = excluded.reason,
      cloudbet_period = excluded.cloudbet_period,
      cloudbet_minute = excluded.cloudbet_minute,
      raw_events = excluded.raw_events,
      usable_candidates = excluded.usable_candidates,
      ai_calls = excluded.ai_calls,
      processing_ms = excluded.processing_ms,
      matcher_version = excluded.matcher_version,
      category_guard_ok = excluded.category_guard_ok,
      created_at = CURRENT_TIMESTAMP
  `).bind(
    key,
    str(rawSignal?.id ?? rawSignal?.signal_id ?? "") || null,
    str(rawSignal?.match_id ?? signal?.id ?? "") || null,
    signal?.match ?? `${signal?.home ?? ""} - ${signal?.away ?? ""}`,
    signal?.home,
    signal?.away,
    signal?.competition ?? null,
    signal?.minute ?? null,
    signal?.hunter_score ?? null,
    result?.matched ? 1 : 0,
    result?.accepted ? 1 : 0,
    result?.event_id ?? null,
    result?.cloudbet_match ?? null,
    boundedConfidence(result?.confidence),
    str(result?.reason ?? result?.ai_reason ?? "") || null,
    candidate?.period ?? null,
    candidate?.minute ?? null,
    diagnostics?.raw_events ?? null,
    diagnostics?.usable_candidates ?? diagnostics?.candidates_given_to_ai ?? null,
    diagnostics?.ai_calls ?? (diagnostics?.candidates_given_to_ai === 1 ? 1 : null),
    processingMs,
    VERSION,
    categoryGuardOk
  ).run();

  await env.DB.prepare(`
    DELETE FROM ai_match_history
    WHERE id NOT IN (
      SELECT id FROM ai_match_history ORDER BY id DESC LIMIT ?
    )
  `).bind(HISTORY_LIMIT).run();
}

async function getHistory(env: Env, limit = HISTORY_LIMIT): Promise<AnyObj[]> {
  const safeLimit = Math.max(1, Math.min(HISTORY_LIMIT, Math.floor(limit)));
  const result = await env.DB.prepare(`
    SELECT * FROM ai_match_history ORDER BY id DESC LIMIT ?
  `).bind(safeLimit).all();

  return Array.isArray(result?.results) ? result.results as AnyObj[] : [];
}

async function processOneSignal(
  env: Env,
  rawSignal: AnyObj,
  forcedKey?: string
): Promise<AnyObj> {
  const signal = normalizeSignal(rawSignal);

  if (!signalValid(signal)) {
    return { processed: false, reason: "INVALID_SIGNAL", signal };
  }

  const started = Date.now();
  const resolveMode = requestedResolveMode(rawSignal);
  let result: AnyObj;

  // V1.3.5: if matcher supplied the concrete candidate, verify it directly.
  if (resolveMode === "VERIFY_LOCKED_EVENT") {
    const direct = await verifyLockedCandidateDirect(env, rawSignal, signal);

    if (direct) {
      result = direct;
    } else {
      // Backward-compatible fallback for callers that send only event_id.
      const rawEvents = await getRawCloudbetLive();
      result = await verifyLockedEventFromRawFeed(env, rawSignal, signal, rawEvents);
    }
  } else {
    const rawEvents = await getRawCloudbetLive();
    result = await matchWithAi(env, signal, rawEvents);
  }

  const processingMs = Date.now() - started;
  await storeHistory(env, rawSignal, signal, result, processingMs, forcedKey);

  return {
    processed: true,
    signal,
    result,
    processing_ms: processingMs
  };
}

async function scanTracker(env: Env): Promise<AnyObj> {
  await ensureSchema(env);

  if (!env.AI) throw new Error("AI_BINDING_MISSING");
  if (!env.TRACKER) throw new Error("TRACKER_BINDING_MISSING");

  const entries = await fetchTrackerEntries(env);
  const eligible = entries.filter(trackerSignalEligible);
  const unseen: Array<{ raw: AnyObj; signal: AnyObj; key: string }> = [];

  for (const raw of eligible) {
    const signal = normalizeSignal(raw);
    const key = signalKey(raw, signal);
    if (await historyHasKey(env, key)) continue;
    unseen.push({ raw, signal, key });
  }

  unseen.reverse();
  const selected = unseen.slice(0, MAX_SIGNALS_PER_SCAN);
  const processed: AnyObj[] = [];

  for (const item of selected) {
    try {
      processed.push(await processOneSignal(env, item.raw, item.key));
    } catch (error: any) {
      processed.push({
        processed: false,
        signal: item.signal,
        reason: "PROCESS_FAILED",
        error: String(error?.message ?? error)
      });
    }
  }

  return {
    success: true,
    action: "TRACKER_AUTO_SCAN",
    tracker_entries: entries.length,
    eligible_entries: eligible.length,
    unseen_entries: unseen.length,
    processed_now: processed.length,
    remaining_unseen: Math.max(0, unseen.length - processed.length),
    max_per_scan: MAX_SIGNALS_PER_SCAN,
    results: processed
  };
}

// ============================================================
// SIMPLE DASHBOARD
// ============================================================

function confidenceLabel(value: any): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function dashboardPage(rows: AnyObj[]): string {
  const tableRows = rows.map(row => {
    const accepted = Number(row.ai_accepted) === 1;
    const matched = Number(row.ai_matched) === 1;
    const status = accepted ? "✅ MATCH" : matched ? "⚠️ LOW CONF" : "❌ NO MATCH";

    return `<tr>
      <td>${escapeHtml(row.created_at)}</td>
      <td><b>${escapeHtml(row.hunter_home)} vs ${escapeHtml(row.hunter_away)}</b><br><small>${escapeHtml(row.competition ?? "")}</small></td>
      <td>${escapeHtml(row.cloudbet_match ?? "—")}</td>
      <td>${confidenceLabel(row.confidence)}</td>
      <td>${escapeHtml(row.cloudbet_event_id ?? "—")}</td>
      <td>${status}</td>
      <td>${escapeHtml(row.reason ?? "—")}</td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="bg">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>AI Matcher Watch</title>
<style>
body{margin:0;background:#0b1020;color:#eef2ff;font-family:system-ui,Arial,sans-serif}.wrap{padding:16px;max-width:1500px;margin:auto}table{width:100%;border-collapse:collapse;background:#11182b}th,td{padding:10px;border-bottom:1px solid #25304d;text-align:left;font-size:13px}th{background:#18213a}.badge{display:inline-block;padding:6px 10px;background:#18213a;border-radius:999px;color:#cbd5e1;margin-bottom:12px}.scroll{overflow:auto}a{color:#93c5fd}
</style></head><body><div class="wrap">
<h2>🤖 AI Matcher Watch</h2><div class="badge">${escapeHtml(VERSION)} · READ ONLY · Betting disabled</div>
<p><a href="/scan">▶ Manual scan</a> · <a href="/api/history">JSON history</a> · <a href="/live-test">Live filter test</a></p>
<div class="scroll"><table><thead><tr><th>UTC</th><th>Hunter</th><th>Cloudbet</th><th>Confidence</th><th>Event ID</th><th>Status</th><th>Reason</th></tr></thead><tbody>${tableRows}</tbody></table></div>
</div></body></html>`;
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type"
        }
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET") {
      try {
        await ensureSchema(env);
        return html(dashboardPage(await getHistory(env)));
      } catch (error: any) {
        return html(`<h2>AI Matcher</h2><pre>${escapeHtml(String(error?.message ?? error))}</pre>`, 500);
      }
    }

    if (url.pathname === "/status" && request.method === "GET") {
      return json({
        success: true,
        worker: "ai-matcher",
        version: VERSION,
        mode: "READ_ONLY",
        betting: "DISABLED",
        ai_binding: Boolean(env.AI),
        db_binding: Boolean(env.DB),
        tracker_binding: Boolean(env.TRACKER),
        model: MODEL,
        architecture: "LOCKED CANDIDATE DIRECT VERIFY -> GENERIC LIVE + 1H + 0:0 AI FALLBACK -> HARD CATEGORY GUARD",
        fallback_filter: "AI-FIRST: all usable RAW live soccer candidates; metadata is context only",
        endpoints: {
          dashboard: "GET /",
          status: "GET /status",
          scan: "GET /scan",
          history: "GET /api/history",
          resolve: "POST /resolve",
          live_test: "GET /live-test",
          match_get: "GET /match-get?home=...&away=...&competition=...&minute=...",
          match: "POST /match"
        }
      });
    }

    if (url.pathname === "/scan" && request.method === "GET") {
      try {
        return json({ worker: "ai-matcher", version: VERSION, ...(await scanTracker(env)) });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "TRACKER_SCAN_FAILED",
          message: String(error?.message ?? error)
        }, 500);
      }
    }

    if (url.pathname === "/api/history" && request.method === "GET") {
      try {
        await ensureSchema(env);
        const rows = await getHistory(env);
        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          count: rows.length,
          limit: HISTORY_LIMIT,
          history: rows
        });
      } catch (error: any) {
        return json({ success: false, error: "HISTORY_FAILED", message: String(error?.message ?? error) }, 500);
      }
    }

    if (url.pathname === "/live-test" && request.method === "GET") {
      try {
        const events = await getRawCloudbetLive();
        const allCandidates = events
          .map((event, index) => compactCandidate(event, index))
          .filter(candidate => Boolean(candidate.event_id && candidate.home && candidate.away));
        const filtered = allCandidates.filter(c => fallbackCandidateDecision(c).ok === true);

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "LIVE_1H_0_0_FILTER_TEST",
          betting: "DISABLED",
          raw_events: events.length,
          identity_candidates: allCandidates.length,
          filtered_1h_0_0: filtered.length,
          sample: filtered.slice(0, 30),
          rejected_sample: allCandidates
            .filter(c => !fallbackCandidateDecision(c).ok)
            .slice(0, 15)
            .map(c => ({ ...c, filter_reason: fallbackCandidateDecision(c).reason }))
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "RAW_CLOUDBET_LIVE_FAILED",
          message: String(error?.message ?? error)
        }, 502);
      }
    }

    if (url.pathname === "/match-get" && request.method === "GET") {
      if (!env.AI) return json({ success: false, error: "AI_BINDING_MISSING" }, 500);

      const signal = normalizeSignal({
        home: url.searchParams.get("home"),
        away: url.searchParams.get("away"),
        competition: url.searchParams.get("competition"),
        minute: url.searchParams.get("minute"),
        period: url.searchParams.get("period"),
        hunter_score: url.searchParams.get("hunter_score")
      });

      if (!signalValid(signal)) {
        return json({
          success: false,
          error: "INVALID_SIGNAL",
          required_query_params: ["home", "away"],
          received_signal: signal
        }, 400);
      }

      try {
        await ensureSchema(env);
        const processed = await processOneSignal(env, signal, `manual:${crypto.randomUUID()}`);
        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "GET_DYNAMIC_AI_MATCH_TEST",
          mode: "READ_ONLY",
          betting: "DISABLED",
          ...processed
        });
      } catch (error: any) {
        return json({ success: false, error: "AI_MATCH_FAILED", message: String(error?.message ?? error) }, 500);
      }
    }

    if (url.pathname === "/resolve" && request.method === "POST") {
      if (!env.AI) return json({ success: false, error: "AI_BINDING_MISSING" }, 500);

      let body: AnyObj;
      try {
        body = (await request.json()) as AnyObj;
      } catch {
        return json({ success: false, error: "INVALID_JSON_BODY" }, 400);
      }

      const signal = normalizeSignal(body);
      if (!signalValid(signal)) {
        return json({ success: false, error: "INVALID_SIGNAL", received_signal: signal }, 400);
      }

      try {
        await ensureSchema(env);

        const key = signalKey(body, signal);
        const existing = await getHistoryRowByKey(env, key);
        const resolveMode = requestedResolveMode(body);

        // Generic current-version result can be cached.
        // Locked candidate verification is always candidate-specific.
        if (
          resolveMode !== "VERIFY_LOCKED_EVENT" &&
          existing &&
          str(existing?.matcher_version) === VERSION
        ) {
          return json({
            success: true,
            worker: "ai-matcher",
            version: VERSION,
            action: "RESOLVE",
            mode: "READ_ONLY",
            betting: "DISABLED",
            processed: true,
            signal,
            result: cachedResultFromRow(existing),
            cache_hit: true,
            signal_key: key,
            processing_ms: 0
          });
        }

        const effectiveKey =
          resolveMode === "VERIFY_LOCKED_EVENT"
            ? `${key}|locked:${requestedLockedEventId(body) || "missing"}`
            : key;

        const processed = await processOneSignal(env, body, effectiveKey);

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "RESOLVE",
          mode: "READ_ONLY",
          betting: "DISABLED",
          cache_hit: false,
          signal_key: key,
          ...processed
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "AI_RESOLVE_FAILED",
          message: String(error?.message ?? error)
        }, 500);
      }
    }

    if (url.pathname === "/match" && request.method === "POST") {
      if (!env.AI) return json({ success: false, error: "AI_BINDING_MISSING" }, 500);

      let body: AnyObj;
      try {
        body = (await request.json()) as AnyObj;
      } catch {
        return json({ success: false, error: "INVALID_JSON_BODY" }, 400);
      }

      const signal = normalizeSignal(body);
      if (!signalValid(signal)) {
        return json({ success: false, error: "INVALID_SIGNAL", received_signal: signal }, 400);
      }

      try {
        await ensureSchema(env);
        const processed = await processOneSignal(env, body);
        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          mode: "READ_ONLY",
          betting: "DISABLED",
          ...processed
        });
      } catch (error: any) {
        return json({ success: false, error: "AI_MATCH_FAILED", message: String(error?.message ?? error) }, 500);
      }
    }

    return json({
      success: false,
      error: "NOT_FOUND",
      endpoints: [
        "GET /",
        "GET /status",
        "GET /scan",
        "GET /api/history",
        "GET /live-test",
        "GET /match-get",
        "POST /resolve",
        "POST /match"
      ]
    }, 404);
  },

  async scheduled(_controller: any, env: Env, ctx: any): Promise<void> {
    ctx.waitUntil((async () => {
      try {
        await scanTracker(env);
      } catch (error) {
        console.error("AI_MATCHER_CRON_FAILED", error);
      }
    })());
  }
};
