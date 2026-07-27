// Đọc .pptx → text theo từng slide (giữ ranh giới slide).
//
// Đây cũng là đường đọc Google Slides: export sang .pptx rồi parse ở đây, vì bản export
// text/plain của Drive gộp hết mọi slide vào một khối, mất ranh giới.

import { decodeEntities, dropAlternateFallback, forEachElement, nsTag } from './xml.mjs';
import { openZip, ZipError } from './zip.mjs';

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;
const NOTES_RE = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;

// Tiền tố namespace không cố định — xem chú thích trong xml.mjs/nsTag.
const A_T = nsTag('t');
const A_BR = nsTag('br');
const TEXT_RE = new RegExp(
  `<${A_T}(?:\\s[^>]*)?>([\\s\\S]*?)</${A_T}>|<${A_T}\\s*/>|<${A_BR}(?:\\s[^>]*)?/>`,
  'g',
);
const BR_HEAD = new RegExp(`^<${A_BR}`);

/** Text của một shape/paragraph: gom <a:t>, ngắt dòng theo <a:br>. */
function paragraphText(xml) {
  let out = '';
  TEXT_RE.lastIndex = 0;
  let m;
  while ((m = TEXT_RE.exec(xml))) {
    if (m[1] !== undefined) out += decodeEntities(m[1]);
    else if (BR_HEAD.test(m[0])) out += '\n';
  }
  return out;
}

function paragraphsOf(xml) {
  const out = [];
  forEachElement(dropAlternateFallback(xml), 'a:p', ({ inner }) => {
    const text = paragraphText(inner).trim();
    if (text) out.push(text);
  });
  return out;
}

/**
 * `slide10.xml` phải xếp SAU `slide2.xml` — sort theo chuỗi là sai.
 */
function numberedParts(names, re) {
  return names
    .map((name) => {
      const m = re.exec(name);
      return m ? { name, n: Number(m[1]) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.n - b.n);
}

/**
 * @param {Buffer} buffer nội dung .pptx
 * @param {{includeNotes?: boolean}} [opts]
 * @returns {{slides: Array<{number:number,title:string|null,body:string[],notes:string|null}>, warnings: string[]}}
 */
export function readPptx(buffer, { includeNotes = false } = {}) {
  const zip = openZip(buffer);
  const names = zip.names();
  const slideParts = numberedParts(names, SLIDE_RE);
  if (!slideParts.length) {
    throw new ZipError('Không tìm thấy ppt/slides/slideN.xml — file không phải .pptx hợp lệ.');
  }

  const notesByNumber = new Map();
  if (includeNotes) {
    for (const { name, n } of numberedParts(names, NOTES_RE)) {
      const text = paragraphsOf(zip.readText(name) ?? '').join('\n');
      if (text) notesByNumber.set(n, text);
    }
  }

  const warnings = [];
  const slides = slideParts.map(({ name, n }, i) => {
    const paras = paragraphsOf(zip.readText(name) ?? '');
    // Slide layout không đảm bảo dòng đầu là tiêu đề, nhưng thực tế đúng đa số — và ta nói
    // rõ đó là suy đoán chứ không khẳng định.
    const [first, ...rest] = paras;
    return {
      number: i + 1,
      partNumber: n,
      title: first ?? null,
      body: rest,
      notes: notesByNumber.get(n) ?? null,
    };
  });

  if (names.some((x) => /^ppt\/embeddings\//.test(x))) {
    warnings.push('Có object nhúng (Excel/Word) — nội dung bên trong KHÔNG được trích.');
  }
  if (names.some((x) => /^ppt\/media\//.test(x))) {
    warnings.push('Có hình/media — chỉ trích được text, không trích chữ trong ảnh.');
  }

  return { slides, warnings };
}

/** Dựng text phẳng từ kết quả readPptx. */
export function pptxToText(result, { format = 'markdown' } = {}) {
  return result.slides
    .map((s) => {
      const head =
        format === 'markdown'
          ? `## Slide ${s.number}${s.title ? ` — ${s.title}` : ''}`
          : `--- Slide ${s.number}${s.title ? `: ${s.title}` : ''} ---`;
      const lines = [head, ...s.body];
      if (s.notes) lines.push('', format === 'markdown' ? `> **Ghi chú:** ${s.notes}` : `[Ghi chú] ${s.notes}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
