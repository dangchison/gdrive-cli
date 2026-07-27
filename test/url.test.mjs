import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildA1,
  columnLetterToIndex,
  indexToColumnLetter,
  KIND,
  parseGoogleUrl,
  quoteSheetTitle,
  UrlError,
} from '../src/url.mjs';

test('parse link Sheets có gid ở fragment', () => {
  const r = parseGoogleUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit#gid=456');
  assert.deepEqual(r, { kind: KIND.SPREADSHEET, id: '1AbC_dEf-123', gid: '456' });
});

test('parse link Sheets có gid ở query', () => {
  const r = parseGoogleUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit?gid=789#gid=789');
  assert.equal(r.gid, '789');
});

test('parse link Sheets không có gid', () => {
  const r = parseGoogleUrl('https://docs.google.com/spreadsheets/d/1AbC_dEf-123/edit');
  assert.equal(r.gid, null);
  assert.equal(r.kind, KIND.SPREADSHEET);
});

test('parse link có tiền tố tài khoản /u/1/', () => {
  const r = parseGoogleUrl('https://docs.google.com/spreadsheets/u/1/d/1AbC_dEf-123/edit');
  assert.equal(r.id, '1AbC_dEf-123');
});

test('parse Docs và Slides', () => {
  assert.equal(parseGoogleUrl('https://docs.google.com/document/d/DOC123456/edit').kind, KIND.DOCUMENT);
  assert.equal(
    parseGoogleUrl('https://docs.google.com/presentation/d/SLIDE12345/edit').kind,
    KIND.PRESENTATION,
  );
});

test('parse link file và folder trên Drive', () => {
  assert.deepEqual(parseGoogleUrl('https://drive.google.com/file/d/FILE123456/view'), {
    kind: KIND.FILE,
    id: 'FILE123456',
    gid: null,
  });
  assert.deepEqual(parseGoogleUrl('https://drive.google.com/drive/folders/FOLDER12345'), {
    kind: KIND.FOLDER,
    id: 'FOLDER12345',
    gid: null,
  });
});

test('parse dạng ?id=', () => {
  assert.equal(parseGoogleUrl('https://drive.google.com/open?id=OPEN1234567').id, 'OPEN1234567');
  assert.equal(parseGoogleUrl('https://drive.google.com/uc?id=UC12345678&export=download').id, 'UC12345678');
});

test('parse id trần', () => {
  const r = parseGoogleUrl('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
  assert.equal(r.kind, KIND.UNKNOWN);
  assert.equal(r.id, '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms');
});

test('id trần quá ngắn thì từ chối chứ không đoán bừa', () => {
  assert.throws(() => parseGoogleUrl('abc'), UrlError);
});

// Bẫy có thật: cả 6 bản copy parseSheetUrl trong packflow đều trả id === "e" cho link này,
// rồi 404 với thông báo không liên quan.
test('link "Publish to the web" (/d/e/) báo đúng bệnh, không trả id="e"', () => {
  assert.throws(
    () =>
      parseGoogleUrl(
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vQxxxxxxxxxxxxxxxxxxx/pubhtml',
      ),
    (err) => {
      assert.ok(err instanceof UrlError);
      assert.match(err.message, /Publish to the web/);
      return true;
    },
  );
});

test('input rỗng hoặc sai kiểu', () => {
  assert.throws(() => parseGoogleUrl(''), UrlError);
  assert.throws(() => parseGoogleUrl(null), UrlError);
});

test('quote tên tab: nhân đôi dấu nháy đơn', () => {
  assert.equal(quoteSheetTitle('BTC_Tạo giải'), "'BTC_Tạo giải'");
  assert.equal(quoteSheetTitle("Bob's tab"), "'Bob''s tab'");
});

test('buildA1 ghép tên tab với range tương đối', () => {
  assert.equal(buildA1('Sheet 1', 'A1:C3'), "'Sheet 1'!A1:C3");
  assert.equal(buildA1('Sheet 1', null), "'Sheet 1'");
});

test('chuyển đổi chữ cái cột hai chiều', () => {
  assert.equal(columnLetterToIndex('A'), 1);
  assert.equal(columnLetterToIndex('Z'), 26);
  assert.equal(columnLetterToIndex('AA'), 27);
  assert.equal(columnLetterToIndex('AB'), 28);
  assert.equal(columnLetterToIndex('ZZ'), 702);
  for (const n of [1, 26, 27, 28, 52, 53, 702, 703, 1000]) {
    assert.equal(columnLetterToIndex(indexToColumnLetter(n)), n, `round-trip ${n}`);
  }
});
