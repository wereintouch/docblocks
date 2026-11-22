// @vitest-environment jsdom
// The hook-misuse's typed stand: a docblocks hook rendered outside its
// provider throws the `HookMisuseError` (the typed family's class — a
// consumer catches it by class, never a raw `Error`).
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import * as React from "react";

import { HookMisuseError, useDoc, useSelection } from "../src";

/** Renders `ui` over a bare root (no providers) and captures the render's
 * error (the React 19 root's `onUncaughtError` — the boundary-less
 * failure's stand; the callback fires on a post-render tick, so the
 * capture awaits one). */
async function captureRenderError(ui: React.ReactElement): Promise<unknown> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let captured: unknown = null;
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      captured = error;
    },
  });
  root.render(ui);
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  root.unmount();
  return captured;
}

describe("the hook's misuse stands the typed error (the family's contract)", () => {
  it("the editor context's hook over the bare root throws HookMisuseError", async () => {
    const captured = await captureRenderError(<Hook useHook={useDoc} />);
    expect(captured).toBeInstanceOf(HookMisuseError);
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toMatch(/EditorProvider/);
  });

  it("the selection's hook over the bare root stands the same class", async () => {
    const captured = await captureRenderError(<Hook useHook={useSelection} />);
    expect(captured).toBeInstanceOf(HookMisuseError);
  });
});

/** The probe's component: renders the passed hook (the context's read). */
function Hook(props: { useHook: () => unknown }) {
  props.useHook();
  return null;
}
