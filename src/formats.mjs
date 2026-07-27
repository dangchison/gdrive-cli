// Bản đồ mimeType → đọc được bằng cách nào.
//
// Chỗ duy nhất quyết định "file này xử lý ra sao", để CLI và skill không phải đoán.

export const MIME = {
  FOLDER: 'application/vnd.google-apps.folder',
  GOOGLE_SHEET: 'application/vnd.google-apps.spreadsheet',
  GOOGLE_DOC: 'application/vnd.google-apps.document',
  GOOGLE_SLIDES: 'application/vnd.google-apps.presentation',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  XLSM: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  PDF: 'application/pdf',
  DOC: 'application/msword',
  XLS: 'application/vnd.ms-excel',
  PPT: 'application/vnd.ms-powerpoint',
  MARKDOWN: 'text/markdown',
  PLAIN: 'text/plain',
  CSV: 'text/csv',
};

const LEGACY_EXT = /\.(doc|xls|ppt)$/i;
const TEXTISH = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript))/;

/** `kind` ổn định để CLI/skill rẽ nhánh. */
export const KIND = {
  FOLDER: 'folder',
  GOOGLE_SHEET: 'google-sheet',
  GOOGLE_DOC: 'google-doc',
  GOOGLE_SLIDES: 'google-slides',
  XLSX: 'xlsx',
  DOCX: 'docx',
  PPTX: 'pptx',
  PDF: 'pdf',
  LEGACY: 'legacy-binary',
  TEXT: 'text',
  OTHER: 'other',
};

/**
 * @param {string} mimeType
 * @param {string} [name] dùng để bắt file đời cũ khi Drive trả mimeType chung chung
 * @returns {{kind: string, readAs: string[], tabular: boolean, note: string|null}}
 */
export function classify(mimeType, name = '') {
  const mime = String(mimeType || '');

  switch (mime) {
    case MIME.FOLDER:
      return { kind: KIND.FOLDER, readAs: ['ls'], tabular: false, note: null };
    case MIME.GOOGLE_SHEET:
      return { kind: KIND.GOOGLE_SHEET, readAs: ['read'], tabular: true, note: null };
    case MIME.GOOGLE_DOC:
      return { kind: KIND.GOOGLE_DOC, readAs: ['doc'], tabular: false, note: null };
    case MIME.GOOGLE_SLIDES:
      return { kind: KIND.GOOGLE_SLIDES, readAs: ['doc'], tabular: false, note: null };
    case MIME.XLSX:
    case MIME.XLSM:
      return { kind: KIND.XLSX, readAs: ['read'], tabular: true, note: null };
    case MIME.DOCX:
      return { kind: KIND.DOCX, readAs: ['doc'], tabular: false, note: null };
    case MIME.PPTX:
      return { kind: KIND.PPTX, readAs: ['doc'], tabular: false, note: null };
    case MIME.PDF:
      return {
        kind: KIND.PDF,
        readAs: ['get'],
        tabular: false,
        note: 'PDF không trích text ở đây — tải về bằng `gdrive get` rồi mở bằng công cụ đọc PDF.',
      };
    case MIME.DOC:
    case MIME.XLS:
    case MIME.PPT:
      return { kind: KIND.LEGACY, readAs: [], tabular: false, note: legacyNote(name) };
    default:
      break;
  }

  // Drive đôi khi trả octet-stream cho file đời cũ → soi thêm đuôi tên.
  if (LEGACY_EXT.test(name)) {
    return { kind: KIND.LEGACY, readAs: [], tabular: false, note: legacyNote(name) };
  }
  if (TEXTISH.test(mime)) {
    return {
      kind: KIND.TEXT,
      readAs: mime === MIME.CSV ? ['doc', 'get'] : ['doc', 'get'],
      tabular: mime === MIME.CSV,
      note: null,
    };
  }
  return {
    kind: KIND.OTHER,
    readAs: ['get'],
    tabular: false,
    note: `Định dạng "${mime}" không trích text được — tải về bằng \`gdrive get\`.`,
  };
}

function legacyNote(name) {
  return (
    `"${name || 'File'}" là định dạng Office đời cũ (.doc/.xls/.ppt, nhị phân OLE2) — không đọc được.\n` +
    'Cách xử lý: mở file trong Google Drive → File → "Lưu dưới dạng Google Docs/Sheets/Slides", ' +
    'rồi dùng link của bản mới.\n' +
    '(Cố tình KHÔNG hỗ trợ: parser nửa vời cho định dạng này trả ra chữ trông có vẻ đúng ' +
    'nhưng sai — nguy hiểm hơn là báo lỗi thẳng.)'
  );
}

/** mimeType để export một file native của Google. */
export function exportMimeFor(kind, format) {
  if (kind === KIND.GOOGLE_DOC) {
    return format === 'text' ? MIME.PLAIN : MIME.MARKDOWN;
  }
  if (kind === KIND.GOOGLE_SLIDES) {
    // KHÔNG export text/plain: bản đó gộp mọi slide làm một, mất ranh giới slide.
    return MIME.PPTX;
  }
  return null;
}
