import { ZodError } from "zod";

export class UnauthorizedUserRouteError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedUserRouteError";
  }
}

export class BlockedUserRouteError extends Error {
  constructor(message = "Blocked") {
    super(message);
    this.name = "BlockedUserRouteError";
  }
}

export type UserRouteErrorClass = "auth-unauthorized" | "auth-blocked" | "validation-error" | "runtime-error";

export function isUserRouteAuthError(error: unknown) {
  if (error instanceof UnauthorizedUserRouteError || error instanceof BlockedUserRouteError) {
    return true;
  }

  return (
    error instanceof Error &&
    (error.message === "Unauthorized" || error.message === "Blocked")
  );
}

export function classifyUserRouteError(error: unknown): {
  statusCode: 400 | 401 | 403 | 500;
  statusClass: UserRouteErrorClass;
  message: string;
} {
  if (error instanceof BlockedUserRouteError || (error instanceof Error && error.message === "Blocked")) {
    return {
      statusCode: 403,
      statusClass: "auth-blocked",
      message: "Kullanici engellendi. Destek ekibi ile iletisim kurun."
    };
  }

  if (error instanceof UnauthorizedUserRouteError || (error instanceof Error && error.message === "Unauthorized")) {
    return {
      statusCode: 401,
      statusClass: "auth-unauthorized",
      message: "Yetkisiz."
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      statusClass: "validation-error",
      message: "Gecersiz istek verisi."
    };
  }

  return {
    statusCode: 500,
    statusClass: "runtime-error",
    message: "Istek islenirken beklenmeyen bir hata olustu."
  };
}
