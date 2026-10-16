// pino-http logs every request's headers. Without this, each user's JWT and
// refresh cookie would be written to stdout and shipped to Loki.
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];
