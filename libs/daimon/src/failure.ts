import { NextResponse } from 'next/server';

import type { ApiFailure, BaseFailureReason } from './api.js';

/**
 * Turning a failure from a resource server into one this app's own routes can
 * answer with.
 *
 * The statuses are re-stated rather than passed through, so the browser is told
 * about *this* app: a 401 here means the session cookie is gone, whatever the
 * api thought of the token. `unavailable` becomes 502, because a browser
 * treating "the api is down" as "your request was wrong" retries nothing.
 */

export const DEFAULT_FAILURE_STATUS: Record<BaseFailureReason, number> = {
  unauthenticated: 401,
  forbidden: 403,
  notFound: 404,
  unavailable: 502,
};

export const DEFAULT_FAILURE_MESSAGE: Record<BaseFailureReason, string> = {
  unauthenticated: 'Your session has expired. Sign in again.',
  forbidden: 'You do not have access to that.',
  notFound: 'That could not be found.',
  unavailable: 'The service could not be reached. Try again in a moment.',
};

export interface FailureResponderOptions<ExtraReason extends string = never> {
  /**
   * Statuses for any reasons beyond the base four, and overrides for those.
   * akouo maps `noOrganization` to 403 here.
   */
  status?: Partial<Record<BaseFailureReason | ExtraReason, number>>;
  /**
   * Wording per reason. Worth setting: the defaults are deliberately generic,
   * and a route that knows what the caller was doing can say something useful —
   * "That upload could not be found" rather than "That could not be found".
   */
  messages?: Partial<Record<BaseFailureReason | ExtraReason, string>>;
  /**
   * Last resort when nothing else names the problem. The api's own message is
   * preferred over this where it sent one.
   */
  fallbackMessage?: string;
  /**
   * Whether a message from the api beats the wording configured here.
   *
   * The two apps genuinely disagree, so this is not a default to be improved
   * on. loculus prefers the api's message — its api knows whether a key was
   * missing or owned by someone else, and says so. akouo prefers its own — its
   * routes know what the person was doing ("that upload could not be found")
   * where the api only knows what it could not find.
   */
  preferApiMessage?: boolean;
}

export interface FailureResponder<ExtraReason extends string = never> {
  statusFor(reason: BaseFailureReason | ExtraReason): number;
  messageFor(failure: ApiFailure<ExtraReason>): string;
  /** The whole thing: `{ message }` at the right status. */
  response(failure: ApiFailure<ExtraReason>): NextResponse;
}

/** Builds a responder for one route, or one app. */
export function createFailureResponder<ExtraReason extends string = never>(
  options: FailureResponderOptions<ExtraReason> = {},
): FailureResponder<ExtraReason> {
  const status = { ...DEFAULT_FAILURE_STATUS, ...options.status } as Record<
    string,
    number
  >;
  const messages = { ...options.messages } as Record<string, string>;

  const statusFor = (reason: BaseFailureReason | ExtraReason): number =>
    status[reason] ?? 502;

  const messageFor = (failure: ApiFailure<ExtraReason>): string => {
    const configured = messages[failure.reason];
    const fromApi = failure.message ?? failure.body?.message;

    const preferred = options.preferApiMessage
      ? (fromApi ?? configured)
      : (configured ?? fromApi);

    return (
      preferred ??
      options.fallbackMessage ??
      DEFAULT_FAILURE_MESSAGE[failure.reason as BaseFailureReason] ??
      'Something went wrong. Try again.'
    );
  };

  return {
    statusFor,
    messageFor,
    response: (failure) =>
      NextResponse.json(
        { message: messageFor(failure) },
        { status: statusFor(failure.reason) },
      ),
  };
}
