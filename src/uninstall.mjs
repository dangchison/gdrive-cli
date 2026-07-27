// Gỡ cài đặt — nghịch đảo chính xác của init.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { configPath, installDir, skillDir } from './config.mjs';
import { removePermissions } from './settings.mjs';

export function runUninstall(flags = {}, { home = homedir(), log = console.log } = {}) {
  const dir = installDir(home);
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
    log(`✅ Đã xoá ${dir}`);
  }

  const sdir = skillDir(home);
  if (existsSync(sdir)) {
    rmSync(sdir, { recursive: true, force: true });
    log(`✅ Đã xoá skill ${sdir}`);
  }

  const settingsFile = join(home, '.claude', 'settings.json');
  if (existsSync(settingsFile)) {
    try {
      const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
      const next = removePermissions(settings);
      if (JSON.stringify(next) !== JSON.stringify(settings)) {
        writeFileSync(settingsFile, JSON.stringify(next, null, 2) + '\n');
        log('✅ Đã gỡ allow-rule khỏi settings.json');
      }
    } catch {
      // JSON hỏng: không đụng vào, chỉ báo. Ghi đè ở đây là phá settings của người dùng.
      log(`⚠️  ${settingsFile} không parse được — allow-rule (nếu có) phải gỡ tay.`);
    }
  }

  // Config chứa private key: chỉ xoá khi được yêu cầu tường minh, để cài lại không phải
  // dán key lần nữa.
  const cfgFile = configPath(home);
  if (flags.purge) {
    if (existsSync(cfgFile)) {
      rmSync(cfgFile, { force: true });
      log(`✅ Đã xoá config ${cfgFile}`);
    }
  } else if (existsSync(cfgFile)) {
    log(`ℹ️  Giữ lại ${cfgFile} (còn private key). Xoá luôn: thêm cờ --purge`);
  }

  log('\nĐã gỡ. Mở session Claude Code mới để skill biến mất khỏi danh sách.\n');
  return true;
}
