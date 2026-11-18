export interface FreeRadiusConfig {
  baseUrl: string;
  username: string;
  password: string;
  database: string;
  timeout: number;
}

export interface FreeRadiusSession {
  username: string;
  nasIp: string;
  framedIp: string;
  nasPort: string;
  calledStationId: string;
  callingStationId: string;
  connectInfo: string;
  sessionTime: number;
  inputOctets: number;
  outputOctets: number;
}

export interface FreeRadiusStats {
  total_users: number;
  total_traffic_gb: number;
  active_sessions: number;
  uptime_seconds: number;
}

export class FreeRadiusDriver {
  private baseUrl: string;
  private username: string;
  private password: string;
  private timeout: number;

  constructor(config: FreeRadiusConfig) {
    this.baseUrl = config.baseUrl;
    this.username = config.username;
    this.password = config.password;
    this.timeout = config.timeout || 10000;
  }

  private getAuthHeader(): string {
    return 'Basic ' + btoa(this.username + ':' + this.password);
  }

  private async request(method: string, endpoint: string, body?: any): Promise<any> {
    const url = this.baseUrl + endpoint;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': this.getAuthHeader(),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`FreeRADIUS API error (${response.status}): ${errorText}`);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('FreeRADIUS request timeout');
      }
      throw error;
    }
  }

  async testConnection(): Promise<{ ok: boolean; message: string; data?: any }> {
    try {
      const result = await this.request('GET', '/api/health');
      return { ok: true, message: 'FreeRADIUS API conectado', data: result };
    } catch (error: any) {
      return { ok: false, message: error.message };
    }
  }

  async getActiveSessions(filters: Record<string, string> = {}): Promise<FreeRadiusSession[]> {
    const query = new URLSearchParams(filters).toString();
    const endpoint = '/api/radacct/active' + (query ? '?' + query : '');
    return await this.request('GET', endpoint);
  }

  async disconnectSession(username: string, nasIp: string = ''): Promise<boolean> {
    const body: any = { username };
    if (nasIp) body.nas_ip = nasIp;
    await this.request('POST', '/api/coa/disconnect', body);
    return true;
  }

  async getGlobalStats(): Promise<FreeRadiusStats> {
    return await this.request('GET', '/api/stats/global');
  }

  async getUserStats(username: string, period: string = 'month'): Promise<any> {
    const query = new URLSearchParams({ period }).toString();
    return await this.request('GET', `/api/stats/user/${username}?${query}`);
  }
}

export class FreeRadiusProvider {
  static make(): FreeRadiusDriver {
    const config = {
      baseUrl: process.env.FREERADIUS_BASE_URL || 'http://localhost:3000',
      username: process.env.FREERADIUS_USERNAME || 'admin',
      password: process.env.FREERADIUS_PASSWORD || '',
      database: process.env.FREERADIUS_DATABASE || 'radius',
      timeout: parseInt(process.env.FREERADIUS_TIMEOUT || '10000', 10),
    };

    if (!config.username || !config.password) {
      throw new Error(
        'FreeRADIUS no configurado. Defina FREERADIUS_USERNAME y FREERADIUS_PASSWORD en .env'
      );
    }

    return new FreeRadiusDriver(config);
  }
}

export interface FreeRadiusConfig {
  baseUrl: string;
  username: string;
  password: string;
  database: string;
  timeout: number;
}