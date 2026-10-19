// For values a test knows are there (a fixture id, a response it just
// waited for): fails the test with a readable message instead of asserting
// the missing case away with `!`.
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}

// A mock's arguments on its nth call (0-based); fails the test when that call
// never happened instead of reading through undefined. Takes fn.mock rather
// than fn so a mocked method is never referenced unbound.
export function nthCall<Args extends unknown[]>(
  mock: { calls: Args[] },
  n = 0,
): Args {
  return must(mock.calls[n], `call #${n + 1}`);
}

// The single element of a list the test expects to hold exactly one.
export function only<T>(list: readonly T[], what: string): T {
  if (list.length !== 1) {
    throw new Error(`Expected exactly one ${what}, got ${list.length}`);
  }
  return must(list[0], what);
}
