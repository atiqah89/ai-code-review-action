# AI Code Review Action

[![CI](https://github.com/atiqah89/ai-code-review-action/actions/workflows/ci.yml/badge.svg)](https://github.com/atiqah89/ai-code-review-action/actions/workflows/ci.yml)

A GitHub Action that reviews pull requests against **your team's rules** and posts inline comments.

It runs two layers:

1. **Regex rules** (deterministic, free, always on): hard-coded secrets, tokens in logs, disabled RLS, `.Result` deadlocks, TODOs without a ticket. Add your own in JSON.
2. **Plain-language guidelines** checked by Claude (optional): rules that a regex can't express, such as *"calls to third-party APIs must handle 401 and 429"* or *"new tables need an RLS policy"*.

It started as the rule-based review step I use with AI agents at work, extracted into a reusable action.

## Design decisions

- **No dependencies, no build step.** It uses Node's built-in `fetch` and reads `INPUT_*` environment variables directly, so there's no `node_modules` or `dist/` to audit or keep in sync.
- **Rules are read from the base branch**, so a PR can't weaken the rules it is judged by.
- **Only added lines are reviewed**, and the model's findings are validated against the diff. A finding that points at a line not in the diff is dropped, which guards against invented locations.
- **An LLM outage never blocks merges.** If the Anthropic API fails, the action logs a warning and keeps the regex results.
- **Works on fork PRs.** Secrets aren't available there, so it falls back to rules-only mode instead of failing.
- **Noise control**: duplicates are merged, errors come first, and comments beyond `max-comments` are collapsed into the summary.

## Usage

```yaml
# .github/workflows/review.yml
name: AI code review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: atiqah89/ai-code-review-action@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }} # optional
          fail-on: error                                     # error | warning | info | never
```

Then add `.github/review-rules.json` to your default branch. Start from [`examples/review-rules.json`](examples/review-rules.json):

```json
{
  "guidelines": [
    "Never log access tokens, refresh tokens, API keys or full request headers."
  ],
  "rules": [
    {
      "id": "sync-over-async",
      "pattern": "\\.(Result|Wait\\(\\))\\b",
      "severity": "warning",
      "files": ["*.cs"],
      "message": "Blocking on a Task can deadlock. Use await."
    }
  ],
  "ignore": ["package-lock.json", "dist/**"]
}
```

| Rule field | Meaning |
|---|---|
| `id` | Shown under each comment, so people know which rule fired |
| `pattern` / `flags` | JavaScript regular expression, tested against each added line |
| `severity` | `info`, `warning` or `error` (default `warning`) |
| `files` / `exclude` | Globs; `*.ts` matches in any folder, `src/**/*.cs` is anchored |

### Inputs

| Input | Default | |
|---|---|---|
| `github-token` | `${{ github.token }}` | Needs `pull-requests: write` |
| `anthropic-api-key` | empty | Empty means rules-only mode |
| `rules-file` | `.github/review-rules.json` | |
| `model` | `claude-sonnet-5-5` | |
| `max-diff-chars` | `60000` | Larger diffs are truncated for the model only |
| `max-comments` | `25` | |
| `fail-on` | `error` | |

Outputs: `findings` and `errors` (counts), plus a summary in the job's step summary.

## Development

```bash
npm test   # node:test, no install needed
```

The core (`src/run.js`) receives the GitHub client and `fetch` as parameters, so the tests run the whole review against fakes, with no network or tokens.

```
src/
  index.js    action entry: inputs, event payload, outputs
  run.js      orchestration (pure, testable)
  diff.js     unified-diff parser + glob matching
  rules.js    config validation + regex rules
  llm.js      Claude prompt, response parsing, line validation
  review.js   dedupe, severity threshold, review payload
  github.js   the three REST calls this action needs
```

## License

MIT
