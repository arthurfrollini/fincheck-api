import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CATEGORY_NAMES_BY_TYPE, loadGoldenSet } from './golden-set';

describe('loadGoldenSet', () => {
  const cases = loadGoldenSet();

  it('has exactly 50 cases with unique ids', () => {
    expect(cases).toHaveLength(50);
    expect(new Set(cases.map((c) => c.id)).size).toBe(50);
  });

  it('mixes real and synthetic cases and covers income', () => {
    expect(cases.some((c) => c.source === 'real')).toBe(true);
    expect(cases.some((c) => c.source === 'synthetic')).toBe(true);
    expect(
      cases.filter((c) => c.type === 'INCOME').length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('labels every case with a default category of its type, or none', () => {
    for (const c of cases) {
      expect([...CATEGORY_NAMES_BY_TYPE[c.type], 'none']).toContain(c.expected);
    }
  });

  it('rejects a label that is not an exact default category name, naming the line', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'gs-')),
      'bad.jsonl',
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        id: 'x1',
        name: 'Restaurante',
        type: 'EXPENSE',
        value: 10,
        expected: 'Alimentacao',
        source: 'synthetic',
      }) + '\n',
    );

    expect(() => loadGoldenSet(file)).toThrow(/line 1/);
  });
});
