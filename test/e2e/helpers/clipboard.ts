import { type BrowserContext, type Page } from "@playwright/test";

/** The engine's browser name (the clipboard stand's selector). */
function browserNameOf(page: Page): string {
  return page.context().browser()?.browserType().name() ?? "chromium";
}

/**
 * The clipboard's grant over the engine's stand: the chromium's read + write;
 * the webkit's read; the firefox stands no clipboard's grant (Playwright
 * exposes no clipboard permission there — its read API takes none).
 */
async function grantClipboardPermissions(context: BrowserContext): Promise<void> {
  const name = context.browser()?.browserType().name() ?? "chromium";
  if (name === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else if (name === "webkit") await context.grantPermissions(["clipboard-read"]);
}

/**
 * Seed the page's paste payload: the OS clipboard's write over the chromium
 * (the grant's stand), the page-global's stash over the firefox/webkit (the
 * clipboard's read stands no grantable permission there — the paste's
 * dispatch reads the stash).
 */
async function seedClipboardPayload(page: Page, payload: { html?: string; plain?: string }): Promise<void> {
  if (browserNameOf(page) === "chromium") {
    await page.evaluate(async (p) => {
      const obj: Record<string, Blob> = {};
      if (p.html !== undefined) obj["text/html"] = new Blob([p.html], { type: "text/html" });
      if (p.plain !== undefined) obj["text/plain"] = new Blob([p.plain], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem(obj)]);
    }, payload);
    return;
  }
  await page.evaluate((p) => {
    window.__pbSeed = p;
  }, payload);
}

/**
 * Install the clipboard's write capture (the app's copy's assertion over the
 * no-read engine: the firefox/webkit's clipboard read stands no grantable
 * permission). The native `copy`'s event (the selection's copy, the
 * cross-copy) and the clipboard API's write(s) (the code/table's copy) are
 * intercepted into the page-global's queue.
 */
async function interceptClipboardWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__pbWrites !== undefined) return;
    window.__pbWrites = [];
    document.addEventListener("copy", (event) => {
      const data = (event as ClipboardEvent).clipboardData;
      if (data === null) return;
      window.__pbWrites?.push({
        html: data.getData("text/html") || undefined,
        plain: data.getData("text/plain") || undefined,
      });
    });
    const clip = navigator.clipboard;
    const origWrite = clip.write.bind(clip);
    const origWriteText = clip.writeText.bind(clip);
    clip.write = (async (items: ClipboardItem[]) => {
      const textOf = async (type: string): Promise<string | null> => {
        const matching = items.filter((item) => item.types.includes(type));
        if (matching[0] === undefined) return null;
        return matching[0].getType(type).then((blob) => blob.text());
      };
      const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      window.__pbWrites?.push({ html: html ?? undefined, plain: plain ?? undefined });
      return origWrite(items).catch(() => undefined);
    }) as typeof clip.write;
    clip.writeText = (async (text: string) => {
      window.__pbWrites?.push({ plain: text });
      return origWriteText(text).catch(() => undefined);
    }) as typeof clip.writeText;
  });
}

/**
 * The app's last copied payload: the OS clipboard's read over the chromium
 * (the grant's stand's real pipeline), the intercepted write's capture
 * otherwise (the no-read engine's stand).
 */
async function readClipboardPayload(page: Page): Promise<{ html?: string; plain?: string }> {
  if (browserNameOf(page) === "chromium") {
    return page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const textOf = async (type: string): Promise<string | null> => {
        const matching = items.filter((item) => item.types.includes(type));
        if (matching[0] === undefined) return null;
        return matching[0].getType(type).then((blob) => blob.text());
      };
      const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      return { html: html ?? undefined, plain: plain ?? undefined };
    });
  }
  return page.evaluate(() => {
    const writes = window.__pbWrites;
    const last = writes === undefined || writes.length === 0 ? undefined : writes[writes.length - 1];
    if (last === undefined) throw new Error("the clipboard's write is not captured (the intercept's stand)");
    return last;
  });
}

/**
 * Paste the page's paste payload (the plain and the html flavors when
 * present) into the focused element through a synthetic paste event (the
 * headless chromium's stand: it does not synthesize the paste's event). The
 * payload stands the OS clipboard's read over the chromium (the real
 * pipeline), the page-global's stash over the no-grant engines.
 */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(
    async (useOs: boolean) => {
      let html: string | null;
      let plain: string | null;
      if (useOs) {
        const items = await navigator.clipboard.read();
        const textOf = (type: string): Promise<string | null> =>
          Promise.resolve(items)
            .then((list) => list.filter((item) => item.types.includes(type)))
            .then((matching) =>
              matching[0] === undefined ? null : matching[0].getType(type).then((blob) => blob.text())
            );
        [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      } else {
        const stashed = window.__pbSeed;
        if (stashed === undefined) throw new Error("the paste payload is not seeded (the seed's stash's stand)");
        html = stashed.html ?? null;
        plain = stashed.plain ?? null;
      }
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
      const transfer = new DataTransfer();
      if (html !== null) transfer.setData("text/html", html);
      if (plain !== null) transfer.setData("text/plain", plain);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: transfer });
      target.dispatchEvent(event);
    },
    browserNameOf(page) === "chromium"
  );
}

export {
  browserNameOf,
  grantClipboardPermissions,
  interceptClipboardWrites,
  pasteFromClipboard,
  readClipboardPayload,
  seedClipboardPayload,
};
