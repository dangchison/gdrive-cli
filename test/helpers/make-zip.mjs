// Dựng ZIP trong bộ nhớ để làm fixture — không cần file nhị phân trong repo.
//
// Cố ý cho phép dựng cả những biến thể "xấu tính" mà Office thật sinh ra: extra field ở
// local header khác central directory, data descriptor, comment ở EOCD, ZIP64.

import { deflateRawSync } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/**
 * @param {Array<{name: string, data: string|Buffer, store?: boolean, localExtra?: number,
 *                dataDescriptor?: boolean, utf8?: boolean, method?: number,
 *                encrypted?: boolean}>} files
 * @param {{comment?: string}} [opts]
 */
export function makeZip(files, { comment = '' } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const store = f.store === true;
    const body = store ? raw : deflateRawSync(raw);
    const method = f.method ?? (store ? 0 : 8);
    const name = Buffer.from(f.name, 'utf8');

    let flags = 0;
    if (f.utf8 !== false) flags |= 0x0800;
    if (f.dataDescriptor) flags |= 0x0008;
    if (f.encrypted) flags |= 0x0001;

    const localExtra = Buffer.alloc(f.localExtra ?? 0, 0);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOCAL, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    // Bit 3 bật ⇒ local header ghi 0, số thật chỉ có ở central directory.
    lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(f.dataDescriptor ? 0 : body.length, 18);
    lh.writeUInt32LE(f.dataDescriptor ? 0 : raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(localExtra.length, 28);

    locals.push(Buffer.concat([lh, name, localExtra, body]));

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CENTRAL, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); // central KHÔNG có extra dù local có
    ch.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([ch, name]));

    offset += lh.length + name.length + localExtra.length + body.length;
  }

  const cd = Buffer.concat(centrals);
  const commentBuf = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);

  return Buffer.concat([...locals, cd, eocd, commentBuf]);
}
