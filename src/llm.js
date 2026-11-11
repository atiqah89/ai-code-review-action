import { SEVERITIES } from './rules.js';

const SYSTEM_PROMPT = `You are a senior engineer doing a pull request review.
Review ONLY the added lines you are given, and ONLY against the team guidelines provided.
Do not comment on style that the guidelines don't mention. Do not praise. If nothing violates a guideline, return [].

Respond with a JSON array and nothing else. Each element:
{"path": "<file path>", "line": <line number from the input>, "severity": "info" | "warning" | "error", "message": "<one or two sentences: what is wrong and how to fix it>"}`;

/** Builds the user message: guidelines, then every added line as `path:line | code`. */
export function buildPrompt(files, guidelines, maxChars) {
  const header =
    `Team guidelines:\n${guidelines.map((g, i) => `${i + 1}. ${g}`).join('\n')}\n\n` +
    'Added lines (format: path:line | code):\n';

  let body = '';
  let truncated = false;
  outer: for (const file of files) {
    for (const { line, text } of file.added) {
      const entry = `${file.path}:${line} | ${text}\n`;
      if (header.length + body.length + entry.length > maxChars) {
        truncated = true;
        break outer;
      }
      body += entry;
    }
  }
  return { prompt: header + body, truncated };
}

/** Pulls the JSON array out of the reply, even if the model wrapped it in a ``` fence. */
export function parseFindings(text) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Asks Claude to check the added lines against the plain-language guidelines.
 * Findings pointing at lines that weren't in the diff are dropped: GitHub would reject
 * them, and it guards against the model inventing locations.
 */
export async function reviewWithClaude({ files, guidelines, apiKey, model, maxChars, fetchImpl = fetch }) {
  if (!apiKey || !guidelines?.length) return { findings: [], truncated: false, skipped: true };

  const { prompt, truncated } = buildPrompt(files, guidelines, maxChars);
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API returned ${response.status}: ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');

  const validLines = new Set(files.flatMap((f) => f.added.map((a) => `${f.path}:${a.line}`)));
  const findings = parseFindings(text)
    .filter((f) => f && typeof f.path === 'string' && Number.isInteger(f.line) && typeof f.message === 'string')
    .filter((f) => validLines.has(`${f.path}:${f.line}`))
    .map((f) => ({
      path: f.path,
      line: f.line,
      severity: SEVERITIES.includes(f.severity) ? f.severity : 'warning',
      message: f.message.trim(),
      source: 'claude',
    }));

  return { findings, truncated, skipped: false };
}
