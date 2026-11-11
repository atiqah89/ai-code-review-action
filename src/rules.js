import { matchesAny } from './diff.js';

export const SEVERITIES = ['info', 'warning', 'error'];

/**
 * @typedef {{ id: string, pattern: string, flags?: string, message: string,
 *             severity?: 'info'|'warning'|'error', files?: string[], exclude?: string[] }} Rule
 * @typedef {{ guidelines?: string[], rules?: Rule[], ignore?: string[] }} RuleConfig
 * @typedef {{ path: string, line: number, severity: string, message: string, source: string }} Finding
 */

/** Validates the config early, so a typo in a regex fails with a clear message instead of a stack trace. */
export function validateConfig(config) {
  const problems = [];
  if (config.guidelines && !Array.isArray(config.guidelines)) problems.push('"guidelines" must be an array of strings');
  for (const [i, rule] of (config.rules ?? []).entries()) {
    const where = `rules[${i}]${rule.id ? ` (${rule.id})` : ''}`;
    if (!rule.id) problems.push(`${where}: missing "id"`);
    if (!rule.message) problems.push(`${where}: missing "message"`);
    if (rule.severity && !SEVERITIES.includes(rule.severity)) {
      problems.push(`${where}: severity must be one of ${SEVERITIES.join(', ')}`);
    }
    try {
      new RegExp(rule.pattern, rule.flags);
    } catch (err) {
      problems.push(`${where}: invalid pattern: ${err.message}`);
    }
  }
  if (problems.length) throw new Error(`Invalid review rules:\n- ${problems.join('\n- ')}`);
  return config;
}

/**
 * Runs the deterministic regex rules against added lines.
 * @param {{ path: string, added: { line: number, text: string }[] }[]} files
 * @param {RuleConfig} config
 * @returns {Finding[]}
 */
export function runRules(files, config) {
  const findings = [];
  const compiled = (config.rules ?? []).map((r) => ({ ...r, regex: new RegExp(r.pattern, r.flags) }));

  for (const file of files) {
    for (const rule of compiled) {
      if (!matchesAny(file.path, rule.files)) continue;
      if (rule.exclude && matchesAny(file.path, rule.exclude)) continue;
      for (const { line, text } of file.added) {
        rule.regex.lastIndex = 0; // in case someone used the "g" flag
        if (rule.regex.test(text)) {
          findings.push({
            path: file.path,
            line,
            severity: rule.severity ?? 'warning',
            message: rule.message,
            source: rule.id,
          });
        }
      }
    }
  }
  return findings;
}
