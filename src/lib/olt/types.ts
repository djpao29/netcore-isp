// Tipos normalizados del colector on-prem (mirror del colector Python y del SaaS PHP).

export type SnmpVersion = "v1" | "v2c" | "v3";

export interface V3Creds {
  username: string;
  authProtocol: "md5" | "sha" | "sha224" | "sha256" | "sha384" | "sha512" | "none";
  authKey: string;
  privProtocol: "none" | "des" | "3des" | "aes" | "aes128" | "aes192" | "aes256";
  privKey: string;
  securityLevel: "noAuthNoPriv" | "authNoPriv" | "authPriv";
  contextName?: string;
  engineId?: string;
}

export interface OltTarget {
  id: number;
  name: string;
  ipAddress: string;
  snmpVersion: SnmpVersion;
  snmpPort: number;
  community: string;
  rwCommunity?: string;
  v3: V3Creds;
  profileId: string;
  setAllowed: boolean;
  pollEnabled: boolean;
}

export interface Olt {
  id?: number;
  name: string;
  ipAddress: string;
  snmpVersion: SnmpVersion;
  snmpPort: number;
  status: string;
  uptimeSeconds?: number;
  sysDescr?: string;
  sysName?: string;
  sysLocation?: string;
  lastPollAt?: string;
  lastError?: string;
}

export interface PonPort {
  oltId?: number;
  portIndex: number;
  name?: string;
  adminState: string;
  operState: string;
  txPowerDbm?: number | null;
  rxPowerDbm?: number | null;
  biasCurrentMa?: number | null;
  temperatureC?: number | null;
  onuCount: number;
  lastPollAt?: string;
}

export interface Onu {
  oltId?: number;
  ponPort?: number | null;
  index: string;
  serial: string;
  mac: string;
  model?: string;
  adminState: string;
  operState: string;
  rxPowerDbm?: number | null;
  txPowerDbm?: number | null;
  distanceM?: number | null;
  lastDownCause?: string;
  lastSeen?: string;
}

export type AlarmSeverity = "critical" | "major" | "minor" | "warning" | "info";

export interface Alarm {
  oltId?: number | null;
  oltName: string;
  sourceIp: string;
  severity: AlarmSeverity;
  type: string;
  description: string;
  trapOid: string;
  receivedAt: string;
  status: string;
}

export interface PollResult {
  oltId?: number | null;
  oltName: string;
  startedAt: string;
  finishedAt?: string;
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
  attempts: number;
  ponPorts: PonPort[];
  onus: Onu[];
  alarms: Alarm[];
  raw: Record<string, unknown>;
}

export interface DeviceProfile {
  id: string;
  vendor: string;
  model: string;
  deviceType: string;
  transport: {
    defaultPort: number;
    supportedVersions: string[];
    defaultVersion: string;
    defaultSecurityLevel: string;
    defaultTimeoutSeconds: number;
    defaultRetries: number;
  };
  setEnabledByDefault: boolean;
  oids: Record<string, Record<string, string>>;
  walks: Record<string, string>;
  alarmOidMap: Record<string, { type: string; severity: string; class?: string }>;
  valueMaps: Record<string, unknown>;
  units: Record<string, string>;
}

export function isTodo(value: unknown): value is string {
  return typeof value === "string" && value.trim().toUpperCase().startsWith("TODO");
}
