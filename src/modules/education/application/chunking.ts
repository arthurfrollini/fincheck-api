export const MIN_CHUNK_WORDS = 120;
export const MAX_CHUNK_WORDS = 250;

export interface PageText {
  page: number;
  text: string;
}

export interface TextChunk {
  chunkIndex: number;
  page: number;
  text: string;
}

// Lines the Caderno repeats on every page; they carry no content and would
// make every chunk look alike to the embedding model.
const NOISE_LINES = [
  /^CADERNO DE EDUCA[ÇC][ÃA]O FINANCEIRA$/i,
  /^SUM[ÁA]RIO$/i,
  /^M[ÓO]DULO \d+$/i,
  /^\d+$/,
];

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

function paragraphsOf(pageText: string): string[] {
  return pageText
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !NOISE_LINES.some((re) => re.test(line)))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .flatMap(splitLongParagraph);
}

// A paragraph longer than a whole chunk is split on sentence ends, so one
// giant paragraph doesn't become one giant chunk.
function splitLongParagraph(paragraph: string): string[] {
  if (wordCount(paragraph) <= MAX_CHUNK_WORDS) return [paragraph];
  const sentences = paragraph.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (current && wordCount(candidate) > MAX_CHUNK_WORDS) {
      parts.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Paragraph-boundary chunking: merge consecutive paragraphs of one page until
// the chunk reaches MIN..MAX words, never crossing a page (so every citation
// has one page number), and start each chunk with the previous chunk's last
// paragraph so an answer that spans the boundary is retrievable from either.
export function chunkPages(pages: PageText[]): TextChunk[] {
  const chunks: TextChunk[] = [];

  for (const { page, text } of pages) {
    const paragraphs = paragraphsOf(text);
    let current: string[] = [];
    let words = 0;
    let hasNewContent = false;

    for (const paragraph of paragraphs) {
      const size = wordCount(paragraph);
      if (
        hasNewContent &&
        words + size > MAX_CHUNK_WORDS &&
        words >= MIN_CHUNK_WORDS
      ) {
        chunks.push({
          chunkIndex: chunks.length,
          page,
          text: current.join('\n\n'),
        });
        current = current.slice(-1);
        words = wordCount(current.join(' '));
        hasNewContent = false;
      }
      current.push(paragraph);
      words += size;
      hasNewContent = true;
    }

    if (hasNewContent) {
      chunks.push({
        chunkIndex: chunks.length,
        page,
        text: current.join('\n\n'),
      });
    }
  }

  return chunks;
}
