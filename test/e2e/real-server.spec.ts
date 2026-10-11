import { type Page, expect, test } from "@playwright/test";
import http from "node:http";
import { WebSocketServer } from "ws";
import { docs, setupWSConnection } from "y-websocket/bin/utils";

// The subpath ships CommonJS without type declarations.
declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http";
  import type { WebSocket } from "ws";
  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ): void;
  export const docs: Map<string, { name: string; awareness: { destroy(): void }; destroy(): void }>;
}

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
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
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
  const url = paneUrl("a", "smoke-a2b");
  await openPane(pageA, url, "a");
  await openPane(pageB, paneUrl("b", "smoke-a2b"), "b");

  await pageA.getByTestId("editor-a").pressSequentially("hello");
  await expectDocContains(pageB, "b", "hello");

  await contextA.close();
  await contextB.close();
});

test("B's text reaches A through the standard server", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const url = paneUrl("b", "smoke-b2a");
  await openPane(pageA, paneUrl("a", "smoke-b2a"), "a");
  await openPane(pageB, url, "b");

  await pageB.getByTestId("editor-b").pressSequentially("world");
  await expectDocContains(pageA, "a", "world");

  await contextA.close();
  await contextB.close();
});
