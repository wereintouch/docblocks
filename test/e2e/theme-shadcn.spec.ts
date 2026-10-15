import { expect, test } from "@playwright/test";

// Its own room: a manually left-over tab must not pollute the sync specs.
const SETTLE = { timeout: 15_000 };

// The standard (shadcn) input-token contract: when the consumer defines the
// standard tokens on :root/.dark, the editor's --docblocks-* tokens follow
// them — in light and after the .dark flip. Distinctive literals pin the
// mapping; the unthemed defaults are pinned by theme.spec.ts.
const STANDARD_TOKENS = `
:root {
  --foreground: #123456;
  --primary: #654321;
  --primary-foreground: #112233;
  --muted: #334455;
  --muted-foreground: #556677;
  --accent: #778899;
  --destructive: #990011;
  --border: #223344;
  --card: #445566;
  --popover: #667788;
  --radius: 10px;
  --font-sans: Georgia, serif;
  --font-mono: "Courier New", monospace;
}
.dark {
  --foreground: #654321;
  --primary: #123456;
  --border: #443322;
  --card: #221100;
  --popover: #332211;
}
`;

test("the standard shadcn tokens drive the editor theme", async ({ page }) => {
  await page.goto(`/?syncUrl=ws://localhost:5199/shadcn-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);
  const editor = page.locator('[data-slot="docblocks/editor"]');
  await expect(editor).toBeVisible();

  // The harness loads dark by default; this spec drives the light -> dark
  // flip explicitly, so clear the `.dark` class first.
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  const tokenOf = (name: string) => editor.evaluate((el, n) => getComputedStyle(el).getPropertyValue(n).trim(), name);

  // Unthemed baseline: the standard seed stands (the shipped styles.css
  // carries the seed, so the harness is seeded — the radius token resolves the seed's
  // 0.625rem, not the fallback literal).
  await expect.poll(() => tokenOf("--docblocks-radius"), SETTLE).toBe("0.625rem");

  // The consumer defines the standard tokens — the editor follows them.
  await page.addStyleTag({ content: STANDARD_TOKENS });
  await expect.poll(() => tokenOf("--docblocks-text-color"), SETTLE).toBe("#123456");
  await expect.poll(() => tokenOf("--docblocks-radius"), SETTLE).toBe("10px");
  await expect.poll(() => tokenOf("--docblocks-table-border-color"), SETTLE).toBe("#223344");
  await expect.poll(() => tokenOf("--docblocks-frame-background"), SETTLE).toBe("#445566");
  await expect.poll(() => tokenOf("--docblocks-gutter-color"), SETTLE).toBe("#556677");

  // The .dark flip: the dark standard set resolves (the mapping re-declares
  // the tokens on the editor root scope), then back to light — the standard
  // tokens still apply, not the fallbacks.
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect.poll(() => tokenOf("--docblocks-text-color"), SETTLE).toBe("#654321");
  await expect.poll(() => tokenOf("--docblocks-table-border-color"), SETTLE).toBe("#443322");
  await expect.poll(() => tokenOf("--docblocks-frame-background"), SETTLE).toBe("#221100");

  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  await expect.poll(() => tokenOf("--docblocks-text-color"), SETTLE).toBe("#123456");
});
