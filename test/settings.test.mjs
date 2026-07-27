import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasPermission, mergePermissions, permissionRule, removePermissions } from '../src/settings.mjs';

const CLI = '/Users/ai/.claude/gdrive/bin/cli.mjs';
const RULE = permissionRule(CLI);

test('rule có dạng Bash(...) trỏ đúng CLI', () => {
  assert.equal(RULE, `Bash(node ${CLI}:*)`);
});

test('thêm vào settings rỗng', () => {
  const next = mergePermissions({}, { cliPath: CLI });
  assert.deepEqual(next.permissions.allow, [RULE]);
  assert.ok(hasPermission(next, { cliPath: CLI }));
});

test('không mutate input', () => {
  const input = { permissions: { allow: ['Bash(git status)'] } };
  const frozen = JSON.stringify(input);
  mergePermissions(input, { cliPath: CLI });
  assert.equal(JSON.stringify(input), frozen);
});

test('giữ nguyên rule của người khác', () => {
  const input = {
    permissions: { allow: ['Bash(git status)', 'Bash(pnpm test:*)'], deny: ['Bash(git merge:*)'] },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] },
  };
  const next = mergePermissions(input, { cliPath: CLI });
  assert.deepEqual(next.permissions.allow, ['Bash(git status)', 'Bash(pnpm test:*)', RULE]);
  assert.deepEqual(next.permissions.deny, ['Bash(git merge:*)']);
  assert.deepEqual(next.hooks, input.hooks);
});

test('idempotent: chạy 3 lần vẫn đúng một rule', () => {
  let s = {};
  for (let i = 0; i < 3; i++) s = mergePermissions(s, { cliPath: CLI });
  assert.equal(s.permissions.allow.filter((r) => r.includes('gdrive/bin/cli.mjs')).length, 1);
});

test('đổi đường dẫn cài đặt thì THAY TẠI CHỖ, không thêm rule thứ hai', () => {
  const s1 = mergePermissions({}, { cliPath: '/old/.claude/gdrive/bin/cli.mjs' });
  const s2 = mergePermissions(s1, { cliPath: CLI });
  assert.deepEqual(s2.permissions.allow, [RULE]);
});

test('gỡ rule của mình, giữ rule khác', () => {
  const s = mergePermissions({ permissions: { allow: ['Bash(git status)'] } }, { cliPath: CLI });
  const next = removePermissions(s);
  assert.deepEqual(next.permissions.allow, ['Bash(git status)']);
});

test('gỡ hết thì dọn luôn key rỗng', () => {
  const s = mergePermissions({}, { cliPath: CLI });
  const next = removePermissions(s);
  assert.equal('permissions' in next, false);
});

test('gỡ trên settings không có gì của mình → không đổi', () => {
  const input = { permissions: { allow: ['Bash(git status)'] } };
  assert.deepEqual(removePermissions(input), input);
  assert.deepEqual(removePermissions({}), {});
});
