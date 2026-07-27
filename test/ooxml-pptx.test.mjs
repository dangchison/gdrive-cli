import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pptxToText, readPptx } from '../src/ooxml-pptx.mjs';
import { makeZip } from './helpers/make-zip.mjs';

const slide = (title, ...body) => `<?xml version="1.0"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
  <p:sp><p:txBody>
    <a:p><a:r><a:t>${title}</a:t></a:r></a:p>
  </p:txBody></p:sp>
  <p:sp><p:txBody>
    ${body.map((b) => `<a:p><a:r><a:t>${b}</a:t></a:r></a:p>`).join('')}
  </p:txBody></p:sp>
</p:spTree></p:cSld></p:sld>`;

const notes = (text) => `<p:notes xmlns:a="a"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:notes>`;

function pptx(extra = []) {
  return makeZip([
    { name: 'ppt/slides/slide1.xml', data: slide('Slide một', 'điểm A', 'điểm B') },
    { name: 'ppt/slides/slide2.xml', data: slide('Slide hai', 'nội dung 2'), dataDescriptor: true },
    { name: 'ppt/slides/slide10.xml', data: slide('Slide mười', 'nội dung 10'), localExtra: 20 },
    ...extra,
  ]);
}

// Sort chuỗi sẽ cho slide10 đứng trước slide2 — đây là bẫy kinh điển.
test('slide sắp xếp theo SỐ, không theo chuỗi', () => {
  const { slides } = readPptx(pptx());
  assert.deepEqual(
    slides.map((s) => s.title),
    ['Slide một', 'Slide hai', 'Slide mười'],
  );
  assert.deepEqual(
    slides.map((s) => s.number),
    [1, 2, 3],
  );
});

test('mỗi slide giữ ranh giới riêng, dòng đầu là tiêu đề suy đoán', () => {
  const { slides } = readPptx(pptx());
  assert.equal(slides[0].title, 'Slide một');
  assert.deepEqual(slides[0].body, ['điểm A', 'điểm B']);
  assert.deepEqual(slides[1].body, ['nội dung 2']);
});

test('mặc định KHÔNG lấy notes; bật includeNotes mới có', () => {
  const extra = [
    { name: 'ppt/notesSlides/notesSlide1.xml', data: notes('ghi chú cho slide 1') },
    { name: 'ppt/notesSlides/notesSlide10.xml', data: notes('ghi chú cho slide 10') },
  ];
  assert.equal(readPptx(pptx(extra)).slides[0].notes, null);

  const withNotes = readPptx(pptx(extra), { includeNotes: true });
  assert.equal(withNotes.slides[0].notes, 'ghi chú cho slide 1');
  assert.equal(withNotes.slides[1].notes, null, 'slide 2 không có notes');
  assert.equal(withNotes.slides[2].notes, 'ghi chú cho slide 10', 'notes khớp theo SỐ part');
});

test('<a:br/> thành xuống dòng trong cùng một paragraph', () => {
  const zip = makeZip([
    {
      name: 'ppt/slides/slide1.xml',
      data: `<p:sld><a:p><a:r><a:t>dòng 1</a:t></a:r><a:br/><a:r><a:t>dòng 2</a:t></a:r></a:p></p:sld>`,
    },
  ]);
  assert.equal(readPptx(zip).slides[0].title, 'dòng 1\ndòng 2');
});

test('bỏ nhánh mc:Fallback', () => {
  const zip = makeZip([
    {
      name: 'ppt/slides/slide1.xml',
      data: `<p:sld><mc:AlternateContent>
        <mc:Choice><a:p><a:r><a:t>hộp chữ</a:t></a:r></a:p></mc:Choice>
        <mc:Fallback><a:p><a:r><a:t>hộp chữ</a:t></a:r></a:p></mc:Fallback>
      </mc:AlternateContent></p:sld>`,
    },
  ]);
  const { slides } = readPptx(zip);
  assert.equal(slides[0].title, 'hộp chữ');
  assert.equal(slides[0].body.length, 0);
});

test('paragraph rỗng bị bỏ, không sinh dòng trắng', () => {
  const zip = makeZip([
    { name: 'ppt/slides/slide1.xml', data: `<p:sld><a:p/><a:p><a:r><a:t>chỉ một</a:t></a:r></a:p><a:p><a:r><a:t>  </a:t></a:r></a:p></p:sld>` },
  ]);
  const { slides } = readPptx(zip);
  assert.equal(slides[0].title, 'chỉ một');
  assert.deepEqual(slides[0].body, []);
});

test('cảnh báo media và object nhúng', () => {
  const { warnings } = readPptx(
    pptx([
      { name: 'ppt/media/image1.png', data: Buffer.from([1, 2, 3]), store: true },
      { name: 'ppt/embeddings/Book1.xlsx', data: Buffer.from([4, 5]), store: true },
    ]),
  );
  assert.ok(warnings.some((w) => /media|hình/.test(w)));
  assert.ok(warnings.some((w) => /nhúng/.test(w)));
});

test('không có slide nào → lỗi nói rõ', () => {
  assert.throws(() => readPptx(makeZip([{ name: 'a.txt', data: 'x' }])), /slideN\.xml/);
});

test('pptxToText dựng markdown có tiêu đề slide', () => {
  const text = pptxToText(readPptx(pptx()));
  assert.match(text, /## Slide 1 — Slide một/);
  assert.match(text, /## Slide 3 — Slide mười/);
  assert.match(text, /điểm A/);
});

test('pptxToText format text dùng dải phân cách thay vì heading', () => {
  const text = pptxToText(readPptx(pptx()), { format: 'text' });
  assert.match(text, /--- Slide 1: Slide một ---/);
  assert.doesNotMatch(text, /^##/m);
});
