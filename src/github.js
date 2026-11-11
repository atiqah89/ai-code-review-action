/** Minimal GitHub REST client: just the calls this action needs, using the built-in fetch. */
export function createGitHub({ token, apiUrl = 'https://api.github.com', fetchImpl = fetch }) {
  async function request(method, path, body) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'ai-code-review-action',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub ${method} ${path} failed with ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response.status === 204 ? null : response.json();
  }

  return {
    /** All changed files in the PR (paginated; GitHub caps this at 3000 files). */
    async listPullFiles(owner, repo, number) {
      const files = [];
      for (let page = 1; page <= 30; page++) {
        const batch = await request('GET', `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        files.push(...batch);
        if (batch.length < 100) break;
      }
      return files;
    },

    async createReview(owner, repo, number, review) {
      return request('POST', `/repos/${owner}/${repo}/pulls/${number}/reviews`, review);
    },

    async getFileContent(owner, repo, path, ref) {
      try {
        const file = await request('GET', `/repos/${owner}/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
        return Buffer.from(file.content, 'base64').toString('utf8');
      } catch (err) {
        if (String(err.message).includes('failed with 404')) return null;
        throw err;
      }
    },
  };
}
