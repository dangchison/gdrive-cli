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
