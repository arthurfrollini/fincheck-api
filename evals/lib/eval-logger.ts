import { PinoLogger } from 'nestjs-pino';

// Evals run outside Nest. A real PinoLogger at 'warn' drops the per-call info
// logs (the report is the output) and still prints warnings.
export function createEvalLogger(): PinoLogger {
  return new PinoLogger({ pinoHttp: { level: 'warn' } });
}
