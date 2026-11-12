import { type Page, expect, test } from "@playwright/test";
import "@playwright/test";
import http from "node:http";
import { WebSocketServer } from "ws";
import { docs, setupWSConnection } from "y-websocket/bin/utils";

import { SETTLE, editorContext, openPane } from "./helpers";

// The bin/utils subpath ships CommonJS without type declarations (typed by ./y-websocket.d.ts).

/**
 * Smoke specs against a REAL standard y-websocket server (the classic
 * `bin/utils` relay: one WSSharedDoc per URL path, docName = the path
 * without the leading slash). The playground panes point at it through
 * `?syncUrl=`.
 */

// An OS-assigned port: a fixed preferred port can collide with a local
// service on the same machine (a service bound to the IPv4 loopback while
// the dual-stack bind takes the IPv6 half leaves the browser's WS upgrade
// on the other service's door), and the pane's URL is built from the
// resolved port either way.

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
  port = await listen(httpServer, 0);
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

async function expectDocContains(page: Page, client: "a" | "b", text: string): Promise<void> {
  await expect
    .poll(async () => (await page.getByTestId(`doc-${client}`).innerText()).includes(text), SETTLE)
    .toBe(true);
}

test("A's text reaches B through the standard server", async ({ browser }) => {
  // The engine's load-time connection's drop stand (the firefox's engine
  // drops the WS's attempt over the load; the harness's reconnect stands
  // the retry) — the settle stands the drop's window.
  test.setTimeout(120_000);
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const doc = `smoke-a2b-${Math.random().toString(36).slice(2, 8)}`;
  const url = paneUrl("a", doc);
  await openPane(pageA, "a", "", { url, settle: { timeout: 45_000 } });
  await openPane(pageB, "b", "", { url: paneUrl("b", doc), settle: { timeout: 45_000 } });

  // Typing goes into the real editor (the first block in reading order).
  const firstA = pageA.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').first();
  await firstA.click();
  await pageA.keyboard.type("hello");
  await expectDocContains(pageB, "b", "hello");

  await contextA.close();
  await contextB.close();
});

test("B's text reaches A through the standard server", async ({ browser }) => {
  // The engine's load-time connection's drop stand (the A's test's stand).
  test.setTimeout(120_000);
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const doc = `smoke-b2a-${Math.random().toString(36).slice(2, 8)}`;
  const url = paneUrl("b", doc);
  await openPane(pageA, "a", "", { url: paneUrl("a", doc), settle: { timeout: 45_000 } });
  await openPane(pageB, "b", "", { url, settle: { timeout: 45_000 } });

  const firstB = pageB.locator('[data-testid="doc-b"] [data-block-type="paragraph"]').first();
  await firstB.click();
  await pageB.keyboard.type("world");
  await expectDocContains(pageA, "a", "world");

  await contextA.close();
  await contextB.close();
});
