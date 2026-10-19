
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-cron-secret",
  "access-control-allow-methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 25;

type Notification = {
  id: string;
  user_id: string;
  notification_message: string | null;
  expires_at: string | null;
  delivery_attempts: number;
};

type PushToken = {
  user_id: string;
  platform: string | null;
  subscription: unknown;
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...cors,
    },
  });
}

function b64ToText(value: string) {
  const bytes = Uint8Array.from(
    atob(value),
    (character) => character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

function readVapidConfig(): unknown {
  const encoded = (Deno.env.get("VAPID_KEYS_B64") ?? "").trim();

  if (encoded) {
    return JSON.parse(b64ToText(encoded));
  }

  let raw = (Deno.env.get("VAPID_KEYS_JSON") ?? "").trim();

  if (!raw) {
    throw new Error("Missing VAPID configuration");
  }

  if (raw.startsWith("{\\") || raw.includes('\\"')) {
    raw = raw
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }

  return JSON.parse(raw);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: cors,
    });
  }

  if (req.method !== "POST") {
    return respond({ ok: false, error: "Use POST" }, 405);
  }

  // SECURITY: Only the authorised scheduler may invoke
  // this function.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const suppliedSecret = req.headers.get("x-cron-secret") ?? "";

  if (!cronSecret) {
    return respond({
      ok: false,
      error: "CRON_SECRET is not configured",
    }, 500);
  }

  if (!suppliedSecret || suppliedSecret !== cronSecret) {
    return respond({
      ok: false,
      error: "Unauthorized",
    }, 401);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const subject =
      Deno.env.get("VAPID_SUBJECT") ??
      "mailto:test@example.com";

    if (!url || !key) {
      return respond({
        ok: false,
        error: "Missing Supabase credentials",
      }, 500);
    }

    const vapidKeys = await webpush.importVapidKeys(
      readVapidConfig() as Parameters<
        typeof webpush.importVapidKeys
      >[0],
    );

    const pushServer = await webpush.ApplicationServer.new({
      contactInformation: subject,
      vapidKeys,
    });

    const db = createClient(url, key, {
      auth: { persistSession: false },
    });

    const nowIso = new Date().toISOString();

    // Expire notifications outside their delivery window.
    const { error: expiryError } = await db
      .from("notifications")
      .update({
        delivery_status: "EXPIRED",
        last_delivery_error: "Delivery window expired",
      })
      .eq("delivery_status", "PENDING")
      .lt("expires_at", nowIso);

    if (expiryError) {
      throw new Error(expiryError.message);
    }

    // Fail notifications that have exhausted retries.
    const { error: limitError } = await db
      .from("notifications")
      .update({
        delivery_status: "FAILED",
        last_delivery_error: "Maximum attempts exhausted",
      })
      .eq("delivery_status", "PENDING")
      .gte("delivery_attempts", MAX_ATTEMPTS);

    if (limitError) {
      throw new Error(limitError.message);
    }

    const { data: rows, error: queueError } = await db
      .from("notifications")
      .select(
        "id,user_id,notification_message,expires_at,delivery_attempts",
      )
      .eq("delivery_status", "PENDING")
      .gt("expires_at", nowIso)
      .lt("delivery_attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (queueError) {
      throw new Error(queueError.message);
    }

    const queue = (rows ?? []) as Notification[];

    if (queue.length === 0) {
      return respond({
        ok: true,
        message: "No eligible pending notifications",
        processed: 0,
        sent: 0,
      });
    }

    const userIds = [
      ...new Set(queue.map((row) => row.user_id)),
    ];

    const { data: tokens, error: tokensError } = await db
      .from("push_tokens")
      .select("user_id,platform,subscription")
      .in("user_id", userIds);

    if (tokensError) {
      throw new Error(tokensError.message);
    }

    const subscriptions = new Map<string, unknown[]>();

    for (const token of (tokens ?? []) as PushToken[]) {
      if (token.platform !== "web" || !token.subscription) {
        continue;
      }

      const existing = subscriptions.get(token.user_id) ?? [];
      existing.push(token.subscription);
      subscriptions.set(token.user_id, existing);
    }

    let sent = 0;
    let failed = 0;
    let retried = 0;

    const results: Array<Record<string, unknown>> = [];

    for (const notification of queue) {
      const attempts = notification.delivery_attempts + 1;
      const destinations =
        subscriptions.get(notification.user_id) ?? [];

      const { data: claimed, error: claimError } = await db
        .from("notifications")
        .update({
          delivery_attempts: attempts,
          last_attempt_at: new Date().toISOString(),
        })
        .eq("id", notification.id)
        .eq("delivery_status", "PENDING")
        .eq("delivery_attempts", notification.delivery_attempts)
        .select("id");

      if (claimError || !claimed?.length) {
        results.push({
          id: notification.id,
          outcome: "claim_skipped",
          error: claimError?.message ?? null,
        });
        continue;
      }

      if (destinations.length === 0) {
        const { error } = await db
          .from("notifications")
          .update({
            delivery_status: "FAILED",
            last_delivery_error: "No web push subscription",
          })
          .eq("id", notification.id)
          .eq("delivery_status", "PENDING");

        if (error) throw new Error(error.message);

        failed++;
        results.push({
          id: notification.id,
          outcome: "failed",
          reason: "No subscription",
        });
        continue;
      }

      const message = JSON.stringify({
        title: "Nudge",
        body: String(notification.notification_message ?? ""),
        data: {
          notification_id: notification.id,
        },
      });

      let accepted = false;
      const errors: string[] = [];

      for (const destination of destinations) {
        try {
          const client = pushServer.subscribe(
            destination as Parameters<
              typeof pushServer.subscribe
            >[0],
          );

          await client.pushTextMessage(message, {
            ttl: 3600,
            urgency: "normal",
          });

          accepted = true;
        } catch (error) {
          errors.push(
            error instanceof Error
              ? error.message
              : String(error),
          );
        }
      }

      if (accepted) {
        const { error } = await db
          .from("notifications")
          .update({
            delivery_status: "SENT",
            sent_at: new Date().toISOString(),
            last_delivery_error: null,
          })
          .eq("id", notification.id)
          .eq("delivery_status", "PENDING");

        if (error) throw new Error(error.message);

        sent++;
        results.push({
          id: notification.id,
          outcome: "sent",
        });
        continue;
      }

      const permanentlyFailed = attempts >= MAX_ATTEMPTS;

      const { error } = await db
        .from("notifications")
        .update({
          delivery_status: permanentlyFailed
            ? "FAILED"
            : "PENDING",
          last_delivery_error: errors.join("; ").slice(0, 1000),
        })
        .eq("id", notification.id)
        .eq("delivery_status", "PENDING");

      if (error) throw new Error(error.message);

      if (permanentlyFailed) {
        failed++;
      } else {
        retried++;
      }

      results.push({
        id: notification.id,
        outcome: permanentlyFailed
          ? "failed"
          : "retry_pending",
        attempts,
      });
    }

    return respond({
      ok: true,
      processed: queue.length,
      sent,
      failed,
      retried,
      results,
    });
  } catch (error) {
    return respond({
      ok: false,
      error: error instanceof Error
        ? error.message
        : String(error),
    }, 500);
  }
});
