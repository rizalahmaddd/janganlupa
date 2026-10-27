import type { Context } from "hono";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EMAIL?: { send(message: Record<string, unknown>): Promise<unknown> };
  APP_NAME: string;
  APP_URL: string;
  APP_SECRET?: string;
  EMAIL_FROM: string;
  EMAIL_PROVIDER: "resend" | "cloudflare" | "console";
  RESEND_API_KEY?: string;
  JOB_TOKEN?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  settings: string;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser; sessionHash: string } };
export type Ctx = Context<AppEnv>;

export function secretOf(env: Env): string {
  return env.APP_SECRET || "insecure-dev-secret";
}

export function isLocal(env: Env): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)/.test(env.APP_URL);
}
