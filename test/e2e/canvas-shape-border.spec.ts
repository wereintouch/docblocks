import { type Browser, type Page, expect, test } from "@playwright/test";


// width's FigureBorderSelector (the 1–4 px dots, the handle's drag
// SNAPS to the nearest dot — one updateBlock per stand) and the style
// menu (the solid / the dashed / the no-border — the stroke's "none"
// idiom). A/B sync over the relay.
const RELAY = "ws://localhost:5199";

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

function canvasView(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
}

/** Seeds one rect shape on the pane's doc. */
async function seedShape(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate((which) => {
    const docs = window.__paneDocs;
    const doc = (which === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const json = doc.toJSON();
    const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
    const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
    const id = doc.insertBlock("shape", { variant: "rect", fill: "none" }, { parent: surface });
    doc.setGeometry(id, { x: 0, y: 0, w: 240, h: 120 });
    return id;
  }, client);
}

/** Click-selects the shape (the press on its canvas-item wrapper). */
async function selectShape(page: Page, client: "a" | "b", id: string): Promise<void> {
  const wrapper = canvasView(page, client).locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
  await wrapper.click();
  await expect(page.getByRole("toolbar", { name: "Shape options" })).toBeVisible();
}

function shapeAttrs(page: Page, client: "a" | "b", id: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ which, id }) => {
      const docs = window.__paneDocs;
      const doc = (which === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const block = doc.getBlock(id);
      if (block === null || block.type !== "shape") throw new Error("the shape is missing");
      return (block.attrs ?? {}) as Record<string, unknown>;
    },
    { which: client, id }
  );
}

test.describe("the border's controls", () => {
  test("the width's selector drags to the nearest dot (one updateBlock per stand, the sync stands)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "border-width");
    await a.getByTestId("view-a-canvas").click();
    await a.waitForTimeout(200);

    const id = await seedShape(a, "a");
    await selectShape(a, "a", id);

    const slider = a.getByRole("slider", { name: "Shape border width" });
    const box = (await slider.boundingBox())!;
    // The handle stands at 25% (the default 2 px = the second dot of the
    // 1–4 stand); the drag to the right edge's dot = the 4 px.
    const y = box.y + box.height / 2;
    await a.mouse.move(box.x + box.width * 0.25, y);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.5, y, { steps: 3 });
    await a.mouse.move(box.x + box.width * 0.95, y, { steps: 3 });
    await a.mouse.up();
    expect(await shapeAttrs(a, "a", id)).toMatchObject({ strokeWidth: 4 });
    expect(await shapeAttrs(b, "b", id)).toMatchObject({ strokeWidth: 4 });

    // The drag back to the left edge's dot = the 1 px.
    await a.mouse.move(box.x + box.width * 0.95, y);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width * 0.5, y, { steps: 3 });
    await a.mouse.move(box.x + box.width * 0.02, y, { steps: 3 });
    await a.mouse.up();
    expect(await shapeAttrs(a, "a", id)).toMatchObject({ strokeWidth: 1 });
    expect(await shapeAttrs(b, "b", id)).toMatchObject({ strokeWidth: 1 });

    // The live snap writes one updateBlock per snapped stand (the write
    // fires only on the index change), so the undo chain steps the stands
    // back one by one: the first undo leaves a stand different from the
    // last's (the 1 px), and the full chain returns the attr to the
    // absent stand (one step per write).
    await a.evaluate(
      ({ which }) => {
        const docs = window.__paneDocs;
        const doc = (which === "a" ? docs?.a : docs?.b)!;
        doc.undo();
      },
      { which: "a" }
    );
    const afterUndo = await shapeAttrs(a, "a", id);
    expect(afterUndo["strokeWidth"]).not.toBe(1);
    expect(Number(afterUndo["strokeWidth"])).toBeGreaterThanOrEqual(1);
    expect(Number(afterUndo["strokeWidth"])).toBeLessThanOrEqual(4);

    let steps = 0;
    while (steps < 10 && (await shapeAttrs(a, "a", id))["strokeWidth"] !== undefined) {
      await a.evaluate(
        ({ which }) => {
          const docs = window.__paneDocs;
          const doc = (which === "a" ? docs?.a : docs?.b)!;
          doc.undo();
        },
        { which: "a" }
      );
      steps++;
    }
    expect(steps).toBeLessThan(10);
    expect((await shapeAttrs(a, "a", id))["strokeWidth"]).toBeUndefined();

    await close();
  });

  test("the style menu applies the dashed / the no-border (one updateBlock each, the svg stands in both panes)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "border-style");
    await a.getByTestId("view-a-canvas").click();
    await a.waitForTimeout(200);

    const id = await seedShape(a, "a");
    await selectShape(a, "a", id);

    // The stand: the solid line is the checked entry (the default's).
    await a.getByLabel("Shape border style").click();
    const menu = a.getByRole("menu");
    await expect(menu.getByRole("menuitemcheckbox", { name: "Solid line" })).toBeChecked();

    // The dashed: the strokeStyle's "dash" (the svg's dasharray stands).
    await menu.getByRole("menuitemcheckbox", { name: "Dashed" }).click();
    expect(await shapeAttrs(a, "a", id)).toMatchObject({ strokeStyle: "dash" });
    await expect(b.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"] svg g`)).toHaveAttribute(
      "stroke-dasharray",
      /.+/
    );

    // The no-border: the stroke's "none" (the width / the style attrs
    // stand — the existing idiom of the palette's "No color"). The menu
    // reopens after the close stands (the exit animation — a trigger
    // click mid-close toggles it back off).
    await expect(a.getByRole("menu")).toHaveCount(0);
    await a.getByLabel("Shape border style").click();
    await a.getByRole("menuitemcheckbox", { name: "No border" }).click();
    expect(await shapeAttrs(a, "a", id)).toMatchObject({ stroke: "none", strokeStyle: "dash" });
    await expect(b.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"] svg g`)).toHaveAttribute(
      "stroke",
      "none"
    );

    // One undo step per apply: the undo brings the dashed's stand back.
    await a.evaluate(
      ({ which }) => {
        const docs = window.__paneDocs;
        const doc = (which === "a" ? docs?.a : docs?.b)!;
        doc.undo();
      },
      { which: "a" }
    );
    expect(await shapeAttrs(a, "a", id)).not.toHaveProperty("stroke", "none");

    await close();
  });
});
