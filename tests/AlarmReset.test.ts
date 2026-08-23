import {MyUplinkApiFetcher} from '../src/platform/myuplink/MyUplinkApiFetcher';

describe('MyUplinkApiFetcher auto reset logic', () => {
  const buildAlarm = (id: string, alarmNumber: number, status: 'Active' | 'None' | 'DismissedByDevice' | 'ResetByUserOnDevice' | 'ResetByUserFromCloud' | 'Unknown' = 'Active') => ({
    id,
    alarmNumber,
    deviceId: 'device-1',
    severity: 1,
    status,
    header: 'Short operating times for compr.',
  });

  test('allows one reset attempt for active alarm 229 and blocks further retries after the limit', () => {
    const state = new Map<string, { alarmNumber: number; attempts: number; lastAttemptTime: number }>();

    expect(MyUplinkApiFetcher.shouldAttemptAlarmReset(buildAlarm('a1', 229), state)).toBeTruthy();

    state.set('a1', { alarmNumber: 229, attempts: 1, lastAttemptTime: Date.now() });
    expect(MyUplinkApiFetcher.shouldAttemptAlarmReset(buildAlarm('a1', 229), state)).toBeFalsy();

    state.set('a1', { alarmNumber: 229, attempts: 2, lastAttemptTime: Date.now() });
    expect(MyUplinkApiFetcher.shouldAttemptAlarmReset(buildAlarm('a1', 229), state)).toBeFalsy();

    expect(MyUplinkApiFetcher.shouldAttemptAlarmReset(buildAlarm('a2', 111), state)).toBeFalsy();
    expect(MyUplinkApiFetcher.shouldAttemptAlarmReset(buildAlarm('a3', 229, 'None'), state)).toBeFalsy();
  });
});
