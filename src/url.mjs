// Tách URL Google (Sheets/Docs/Slides/Drive) hoặc file id trần thành {kind, id, gid}.
//
// Mọi lệnh của CLI nhận thẳng URL người dùng dán vào, nên toàn bộ việc bóc id/gid nằm ở
// đây — người gọi không bao giờ phải làm 2 bước.

export class UrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlError';
  }
}

/** Loại tài nguyên suy ra được từ URL. `unknown` = phải hỏi Drive mới biết. */
export const KIND = {
  SPREADSHEET: 'spreadsheet',
  DOCUMENT: 'document',
  PRESENTATION: 'presentation',
  FILE: 'file',
  FOLDER: 'folder',
  UNKNOWN: 'unknown',
};

const EDITOR_PATH_KIND = {
  spreadsheets: KIND.SPREADSHEET,
  document: KIND.DOCUMENT,
  presentation: KIND.PRESENTATION,
};

// Link "Publish to the web" có dạng /spreadsheets/d/e/2PACX-.../pubhtml — cái nằm sau /d/
// là "e", KHÔNG phải file id. Regex ngây thơ /\/spreadsheets\/d\/([\w-]+)/ trả về id="e"
// rồi 404 với thông báo khó hiểu; bắt riêng để báo đúng bệnh.
const PUBLISHED_RE = /\/(spreadsheets|document|presentation)\/d\/e\//;

const EDITOR_RE = /\/(spreadsheets|document|presentation)\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;
const DRIVE_FILE_RE = /\/file\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;
const DRIVE_FOLDER_RE = /\/(?:drive\/)?(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)/;
const QUERY_ID_RE = /[?&]id=([A-Za-z0-9_-]+)/;
const GID_RE = /[#?&]gid=(\d+)/;

// Id của Drive là base64url, thực tế 25–60 ký tự. Nới xuống 8 để không từ chối oan các id
// ngắn bất thường, nhưng vẫn đủ chặt để không nuốt nhầm một chuỗi bất kỳ.
const BARE_ID_RE = /^[A-Za-z0-9_-]{8,}$/;

/**
 * @param {string} input URL đầy đủ hoặc file id trần.
 * @returns {{kind: string, id: string, gid: string|null}}
 */
export function parseGoogleUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new UrlError('Thiếu URL hoặc file id.');
  }
  const raw = input.trim();

  // Id trần: không có dấu phân cách của URL.
  if (!raw.includes('/') && !raw.includes(':') && !raw.includes('?')) {
    if (!BARE_ID_RE.test(raw)) {
      throw new UrlError(
        `"${raw}" không phải URL Google hợp lệ cũng không phải file id. ` +
          'Dán link đầy đủ (docs.google.com/... hoặc drive.google.com/...) hoặc id của file.',
      );
    }
    return { kind: KIND.UNKNOWN, id: raw, gid: null };
  }

  const published = raw.match(PUBLISHED_RE);
  if (published) {
    throw new UrlError(
      'Đây là link "Publish to the web" (/d/e/...), không phải link file — nó không chứa ' +
        'file id nên API không đọc được.\n' +
        `Mở file trong Google ${published[1] === 'spreadsheets' ? 'Sheets' : 'Docs/Slides'} ` +
        'rồi copy link trên thanh địa chỉ (dạng /d/<id>/edit).',
    );
  }

  const gidMatch = raw.match(GID_RE);
  const gid = gidMatch ? gidMatch[1] : null;

  const editor = raw.match(EDITOR_RE);
  if (editor) return { kind: EDITOR_PATH_KIND[editor[1]], id: editor[2], gid };

  const folder = raw.match(DRIVE_FOLDER_RE);
  if (folder) return { kind: KIND.FOLDER, id: folder[1], gid: null };

  const file = raw.match(DRIVE_FILE_RE);
  if (file) return { kind: KIND.FILE, id: file[1], gid };

  // drive.google.com/open?id=... và /uc?id=...
  const queryId = raw.match(QUERY_ID_RE);
  if (queryId) return { kind: KIND.UNKNOWN, id: queryId[1], gid };

  throw new UrlError(
    `Không tách được file id từ "${raw}".\n` +
      'Các dạng nhận được: /spreadsheets/d/<id>, /document/d/<id>, /presentation/d/<id>, ' +
      '/file/d/<id>, /folders/<id>, ?id=<id>, hoặc id trần.',
  );
}

/**
 * Bọc tên tab thành A1 an toàn: luôn quote, và nhân đôi dấu nháy đơn bên trong.
 * Đây là chỗ 8 bản fork trong packflow đều tự viết lại và viết sai.
 */
export function quoteSheetTitle(title) {
  return `'${String(title).replace(/'/g, "''")}'`;
}

/** Ghép tên tab + range tương đối thành range A1 đầy đủ. */
export function buildA1(title, range) {
  const quoted = quoteSheetTitle(title);
  return range ? `${quoted}!${range}` : quoted;
}

/** "AB" → 27 (1-based). Dùng cho cả cột người dùng gõ lẫn ref ô trong xlsx. */
export function columnLetterToIndex(letters) {
  const upper = String(letters).toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) throw new UrlError(`Cột "${letters}" không hợp lệ.`);
  let n = 0;
  for (const ch of upper) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 27 → "AA". (1-based, nghịch đảo của columnLetterToIndex.) */
export function indexToColumnLetter(index) {
  if (!Number.isInteger(index) || index < 1) {
    throw new UrlError(`Chỉ số cột "${index}" không hợp lệ.`);
  }
  let n = index;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
