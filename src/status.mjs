// Doctor: kiểm từng mắt xích, chỉ ra mắt nào hỏng và sửa thế nào.

import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

import { about } from './drive.mjs';
import { createClient } from './client.mjs';
import { hasLegacyInstall, pluginConfigPath, pluginDataDir, readConfig } from './config.mjs';
import { resolveCredentials, scopesForMode } from './credentials.mjs';

const OK = '✅';
const WARN = '⚠️ ';
const BAD = '❌';

export async function runStatus({ home = homedir(), log = console.log, env = process.env } = {}) {
  let healthy = true;
  const fail = () => {
    healthy = false;
  };

  log('\n📁 gdrive — kiểm tra sức khoẻ\n');

  // 1. Cấu hình
  const cfgFile = pluginConfigPath(env, home);
  const cfg = readConfig(home, env);
  if (!cfg) {
    log(`${WARN} Chưa có cấu hình ở ${cfgFile}`);
    log('     Chạy: gdrive init --sa-json <đường-dẫn-key.json>   (hoặc /gdrive-setup trong Claude)');
    log(`     (vẫn dùng được nếu credential nằm trong biến môi trường)`);
  } else {
    log(`${OK} Cấu hình: ${existsSync(cfgFile) ? cfgFile : '(vị trí cũ ~/.claude/gdrive.json)'}`);
    if (process.platform !== 'win32' && existsSync(cfgFile)) {
      const mode = statSync(cfgFile).mode & 0o777;
      if (mode === 0o600) log(`${OK} Quyền file: 600`);
      else {
        log(`${BAD} Quyền file là ${mode.toString(8)}, phải là 600 — file chứa private key.`);
        log(`     Sửa: chmod 600 ${cfgFile}`);
        fail();
      }
    }
    log(`${OK} Chế độ: ${cfg.mode ?? 'readonly'}`);
  }
  log(`${OK} Thư mục data plugin: ${pluginDataDir(env, home)}`);
  if (!env.CLAUDE_PLUGIN_DATA) {
    log(`     (CLAUDE_PLUGIN_DATA không có trong env — đường dẫn tính ra, bình thường khi chạy ngoài Claude Code)`);
  }

  // 2. Credential
  let credentials;
  try {
    credentials = resolveCredentials({ env, home });
    const who = credentials.clientEmail ?? credentials.clientId ?? '(token trần)';
    log(`${OK} Credential: ${credentials.type} từ ${credentials.source} — ${who}`);
  } catch (err) {
    log(`${BAD} Không tìm thấy credential.`);
    log(err.message.split('\n').map((l) => `     ${l}`).join('\n'));
    fail();
  }

  // 3. Tàn dư bản cài cũ
  if (hasLegacyInstall(home)) {
    log(`${WARN} Còn dấu vết bản cài npx cũ — dọn bằng: gdrive uninstall --purge`);
  }

  // 4. Gọi thật
  if (credentials) {
    const mode = cfg?.mode ?? 'readonly';
    log(`\n🔎 Gọi thử Drive API (scope ${mode})...`);
    try {
      const client = createClient({ mode, home, env, retries: 2 });
      const info = await about(client);
      const email = info.user?.emailAddress ?? '(không rõ)';
      log(`${OK} Token OK — danh tính: ${email}`);
      if (credentials.type === 'service_account') {
        log(`     Scope: ${scopesForMode(mode).join(' ')}`);
      } else {
        log(`${WARN} Với ADC/token gcloud, readonly KHÔNG giới hạn scope thật — token mang đủ quyền đã được cấp cho tài khoản đó; giới hạn duy nhất là các tool ghi bị ẩn.`);
        log(`     Scope theo mode: ${scopesForMode(mode).join(' ')} (không thu hẹp token ADC/gcloud)`);
      }
      log(`\n     Share file/thư mục cho email này thì mới đọc/ghi được:\n       ${email}`);
      if (Number(info.storageQuota?.limit ?? 0) === 0 && credentials.type === 'service_account') {
        log(`\n${WARN} Dung lượng My Drive = 0 (bình thường với service account).`);
        log('     Upload chỉ chạy vào Shared Drive; My Drive sẽ 403 storageQuotaExceeded.');
      }
    } catch (err) {
      const first = err.message.split('\n')[0];
      log(`${BAD} Gọi API thất bại: ${first}`);
      if (/SERVICE_DISABLED|has not been used/i.test(err.message)) {
        log('     → Chưa bật API. Bật CẢ HAI:');
        log('       https://console.cloud.google.com/apis/library/drive.googleapis.com');
        log('       https://console.cloud.google.com/apis/library/sheets.googleapis.com');
      } else if (Number(err.code) === 401) {
        log('     → Token bị từ chối: key đã bị xoá trong GCP, hoặc đồng hồ máy lệch >5 phút.');
      }
      fail();
    }
  }

  log(healthy ? `\n${OK} Mọi thứ ổn.\n` : `\n${BAD} Có mục cần xử lý ở trên.\n`);
  return healthy;
}
