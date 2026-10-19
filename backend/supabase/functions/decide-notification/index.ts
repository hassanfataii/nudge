
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Vector = number[];
type Matrix = number[][];

type Goal = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string | null;
};

type Preferences = {
  max_notifications_per_day: number | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
};

type Model = {
  inverse: Matrix;
  theta: Vector;
};

const DIMENSIONS = 10;
const DEFAULT_ALPHA = 0.8;
const COOLDOWN_MINUTES = 120;
const EXPIRY_HOURS = 2;

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function clamp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalise(value: number, maximum: number) {
  return clamp(value / maximum);
}

function dot(a: Vector, b: Vector) {
  return a.reduce((total, value, i) => total + value * b[i], 0);
}

function matrixVector(matrix: Matrix, vector: Vector): Vector {
  return matrix.map((row) => dot(row, vector));
}

function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i === j ? 1 : 0)
  );
}

function inverse(matrix: Matrix): Matrix {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const result = identity(n);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;

    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) {
        pivotRow = row;
      }
    }

    if (Math.abs(a[pivotRow][col]) < 1e-12) {
      throw new Error("LinUCB matrix is singular");
    }

    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
    [result[col], result[pivotRow]] =
      [result[pivotRow], result[col]];

    const pivot = a[col][col];

    for (let j = 0; j < n; j++) {
      a[col][j] /= pivot;
      result[col][j] /= pivot;
    }

    for (let row = 0; row < n; row++) {
      if (row === col) continue;

      const factor = a[row][col];

      for (let j = 0; j < n; j++) {
        a[row][j] -= factor * a[col][j];
        result[row][j] -= factor * result[col][j];
      }
    }
  }

  return result;
}

function validateModel(a: unknown, b: unknown) {
  if (
    !Array.isArray(a) ||
    a.length !== DIMENSIONS ||
    !a.every(
      (row) =>
        Array.isArray(row) &&
        row.length === DIMENSIONS &&
        row.every((n) => typeof n === "number" && Number.isFinite(n)),
    ) ||
    !Array.isArray(b) ||
    b.length !== DIMENSIONS ||
    !b.every((n) => typeof n === "number" && Number.isFinite(n))
  ) {
    throw new Error("Invalid LinUCB parameter dimensions");
  }

  const inverted = inverse(a as Matrix);

  return {
    inverse: inverted,
    theta: matrixVector(inverted, b as Vector),
  };
}

function getLocalDate(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const days: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3,
    Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minutes:
      Number(value("hour")) * 60 + Number(value("minute")),
    dow: days[value("weekday")] ?? 0,
  };
}

function minutesOfDay(time: string) {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function isQuiet(minutes: number, start: string, end: string) {
  const from = minutesOfDay(start);
  const until = minutesOfDay(end);

  if (from === until) return false;
  if (from < until) return minutes >= from && minutes < until;

  return minutes >= from || minutes < until;
}

function getScore(model: Model, context: Vector, alpha: number) {
  const expectedReward = dot(model.theta, context);
  const uncertainty = Math.sqrt(
    Math.max(0, dot(context, matrixVector(model.inverse, context)))
  );

  return expectedReward + alpha * uncertainty;
}

serve(async (request) => {
  if (request.method !== "POST") {
    return reply({ ok: false, error: "Method not allowed" }, 405);
  }

  const secret = Deno.env.get("CRON_SECRET") ?? "";
  const supplied = request.headers.get("x-cron-secret") ?? "";

  if (!secret) {
    return reply({ ok: false, error: "CRON_SECRET missing" }, 500);
  }

  if (!supplied || supplied !== secret) {
    return reply({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const url =
      Deno.env.get("PROJECT_URL") ??
      Deno.env.get("SUPABASE_URL") ?? "";

    const key =
      Deno.env.get("SERVICE_ROLE_KEY") ??
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!url || !key) {
      return reply({ ok: false, error: "Missing database credentials" }, 500);
    }

    const db = createClient(url, key, {
      auth: { persistSession: false },
    });

    const now = new Date();
    const nowIso = now.toISOString();

    const { data: goals, error: goalsError } = await db
      .from("goals")
      .select("id,user_id,title,created_at")
      .eq("is_active", true)
      .not("user_id", "is", null);

    if (goalsError) throw goalsError;

    if (!goals?.length) {
      return reply({
        ok: true,
        message: "No active goals",
        decisions: 0,
        notifications: 0,
      });
    }

    const userIds = [...new Set(goals.map((g) => String(g.user_id)))];

    const [usersRes, prefsRes, tokensRes, paramsRes] =
      await Promise.all([
        db.from("users")
          .select("id,timezone")
          .in("id", userIds),

        db.from("user_preferences")
          .select(
            "user_id,max_notifications_per_day,quiet_hours_start,quiet_hours_end"
          )
          .in("user_id", userIds),

        db.from("push_tokens")
          .select("user_id,platform,subscription")
          .in("user_id", userIds),

        db.from("bandit_params")
          .select("strategy_id,a,b"),
      ]);

    for (const response of [
      usersRes, prefsRes, tokensRes, paramsRes,
    ]) {
      if (response.error) throw response.error;
    }

    const timezones = new Map<string, string>();
    const preferences = new Map<string, Preferences>();
    const eligibleUsers = new Set<string>();
    const models = new Map<number, Model>();

    for (const user of usersRes.data ?? []) {
      timezones.set(String(user.id), String(user.timezone ?? "UTC"));
    }

    for (const pref of prefsRes.data ?? []) {
      preferences.set(String(pref.user_id), pref as Preferences);
    }

    // A user must have a stored web-push subscription
    // before the model schedules an intervention.
    for (const token of tokensRes.data ?? []) {
      const subscription = token.subscription;

      if (
        token.platform === "web" &&
        subscription !== null &&
        subscription !== undefined
      ) {
        eligibleUsers.add(String(token.user_id));
      }
    }

    for (const row of paramsRes.data ?? []) {
      const strategyId = Number(row.strategy_id);
      if (strategyId >= 1 && strategyId <= 5) {
        models.set(strategyId, validateModel(row.a, row.b));
      }
    }

    if (![2, 3, 4, 5].every((id) => models.has(id))) {
      throw new Error("Missing LinUCB intervention parameters");
    }

    let decisions = 0;
    let notifications = 0;
    let skippedNoSubscription = 0;
    let blocked = 0;
    let errors = 0;

    for (const goal of goals as Goal[]) {
      const userId = String(goal.user_id);
      const goalId = String(goal.id);

      // Never queue a notification for a user who has no
      // registered delivery destination.
      if (!eligibleUsers.has(userId)) {
        skippedNoSubscription++;
        continue;
      }

      try {
        let timezone = timezones.get(userId) ?? "UTC";
        let local;

        try {
          local = getLocalDate(now, timezone);
        } catch {
          timezone = "UTC";
          local = getLocalDate(now, timezone);
        }

        const pref = preferences.get(userId);

        const maxPerDay = Number(
          pref?.max_notifications_per_day ?? 3
        );

        const quiet = isQuiet(
          local.minutes,
          pref?.quiet_hours_start ?? "21:00",
          pref?.quiet_hours_end ?? "09:00",
        );

        const { data: pending, error: pendingError } = await db
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("goal_id", goalId)
          .eq("delivery_status", "PENDING")
          .gt("expires_at", nowIso)
          .limit(1);

        if (pendingError) throw pendingError;

        const hasPending = (pending ?? []).length > 0;

        const { data: recentLogs, error: logsError } = await db
          .from("logs")
          .select("logged_at")
          .eq("user_id", userId)
          .eq("goal_id", goalId)
          .order("logged_at", { ascending: false })
          .limit(1);

        if (logsError) throw logsError;

        const lastLog = recentLogs?.[0]?.logged_at
          ? new Date(recentLogs[0].logged_at)
          : null;

        const inactivityHours = lastLog
          ? Math.max(0, (now.getTime() - lastLog.getTime()) / 3600000)
          : 48;

        const { data: streak, error: streakError } = await db
          .from("streaks")
          .select("current_streak_days")
          .eq("user_id", userId)
          .eq("goal_id", goalId)
          .maybeSingle();

        if (streakError) throw streakError;

        const streakDays = Number(streak?.current_streak_days ?? 0);

        const dayStart = new Date(now);
        dayStart.setUTCHours(0, 0, 0, 0);

        const dayEnd = new Date(dayStart);
        dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

        const { count: logsToday, error: todayError } = await db
          .from("logs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("goal_id", goalId)
          .gte("logged_at", dayStart.toISOString())
          .lt("logged_at", dayEnd.toISOString());

        if (todayError) throw todayError;

        const goalAgeDays = goal.created_at
          ? Math.max(
              0,
              (now.getTime() - new Date(goal.created_at).getTime()) /
                86400000,
            )
          : 0;

        const lookbackStart = new Date(
          now.getTime() - 14 * 86400000
        ).toISOString();

        const { data: recentResponses, error: responseError } =
          await db
            .from("notifications")
            .select("responded,sent_at")
            .eq("user_id", userId)
            .eq("goal_id", goalId)
            .gte("sent_at", lookbackStart)
            .not("sent_at", "is", null)
            .order("sent_at", { ascending: false })
            .limit(10);

        if (responseError) throw responseError;

        const evaluated = (recentResponses ?? []).filter(
          (row) => typeof row.responded === "boolean"
        );

        const positive = evaluated.filter(
          (row) => row.responded === true
        ).length;

        const responseRate = evaluated.length
          ? positive / evaluated.length
          : 0;

        const context: Vector = [
          1,
          normalise(local.hour, 23),
          normalise(local.dow, 6),
          normalise(inactivityHours, 48),
          normalise(streakDays, 14),
          clamp(responseRate),
          normalise(goalAgeDays, 14),
          normalise(logsToday ?? 0, 2),
          local.dow === 0 || local.dow === 6 ? 1 : 0,
          quiet ? 1 : 0,
        ];

        const { count: sentToday, error: countError } = await db
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("sent_at", "is", null)
          .gte("sent_at", dayStart.toISOString())
          .lt("sent_at", dayEnd.toISOString());

        if (countError) throw countError;

        const { data: lastSent, error: cooldownError } = await db
          .from("notifications")
          .select("sent_at")
          .eq("user_id", userId)
          .eq("goal_id", goalId)
          .not("sent_at", "is", null)
          .order("sent_at", { ascending: false })
          .limit(1);

        if (cooldownError) throw cooldownError;

        const lastSentAt = lastSent?.[0]?.sent_at
          ? new Date(lastSent[0].sent_at)
          : null;

        const cooldownActive = lastSentAt
          ? (now.getTime() - lastSentAt.getTime()) / 60000 <
            COOLDOWN_MINUTES
          : false;

        const reasons = {
          in_quiet: quiet,
          max_per_day_hit: (sentToday ?? 0) >= maxPerDay,
          cooldown_hit: cooldownActive,
          has_pending: hasPending,
          already_logged_today: (logsToday ?? 0) > 0,
        };

        const isBlocked = Object.values(reasons).some(Boolean);

        let strategyId = 1;
        let bestScore = -Infinity;

        if (!isBlocked) {
          for (const id of [2, 3, 4, 5]) {
            const model = models.get(id)!;
            const score = getScore(model, context, DEFAULT_ALPHA);

            if (score > bestScore) {
              bestScore = score;
              strategyId = id;
            }
          }
        } else {
          blocked++;
        }

        const { data: decision, error: decisionError } = await db
          .from("bandit_context_log")
          .insert({
            user_id: userId,
            goal_id: goalId,
            strategy_id: strategyId,
            decision_at: nowIso,
            reward: null,
            used_in_update: false,
            context_json: {
              as_of: nowIso,
              response_window_hours: 1,
              goal_title: goal.title,
              user_timezone: timezone,
              local_date: local.date,
              local_minutes: local.minutes,
              context_vector: context,
              features: {
                inactivity_hours: inactivityHours,
                streak_days: streakDays,
                logs_today: logsToday ?? 0,
                goal_age_days: goalAgeDays,
                recent_response_rate: responseRate,
                blocked: isBlocked,
                blocked_reasons: reasons,
              },
              linucb: isBlocked
                ? null
                : { alpha: DEFAULT_ALPHA, chosen_score: bestScore },
            },
          })
          .select("id")
          .single();

        if (decisionError) throw decisionError;

        decisions++;

        if (strategyId === 1) continue;

        const { data: templates, error: templateError } = await db
          .from("notification_templates")
          .select("id,template_text")
          .eq("strategy_id", strategyId);

        if (templateError) throw templateError;

        if (!templates?.length) {
          // No intervention was deliverable; don't train on it.
          continue;
        }

        const template =
          templates[Math.floor(Math.random() * templates.length)];

        const expiresAt = new Date(
          now.getTime() + EXPIRY_HOURS * 3600000
        ).toISOString();

        const { error: notificationError } = await db
          .from("notifications")
          .insert({
            user_id: userId,
            goal_id: goalId,
            strategy_id: strategyId,
            template_id: template.id,
            notification_message: template.template_text,
            response_window_hours: 1,
            responded: null,
            sent_at: null,
            bandit_log_id: decision.id,
            delivery_status: "PENDING",
            delivery_attempts: 0,
            expires_at: expiresAt,
          });

        if (notificationError) throw notificationError;

        notifications++;
      } catch (error) {
        errors++;
        console.error(
          `Failed to evaluate goal ${goalId}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return reply({
      ok: errors === 0,
      as_of: nowIso,
      goals_checked: goals.length,
      decisions_written: decisions,
      notifications_written: notifications,
      skipped_no_subscription: skippedNoSubscription,
      blocked_no_message: blocked,
      errors,
    }, errors ? 500 : 200);
  } catch (error) {
    console.error(error);

    return reply({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});
