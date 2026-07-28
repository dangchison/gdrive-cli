// Định nghĩa MCP tool — lớp MỎNG bọc thư viện, không viết lại logic.
//
// Nguyên tắc: mọi tool nhận THẲNG URL người dùng dán vào; việc parse URL → id → gid →
// tên tab nằm bên trong tool, không đẩy ra cho người gọi.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { createClient } from './client.mjs';
import {
  assertUploadableFolder,
  downloadFile,
  exportFile,
  listFiles,
  shareFile,
  uploadFile,
} from './drive.mjs';
import { KIND } from './formats.mjs';
import { inspect, readDocument, readTable } from './read-document.mjs';
import { batchUpdateValues, getMetadata, pickSheet } from './sheets.mjs';
import { buildA1, parseGoogleUrl } from './url.mjs';

const urlProp = {
  type: 'string',
  description: 'URL Google đầy đủ (dán thẳng từ trình duyệt) hoặc file id.',
};

/** `readAs` của formats.mjs nói theo lệnh CLI; đổi sang tên tool cho người gọi MCP. */
const READ_WITH_TOOL = {
  read: 'gdrive_sheet_read',
  doc: 'gdrive_read_document',
  get: 'gdrive_download',
  ls: 'gdrive_list',
};

/** File native của Google không tải thẳng được — phải export. */
const EXPORT_AS = {
  [KIND.GOOGLE_DOC]: 'application/pdf',
  [KIND.GOOGLE_SHEET]: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  [KIND.GOOGLE_SLIDES]: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/**
 * @param {object} ctx
 * @param {() => object} ctx.getClient  trả client đã dựng (lazy, cache ở server)
 * @param {'readonly'|'readwrite'} ctx.mode
 */
export function buildTools({ getClient, mode }) {
  const idOf = (input) => parseGoogleUrl(input);

  const all = [
    {
      name: 'gdrive_sheet_read',
      write: false,
      description:
        'Đọc dữ liệu dạng bảng: Google Sheets HOẶC file .xlsx lưu trên Drive (tự nhận, không cần công cụ ngoài). ' +
        'Luôn trả kèm danh sách MỌI tab kèm gid — đoán nhầm tab thì gọi lại với tham số sheet, không cần lệnh phụ để dò.',
      inputSchema: {
        type: 'object',
        properties: {
          url_or_id: urlProp,
          sheet: { type: 'string', description: 'Tên tab, hoặc gid dạng số. Bỏ trống = lấy gid trong URL, không có thì tab đầu.' },
          range: { type: 'string', description: 'Range A1 TƯƠNG ĐỐI với tab, vd "A1:E50". Bỏ trống = cả tab.' },
          max_rows: { type: 'integer', description: 'Mặc định 500.' },
        },
        required: ['url_or_id'],
        additionalProperties: false,
      },
      async run(args) {
        const { id, gid } = idOf(args.url_or_id);
        const res = await readTable(getClient(), id, {
          sheet: args.sheet ?? null,
          gid,
          range: args.range ?? null,
          maxRows: args.max_rows ?? 500,
        });
        return {
          name: res.name,
          source: res.source,
          spreadsheet_title: res.spreadsheetTitle,
          sheet: res.sheet,
          sheets: res.sheets,
          rows: res.rows,
          row_count: res.rowCount,
          truncated: res.truncated,
          warnings: res.warnings,
        };
      },
    },

    {
      name: 'gdrive_read_document',
      write: false,
      description:
        'Đọc VĂN BẢN: Google Docs, Google Slides, .docx, .pptx, .csv, .txt, .md. ' +
        'KHÔNG dùng cho bảng (Sheets/.xlsx → gdrive_sheet_read) và không đọc được .doc/.xls/.ppt đời cũ. ' +
        'Luôn đọc trường warnings và nói lại cho người dùng.',
      inputSchema: {
        type: 'object',
        properties: {
          url_or_id: urlProp,
          format: { type: 'string', enum: ['markdown', 'text'], description: 'Mặc định markdown.' },
          include_notes: { type: 'boolean', description: 'Slide: lấy cả ghi chú người trình bày.' },
          max_chars: { type: 'integer', description: 'Mặc định 100000.' },
        },
        required: ['url_or_id'],
        additionalProperties: false,
      },
      async run(args) {
        const { id } = idOf(args.url_or_id);
        const res = await readDocument(getClient(), id, {
          format: args.format === 'text' ? 'text' : 'markdown',
          includeNotes: args.include_notes === true,
          maxChars: args.max_chars ?? 100_000,
        });
        return {
          name: res.name,
          kind: res.kind,
          source: res.source,
          content: res.content,
          slides: res.slides,
          char_count: res.charCount,
          truncated: res.truncated,
          warnings: res.warnings,
        };
      },
    },

    {
      name: 'gdrive_file_info',
      write: false,
      description:
        'File này là gì và đọc được bằng tool nào. Gọi cái này TRƯỚC khi đoán định dạng — rẻ hơn nhiều so với đoán sai rồi ăn lỗi.',
      inputSchema: {
        type: 'object',
        properties: { url_or_id: urlProp },
        required: ['url_or_id'],
        additionalProperties: false,
      },
      async run(args) {
        const { id } = idOf(args.url_or_id);
        const { meta, kind, readAs, tabular, note } = await inspect(getClient(), id);
        return {
          id: meta.id,
          name: meta.name,
          mime_type: meta.mimeType,
          kind,
          tabular,
          read_with: readAs.map((c) => READ_WITH_TOOL[c] ?? c),
          size: meta.size ? Number(meta.size) : null,
          modified_time: meta.modifiedTime,
          web_view_link: meta.webViewLink,
          on_shared_drive: Boolean(meta.driveId),
          note,
        };
      },
    },

    {
      name: 'gdrive_list',
      write: false,
      description:
        'Liệt kê file trên Drive. Nhớ: service account CHỈ thấy thứ đã được share cho email của nó — danh sách rỗng thường là chưa share, không phải không có file.',
      inputSchema: {
        type: 'object',
        properties: {
          folder_url_or_id: { type: 'string', description: 'Giới hạn trong một thư mục.' },
          name_contains: { type: 'string' },
          mime_type: { type: 'string' },
          max: { type: 'integer', description: 'Mặc định 50.' },
        },
        additionalProperties: false,
      },
      async run(args) {
        const folderId = args.folder_url_or_id ? idOf(args.folder_url_or_id).id : null;
        const { files, nextPageToken } = await listFiles(getClient(), {
          folderId,
          nameContains: args.name_contains ?? null,
          mimeType: args.mime_type ?? null,
          max: args.max ?? 50,
        });
        return {
          files: files.map((f) => ({
            id: f.id,
            name: f.name,
            mime_type: f.mimeType,
            size: f.size ? Number(f.size) : null,
            modified_time: f.modifiedTime,
            web_view_link: f.webViewLink,
          })),
          has_more: Boolean(nextPageToken),
        };
      },
    },

    {
      name: 'gdrive_download',
      write: false,
      description:
        'Tải file về đĩa. Dùng cho PDF, ảnh, và mọi định dạng không trích text được — tải xong đọc bằng công cụ đọc file. ' +
        'File native của Google được export tự động (Docs→PDF, Sheets→xlsx, Slides→pptx).',
      inputSchema: {
        type: 'object',
        properties: {
          url_or_id: urlProp,
          dest_path: { type: 'string', description: 'Đường dẫn tuyệt đối để ghi file.' },
        },
        required: ['url_or_id', 'dest_path'],
        additionalProperties: false,
      },
      async run(args) {
        const { id } = idOf(args.url_or_id);
        const client = getClient();
        const { meta, kind } = await inspect(client, id);
        const exportMime = EXPORT_AS[kind];
        const buf = exportMime
          ? await exportFile(client, id, exportMime)
          : await downloadFile(client, id);
        writeFileSync(args.dest_path, buf);
        return {
          path: args.dest_path,
          bytes: buf.length,
          name: meta.name,
          exported: Boolean(exportMime),
          mime_type: exportMime ?? meta.mimeType,
        };
      },
    },

    {
      name: 'gdrive_sheet_write',
      write: true,
      description:
        'Ghi giá trị vào ô của Google Sheet. Ô nêu theo A1 TƯƠNG ĐỐI với tab (vd "L5") — tên tab và dấu nháy do tool tự lo. ' +
        'CHỈ những ô nêu tên bị đụng tới; ô khác giữ nguyên.',
      inputSchema: {
        type: 'object',
        properties: {
          url_or_id: urlProp,
          sheet: { type: 'string', description: 'Tên tab hoặc gid. Bỏ trống = gid trong URL, không có thì tab đầu.' },
          cells: {
            type: 'object',
            description: 'Map ô → giá trị, vd {"L5":"PASSED","L6":"FAILED"}.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['url_or_id', 'cells'],
        additionalProperties: false,
      },
      async run(args) {
        const entries = Object.entries(args.cells ?? {});
        if (!entries.length) throw new Error('cells rỗng — không có gì để ghi.');
        const { id, gid } = idOf(args.url_or_id);
        const client = getClient();
        const meta = await getMetadata(client, id);
        const sheet = pickSheet(meta.sheets, { sheet: args.sheet ?? null, gid });
        const data = entries.map(([cell, value]) => ({
          range: buildA1(sheet.title, cell),
          values: [[String(value)]],
        }));
        const res = await batchUpdateValues(client, id, data);
        return { sheet, updated_cells: res.updatedCells, updated_ranges: res.updatedRanges };
      },
    },

    {
      name: 'gdrive_upload',
      write: true,
      description:
        'Upload một file từ đĩa lên thư mục Drive. LƯU Ý: service account KHÔNG có dung lượng My Drive — ' +
        'thư mục đích phải nằm trên Shared Drive, share Editor một thư mục My Drive là KHÔNG đủ.',
      inputSchema: {
        type: 'object',
        properties: {
          local_path: { type: 'string', description: 'Đường dẫn tuyệt đối tới file cần upload.' },
          folder_url_or_id: { type: 'string', description: 'Thư mục đích trên Drive.' },
          name: { type: 'string', description: 'Đặt tên khác cho file trên Drive.' },
          share: {
            type: 'string',
            enum: ['none', 'anyone-reader'],
            description: 'Mặc định none. anyone-reader = ai có link cũng xem được — chỉ dùng khi người dùng yêu cầu rõ.',
          },
        },
        required: ['local_path', 'folder_url_or_id'],
        additionalProperties: false,
      },
      async run(args) {
        const client = getClient();
        const folderId = idOf(args.folder_url_or_id).id;
        await assertUploadableFolder(client, folderId);
        const file = await uploadFile(client, {
          name: args.name ?? basename(args.local_path),
          folderId,
          content: readFileSync(args.local_path),
        });
        if (args.share === 'anyone-reader') {
          await shareFile(client, file.id, { role: 'reader', type: 'anyone' });
        }
        return {
          id: file.id,
          name: file.name,
          web_view_link: file.webViewLink,
          shared: args.share ?? 'none',
        };
      },
    },
  ];

  // Chế độ readonly: ẩn HẲN tool ghi khỏi tools/list — model không gọi được thứ nó không thấy.
  return mode === 'readwrite' ? all : all.filter((t) => !t.write);
}
