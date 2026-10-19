import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import "../styles/global.css";

function Login({ onNext }) {
  const [participant, setParticipant] = useState(null);
  const [resumeCode, setResumeCode] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasParticipated = !!participant;
  const participantCode = participant?.public_code || "";

  useEffect(() => {
    const saved = localStorage.getItem("participant");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setParticipant(parsed);
      } catch {
        localStorage.removeItem("participant");
      }
    }
  }, []);

  const goNext = () => {
    if (typeof onNext === "function") onNext();
  };

  const handleParticipate = async () => {
    try {
      setBusy(true);
      setStatus("Creating your participant profile...");
      setCopied(false);

      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/London";

      const { data, error } = await supabase.functions.invoke("create-user", {
        body: { timezone },
      });

      if (error) throw error;

      const user = data?.user;
      if (!user?.public_code) throw new Error("Invalid user payload");

      setParticipant(user);
      localStorage.setItem("participant", JSON.stringify(user));
      setStatus("Participant created. Save your code.");
    } catch (e) {
      setStatus(`Participate failed: ${e?.message || "Unknown error"}`);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setStatus("Code copied to clipboard.");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setStatus("Could not copy code. Please copy manually.");
    }
  };

  const handleResume = async () => {
    const code = resumeCode.trim().toUpperCase();

    if (!code || code.length < 6) {
      setStatus("Enter a valid 6-character participant code.");
      return;
    }

    try {
      setBusy(true);
      setStatus("Looking up your participant code...");
      setCopied(false);

      const { data, error } = await supabase
        .from("users")
        .select("id, public_code, timezone, created_at")
        .eq("public_code", code)
        .single();

      if (error) throw error;

      setParticipant(data);
      localStorage.setItem("participant", JSON.stringify(data));
      setStatus("Participant restored.");
      goNext();
    } catch {
      setStatus("Code not found (or access blocked). Double-check the code.");
    } finally {
      setBusy(false);
    }
  };

  const handleContinue = () => {
    goNext();
  };

  const handleReset = () => {
    localStorage.removeItem("participant");
    setParticipant(null);
    setResumeCode("");
    setStatus("");
    setCopied(false);
    setBusy(false);
  };

  return (
    <div className="login-container">
      <main className="login-content">
        <header className="login-header">
          <h1 className="login-title">Nudge</h1>
          <p className="login-description">
            A research prototype exploring how adaptive prompts can support habits and goals.
            Participation is anonymous. You'll receive a unique participant code. Save it to resume
            later if your browser data is lost.
          </p>
        </header>

        {hasParticipated ? (
          <section className="code-section">
            <div className="code-card">
              <div className="code-left">
                <p className="code-label">Your participant code</p>
                <div className="code-display">{participantCode}</div>
                <p className="code-note">Save this code to resume later.</p>
              </div>

              <div className="code-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => handleCopyCode(participantCode)}
                  disabled={busy}
                >
                  {copied ? "Copied!" : "Copy code"}
                </button>

                <button
                  className="btn btn-primary"
                  onClick={handleContinue}
                  disabled={busy}
                >
                  Continue
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={handleReset}
                  disabled={busy}
                >
                  Reset participant
                </button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="participate-section">
              <button className="btn btn-primary" onClick={handleParticipate} disabled={busy}>
                {busy ? "Working..." : "Participate"}
              </button>
              <p className="helper-text">
                Click to join the study and receive your participant code.
              </p>
            </section>

            <section className="resume-section">
              <h2 className="resume-heading">Resume participation</h2>
              <div className="resume-form">
                <input
                  className="resume-input"
                  type="text"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck="false"
                  placeholder="Enter participant code"
                  value={resumeCode}
                  onChange={(e) => setResumeCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  disabled={busy}
                />
                <button className="btn btn-secondary" onClick={handleResume} disabled={busy}>
                  Resume
                </button>
              </div>
            </section>
          </>
        )}

        {status && <p className="helper-text">{status}</p>}
      </main>
    </div>
  );
}

export default Login;
