// Wizard cài đặt — cùng khuôn với cc-notify-telegram.

import { createPrivateKey } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import { about } from './drive.mjs';
import { createClient } from './client.mjs';
import { configPath, installDir, readConfig, skillDir, writeConfig } from './config.mjs';
import { adcPath } from './credentials.mjs';
import { hasPermission, mergePermissions, permissionRule } from './settings.mjs';

const packageRoot = () => dirname(dirname(fileURLToPath(import.meta.url)));

export const cliPathFor = (home = homedir()) => join(installDir(home), 'bin', 'cli.mjs');

const GCP_GUIDE = `
  Tạo service account (khoảng 5 phút, làm một lần):

   1. Vào https://console.cloud.google.com/ → tạo project mới (hoặc chọn project có sẵn).
   2. Bật API — PHẢI bật cả hai:
        https://console.cloud.google.com/apis/library/drive.googleapis.com
        https://console.cloud.google.com/apis/library/sheets.googleapis.com
   3. IAM & Admin → Service Accounts → "Create service account" → đặt tên bất kỳ → Done.
      (Không cần cấp role nào ở bước này.)
   4. Bấm vào service account vừa tạo → tab "Keys" → Add key → Create new key → chọn JSON
      → file .json sẽ tự tải về.

  ⚠️  Điều quan trọng nhất, hay bị bỏ sót:
      Service account là MỘT DANH TÍNH RIÊNG, có email riêng (dạng ...iam.gserviceaccount.com).
      Nó KHÔNG thấy gì trong Drive của bạn cho tới khi bạn Share file/thư mục cho email đó
      — Viewer để đọc, Editor để ghi. Y như share cho một đồng nghiệp.
`;

function readSettings(home) {
  const file = join(home, '.claude', 'settings.json');
  if (!existsSync(file)) return { file, settings: {} };
  const raw = readFileSync(file, 'utf8');
  try {
    return { file, settings: JSON.parse(raw) };
  } catch {
    // Thà dừng còn hơn ghi đè settings của người dùng bằng file mới.
    throw new Error(
      `${file} không phải JSON hợp lệ. Sửa file đó trước rồi chạy lại — tôi sẽ không ghi đè nó.`,
    );
  }
}

function backupThenWrite(file, data, log) {
  if (existsSync(file)) {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
    const backup = `${file}.bak-${stamp}`;
    writeFileSync(backup, readFileSync(file));
    log(`   (đã sao lưu: ${backup})`);
  }
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

/** Nhận blob JSON dán nhiều dòng — readline không đọc được heredoc. */
async function readMultiline(rl, log) {
  log('   Dán toàn bộ nội dung file JSON, xong gõ một dòng chỉ có dấu chấm "." rồi Enter:');
  const lines = [];
  for (;;) {
    const line = await rl.question('');
    if (line.trim() === '.') break;
    lines.push(line);
  }
  return lines.join('\n');
}

/** Validate TRƯỚC khi ghi bất cứ thứ gì — hỏng thì báo ngay tại chỗ dán. */
export function validateServiceAccountJson(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('Không phải JSON hợp lệ. Dán nguyên nội dung file key tải từ GCP.');
  }
  if (obj.type !== 'service_account') {
    throw new Error(`type="${obj.type}" — cần file key của service account (type="service_account").`);
  }
  if (!obj.client_email) throw new Error('JSON thiếu client_email.');
  if (!obj.private_key) throw new Error('JSON thiếu private_key.');

  const privateKey = String(obj.private_key).replace(/\\n/g, '\n');
  try {
    createPrivateKey(privateKey);
  } catch (err) {
    throw new Error(`private_key không đọc được (${err.message}) — có thể bị cắt lúc dán.`);
  }
  return { clientEmail: obj.client_email, privateKey, projectId: obj.project_id ?? null };
}

/** Copy code + skill vào ~/.claude, thay placeholder đường dẫn trong SKILL.md. */
export function installFiles({ home, log, writeSkill = true }) {
  const root = packageRoot();
  const dest = installDir(home);

  // Xoá bản cũ để file đã bỏ đi không sót lại giữa hai lần cài.
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(join(root, 'src'), join(dest, 'src'), { recursive: true });
  cpSync(join(root, 'bin'), join(dest, 'bin'), { recursive: true });
  log(`✅ Đã copy CLI → ${dest}`);

  const cliPath = cliPathFor(home);
  if (writeSkill) {
    const sdir = skillDir(home);
    mkdirSync(sdir, { recursive: true });
    const tpl = readFileSync(join(root, 'skill', 'SKILL.md'), 'utf8');
    writeFileSync(join(sdir, 'SKILL.md'), tpl.replaceAll('{{CLI}}', cliPath));
    log(`✅ Đã cài skill  → ${sdir}/SKILL.md`);
  }
  return cliPath;
}

export async function runInit(flags = {}, { home = homedir(), log = console.log, env = process.env } = {}) {
  const interactive = process.stdin.isTTY && !flags.yes;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const ask = async (q, fallback = '') => (rl ? (await rl.question(q)).trim() : fallback);

  try {
    log('\n📁 gdrive-cli — truy cập Google Drive/Sheets cho Claude Code\n');

    const existing = readConfig(home);
    let credentials = null;
    let useAdc = false;

    // ── Credential ───────────────────────────────────────────────────────────
    if (flags['sa-json']) {
      credentials = validateServiceAccountJson(readFileSync(flags['sa-json'], 'utf8'));
    } else if (flags.adc) {
      useAdc = true;
    } else if (!interactive && existing?.clientEmail) {
      credentials = { clientEmail: existing.clientEmail, privateKey: existing.privateKey };
    } else if (interactive) {
      if (existing?.clientEmail) {
        log(`Đang có cấu hình cho: ${existing.clientEmail}`);
        const keep = await ask('Giữ nguyên credential này? [Y/n] ');
        if (!/^n/i.test(keep)) {
          credentials = { clientEmail: existing.clientEmail, privateKey: existing.privateKey };
        }
      }

      while (!credentials && !useAdc) {
        log('\nChọn cách xác thực:');
        log('  [1] Dán nội dung file JSON key của service account (hoặc đường dẫn tới file)');
        log('  [2] Hướng dẫn tôi tạo service account trên Google Cloud');
        const adcFile = adcPath(env, home);
        log(`  [3] Dùng gcloud login sẵn có (ADC)${existsSync(adcFile) ? ' — đã thấy file ADC' : ' — chưa thấy file ADC'}`);
        const choice = await ask('\nChọn [1/2/3]: ');

        if (choice === '2') {
          log(GCP_GUIDE);
          await ask('Tải file JSON xong thì Enter để tiếp tục... ');
          continue;
        }

        if (choice === '3') {
          useAdc = true;
          log(
            '\n⚠️  Hai điều bắt buộc với ADC, thiếu là 403:\n' +
              '   • Refresh token bị buộc vào scope lúc login. Grant mặc định KHÔNG có Drive/Sheets:\n' +
              '       gcloud auth application-default login \\\n' +
              '         --scopes=https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/cloud-platform\n' +
              '   • Cần quota project đã bật Drive API + Sheets API:\n' +
              '       gcloud auth application-default set-quota-project <PROJECT_ID>\n',
          );
          continue;
        }

        const answer = await ask('Đường dẫn file .json (Enter để dán trực tiếp): ');
        try {
          const text = answer
            ? readFileSync(answer.replace(/^~/, home), 'utf8')
            : await readMultiline(rl, log);
          credentials = validateServiceAccountJson(text);
          log(`\n✅ Key hợp lệ — service account: ${credentials.clientEmail}`);
        } catch (err) {
          log(`\n❌ ${err.message}\n`);
        }
      }
    }

    if (!credentials && !useAdc) {
      log('❌ Chưa có credential. Chạy lại với --sa-json <file> hoặc --adc.');
      return false;
    }

    // ── Chế độ đọc/ghi ───────────────────────────────────────────────────────
    let mode = flags.mode ?? existing?.mode ?? null;
    if (!mode && interactive) {
      const rw = await ask('\nCho phép GHI (sửa sheet, upload file)? [y/N] ');
      mode = /^y/i.test(rw) ? 'readwrite' : 'readonly';
    }
    mode = mode === 'readwrite' ? 'readwrite' : 'readonly';
    log(`   Chế độ: ${mode}${mode === 'readonly' ? ' (lệnh write/put sẽ bị từ chối)' : ''}`);

    // ── Ghi config ───────────────────────────────────────────────────────────
    const cfg = { mode, useAdc, nodePath: process.execPath };
    if (credentials) Object.assign(cfg, credentials);
    const cfgFile = writeConfig(cfg, home);
    log(`✅ Đã ghi config → ${cfgFile} (chmod 600)`);

    // ── Copy code + skill ────────────────────────────────────────────────────
    const cliPath = installFiles({ home, log, writeSkill: !flags['no-skill'] });

    // ── Allow-rule (LUÔN hỏi — đây là thay đổi về quyền) ─────────────────────
    const rule = permissionRule(cliPath);
    let addRule = flags['allow-bash'] === true;
    if (!addRule && interactive && flags['allow-bash'] === undefined) {
      log(`\nThêm allow-rule để Claude khỏi hỏi quyền mỗi lần gọi CLI?\n   ${rule}`);
      addRule = /^y/i.test(await ask('Thêm vào ~/.claude/settings.json? [y/N] '));
    }
    if (addRule) {
      const { file, settings } = readSettings(home);
      if (hasPermission(settings, { cliPath })) {
        log('✅ Allow-rule đã có sẵn.');
      } else {
        mkdirSync(join(home, '.claude'), { recursive: true });
        backupThenWrite(file, mergePermissions(settings, { cliPath }), log);
        log('✅ Đã thêm allow-rule.');
      }
    }

    // ── Smoke test ───────────────────────────────────────────────────────────
    if (!flags['no-test']) {
      log('\n🔎 Kiểm tra kết nối...');
      try {
        const client = createClient({ credentials, mode, home, env, retries: 2 });
        const info = await about(client);
        const email = info.user?.emailAddress ?? '(không rõ)';
        log(`✅ Kết nối OK — đang chạy với danh tính: ${email}`);
        log('\n📋 Copy email này vào hộp Share của file/thư mục bạn muốn truy cập:');
        log(`\n      ${email}\n`);
        log('   (Viewer để đọc, Editor để ghi — không share thì không thấy gì.)');

        const limit = Number(info.storageQuota?.limit ?? 0);
        if (limit === 0 && credentials) {
          log(
            '\n⚠️  Service account có 0 byte dung lượng My Drive — đây là chuyện BÌNH THƯỜNG.\n' +
              '   Hệ quả: upload file chỉ chạy được vào Shared Drive. Share Editor một thư mục\n' +
              '   My Drive là KHÔNG đủ để upload (sẽ báo 403 storageQuotaExceeded). Đọc thì bình thường.',
          );
        }
      } catch (err) {
        log(`⚠️  Chưa kết nối được: ${err.message.split('\n')[0]}`);
        log('   Cài đặt vẫn được lưu — chạy `gdrive status` để chẩn đoán.');
      }
    }

    log('\n──────────────────────────────────────────────────────────────');
    log('Xong. Cách dùng:');
    log(`   node ${cliPath} read "<link google sheet>"`);
    log(`   node ${cliPath} status`);
    log('\n⚠️  MỞ MỘT SESSION CLAUDE CODE MỚI — skill chỉ được nạp lúc khởi động session.');
    log('──────────────────────────────────────────────────────────────\n');
    return true;
  } finally {
    rl?.close();
  }
}
