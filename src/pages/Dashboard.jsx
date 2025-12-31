import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import "../styles/global.css";
import IosInstallSheet from "../components/IosInstallSheet";
function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isSafari() {
  const ua = window.navigator.userAgent.toLowerCase();
  const isWebkit = ua.includes("safari");
  const isNotChrome = !ua.includes("crios");
  const isNotFirefox = !ua.includes("fxios");
  const isNotEdge = !ua.includes("edgios");
  return isWebkit && isNotChrome && isNotFirefox && isNotEdge;
}

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    window.navigator.standalone === true
  );
}


export default function Dashboard({ onExit, onProfile }) {
  const [participant, setParticipant] = useState(null);

  const [categories, setCategories] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  const [categoryGoals, setCategoryGoals] = useState([]);
  const [loadingCategoryGoals, setLoadingCategoryGoals] = useState(false);

  const [selectedGoalId, setSelectedGoalId] = useState("");

  const [goalInput, setGoalInput] = useState("");
  const [activeGoal, setActiveGoal] = useState(null);
  const [isEditingGoal, setIsEditingGoal] = useState(false);
  const [savingGoal, setSavingGoal] = useState(false);

  const [streak, setStreak] = useState(0);
  const [longestStreak, setLongestStreak] = useState(0);

  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showLogModal, setShowLogModal] = useState(false);
  const [logCompleted, setLogCompleted] = useState(false);
  const [logNote, setLogNote] = useState("");
  const [savingLog, setSavingLog] = useState(false);

  const [status, setStatus] = useState("");
  const [showSuccess, setShowSuccess] = useState(false);

  const today = useMemo(() => {
    return new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("participant");
    if (!saved) {
      setParticipant(null);
      setLoading(false);
      return;
    }
    try {
      setParticipant(JSON.parse(saved));
    } catch {
      localStorage.removeItem("participant");
      setParticipant(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!participant?.id) return;
    loadCategories();
  }, [participant?.id]);

  useEffect(() => {
    if (!participant?.id) return;
    hydrate();
  }, [participant?.id]);

  useEffect(() => {
    if (!participant?.id) return;

    setSelectedGoalId("");

    if (!selectedCategoryId) {
      setCategoryGoals([]);
      return;
    }
    fetchGoalsForCategory(selectedCategoryId);
  }, [selectedCategoryId, participant?.id]);

  const iosNeedsInstallForPush = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isIos() && isSafari() && !isStandalone();
  }, []);




  const loadCategories = async () => {
    try {
      const { data, error } = await supabase
        .from("categories")
        .select("id,name")
        .order("id", { ascending: true });

      if (error) throw error;
      setCategories(data ?? []);
    } catch (e) {
      setStatus(`Failed to load categories: ${e?.message || "Unknown error"}`);
    }
  };

  const hydrate = async () => {
    try {
      setLoading(true);
      setStatus("");

      const userId = participant.id;

      const { data: goal, error: goalErr } = await supabase
        .from("goals")
        .select("id,title,category_id,is_active,created_at,template_id")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .maybeSingle();

      if (goalErr) throw goalErr;

      setActiveGoal(goal ?? null);
      setIsEditingGoal(false);

      if (goal?.id) {
        const { data: s, error: sErr } = await supabase
          .from("streaks")
          .select("current_streak_days,longest_streak_days")
          .eq("user_id", userId)
          .eq("goal_id", goal.id)
          .maybeSingle();

        if (sErr) throw sErr;

        setStreak(Number(s?.current_streak_days ?? 0));
        setLongestStreak(Number(s?.longest_streak_days ?? 0));

        const { data: l, error: lErr } = await supabase
          .from("logs")
          .select("id,logged_at,source")
          .eq("user_id", userId)
          .eq("goal_id", goal.id)
          .order("logged_at", { ascending: false })
          .limit(3);

        if (lErr) throw lErr;

        setLogs(
          (l ?? []).map((row) => ({
            id: row.id,
            date: String(row.logged_at).split("T")[0],
            completed: true,
            note: "",
            source: row.source,
          })),
        );
      } else {
        setStreak(0);
        setLongestStreak(0);
        setLogs([]);
      }
    } catch (e) {
      setStatus(`Failed to load dashboard: ${e?.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchGoalsForCategory = async (catId) => {
    try {
      setLoadingCategoryGoals(true);
      setStatus("");

      const { data, error } = await supabase
        .from("goal_templates")
        .select("id,title,category_id,created_at")
        .eq("category_id", Number(catId))
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      setCategoryGoals(data ?? []);
    } catch (e) {
      setStatus(`Failed to load category goals: ${e?.message || "Unknown error"}`);
    } finally {
      setLoadingCategoryGoals(false);
    }
  };

  const activateGoalById = async (templateId) => {
    if (!participant?.id || !templateId) return;

    const picked = categoryGoals.find((g) => String(g.id) === String(templateId));
    if (!picked) return;

    try {
      setSavingGoal(true);
      setStatus("");

      const userId = participant.id;

      const { error: offErr } = await supabase
        .from("goals")
        .update({ is_active: false })
        .eq("user_id", userId);

      if (offErr) throw offErr;

      const { error: insErr } = await supabase.from("goals").insert({
        user_id: userId,
        title: picked.title,
        category_id: picked.category_id,
        template_id: picked.id,
        is_active: true,
      });

      if (insErr) throw insErr;

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);

      setSelectedCategoryId("");
      setSelectedGoalId("");
      setGoalInput("");

      await hydrate();
    } catch (e) {
      setStatus(`Failed to activate goal: ${e?.message || "Unknown error"}`);
    } finally {
      setSavingGoal(false);
    }
  };

  const saveNewGoal = async () => {
    const title = goalInput.trim();
    if (!title || !participant?.id) return;
    if (!selectedCategoryId) return;

    try {
      setSavingGoal(true);
      setStatus("");

      const userId = participant.id;
      const category_id = Number(selectedCategoryId);

      await supabase.from("goals").update({ is_active: false }).eq("user_id", userId);

      const { data: inserted, error } = await supabase
        .from("goals")
        .insert({ user_id: userId, title, category_id, template_id: null, is_active: true })
        .select("id,title,category_id,is_active,created_at,template_id")
        .single();

      if (error) throw error;

      setActiveGoal(inserted);
      setIsEditingGoal(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);

      setSelectedCategoryId("");
      setSelectedGoalId("");
      setGoalInput("");

      await hydrate();
    } catch (e) {
      setStatus(`Failed to save goal: ${e?.message || "Unknown error"}`);
    } finally {
      setSavingGoal(false);
    }
  };

  const startEditFromTop = () => {
    setActiveGoal(null);
    setIsEditingGoal(true);
    setSelectedCategoryId("");
    setSelectedGoalId("");
    setGoalInput("");
    setStreak(0);
    setLongestStreak(0);
    setLogs([]);
  };

  const cancelEdit = async () => {
    setIsEditingGoal(false);
    setSelectedCategoryId("");
    setSelectedGoalId("");
    setGoalInput("");
    await hydrate();
  };

  const saveLog = async () => {
    if (!participant?.public_code || !activeGoal?.id) return;

    try {
      setSavingLog(true);
      setStatus("");

      const source = logCompleted ? "manual_completed" : "manual_log";

      const { data, error } = await supabase.functions.invoke("log-goal", {
        body: {
          public_code: participant.public_code,
          goal_id: activeGoal.id,
          source,
          logged_at: new Date().toISOString(),
        },
      });

      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "log-goal failed");

      setShowLogModal(false);
      setLogCompleted(false);
      setLogNote("");
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);

      await hydrate();
    } catch (e) {
      setStatus(`Failed to save log: ${e?.message || "Unknown error"}`);
    } finally {
      setSavingLog(false);
    }
  };

  const resetParticipant = () => {
    localStorage.removeItem("participant");
    setParticipant(null);
    if (typeof onExit === "function") onExit();
  };

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  const requestNotificationPermission = async () => {
    try {
      if (!participant?.id) return;

      if (!("Notification" in window)) throw new Error("Notifications not supported in this browser");
      if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported in this browser");

      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;

      const reg = await navigator.serviceWorker.ready;

      const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("Missing VITE_VAPID_PUBLIC_KEY");

      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await existing.unsubscribe();
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });

      const { data, error } = await supabase.functions.invoke("register-push-token", {
        body: {
          user_id: participant.id,
          platform: "web",
          token: sub.endpoint,
          subscription: sub.toJSON ? sub.toJSON() : sub,
        },
      });

      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error || "register-push-token failed");

      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2500);
    } catch (e) {
      setStatus(`Enable notifications failed: ${e?.message || "Unknown error"}`);
    }
  };

  if (!participant) {
    return (
      <div className="dash-page">
        <header className="dash-topbar">
          <span className="dash-logo">Nudge</span>
        </header>
        <main className="dash-main">
          {iosNeedsInstallForPush && <IosInstallSheet />}
          <div className="dash-container">
            <section className="dash-card">
              <h3 className="dash-card-title">Session</h3>
              <p className="dash-date">No participant found. Go back and join/resume.</p>
              <button className="dash-btn dash-btn-primary dash-btn-full" onClick={() => onExit && onExit()}>
                Back to Login
              </button>
            </section>
          </div>
        </main>
      </div>
    );
  }

  const selectedCategoryName =
    categories.find((c) => String(c.id) === String(selectedCategoryId))?.name || "";
  const showGoalPicker = !activeGoal || isEditingGoal;

  return (
    <div className="dash-page">
      <header className="dash-topbar">
        <span className="dash-logo">Nudge</span>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="dash-profile-btn" aria-label="Profile" onClick={() => onProfile && onProfile()}>
            <span className="dash-avatar"></span>
          </button>
          <button className="dash-btn dash-btn-secondary" onClick={resetParticipant} style={{ padding: "0.5rem 0.75rem" }}>
            Exit
          </button>
        </div>
      </header>

      <main className="dash-main">
        <div className="dash-container">
          <button
            className="dash-btn dash-btn-secondary"
            onClick={() => {
              if (iosNeedsInstallForPush) {
                setStatus("On iPhone: install to Home Screen first (Share → Add to Home Screen), then enable notifications.");
                return;
              }
              requestNotificationPermission();
            }}
            disabled={iosNeedsInstallForPush}
            title={iosNeedsInstallForPush ? "Install to Home Screen first" : ""}
          >
            {iosNeedsInstallForPush ? "Install required on iOS" : "Enable notifications"}
          </button>

          {iosNeedsInstallForPush && (
            <div className="dash-success-msg" style={{ background: "#fff3cd", color: "#856404" }}>
              iPhone tip: open in Safari, tap Share → Add to Home Screen. Then reopen the installed app to enable notifications.
            </div>
          )}


          {showSuccess && <div className="dash-success-msg">Saved successfully.</div>}
          {status && (
            <div className="dash-success-msg" style={{ background: "#fff3cd", color: "#856404" }}>
              {status}
            </div>
          )}

          <section className="dash-card dash-today-card" style={{ position: "relative" }}>
            <p className="dash-date">{today}</p>
            <h2 className="dash-active-goal">{activeGoal?.title || "No goal set"}</h2>

            {!!activeGoal && !isEditingGoal && (
              <button
                className="dash-btn dash-btn-secondary"
                onClick={startEditFromTop}
                disabled={loading}
                style={{ position: "absolute", top: "14px", right: "14px", padding: "0.45rem 0.7rem" }}
              >
                Edit
              </button>
            )}

            <p className="dash-streak">🔥 Streak: {streak} days</p>
            <p className="dash-date" style={{ marginTop: "0.5rem" }}>
              Longest: {longestStreak} days
            </p>
          </section>

          {showGoalPicker && (
            <section className="dash-card dash-goal-card">
              <h3 className="dash-card-title">Set a Goal</h3>

              <div className="dash-goal-form" style={{ gap: "10px" }}>
                <select
                  className="dash-input"
                  value={selectedCategoryId}
                  onChange={(e) => setSelectedCategoryId(e.target.value)}
                  disabled={savingGoal || loading}
                >
                  <option value="">Select a category...</option>
                  {categories.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {selectedCategoryId && (
                  <div className="dash-goal-form" style={{ gap: "10px" }}>
                    <select
                      className="dash-input"
                      value={selectedGoalId}
                      onChange={(e) => setSelectedGoalId(e.target.value)}
                      disabled={savingGoal || loading || loadingCategoryGoals}
                    >
                      <option value="">
                        {loadingCategoryGoals ? "Loading goals..." : `Select a goal in ${selectedCategoryName}...`}
                      </option>
                      {categoryGoals.map((g) => (
                        <option key={g.id} value={String(g.id)}>
                          {g.title}
                        </option>
                      ))}
                    </select>

                    <button
                      className="dash-btn dash-btn-primary"
                      onClick={() => activateGoalById(selectedGoalId)}
                      disabled={!selectedGoalId || savingGoal || loading || loadingCategoryGoals}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Add
                    </button>
                  </div>
                )}

                {selectedCategoryId && (
                  <div className="dash-goal-form" style={{ gap: "10px", marginTop: "6px" }}>
                    <input
                      type="text"
                      className="dash-input"
                      placeholder="Add goal if not listed..."
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      disabled={savingGoal || loading}
                    />
                    <button
                      className="dash-btn dash-btn-primary"
                      onClick={saveNewGoal}
                      disabled={!goalInput.trim() || savingGoal || loading}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      Add
                    </button>
                  </div>
                )}

                {isEditingGoal && (
                  <button className="dash-btn dash-btn-secondary" onClick={cancelEdit} disabled={savingGoal || loading}>
                    Cancel
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="dash-card dash-log-card">
            <h3 className="dash-card-title">Daily Log</h3>
            <button
              className="dash-btn dash-btn-primary dash-btn-full"
              onClick={() => setShowLogModal(true)}
              disabled={!activeGoal || loading}
            >
              Add daily log
            </button>

            {showLogModal && (
              <div className="dash-modal-overlay">
                <div className="dash-modal">
                  <h4 className="dash-modal-title">Log Your Day</h4>
                  <label className="dash-checkbox-label">
                    <input
                      type="checkbox"
                      checked={logCompleted}
                      onChange={(e) => setLogCompleted(e.target.checked)}
                      disabled={savingLog}
                    />
                    I completed my goal today
                  </label>
                  <textarea
                    className="dash-textarea"
                    placeholder="Optional note (not saved yet)..."
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    rows={3}
                    disabled={savingLog}
                  />
                  <div className="dash-modal-actions">
                    <button className="dash-btn dash-btn-secondary" onClick={() => setShowLogModal(false)} disabled={savingLog}>
                      Cancel
                    </button>
                    <button className="dash-btn dash-btn-primary" onClick={saveLog} disabled={savingLog}>
                      {savingLog ? "Saving..." : "Save log"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="dash-card dash-activity-card">
            <h3 className="dash-card-title">Recent Activity</h3>
            {!activeGoal ? (
              <p className="dash-date">Set a goal to start logging.</p>
            ) : logs.length === 0 ? (
              <p className="dash-date">No logs yet.</p>
            ) : (
              <ul className="dash-activity-list">
                {logs.slice(0, 3).map((log) => (
                  <li key={log.id} className="dash-activity-item">
                    <span className="dash-activity-date">{log.date}</span>
                    <span className={`dash-activity-status ${log.completed ? "dash-status-done" : "dash-status-missed"}`}>
                      {log.completed ? "Logged" : "Missed"}
                    </span>
                    {log.note && <span className="dash-activity-note">{log.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
