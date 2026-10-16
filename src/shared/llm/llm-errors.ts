import Anthropic from '@anthropic-ai/sdk';

// Shared by every queue that calls Claude: permanent errors fail the job
// once (UnrecoverableError), everything else is retried with backoff.
// 4xx means the request itself is wrong (bad key, bad params, no access) and
// will fail the same way every time, except these, which can clear up.
const TRANSIENT_CLIENT_STATUSES = new Set([408, 409, 429]);

export function isPermanentLlmError(
  err: unknown,
): err is InstanceType<typeof Anthropic.AnthropicError> {
  // An SDK error with no HTTP status (e.g. a client-side output parsing
  // failure) will not change on retry.
  if (
    err instanceof Anthropic.AnthropicError &&
    !(err instanceof Anthropic.APIError)
  ) {
    return true;
  }
  return (
    err instanceof Anthropic.APIError &&
    !(err instanceof Anthropic.APIConnectionError) &&
    typeof err.status === 'number' &&
    err.status >= 400 &&
    err.status < 500 &&
    !TRANSIENT_CLIENT_STATUSES.has(err.status)
  );
}
