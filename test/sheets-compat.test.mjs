// Cổng ra Phase 0: facade phải khớp hợp đồng mà packflow đang dựa vào.
//
// Hai thứ được canh giữ ở đây:
//  1. Shape `SheetsLike` (src/lib/runner/bug-report-sync.ts:74) — mọi hàm trả {data}, và
//     `data` là response REST NGUYÊN BẢN chứ không phải shape đã chuẩn hoá.
//  2. Lỗi ném ra phải thoả isTransientSheetsError (scripts/lib/sheets-retry.mjs:20).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GoogleApiError } from '../src/http.mjs';
import { createSheetsCompatClient } from '../src/sheets-compat.mjs';

// COPY NGUYÊN VĂN từ packflow/scripts/lib/sheets-retry.mjs — đừng "dọn dẹp" hàm này, nó ở
// đây để phát hiện khi hợp đồng lỗi lệch khỏi bản thật.
const TRANSIENT_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_MESSAGE_RE =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE|ENOTFOUND|socket hang up|network ?error|fetch failed|rate ?limit|quota exceeded/i;
function isTransientSheetsError(error) {
  const status = Number(error?.code ?? error?.response?.status ?? NaN);
  if (TRANSIENT_HTTP_STATUS.has(status)) return true;
  const message = String(error?.message ?? error ?? '');
  return TRANSIENT_MESSAGE_RE.test(message);
}

function fakeClient(handler) {
  const calls = [];
  return {
    calls,
    client: {
      api: async (args) => {
        calls.push(args);
        return handler ? handler(args, calls.length) : {};
      },
    },
  };
}

test('shape đúng SheetsLike mà bug-report-sync.ts khai báo', () => {
  const { client } = fakeClient();
  const s = createSheetsCompatClient({ client });
  assert.equal(typeof s.spreadsheets.get, 'function');
  assert.equal(typeof s.spreadsheets.batchUpdate, 'function');
  assert.equal(typeof s.spreadsheets.values.get, 'function');
  assert.equal(typeof s.spreadsheets.values.update, 'function');
  assert.equal(typeof s.spreadsheets.values.batchUpdate, 'function');
  assert.equal(typeof s.spreadsheets.values.append, 'function');
});

test('spreadsheets.get trả RAW — resolveSheetName đọc được properties.sheetId/title', async () => {
  const raw = {
    properties: { title: 'File QC' },
    sheets: [
      { properties: { sheetId: 0, title: 'Tab đầu' } },
      { properties: { sheetId: 1932153755, title: '04 Bug Report' } },
    ],
  };
  const { client, calls } = fakeClient(() => raw);
  const s = createSheetsCompatClient({ client });

  const meta = await s.spreadsheets.get({
    spreadsheetId: 'SHEET_ID',
    fields: 'sheets(properties(sheetId,title))',
  });

  // Đúng cách packflow truy cập.
  const list = meta.data.sheets || [];
  const match = list.find((x) => String(x.properties.sheetId) === '1932153755');
  assert.equal(match.properties.title, '04 Bug Report');

  assert.match(calls[0].url, /\/v4\/spreadsheets\/SHEET_ID\?/);
  assert.match(calls[0].url, /fields=sheets%28properties%28sheetId%2Ctitle%29%29/);
});

test('values.get: range được encode, trả res.data.values', async () => {
  const { client, calls } = fakeClient(() => ({ values: [['a', 'b'], ['c']] }));
  const s = createSheetsCompatClient({ client });

  const res = await s.spreadsheets.values.get({
    spreadsheetId: 'ID',
    range: "'BTC_Tạo giải'!A1:Z3000",
    valueRenderOption: 'FORMATTED_VALUE',
  });

  assert.deepEqual(res.data.values, [['a', 'b'], ['c']]);
  // encodeURIComponent để nguyên ' và ! (ký tự hợp lệ trong path), nhưng PHẢI mã hoá dấu
  // cách và ký tự tiếng Việt — đó là chỗ ghép chuỗi thủ công hay vỡ.
  assert.match(calls[0].url, /\/values\/'BTC_T%E1%BA%A1o%20gi%E1%BA%A3i'!A1%3AZ3000\?/);
  assert.match(calls[0].url, /valueRenderOption=FORMATTED_VALUE/);
  assert.equal(calls[0].method, undefined, 'GET là mặc định');
});

test('values.update dùng PUT (dùng POST là 404 khó hiểu)', async () => {
  const { client, calls } = fakeClient(() => ({ updatedCells: 1 }));
  const s = createSheetsCompatClient({ client });

  await s.spreadsheets.values.update({
    spreadsheetId: 'ID',
    range: "'Tab'!J5",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['x']] },
  });

  assert.equal(calls[0].method, 'PUT');
  assert.deepEqual(calls[0].body, { values: [['x']] });
  assert.match(calls[0].url, /valueInputOption=USER_ENTERED/);
});

test('values.batchUpdate: POST values:batchUpdate, trả totalUpdatedCells', async () => {
  const { client, calls } = fakeClient(() => ({ totalUpdatedCells: 7, responses: [] }));
  const s = createSheetsCompatClient({ client });

  const resp = await s.spreadsheets.values.batchUpdate({
    spreadsheetId: 'ID',
    requestBody: { valueInputOption: 'USER_ENTERED', data: [{ range: "'T'!L2", values: [['PASSED']] }] },
  });

  // Đúng cách sheet-result-sync.mjs:171 đọc.
  assert.equal(resp.data.totalUpdatedCells, 7);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].url, /\/values:batchUpdate$/);
});

test('spreadsheets.batchUpdate (structural) khác đường với values.batchUpdate', async () => {
  const { client, calls } = fakeClient(() => ({ replies: [] }));
  const s = createSheetsCompatClient({ client });

  await s.spreadsheets.batchUpdate({ spreadsheetId: 'ID', requestBody: { requests: [] } });
  assert.match(calls[0].url, /\/spreadsheets\/ID:batchUpdate$/);
  assert.doesNotMatch(calls[0].url, /values/);
});

test('CỔNG RA: lỗi tạm thời của facade thoả isTransientSheetsError của packflow', async () => {
  for (const status of [429, 500, 503]) {
    const { client } = fakeClient(() => {
      throw new GoogleApiError(status, { error: { message: 'Backend error' } });
    });
    const s = createSheetsCompatClient({ client });
    await assert.rejects(s.spreadsheets.values.get({ spreadsheetId: 'ID', range: 'A1' }), (err) => {
      assert.ok(isTransientSheetsError(err), `status ${status} phải được coi là tạm thời`);
      return true;
    });
  }
});

test('CỔNG RA: lỗi vĩnh viễn (403/404/400) KHÔNG bị coi là tạm thời', async () => {
  for (const status of [400, 403, 404]) {
    const { client } = fakeClient(() => {
      throw new GoogleApiError(status, {
        error: { message: 'The caller does not have permission' },
      });
    });
    const s = createSheetsCompatClient({ client });
    await assert.rejects(s.spreadsheets.values.get({ spreadsheetId: 'ID', range: 'A1' }), (err) => {
      assert.equal(isTransientSheetsError(err), false, `status ${status} không được retry`);
      return true;
    });
  }
});

test('CỔNG RA: lỗi mạng trần cũng thoả isTransientSheetsError', () => {
  assert.ok(isTransientSheetsError(new TypeError('fetch failed')));
});
