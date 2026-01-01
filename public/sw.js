self["__WB_MANIFEST"] = self.__WB_MANIFEST || [];


self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        try {
          const text = event.data ? await event.data.text() : "";
          data = { title: "Nudge", body: text || "", data: {} };
        } catch {
          data = { title: "Nudge", body: "", data: {} };
        }
      }

      const title = data.title || "Nudge";
      const options = {
        body: data.body || "Test notification received.",
        icon: "/favicon.ico",
        badge: "/favicon.ico",
        data: data.data || {},
      };

      await self.registration.showNotification(title, options);
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationId =
    event.notification?.data?.notification_id ||
    event.notification?.data?.notificationId ||
    "";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        try {
          client.postMessage({
            type: "NOTIFICATION_OPENED",
            notification_id: notificationId,
          });
          await client.focus();
          return;
        } catch {}
      }

      const newClient = await self.clients.openWindow("/");
      if (newClient) {
        await new Promise((r) => setTimeout(r, 300));
        try {
          newClient.postMessage({
            type: "NOTIFICATION_OPENED",
            notification_id: notificationId,
          });
        } catch {}
      }
    })(),
  );
});
