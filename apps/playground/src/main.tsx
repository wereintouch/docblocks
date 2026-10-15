import "docblocks-react-ui/styles.css";
import "docblocks-react-ui/ui.css";
import { createRoot } from "react-dom/client";

import { StrictMode } from "react";

import { App } from "./App";

// The harness default theme: the dark token set (the `.dark` class on
// `<html>`); the pane's theme toggle (SyncPane's system panel) is the
// source of truth after mount.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
