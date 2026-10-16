import { execFile } from 'child_process';
import { promisify } from 'util';
import { type PageText } from '../../application/chunking';

const run = promisify(execFile);

// Uses poppler's pdftotext rather than a JS PDF parser: pdftotext keeps
// blank lines between paragraphs and emits a form feed between pages, which
// paragraph-boundary chunking needs. pdf.js-based extractors flatten both.
// Requires poppler-utils on the machine (brew install poppler / apt-get
// install poppler-utils).
export async function extractPdfPages(filePath: string): Promise<PageText[]> {
  const { stdout } = await run('pdftotext', ['-enc', 'UTF-8', filePath, '-'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split('\f')
    .map((text, i) => ({ page: i + 1, text }))
    .filter((p) => p.text.trim() !== '');
}
