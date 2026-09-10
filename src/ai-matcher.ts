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
}

const VERSION = "AI-MATCHER-V1.2-GET-DYNAMIC-MATCH";
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
    "Do NOT treat different youth ages, women vs men, reserve vs senior, or clearly different clubs as the same fixture.",
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
    // STATUS
    // --------------------------------------------------------
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        success: true,
        worker: "ai-matcher",
        version: VERSION,
        mode: "READ_ONLY",
        betting: "DISABLED",
        ai_binding: Boolean(env.AI),
        model: MODEL,
        architecture: "HUNTER -> RAW CLOUDBET LIVE -> BATCHED AI IDENTITY MATCH -> VERIFIED EVENT_ID",
        safety: {
          no_betting_code: true,
          no_name_filter_before_ai: true,
          no_minute_filter_before_ai: true,
          no_period_filter_before_ai: true,
          no_score_filter_before_ai: true,
          returned_event_id_must_exist_in_candidate_set: true,
          accepted_confidence: AI_ACCEPT_CONFIDENCE
        },
        endpoints: {
          status: "GET /",
          live_test: "GET /live-test",
          como_test: "GET /test-como",
          match_get: "GET /match-get?home=...&away=...&competition=...&minute=...",
          match: "POST /match"
        }
      });
    }

    // --------------------------------------------------------
    // RAW LIVE DIAGNOSTIC
    // No AI call.
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
    // ONE-CLICK COMO TEST
    // GET /test-como
    // Identity test only. Current Cloudbet period/minute do not
    // determine whether the fixture identity is the same.
    // --------------------------------------------------------
    if (url.pathname === "/test-como" && request.method === "GET") {
      if (!env.AI) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "AI_BINDING_MISSING"
        }, 500);
      }

      const signal = {
        home: "Como U19",
        away: "RB Leipzig U19",
        competition: "UEFA Youth League",
        minute: 40
      };

      const started = Date.now();

      try {
        const rawEvents = await getRawCloudbetLive();
        const result = await matchWithAi(env, signal, rawEvents);

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "GET_COMO_AI_MATCH_TEST",
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          result,
          processing_ms: Date.now() - started
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          action: "GET_COMO_AI_MATCH_TEST",
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          error: "AI_MATCH_FAILED",
          message: String(error?.message ?? error),
          processing_ms: Date.now() - started
        }, 500);
      }
    }

    // --------------------------------------------------------
    // DYNAMIC ONE-CLICK AI MATCH TEST
    // GET /match-get?home=Levski%20Sofia&away=CSKA%20Sofia
    // Optional: competition, minute, period, hunter_score
    // READ ONLY / NO BETTING
    // --------------------------------------------------------
    if (url.pathname === "/match-get" && request.method === "GET") {
      if (!env.AI) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "AI_BINDING_MISSING"
        }, 500);
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
          worker: "ai-matcher",
          version: VERSION,
          error: "INVALID_SIGNAL",
          required_query_params: ["home", "away"],
          optional_query_params: ["competition", "minute", "period", "hunter_score"],
          example: "/match-get?home=Levski%20Sofia&away=CSKA%20Sofia&competition=Parva%20Liga&minute=31",
          received_signal: signal
        }, 400);
      }

      const started = Date.now();

      try {
        const rawEvents = await getRawCloudbetLive();
        const result = await matchWithAi(env, signal, rawEvents);

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          action: "GET_DYNAMIC_AI_MATCH_TEST",
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          result,
          processing_ms: Date.now() - started
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          action: "GET_DYNAMIC_AI_MATCH_TEST",
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          error: "AI_MATCH_FAILED",
          message: String(error?.message ?? error),
          processing_ms: Date.now() - started
        }, 500);
      }
    }

    // --------------------------------------------------------
    // REAL AI MATCH TEST
    // POST JSON:
    // {
    //   "signal": {
    //     "home": "Levski Sofia",
    //     "away": "CSKA Sofia",
    //     "competition": "Parva Liga",
    //     "minute": 31
    //   }
    // }
    // --------------------------------------------------------
    if (url.pathname === "/match" && request.method === "POST") {
      if (!env.AI) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          error: "AI_BINDING_MISSING"
        }, 500);
      }

      let body: AnyObj;

      try {
        body = (await request.json()) as AnyObj;
      } catch {
        return json({
          success: false,
          error: "INVALID_JSON_BODY"
        }, 400);
      }

      const signal = normalizeSignal(body);

      if (!signalValid(signal)) {
        return json({
          success: false,
          error: "INVALID_SIGNAL",
          required: ["home", "away"],
          received_signal: signal
        }, 400);
      }

      const started = Date.now();

      try {
        const rawEvents = await getRawCloudbetLive();
        const result = await matchWithAi(env, signal, rawEvents);

        return json({
          success: true,
          worker: "ai-matcher",
          version: VERSION,
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          result,
          processing_ms: Date.now() - started
        });
      } catch (error: any) {
        return json({
          success: false,
          worker: "ai-matcher",
          version: VERSION,
          mode: "READ_ONLY",
          betting: "DISABLED",
          signal,
          error: "AI_MATCH_FAILED",
          message: String(error?.message ?? error),
          processing_ms: Date.now() - started
        }, 500);
      }
    }

    return json({
      success: false,
      error: "NOT_FOUND",
      endpoints: ["GET /", "GET /live-test", "GET /test-como", "GET /match-get?home=...&away=...", "POST /match"]
    }, 404);
  }
};
