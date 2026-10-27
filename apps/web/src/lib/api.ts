import type { ApiErrorBody } from "@latticore/shared";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = "ApiError";
    this.code = body.error.code;
    this.status = status;
    this.details = body.error.details;
  }
}

const CSRF_HEADER = "x-csrf-token";
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  json?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options;

  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-Requested-With": "latticore-web",
      ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
      ...headers,
    },
    // Non-JSON bodies (uploads, etc.) go through api.raw() instead, so
    // RequestOptions intentionally has no `body` of its own here.
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await res.json() : undefined;

  if (!res.ok) {
    if (payload?.error) throw new ApiError(res.status, payload as ApiErrorBody);
    throw new ApiError(res.status, {
      error: { code: "INTERNAL_ERROR", message: res.statusText || "Request failed" },
    });
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, json?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "POST", json }),
  patch: <T>(path: string, json?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PATCH", json }),
  put: <T>(path: string, json?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "PUT", json }),
  delete: <T>(path: string, json?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: "DELETE", json }),
  /** Escape hatch for uploads/downloads: a real RequestInit (body allowed — e.g. FormData), no JSON handling. */
  raw: (path: string, options?: RequestInit) =>
    fetch(`/api${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "X-Requested-With": "latticore-web",
        ...(csrfToken ? { [CSRF_HEADER]: csrfToken } : {}),
        ...options?.headers,
      },
    }),
};
