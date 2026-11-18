export interface ApiListResponse<T = any> {
  status: string;
  module: any;
  total: number;
  grand_total: number;
  rows: T[];
  message?: string;
}

async function request<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = { status: 'error', message: `Respuesta no válida del servidor (HTTP ${res.status}).` };
  }
  if (!res.ok && json && !json.message) {
    json = { ...json, status: 'error', message: `Error HTTP ${res.status}.` };
  }
  return json as T;
}

export const api = {
  get: <T = any>(url: string) => request<T>(url),
  post: <T = any>(url: string, body?: any) =>
    request<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  put: <T = any>(url: string, body?: any) =>
    request<T>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
  del: <T = any>(url: string) => request<T>(url, { method: 'DELETE' }),
  bootstrap: (ispId = 1) => request<any>(`/api/v1/bootstrap?isp_id=${ispId}`),
  list: (moduleKey: string, params?: Record<string, string>) => {
    const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params).toString()}` : '';
    return request<ApiListResponse>(`/api/v1/data/${moduleKey}${qs}`);
  },
  create: (moduleKey: string, body: any) => request(`/api/v1/data/${moduleKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  update: (moduleKey: string, id: number | string, body: any) =>
    request(`/api/v1/data/${moduleKey}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  remove: (moduleKey: string, id: number | string) => request(`/api/v1/data/${moduleKey}/${id}`, { method: 'DELETE' }),
  bulk: (moduleKey: string, action: string, ids: Array<number | string>, payload?: any) =>
    request(`/api/v1/data/${moduleKey}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids, payload }),
    }),
  financeSummary: () => request<{ status: string; summary: any }>('/api/v1/finance/summary'),
  customerStats: () => request<{ status: string } & Record<string, any>>('/api/v1/customer-stats'),
  routerTool: (id: number | string, tool: string) => request(`/api/v1/routers/${id}/tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool }),
  }),
  routerTest: (id: number | string) => request(`/api/v1/routers/${id}/test`, { method: 'POST' }),
  replyTicket: (id: number | string, body: any) => request(`/api/v1/data/tickets/${id}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  saveIsp: (id: number, body: any) => request(`/api/v1/isps/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  cron: (command: string) => request('/api/v1/cron/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command }),
  }),
  reviewProof: (id: number, decision: string) => request(`/api/v1/payment-proofs/${id}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  }),
  toggleCustomer: (id: number) => request(`/api/v1/customers/${id}/toggle-status`, { method: 'POST' }),
  oltTest: (id: number | string) => request(`/api/v1/olts/${id}/test`, { method: 'POST' }),
  oltSync: (id: number | string) => request(`/api/v1/olts/${id}/sync`, { method: 'POST' }),
  oltCommand: (id: number | string, command: string, prompt?: string) => request(`/api/v1/olts/${id}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, prompt }),
  }),
  generateHotspotCards: (form: any) => request(`/api/v1/hotspot/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  }),
};

export function formatMoney(value: unknown, symbol = '$') {
  const n = Number(value) || 0;
  return `${symbol}${n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function toCsv(rows: any[], columns: Array<{ name: string; label: string }>): string {
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => columns.map((c) => escape(row[c.name])).join(',')).join('\n');
  return `${header}\n${body}`;
}

export function downloadText(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\uFEFF' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
