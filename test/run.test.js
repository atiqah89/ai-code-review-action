import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReview } from '../src/run.js';
import { parseFindings, buildPrompt } from '../src/llm.js';
import { dedupe, shouldFail, MARKER } from '../src/review.js';

const rulesText = JSON.stringify({
  guidelines: ['Never log tokens.'],
  rules: [{ id: 'no-console-log', pattern: 'console\\.log\\(', severity: 'warning', message: 'Remove console.log' }],
});

const prFiles = [
  {
    filename: 'src/sync.js',
    status: 'modified',
    patch: '@@ -1,2 +1,4 @@\n const a = 1;\n+console.log(token);\n+const b = 2;\n const c = 3;',
  },
  { filename: 'package-lock.json', status: 'modified', patch: '@@ -1 +1 @@\n-x\n+console.log(1)' },
  { filename: 'old.js', status: 'removed', patch: '@@ -1 +0,0 @@\n-console.log(1)' },
];

const fakeGitHub = { listPullFiles: async () => prFiles };
const inputs = { anthropicApiKey: '', model: 'test-model', maxDiffChars: 10_000, maxComments: 25, failOn: 'error' };
const quiet = () => {};

function claudeReplying(text, calls = []) {
  return async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ content: [{ type: 'text', text }] }) };
  };
}

test('rules-only mode reviews changed files and skips lockfiles and removed files', async () => {
  const { findings, review, failed } = await runReview({ github: fakeGitHub, owner: 'o', repo: 'r', pullNumber: 1, rulesText, inputs, log: quiet });

  assert.deepEqual(findings.map((f) => `${f.path}:${f.line}:${f.source}`), ['src/sync.js:2:no-console-log']);
  assert.equal(review.comments[0].line, 2);
  assert.equal(review.comments[0].side, 'RIGHT');
  assert.match(review.body, /Guideline review skipped/);
  assert.ok(review.body.startsWith(MARKER));
  assert.equal(failed, false); // only a warning, fail-on is error
});

test('Claude findings are merged, and invented line numbers are dropped', async () => {
  const calls = [];
  const fetchImpl = claudeReplying(
    '```json\n[' +
      '{"path":"src/sync.js","line":2,"severity":"error","message":"Logs the access token."},' +
      '{"path":"src/sync.js","line":99,"severity":"error","message":"Hallucinated line."}' +
      ']\n```',
    calls,
  );

  const { findings, failed } = await runReview({
    github: fakeGitHub, owner: 'o', repo: 'r', pullNumber: 1, rulesText,
    inputs: { ...inputs, anthropicApiKey: 'sk-test' }, log: quiet, fetchImpl,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, 'test-model');
  assert.match(calls[0].body.messages[0].content, /src\/sync\.js:2 \| console\.log\(token\);/);
  assert.deepEqual(findings.map((f) => `${f.line}:${f.source}:${f.severity}`), ['2:claude:error', '2:no-console-log:warning']);
  assert.equal(failed, true);
});

test('an Anthropic outage falls back to rules instead of failing the check', async () => {
  const warnings = [];
  const fetchImpl = async () => ({ ok: false, status: 529, text: async () => 'overloaded' });

  const { findings } = await runReview({
    github: fakeGitHub, owner: 'o', repo: 'r', pullNumber: 1, rulesText,
    inputs: { ...inputs, anthropicApiKey: 'sk-test' }, log: (m) => warnings.push(m), fetchImpl,
  });

  assert.equal(findings.length, 1);
  assert.ok(warnings.some((w) => w.includes('::warning::') && w.includes('529')));
});

test('comments beyond max-comments go into the summary', async () => {
  const many = { listPullFiles: async () => [{ filename: 'a.js', status: 'added', patch: '@@ -0,0 +1,3 @@\n+console.log(1)\n+console.log(2)\n+console.log(3)' }] };
  const { review } = await runReview({ github: many, owner: 'o', repo: 'r', pullNumber: 1, rulesText, inputs: { ...inputs, maxComments: 1 }, log: quiet });

  assert.equal(review.comments.length, 1);
  assert.match(review.body, /2 more finding\(s\) not posted inline/);
});

test('parseFindings tolerates prose and bad JSON', () => {
  assert.deepEqual(parseFindings('Here you go: [] Thanks'), []);
  assert.deepEqual(parseFindings('no json at all'), []);
  assert.deepEqual(parseFindings('[{"broken": }]'), []);
});

test('buildPrompt truncates large diffs and reports it', () => {
  const files = [{ path: 'big.js', added: Array.from({ length: 1000 }, (_, i) => ({ line: i + 1, text: 'x'.repeat(50) })) }];
  const { prompt, truncated } = buildPrompt(files, ['rule'], 2000);
  assert.ok(prompt.length <= 2000);
  assert.equal(truncated, true);
});

test('dedupe keeps the most severe duplicate and sorts errors first', () => {
  const result = dedupe([
    { path: 'a', line: 1, severity: 'info', message: 'Same', source: 'x' },
    { path: 'a', line: 1, severity: 'error', message: 'same', source: 'y' },
    { path: 'b', line: 5, severity: 'warning', message: 'Other', source: 'z' },
  ]);
  assert.deepEqual(result.map((f) => f.source), ['y', 'z']);
});

test('shouldFail respects the threshold', () => {
  const warn = [{ severity: 'warning' }];
  assert.equal(shouldFail(warn, 'error'), false);
  assert.equal(shouldFail(warn, 'warning'), true);
  assert.equal(shouldFail(warn, 'never'), false);
  assert.throws(() => shouldFail(warn, 'sometimes'));
});
