// Thêm/gỡ một allow-rule trong ~/.claude/settings.json để Claude khỏi hỏi quyền mỗi lần
// gọi CLI.
//
// Nguyên tắc (mượn nguyên từ cc-notify-telegram): CHỈ đụng entry của mình — nhận diện qua
// chuỗi đường dẫn CLI trong rule — giữ nguyên mọi rule khác; chạy lại bao nhiêu lần cũng
// ra cùng kết quả.
//
// Đây là thay đổi liên quan tới quyền nên wizard PHẢI hỏi, không bao giờ tự thêm.

export const RULE_MARKER = 'gdrive/bin/cli.mjs';

export function permissionRule(cliPath) {
  return `Bash(node ${cliPath}:*)`;
}

const isOurs = (rule) => typeof rule === 'string' && rule.includes(RULE_MARKER);

/** Trả settings MỚI (không mutate input). */
export function mergePermissions(settings, { cliPath }) {
  const next = structuredClone(settings ?? {});
  next.permissions = next.permissions ?? {};
  const allow = Array.isArray(next.permissions.allow) ? [...next.permissions.allow] : [];

  const rule = permissionRule(cliPath);
  const idx = allow.findIndex(isOurs);
  if (idx >= 0) allow[idx] = rule;
  else allow.push(rule);

  next.permissions.allow = allow;
  return next;
}

export function removePermissions(settings) {
  const next = structuredClone(settings ?? {});
  if (!Array.isArray(next.permissions?.allow)) return next;

  next.permissions.allow = next.permissions.allow.filter((r) => !isOurs(r));
  if (next.permissions.allow.length === 0) delete next.permissions.allow;
  if (Object.keys(next.permissions).length === 0) delete next.permissions;
  return next;
}

export function hasPermission(settings, { cliPath }) {
  return (settings?.permissions?.allow ?? []).includes(permissionRule(cliPath));
}
