import { describe, expect, it } from 'vitest';

import type { ApiErrorBody, ApiFailure } from './api.js';
import { createFailureResponder } from './failure.js';

/**
 * A failure to hand a responder. `reason` is loose so a test can name one the
 * app added, which is the whole point of the generic being there.
 */
const failure = <ExtraReason extends string = never>(
  over: { reason?: string; message?: string; body?: ApiErrorBody | null } = {},
): ApiFailure<ExtraReason> =>
  ({ ok: false, reason: 'notFound', ...over }) as ApiFailure<ExtraReason>;

describe('statuses', () => {
  it('re-states them rather than passing the api’s through', () => {
    const responder = createFailureResponder();

    expect(responder.statusFor('unauthenticated')).toBe(401);
    expect(responder.statusFor('forbidden')).toBe(403);
    expect(responder.statusFor('notFound')).toBe(404);
    // A browser told "your request was wrong" when the api is simply down
    // retries nothing.
    expect(responder.statusFor('unavailable')).toBe(502);
  });

  it('takes a status for a reason the app added', () => {
    const responder = createFailureResponder<'noOrganization'>({
      status: { noOrganization: 403 },
    });

    expect(responder.statusFor('noOrganization')).toBe(403);
    // Signing in again would not help, so it must not be reported as 401.
    expect(responder.statusFor('noOrganization')).not.toBe(401);
  });

  it('falls back to 502 for a reason nothing mapped', () => {
    const responder = createFailureResponder<'somethingNew'>();

    expect(responder.statusFor('somethingNew')).toBe(502);
  });
});

/*
 * The two apps genuinely disagree here, and consolidating them nearly flipped
 * loculus's behaviour silently. These pin both directions.
 */
describe('message precedence', () => {
  it('prefers the route’s own wording by default', () => {
    const responder = createFailureResponder({
      messages: { notFound: 'That upload could not be found.' },
    });

    expect(responder.messageFor(failure({ message: 'Object not found' }))).toBe(
      'That upload could not be found.',
    );
  });

  it('prefers the api’s message when asked to', () => {
    const responder = createFailureResponder({
      preferApiMessage: true,
      messages: { notFound: 'No object with that key.' },
    });

    expect(responder.messageFor(failure({ message: 'Object not found' }))).toBe(
      'Object not found',
    );
  });

  it('still uses the configured wording when the api sent none', () => {
    const responder = createFailureResponder({
      preferApiMessage: true,
      messages: { notFound: 'No object with that key.' },
    });

    expect(responder.messageFor(failure())).toBe('No object with that key.');
  });

  it('reads the message out of the error body when there is no top-level one', () => {
    const responder = createFailureResponder({ preferApiMessage: true });

    expect(
      responder.messageFor(
        failure({ reason: 'unavailable', body: { message: 'Bucket down' } }),
      ),
    ).toBe('Bucket down');
  });

  it('falls back to the configured fallback, then to a default', () => {
    const withFallback = createFailureResponder({
      fallbackMessage: 'Could not start the upload. Try again.',
    });

    expect(withFallback.messageFor(failure({ reason: 'unavailable' }))).toBe(
      'Could not start the upload. Try again.',
    );

    expect(
      createFailureResponder().messageFor(failure({ reason: 'unavailable' })),
    ).toMatch(/could not be reached/i);
  });

  it('always answers something, even for a reason it has never heard of', () => {
    const responder = createFailureResponder<'somethingNew'>();

    expect(
      responder.messageFor(failure<'somethingNew'>({ reason: 'somethingNew' })),
    ).toBe('Something went wrong. Try again.');
  });
});

describe('response', () => {
  it('is the message at the mapped status', async () => {
    const responder = createFailureResponder({
      messages: { forbidden: 'That object belongs to another application.' },
    });

    const response = responder.response(failure({ reason: 'forbidden' }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      message: 'That object belongs to another application.',
    });
  });
});
