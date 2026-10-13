import "docblocks-react-ui/styles.css";
import "docblocks-react-ui/ui.css";
import { createRoot } from "react-dom/client";

import { StrictMode } from "react";

import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
