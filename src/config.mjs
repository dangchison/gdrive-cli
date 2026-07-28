// Đọc/ghi config (chứa private key → chmod 600 trên Unix).
//
// Có HAI vị trí, theo thứ tự ưu tiên:
//   1. Thư mục data của plugin — `$CLAUDE_PLUGIN_DATA`, hoặc tính ra nếu biến vắng.
//      Đây là vị trí CHUẨN từ v0.2: sống qua update, tự xoá khi gỡ plugin.
//   2. `~/.claude/gdrive.json` — vị trí CŨ của bản cài bằng npx. Chỉ ĐỌC, để người đã
//      cài kiểu cũ không mất cấu hình; không ghi mới vào đây nữa.

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Id mặc định khi phải tự đoán: tên plugin + marketplace, ký tự lạ → '-'. */
const PLUGIN_DATA_ID = 'gdrive-gdrive-cli';

const dataRoot = (home) => join(home, '.claude', 'plugins', 'data');

/**
 * Thư mục data của plugin.
 *
 * ⚠️ TÊN THƯ MỤC KHÔNG ĐOÁN ĐƯỢC. Đo thực tế 2026-07-28: MCP server nhận
 * `CLAUDE_PLUGIN_DATA=…/data/gdrive-inline`, trong khi CLI chạy ngoài Claude Code (không có
 * biến này) tính ra `…/data/gdrive-gdrive-cli` theo mẫu tài liệu. Hai bên ghi/đọc lệch nhau
 * ⇒ tool báo "không tìm thấy credential" dù `gdrive status` xanh.
 *
 * Nên: có biến thì tin biến; không có thì DÒ mọi thư mục `gdrive*` thay vì đoán một cái.
 */
export function pluginDataDir(env = process.env, home = homedir()) {
  if (env.CLAUDE_PLUGIN_DATA) return env.CLAUDE_PLUGIN_DATA;
  const existing = candidateDataDirs(home).find((d) => existsSync(join(d, 'config.json')));
  return existing ?? join(dataRoot(home), PLUGIN_DATA_ID);
}

/** Mọi thư mục data có thể là của plugin này, thư mục mặc định đứng trước. */
function candidateDataDirs(home) {
  const root = dataRoot(home);
  const preferred = join(root, PLUGIN_DATA_ID);
  let others = [];
  try {
    others = readdirSync(root)
      .filter((n) => n.startsWith('gdrive'))
      .map((n) => join(root, n))
      .filter((d) => d !== preferred);
  } catch {
    /* chưa có thư mục data nào */
  }
  return [preferred, ...others];
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

/**
 * Đọc config. Dò LẦN LƯỢT vì tên thư mục data không đoán được (xem pluginDataDir):
 * thư mục do env chỉ định → mọi thư mục `gdrive*` → vị trí cũ của bản cài npx.
 */
export function readConfig(home = homedir(), env = process.env) {
  const seen = new Set();
  const dirs = [
    ...(env.CLAUDE_PLUGIN_DATA ? [env.CLAUDE_PLUGIN_DATA] : []),
    ...candidateDataDirs(home),
  ];
  for (const dir of dirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const cfg = readJson(join(dir, 'config.json'));
    if (cfg) return cfg;
  }
  return readJson(legacyConfigPath(home));
}

/**
 * Ghi config vào MỌI thư mục data đang tồn tại (thường chỉ 1–2), cộng thư mục do env chỉ
 * định. Cố ý ghi nhiều nơi: CLI chạy ngoài Claude Code không biết server sẽ đọc thư mục
 * nào, mà file chỉ ~1.9 KB nên trùng lặp là rẻ hơn nhiều so với việc tool báo thiếu
 * credential trong khi `status` xanh.
 */
export function writeConfig(cfg, home = homedir(), env = process.env) {
  const targets = new Set([
    ...(env.CLAUDE_PLUGIN_DATA ? [env.CLAUDE_PLUGIN_DATA] : []),
    ...candidateDataDirs(home).filter((d, i) => i === 0 || existsSync(d)),
  ]);
  const body = `${JSON.stringify(cfg, null, 2)}\n`;
  let primary = null;
  for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'config.json');
    writeFileSync(file, body);
    if (process.platform !== 'win32') chmodSync(file, 0o600);
    primary ??= file;
  }
  return primary;
}

/** Bản cài cũ còn sót không — dùng để nhắc người dùng dọn. */
export function hasLegacyInstall(home = homedir()) {
  return (
    existsSync(legacyConfigPath(home)) ||
    existsSync(join(home, '.claude', 'gdrive')) ||
    existsSync(join(home, '.claude', 'skills', 'gdrive'))
  );
}
