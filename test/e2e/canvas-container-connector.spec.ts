import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The orthogonal connector's AVOIDANCE inside a container (2026-10-22): a
// line between two members of a container routes AROUND the members (the
// clear route) — the container's box stands no obstacle (the enclosing box
// would reject every inside route and the fallback elbow would cross the
// members). The line does not cross the middle member; both panes over the
// wire; a geometry change re-routes without crossing.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

interface Scene {
  group: string;
  a: string;
  c: string;
  b: string;
  conn: string;
}

/**
 * The scene: a container (group) with 3 members — A (left), C (middle),
 * B (right) — and an orthogonal connector A(east port) -> B(west port).
 * The straight route at y = 0 crosses C; the clear route detours over / under it.
 */
async function seedScene(page: Page, client: "a" | "b"): Promise<Scene> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const group = doc.insertBlock("group", { members: [] }, { parent: surface });
      doc.setGeometry(group, { x: 0, y: 0, w: 400, h: 300 });
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -100, y: 0, w: 80, h: 80 });
      const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(c, { x: 0, y: 0, w: 80, h: 80 });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(b, { x: 100, y: 0, w: 80, h: 80 });
      doc.transact(() => doc.updateBlock(group, { members: [a, c, b] }));
      const conn = doc.insertBlock(
        "connector",
        { start: { blockId: a, port: "east" }, end: { blockId: b, port: "west" }, variant: "orthogonal" },
        { parent: surface }
      );
      return { group, a, c, b, conn };
    },
    { client }
  );
}

/** The connector line's path data (the visible path's d, the world space). */
async function lineD(page: Page, client: "a" | "b", id: string): Promise<string | null> {
  return page.evaluate(
    ({ client, id }) => {
      const el = document.querySelector(`[data-testid="doc-${client}"] [data-connector-id="${id}"]`);
      return (el as SVGPathElement | null)?.getAttribute("d") ?? null;
    },
    { client, id }
  );
}

/** Waits until the connector line's path stands (the d attribute is set). */
async function waitForLine(page: Page, id: string): Promise<void> {
  await page.waitForFunction(
    ({ id }) => document.querySelector(`[data-connector-id="${id}"]`)?.getAttribute("d") !== null,
    { id },
    { timeout: 15_000, polling: 100 }
  );
}

/**
 * Whether the path's axis-aligned segments cross the box's INTERIOR (the
 * same contract as the route's clear test — the boundary stands clear, the
 * 0.5-px tolerance keeps an edge-hugging route from standing as a crossing).
 */
async function pathCrossesBox(
  page: Page,
  client: "a" | "b",
  id: string,
  box: { x: number; y: number; w: number; h: number }
): Promise<boolean> {
  return page.evaluate(
    ({ client, id, box }) => {
      const el = document.querySelector(`[data-testid="doc-${client}"] [data-connector-id="${id}"]`);
      const d = (el as SVGPathElement | null)?.getAttribute("d") ?? null;
      if (d === null) return false;
      const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
      const EPS = 0.5;
      const left = box.x - box.w / 2 + EPS;
      const right = box.x + box.w / 2 - EPS;
      const top = box.y - box.h / 2 + EPS;
      const bottom = box.y + box.h / 2 - EPS;
      for (let i = 0; i + 1 < pts.length; i++) {
        const p = pts[i]!;
        const q = pts[i + 1]!;
        if (Math.abs(p.x - q.x) < 1e-9) {
          const yLo = Math.min(p.y, q.y);
          const yHi = Math.max(p.y, q.y);
          if (p.x > left && p.x < right && yLo < bottom && yHi > top) return true;
        } else {
          const xLo = Math.min(p.x, q.x);
          const xHi = Math.max(p.x, q.x);
          if (p.y > top && p.y < bottom && xLo < right && xHi > left) return true;
        }
      }
      return false;
    },
    { client, id, box }
  );
}

test.describe("the orthogonal connector's avoidance inside a container", () => {
  test("the line between two members routes around the middle member (not the crossing fallback; over the wire)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-connector");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { conn } = await seedScene(a, "a");
      const cBox = { x: 0, y: 0, w: 80, h: 80 };

      await waitForLine(a, conn);
      const dA = (await lineD(a, "a", conn))!;
      // The line does NOT cross the middle member C (the clear route detours;
      // the crossing fallback would).
      expect(await pathCrossesBox(a, "a", conn, cBox)).toBe(false);
      // The line detours (more than the single segment between the two ports).
      expect((dA.match(/-?\d+(?:\.\d+)?/g) ?? []).length / 2).toBeGreaterThan(2);

      // Both panes: the same route over the wire (the doc stands the refs; the
      // route is the pure view re-computed from the shared geometry).
      await expect.poll(async () => lineD(b, "b", conn), SETTLE).toBe(dA);
      expect(await pathCrossesBox(b, "b", conn, cBox)).toBe(false);
    } finally {
      await close();
    }
  });

  test("moving the middle member re-routes the line without crossing it", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "container-connector-move");
    try {
      await toCanvas(a, "a");
      const { conn, c } = await seedScene(a, "a");
      await waitForLine(a, conn);
      const dA = (await lineD(a, "a", conn))!;
      expect(await pathCrossesBox(a, "a", conn, { x: 0, y: 0, w: 80, h: 80 })).toBe(false);

      // Move C down (below the line's corridor): the line re-routes and still
      // does not cross C's new position.
      await a.evaluate((c) => {
        const doc = window.__paneDocs?.a;
        if (doc === undefined || doc === null) throw new Error("no doc");
        doc.setGeometry(c, { x: 0, y: 120, w: 80, h: 80 });
      }, c);
      await expect.poll(async () => lineD(a, "a", conn), SETTLE).not.toBe(dA);
      expect(await pathCrossesBox(a, "a", conn, { x: 0, y: 120, w: 80, h: 80 })).toBe(false);
    } finally {
      await close();
    }
  });
});
