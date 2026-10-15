import { type Page, expect, test } from "@playwright/test";
import http from "node:http";
import { WebSocketServer } from "ws";
import { docs, setupWSConnection } from "y-websocket/bin/utils";

// The bin/utils subpath ships CommonJS without type declarations (typed by ./y-websocket.d.ts).

/**
 * Smoke specs against a REAL standard y-websocket server (the classic
 * `bin/utils` relay: one WSSharedDoc per URL path, docName = the path
 * without the leading slash). The playground panes point at it through
 * `?syncUrl=`.
 */

const PREFERRED_PORT = 1234;
const SETTLE = { timeout: 15_000 };

let server: http.Server;
let wss: WebSocketServer;
let port: number;

test.beforeAll(async () => {
  const httpServer = http.createServer();
  const relay = new WebSocketServer({ noServer: true });
  relay.on("connection", (conn, req) => setupWSConnection(conn, req));
  httpServer.on("upgrade", (req, socket, head) => {
    relay.handleUpgrade(req, socket, head, (conn) => {
      relay.emit("connection", conn, req);
    });
  });
  server = httpServer;
  wss = relay;
  port = await listen(httpServer, PREFERRED_PORT);
});

test.afterAll(async () => {
  // Drop the room docs: their awareness timers would otherwise keep the
  // worker process alive.
  for (const doc of docs.values()) {
    doc.awareness.destroy();
    doc.destroy();
  }
  docs.clear();
  await new Promise<void>((resolve) => {
    wss.close(() => resolve());
  });
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
});

async function listen(server: http.Server, preferred: number): Promise<number> {
  const start = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => reject(error);
      server.once("error", onError);
      server.listen(port, () => {
        server.removeListener("error", onError);
        const address = server.address();
        resolve(address !== null && typeof address !== "string" ? address.port : -1);
      });
    });
  try {
    return await start(preferred);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "EADDRINUSE") {
      return start(0); // port taken: let the OS assign one
    }
    throw error;
  }
}

function paneUrl(client: "a" | "b", docName: string): string {
  return `/?client=${client}&syncUrl=ws://localhost:${port}/${docName}`;
}

async function openPane(page: Page, url: string, client: "a" | "b"): Promise<void> {
  await page.goto(url);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function expectDocContains(page: Page, client: "a" | "b", text: string): Promise<void> {
  await expect
    .poll(async () => (await page.getByTestId(`doc-${client}`).innerText()).includes(text), SETTLE)
    .toBe(true);
}

test("A's text reaches B through the standard server", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const doc = `smoke-a2b-${Math.random().toString(36).slice(2, 8)}`;
  const url = paneUrl("a", doc);
  await openPane(pageA, url, "a");
  await openPane(pageB, paneUrl("b", doc), "b");

  // Typing goes into the real editor (the first block in reading order).
  const firstA = pageA.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').first();
  await firstA.click();
  await pageA.keyboard.type("hello");
  await expectDocContains(pageB, "b", "hello");

  await contextA.close();
  await contextB.close();
});

test("B's text reaches A through the standard server", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const doc = `smoke-b2a-${Math.random().toString(36).slice(2, 8)}`;
  const url = paneUrl("b", doc);
  await openPane(pageA, paneUrl("a", doc), "a");
  await openPane(pageB, url, "b");

  const firstB = pageB.locator('[data-testid="doc-b"] [data-block-type="paragraph"]').first();
  await firstB.click();
  await pageB.keyboard.type("world");
  await expectDocContains(pageA, "a", "world");

  await contextA.close();
  await contextB.close();
});
