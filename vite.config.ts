import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Only audited local-edition assets enter a build; legacy photographs remain private.
  publicDir: false,
  plugins: [react(), {
    name: "thara-offline-shell",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter(name => !name.endsWith(".map"));
      const version = createHash("sha256");
      for (const name of files) {
        const asset = bundle[name];
        version.update(name).update(asset.type === "asset" ? asset.source : asset.code);
      }
      version.update(fs.readFileSync("public/manifest.webmanifest"));
      version.update(fs.readFileSync("index.html"));
      const notices = ["LICENSE", "NOTICE", "THIRD-PARTY-NOTICES.txt"];
      for (const name of notices) version.update(name).update(fs.readFileSync(name));
      const hash = version.digest("hex").slice(0, 12);
      for (const name of notices) this.emitFile({ type: "asset", fileName: name, source: fs.readFileSync(name, "utf8") });
      const shell = [...notices.map(name => "/" + name), "/", "/index.html", "/manifest.webmanifest", ...files.map(name => "/" + name)];
      this.emitFile({ type: "asset", fileName: "manifest.webmanifest", source: fs.readFileSync("public/manifest.webmanifest", "utf8") });
      this.emitFile({ type: "asset", fileName: "sw.js", source: `
const CACHE = "thara-local-${hash}";
const SHELL = ${JSON.stringify(shell)};
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("thara-local-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if(event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if(event.request.mode === "navigate") {
    event.respondWith(caches.open(CACHE).then(cache => cache.match("/index.html")).then(response => response || fetch(event.request)));
  } else if(SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(response => response || fetch(event.request)));
  }
});
` });
    },
  }],
  server: { host: "127.0.0.1", port: 5173, strictPort: false },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
