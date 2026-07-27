// Cửa thư viện — dành cho code Node import trực tiếp (packflow dùng cửa này, không qua CLI).

export { createClient } from './client.mjs';
export { createSheetsCompatClient } from './sheets-compat.mjs';

export { createTokenSource, signJwt } from './auth.mjs';
export { CredentialError, resolveCredentials, SCOPES, scopesForMode } from './credentials.mjs';
export { buildQuery, GoogleApiError, isTransient, request } from './http.mjs';

export {
  buildA1,
  columnLetterToIndex,
  indexToColumnLetter,
  KIND,
  parseGoogleUrl,
  quoteSheetTitle,
  UrlError,
} from './url.mjs';

export {
  appendValues,
  batchUpdateValues,
  getMetadata,
  getValues,
  pickSheet,
  readSheet,
  SheetNotFoundError,
} from './sheets.mjs';

export {
  about,
  assertUploadableFolder,
  createFolder,
  downloadFile,
  ensureFolder,
  escapeQueryValue,
  exportFile,
  FILE_FIELDS,
  getFile,
  listFiles,
  shareFile,
  uploadFile,
} from './drive.mjs';

// Đọc "một thứ gì đó trên Drive" — tự nhận định dạng. `readTable` xử lý CẢ Google Sheets
// lẫn .xlsx trong một lời gọi, nên chỗ gọi không phải tự rẽ nhánh theo mimeType.
export { inspect, readDocument, readTable, UnsupportedFormatError } from './read-document.mjs';
export { classify, exportMimeFor, KIND as FORMAT_KIND, MIME } from './formats.mjs';

// Bộ đọc OOXML dùng trực tiếp trên buffer (không qua Drive).
export { openXlsx, parseCellRef, serialToIso } from './ooxml-xlsx.mjs';
export { readDocx } from './ooxml-docx.mjs';
export { pptxToText, readPptx } from './ooxml-pptx.mjs';
export { openZip, ZipError } from './zip.mjs';
