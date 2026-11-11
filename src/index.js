// Entry point when GitHub runs the action. Reads inputs from the INPUT_* environment
// variables and the event payload, so no @actions/* packages (and no build step) are needed.
import { readFile, appendFile } from 'node:fs/promises';
import { createGitHub } from './github.js';
import { runReview } from './run.js';

const input = (name, fallback = '') => process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`]?.trim() || fallback;

async function setOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function main() {
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    console.log('Not a pull_request event; nothing to review.');
    return;
  }

  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const token = input('github-token');
  const apiKey = input('anthropic-api-key');
  if (apiKey) console.log(`::add-mask::${apiKey}`);

  const github = createGitHub({ token, apiUrl: process.env.GITHUB_API_URL || 'https://api.github.com' });

  // Rules come from the PR's base branch, so a PR can't weaken the rules it is judged by.
  const rulesPath = input('rules-file', '.github/review-rules.json');
  const rulesText = await github.getFileContent(owner, repo, rulesPath, pr.base.sha);
  if (!rulesText) console.log(`::notice::No rules file at ${rulesPath} on the base branch; using defaults.`);

  const { findings, review, failed } = await runReview({
    github,
    owner,
    repo,
    pullNumber: pr.number,
    rulesText,
    inputs: {
      anthropicApiKey: apiKey,
      model: input('model', 'claude-sonnet-5-5'),
      maxDiffChars: Number(input('max-diff-chars', '60000')),
      maxComments: Number(input('max-comments', '25')),
      failOn: input('fail-on', 'error'),
    },
  });

  await github.createReview(owner, repo, pr.number, review);

  await setOutput('findings', findings.length);
  await setOutput('errors', findings.filter((f) => f.severity === 'error').length);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${review.body}\n`);

  console.log(`Posted review with ${review.comments.length} inline comment(s); ${findings.length} finding(s) total.`);
  if (failed) {
    console.log(`::error::Review found issues at or above "${input('fail-on', 'error')}" severity.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.log(`::error::${err.message}`);
  process.exitCode = 1;
});
