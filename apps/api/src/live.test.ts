import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeLiveStream } from "./live.js";

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>) => void
): Promise<TestServer> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server address alinamadi.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

const activeServers: TestServer[] = [];

afterEach(async () => {
  while (activeServers.length > 0) {
    const server = activeServers.pop();
    if (server) {
      await server.close();
    }
  }
});

describe("probeLiveStream", () => {
  it("rejects JSON error payloads even when upstream responds with 200", async () => {
    const server = await startServer((req, res) => {
      if (req.url?.includes(".ts")) {
        res.writeHead(200, {
          "content-type": "application/json"
        });
        res.end(JSON.stringify({
          error: "USER_EXPIRED",
          message: "Your subscription has expired",
          status: 401
        }));
        return;
      }

      res.writeHead(404).end();
    });
    activeServers.push(server);

    const result = await probeLiveStream(`${server.origin}/live/channel.ts`);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(result.transport).toBe("ts");
    expect(result.errorMessage).toContain("expired");
  });

  it("accepts binary TS responses as playable streams", async () => {
    const server = await startServer((req, res) => {
      if (req.url?.includes(".ts")) {
        res.writeHead(200, {
          "content-type": "video/mp2t"
        });
        res.end(Buffer.from([0x47, 0x40, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00]));
        return;
      }

      res.writeHead(404).end();
    });
    activeServers.push(server);

    const result = await probeLiveStream(`${server.origin}/live/channel.ts`);

    expect(result.ok).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.transport).toBe("ts");
    expect(result.errorMessage).toBeNull();
  });
});
