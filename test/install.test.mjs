// Cài đặt end-to-end trên một HOME tạm — không đụng tới ~/.claude thật.

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { cliPathFor, runInit, validateServiceAccountJson } from '../src/init.mjs';
import { permissionRule } from '../src/settings.mjs';
import { runUninstall } from '../src/uninstall.mjs';

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const KEY_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'proj-test',
  client_email: 'test-sa@proj-test.iam.gserviceaccount.com',
  private_key: privateKey.replace(/\n/g, '\\n'),
});

// PHẢI await fn: nếu để sync thì `finally` xoá thư mục tạm ngay khi promise vừa được trả
// về, trong lúc test vẫn đang chạy.
async function sandbox(fn) {
  const home = mkdtempSync(join(tmpdir(), 'gdrive-home-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const keyFile = join(home, 'key.json');
  writeFileSync(keyFile, KEY_JSON);
  try {
    return await fn({ home, keyFile, log: () => {} });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const baseFlags = (keyFile) => ({
  yes: true,
  'sa-json': keyFile,
  mode: 'readonly',
  'no-test': true,
});

test('validate: JSON hỏng / sai type / thiếu field / key cụt', () => {
  assert.throws(() => validateServiceAccountJson('không phải json'), /JSON hợp lệ/);
  assert.throws(() => validateServiceAccountJson('{"type":"authorized_user"}'), /service_account/);
  assert.throws(
    () => validateServiceAccountJson('{"type":"service_account","private_key":"x"}'),
    /client_email/,
  );
  assert.throws(
    () => validateServiceAccountJson('{"type":"service_account","client_email":"a@b.c","private_key":"-----BEGIN PRIVATE KEY-----\\nCỤT\\n-----END PRIVATE KEY-----"}'),
    /private_key không đọc được/,
  );
});

test('validate: key hợp lệ → mở literal \\n thành xuống dòng thật', () => {
  const out = validateServiceAccountJson(KEY_JSON);
  assert.equal(out.clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
  assert.match(out.privateKey, /^-----BEGIN PRIVATE KEY-----\n/);
  assert.equal(out.projectId, 'proj-test');
});

test('init: ghi config chmod 600, copy code, cài skill đã thay placeholder', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    assert.equal(await runInit(baseFlags(keyFile), { home, log, env: {} }), true);

    const cfgFile = join(home, '.claude', 'gdrive.json');
    const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
    assert.equal(cfg.clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
    assert.equal(cfg.mode, 'readonly');
    if (process.platform !== 'win32') {
      assert.equal(statSync(cfgFile).mode & 0o777, 0o600, 'config chứa private key → phải 600');
    }

    const cliPath = cliPathFor(home);
    assert.ok(existsSync(cliPath), 'phải copy bin/');
    assert.ok(existsSync(join(home, '.claude', 'gdrive', 'src', 'auth.mjs')), 'phải copy src/');

    const skill = readFileSync(join(home, '.claude', 'skills', 'gdrive', 'SKILL.md'), 'utf8');
    assert.doesNotMatch(skill, /\{\{CLI\}\}/, 'placeholder phải được thay hết');
    assert.ok(skill.includes(cliPath), 'skill phải trỏ đúng đường dẫn tuyệt đối');
  });
});

test('init: KHÔNG tự thêm allow-rule khi chưa được đồng ý', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    await runInit(baseFlags(keyFile), { home, log, env: {} });
    const settingsFile = join(home, '.claude', 'settings.json');
    assert.equal(existsSync(settingsFile), false, 'không được đụng settings.json khi không hỏi được');
  });
});

test('init --allow-bash: thêm rule, giữ rule sẵn có, có sao lưu', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    const settingsFile = join(home, '.claude', 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({ permissions: { allow: ['Bash(git status)'] } }, null, 2));

    await runInit({ ...baseFlags(keyFile), 'allow-bash': true }, { home, log, env: {} });

    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    assert.deepEqual(settings.permissions.allow, [
      'Bash(git status)',
      permissionRule(cliPathFor(home)),
    ]);
  });
});

test('init: settings.json hỏng thì THROW chứ không ghi đè', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    const settingsFile = join(home, '.claude', 'settings.json');
    const broken = '{ "permissions": { "allow": [ ,,, }';
    writeFileSync(settingsFile, broken);

    await assert.rejects(
      runInit({ ...baseFlags(keyFile), 'allow-bash': true }, { home, log, env: {} }),
      /không phải JSON hợp lệ/,
    );
    assert.equal(readFileSync(settingsFile, 'utf8'), broken, 'file người dùng phải còn nguyên');
  });
});

test('init chạy lại: idempotent, không nhân đôi rule', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    await runInit({ ...baseFlags(keyFile), 'allow-bash': true }, { home, log, env: {} });
    await runInit({ ...baseFlags(keyFile), 'allow-bash': true }, { home, log, env: {} });
    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal(settings.permissions.allow.filter((r) => r.includes('gdrive')).length, 1);
  });
});

test('init --no-skill: chỉ cài CLI', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    await runInit({ ...baseFlags(keyFile), 'no-skill': true }, { home, log, env: {} });
    assert.ok(existsSync(cliPathFor(home)));
    assert.equal(existsSync(join(home, '.claude', 'skills', 'gdrive', 'SKILL.md')), false);
  });
});

test('uninstall: gỡ code + skill + rule, GIỮ config (còn private key)', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    await runInit({ ...baseFlags(keyFile), 'allow-bash': true }, { home, log, env: {} });
    runUninstall({}, { home, log });

    assert.equal(existsSync(join(home, '.claude', 'gdrive')), false);
    assert.equal(existsSync(join(home, '.claude', 'skills', 'gdrive')), false);

    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.equal('permissions' in settings, false, 'rule cuối cùng bị gỡ → dọn luôn key rỗng');

    assert.ok(existsSync(join(home, '.claude', 'gdrive.json')), 'config giữ lại khi không --purge');
  });
});

test('uninstall --purge: xoá cả config', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    await runInit(baseFlags(keyFile), { home, log, env: {} });
    runUninstall({ purge: true }, { home, log });
    assert.equal(existsSync(join(home, '.claude', 'gdrive.json')), false);
  });
});

test('uninstall trên settings.json hỏng: không đụng vào file', async () => {
  await sandbox(({ home, log }) => {
    const settingsFile = join(home, '.claude', 'settings.json');
    const broken = '{ hỏng';
    writeFileSync(settingsFile, broken);
    runUninstall({}, { home, log });
    assert.equal(readFileSync(settingsFile, 'utf8'), broken);
  });
});
