import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { _clearTokenCache, createTokenSource, signJwt, TOKEN_URL } from '../src/auth.mjs';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function decodeSegment(seg) {
  return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8'));
}

function serviceAccount(email = 'sa@example.iam.gserviceaccount.com') {
  return { type: 'service_account', clientEmail: email, privateKey };
}

/** fetch giả trả token, đếm số lần bị gọi. */
function tokenFetch({ expiresIn = 3600, onCall } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    onCall?.(calls.length);
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: `token-${calls.length}`, expires_in: expiresIn }),
    };
  };
  impl.calls = calls;
  return impl;
}

test('JWT có 3 đoạn, header/claim đúng, chữ ký verify được bằng public key', () => {
  const nowSec = 1_700_000_000;
  const jwt = signJwt({
    clientEmail: 'sa@example.iam.gserviceaccount.com',
    privateKey,
    scopes: SCOPES,
    nowSec,
  });

  const parts = jwt.split('.');
  assert.equal(parts.length, 3);

  assert.deepEqual(decodeSegment(parts[0]), { alg: 'RS256', typ: 'JWT' });

  const claim = decodeSegment(parts[1]);
  assert.equal(claim.iss, 'sa@example.iam.gserviceaccount.com');
  assert.equal(claim.aud, TOKEN_URL);
  assert.equal(claim.scope, SCOPES.join(' '));
  assert.equal(claim.iat, nowSec);
  assert.equal(claim.exp, nowSec + 3600);
  assert.equal('sub' in claim, false, 'không có sub khi không impersonate');

  const ok = createVerify('RSA-SHA256')
    .update(`${parts[0]}.${parts[1]}`)
    .verify(publicKey, Buffer.from(parts[2], 'base64url'));
  assert.ok(ok, 'chữ ký phải verify được');
});

test('có subject thì thêm claim sub (domain-wide delegation)', () => {
  const jwt = signJwt({
    clientEmail: 'sa@example.iam.gserviceaccount.com',
    privateKey,
    scopes: SCOPES,
    subject: 'user@company.com',
    nowSec: 1_700_000_000,
  });
  assert.equal(decodeSegment(jwt.split('.')[1]).sub, 'user@company.com');
});

test('private key hỏng → lỗi nói rõ phải kiểm tra gì', () => {
  assert.throws(
    () => signJwt({ clientEmail: 'x@y.z', privateKey: 'không-phải-PEM', scopes: SCOPES, nowSec: 1 }),
    /private key hỏng hoặc sai định dạng PEM/,
  );
});

test('service account: đổi JWT lấy token, body đúng grant_type', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(serviceAccount('sa-grant@example.com'), { fetchImpl });

  assert.equal(await src.getToken(SCOPES), 'token-1');
  assert.equal(fetchImpl.calls.length, 1);

  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, TOKEN_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
  const body = new URLSearchParams(init.body);
  assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  assert.equal(body.get('assertion').split('.').length, 3);
});

test('token được cache — gọi lại không đổi token mới', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(serviceAccount('sa-cache@example.com'), { fetchImpl });

  assert.equal(await src.getToken(SCOPES), 'token-1');
  assert.equal(await src.getToken(SCOPES), 'token-1');
  assert.equal(fetchImpl.calls.length, 1);
});

test('token hết hạn (tính cả 60s đệm) thì đổi lại', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch({ expiresIn: 3600 });
  let clock = 1_700_000_000_000;
  const src = createTokenSource(serviceAccount('sa-exp@example.com'), {
    fetchImpl,
    now: () => clock,
  });

  assert.equal(await src.getToken(SCOPES), 'token-1');

  // Còn 90s → vẫn dùng token cũ (đệm là 60s).
  clock += (3600 - 90) * 1000;
  assert.equal(await src.getToken(SCOPES), 'token-1');
  assert.equal(fetchImpl.calls.length, 1);

  // Còn 30s → lọt vào vùng đệm, phải đổi token mới.
  clock += 60 * 1000;
  assert.equal(await src.getToken(SCOPES), 'token-2');
  assert.equal(fetchImpl.calls.length, 2);
});

test('nhiều caller đồng thời chỉ đổi token MỘT lần (chống stampede)', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(serviceAccount('sa-stampede@example.com'), { fetchImpl });

  const tokens = await Promise.all(Array.from({ length: 8 }, () => src.getToken(SCOPES)));
  assert.deepEqual(new Set(tokens), new Set(['token-1']));
  assert.equal(fetchImpl.calls.length, 1);
});

test('scope khác nhau → cache riêng', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(serviceAccount('sa-scopes@example.com'), { fetchImpl });

  await src.getToken(['https://www.googleapis.com/auth/spreadsheets']);
  await src.getToken(['https://www.googleapis.com/auth/drive']);
  assert.equal(fetchImpl.calls.length, 2);

  // Cùng tập scope nhưng khác thứ tự ⇒ vẫn là một khoá cache.
  await src.getToken(['https://www.googleapis.com/auth/drive']);
  assert.equal(fetchImpl.calls.length, 2);
});

test('invalidate vứt token đang cache', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(serviceAccount('sa-inv@example.com'), { fetchImpl });

  assert.equal(await src.getToken(SCOPES), 'token-1');
  src.invalidate(SCOPES);
  assert.equal(await src.getToken(SCOPES), 'token-2');
});

test('authorized_user (ADC) dùng grant refresh_token', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource(
    {
      type: 'authorized_user',
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'rt',
      quotaProjectId: 'my-project',
    },
    { fetchImpl },
  );

  assert.equal(await src.getToken(SCOPES), 'token-1');
  assert.equal(src.quotaProjectId, 'my-project');
  const body = new URLSearchParams(fetchImpl.calls[0].init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'rt');
});

test('access_token dùng thẳng, không gọi mạng', async () => {
  _clearTokenCache();
  const fetchImpl = tokenFetch();
  const src = createTokenSource({ type: 'access_token', token: 'ya29.abc' }, { fetchImpl });

  assert.equal(await src.getToken(SCOPES), 'ya29.abc');
  assert.equal(fetchImpl.calls.length, 0);
});

test('invalid_grant được giải thích thêm nguyên nhân', async () => {
  _clearTokenCache();
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    text: async () =>
      JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
  });
  const src = createTokenSource(serviceAccount('sa-bad@example.com'), { fetchImpl });

  await assert.rejects(src.getToken(SCOPES), (err) => {
    assert.equal(err.code, 400);
    assert.match(err.message, /Invalid JWT Signature/);
    assert.match(err.message, /đồng hồ máy lệch/);
    return true;
  });
});

test('lỗi đổi token không được để lại cache hỏng', async () => {
  _clearTokenCache();
  let fail = true;
  const fetchImpl = async () => {
    if (fail) return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant' }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'good', expires_in: 3600 }) };
  };
  const src = createTokenSource(serviceAccount('sa-recover@example.com'), { fetchImpl });

  await assert.rejects(src.getToken(SCOPES));
  fail = false;
  assert.equal(await src.getToken(SCOPES), 'good');
});
