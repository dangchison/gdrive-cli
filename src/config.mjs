// Đọc/ghi config ~/.claude/gdrive.json (chứa private key → chmod 600 trên Unix).

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_BASENAME = 'gdrive.json';

/** Nơi code + skill được copy tới lúc `init`. */
export function installDir(home = homedir()) {
  return join(home, '.claude', 'gdrive');
}

export function skillDir(home = homedir()) {
  return join(home, '.claude', 'skills', 'gdrive');
}

export function configPath(home = homedir()) {
  return join(home, '.claude', CONFIG_BASENAME);
}

export function readConfig(home = homedir()) {
  try {
    return JSON.parse(readFileSync(configPath(home), 'utf8'));
  } catch {
    return null;
  }
}

export function writeConfig(cfg, home = homedir()) {
  const file = configPath(home);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  if (process.platform !== 'win32') chmodSync(file, 0o600);
  return file;
}
