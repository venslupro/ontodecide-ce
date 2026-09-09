/**
 * Typed API transport tests.
 *
 * Mocks the global {@code fetch} and verifies the four most-important
 * transport behaviors:
 *   (a) JSON body + no Bearer header when no session accessor is set,
 *   (b) Bearer header appears once a session accessor is registered,
 *   (c) 4xx JSON errors normalize to ApiResponse.success=false with the
 *       server-provided error.code,
 *   (d) thrown network failures surface as a NETWORK error code.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  httpPost,
  setSessionAccessor,
  sessionAccessorRef,
} from '../src/services/api/client';

describe('api client transport', () => {
  let originalFetch: typeof globalThis.fetch;
  let mockedFetch: ReturnType<typeof vi.fn>;
  let previousAccessor: typeof sessionAccessorRef.current;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockedFetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = mockedFetch;
    previousAccessor = sessionAccessorRef.current;
    sessionAccessorRef.current = null;
  });

  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = originalFetch;
    sessionAccessorRef.current = previousAccessor;
    vi.clearAllMocks();
  });

  function mockResponse(init: {
    status: number;
    statusText?: string;
    body: unknown;
  }): ReturnType<typeof vi.fn> {
    return mockedFetch.mockResolvedValueOnce({
      ok: init.status >= 200 && init.status < 300,
      status: init.status,
      statusText: init.statusText ?? '',
      text: async () =>
        init.body === undefined ? '' : JSON.stringify(init.body),
    } as unknown as Response);
  }

  it('(a) login POST sends JSON body and omits Authorization without a session', async () => {
    mockResponse({
      status: 200,
      body: { success: true, data: { accessToken: 'x' } },
    });
    const body = { username: 'alice', password: 'pw' };
    const result = await httpPost<{ accessToken: string }>(
      '/api/auth/login',
      body,
    );
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockedFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/api/auth/login');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeDefined();
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify(body));
    expect(result.success).toBe(true);
    expect(result.data?.accessToken).toBe('x');
  });

  it('(b) sends the Bearer header once a session accessor is registered', async () => {
    mockResponse({
      status: 200,
      body: { success: true, data: { id: 'u1' } },
    });
    setSessionAccessor(() => ({ tokens: { accessToken: 'token-1' } }));
    await httpPost<{ id: string }>('/api/user/profile', undefined);
    const [, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
  });

  it('(c) 401 JSON error maps to ApiResponse.success=false with server code', async () => {
    mockResponse({
      status: 401,
      body: {
        error: {
          code: 'AUTH_INVALID_CREDENTIALS',
          message: 'Invalid credentials.',
        },
      },
    });
    const result = await httpPost<unknown>('/api/auth/login', {
      username: 'x',
      password: 'y',
    });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(result.error?.message).toBe('Invalid credentials.');
  });

  it('(d) network throw returns ApiResponse.error.code === NETWORK', async () => {
    mockedFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const result = await httpPost<unknown>(
      '/api/auth/login',
      {},
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NETWORK');
    expect(result.error?.message).toMatch(/Unable to reach the server/);
  });
});
