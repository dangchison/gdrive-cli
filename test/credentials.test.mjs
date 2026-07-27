import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { adcPath, CredentialError, resolveCredentials, scopesForMode } from '../src/credentials.mjs';

const PEM = '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n';
const PEM_OPEN = '-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----';

/** Home tạm + `run` luôn ném, để không rơi xuống gcloud thật của máy. */
function sandbox(fn) {
  const home = mkdtempSync(join(tmpdir(), 'gdrive-cred-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const noGcloud = () => {
    throw new Error('gcloud không có');
  };
  try {
    return fn({ home, run: noGcloud });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function sa(overrides = {}) {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'sa@proj.iam.gserviceaccount.com',
    private_key: PEM,
    project_id: 'proj',
    ...overrides,
  });
}

test('explicit đứng trước tất cả', () => {
  sandbox(({ home, run }) => {
    const cred = resolveCredentials({
      explicit: { clientEmail: 'x@y.z', privateKey: PEM },
      env: { GOOGLE_SERVICE_ACCOUNT_JSON: sa() },
      home,
      run,
    });
    assert.equal(cred.source, 'explicit');
    assert.equal(cred.clientEmail, 'x@y.z');
    assert.equal(cred.privateKey, PEM_OPEN, 'literal \\n phải được mở thành xuống dòng thật');
  });
});

test('GOOGLE_SERVICE_ACCOUNT_JSON: JSON thô', () => {
  sandbox(({ home, run }) => {
    const cred = resolveCredentials({ env: { GOOGLE_SERVICE_ACCOUNT_JSON: sa() }, home, run });
    assert.equal(cred.type, 'service_account');
    assert.equal(cred.clientEmail, 'sa@proj.iam.gserviceaccount.com');
    assert.equal(cred.projectId, 'proj');
  });
});

test('GOOGLE_SERVICE_ACCOUNT_JSON: base64 (dạng secret CI hay dùng)', () => {
  sandbox(({ home, run }) => {
    const b64 = Buffer.from(sa()).toString('base64');
    const cred = resolveCredentials({ env: { GOOGLE_SERVICE_ACCOUNT_JSON: b64 }, home, run });
    assert.equal(cred.clientEmail, 'sa@proj.iam.gserviceaccount.com');
  });
});

test('GOOGLE_SERVICE_ACCOUNT_JSON hỏng → lỗi nói rõ, không im lặng bỏ qua', () => {
  sandbox(({ home, run }) => {
    assert.throws(
      () => resolveCredentials({ env: { GOOGLE_SERVICE_ACCOUNT_JSON: 'rác' }, home, run }),
      CredentialError,
    );
  });
});

test('cặp GOOGLE_* rời', () => {
  sandbox(({ home, run }) => {
    const cred = resolveCredentials({
      env: { GOOGLE_SERVICE_ACCOUNT_EMAIL: 'a@b.c', GOOGLE_PRIVATE_KEY: PEM },
      home,
      run,
    });
    assert.equal(cred.source, 'GOOGLE_SERVICE_ACCOUNT_EMAIL+GOOGLE_PRIVATE_KEY');
  });
});

// Tên packflow đang dùng — giữ vĩnh viễn để redact.mjs của packflow không hỏng âm thầm.
test('cặp DRIVE_* (tên packflow) vẫn là first-class', () => {
  sandbox(({ home, run }) => {
    const cred = resolveCredentials({
      env: { DRIVE_SERVICE_ACCOUNT_EMAIL: 'qc@rv.iam.gserviceaccount.com', DRIVE_PRIVATE_KEY: PEM },
      home,
      run,
    });
    assert.equal(cred.clientEmail, 'qc@rv.iam.gserviceaccount.com');
    assert.equal(cred.privateKey, PEM_OPEN);
  });
});

test('GOOGLE_* thắng DRIVE_* khi có cả hai', () => {
  sandbox(({ home, run }) => {
    const cred = resolveCredentials({
      env: {
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'new@x.com',
        GOOGLE_PRIVATE_KEY: PEM,
        DRIVE_SERVICE_ACCOUNT_EMAIL: 'old@x.com',
        DRIVE_PRIVATE_KEY: PEM,
      },
      home,
      run,
    });
    assert.equal(cred.clientEmail, 'new@x.com');
  });
});

test('GOOGLE_APPLICATION_CREDENTIALS trỏ tới file key', () => {
  sandbox(({ home, run }) => {
    const file = join(home, 'key.json');
    writeFileSync(file, sa());
    const cred = resolveCredentials({ env: { GOOGLE_APPLICATION_CREDENTIALS: file }, home, run });
    assert.equal(cred.source, 'GOOGLE_APPLICATION_CREDENTIALS');
    assert.equal(cred.clientEmail, 'sa@proj.iam.gserviceaccount.com');
  });
});

test('config ~/.claude/gdrive.json khi env trống', () => {
  sandbox(({ home, run }) => {
    writeFileSync(
      join(home, '.claude', 'gdrive.json'),
      JSON.stringify({ clientEmail: 'cfg@x.com', privateKey: PEM, mode: 'readonly' }),
    );
    const cred = resolveCredentials({ env: {}, home, run });
    assert.equal(cred.source, '~/.claude/gdrive.json');
    assert.equal(cred.clientEmail, 'cfg@x.com');
  });
});

test('env thắng config — CI không có ~/.claude nhưng máy dev thì có cả hai', () => {
  sandbox(({ home, run }) => {
    writeFileSync(
      join(home, '.claude', 'gdrive.json'),
      JSON.stringify({ clientEmail: 'cfg@x.com', privateKey: PEM }),
    );
    const cred = resolveCredentials({
      env: { DRIVE_SERVICE_ACCOUNT_EMAIL: 'env@x.com', DRIVE_PRIVATE_KEY: PEM },
      home,
      run,
    });
    assert.equal(cred.clientEmail, 'env@x.com');
  });
});

test('ADC authorized_user', () => {
  sandbox(({ home, run }) => {
    const dir = join(home, '.config', 'gcloud');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'application_default_credentials.json'),
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'cid',
        client_secret: 'cs',
        refresh_token: 'rt',
        quota_project_id: 'qp',
      }),
    );
    const cred = resolveCredentials({ env: {}, home, run });
    assert.equal(cred.type, 'authorized_user');
    assert.equal(cred.quotaProjectId, 'qp');
  });
});

test('CLOUDSDK_CONFIG đổi vị trí file ADC', () => {
  assert.equal(
    adcPath({ CLOUDSDK_CONFIG: '/custom/gcloud' }, '/home/u'),
    join('/custom/gcloud', 'application_default_credentials.json'),
  );
});

test('gcloud print-access-token là cứu cánh cuối', () => {
  sandbox(({ home }) => {
    const cred = resolveCredentials({
      env: {},
      home,
      run: () => 'ya29.fake-token\n',
    });
    assert.equal(cred.type, 'access_token');
    assert.equal(cred.token, 'ya29.fake-token');
  });
});

test('không có gì → lỗi liệt kê đủ cách khắc phục', () => {
  sandbox(({ home, run }) => {
    assert.throws(() => resolveCredentials({ env: {}, home, run }), (err) => {
      assert.ok(err instanceof CredentialError);
      assert.match(err.message, /gdrive-cli init/);
      assert.match(err.message, /GOOGLE_SERVICE_ACCOUNT_JSON/);
      assert.match(err.message, /DRIVE_SERVICE_ACCOUNT_EMAIL/);
      assert.match(err.message, /gcloud auth application-default login/);
      return true;
    });
  });
});

test('scope theo mode', () => {
  assert.deepEqual(scopesForMode('readonly'), [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
  ]);
  assert.deepEqual(scopesForMode('readwrite'), [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  assert.deepEqual(scopesForMode(undefined), scopesForMode('readonly'), 'mặc định là readonly');
});
