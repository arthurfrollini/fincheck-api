import pino from 'pino';
import { Writable } from 'stream';
import { LOG_REDACT_PATHS } from './log-redact';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: pino({ redact: LOG_REDACT_PATHS }, stream), lines };
}

describe('LOG_REDACT_PATHS', () => {
  it('redacts bearer tokens and cookies from logged requests', () => {
    const { logger, lines } = capture();

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer eyJ.secret.jwt',
          cookie: 'refresh=secret-refresh',
          host: 'localhost',
        },
      },
    });

    expect(lines.join('')).not.toContain('secret');
    expect(lines.join('')).toContain('localhost');
  });

  it('redacts cookies set on logged responses', () => {
    const { logger, lines } = capture();

    logger.info({
      res: { headers: { 'set-cookie': 'refresh=secret-refresh' } },
    });

    expect(lines.join('')).not.toContain('secret');
  });
});
