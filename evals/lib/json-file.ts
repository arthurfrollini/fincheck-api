import * as fs from 'fs';
import { type z } from 'zod';

// Reads a JSON file an earlier run wrote (a baseline), checked against its
// schema; undefined when the file doesn't exist yet.
export function readJsonFile<S extends z.ZodType>(
  file: string,
  schema: S,
): z.infer<S> | undefined {
  if (!fs.existsSync(file)) return undefined;
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return schema.parse(value);
}
