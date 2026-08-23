import axios from 'axios';
import {MyUplinkApiFetcher} from '../src/platform/myuplink/MyUplinkApiFetcher';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MyUplinkApiFetcher reset retry behavior', () => {
  test('retries system-level reset when device-level reset returns 404', async () => {
    const systemId = 'system-1';
    const deviceId = 'device-1';
    const notificationId = 'notif-1';

    // first call: device-level reset -> 404
    const axios404 = {
      response: {
        status: 404,
        statusText: 'Not Found',
        data: {},
      },
    };

    // second call: system-level reset -> success
    const success = { data: { status: 200 } };

    mockedAxios.post.mockRejectedValueOnce(axios404 as any).mockResolvedValueOnce(success as any);

    const options = {
      clientId: 'cid',
      clientSecret: 'secret',
      interval: 60,
      language: 'en-US',
      showApiResponse: false,
    } as any;

    const log = { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as any;

    const fetcher = new MyUplinkApiFetcher(options, log);

    const result = await fetcher.resetNotification(systemId, deviceId, notificationId);

    expect(result).toEqual(success.data);

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    const firstCall = mockedAxios.post.mock.calls[0][0];
    const secondCall = mockedAxios.post.mock.calls[1][0];

    expect(firstCall).toBe(`/v2/devices/${deviceId}/notifications/${notificationId}/reset`);
    expect(secondCall).toBe(`/v2/systems/${systemId}/notifications/${notificationId}/reset`);
  });
});
