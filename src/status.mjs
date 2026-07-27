// Doctor: kiểm tra từng mắt xích, in ra mắt nào hỏng và sửa thế nào.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { about } from './drive.mjs';
import { createClient } from './client.mjs';
import { configPath, installDir, readConfig, skillDir } from './config.mjs';
import { resolveCredentials, scopesForMode } from './credentials.mjs';
import { cliPathFor } from './init.mjs';
import { hasPermission } from './settings.mjs';

const OK = '✅';
const WARN = '⚠️ ';
const BAD = '❌';

export async function runStatus({ home = homedir(), log = console.log, env = process.env } = {}) {
  let healthy = true;
  const fail = () => {
    healthy = false;
  };

  log('\n📁 gdrive-cli — kiểm tra sức khoẻ\n');

  // 1. Config
  const cfgFile = configPath(home);
  const cfg = readConfig(home);
  if (!cfg) {
    log(`${WARN} Chưa có ${cfgFile} — chưa chạy init (vẫn dùng được nếu có env).`);
  } else {
    log(`${OK} Config: ${cfgFile}`);
    if (process.platform !== 'win32') {
      const mode = statSync(cfgFile).mode & 0o777;
      if (mode === 0o600) log(`${OK} Quyền file config: 600`);
      else {
        log(`${BAD} Quyền file config là ${mode.toString(8)}, phải là 600 — chứa private key.`);
        log(`     Sửa: chmod 600 ${cfgFile}`);
        fail();
      }
    }
    log(`${OK} Chế độ: ${cfg.mode ?? 'readonly'}`);
  }

  // 2. Credential
  let credentials;
  try {
    credentials = resolveCredentials({ env, home });
    const who = credentials.clientEmail ?? credentials.clientId ?? '(token trần)';
    log(`${OK} Credential: ${credentials.type} từ ${credentials.source} — ${who}`);
  } catch (err) {
    log(`${BAD} Không tìm thấy credential.`);
    log(
      err.message
        .split('\n')
        .map((l) => `     ${l}`)
        .join('\n'),
    );
    fail();
  }

  // 3. Code đã cài
  const dir = installDir(home);
  const cliPath = cliPathFor(home);
  if (existsSync(cliPath)) log(`${OK} CLI đã cài: ${dir}`);
  else {
    log(`${BAD} Chưa thấy ${cliPath} — chạy: npx -y github:dangchison/gdrive-cli init`);
    fail();
  }

  // 4. Skill
  const skillFile = join(skillDir(home), 'SKILL.md');
  if (existsSync(skillFile)) {
    const body = readFileSync(skillFile, 'utf8');
    if (body.includes('{{CLI}}')) {
      log(`${BAD} SKILL.md còn placeholder {{CLI}} chưa thay — chạy lại init.`);
      fail();
    } else if (!body.includes(cliPath)) {
      log(`${WARN} SKILL.md trỏ tới đường dẫn CLI khác — chạy lại init để đồng bộ.`);
    } else {
      log(`${OK} Skill: ${skillFile}`);
    }
  } else {
    log(`${WARN} Chưa cài skill — Claude sẽ không tự biết dùng CLI này (vẫn gọi tay được).`);
  }

  // 5. Node đã ghi lúc cài (nvm nâng version là đường dẫn cũ biến mất)
  if (cfg?.nodePath) {
    if (existsSync(cfg.nodePath)) log(`${OK} Node lúc cài vẫn còn: ${cfg.nodePath}`);
    else log(`${WARN} Node lúc cài đã biến mất (${cfg.nodePath}) — nvm đổi version? Chạy lại init.`);
  }

  // 6. Allow-rule
  const settingsFile = join(home, '.claude', 'settings.json');
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      if (hasPermission(settings, { cliPath })) log(`${OK} Allow-rule đã có trong settings.json`);
      else log(`${WARN} Chưa có allow-rule — Claude sẽ hỏi quyền mỗi lần gọi CLI.`);
    } catch {
      log(`${BAD} ${settingsFile} không phải JSON hợp lệ.`);
      fail();
    }
  }

  // 7. Gọi thật
  if (credentials) {
    const mode = cfg?.mode ?? 'readonly';
    log(`\n🔎 Gọi thử Drive API (scope ${mode})...`);
    try {
      const client = createClient({ mode, home, env, retries: 2 });
      const info = await about(client);
      const email = info.user?.emailAddress ?? '(không rõ)';
      log(`${OK} Token OK — danh tính: ${email}`);
      log(`     Scope: ${scopesForMode(mode).join(' ')}`);
      log(`\n     Share file/thư mục cho email này thì mới đọc/ghi được:\n       ${email}`);

      if (Number(info.storageQuota?.limit ?? 0) === 0 && credentials.type === 'service_account') {
        log(`\n${WARN} Dung lượng My Drive = 0 (bình thường với service account).`);
        log('     Upload chỉ chạy vào Shared Drive; My Drive sẽ 403 storageQuotaExceeded.');
      }
    } catch (err) {
      const first = err.message.split('\n')[0];
      log(`${BAD} Gọi API thất bại: ${first}`);
      if (/SERVICE_DISABLED|has not been used/i.test(err.message)) {
        log('     → Chưa bật API. Bật cả hai:');
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
