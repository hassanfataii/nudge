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

    if (!url || !key) return send({ ok: false, error: "Missing env vars" }, 500);

    const db = createClient(url, key, { auth: { persistSession: false } });

    const payload = await req.json().catch(() => ({}));
    const notificationId = String(payload?.notification_id ?? "").trim();

    if (!notificationId) {
      return send({ ok: false, error: "notification_id required" }, 400);
    }

    const openedAt = new Date().toISOString();

    const { data, error } = await db
      .from("notifications")
      .update({ opened_at: openedAt })
      .eq("id", notificationId)
      .is("opened_at", null)
      .select("id, opened_at")
      .maybeSingle();

    if (error) return send({ ok: false, error: error.message }, 500);

    return send({
      ok: true,
      updated: !!data,
      row: data ?? null,
    });
  } catch (e: any) {
    return send({ ok: false, error: e?.message ?? String(e) }, 500);
  }
});
