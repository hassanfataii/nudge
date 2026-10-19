import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

function send(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return send({ ok: false, error: "Use POST" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!url || !key) {
      return send({ ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }

    const db = createClient(url, key, { auth: { persistSession: false } });

    const payload = await req.json().catch(() => null);
    if (!payload) return send({ ok: false, error: "Invalid JSON" }, 400);

    const rawUserId = payload.user_id ? String(payload.user_id).trim() : "";
    const publicCode = payload.public_code ? String(payload.public_code).trim().toUpperCase() : "";
    const token = payload.token ? String(payload.token).trim() : "";
    const platform = payload.platform ? String(payload.platform).trim() : "";
    const subscription = payload.subscription ?? null;

    if (!token || !platform) return send({ ok: false, error: "token and platform required" }, 400);

    let userId = rawUserId;

    if (!userId && publicCode) {
      const { data: user, error: userErr } = await db
        .from("users")
        .select("id")
        .eq("public_code", publicCode)
        .maybeSingle();

      if (userErr) return send({ ok: false, error: `User lookup failed: ${userErr.message}` }, 500);
      if (!user) return send({ ok: false, error: "User not found" }, 404);

      userId = String(user.id);
    }

    if (!userId) return send({ ok: false, error: "user_id or public_code required" }, 400);

    const now = new Date().toISOString();

    const tokenRow: Record<string, unknown> = {
      user_id: userId,
      token,
      platform,
      last_seen_at: now,
      updated_at: now,
    };

    if (platform === "web") {
      if (!subscription) return send({ ok: false, error: "subscription required for web platform" }, 400);
      tokenRow.subscription = subscription;
    }

    const { error: saveErr } = await db.from("push_tokens").upsert(tokenRow, { onConflict: "token" });

    if (saveErr) return send({ ok: false, error: `Failed to store push token: ${saveErr.message}` }, 500);

    return send({ ok: true });
  } catch (e: any) {
    return send({ ok: false, error: e?.message ?? String(e) }, 500);
  }
});
