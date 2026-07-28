// Đọc/ghi config (chứa private key → chmod 600 trên Unix).
//
// Có HAI vị trí, theo thứ tự ưu tiên:
//   1. Thư mục data của plugin — `$CLAUDE_PLUGIN_DATA`, hoặc tính ra nếu biến vắng.
//      Đây là vị trí CHUẨN từ v0.2: sống qua update, tự xoá khi gỡ plugin.
//   2. `~/.claude/gdrive.json` — vị trí CŨ của bản cài bằng npx. Chỉ ĐỌC, để người đã
//      cài kiểu cũ không mất cấu hình; không ghi mới vào đây nữa.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Id thư mục data mà Claude Code dùng: tên plugin + marketplace, ký tự lạ → '-'. */
const PLUGIN_DATA_ID = 'gdrive-gdrive-cli';

/**
 * Thư mục data của plugin. `CLAUDE_PLUGIN_DATA` được Claude Code export cho tiến trình
 * con (MCP server, hook); khi chạy CLI ngoài Claude Code thì biến vắng → tự tính.
 */
export function pluginDataDir(env = process.env, home = homedir()) {
  return env.CLAUDE_PLUGIN_DATA || join(home, '.claude', 'plugins', 'data', PLUGIN_DATA_ID);
}

export function pluginConfigPath(env = process.env, home = homedir()) {
  return join(pluginDataDir(env, home), 'config.json');
}

/** Vị trí cũ do bản cài npx (≤ v0.1) để lại — chỉ đọc. */
export function legacyConfigPath(home = homedir()) {
  return join(home, '.claude', 'gdrive.json');
}

/** Nơi ghi config mới. */
export function configPath(env = process.env, home = homedir()) {
  return pluginConfigPath(env, home);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Đọc config: ưu tiên plugin data dir, rơi về vị trí cũ để không phá bản cài npx. */
export function readConfig(home = homedir(), env = process.env) {
  return readJson(pluginConfigPath(env, home)) ?? readJson(legacyConfigPath(home));
}

export function writeConfig(cfg, home = homedir(), env = process.env) {
  const file = pluginConfigPath(env, home);
  mkdirSync(pluginDataDir(env, home), { recursive: true });
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return file;
}

/** Bản cài cũ còn sót không — dùng để nhắc người dùng dọn. */
export function hasLegacyInstall(home = homedir()) {
  return (
    existsSync(legacyConfigPath(home)) ||
    existsSync(join(home, '.claude', 'gdrive')) ||
    existsSync(join(home, '.claude', 'skills', 'gdrive'))
  );
}
