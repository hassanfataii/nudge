import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function dateOnlyUtc(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartUtc(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

Deno.serve(async (req: Request) => {
  try {
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    if (!cronSecret) return send({ ok: false, error: "CRON_SECRET not set in env" }, 500);

    const gotSecret = req.headers.get("x-cron-secret") ?? "";
    if (gotSecret !== cronSecret) return send({ ok: false, error: "Unauthorized (bad cron secret)" }, 401);

    let asOfDay: string | null = null;

    if (req.method === "POST") {
      try {
        const payload = await req.json();
        if (typeof payload?.as_of === "string" && payload.as_of.length >= 10) {
          asOfDay = payload.as_of.slice(0, 10);
        }
      } catch {}
    }

    const url = Deno.env.get("PROJECT_URL") ?? "";
    const key = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    if (!url || !key) {
      return send(
        {
          error: "Missing secrets",
          needed: ["PROJECT_URL", "SERVICE_ROLE_KEY"],
        },
        500,
      );
    }

    const db = createClient(url, key, { auth: { persistSession: false } });

    const now = asOfDay ? new Date(`${asOfDay}T00:00:00.000Z`) : new Date();

    const todayStart = dayStartUtc(now);
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const dayBeforeStart = new Date(yesterdayStart.getTime() - 24 * 60 * 60 * 1000);

    const todayStr = dateOnlyUtc(todayStart);
    const yesterdayStr = dateOnlyUtc(yesterdayStart);
    const dayBeforeStr = dateOnlyUtc(dayBeforeStart);

    const goalsRes = await db.from("goals").select("id, user_id").eq("is_active", true);
    if (goalsRes.error) return send({ error: "Failed to fetch goals", details: goalsRes.error.message }, 500);

    const goals = goalsRes.data ?? [];
    if (goals.length === 0) {
      return send({ ok: true, message: "No active goals. Nothing to update.", meta: { todayStr, yesterdayStr } });
    }

    const logsRes = await db
      .from("logs")
      .select("user_id, goal_id, logged_at")
      .gte("logged_at", yesterdayStart.toISOString())
      .lt("logged_at", todayStart.toISOString());

    if (logsRes.error) return send({ error: "Failed to fetch logs", details: logsRes.error.message }, 500);

    const didLogYesterday = new Set<string>();
    for (const row of logsRes.data ?? []) didLogYesterday.add(`${row.user_id}::${row.goal_id}`);

    const streaksRes = await db
      .from("streaks")
      .select("user_id, goal_id, current_streak_days, longest_streak_days, last_completed_date");

    if (streaksRes.error) return send({ error: "Failed to fetch streaks", details: streaksRes.error.message }, 500);

    const streakByGoal = new Map<string, any>();
    for (const s of streaksRes.data ?? []) streakByGoal.set(`${s.user_id}::${s.goal_id}`, s);

    const updates: Array<{
      user_id: string;
      goal_id: string;
      current_streak_days: number;
      longest_streak_days: number;
      last_completed_date: string | null;
    }> = [];

    let continued = 0;
    let started = 0;
    let reset = 0;

    for (const g of goals) {
      const k = `${g.user_id}::${g.id}`;
      const prev = streakByGoal.get(k);
      const logged = didLogYesterday.has(k);

      if (logged) {
        const prevLast = prev?.last_completed_date ?? null;
        const prevCurrent = Number(prev?.current_streak_days ?? 0);
        const prevLongest = Number(prev?.longest_streak_days ?? 0);

        let current = 1;

        if (prevLast === dayBeforeStr && prevCurrent > 0) {
          current = prevCurrent + 1;
          continued++;
        } else {
          started++;
        }

        const longest = Math.max(prevLongest, current);

        updates.push({
          user_id: g.user_id,
          goal_id: g.id,
          current_streak_days: current,
          longest_streak_days: longest,
          last_completed_date: yesterdayStr,
        });
      } else {
        const prevCurrent = Number(prev?.current_streak_days ?? 0);
        if (prevCurrent > 0) {
          updates.push({
            user_id: g.user_id,
            goal_id: g.id,
            current_streak_days: 0,
            longest_streak_days: Number(prev?.longest_streak_days ?? 0),
            last_completed_date: prev?.last_completed_date ?? null,
          });
          reset++;
        }
      }
    }

    if (updates.length === 0) {
      return send({
        ok: true,
        message: "No streak changes to apply.",
        meta: { todayStr, yesterdayStr, goals_checked: goals.length, continued, started, reset },
      });
    }

    const saveRes = await db.from("streaks").upsert(updates, { onConflict: "user_id,goal_id" });
    if (saveRes.error) return send({ error: "Failed to upsert streak updates", details: saveRes.error.message }, 500);

    return send({
      ok: true,
      message: "Streaks updated.",
      meta: {
        todayStr,
        yesterdayStr,
        goals_checked: goals.length,
        streak_rows_written: updates.length,
        continued,
        started,
        reset,
      },
    });
  } catch (e) {
    return send({ error: "Unhandled crash in update-streaks", details: String(e) }, 500);
  }
});
