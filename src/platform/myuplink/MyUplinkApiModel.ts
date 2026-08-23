export interface Session {
    token_type?: string;
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
}

export interface SystemMeResponse {
    page: number;
    itemsPerPage: number;
    numItems: number;
    systems: System[];
}

export interface System {
    systemId: string;
    name: string;
    country: string;
    devices: Device[];
}

export interface Device {
    id: string;
    connectionState: string;
    product: Product;
}

export interface DeviceInfo {
    id: string;
    connectionState: string;
    firmware: {
        currentFwVersion: string,
        desiredFwVersion: string
    },
}

export interface Subscriptions {
    subscriptions: [
        {
            validUntil: string,
            type: string
        }
    ]
}

export type AlarmStatusType = 'None' | 'Active' | 'DismissedByDevice' | 'ResetByUserOnDevice' | 'ResetByUserFromCloud' | 'Unknown';

export interface AlarmStatus {
    status: AlarmStatusType;
    datetime: number;
}

export interface Alarm {
    id: string;
    alarmNumber: number;
    deviceId?: string | null;
    severity: number;
    status: AlarmStatusType;
    createdDatetime?: string | null;
    statusHistory?: AlarmStatus[] | null;
    header?: string | null;
    description?: string | null;
    equipName?: string | null;
}

export interface AlarmsPaged {
    page: number;
    itemsPerPage: number;
    numItems: number;
    notifications?: Alarm[] | null;
}

export interface CloudToDeviceMethodResult {
    status?: number;
    payload?: unknown;
}

export interface Product {
    name: string;
    serialNumber: string;
}

export interface Parameter {
    parameterId: string,
    parameterName: string,
    parameterUnit: string,
    writable: boolean,
    value: number,
    minValue?: number,
    maxValue?: number,
    stepValue?: number,
    enumValues?: [
        {
            value: string;
            text: string;
        }
    ],
}
