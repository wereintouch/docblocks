/** The state-based settle's stands over the fixed sleeps (the false-red
 * class over the loaded machine — the wait targets the state, not the wall
 * clock). */
import { type Page } from "@playwright/test";

/**
 * Wait for the pane's rows to settle (the enter / the layout's animations
 * done): a settled row carries the animated `height: auto` inline (a row
 * that skipped the enter animation carries none), a mid-flight row carries
 * the explicit height. The fixed 600 ms enter-settle's state-based stand —
 * a drag started mid-animation would measure the rows' mid-flight boxes.
 */
async function rowsSettled(page: Page, timeoutMs = 5_000): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-slot="docblocks/rows"] > *')).every(
        (el) => el instanceof HTMLElement && (el.style.height === "" || el.style.height === "auto")
      ),
    null,
    { polling: 20, timeout: timeoutMs }
  );
}

/**
 * Wait for a slot's entry animation to settle (the portaled chrome's
 * stand): the opacity reaches 1 and the transform comes to rest over the
 * settled element. The fixed 250 ms entry-settle's state-based stand — a
 * measurement over the scale's factor stands the untransformed geometry
 * over the animation's frames. Precondition: the target carries no
 * permanent transform (a positioning transform would stand `none`
 * unreachable) and the first match of the slot is the animated element.
 */
async function slotEntered(page: Page, slot: string, timeoutMs = 5_000): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const element = document.querySelector(selector);
      if (element === null) return false;
      const style = window.getComputedStyle(element);
      return style.opacity === "1" && style.transform === "none";
    },
    `[data-slot="${slot}"]`,
    { polling: 20, timeout: timeoutMs }
  );
}

export { rowsSettled, slotEntered };
