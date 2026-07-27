// Facade mang đúng hình dạng client `googleapis` — cửa để packflow migrate mà không phải
// sửa chỗ gọi.
//
// CỐ Ý pass-through THÔ: mọi hàm trả `{data: <response REST nguyên bản>}` chứ không phải
// shape đã chuẩn hoá của sheets.mjs. Vì chỗ gọi bên packflow đọc thẳng field của Google:
//   resolveSheetName  → meta.data.sheets[].properties.sheetId / .title
//   sheet-result-sync → resp.data.totalUpdatedCells
//   bug-report-sync   → res.data.values
// Chuẩn hoá ở đây là phá vỡ hợp đồng đó.

import { createClient } from './client.mjs';
import { buildQuery } from './http.mjs';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

const enc = encodeURIComponent;

/**
 * @param {object} [opts] giống createClient — {credentials, mode, retries, env, fetchImpl}
 * @returns client hình dạng googleapis: `{spreadsheets: {get, batchUpdate, values: {...}}}`
 */
export function createSheetsCompatClient(opts = {}) {
  const client = opts.client ?? createClient({ mode: 'readwrite', ...opts });
  const call = (args) => client.api(args).then((data) => ({ data }));

  return {
    spreadsheets: {
      get({ spreadsheetId, fields, ranges, includeGridData }) {
        return call({
          url: `${BASE}/${enc(spreadsheetId)}${buildQuery({ fields, ranges, includeGridData })}`,
        });
      },

      // Structural: format / data validation / protect / resize…
      batchUpdate({ spreadsheetId, requestBody }) {
        return call({
          url: `${BASE}/${enc(spreadsheetId)}:batchUpdate`,
          method: 'POST',
          body: requestBody,
        });
      },

      values: {
        get({ spreadsheetId, range, valueRenderOption, majorDimension, dateTimeRenderOption }) {
          return call({
            url: `${BASE}/${enc(spreadsheetId)}/values/${enc(range)}${buildQuery({
              valueRenderOption,
              majorDimension,
              dateTimeRenderOption,
            })}`,
          });
        },

        // PUT, không phải POST — dùng nhầm method thì Google trả 404 khó hiểu.
        update({ spreadsheetId, range, valueInputOption, requestBody, includeValuesInResponse }) {
          return call({
            url: `${BASE}/${enc(spreadsheetId)}/values/${enc(range)}${buildQuery({
              valueInputOption,
              includeValuesInResponse,
            })}`,
            method: 'PUT',
            body: requestBody,
          });
        },

        batchUpdate({ spreadsheetId, requestBody }) {
          return call({
            url: `${BASE}/${enc(spreadsheetId)}/values:batchUpdate`,
            method: 'POST',
            body: requestBody,
          });
        },

        append({ spreadsheetId, range, valueInputOption, insertDataOption, requestBody }) {
          return call({
            url: `${BASE}/${enc(spreadsheetId)}/values/${enc(range)}:append${buildQuery({
              valueInputOption,
              insertDataOption,
            })}`,
            method: 'POST',
            body: requestBody,
          });
        },
      },
    },
  };
}
