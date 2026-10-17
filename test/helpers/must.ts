// For values a test knows are there (a fixture id, a response it just
// waited for): fails the test with a readable message instead of asserting
// the missing case away with `!`.
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${what} to be present`);
  }
  return value;
}
