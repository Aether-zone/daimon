import { afterEach, describe, expect, it, vi } from 'vitest';

import { classify, createApiClient, type TargetResolver } from './api.js';

const resolver: TargetResolver = async (path) => ({
  ok: true,
  url: `https://api.test${path}`,
  accessToken: 'token-123',
});

/** Stands in for global fetch, one queued response at a time. */
function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn();

  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response);
  }

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('classify', () => {
  it.each([
    [401, 'unauthenticated'],
    [403, 'forbidden'],
    [404, 'notFound'],
    // A malformed id and a real miss are the same thing to a caller: there is
    // nothing to act on either way.
    [400, 'notFound'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ])('reads %i as %s', (status, reason) => {
    expect(classify(status)).toBe(reason);
  });
});

describe('a successful call', () => {
  it('sends the bearer token and returns the parsed body', async () => {
    const fetchMock = stubFetch(json({ id: 'obj-1' }));
    const client = createApiClient(resolver);

    await expect(client.get<{ id: string }>('/objects/obj-1')).resolves.toEqual(
      { ok: true, data: { id: 'obj-1' } },
    );

    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe('https://api.test/objects/obj-1');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer token-123');
    // Never a cached answer: the session behind it can change under us.
    expect(init.cache).toBe('no-store');
  });

  it('sends a JSON body on post, and no content-type without one', async () => {
    const fetchMock = stubFetch(json({ ok: 1 }), json({ ok: 1 }));
    const client = createApiClient(resolver);

    await client.post('/objects', { fileName: 'a.mp3' });
    await client.get('/objects');

    const [, post] = fetchMock.mock.calls[0];
    const [, get] = fetchMock.mock.calls[1];

    expect(post.headers['Content-Type']).toBe('application/json');
    expect(post.body).toBe(JSON.stringify({ fileName: 'a.mp3' }));
    expect(get.headers['Content-Type']).toBeUndefined();
    expect(get.body).toBeUndefined();
  });

  it('answers delete without reading a body, since 204 has none', async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(
      createApiClient(resolver).del('/objects/obj-1'),
    ).resolves.toEqual({ ok: true });
  });
});

describe('a refusing resolver', () => {
  it('short-circuits before any request is made', async () => {
    const fetchMock = stubFetch();
    const refusing: TargetResolver<'noOrganization'> = async () => ({
      ok: false,
      reason: 'noOrganization',
    });

    await expect(createApiClient(refusing).get('/meetings')).resolves.toEqual({
      ok: false,
      reason: 'noOrganization',
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a failing call', () => {
  it('carries the reason, the message and the parsed body', async () => {
    stubFetch(
      json({ message: 'Meeting not found', errors: [{ path: 'id' }] }, 404),
    );

    // Both apps are served: loculus renders `message`, akouo maps `body.errors`
    // onto its form, and the body is read once for the two of them.
    await expect(
      createApiClient(resolver).post('/meetings', {}),
    ).resolves.toEqual({
      ok: false,
      reason: 'notFound',
      message: 'Meeting not found',
      body: { message: 'Meeting not found', errors: [{ path: 'id' }] },
    });
  });

  it('reads a problem document’s `detail` as the message', async () => {
    stubFetch(
      json({ title: 'Not Found', detail: 'No object with that key' }, 404),
    );

    const result = await createApiClient(resolver).get('/objects/nope');

    expect(result).toMatchObject({ message: 'No object with that key' });
  });

  it('survives an error body that is not JSON', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502 }));

    await expect(createApiClient(resolver).get('/objects')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      message: undefined,
      body: null,
    });
  });

  it('reports a request that never landed as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(createApiClient(resolver).get('/objects')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('reports an unparseable success body as unavailable', async () => {
    stubFetch(new Response('not json', { status: 200 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(createApiClient(resolver).get('/objects')).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
      body: null,
    });
  });
});

describe('raw', () => {
  it('hands back any status untouched, so 206 and 416 pass through', async () => {
    // This is what makes seeking work in an audio player.
    stubFetch(new Response('bytes', { status: 206 }));

    const result = await createApiClient(resolver).raw('/stream', {
      headers: { Range: 'bytes=0-99' },
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.response.status).toBe(206);
  });

  it('still authorizes, and keeps the caller’s headers', async () => {
    const fetchMock = stubFetch(new Response('bytes', { status: 200 }));

    await createApiClient(resolver).raw('/stream', {
      headers: { Range: 'bytes=0-99' },
    });

    const [, init] = fetchMock.mock.calls[0];

    expect(init.headers.Authorization).toBe('Bearer token-123');
    expect(init.headers.Range).toBe('bytes=0-99');
  });
});
