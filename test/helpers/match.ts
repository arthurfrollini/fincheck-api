/* eslint-disable @typescript-eslint/no-unsafe-return --
 * Jest's asymmetric matchers stand in for a value of another type, so
 * @types/jest types them as `any`. These wrappers give each matcher the type
 * of the value it matches, in this one file, so tests stay typed.
 */

export function anyString(): string {
  return expect.any(String);
}

export function anyNumber(): number {
  return expect.any(Number);
}

export function anyInstance<T>(ctor: abstract new (...args: never[]) => T): T {
  return expect.any(ctor);
}

export function objectContaining<T>(sample: Partial<T>): T {
  return expect.objectContaining(sample);
}

export function arrayContaining<T>(sample: T[]): T[] {
  return expect.arrayContaining(sample);
}

export function stringContaining(sample: string): string {
  return expect.stringContaining(sample);
}

export function closeTo(expected: number, precision?: number): number {
  return expect.closeTo(expected, precision);
}

export function stringMatching(pattern: string | RegExp): string {
  return expect.stringMatching(pattern);
}
