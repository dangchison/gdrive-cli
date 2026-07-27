// Quét XML tối giản cho OOXML.
//
// KHÔNG phải parser XML đầy đủ — không namespace resolution, không DTD, không CDATA lồng.
// Đủ dùng vì OOXML do máy sinh, luôn well-formed và không có CDATA. Đổi lại: rất nhanh và
// zero-dep.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text) {
  if (!text || text.indexOf('&') === -1) return text ?? '';
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

/**
 * Regex source khớp tên thẻ BẤT KỂ tiền tố namespace.
 *
 * OOXML không ràng buộc tiền tố: Word/Excel ghi `<sheet>`/`<w:p>`, còn thư viện sinh file
 * (ClosedXML, EPPlus…) ghi `<x:sheet>`. Hardcode một kiểu là đọc được file này, mù file kia
 * — và mù một cách IM LẶNG (0 sheet) chứ không báo lỗi.
 *
 * Chỉ so phần local name, nên `nsTag('w:p')` và `nsTag('p')` là như nhau.
 */
export function nsTag(name) {
  const local = String(name).includes(':') ? String(name).split(':').pop() : String(name);
  return `(?:[A-Za-z_][\\w.-]*:)?${local}`;
}

/** Bóc thuộc tính từ phần bên trong dấu `<...>`. */
export function parseAttrs(tagBody) {
  const attrs = {};
  const re = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagBody))) {
    attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/**
 * Duyệt mọi phần tử tên `name` ở BẤT KỲ độ sâu nào, gọi cb({attrs, inner}).
 *
 * Có đếm độ sâu nên phần tử lồng cùng tên (vd <w:tbl> trong <w:tbl>) không bị cắt sai —
 * cb chỉ nhận phần tử NGOÀI CÙNG của mỗi cụm lồng.
 */
export function forEachElement(xml, name, cb) {
  if (!xml) return;
  const tag = nsTag(name);
  const open = new RegExp(`<${tag}(\\s[^>]*?)?(/)?>`, 'g');
  const closeRe = new RegExp(`^</${tag}>$`);
  let m;

  while ((m = open.exec(xml))) {
    const attrs = parseAttrs(m[1] ?? '');
    if (m[2]) {
      cb({ attrs, inner: '' });
      continue;
    }

    const contentStart = m.index + m[0].length;
    let depth = 1;
    let cursor = contentStart;
    let end = -1;

    // Quét xen kẽ thẻ mở/thẻ đóng cùng tên để tìm đúng thẻ đóng khớp.
    const scan = new RegExp(`<${tag}(\\s[^>]*?)?(/)?>|</${tag}>`, 'g');
    scan.lastIndex = contentStart;
    let s;
    while ((s = scan.exec(xml))) {
      if (closeRe.test(s[0])) {
        depth--;
        if (depth === 0) {
          end = s.index;
          cursor = scan.lastIndex;
          break;
        }
      } else if (!s[2]) {
        depth++;
      }
    }

    if (end === -1) break; // XML cụt — bỏ phần còn lại thay vì ném lỗi
    cb({ attrs, inner: xml.slice(contentStart, end) });
    open.lastIndex = cursor;
  }
}

/** Như forEachElement nhưng trả mảng. */
export function collectElements(xml, name) {
  const out = [];
  forEachElement(xml, name, (el) => out.push(el));
  return out;
}

/**
 * Nối text của mọi `<tag>` trong đoạn XML.
 * `xml:space="preserve"` ⇒ khoảng trắng có nghĩa, tuyệt đối KHÔNG trim.
 */
export function textOf(xml, tag) {
  let out = '';
  forEachElement(xml, tag, ({ inner }) => {
    out += decodeEntities(inner);
  });
  return out;
}

/**
 * Bỏ nhánh <mc:Fallback>: OOXML đặt cùng một nội dung vào cả <mc:Choice> lẫn <mc:Fallback>
 * để tương thích ngược. Không bỏ thì mọi text trong đó bị nhân đôi.
 */
export function dropAlternateFallback(xml) {
  if (!xml || xml.indexOf('Fallback') === -1) return xml;
  const tag = nsTag('Fallback');
  const open = new RegExp(`<${tag}(\\s[^>]*?)?>`, 'g');
  const close = new RegExp(`</${tag}>`, 'g');
  let out = '';
  let cursor = 0;
  let m;
  while ((m = open.exec(xml))) {
    if (m.index < cursor) continue;
    close.lastIndex = m.index;
    const c = close.exec(xml);
    if (!c) break;
    out += xml.slice(cursor, m.index);
    cursor = c.index + c[0].length;
    open.lastIndex = cursor;
  }
  return out + xml.slice(cursor);
}
