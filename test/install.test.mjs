// Cấu hình + dọn bản cũ, chạy trên HOME tạm — không đụng ~/.claude thật.

import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { pluginConfigPath, pluginDataDir, readConfig } from '../src/config.mjs';
import { runInit, validateServiceAccountJson } from '../src/init.mjs';
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

// PHẢI await fn: sync thì `finally` xoá thư mục tạm khi test async còn đang chạy.
async function sandbox(fn) {
  const home = mkdtempSync(join(tmpdir(), 'gdrive-home-'));
  mkdirSync(join(home, '.claude'), { recursive: true });
  const keyFile = join(home, 'key.json');
  writeFileSync(keyFile, KEY_JSON);
  // env rỗng → pluginDataDir tự tính từ home, không dính CLAUDE_PLUGIN_DATA của máy thật.
  try {
    return await fn({ home, keyFile, env: {}, log: () => {} });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const baseFlags = (keyFile) => ({ yes: true, 'sa-json': keyFile, mode: 'readonly', 'no-test': true });

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

test('pluginDataDir: ưu tiên CLAUDE_PLUGIN_DATA, không có thì tự tính', () => {
  assert.equal(pluginDataDir({ CLAUDE_PLUGIN_DATA: '/x/y' }, '/home/u'), '/x/y');
  assert.equal(
    pluginDataDir({}, '/home/u'),
    join('/home/u', '.claude', 'plugins', 'data', 'gdrive-gdrive-cli'),
  );
});

test('init: ghi cấu hình vào thư mục data plugin, chmod 600', async () => {
  await sandbox(async ({ home, keyFile, env, log }) => {
    assert.equal(await runInit(baseFlags(keyFile), { home, log, env }), true);

    const file = pluginConfigPath(env, home);
    assert.ok(existsSync(file), 'phải ghi vào thư mục data của plugin');
    const cfg = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(cfg.clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
    assert.equal(cfg.mode, 'readonly');
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600, 'chứa private key → phải 600');
    }
  });
});

test('init: KHÔNG copy code, KHÔNG cài skill, KHÔNG đụng settings.json', async () => {
  await sandbox(async ({ home, keyFile, env, log }) => {
    await runInit(baseFlags(keyFile), { home, log, env });
    assert.equal(existsSync(join(home, '.claude', 'gdrive')), false, 'không copy code nữa');
    assert.equal(existsSync(join(home, '.claude', 'skills', 'gdrive')), false, 'skill do plugin lo');
    assert.equal(existsSync(join(home, '.claude', 'settings.json')), false, 'MCP không cần allow-rule');
  });
});

test('init: chạy lại thì giữ credential cũ, đổi được mode', async () => {
  await sandbox(async ({ home, keyFile, env, log }) => {
    await runInit(baseFlags(keyFile), { home, log, env });
    await runInit({ yes: true, mode: 'readwrite', 'no-test': true }, { home, log, env });
    const cfg = readConfig(home, env);
    assert.equal(cfg.clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
    assert.equal(cfg.mode, 'readwrite');
  });
});

test('readConfig: rơi về vị trí CŨ khi chưa có cấu hình plugin', async () => {
  await sandbox(async ({ home, env }) => {
    writeFileSync(
      join(home, '.claude', 'gdrive.json'),
      JSON.stringify({ clientEmail: 'cu@x.com', privateKey: 'k', mode: 'readwrite' }),
    );
    const cfg = readConfig(home, env);
    assert.equal(cfg.clientEmail, 'cu@x.com', 'người cài kiểu cũ không mất cấu hình');
  });
});

test('readConfig: cấu hình plugin THẮNG cấu hình cũ', async () => {
  await sandbox(async ({ home, keyFile, env, log }) => {
    writeFileSync(
      join(home, '.claude', 'gdrive.json'),
      JSON.stringify({ clientEmail: 'cu@x.com', privateKey: 'k' }),
    );
    await runInit(baseFlags(keyFile), { home, log, env });
    assert.equal(readConfig(home, env).clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
  });
});

test('uninstall: dọn sạch 4 chỗ của bản cài npx cũ, giữ rule người khác', async () => {
  await sandbox(async ({ home, log }) => {
    mkdirSync(join(home, '.claude', 'gdrive', 'bin'), { recursive: true });
    mkdirSync(join(home, '.claude', 'skills', 'gdrive'), { recursive: true });
    writeFileSync(join(home, '.claude', 'gdrive.json'), '{}');
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(git status)', `Bash(node ${home}/.claude/gdrive/bin/cli.mjs:*)`] },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'cc-notify-telegram.mjs stop' }] }] },
      }),
    );

    runUninstall({ purge: true }, { home, log });

    assert.equal(existsSync(join(home, '.claude', 'gdrive')), false);
    assert.equal(existsSync(join(home, '.claude', 'skills', 'gdrive')), false);
    assert.equal(existsSync(join(home, '.claude', 'gdrive.json')), false);

    const settings = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    assert.deepEqual(settings.permissions.allow, ['Bash(git status)'], 'rule khác phải còn');
    assert.ok(settings.hooks.Stop, 'hook của người khác phải còn nguyên');
  });
});

test('uninstall: không --purge thì giữ config cũ (còn private key)', async () => {
  await sandbox(async ({ home, log }) => {
    writeFileSync(join(home, '.claude', 'gdrive.json'), '{}');
    runUninstall({}, { home, log });
    assert.ok(existsSync(join(home, '.claude', 'gdrive.json')));
  });
});

test('uninstall: settings.json hỏng thì KHÔNG đụng vào file', async () => {
  await sandbox(async ({ home, log }) => {
    const file = join(home, '.claude', 'settings.json');
    const broken = '{ hỏng';
    writeFileSync(file, broken);
    runUninstall({}, { home, log });
    assert.equal(readFileSync(file, 'utf8'), broken);
  });
});

test('uninstall: máy sạch thì không nổ', async () => {
  await sandbox(async ({ home, log }) => {
    assert.equal(runUninstall({}, { home, log }), true);
  });
});

// HỒI QUY 2026-07-28: tên thư mục data KHÔNG đoán được. MCP server nhận
// CLAUDE_PLUGIN_DATA=…/gdrive-inline còn CLI tính ra …/gdrive-gdrive-cli → server không
// thấy credential dù `status` xanh. Đây là ca đã xảy ra thật, không phải giả định.
test('config: CLI ghi một tên thư mục, server đọc tên KHÁC — vẫn phải thấy nhau', async () => {
  await sandbox(async ({ home, keyFile, env, log }) => {
    // Claude Code đã tạo sẵn thư mục data với tên khác (như thực tế).
    const serverDir = join(home, '.claude', 'plugins', 'data', 'gdrive-inline');
    mkdirSync(serverDir, { recursive: true });

    // CLI chạy NGOÀI Claude Code: không có CLAUDE_PLUGIN_DATA.
    await runInit(baseFlags(keyFile), { home, log, env: {} });

    // Server chạy TRONG Claude Code: env trỏ thư mục của nó.
    const cfg = readConfig(home, { CLAUDE_PLUGIN_DATA: serverDir });
    assert.ok(cfg, 'server PHẢI đọc được cấu hình mà CLI vừa ghi');
    assert.equal(cfg.clientEmail, 'test-sa@proj-test.iam.gserviceaccount.com');
  });
});

test('config: chiều ngược lại — server ghi, CLI đọc được', async () => {
  await sandbox(async ({ home, keyFile, log }) => {
    const serverDir = join(home, '.claude', 'plugins', 'data', 'gdrive-inline');
    mkdirSync(serverDir, { recursive: true });
    await runInit(baseFlags(keyFile), { home, log, env: { CLAUDE_PLUGIN_DATA: serverDir } });
    assert.ok(readConfig(home, {}), 'CLI (không có env) PHẢI thấy cấu hình server ghi');
  });
});
