import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Matrix = number[][];
type Vector = number[];

function env(name: string) {
  return Deno.env.get(name) ?? "";
}

function supabaseConfig() {
  const url = env("SUPABASE_URL") || env("PROJECT_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SERVICE_ROLE_KEY");
  return { url, key };
}

function send(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function outer(x: Vector): Matrix {
  const d = x.length;
  const out: Matrix = Array.from({ length: d }, () => Array(d).fill(0));
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) out[i][j] = x[i] * x[j];
  return out;
}

function addMat(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const m = A[0].length;
  const out: Matrix = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[i][j] = A[i][j] + B[i][j];
  return out;
}

function addVec(a: Vector, b: Vector): Vector {
  const d = a.length;
  const out: Vector = Array(d).fill(0);
  for (let i = 0; i < d; i++) out[i] = a[i] + b[i];
  return out;
}

function scaleVec(x: Vector, s: number): Vector {
  return x.map((v) => v * s);
}

function asMatrix10(A: unknown): Matrix {
  if (!Array.isArray(A)) throw new Error("A is not an array");
  if (A.length !== 10) throw new Error(`A must have 10 rows, got ${A.length}`);

  const rows = A as unknown[];
  const mat: Matrix = rows.map((row) => {
    if (!Array.isArray(row)) throw new Error("A row is not an array");
    if (row.length !== 10) throw new Error(`A row must have 10 cols, got ${row.length}`);
    return row.map((v) => Number(v));
  });

  for (const row of mat) for (const v of row) if (!Number.isFinite(v)) throw new Error("A contains non-finite number");
  return mat;
}

function asVector10(b: unknown): Vector {
  if (!Array.isArray(b)) throw new Error("b is not an array");
  if (b.length !== 10) throw new Error(`b must have length 10, got ${b.length}`);
  const vec = b.map((v) => Number(v));
  for (const v of vec) if (!Number.isFinite(v)) throw new Error("b contains non-finite number");
  return vec;
}

function readVector(context: any): Vector | null {
  const candidate =
    context?.context_vector ??
    context?.x ??
    context?.vector ??
    context?.context?.context_vector ??
    context?.context?.x ??
    context?.context?.vector;

  if (!Array.isArray(candidate)) return null;

  const x = candidate.map((v: any) => Number(v));
  if (x.length !== 10) return null;
  if (x.some((v: number) => !Number.isFinite(v))) return null;
  return x;
}

function symmetrize(A: Matrix): Matrix {
  const n = A.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (A[i][j] + A[j][i]);
      A[i][j] = v;
      A[j][i] = v;
    }
  }
  return A;
}

function addDiagonal(A: Matrix, lambda = 1e-6): Matrix {
  for (let i = 0; i < A.length; i++) A[i][i] += lambda;
  return A;
}

serve(async (req) => {
  try {
    const secret = env("CRON_SECRET");
    const got = req.headers.get("x-cron-secret") ?? "";
    if (!secret) return send(500, { ok: false, error: "CRON_SECRET missing in env" });
    if (got !== secret) return send(401, { ok: false, error: "Invalid x-cron-secret" });

    const payload = await req.json().catch(() => ({}));
    const asOfRaw = payload?.as_of;
    const limitRaw = payload?.limit;

    const now = asOfRaw ? new Date(asOfRaw) : new Date();
    if (Number.isNaN(now.getTime())) return send(400, { ok: false, error: "Invalid as_of date" });

    const maxRows = typeof limitRaw === "number" ? Math.max(1, Math.min(1000, limitRaw)) : 200;

    const { url, key } = supabaseConfig();
    if (!url || !key) {
      return send(500, {
        ok: false,
        error: "Missing Supabase creds. Need SUPABASE_URL+SUPABASE_SERVICE_ROLE_KEY (or PROJECT_URL+SERVICE_ROLE_KEY).",
      });
    }

    const db = createClient(url, key, { auth: { persistSession: false } });

    const { data: rows, error: fetchErr } = await db
      .from("bandit_context_log")
      .select("id, strategy_id, decision_at, context_json, reward, used_in_update")
      .not("reward", "is", null)
      .eq("used_in_update", false)
      .lte("decision_at", now.toISOString())
      .order("decision_at", { ascending: true })
      .limit(maxRows);

    if (fetchErr) {
      return send(500, { ok: false, error: "Failed fetching bandit_context_log", details: fetchErr });
    }

    if (!rows || rows.length === 0) {
      return send(200, {
        ok: true,
        message: "No rewarded decisions pending update.",
        meta: { as_of: now.toISOString(), limit: maxRows, pending: 0 },
      });
    }

    const byStrategy = new Map<number, typeof rows>();
    for (const row of rows) {
      const sid = Number(row.strategy_id);
      if (!Number.isFinite(sid)) continue;
      if (!byStrategy.has(sid)) byStrategy.set(sid, []);
      byStrategy.get(sid)!.push(row);
    }

    const updated: number[] = [];
    const usedIds: string[] = [];
    const skipped: { id: string; reason: string }[] = [];

    for (const [strategyId, group] of byStrategy.entries()) {
      const { data: params, error: paramsErr } = await db
        .from("bandit_params")
        .select("strategy_id, a, b")
        .eq("strategy_id", strategyId)
        .maybeSingle();

      if (paramsErr) {
        skipped.push({ id: `strategy:${strategyId}`, reason: paramsErr.message });
        continue;
      }
      if (!params) {
        skipped.push({ id: `strategy:${strategyId}`, reason: "Missing bandit_params row" });
        continue;
      }

      let A: Matrix;
      let b: Vector;

      try {
        A = asMatrix10(params.a);
        b = asVector10(params.b);
      } catch (e: any) {
        skipped.push({ id: `strategy:${strategyId}`, reason: String(e?.message ?? e) });
        continue;
      }

      let changed = false;

      for (const row of group) {
        const x = readVector(row.context_json);
        if (!x) {
          skipped.push({ id: row.id, reason: "Invalid context vector" });
          continue;
        }

        const reward = Number(row.reward);
        if (!(reward === 0 || reward === 1)) {
          skipped.push({ id: row.id, reason: `Invalid reward ${row.reward}` });
          continue;
        }

        A = addMat(A, outer(x));
        b = addVec(b, scaleVec(x, reward));

        usedIds.push(row.id);
        changed = true;
      }

      if (!changed) continue;

      A = symmetrize(A);
      A = addDiagonal(A);

      const { error: saveErr } = await db
        .from("bandit_params")
        .update({ a: A, b: b, last_updated: new Date().toISOString() })
        .eq("strategy_id", strategyId);

      if (saveErr) {
        skipped.push({ id: `strategy:${strategyId}`, reason: saveErr.message });
        continue;
      }

      updated.push(strategyId);
    }

    if (usedIds.length > 0) {
      const { error: markErr } = await db
        .from("bandit_context_log")
        .update({ used_in_update: true })
        .in("id", usedIds);

      if (markErr) {
        return send(500, {
          ok: false,
          error: "Failed marking used_in_update",
          details: markErr,
          processed: usedIds.length,
          updated_strategies: updated,
        });
      }
    }

    return send(200, {
      ok: true,
      message: "Bandit params updated.",
      meta: {
        as_of: now.toISOString(),
        pulled_rows: rows.length,
        processed_rows: usedIds.length,
        updated_strategies: updated,
        skipped_count: skipped.length,
        skipped_preview: skipped.slice(0, 10),
      },
    });
  } catch (e: any) {
    return send(500, {
      ok: false,
      error: "Unhandled exception",
      details: String(e?.message ?? e),
      stack: e?.stack ?? null,
    });
  }
});
