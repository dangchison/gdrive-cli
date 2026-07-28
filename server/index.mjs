#!/usr/bin/env node
// MCP server (stdio) cho gdrive-cli — chạy trong Claude Code plugin.
//
// ⚠️ LUẬT CỨNG: stdout CHỈ được chứa frame JSON-RPC. Một dòng console.log lạc là hỏng
// stream, và Claude Code chỉ báo "lỗi kết nối" mơ hồ, rất tốn công truy. Chuyển hướng
// console.log sang stderr NGAY dòng đầu, trước mọi import có thể lỡ in ra.
console.log = console.error;
console.info = console.error;

import { createClient } from '../src/client.mjs';
import { readConfig } from '../src/config.mjs';
import { buildTools } from '../src/tools.mjs';

// Phiên bản protocol ta biết. Client gửi phiên bản khác thì echo lại của client —
// stdio MCP tương thích ngược tốt, cãi nhau về version chỉ làm hỏng handshake.
const FALLBACK_PROTOCOL = '2025-06-18';
const SERVER_INFO = { name: 'gdrive', version: '0.2.0' };

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const ok = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

// ── Client dựng LAZY ────────────────────────────────────────────────────────
// Không đụng credential lúc khởi động: server phải spawn được kể cả khi người dùng
// chưa cấu hình, để `tools/list` vẫn chạy và lỗi hiện ra lúc gọi tool (kèm hướng dẫn),
// thay vì server chết câm ngay từ session start.
let client = null;
const mode = readConfig()?.mode === 'readwrite' ? 'readwrite' : 'readonly';

function getClient() {
  if (!client) client = createClient({ mode, retries: 2 });
  return client;
}

const tools = buildTools({ getClient, mode });
const byName = new Map(tools.map((t) => [t.name, t]));

const listPayload = {
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
};

// ── Xử lý message ───────────────────────────────────────────────────────────

async function handle(msg) {
  const { id, method, params } = msg ?? {};

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion ?? FALLBACK_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    // Notification: KHÔNG có id, KHÔNG được trả lời.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return;

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, listPayload);

    case 'tools/call': {
      const tool = byName.get(params?.name);
      if (!tool) return fail(id, -32602, `Không có tool "${params?.name}".`);
      try {
        const result = await tool.run(params?.arguments ?? {});
        return ok(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        // Lỗi của tool trả về dạng isError để model ĐỌC ĐƯỢC và tự xử lý, thay vì
        // ném lỗi protocol khiến client coi như server hỏng.
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: explain(err) }],
        });
      }
    }

    default:
      // Chỉ trả lỗi cho request (có id); notification lạ thì im lặng bỏ qua.
      if (id !== undefined) fail(id, -32601, `Method không hỗ trợ: ${method}`);
  }
}

/** Thông điệp lỗi hướng người dùng tới hành động tiếp theo, không chỉ báo mã lỗi. */
function explain(err) {
  const msg = String(err?.message ?? err);
  const code = Number(err?.code);
  const email = client?.credentials?.clientEmail;

  if (code === 403 || code === 404) {
    return (
      `${msg}\n\n` +
      'Service account là một danh tính RIÊNG — nó không thấy gì cho tới khi file/thư mục được ' +
      `share cho email của nó${email ? `: ${email}` : ''}. Bảo người dùng Share (Viewer để đọc, ` +
      'Editor để ghi) rồi thử lại. Không có cách vòng nào khác.'
    );
  }
  if (/không tìm thấy credential|CredentialError/i.test(msg)) {
    return `${msg}\n\nChạy /gdrive-setup để cấu hình service account.`;
  }
  if (err?.code === 'NOT_SHARED_DRIVE' || /storageQuotaExceeded/i.test(msg)) {
    return `${msg}\n\nService account không có dung lượng My Drive — đích upload phải là Shared Drive.`;
  }
  return msg;
}

// ── Vòng đọc stdin (JSON-RPC phân cách bằng newline) ────────────────────────

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('[gdrive-mcp] bỏ qua frame không phải JSON');
      continue;
    }
    // Không await: nhiều tool call có thể chạy song song, mỗi cái tự trả theo id.
    Promise.resolve(handle(msg)).catch((err) => {
      console.error('[gdrive-mcp] handler lỗi:', err);
      if (msg?.id !== undefined) fail(msg.id, -32603, String(err?.message ?? err));
    });
  }
});
process.stdin.on('end', () => process.exit(0));
