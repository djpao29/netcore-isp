// Cliente tipado hacia el SaaS (PHP). Soporta token de colector o sesión+CSRF.
import type { Alarm, PollResult } from "./types";

export interface SaasClientOptions {
  baseUrl: string;
  collectorToken?: string;
  user?: string;
  password?: string;
}

export class SaasClient {
  private baseUrl: string;
  private token?: string;
  private user?: string;
  private password?: string;
  private csrf: string | null = null;
  private loggedIn = false;
  private cookieJar: string | null = null;

  constructor(opts: SaasClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.collectorToken;
    this.user = opts.user;
    this.password = opts.password;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", ...extra };
    if (this.token) h["X-Collector-Token"] = this.token;
    else if (this.csrf) h["X-CSRF-Token"] = this.csrf;
    return h;
  }

  async login(): Promise<void> {
    if (this.token || this.loggedIn) return;
    if (!this.user || !this.password) throw new Error("Sin credenciales SaaS.");
    const r = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: this.user, password: this.password }),
      credentials: "include",
    });
    if (!r.ok) throw new Error(`login failed: ${r.status}`);
    const data = await r.json();
    this.csrf = data.csrf_token ?? null;
    this.loggedIn = true;
  }

  private async post(path: string, payload: unknown, retries = 3): Promise<unknown> {
    await this.login();
    const url = `${this.baseUrl}${path}`;
    let lastErr: unknown = null;
    for (let i = 0; i < retries; i++) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { ...this.headers(), "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        if ((r.status === 401 || r.status === 419) && !this.token) {
          this.loggedIn = false;
          this.csrf = null;
          await this.login();
          continue;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.status === 204 ? {} : await r.json();
      } catch (e) {
        lastErr = e;
        await new Promise((res) => setTimeout(res, Math.min(4000, 500 * 2 ** i)));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  async postTrap(alarm: Alarm): Promise<unknown> {
    return this.post("/api/v1/traps", {
      source_ip: alarm.sourceIp,
      trap_oid: alarm.trapOid,
      severity: alarm.severity,
      type: alarm.type,
      description: alarm.description,
      received_at: alarm.receivedAt,
    });
  }

  async postSnapshot(result: PollResult): Promise<unknown> {
    return this.post("/api/v1/collector/snapshot", {
      olt_id: result.oltId,
      poll_result: result,
    });
  }

  async postAlarms(alarms: Alarm[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for (const a of alarms) out.push(await this.postTrap(a));
    return out;
  }
}
