// @ts-check
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

test.describe('Wayside Autonomous PR Flow E2E', () => {
  test('extractPrReferences parses GitHub PR URLs and branch names', async () => {
    const { extractPrReferences } = await import('../../scripts/agy-agent-runner.mjs');
    const text = 'I created branch feature/chat-popout and opened PR at https://github.com/tekjanson/Waymark/pull/225 for review.';
    const res = extractPrReferences(text);
    expect(res.prUrl).toBe('https://github.com/tekjanson/Waymark/pull/225');
    expect(res.prNumber).toBe('225');
    expect(res.branch).toBe('feature/chat-popout');
  });

  test('classifyMessage routes PR requests accurately', async () => {
    const { classifyMessage } = await import('../../scripts/wayside-orchestrator.mjs');
    const res = classifyMessage('hey can you put up new waymark branch and open a PR in the repo');
    expect(res.isCodeTask).toBe(true);
    expect(res.isConversation).toBe(false);
  });

  test('live agent autonomous branch, commit, push, and PR creation', async () => {
    // Check if gh CLI and git origin are operational
    let ghLoggedIn = false;
    try {
      execSync('gh auth status', { stdio: 'pipe' });
      ghLoggedIn = true;
    } catch {
      ghLoggedIn = false;
    }
    test.skip(!ghLoggedIn, 'Requires authenticated gh CLI on host');

    test.setTimeout(300_000); // 5 minutes max for full live test

    const { runAgyTask } = await import('../../scripts/agy-agent-runner.mjs');
    const runId = Date.now().toString(36);
    const branchName = `test/automated-pr-flow-${runId}`;
    const prTitle = `[E2E Test] Automated PR Flow Validation ${runId}`;
    const noteLine = `\n# Validation entry ${runId} at ${new Date().toISOString()}`;

    let createdPrNumber = null;
    let createdBranch = branchName;

    try {
      const task = `Create a test branch named '${branchName}', append '${noteLine.trim()}' to tests/fixtures/e2e-pr-smoke.txt, commit with message 'test: automated pr smoke ${runId}', push branch to origin, and open a Pull Request titled '${prTitle}' with body 'Automated E2E test verifying Wayside autonomous PR creation.'. Do not merge. Return the branch name and PR URL.`;

      const agyResult = await runAgyTask({
        task,
        isCodeTask: true,
        timeoutMs: 240_000,
      });

      expect(agyResult.ok).toBe(true);
      expect(agyResult.output).toBeTruthy();

      const prUrl = agyResult.prUrl || agyResult.output.match(/https:\/\/github\.com\/[^\s)]+\/pull\/(\d+)/)?.[0];
      expect(prUrl).toBeTruthy();
      expect(prUrl).toContain('/pull/');

      const prNumber = agyResult.prNumber || prUrl.match(/\/pull\/(\d+)/)?.[1];
      createdPrNumber = prNumber;

      // Validate live on GitHub using gh CLI
      const prDetailsRaw = execSync(`gh pr view ${prNumber} --json number,title,state,headRefName`, {
        cwd: ROOT,
        encoding: 'utf8',
      });
      const prDetails = JSON.parse(prDetailsRaw);

      expect(String(prDetails.number)).toBe(String(prNumber));
      expect(prDetails.state).toBe('OPEN');
      expect(prDetails.title).toContain(runId);
      expect(prDetails.headRefName).toBe(branchName);
    } finally {
      // Cleanup: close the test PR and delete remote and local branches
      if (createdPrNumber) {
        try {
          execSync(`gh pr close ${createdPrNumber} --delete-branch`, { cwd: ROOT, stdio: 'pipe' });
        } catch (e) {
          console.warn(`Failed to close test PR #${createdPrNumber}: ${e.message}`);
        }
      }
      try {
        execSync(`git checkout main`, { cwd: ROOT, stdio: 'pipe' });
        execSync(`git branch -D ${createdBranch}`, { cwd: ROOT, stdio: 'pipe' });
      } catch {}
    }
  });
});
