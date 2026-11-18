// Helpers de perfil (mirror del colector Python). Sin dependencia de JSON en runtime.
import type { DeviceProfile } from "./types";
import { isTodo } from "./types";

export function availableOids(profile: DeviceProfile): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [group, items] of Object.entries(profile.oids)) {
    const grp: Record<string, string> = {};
    for (const [k, v] of Object.entries(items)) {
      if (!isTodo(v)) grp[k] = v;
    }
    if (Object.keys(grp).length > 0) out[group] = grp;
  }
  return out;
}

export function todoOids(profile: DeviceProfile): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [group, items] of Object.entries(profile.oids)) {
    for (const [k, v] of Object.entries(items)) {
      if (isTodo(v)) out.push([`${group}.${k}`, v]);
    }
  }
  return out;
}

export function resolveOid(profile: DeviceProfile, ...path: string[]): string | null {
  let node: unknown = profile.oids;
  for (const p of path) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    const rec = node as Record<string, unknown>;
    if (!(p in rec)) return null;
    node = rec[p];
  }
  if (isTodo(node)) return null;
  return typeof node === "string" ? node : null;
}

export function alarmForOid(profile: DeviceProfile, oid: string): { type: string; severity: string } | null {
  const m = profile.alarmOidMap[oid];
  if (!m) return null;
  return { type: m.type, severity: m.severity };
}

export function walkBase(profile: DeviceProfile, name: string): string | null {
  const v = profile.walks[name];
  if (isTodo(v)) return null;
  return typeof v === "string" ? v : null;
}
