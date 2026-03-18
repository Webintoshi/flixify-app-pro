import { describe, expect, it } from "vitest";
import {
  BlockedUserRouteError,
  classifyUserRouteError,
  isUserRouteAuthError,
  UnauthorizedUserRouteError
} from "./user-route-error.js";

describe("user route error classification", () => {
  it("maps unauthorized errors to 401", () => {
    const result = classifyUserRouteError(new UnauthorizedUserRouteError());
    expect(result).toEqual({
      statusCode: 401,
      statusClass: "auth-unauthorized",
      message: "Yetkisiz."
    });
    expect(isUserRouteAuthError(new UnauthorizedUserRouteError())).toBe(true);
  });

  it("maps blocked errors to 403", () => {
    const result = classifyUserRouteError(new BlockedUserRouteError());
    expect(result).toEqual({
      statusCode: 403,
      statusClass: "auth-blocked",
      message: "Kullanici engellendi. Destek ekibi ile iletisim kurun."
    });
    expect(isUserRouteAuthError(new BlockedUserRouteError())).toBe(true);
  });

  it("keeps backward compatibility with legacy message errors", () => {
    expect(classifyUserRouteError(new Error("Unauthorized")).statusCode).toBe(401);
    expect(classifyUserRouteError(new Error("Blocked")).statusCode).toBe(403);
    expect(isUserRouteAuthError(new Error("Unauthorized"))).toBe(true);
    expect(isUserRouteAuthError(new Error("Blocked"))).toBe(true);
  });

  it("maps non-auth errors to 500", () => {
    const result = classifyUserRouteError(new Error("db timeout"));
    expect(result).toEqual({
      statusCode: 500,
      statusClass: "runtime-error",
      message: "Istek islenirken beklenmeyen bir hata olustu."
    });
    expect(isUserRouteAuthError(new Error("db timeout"))).toBe(false);
  });
});
