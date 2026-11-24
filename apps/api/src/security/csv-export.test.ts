import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCsv, csvCell } from '../../../web/lib/csv.js';

test('quotes delimiters, quotes and embedded newlines', () => {
  assert.equal(csvCell('Alpha, "Beta"\nGamma'), '"Alpha, ""Beta""\nGamma"');
});

test('neutralizes formula-like text cells', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(csvCell('-2+3'), '"\'-2+3"');
  assert.equal(csvCell('@SUM(A1:A2)'), '"\'@SUM(A1:A2)"');
  assert.equal(csvCell('\t=HYPERLINK("https://example.invalid")'), '"\'\t=HYPERLINK(""https://example.invalid"")"');
});

test('does not rewrite numeric cells as formula text', () => {
  assert.equal(csvCell(-125), '"-125"');
  assert.equal(csvCell(0), '"0"');
});

test('builds UTF-8 BOM CSV with CRLF records', () => {
  assert.equal(buildCsv([['Reference', 'Amount'], ['=cmd', 1250]]), '\uFEFF"Reference","Amount"\r\n"\'=cmd","1250"');
});
