import axios, {AxiosError} from 'axios';
import {EventEmitter} from 'events';
import * as dataDomain from '../DataDomain';
import {Data, DataFetcher} from '../DataDomain';
import {Logger} from '../PlatformDomain';
import * as api from './MyUplinkApiModel';
import {Cache} from '../util/Cache';
import moment from 'moment';

interface Options {
    clientId: string;
    clientSecret: string;
    interval: number;
    language: string;
    showApiResponse: boolean;
}

interface Session extends api.Session {
    expires_at?: number;
}

const consts = {
  baseUrl: 'https://api.myuplink.com',
  scope: 'READSYSTEM WRITESYSTEM',
  grantType: 'client_credentials',
  timeout: 45000,
  userAgent: 'homebridge-nibe',
  renewBeforeExpiry: 5 * 60 * 1000,
  alarmResetCooldownMs: 60 * 1000,
  maxAlarmResetAttempts: 2,
  allowedParameters: [40067,40004,44362,40013,40014,40008,40025,40026,40075,40183,48132,43437],
};

export class MyUplinkApiFetcher extends EventEmitter implements DataFetcher {
  private options: Options;
  private log: Logger;
  private interval: NodeJS.Timeout | null | undefined;
  private active: boolean | undefined;
  private systems: api.System[] | null | undefined;
  private auth: Session | null | undefined;
  private cache: Cache = new Cache();
  private currentlySetting: [] = [];
  private alarmResetState: Map<string, { alarmNumber: number; attempts: number; lastAttemptTime: number }>; 

  constructor(options: Options, log: Logger) {
    super();

    this.options = options;
    this.log = log;
    this.alarmResetState = new Map();

    axios.defaults.baseURL = consts.baseUrl;
    axios.defaults.headers.common['user-agent'] = consts.userAgent;
    axios.defaults.timeout = consts.timeout;
  }

  start(): void {
    if (this.interval != null) {
      return;
    }

    this.active = false;

    const exec = (): void => {
      if (this.active) {
        return;
      }
      this.active = true;
      this.fetch().then(() => {
        this.active = false;
      });
    };
    this.interval = setInterval(exec, <number>this.options.interval * 1000);

    exec();
  }

  stop(): void {
    if (this.interval == null) {
      return;
    }
    clearInterval(this.interval);
    this.interval = null;
  }

  private async fetch(): Promise<void> {
    this.log.debug('Fetch data.');
    try {
      if (this.isTokenExpired()) {
        this.log.debug('Token is expired / expires soon - refreshing');
        const token = await this.getToken();
        this.setSession(token);
      }

      if (this.systems == null) {
        this.systems = await this.fetchSystems();
      }

      for (const system of this.systems) {
        const subscriptions = await this.fetchPremiumSubscriptions(system.systemId);
        try {
          await this.getActiveNotifications(system.systemId);
        } catch (error) {
          this.log.error('Error fetching active notifications:', error);
        }

        for (const device of system.devices) {
          const deviceInfo = await this.fetchDeviceInfo(device.id);
          try {
            const parameters = await this.fetchData(device);

            const data = MyUplinkApiFetcher.mapData(system, subscriptions, device, deviceInfo, parameters);
            if (data) {
              this.log.debug(`Prepared data:\n${JSON.stringify(data)}`);
              this._onData(data);
            }
          } catch (error) {
            this._onError(error);
          }
        }
      }

      this.log.debug('All data fetched.');
    } catch (error) {
      this._onError(error);
    }
  }

  private async getToken(): Promise<Session> {
    this.log.debug('token()');
    const body = {
      client_id: this.options.clientId,
      client_secret: this.options.clientSecret,
      grant_type: consts.grantType,
      scope: consts.scope,
    };

    const url = '/oauth/token';
    try {
      const now = Date.now();
      const { data } = await axios.post<Session>(
        url, new URLSearchParams(body).toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if(this.options.showApiResponse) {
        this.log.info('Nibe data from '+url+': ' +JSON.stringify(data));
      }

      const expiresIn = data.expires_in ?? 3600;
      data.expires_at = now + expiresIn * 1000;
      return data;
    } catch (error) {
      throw this.checkError(url, error);
    }
  }

  private async fetchSystems(): Promise<api.System[]> {
    this.log.debug('Fetch units.');
    const response = await this.cache.get<api.SystemMeResponse>(
      '/v2/systems/me',
      30,
      'MINUTES',
      async () => {
        return await this.getFromMyUplink<api.SystemMeResponse>('/v2/systems/me');
      },
    );

    this.log.debug(`${response.systems.length} units fetched.`);

    return response.systems;
  }

  private async fetchDeviceInfo(id): Promise<api.DeviceInfo> {
    this.log.debug('Fetch device info.');
    return await this.getFromMyUplink<api.DeviceInfo>(`/v2/devices/${id}`);
  }

  private async fetchPremiumSubscriptions(id): Promise<string[]> {
    this.log.debug('Fetch premium subscriptions info.');
    const response = await this.cache.get<api.Subscriptions>(
      `/v2/systems/${id}/subscriptions`,
      10,
      'MINUTES',
      async () => {
        return await this.getFromMyUplink<api.Subscriptions>(`/v2/systems/${id}/subscriptions`);
      },
    );

    if (!response) {
      return [];
    }

    return response.subscriptions
      .filter(s => moment(s.validUntil).isAfter(moment()))
      .map(s => s.type);
  }

  public static shouldAttemptAlarmReset(
    notification: Pick<api.Alarm, 'id' | 'alarmNumber' | 'status'> | null | undefined,
    state: Map<string, { alarmNumber: number; attempts: number; lastAttemptTime: number }>,
  ): boolean {
    if (notification == null || notification.id == null || notification.id === '') {
      return false;
    }

    if (notification.status !== 'Active' || notification.alarmNumber !== 229) {
      return false;
    }

    const current = state.get(notification.id) ?? { alarmNumber: notification.alarmNumber, attempts: 0, lastAttemptTime: 0 };
    if (current.attempts >= consts.maxAlarmResetAttempts) {
      return false;
    }

    if (current.lastAttemptTime > 0 && Date.now() - current.lastAttemptTime < consts.alarmResetCooldownMs) {
      return false;
    }

    return true;
  }

  public async getActiveNotifications(systemId: string): Promise<api.AlarmsPaged> {
    const response = await this.getFromMyUplink<api.AlarmsPaged>(
      `/v2/systems/${systemId}/notifications/active`, {
        itemsPerPage: 100,
      }, {
        'Accept-Language': this.options.language || 'en-US',
      },
    );

    const notifications = response.notifications || [];
    this.log.debug(`Fetch active notifications. ${notifications.length} active notifications fetched.`);

    await this.processAlarmReset(systemId, notifications);

    return response;
  }

  private async processAlarmReset(systemId: string, notifications: api.Alarm[]): Promise<void> {
    for (const notification of notifications) {
      if (!this.shouldAttemptAlarmResetWithLog(notification, this.alarmResetState)) {
        continue;
      }

      if (notification.id == null || notification.id === '' || notification.deviceId == null || notification.deviceId === '') {
        continue;
      }

      this.log.info(`Nibe active alarm 229 detected: ${notification.header || 'Short operating times for compr.'}`);
      this.log.info(`Nibe alarm 229 notification ID: ${notification.id}`);

      const current = this.alarmResetState.get(notification.id) ?? { alarmNumber: notification.alarmNumber, attempts: 0, lastAttemptTime: 0 };
      current.alarmNumber = notification.alarmNumber;
      current.attempts += 1;
      current.lastAttemptTime = Date.now();
      this.alarmResetState.set(notification.id, current);

      try {
        this.log.info('Attempting automatic reset of Nibe alarm 229.');
        await this.resetNotification(systemId, notification.deviceId, notification.id);
        this.log.info('Nibe alarm 229 reset request succeeded.');

        const refreshed = await this.getFromMyUplink<api.AlarmsPaged>(
          `/v2/systems/${systemId}/notifications/active`, {
            itemsPerPage: 100,
          }, {
            'Accept-Language': this.options.language || 'en-US',
          },
        );

        const refreshedNotification = (refreshed.notifications || []).find(
          n => n.id === notification.id && n.alarmNumber === 229 && n.status === 'Active',
        );

        if (refreshedNotification == null) {
          this.alarmResetState.delete(notification.id);
          this.log.info('Nibe alarm 229 reset confirmed.');
          continue;
        }

        if (current.attempts >= consts.maxAlarmResetAttempts) {
          this.log.info('Nibe alarm 229 reset retry limit reached.');
          this.log.info('Nibe alarm 229 cannot be reset because the API rejected further attempts.');
          continue;
        }

        this.log.info('Nibe alarm 229 remains active after reset attempt.');
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.log.info(`Nibe alarm 229 reset attempt failed: ${reason}`);

        const latest = this.alarmResetState.get(notification.id);
        if (latest && latest.attempts >= consts.maxAlarmResetAttempts) {
          this.log.info('Nibe alarm 229 cannot be reset because the API rejected further attempts.');
        }
      }
    }
  }

  private shouldAttemptAlarmResetWithLog(
    notification: Pick<api.Alarm, 'id' | 'alarmNumber' | 'status' | 'deviceId'> | null | undefined,
    state: Map<string, { alarmNumber: number; attempts: number; lastAttemptTime: number }>,
  ): boolean {
    const ok = MyUplinkApiFetcher.shouldAttemptAlarmReset(notification, state);
    if (ok) {
      return true;
    }

    const id = notification?.id ?? '<missing>';
    if (notification == null || notification.id == null || notification.id === '') {
      this.log.debug(`Skipping reset for notification ${id}: missing id or notification is null`);
      return false;
    }

    if (notification.status !== 'Active' || notification.alarmNumber !== 229) {
      this.log.debug(`Skipping reset for notification ${id}: status=${notification.status} alarmNumber=${notification.alarmNumber}`);
      return false;
    }

    const current = state.get(notification.id) ?? { alarmNumber: notification.alarmNumber, attempts: 0, lastAttemptTime: 0 };
    if (current.attempts >= consts.maxAlarmResetAttempts) {
      this.log.debug(`Skipping reset for notification ${id}: attempts=${current.attempts} >= max=${consts.maxAlarmResetAttempts}`);
      return false;
    }

    if (current.lastAttemptTime > 0 && Date.now() - current.lastAttemptTime < consts.alarmResetCooldownMs) {
      this.log.debug(`Skipping reset for notification ${id}: cooldown active (${Date.now() - current.lastAttemptTime}ms < ${consts.alarmResetCooldownMs}ms)`);
      return false;
    }

    this.log.debug(`Skipping reset for notification ${id}: unknown reason`);
    return false;
  }

  public async resetNotification(systemId: string, deviceId: string, notificationId: string): Promise<api.CloudToDeviceMethodResult> {
    const deviceUrl = `/v2/devices/${deviceId}/notifications/${notificationId}/reset`;
    this.log.debug(`Attempting device-level reset: ${deviceUrl}`);
    try {
      return await this.postToMyUplink<api.CloudToDeviceMethodResult>(deviceUrl, {});
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // If the API returned a structured error body, log all available fields for debugging.
      if (axios.isAxiosError(error) && (error as any).response && (error as any).response.data) {
        const resp = (error as any).response;
        const body = resp.data;
        try {
          this.log.error(`Reset notification error response for ${notificationId}: ${JSON.stringify(body, null, 2)}`);
        } catch (e) {
          this.log.error(`Reset notification error response for ${notificationId}: <unserializable>`);
        }

        const httpStatusCode = body?.httpStatusCode ?? resp.status;
        const errorCode = body?.errorCode ?? '';
        const timestamp = body?.timestamp ?? '';
        const details = Array.isArray(body?.details) ? body.details : [];
        const dataObj = body?.data ?? {};

        this.log.error(`HTTP status: ${httpStatusCode}, errorCode: ${errorCode}, timestamp: ${timestamp}`);

        if (details.length > 0) {
          details.forEach((d: any, i: number) => this.log.error(`detail[${i}]: ${d}`));
        }

        if (dataObj && typeof dataObj === 'object' && Object.keys(dataObj).length > 0) {
          for (const k of Object.keys(dataObj)) {
            this.log.error(`data.${k}: ${String((dataObj as any)[k])}`);
          }
        }
      }

      const isNotFound = msg.includes('Not Found') || (
        error && typeof error === 'object' && (error as any).response && (error as any).response.status === 404
      );
      if (isNotFound) {
        const multiDeviceUrl = `/v2/devices/notifications/${notificationId}/reset`;
        this.log.info(`Device-level reset returned 404, retrying multidevice reset: ${multiDeviceUrl}`);
        this.log.debug(`Retrying system-level reset: ${multiDeviceUrl}`);
        return await this.postToMyUplink<api.CloudToDeviceMethodResult>(multiDeviceUrl, {});
      }
      this.log.error(`Reset notification failed for ${notificationId}: ${msg}`);
      throw error;
    }
  }

  private async postToMyUplink<T>(url: string, body: object = {}, headers: object = {}): Promise<T> {
    this.log.debug(`POST ${url}, body: ${JSON.stringify(body)}`);
    try {
      const { data } = await axios.post<T>(url, body, {
        headers: {
          Authorization: 'Bearer ' + this.getSession('access_token'),
          ...headers,
        },
      });

      if (this.options.showApiResponse) {
        this.log.info('Nibe data from ' + url + ': ' + JSON.stringify(data));
      }

      return data;
    } catch (error) {
      throw this.checkError(url, error);
    }
  }

  private async fetchData(device: api.Device): Promise<api.Parameter[]> {
    this.log.debug('Fetch units.');
    const response = await this.getFromMyUplink<api.Parameter[]>(
      `/v2/devices/${device.id}/points`, {
        parameters: consts.allowedParameters.join(','),
      },
    );
    this.log.debug(`${response.length} parameters fetched.`);
    return response;
  }

  static mapData(system: api.System, subscriptions: string[], device: api.Device, deviceInfo: api.DeviceInfo, response: api.Parameter[]): Data {
    return {
      system: {
        systemId: system.systemId,
        name: system.name,
        premiumSubscriptions: subscriptions,
      },
      device: {
        id: device.id,
        name: device.product.name,
        serialNumber: device.product.serialNumber,
        firmwareUpdateAvailable: deviceInfo.firmware?.currentFwVersion !== deviceInfo.firmware?.desiredFwVersion,
      },
      parameters: response.map(p => {
        return {
          id: p.parameterId,
          name: p.parameterName,
          unit: p.parameterUnit,
          value: p.value,
        };
      }),
    };
  }

  private async getFromMyUplink<T>(url: string, params: object = {}, headers: object = {}): Promise<T> {
    this.log.debug(`GET ${url}, params: ${JSON.stringify(params)}`);
    try {
      const { data } = await axios.get<T>(url, {
        headers: {
          Authorization: 'Bearer ' + this.getSession('access_token'),
          ...headers,
        },
        params,
      });

      if(this.options.showApiResponse) {
        this.log.info('Nibe data from '+url+': ' +JSON.stringify(data));
      }

      return data;
    } catch (error) {
      throw this.checkError(url, error);
    }
  }

  public async setValue(deviceId: string, paramId: string, value: any): Promise<void> {
    const key = deviceId+paramId+JSON.stringify(value);
    if (this.currentlySetting[key]) {
      return;
    }
    this.active = true;
    this.currentlySetting[key] = true;
    const url = `/v2/devices/${deviceId}/points`;
    const body = {};
    body[paramId] = value;
    this.log.debug(`PUT ${url}, params: ${JSON.stringify(body)}`);
    try {
      axios.patch(url, body, {
        headers: {
          Authorization: 'Bearer ' + this.getSession('access_token'),
        },
      }).then(result => {
        if(this.options.showApiResponse) {
          this.log.info('Nibe data from '+url+': ' +JSON.stringify(result.data));
        }
      }).finally(() => {
        delete this.currentlySetting[key];
        this.active = false;
        this.fetch();
      });

    } catch (error) {
      this.log.error(`error from ${url}: ${JSON.stringify(error)}`);
    }
  }

  private checkError(url: string, error: unknown): unknown {
    this.log.error(`error from ${url}`);
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response != null) {
        if (axiosError.response.status === 401) {
          this.clearSession();
        }
        const respData = axiosError.response.data != null ? JSON.stringify(axiosError.response.data, null, ' ') : null;
        const statusText = axiosError.response.statusText || String(axiosError.response.status);
        if (respData) {
          this.log.debug(`Response data from ${url}: ${respData}`);
          const errorMessage = `${statusText}: ${respData}`;
          return new Error(errorMessage);
        } else {
          return new Error(statusText);
        }
      }
    }
    return error;
  }

  private getSession(key: keyof Session): string | number | undefined | null {
    this.log.debug('Get session.');
    return this.auth ? this.auth[key] : null;
  }

  private setSession(auth: Session): void {
    this.log.debug('Set session.');
    this.auth = auth;
  }

  private clearSession(): void {
    this.log.debug('Clear session.');
    this.setSession({});
  }

  private isTokenExpired(): boolean {
    const expired = (Number(this.getSession('expires_at')) || 0) < Date.now() + consts.renewBeforeExpiry;
    this.log.debug('Is token expired: ' + expired);
    return expired;
  }

  private _onData(data: dataDomain.Data): void {
    this.emit('data', data);
  }

  private _onError(error: unknown): void {
    this.emit('error', error);
  }

}
