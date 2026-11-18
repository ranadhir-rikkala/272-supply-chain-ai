import { config } from "../config";

export interface Problem {
  type?: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  requestId?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly requestId: string | null;

  constructor(problem: Problem) {
    super(problem.detail || problem.title);
    this.name = "ApiError";
    this.status = problem.status;
    this.title = problem.title;
    this.detail = problem.detail;
    this.requestId = problem.requestId ?? null;
  }

  get friendly(): string {
    switch (this.status) {
      case 0:
        return "The server could not be reached. Check your connection and try again.";
      case 401:
        return "Your session has expired. Sign in again.";
      case 403:
        return `Not allowed: ${this.detail}`;
      case 409:
        return `Already handled: ${this.detail}`;
      case 412:
        return "Someone changed this while you were looking at it. Reload and try again.";
      case 422:
        return `Request rejected: ${this.detail}`;
      case 503:
        return `A service is unavailable: ${this.detail}`;
      default:
        return this.detail || this.title;
    }
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  ifMatch?: number | string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface Envelope<T> {
  data: T;
  etag: string | null;
}

type TokenSource = () => string | null;

let tokenSource: TokenSource = () => null;
let onUnauthorized: () => void = () => undefined;

export function configureClient(source: TokenSource, unauthorized: () => void) {
  tokenSource = source;
  onUnauthorized = unauthorized;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function etagVersion(etag: string | null): number | null {
  if (!etag) return null;
  const parsed = Number(etag.replace(/^W\//, "").replaceAll('"', ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function toProblem(response: Response): Promise<Problem> {
  const fallback: Problem = { title: response.statusText || "Error", status: response.status, detail: "" };
  const text = await response.text();
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as Partial<Problem>;
    return {
      ...fallback,
      ...parsed,
      status: parsed.status ?? response.status,
      detail: parsed.detail ?? parsed.title ?? fallback.title,
      requestId: parsed.requestId ?? response.headers.get("X-Request-ID"),
    };
  } catch {
    return { ...fallback, detail: text.slice(0, 300) };
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const headers = new Headers({ Accept: "application/json", "X-Request-ID": newRequestId() });
  const token = tokenSource();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (options.ifMatch !== undefined) headers.set("If-Match", `"${options.ifMatch}"`);
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

  let response: Response;
  try {
    response = await fetch(`${config.apiBase}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ title: "Network Error", status: 0, detail: "network request failed" });
  }

  if (!response.ok) {
    const problem = await toProblem(response);
    if (response.status === 401) onUnauthorized();
    throw new ApiError(problem);
  }
  const etag = response.headers.get("ETag");
  if (response.status === 204) return { data: undefined as T, etag };
  const text = await response.text();
  return { data: (text ? JSON.parse(text) : undefined) as T, etag };
}

export async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await request<T>(path, { signal })).data;
}

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
