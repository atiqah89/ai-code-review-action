import { SEVERITIES } from './rules.js';

const ICON = { error: '🔴', warning: '🟡', info: '🔵' };
export const MARKER = '<!-- ai-code-review-action -->';

/** Keeps one finding per path+line+message, most severe first. */
export function dedupe(findings) {
  const rank = (s) => SEVERITIES.indexOf(s);
  const seen = new Map();
  for (const f of findings) {
    const key = `${f.path}:${f.line}:${f.message.toLowerCase()}`;
    if (!seen.has(key) || rank(f.severity) > rank(seen.get(key).severity)) seen.set(key, f);
  }
  return [...seen.values()].sort(
    (a, b) => rank(b.severity) - rank(a.severity) || a.path.localeCompare(b.path) || a.line - b.line,
  );
}

export function shouldFail(findings, failOn) {
  if (failOn === 'never') return false;
  const threshold = SEVERITIES.indexOf(failOn);
  if (threshold === -1) throw new Error(`fail-on must be one of ${SEVERITIES.join(', ')} or never`);
  return findings.some((f) => SEVERITIES.indexOf(f.severity) >= threshold);
}

/** Builds the GitHub review payload: inline comments plus a summary body. */
export function buildReview(findings, { maxComments, truncated, llmSkipped, filesReviewed }) {
  const inline = findings.slice(0, maxComments);
  const overflow = findings.slice(maxComments);
  const count = (s) => findings.filter((f) => f.severity === s).length;

  const lines = [
    MARKER,
    '### AI code review',
    '',
    findings.length === 0
      ? `✅ No issues found in ${filesReviewed} file(s).`
      : `Found **${findings.length}** issue(s) in ${filesReviewed} file(s): ` +
        `${ICON.error} ${count('error')} error · ${ICON.warning} ${count('warning')} warning · ${ICON.info} ${count('info')} info`,
  ];

  if (overflow.length) {
    lines.push('', `<details><summary>${overflow.length} more finding(s) not posted inline</summary>`, '');
    for (const f of overflow) lines.push(`- ${ICON[f.severity]} \`${f.path}:${f.line}\` ${f.message} _(${f.source})_`);
    lines.push('', '</details>');
  }
  if (llmSkipped) lines.push('', '_Guideline review skipped (no Anthropic API key). Only regex rules ran._');
  if (truncated) lines.push('', '_The diff was too large to send in full; the guideline review covered the first part only._');

  return {
    event: 'COMMENT',
    body: lines.join('\n'),
    comments: inline.map((f) => ({
      path: f.path,
      line: f.line,
      side: 'RIGHT',
      body: `${ICON[f.severity]} **${f.severity}** · ${f.message}\n\n<sub>${f.source}</sub>`,
    })),
  };
}
