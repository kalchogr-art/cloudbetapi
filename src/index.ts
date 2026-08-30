const API =
  "https://sports-api.cloudbet.com/pub/v2/odds";

const KEY =
  "CLOUDBET_API_KEY";

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store"
      }
    }
  );
}

async function cb(path, env) {

  const r = await fetch(
    `${API}${path}`,
    {
      headers: {
        "accept": "application/json",
        "X-API-Key": env[KEY]
      }
    }
  );

  const text = await r.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    throw new Error(
      `Cloudbet HTTP ${r.status}`
    );
  }

  return data;
}

function team(v) {

  if (typeof v === "string")
    return v;

  if (v && typeof v === "object")
    return v.name || v.key || null;

  return null;
}

function eventPreview(e, competition) {

  return {
    id: e?.id ?? null,

    key: e?.key ?? null,

    name:
      e?.name ??
      e?.match ??
      null,

    home:
      team(e?.home),

    away:
      team(e?.away),

    status:
      e?.status ?? null,

    start:
      e?.start ??
      e?.startTime ??
      e?.start_time ??
      null,

    live:
      e?.live ?? null,

    minute:
      e?.minute ??
      e?.matchMinute ??
      e?.match_minute ??
      e?.elapsed ??
      e?.clock ??
      null,

    score:
      e?.score ??
      e?.scores ??
      e?.result ??
      null,

    competition: {
      key:
        competition?.key ?? null,

      name:
        competition?.name ?? null
    },

    raw_event:
      e
  };
}

export default {

  async fetch(request, env) {

    try {

      const soccer =
        await cb(
          "/sports/soccer",
          env
        );

      const categories =
        Array.isArray(
          soccer?.categories
        )
          ? soccer.categories
          : [];

      const competitions = [];

      for (
        const category of categories
      ) {

        const list =
          Array.isArray(
            category?.competitions
          )
            ? category.competitions
            : [];

        for (
          const c of list
        ) {

          if (!c?.key)
            continue;

          if (
            Number(
              c.eventCount || 0
            ) <= 0
          )
            continue;

          competitions.push({
            key: c.key,
            name:
              c.name || c.key,
            eventCount:
              Number(
                c.eventCount || 0
              )
          });

          if (
            competitions.length >= 10
          )
            break;
        }

        if (
          competitions.length >= 10
        )
          break;
      }

      const results = [];

      let totalEvents = 0;

      for (
        const competition
        of competitions
      ) {

        const data =
          await cb(
            `/competitions/${encodeURIComponent(
              competition.key
            )}`,
            env
          );

        const events =
          Array.isArray(
            data?.events
          )
            ? data.events
            : [];

        totalEvents +=
          events.length;

        for (
          const event
          of events
        ) {

          if (
            results.length >= 20
          )
            break;

          results.push(
            eventPreview(
              event,
              competition
            )
          );
        }

        if (
          results.length >= 20
        )
          break;
      }

      return json({

        success: true,

        test:
          "CLOUDBET RAW EVENT STRUCTURE",

        filter:
          "NONE",

        competitions_checked:
          competitions.length,

        total_events:
          totalEvents,

        events_returned:
          results.length,

        events:
          results,

        timestamp:
          new Date().toISOString()

      });

    } catch (error) {

      return json({

        success: false,

        error:
          error?.message ||
          String(error),

        timestamp:
          new Date().toISOString()

      }, 500);
    }
  }
};
