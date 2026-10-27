// Used by actions/github-script; fork PRs may have a read-only token.
module.exports = async ({ github, context, phase, reportPath }) => {
  const { existsSync, readFileSync } = require('node:fs');
  const run = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const sha = context.payload.pull_request.head.sha;
  const marker = '<!-- perf-benchmark-results -->';
  const report =
    reportPath && existsSync(reportPath)
      ? readFileSync(reportPath, 'utf8')
      : `**${phase}** — see the workflow for completion, cancellation, or setup errors.`;
  const body = `${marker}\n${report}\n\nCommit \`${sha.slice(0, 7)}\` · [Current run and artifacts](${run})`;
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...context.repo,
    issue_number: context.issue.number,
  });
  const existing = comments.find(
    (comment) => comment.user?.type === 'Bot' && comment.body?.includes(marker),
  );
  if (existing)
    await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body });
  else
    await github.rest.issues.createComment({
      ...context.repo,
      issue_number: context.issue.number,
      body,
    });
};
