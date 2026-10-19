import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function makeInviteCode(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function send(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...headers, "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = cors(origin);

  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return send({ error: "Use POST" }, 405, headers);

  const projectUrl = Deno.env.get("PROJECT_URL") ?? "";
  const serviceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

  if (!projectUrl || !serviceKey) {
    return send(
      { error: "Missing secrets", needed: ["PROJECT_URL", "SERVICE_ROLE_KEY"] },
      500,
      headers,
    );
  }

  const supabase = createClient(projectUrl, serviceKey, { auth: { persistSession: false } });

  const CODE_LEN = 6;
  const MAX_TRIES = 10;

  const DEFAULT_TZ = "Europe/London";
  const DEFAULT_MAX_PER_DAY = 3;
  const DEFAULT_QUIET_START = "21:00";
  const DEFAULT_QUIET_END = "09:00";

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const timezone =
    typeof body?.timezone === "string" && body.timezone.trim().length > 0
      ? body.timezone.trim()
      : DEFAULT_TZ;

  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const public_code = makeInviteCode(CODE_LEN);

    const { data: user, error: userErr } = await supabase
      .from("users")
      .insert({ public_code, timezone })
      .select("id, public_code, timezone, created_at")
      .single();

    if (userErr) {
      if ((userErr as any)?.code === "23505") continue;
      return send({ error: "Failed to create user", details: userErr.message ?? userErr }, 500, headers);
    }

    const { error: prefsErr } = await supabase.from("user_preferences").insert({
      user_id: user.id,
      max_notifications_per_day: DEFAULT_MAX_PER_DAY,
      quiet_hours_start: DEFAULT_QUIET_START,
      quiet_hours_end: DEFAULT_QUIET_END,
    });

    if (prefsErr) {
      return send(
        {
          user,
          warning: "User created, but preferences insert failed",
          details: prefsErr.message ?? prefsErr,
        },
        200,
        headers,
      );
    }

    return send({ user }, 200, headers);
  }

  return send({ error: "Failed to create user after retries" }, 500, headers);
});
