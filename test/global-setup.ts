import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

export default function globalSetup() {
  dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
  execSync('npx prisma migrate deploy', {
    env: { ...process.env },
    stdio: 'inherit',
  });
}
