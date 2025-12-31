import { useEffect, useMemo, useState } from "react";

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

export default function IosInstallSheet({ storageKey = "ios_install_dismissed_v1" }) {
  const [open, setOpen] = useState(false);

  const eligible = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isIos() && isSafari();
  }, []);

  useEffect(() => {
    if (!eligible) return;
    if (isStandalone()) return;

    const dismissed = localStorage.getItem(storageKey);
    if (dismissed === "1") return;

    const t = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(t);
  }, [eligible, storageKey]);

  const dismiss = () => {
    localStorage.setItem(storageKey, "1");
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={dismiss}
      aria-hidden="true"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install Nudge on iPhone"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(520px, 100%)",
          background: "#0b1220",
          color: "#fff",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          padding: "16px 16px 18px",
          boxShadow: "0 -10px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", paddingBottom: 10 }}>
          <div style={{ width: 44, height: 5, borderRadius: 999, background: "rgba(255,255,255,0.18)" }} />
        </div>

        <h3 style={{ margin: "0 0 6px", fontSize: 18 }}>Install Nudge</h3>
        <p style={{ margin: "0 0 12px", opacity: 0.9, lineHeight: 1.35 }}>
          On iPhone: tap <b>Share</b> (the square with the arrow) then choose <b>Add to Home Screen</b>.
          <br />
          <span style={{ opacity: 0.85 }}>
            Install first to enable notifications on iPhone.
          </span>
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={dismiss}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Got it
          </button>

          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            style={{
              flex: 1,
              padding: "10px 12px",
              borderRadius: 12,
              border: "none",
              background: "#6c63ff",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Show me
          </button>
        </div>
      </div>
    </div>
  );
}
