export function registerPwa() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline setup is optional; records remain usable while the app is open.
      window.dispatchEvent(new Event("thara-offline-unavailable"));
    });
  });
}
