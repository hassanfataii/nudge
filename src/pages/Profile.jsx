import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import "../styles/global.css";

export default function Profile({ onBack, onExit }) {
  const [participant, setParticipant] = useState(null);
  const [loading, setLoading] = useState(true);

  const [publicCode, setPublicCode] = useState("");
  const [joinedDate, setJoinedDate] = useState("");
  const [activeGoal, setActiveGoal] = useState("");

  const [activeGoalId, setActiveGoalId] = useState(null);

  const [maxNudges, setMaxNudges] = useState(3);
  const [quietStart, setQuietStart] = useState("09:00");
  const [quietEnd, setQuietEnd] = useState("20:00");

  const [savedSettings, setSavedSettings] = useState({
    maxNudges: 3,
    quietStart: "09:00",
    quietEnd: "20:00",
  });

  const [stats, setStats] = useState({
    currentStreak: 0,
    longestStreak: 0,
    logsThisWeek: 0,
  });

  const [statusMessage, setStatusMessage] = useState({ type: "", text: "" });

  const joinedFormatter = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
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
    hydrateProfile();
  }, [participant?.id]);

  const hydrateProfile = async () => {
    try {
      setLoading(true);
      setStatusMessage({ type: "", text: "" });

      const userId = participant.id;

      const { data: u, error: uErr } = await supabase
        .from("users")
        .select("id, public_code, created_at")
        .eq("id", userId)
        .single();

      if (uErr) throw uErr;

      setPublicCode(String(u.public_code ?? participant.public_code ?? ""));
      setJoinedDate(u.created_at ? joinedFormatter.format(new Date(u.created_at)) : "");

      const { data: g, error: gErr } = await supabase
        .from("goals")
        .select("id, title")
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("created_at", { ascending: false })
        .maybeSingle();

      if (gErr) throw gErr;

      setActiveGoal(g?.title ?? "");
      setActiveGoalId(g?.id ?? null);

      const { data: pref, error: prefErr } = await supabase
        .from("user_preferences")
        .select("max_notifications_per_day, quiet_hours_start, quiet_hours_end")
        .eq("user_id", userId)
        .maybeSingle();

      if (prefErr) throw prefErr;

      if (!pref) {
        const { error: insPrefErr } = await supabase
          .from("user_preferences")
          .insert({ user_id: userId });

        if (insPrefErr) throw insPrefErr;

        const { data: pref2, error: pref2Err } = await supabase
          .from("user_preferences")
          .select("max_notifications_per_day, quiet_hours_start, quiet_hours_end")
          .eq("user_id", userId)
          .single();

        if (pref2Err) throw pref2Err;

        applyPrefsToState(pref2);
      } else {
        applyPrefsToState(pref);
      }

      if (g?.id) {
        const { data: s, error: sErr } = await supabase
          .from("streaks")
          .select("current_streak_days, longest_streak_days")
          .eq("user_id", userId)
          .eq("goal_id", g.id)
          .maybeSingle();

        if (sErr) throw sErr;

        setStats((prev) => ({
          ...prev,
          currentStreak: Number(s?.current_streak_days ?? 0),
          longestStreak: Number(s?.longest_streak_days ?? 0),
        }));
      } else {
        setStats((prev) => ({ ...prev, currentStreak: 0, longestStreak: 0 }));
      }

      const { count, error: cErr } = await supabase
        .from("logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId);

      if (cErr) throw cErr;

      setStats((prev) => ({ ...prev, logsThisWeek: Number(count ?? 0) }));
    } catch (e) {
      setStatusMessage({
        type: "error",
        text: `Failed to load profile: ${e?.message || "Unknown error"}`,
      });
    } finally {
      setLoading(false);
    }
  };

  const applyPrefsToState = (pref) => {
    const max = Number(pref?.max_notifications_per_day ?? 3);

    const qsRaw = pref?.quiet_hours_start ?? "09:00:00";
    const qeRaw = pref?.quiet_hours_end ?? "20:00:00";

    const qs = String(qsRaw).slice(0, 5);
    const qe = String(qeRaw).slice(0, 5);

    setMaxNudges(max);
    setQuietStart(qs);
    setQuietEnd(qe);

    setSavedSettings({
      maxNudges: max,
      quietStart: qs,
      quietEnd: qe,
    });
  };

  const handleBackToDashboard = () => {
    if (typeof onBack === "function") onBack();
  };

  const handleExit = () => {
    localStorage.removeItem("participant");
    if (typeof onExit === "function") onExit();
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(publicCode);
      setStatusMessage({ type: "success", text: "Code copied to clipboard!" });
      setTimeout(() => setStatusMessage({ type: "", text: "" }), 2500);
    } catch {
      setStatusMessage({ type: "error", text: "Could not copy code." });
      setTimeout(() => setStatusMessage({ type: "", text: "" }), 2500);
    }
  };

  const handleSaveChanges = async () => {
    if (!participant?.id) return;

    try {
      setStatusMessage({ type: "", text: "" });

      const userId = participant.id;

      const payload = {
        user_id: userId,
        max_notifications_per_day: Number(maxNudges),
        quiet_hours_start: `${quietStart}:00`,
        quiet_hours_end: `${quietEnd}:00`,
      };

      const up = await supabase
        .from("user_preferences")
        .upsert(payload, { onConflict: "user_id" });

      if (up.error) {
        const upd = await supabase
          .from("user_preferences")
          .update({
            max_notifications_per_day: payload.max_notifications_per_day,
            quiet_hours_start: payload.quiet_hours_start,
            quiet_hours_end: payload.quiet_hours_end,
          })
          .eq("user_id", userId);

        if (upd.error) throw upd.error;
      }

      setSavedSettings({
        maxNudges: payload.max_notifications_per_day,
        quietStart,
        quietEnd,
      });

      setStatusMessage({ type: "success", text: "Settings saved successfully!" });
      setTimeout(() => setStatusMessage({ type: "", text: "" }), 2500);
    } catch (e) {
      setStatusMessage({
        type: "error",
        text: `Failed to save settings: ${e?.message || "Unknown error"}`,
      });
      setTimeout(() => setStatusMessage({ type: "", text: "" }), 2500);
    }
  };

  const handleResetChanges = () => {
    setMaxNudges(savedSettings.maxNudges);
    setQuietStart(savedSettings.quietStart);
    setQuietEnd(savedSettings.quietEnd);
    setStatusMessage({ type: "", text: "" });
  };

  if (!participant) {
    return (
      <div className="profile-page">
        <header className="profile-topbar">
          <span className="profile-logo">Nudge</span>
        </header>
        <main className="profile-main">
          <div className="profile-container">
            <section className="profile-card">
              <h3 className="profile-card-title">Session</h3>
              <div className="profile-status profile-status-error">
                No participant found. Go back and join/resume.
              </div>
              <button className="profile-btn profile-btn-primary" onClick={handleBackToDashboard}>
                Back
              </button>
            </section>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <header className="profile-topbar">
        <span className="profile-logo">Nudge</span>
        <div className="profile-topbar-actions">
          <button className="profile-btn profile-btn-secondary" onClick={handleBackToDashboard}>
            Back
          </button>
          <button className="profile-btn profile-btn-secondary" onClick={handleExit}>
            Exit
          </button>
        </div>
      </header>

      <main className="profile-main">
        <div className="profile-container">
          <section className="profile-card">
            <h3 className="profile-card-title">Identity</h3>
            <div className="profile-row">
              <span className="profile-label">Public code</span>
              <div className="profile-row-value">
                <span className="profile-code">{publicCode || participant.public_code || ""}</span>
                <button className="profile-btn profile-btn-small" onClick={handleCopyCode} disabled={!publicCode}>
                  Copy
                </button>
              </div>
            </div>
            <div className="profile-row">
              <span className="profile-label">Joined</span>
              <span className="profile-value">{joinedDate || "-"}</span>
            </div>
            <div className="profile-row">
              <span className="profile-label">Active goal</span>
              <span className="profile-value">{activeGoal || "None"}</span>
            </div>
          </section>

          <section className="profile-card">
            <h3 className="profile-card-title">Notifications</h3>

            <div className="profile-field">
              <label className="profile-label" htmlFor="maxNudges">
                Max nudges per day
              </label>
              <select
                id="maxNudges"
                className="profile-select"
                value={maxNudges}
                onChange={(e) => setMaxNudges(Number(e.target.value))}
                disabled={loading}
              >
                {[0, 1, 2, 3, 4, 5].map((num) => (
                  <option key={num} value={num}>
                    {num}
                  </option>
                ))}
              </select>
            </div>

            <div className="profile-field">
              <span className="profile-label">Quiet hours</span>
              <div className="profile-time-inputs">
                <div className="profile-time-group">
                  <label className="profile-time-label" htmlFor="quietStart">
                    Start
                  </label>
                  <input
                    type="time"
                    id="quietStart"
                    className="profile-input"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    disabled={loading}
                  />
                </div>
                <div className="profile-time-group">
                  <label className="profile-time-label" htmlFor="quietEnd">
                    End
                  </label>
                  <input
                    type="time"
                    id="quietEnd"
                    className="profile-input"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>
              <p className="profile-helper">No nudges will be sent during quiet hours.</p>
            </div>

            <div className="profile-actions">
              <button className="profile-btn profile-btn-primary" onClick={handleSaveChanges} disabled={loading}>
                Save changes
              </button>
              <button className="profile-btn profile-btn-secondary" onClick={handleResetChanges} disabled={loading}>
                Reset changes
              </button>
            </div>

            {statusMessage.text && (
              <div className={`profile-status profile-status-${statusMessage.type}`}>{statusMessage.text}</div>
            )}
            {loading && <div className="profile-status">Loading...</div>}
          </section>

          <section className="profile-card">
            <h3 className="profile-card-title">Stats</h3>
            <div className="profile-stats">
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.currentStreak}</span>
                <span className="profile-stat-label">Current streak (days)</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.longestStreak}</span>
                <span className="profile-stat-label">Longest streak (days)</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{stats.logsThisWeek}</span>
                <span className="profile-stat-label">Log count</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
