/**
 * Parses the `patch` field GitHub returns for each PR file into the lines that were added,
 * with their line numbers in the new file. Only added lines can receive inline review comments
 * on the RIGHT side, so those are the only lines we review.
 *
 * @param {string | undefined} patch
 * @returns {{ line: number, text: string }[]}
 */
export function parsePatch(patch) {
  const added = [];
  if (!patch) return added; // binary files and very large diffs have no patch

  let newLine = 0;
  for (const raw of patch.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (raw.startsWith('+')) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-') || raw.startsWith('\\')) {
      // removed line, or "\ No newline at end of file": doesn't exist in the new file
    } else {
      newLine++; // context line
    }
  }
  return added;
}

/**
 * Converts a glob such as `*.ts`, `src/**\/*.cs` or `migrations/*.sql` to a RegExp.
 * A glob without a slash matches the file name in any folder.
 */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++; // "**/" also matches zero folders
    } else if (c === '*') {
      re += '[^/]*';
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const prefix = glob.includes('/') ? '^' : '(?:^|/)';
  return new RegExp(`${prefix}${re}$`);
}

export function matchesAny(path, globs) {
  if (!globs || globs.length === 0) return true;
  return globs.some((g) => globToRegExp(g).test(path));
}
