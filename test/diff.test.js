import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatch, globToRegExp, matchesAny } from '../src/diff.js';

test('parsePatch returns added lines with new-file line numbers', () => {
  const patch = [
    '@@ -10,4 +10,5 @@ class Foo {',
    ' context at 10',
    '-removed (old 11)',
    '+added at 11',
    '+added at 12',
    ' context at 13',
    '@@ -40,2 +41,3 @@',
    ' context at 41',
    '+added at 42',
    '\\ No newline at end of file',
  ].join('\n');

  assert.deepEqual(parsePatch(patch), [
    { line: 11, text: 'added at 11' },
    { line: 12, text: 'added at 12' },
    { line: 42, text: 'added at 42' },
  ]);
});

test('parsePatch handles missing patch (binary or huge files)', () => {
  assert.deepEqual(parsePatch(undefined), []);
});

test('globs without a slash match the file name in any folder', () => {
  assert.ok(globToRegExp('*.ts').test('src/app/app.ts'));
  assert.ok(!globToRegExp('*.ts').test('src/app/app.tsx'));
});

test('globs with ** match nested folders, including none', () => {
  const re = globToRegExp('src/**/*.cs');
  assert.ok(re.test('src/Foo.cs'));
  assert.ok(re.test('src/a/b/Foo.cs'));
  assert.ok(!re.test('tests/Foo.cs'));
});

test('matchesAny treats an empty list as "all files"', () => {
  assert.ok(matchesAny('anything.md', undefined));
  assert.ok(matchesAny('dist/x.js', ['dist/**']));
});
