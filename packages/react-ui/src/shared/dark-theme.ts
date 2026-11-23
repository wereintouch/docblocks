/**
 * The document's dark theme's detection (the render-time's read — the
 * fill / text's stand over the shape's figures): the `dark`'s class on
 * `documentElement` (the next-themes' / the portal's stand — the CSS
 * tokens' scope's parity: the dark's set stands the class's activation,
 * no class = the light's stand). The flip's subscription: a single
 * module-level MutationObserver (the class's attribute) over one shared
 * store — the consumers (the shape's figure / text) re-render over the
 * flip (the no-class's engine's stand — the jsdom's / SSR's light's
 * default).
 */
import { createStore, useStore } from "zustand";
import type { StoreApi } from "zustand";

interface DarkThemeState {
  dark: boolean;
}

/** The dark's stand (the `dark`'s class over `documentElement`). */
function detectDark(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

let store: StoreApi<DarkThemeState> | null = null;
let observerStarted = false;

function darkStore(): StoreApi<DarkThemeState> {
  if (store === null) {
    store = createStore<DarkThemeState>(() => ({ dark: detectDark() }));
    if (!observerStarted && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
      observerStarted = true;
      new MutationObserver(() => {
        const next = detectDark();
        if (next !== store?.getState().dark) {
          store?.setState({ dark: next });
        }
      }).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    }
  }
  return store;
}

/** The document's dark theme's stand (the shape's figure / text's
 * render-time's transform's trigger). */
function useDarkTheme(): boolean {
  return useStore(darkStore(), (state) => state.dark);
}

/** The dark's stand's read (the no-hook's stand — the test's / the
 * imperative's path). */
function isDarkTheme(): boolean {
  return darkStore().getState().dark;
}

export { isDarkTheme, useDarkTheme };
