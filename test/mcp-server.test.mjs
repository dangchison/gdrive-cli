// MCP server: chạy server THẬT như tiến trình con, feed byte-stream JSON-RPC, đọc frame trả về.
// Không cần mạng, không cần credential — client dựng lazy nên tools/list vẫn chạy.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { buildTools } from '../src/tools.mjs';

const SERVER = join(dirname(dirname(fileURLToPath(import.meta.url))), 'server', 'index.mjs');

/** Gửi loạt frame vào server, gom frame trả về (theo dòng) rồi đóng stdin. */
function talk(frames, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER], {
      // HOME tạm rỗng: server không được đọc trúng cấu hình thật của máy chạy test.
      env: { ...process.env, HOME: join(process.env.TMPDIR ?? '/tmp', 'gdrive-no-such-home'), ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', reject);
    child.on('close', () => {
      const msgs = out
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            // Đây chính là ca hỏng cần bắt: có gì đó KHÔNG phải JSON lọt vào stdout.
            throw new Error(`stdout có dòng không phải JSON-RPC: ${JSON.stringify(l)}`);
          }
        });
      resolve({ msgs, stderr: err });
    });
    for (const f of frames) child.stdin.write(`${JSON.stringify(f)}\n`);
    child.stdin.end();
  });
}

const INIT = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
};

test('handshake: initialize → capabilities.tools + serverInfo', async () => {
  const { msgs } = await talk([INIT]);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].id, 0);
  assert.deepEqual(msgs[0].result.capabilities, { tools: {} });
  assert.equal(msgs[0].result.serverInfo.name, 'gdrive');
  assert.equal(msgs[0].result.protocolVersion, '2025-06-18', 'echo lại version của client');
});

test('notification KHÔNG được trả lời', async () => {
  const { msgs } = await talk([INIT, { jsonrpc: '2.0', method: 'notifications/initialized' }]);
  assert.equal(msgs.length, 1, 'chỉ có đúng 1 frame trả về (của initialize)');
});

test('tools/list chạy được KHÔNG cần credential', async () => {
  const { msgs } = await talk([INIT, { jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  const tools = msgs.find((m) => m.id === 1).result.tools;
  assert.ok(tools.length >= 5);
  for (const t of tools) {
    assert.ok(t.name && t.description && t.inputSchema, `tool ${t.name} thiếu field`);
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('mặc định readonly: KHÔNG lộ tool ghi', async () => {
  const { msgs } = await talk([INIT, { jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
  const names = msgs.find((m) => m.id === 1).result.tools.map((t) => t.name);
  assert.ok(names.includes('gdrive_sheet_read'));
  assert.equal(names.includes('gdrive_sheet_write'), false, 'model không được thấy tool ghi');
  assert.equal(names.includes('gdrive_upload'), false);
});

test('ping', async () => {
  const { msgs } = await talk([INIT, { jsonrpc: '2.0', id: 2, method: 'ping' }]);
  assert.deepEqual(msgs.find((m) => m.id === 2).result, {});
});

test('method lạ → -32601, và KHÔNG làm chết server', async () => {
  const { msgs } = await talk([
    INIT,
    { jsonrpc: '2.0', id: 3, method: 'khong/co/method/nay' },
    { jsonrpc: '2.0', id: 4, method: 'ping' },
  ]);
  assert.equal(msgs.find((m) => m.id === 3).error.code, -32601);
  assert.ok(msgs.find((m) => m.id === 4), 'server phải còn sống sau lỗi');
});

test('tool không tồn tại → -32602', async () => {
  const { msgs } = await talk([
    INIT,
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'khong_co', arguments: {} } },
  ]);
  assert.equal(msgs.find((m) => m.id === 5).error.code, -32602);
});

test('frame rác không phải JSON: bỏ qua, không làm hỏng stdout', async () => {
  const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
  });
  const done = new Promise((r) => child.on('close', r));
  child.stdin.write('đây không phải json\n');
  child.stdin.write(`${JSON.stringify(INIT)}\n`);
  child.stdin.end();
  await done;
  const lines = out.split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).id, 0);
});

test('lỗi của tool trả về isError (model đọc được), KHÔNG phải lỗi protocol', async () => {
  const { msgs } = await talk([
    INIT,
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      // URL rác → parseGoogleUrl ném UrlError ngay, không cần mạng.
      params: { name: 'gdrive_sheet_read', arguments: { url_or_id: 'x' } },
    },
  ]);
  const res = msgs.find((m) => m.id === 6);
  assert.equal(res.error, undefined, 'không được là lỗi protocol');
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /không phải URL Google hợp lệ/);
});

// ── buildTools (không qua tiến trình con) ───────────────────────────────────

test('buildTools: readwrite mở đủ 7 tool, readonly còn 5', () => {
  const ctx = { getClient: () => ({}), mode: 'readwrite' };
  assert.equal(buildTools(ctx).length, 7);
  assert.equal(buildTools({ ...ctx, mode: 'readonly' }).length, 5);
});

test('buildTools: mọi tool có schema hợp lệ và additionalProperties=false', () => {
  for (const t of buildTools({ getClient: () => ({}), mode: 'readwrite' })) {
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name} phải chặn field lạ`);
    assert.equal(typeof t.run, 'function');
    assert.ok(t.description.length > 40, `${t.name}: mô tả quá ngắn để model chọn đúng tool`);
  }
});

test('buildTools: tool ghi được đánh dấu write=true', () => {
  const w = buildTools({ getClient: () => ({}), mode: 'readwrite' })
    .filter((t) => t.write)
    .map((t) => t.name);
  assert.deepEqual(w.sort(), ['gdrive_sheet_write', 'gdrive_upload']);
});
