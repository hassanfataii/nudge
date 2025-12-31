import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";

function App() {
  const [page, setPage] = useState("login");

  useEffect(() => {
    const saved = localStorage.getItem("participant");
    if (saved) setPage("dashboard");
  }, []);

  useEffect(() => {
    const handler = (event) => {
      const data = event?.data || {};
      if (data.type !== "NOTIFICATION_OPENED") return;
      const notificationId = String(data.notification_id || "").trim();
      if (!notificationId) return;

      supabase.functions.invoke("opened-notification", {
        body: { notification_id: notificationId },
      });
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handler);
    }

    return () => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handler);
      }
    };
  }, []);

  if (page === "login") {
    return <Login onNext={() => setPage("dashboard")} />;
  }

  if (page === "profile") {
    return <Profile onBack={() => setPage("dashboard")} onExit={() => setPage("login")} />;
  }

  return <Dashboard onExit={() => setPage("login")} onProfile={() => setPage("profile")} />;
}

export default App;
