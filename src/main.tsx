import "./lib/devbridge";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";
import { invoke } from "@tauri-apps/api/core";
import { initTheme } from "./lib/theme";

initTheme();

// Forward runtime errors to the terminal during development.
if (import.meta.env.DEV) {
  const send = (level: string, message: string) => invoke("ui_log", { level, message }).catch(() => {});
  window.addEventListener("error", (e) => send("error", `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => send("rejection", String(e.reason?.stack ?? e.reason)));
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    orig(...args);
    send("console", args.map((a) => (a instanceof Error ? a.stack ?? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
