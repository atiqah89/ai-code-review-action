import { parsePatch, matchesAny } from './diff.js';
import { runRules, validateConfig } from './rules.js';
import { reviewWithClaude } from './llm.js';
import { buildReview, dedupe, shouldFail } from './review.js';

/**
 * The whole review, independent of how inputs arrive, so it can be tested and run locally.
 * @returns {Promise<{ findings: object[], review: object, failed: boolean }>}
 */
export async function runReview({ github, owner, repo, pullNumber, rulesText, inputs, log = console.log, fetchImpl }) {
  const config = validateConfig(rulesText ? JSON.parse(rulesText) : {});

  const prFiles = await github.listPullFiles(owner, repo, pullNumber);
  const files = prFiles
    .filter((f) => f.status !== 'removed')
    .filter((f) => !matchesAny(f.filename, config.ignore ?? ['package-lock.json', '*.min.js', '*.lock', 'dist/**']))
    .map((f) => ({ path: f.filename, added: parsePatch(f.patch) }))
    .filter((f) => f.added.length > 0);

  log(`Reviewing ${files.length} file(s) with ${config.rules?.length ?? 0} rule(s) and ${config.guidelines?.length ?? 0} guideline(s).`);

  const ruleFindings = runRules(files, config);

  let llm = { findings: [], truncated: false, skipped: true };
  try {
    llm = await reviewWithClaude({
      files,
      guidelines: config.guidelines ?? [],
      apiKey: inputs.anthropicApiKey,
      model: inputs.model,
      maxChars: inputs.maxDiffChars,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  } catch (err) {
    // An LLM outage must not block merges: keep the deterministic results.
    log(`::warning::Guideline review failed, continuing with rules only: ${err.message}`);
  }

  const findings = dedupe([...ruleFindings, ...llm.findings]);
  const review = buildReview(findings, {
    maxComments: inputs.maxComments,
    truncated: llm.truncated,
    llmSkipped: llm.skipped,
    filesReviewed: files.length,
  });

  return { findings, review, failed: shouldFail(findings, inputs.failOn) };
}
