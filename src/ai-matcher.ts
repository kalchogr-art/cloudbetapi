// ============================================================
// V1.3.2 HARD CATEGORY GUARD
// - AI still sees all RAW Cloudbet live soccer events
// - Missing Cloudbet minute/period remains allowed
// - Final AI event_id is deterministically blocked on explicit:
//     U19/U20/U21/etc mismatch
//     Women vs Men mismatch
//     Reserve / II / B-team / Academy vs Senior mismatch
// - AI confidence cannot override a hard category conflict
// - READ ONLY / NO BETTING
// ============================================================

// ============================================================
// AI MATCHER — V1.0
// RAW CLOUDBET LIVE SOCCER -> WORKERS AI MATCH IDENTITY
// READ ONLY / NO BETTING
//
// PURPOSE
// - Receives a Hunter signal
// - Reads RAW Cloudbet LIVE soccer events directly
// - DOES NOT drop candidates by fuzzy-name formulas
// - Sends all raw live candidates to AI in batches
// - AI chooses the most likely Cloudbet event_id
// - Returned event_id is verified against the exact candidate set
// - NO BETTING ACTION EXISTS IN THIS WORKER
// ============================================================

type AnyObj = Record<string, any>;

interface Env {
  AI: any;
  DB: any;
  TRACKER: any;
}

const VERSION = "AI-MATCHER-V1.3.2-HARD-CATEGORY-GUARD";
const MODEL = "@cf/google/gemma-4-26b-a4b-it";

const CLOUDBET_BASE = "https://www.cloudbet.com";
const SPORTS_EVENTS_PATH = "/sports-api/c/v6/sports/events";
const CLOUDBET_TIMEOUT_MS = 8000;
const LIVE_LIMIT = 200;

// Every raw LIVE event is allowed to reach AI.
// We batch only to keep prompts manageable.
const AI_BATCH_SIZE = 35;
const AI_FINALISTS_LIMIT = 12;
const AI_ACCEPT_CONFIDENCE = 0.90;

// ============================================================
// RESPONSE
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

// ============================================================
// GENERIC HELPERS
// ============================================================

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
  if (typeof match?.home === "string") return match.home;
  if (typeof match?.homeTeam === "string") return match.homeTeam;
  if (typeof match?.home_name === "string") return match.home_name;
  if (typeof match?.home?.name === "string") return match.home.name;

  return splitMatchName(match?.match ?? match?.name ?? "").home;
}

function extractAway(match: AnyObj): string | null {
  if (typeof match?.away === "string") return match.away;
  if (typeof match?.awayTeam === "string") return match.awayTeam;
  if (typeof match?.away_name === "string") return match.away_name;
  if (typeof match?.away?.name === "string") return match.away.name;

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
  const candidates = [
    match?.score,
    match?.scores,
    match?.result
  ];

  for (const score of candidates) {
    if (!score || typeof score !== "object") continue;

    const home = numOrNull(
      score?.home ?? score?.homeScore ?? score?.home_score ?? score?.participant1
    );
    const away = numOrNull(
      score?.away ?? score?.awayScore ?? score?.away_score ?? score?.participant2
    );

    if (home !== null || away !== null) {
      return { home, away };
    }
  }

  return {
    home: numOrNull(match?.homeScore ?? match?.home_score),
    away: numOrNull(match?.awayScore ?? match?.away_score)
  };
}

function isLive(match: AnyObj): boolean {
  const status = str(match?.status).toUpperCase();
  return match?.live === true || status === "LIVE" || status === "TRADING_LIVE" || status.includes("LIVE");
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

// ============================================================
// HUNTER SIGNAL PARSER
// ============================================================

function normalizeSignal(input: AnyObj): AnyObj {
  const raw = input?.signal && typeof input.signal === "object"
    ? input.signal
    : input;

  const parsedFromMatch = splitMatchName(raw?.match ?? raw?.match_name ?? raw?.name ?? "");

  const home = str(raw?.home ?? raw?.home_team ?? parsedFromMatch.home ?? "");
  const away = str(raw?.away ?? raw?.away_team ?? parsedFromMatch.away ?? "");

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
// DIRECT CLOUDBET RAW LIVE SOCCER
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

  // IMPORTANT:
  // NO market filter here.
  // NO minute filter here.
  // NO period filter here.
  // NO score filter here.
  // NO name similarity filter here.
  const result = await fetchCloudbetJson(url.toString());

  if (!result.ok) {
    throw new Error(`CLOUDBET_LIVE_FAILED:${result.error}`);
  }

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

  // The endpoint is requested with live=true, but we keep this tolerant:
  // if Cloudbet omits/changes the status field we do not silently drop it.
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
// HARD CATEGORY GUARD
// ============================================================
//
// Purpose:
// AI may identify aliases very well, but category identity must never be
// overridden by AI confidence. These checks are deterministic and run
// AFTER the final AI selection.
//
// IMPORTANT:
// - Missing Cloudbet minute / period is NOT a rejection reason.
// - Only explicit team-category conflicts are blocked.
// - The guard compares HOME-to-HOME and AWAY-to-AWAY separately.
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
  const raw = str(value);
  const text = normalizedCategoryText(raw);

  const youthMatch =
    text.match(/(?:^|\s)u[\s-]?(\d{2})(?:\s|$)/i) ??
    text.match(/(?:^|\s)under[\s-]?(\d{2})(?:\s|$)/i);

  const youthAge = youthMatch ? `U${youthMatch[1]}` : null;

  const women =
    /(?:^|\s)(women|woman|womens|ladies|female|femenino|femenina)(?:\s|$)/i.test(text) ||
    /(?:^|\s)w(?:\s|$)/i.test(text);

  // Reserve / second-team markers.
  // These are deliberately conservative to avoid treating numbers that are
  // part of normal club names as reserve markers.
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

  // Explicit youth age mismatch OR youth only on one side.
  if (hunter.youth_age !== cloudbet.youth_age) {
    if (hunter.youth_age || cloudbet.youth_age) {
      return {
        side,
        type: "YOUTH_CATEGORY_CONFLICT",
        hunter_team: str(hunterTeam),
        cloudbet_team: str(cloudbetTeam),
        hunter_category: hunter,
        cloudbet_category: cloudbet
      };
    }
  }

  // Women must agree when explicitly present.
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

  // Reserve / II / B / Academy must agree when explicitly present.
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

  const homeConflict = compareTeamCategory(
    signal?.home,
    candidate?.home,
    "HOME"
  );

  const awayConflict = compareTeamCategory(
    signal?.away,
    candidate?.away,
    "AWAY"
  );

  if (homeConflict) conflicts.push(homeConflict);
  if (awayConflict) conflicts.push(awayConflict);

  return {
    ok: conflicts.length === 0,
    conflicts
  };
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
    "Examples of legitimate naming differences can include Levski Sofia vs Levski 1914, PSG vs Paris Saint-Germain, or Como U19 vs a provider club label that omits U19 when the competition context clearly establishes a youth fixture.",
    "Do NOT invent an event_id.",
    "Do NOT select a candidate just because one team matches.",
    "Do NOT treat different youth ages, women vs men, reserve/II/B/Academy vs senior, or clearly different clubs as the same fixture.",
    "Competition, minute, period and score are supporting context only. Missing metadata is not by itself a reason to reject an otherwise clear identity match.",
    "Never discuss betting or whether a wager should be placed.",
    "Return JSON only. No markdown and no text outside the JSON.",
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
    chat_template_kwargs: {
      enable_thinking: false
    }
  });

  const text = aiText(raw);
  const parsed = parseAiJson(text);

  return {
    processing_ms: Date.now() - started,
    text,
    parsed,
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
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function matchWithAi(env: Env, signal: AnyObj, rawEvents: AnyObj[]): Promise<AnyObj> {
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
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: 0,
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
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: candidates.length,
        batches: batches.length,
        ai_calls: batches.length,
        finalists: 0,
        batch_results: batchResults
      }
    };
  }

  // If only one batch produced a candidate, that candidate is still sent
  // through one final confirmation call. This keeps one uniform decision path.
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
      diagnostics: {
        raw_events: rawEvents.length,
        usable_candidates: candidates.length,
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

  // V1.3.2 HARD CATEGORY GUARD
  // AI confidence can NEVER override an explicit category conflict.
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
    reason: accepted
      ? finalChecked.reason
      : "AI_MATCH_BELOW_ACCEPT_CONFIDENCE",
    ai_reason: finalChecked.reason,
    cloudbet_match: `${candidate.home} v ${candidate.away}`,
    candidate,
    category_guard: categoryGuard,
    diagnostics: {
      raw_events: rawEvents.length,
      usable_candidates: candidates.length,
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
// TRACKER + D1 HISTORY
// ============================================================

const HISTORY_LIMIT = 30;
const TRACKER_TIMEOUT_MS = 8000;
const MAX_SIGNALS_PER_SCAN = 5;

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "no-store, max-age=0"
    }
  });
}

function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

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

  if (matchId) {
    return `match:${matchId}:${entryMinute ?? "x"}:${entryTime || "x"}`;
  }

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

    if (!response.ok) {
      throw new Error(`TRACKER_HTTP_${response.status}`);
    }

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

  await env.DB.prepare(`
    INSERT OR IGNORE INTO ai_match_history (
      signal_key,
      signal_id,
      match_id,
      hunter_match,
      hunter_home,
      hunter_away,
      competition,
      hunter_minute,
      hunter_score,
      ai_matched,
      ai_accepted,
      cloudbet_event_id,
      cloudbet_match,
      confidence,
      reason,
      cloudbet_period,
      cloudbet_minute,
      raw_events,
      usable_candidates,
      ai_calls,
      processing_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    diagnostics?.usable_candidates ?? null,
    diagnostics?.ai_calls ?? null,
    processingMs
  ).run();

  await env.DB.prepare(`
    DELETE FROM ai_match_history
    WHERE id NOT IN (
      SELECT id FROM ai_match_history
      ORDER BY id DESC
      LIMIT ?
    )
  `).bind(HISTORY_LIMIT).run();
}

async function getHistory(env: Env, limit = HISTORY_LIMIT): Promise<AnyObj[]> {
  const safeLimit = Math.max(1, Math.min(HISTORY_LIMIT, Math.floor(limit)));
  const result = await env.DB.prepare(`
    SELECT *
    FROM ai_match_history
    ORDER BY id DESC
    LIMIT ?
  `).bind(safeLimit).all();

  return Array.isArray(result?.results) ? result.results as AnyObj[] : [];
}

async function processOneSignal(env: Env, rawSignal: AnyObj, forcedKey?: string): Promise<AnyObj> {
  const signal = normalizeSignal(rawSignal);
  if (!signalValid(signal)) {
    return {
      processed: false,
      reason: "INVALID_SIGNAL",
      signal
    };
  }

  const started = Date.now();
  const rawEvents = await getRawCloudbetLive();
  const result = await matchWithAi(env, signal, rawEvents);
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

  // Oldest first is safer when several ENTRY signals arrive between cron runs.
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

function confidenceLabel(value: any): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n * 100)}%`;
}

function dashboardPage(rows: AnyObj[]): string {
  const tableRows = rows.map(row => {
    const accepted = Number(row.ai_accepted) === 1;
    const matched = Number(row.ai_matched) === 1;

    const status = accepted
      ? "✅ MATCH"
      : matched
        ? "⚠️ LOW CONF"
        : "❌ NO MATCH";

    const hunter = `${escapeHtml(row.hunter_home)} <span class="sep">vs</span> ${escapeHtml(row.hunter_away)}`;
    const cloudbet = row.cloudbet_match
      ? escapeHtml(row.cloudbet_match)
      : '<span class="muted">—</span>';

    const meta = [
      row.competition ? escapeHtml(row.competition) : null,
      row.hunter_minute !== null && row.hunter_minute !== undefined
        ? `${escapeHtml(row.hunter_minute)}'`
        : null,
      row.hunter_score !== null && row.hunter_score !== undefined
        ? `Hunter ${escapeHtml(row.hunter_score)}`
        : null
    ].filter(Boolean).join(" · ");

    const cbMeta = [
      row.cloudbet_period ? escapeHtml(row.cloudbet_period) : null,
      row.cloudbet_minute !== null && row.cloudbet_minute !== undefined
        ? `${escapeHtml(row.cloudbet_minute)}'`
        : null
    ].filter(Boolean).join(" · ");

    return `
      <tr>
        <td class="time">${escapeHtml(row.created_at)}</td>
        <td>
          <div class="fixture">${hunter}</div>
          <div class="meta">${meta || "—"}</div>
        </td>
        <td>
          <div class="fixture">${cloudbet}</div>
          <div class="meta">${cbMeta || "—"}</div>
        </td>
        <td class="center"><strong>${confidenceLabel(row.confidence)}</strong></td>
        <td class="mono">${row.cloudbet_event_id ? escapeHtml(row.cloudbet_event_id) : "—"}</td>
        <td class="status ${accepted ? "ok" : matched ? "warn" : "bad"}">${status}</td>
        <td class="reason">
          <details class="reason-details">
            <summary>🤖 Покажи причина</summary>
            <div class="reason-text">${escapeHtml(row.reason ?? "—")}</div>
          </details>
        </td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="bg">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>AI Matcher Watch</title>
  <style>
    *{box-sizing:border-box}
    body{margin:0;background:#0b1020;color:#eef2ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}
    .wrap{max-width:1600px;margin:0 auto;padding:18px}
    .top{display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:14px}
    h1{font-size:22px;margin:0}
    .badge{background:#18213a;border:1px solid #2d395b;border-radius:999px;padding:7px 11px;font-size:13px;color:#cbd5e1}
    .cards{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px}
    .card{background:#11182b;border:1px solid #25304d;border-radius:12px;padding:10px 13px;font-size:13px;color:#cbd5e1}
    .tablebox{overflow:auto;border:1px solid #25304d;border-radius:14px;background:#0f1628}
    table{width:100%;border-collapse:collapse;min-width:1100px}
    th{position:sticky;top:0;background:#18213a;color:#cbd5e1;text-align:left;font-size:12px;padding:11px;border-bottom:1px solid #2d395b}
    td{padding:11px;border-bottom:1px solid #1f2942;vertical-align:top;font-size:13px}
    tr:last-child td{border-bottom:0}
    .fixture{font-weight:700;font-size:14px;white-space:nowrap}
    .sep{font-weight:500;color:#64748b;padding:0 3px}
    .meta,.muted{margin-top:4px;color:#94a3b8;font-size:12px}
    .time{white-space:nowrap;color:#94a3b8}
    .center{text-align:center;white-space:nowrap}
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap}
    .status{font-weight:800;white-space:nowrap}
    .ok{color:#4ade80}.warn{color:#facc15}.bad{color:#fb7185}
    .reason{max-width:360px;color:#cbd5e1}
    .reason-details{max-width:360px}
    .reason-details summary{cursor:pointer;color:#93c5fd;font-weight:700;white-space:nowrap;user-select:none}
    .reason-details summary:hover{color:#bfdbfe}
    .reason-text{margin-top:8px;line-height:1.45;color:#cbd5e1;white-space:normal}
    .empty{padding:28px;text-align:center;color:#94a3b8}
    a{color:#93c5fd;text-decoration:none}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <h1>🤖 AI Matcher Watch</h1>
      <div class="badge">${escapeHtml(VERSION)} · READ ONLY · Betting disabled</div>
    </div>
    <div class="cards">
      <div class="card">Последни записи: <strong>${rows.length}/${HISTORY_LIMIT}</strong></div>
      <div class="card">Auto refresh: <strong>30 sec</strong></div>
      <div class="card"><a href="/scan">▶ Manual scan</a></div>
      <div class="card"><a href="/api/history">JSON history</a></div>
    </div>
    <div class="tablebox">
      ${rows.length ? `
      <table>
        <thead>
          <tr>
            <th>Време UTC</th>
            <th>Hunter сигнал</th>
            <th>AI намерен Cloudbet мач</th>
            <th>Confidence</th>
            <th>Event ID</th>
            <th>Резултат</th>
            <th>AI reason</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>` : '<div class="empty">Още няма записани AI проверки. Cron или /scan ще добави първите.</div>'}
    </div>
  </div>
</body>
</html>`;
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

    // --------------------------------------------------------
    // HTML DASHBOARD — LAST 30
    // --------------------------------------------------------
    if (url.pathname === "/" && request.method === "GET") {
      try {
        await ensureSchema(env);
        const rows = await getHistory(env);
        return html(dashboardPage(rows));
      } catch (error: any) {
        return html(`<!doctype html><html><body style="font-family:system-ui;padding:20px"><h2>AI Matcher</h2><p>Dashboard storage error: ${escapeHtml(String(error?.message ?? error))}</p><p>Check DB binding in ai-matcher.json.</p></body></html>`, 500);
      }
    }

    // --------------------------------------------------------
    // JSON STATUS
    // --------------------------------------------------------
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
        history_limit: HISTORY_LIMIT,
        max_signals_per_scan: MAX_SIGNALS_PER_SCAN,
        architecture: "TRACKER -> RAW CLOUDBET LIVE -> BATCHED AI IDENTITY MATCH -> D1 LAST 30 -> DASHBOARD",
        endpoints: {
          dashboard: "GET /",
          status: "GET /status",
          scan: "GET /scan",
          history: "GET /api/history",
          live_test: "GET /live-test",
          match_get: "GET /match-get?home=...&away=...&competition=...&minute=...",
          match: "POST /match"
        }
      });
    }

    // --------------------------------------------------------
    // MANUAL TRACKER SCAN
    // --------------------------------------------------------
    if (url.pathname === "/scan" && request.method === "GET") {
      try {
        return json({
          worker: "ai-matcher",
          version: VERSION,
          ...(await scanTracker(env))
        });
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

    // --------------------------------------------------------
    // HISTORY JSON
    // --------------------------------------------------------
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
        return json({
          success: false,
          error: "HISTORY_FAILED",
          message: String(error?.message ?? error)
        }, 500);
      }
    }

    // --------------------------------------------------------
    // RAW LIVE DIAGNOSTIC — NO AI
    // --------------------------------------------------------
    if (url.pathname === "/live-test" && request.method === "GET") {
      try {
        const events = await getRawCloudbetLive();
        const candidates = events
          .map((event, index) => compactCandidate(event, index))
          .filter(candidate => Boolean(candidate.event_id && candidate.home && candidate.away));

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "RAW_CLOUDBET_LIVE_TEST",
          betting: "DISABLED",
          raw_events: events.length,
          usable_candidates: candidates.length,
          sample: candidates.slice(0, 20)
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

    // --------------------------------------------------------
    // DYNAMIC GET MATCH — ALSO STORED IN HISTORY
    // --------------------------------------------------------
    if (url.pathname === "/match-get" && request.method === "GET") {
      if (!env.AI) {
        return json({ success: false, error: "AI_BINDING_MISSING" }, 500);
      }

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
        const forcedKey = `manual:${crypto.randomUUID()}`;
        const processed = await processOneSignal(env, signal, forcedKey);

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
        return json({
          success: false,
          error: "AI_MATCH_FAILED",
          message: String(error?.message ?? error)
        }, 500);
      }
    }

    // --------------------------------------------------------
    // POST MATCH — ALSO STORED IN HISTORY
    // --------------------------------------------------------
    if (url.pathname === "/match" && request.method === "POST") {
      if (!env.AI) {
        return json({ success: false, error: "AI_BINDING_MISSING" }, 500);
      }

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
        return json({
          success: false,
          error: "AI_MATCH_FAILED",
          message: String(error?.message ?? error)
        }, 500);
      }
    }

    return json({
      success: false,
      error: "NOT_FOUND",
      endpoints: ["GET /", "GET /status", "GET /scan", "GET /api/history", "GET /live-test", "GET /match-get", "POST /match"]
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
