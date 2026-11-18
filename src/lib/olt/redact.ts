// Redaccion de secretos en logs/texto (mirror del colector Python).
const MASK = "***REDACTED***";

const SENSITIVE_KEYS = new Set([
  "community", "communitystring", "snmp_community", "snmp_rw", "snmp_ro_community",
  "authkey", "auth_key", "privkey", "priv_key", "password", "pass", "authpass",
  "privpass", "token", "csrftoken", "secret", "authorization", "cookie",
]);

const SENSITIVE_PATTERN = new RegExp(
  "(?i)([\"']?(?:" +
    ["community", "communitystring", "snmp_community", "snmp_ro_community", "snmp_rw",
     "authkey", "auth_key", "privkey", "priv_key", "password", "passwd", "authpass",
     "privpass", "token", "secret", "authorization", "x-collector-token", "csrf_token"]
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
    ")[\"']?)\\s*[:=]\\s*([\"']?)([^\"',\\s}\\]]+)\\2",
  "g",
);

export function redactText(text: string, secrets: string[] = []): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 3 && !["public", "private", "admin", "none"].includes(s.toLowerCase())) {
      out = out.split(s).join(MASK);
    }
  }
  out = out.replace(SENSITIVE_PATTERN, (_m, key, q) => `${key}=${q}${MASK}${q}`);
  return out;
}

export function redactAny(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((v) => redactAny(v, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) out[k] = MASK;
      else out[k] = redactAny(v, secrets);
    }
    return out;
  }
  return value;
}
