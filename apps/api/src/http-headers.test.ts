import { describe, expect, it } from "vitest";
import type { IncomingHttpHeaders } from "node:http";
import { shouldStripEmptyJsonContentType, stripEmptyJsonContentType } from "./http-headers.js";

function createHeaders(headers: IncomingHttpHeaders = {}) {
  return {
    ...headers
  } as IncomingHttpHeaders;
}

describe("empty json content-type guard", () => {
  it("strips json content-type for DELETE requests without body", () => {
    const headers = createHeaders({
      "content-type": "application/json"
    });

    expect(shouldStripEmptyJsonContentType("DELETE", headers)).toBe(true);
    stripEmptyJsonContentType("DELETE", headers);
    expect(headers["content-type"]).toBeUndefined();
  });

  it("keeps content-type when content-length is positive", () => {
    const headers = createHeaders({
      "content-type": "application/json",
      "content-length": "2"
    });

    expect(shouldStripEmptyJsonContentType("DELETE", headers)).toBe(false);
  });

  it("does not affect body-carrying methods", () => {
    const headers = createHeaders({
      "content-type": "application/json"
    });

    expect(shouldStripEmptyJsonContentType("PATCH", headers)).toBe(false);
  });

  it("keeps content-type for chunked requests", () => {
    const headers = createHeaders({
      "content-type": "application/json",
      "transfer-encoding": "chunked"
    });

    expect(shouldStripEmptyJsonContentType("DELETE", headers)).toBe(false);
  });
});
