import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildQuery, GoogleApiError, isTransient, request } from '../src/http.mjs';

function res({ ok = true, status = 200, body = '{}', headers = {} } = {}) {
  return {
    ok,
    status,
    url: 'https://example.test/x',
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

test('buildQuery bỏ undefined/null, giữ false và 0', () => {
  assert.equal(buildQuery({ a: 1, b: undefined, c: null, d: false, e: 0 }), '?a=1&d=false&e=0');
  assert.equal(buildQuery({}), '');
  assert.equal(buildQuery({ r: ['x', 'y'] }), '?r=x&r=y');
});

test('buildQuery encode ký tự đặc biệt của range A1', () => {
  assert.match(buildQuery({ range: "'Tab A'!B2:C3" }), /%27Tab\+A%27%21B2%3AC3/);
});

// HỢP ĐỒNG: packflow đọc Number(err.code ?? err.response.status). Đây là test canh giữ nó.
test('lỗi REST mang code SỐ và response.status', async () => {
  const err = new GoogleApiError(429, {
    error: { code: 429, message: 'Quota exceeded', errors: [{ reason: 'rateLimitExceeded' }] },
  });
  assert.equal(typeof err.code, 'number');
  assert.equal(err.code, 429);
  assert.equal(err.status, 429);
  assert.equal(err.response.status, 429);
  assert.equal(err.message, 'Quota exceeded');
  assert.equal(err.reason, 'rateLimitExceeded');
});

test('lỗi OAuth (error là CHUỖI) lấy được error_description', () => {
  const err = new GoogleApiError(400, {
    error: 'invalid_grant',
    error_description: 'Invalid JWT Signature.',
  });
  assert.equal(err.message, 'Invalid JWT Signature.');
  assert.equal(err.reason, 'invalid_grant');
  assert.equal(err.code, 400);
});

test('body không phải JSON (HTML từ load balancer) vẫn ra lỗi dùng được', async () => {
  const fetchImpl = async () => res({ ok: false, status: 502, body: '<html>Bad Gateway</html>' });
  await assert.rejects(request({ url: 'https://x.test', fetchImpl }), (err) => {
    assert.equal(err.code, 502);
    assert.equal(err.response.data, '<html>Bad Gateway</html>');
    return true;
  });
});

test('isTransient: theo status và theo message mạng', () => {
  for (const s of [408, 429, 500, 502, 503, 504]) {
    assert.ok(isTransient({ code: s }), `status ${s}`);
  }
  for (const s of [400, 401, 403, 404]) {
    assert.equal(isTransient({ code: s }), false, `status ${s}`);
  }
  assert.ok(isTransient(new TypeError('fetch failed')));
  assert.ok(isTransient({ message: 'socket hang up' }));
  assert.equal(isTransient(new Error('bí ẩn')), false);
});

test('retries=0 mặc định: không thử lại', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return res({ ok: false, status: 503, body: '{}' });
  };
  await assert.rejects(request({ url: 'https://x.test', fetchImpl }));
  assert.equal(calls, 1);
});

test('retries>0 chỉ thử lại lỗi tạm thời', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return calls < 3 ? res({ ok: false, status: 503 }) : res({ body: '{"ok":true}' });
  };
  const out = await request({ url: 'https://x.test', fetchImpl, retries: 3, sleepImpl: async () => {} });
  assert.deepEqual(out, { ok: true });
  assert.equal(calls, 3);
});

test('retries>0 KHÔNG thử lại lỗi vĩnh viễn (403)', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return res({ ok: false, status: 403, body: '{"error":{"message":"no access"}}' });
  };
  await assert.rejects(request({ url: 'https://x.test', fetchImpl, retries: 3, sleepImpl: async () => {} }));
  assert.equal(calls, 1);
});

test('body object → JSON + content-type; token → header authorization', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = init;
    return res({ body: '{}' });
  };
  await request({ url: 'https://x.test', method: 'POST', body: { a: 1 }, token: 'tk', fetchImpl });
  assert.equal(seen.body, '{"a":1}');
  assert.equal(seen.headers['content-type'], 'application/json; charset=UTF-8');
  assert.equal(seen.headers.authorization, 'Bearer tk');
});

test('body nhị phân không bị JSON hoá', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = init;
    return res({ body: '{}' });
  };
  const bytes = new Uint8Array([1, 2, 3]);
  await request({ url: 'https://x.test', method: 'PUT', body: bytes, fetchImpl });
  assert.equal(seen.body, bytes);
  assert.equal(seen.headers['content-type'], undefined);
});

test('responseType raw trả nguyên Response để đọc header', async () => {
  const fetchImpl = async () => res({ headers: { location: 'https://upload.test/session' } });
  const out = await request({ url: 'https://x.test', responseType: 'raw', fetchImpl });
  assert.equal(out.headers.get('Location'), 'https://upload.test/session');
});

test('response rỗng (204) trả object rỗng chứ không nổ JSON.parse', async () => {
  const fetchImpl = async () => res({ status: 204, body: '' });
  assert.deepEqual(await request({ url: 'https://x.test', fetchImpl }), {});
});
