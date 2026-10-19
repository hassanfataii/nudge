import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LogRequest = {
  public_code?: string;
  goal_id?: string;
  source?: string;
  logged_at?: string | null;
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  try {
    if (req.method !== "POST") return send({ ok: false, error: "Use POST" }, 405);

    const projectUrl = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey =
      Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!projectUrl || !serviceKey) {
      return send(
        {
          ok: false,
          error: "Missing PROJECT_URL/SERVICE_ROLE_KEY (or SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).",
        },
        500,
      );
    }

    const supabase = createClient(projectUrl, serviceKey, {
      auth: { persistSession: false },
    });

    let payload: LogRequest = {};
    try {
      payload = await req.json();
    } catch {
      return send({ ok: false, error: "Invalid JSON body" }, 400);
    }

    const publicCode = String(payload.public_code ?? "").trim().toUpperCase();
    const goalId = String(payload.goal_id ?? "").trim();
    const source = String(payload.source ?? "").trim();
    const loggedAt = payload.logged_at ? new Date(payload.logged_at) : new Date();

    if (!publicCode) return send({ ok: false, error: "public_code is required" }, 400);
    if (!goalId) return send({ ok: false, error: "goal_id is required" }, 400);
    if (!source) return send({ ok: false, error: "source is required" }, 400);
    if (!Number.isFinite(loggedAt.getTime())) {
      return send({ ok: false, error: "logged_at must be a valid ISO date string" }, 400);
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("public_code", publicCode)
      .maybeSingle();

    if (userError) return send({ ok: false, error: "User lookup failed", details: userError }, 500);
    if (!user) return send({ ok: false, error: "User not found" }, 404);

    const { data: goal, error: goalError } = await supabase
      .from("goals")
      .select("id,user_id,is_active")
      .eq("id", goalId)
      .maybeSingle();

    if (goalError) return send({ ok: false, error: "Goal lookup failed", details: goalError }, 500);
    if (!goal) return send({ ok: false, error: "Goal not found" }, 404);
    if (goal.user_id !== user.id) {
      return send({ ok: false, error: "Goal does not belong to this user" }, 403);
    }
    if (goal.is_active !== true) {
      return send({ ok: false, error: "Goal is not active" }, 400);
    }

    const { data: logEntry, error: logError } = await supabase
      .from("logs")
      .insert({
        user_id: user.id,
        goal_id: goalId,
        logged_at: loggedAt.toISOString(),
        source,
      })
      .select("id,user_id,goal_id,logged_at,source,created_at")
      .single();

    if (logError) return send({ ok: false, error: "Failed inserting log", details: logError }, 500);

    return send({ ok: true, log: logEntry }, 200);
  } catch (err) {
    return send(
      { ok: false, error: "Unhandled error", details: String((err as any)?.message ?? err) },
      500,
    );
  }
});
