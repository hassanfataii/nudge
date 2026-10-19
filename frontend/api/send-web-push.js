import webpush from "web-push";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Use POST" });
  }

  try {
    const { subscription, payload } = req.body || {};
    if (!subscription) {
      return res.status(400).json({ ok: false, error: "Missing subscription" });
    }

    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:test@example.com";

    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({ ok: false, error: "Missing VAPID env vars" });
    }

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const msg = payload || JSON.stringify({ title: "Nudge", body: "Hello from Vercel" });

    await webpush.sendNotification(subscription, msg);

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
