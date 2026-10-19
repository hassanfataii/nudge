import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Notification = {
  id: string;
  user_id: string;
  goal_id: string;
  strategy_id: number;
  sent_at: string;
  response_window_hours: number | null;
  responded: boolean | null;
  bandit_log_id: string | null;
};

type Decision = {
  id: string;
  user_id: string;
  goal_id: string;
  strategy_id: number;
  decision_at: string;
  context_json: any;
  reward: number | null;
  used_in_update: boolean;
};

function parseAsOf(req: Request): Promise<Date> {
  return (async () => {
    if (req.method !== "POST") return new Date();
    try {
      const body = await req.json();
      const raw = typeof body?.as_of === "string" ? body.as_of : null;
      const d = raw ? new Date(raw) : new Date();
      return Number.isFinite(d.getTime()) ? d : new Date();
    } catch {
      return new Date();
    }
  })();
}

function toIso(d: Date) {
  return d.toISOString();
}

Deno.serve(async (req: Request) => {
  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (cronSecret) {
      const got = req.headers.get("x-cron-secret");
      if (got !== cronSecret) return reply({ error: "Unauthorized" }, 401);
    }

    const projectUrl = Deno.env.get("PROJECT_URL");
    const serviceKey = Deno.env.get("SERVICE_ROLE_KEY");
    if (!projectUrl || !serviceKey) {
      return reply({ error: "Missing secrets", needed: ["PROJECT_URL", "SERVICE_ROLE_KEY"] }, 500);
    }

    const supabase = createClient(projectUrl, serviceKey, { auth: { persistSession: false } });

    const now = await parseAsOf(req);
    const nowIso = toIso(now);

    const LOOKBACK_DAYS = 14;
    const DEFAULT_WINDOW_HRS = 1;
    const MAX_BATCH = 200;

    const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const lookbackIso = toIso(lookbackStart);

    const notifRes = await supabase
      .from("notifications")
      .select("id, user_id, goal_id, strategy_id, sent_at, response_window_hours, responded, bandit_log_id")
      .not("sent_at", "is", null)
      .gte("sent_at", lookbackIso)
      .or("responded.is.null,responded.eq.false")
      .limit(MAX_BATCH);

    if (notifRes.error) {
      return reply({ error: "Failed to fetch notifications", details: notifRes.error.message }, 500);
    }

    const notifications: Notification[] = (notifRes.data ?? []) as any;

    let checked = 0;
    let rewarded = 0;
    let notRewarded = 0;
    let notifRowsUpdated = 0;
    let banditRowsUpdated = 0;
    let missingBanditLink = 0;

    for (const n of notifications) {
      if (Number(n.strategy_id) === 1) continue;

      const sentAt = new Date(n.sent_at);
      const windowHrs = typeof n.response_window_hours === "number" ? n.response_window_hours : DEFAULT_WINDOW_HRS;
      const windowEnd = new Date(sentAt.getTime() + windowHrs * 60 * 60 * 1000);

      if (now.getTime() < windowEnd.getTime()) continue;

      const logsRes = await supabase
        .from("logs")
        .select("id")
        .eq("user_id", n.user_id)
        .eq("goal_id", n.goal_id)
        .gte("logged_at", toIso(sentAt))
        .lt("logged_at", toIso(windowEnd))
        .limit(1);

      if (logsRes.error) {
        return reply({ error: "Failed to check logs", details: logsRes.error.message }, 500);
      }

      const didLog = (logsRes.data ?? []).length > 0;
      const reward = didLog ? 1 : 0;

      const updNotif = await supabase
        .from("notifications")
        .update({ responded: didLog })
        .eq("id", n.id);

      if (updNotif.error) {
        return reply({ error: "Failed to update notification", details: updNotif.error.message }, 500);
      }

      notifRowsUpdated++;
      checked++;
      if (didLog) rewarded++;
      else notRewarded++;

      if (!n.bandit_log_id) {
        missingBanditLink++;
        continue;
      }

      const updBandit = await supabase
        .from("bandit_context_log")
        .update({ reward })
        .eq("id", n.bandit_log_id)
        .is("reward", null);

      if (updBandit.error) {
        return reply({ error: "Failed to update bandit reward", details: updBandit.error.message }, 500);
      }

      banditRowsUpdated++;
    }

    const noMsgRes = await supabase
      .from("bandit_context_log")
      .select("id, user_id, goal_id, strategy_id, decision_at, context_json, reward, used_in_update")
      .eq("strategy_id", 1)
      .is("reward", null)
      .eq("used_in_update", false)
      .gte("decision_at", lookbackIso)
      .order("decision_at", { ascending: true })
      .limit(MAX_BATCH);

    if (noMsgRes.error) {
      return reply({ error: "Failed to fetch no-message decisions", details: noMsgRes.error.message }, 500);
    }

    const noMsgDecisions: Decision[] = (noMsgRes.data ?? []) as any;

    let noMsgSeen = noMsgDecisions.length;
    let noMsgChecked = 0;
    let noMsgRewarded = 0;
    let noMsgNotRewarded = 0;
    let noMsgRowsUpdated = 0;

    for (const d of noMsgDecisions) {
      const decisionAt = new Date(d.decision_at);

      const windowHrs =
        typeof d?.context_json?.response_window_hours === "number"
          ? Number(d.context_json.response_window_hours)
          : DEFAULT_WINDOW_HRS;

      const windowEnd = new Date(decisionAt.getTime() + windowHrs * 60 * 60 * 1000);

      if (now.getTime() < windowEnd.getTime()) continue;

      const logsRes = await supabase
        .from("logs")
        .select("id")
        .eq("user_id", d.user_id)
        .eq("goal_id", d.goal_id)
        .gte("logged_at", toIso(decisionAt))
        .lt("logged_at", toIso(windowEnd))
        .limit(1);

      if (logsRes.error) {
        return reply({ error: "Failed to check logs for no-message", details: logsRes.error.message }, 500);
      }

      const didLog = (logsRes.data ?? []).length > 0;
      const reward = didLog ? 1 : 0;

      const updBandit = await supabase
        .from("bandit_context_log")
        .update({ reward })
        .eq("id", d.id);

      if (updBandit.error) {
        return reply({ error: "Failed to update no-message reward", details: updBandit.error.message }, 500);
      }

      noMsgChecked++;
      if (didLog) noMsgRewarded++;
      else noMsgNotRewarded++;
      noMsgRowsUpdated++;
    }

    return reply({
      ok: true,
      message: "Rewards assigned.",
      meta: {
        now: nowIso,
        lookback_days: LOOKBACK_DAYS,
        notifications_seen: notifications.length,
        notifications_checked: checked,
        notifications_rewarded: rewarded,
        notifications_not_rewarded: notRewarded,
        notifications_updated: notifRowsUpdated,
        bandit_rows_updated: banditRowsUpdated,
        missing_bandit_link: missingBanditLink,
        no_message_seen: noMsgSeen,
        no_message_checked: noMsgChecked,
        no_message_rewarded: noMsgRewarded,
        no_message_not_rewarded: noMsgNotRewarded,
        no_message_rows_updated: noMsgRowsUpdated,
      },
    });
  } catch (e) {
    return reply({ error: "Unhandled crash in assign-rewards", details: String(e) }, 500);
  }
});
