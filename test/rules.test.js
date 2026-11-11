import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runRules, validateConfig } from '../src/rules.js';

const config = validateConfig(JSON.parse(readFileSync(new URL('../examples/review-rules.json', import.meta.url), 'utf8')));

const file = (path, ...lines) => ({ path, added: lines.map((text, i) => ({ line: i + 1, text })) });
const ids = (findings) => findings.map((f) => f.source);

test('example rules file is valid', () => {
  assert.ok(config.rules.length > 0);
});

test('flags hard-coded secrets', () => {
  const findings = runRules([file('src/client.ts', 'const clientSecret = "sk_live_abcdefghijklmnop";')], config);
  assert.deepEqual(ids(findings), ['no-hardcoded-secret']);
  assert.equal(findings[0].severity, 'error');
});

test('flags tokens in logs, in C# and JS', () => {
  const findings = runRules(
    [
      file('src/Sync.cs', '_logger.LogInformation("Got token {Token}", accessToken);'),
      file('src/sync.js', 'logger.debug(`authorization: ${headers.authorization}`);'),
    ],
    config,
  );
  assert.deepEqual(ids(findings), ['no-token-in-logs', 'no-token-in-logs']);
});

test('file filters and excludes are respected', () => {
  const findings = runRules(
    [file('src/app.ts', 'console.log("debug")'), file('src/app.test.js', 'console.log("ok in tests")'), file('README.md', 'console.log("docs")')],
    config,
  );
  assert.deepEqual(findings.map((f) => f.path), ['src/app.ts']);
});

test('TODO with a ticket reference passes, bare TODO does not', () => {
  const findings = runRules([file('a.cs', '// TODO(WXI-123): retry later', '// TODO: retry later')], config);
  assert.deepEqual(findings.map((f) => f.line), [2]);
});

test('disabling RLS in a migration is an error', () => {
  const findings = runRules([file('supabase/migrations/001.sql', 'alter table tickets disable row level security;')], config);
  assert.deepEqual(ids(findings), ['rls-disabled']);
});

test('blocking on tasks is flagged only in C#', () => {
  const findings = runRules([file('Api.cs', 'var x = client.GetAsync(url).Result;'), file('api.js', 'const r = res.Result;')], config);
  assert.deepEqual(findings.map((f) => f.path), ['Api.cs']);
});

test('invalid config produces readable errors', () => {
  assert.throws(
    () => validateConfig({ rules: [{ id: 'bad', pattern: '(unclosed', message: 'x', severity: 'fatal' }] }),
    /bad\): severity must be one of[\s\S]*invalid pattern/,
  );
});
