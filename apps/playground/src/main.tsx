import "docblocks-react-ui/styles.css";
// The CDT-MCP DevTools hook installs on this import and must run before
// `react-dom` is evaluated, or React won't connect to it — the line stands
// before the react-dom import for that reason.
import "react-devtools-cdt-mcp/register";
import { createRoot } from "react-dom/client";

import { StrictMode } from "react";

import { App } from "./App";
import "./harness.css";

// The harness default theme: the dark token set (the `.dark` class on
// `<html>`); the pane's theme toggle (SyncPane's system panel) is the
// source of truth after mount.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
