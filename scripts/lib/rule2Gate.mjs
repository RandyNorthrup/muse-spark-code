// The pure pieces of scripts/rule2-gate.mjs (AGENTS.md rule 2 at the merge
// and release doors), kept here so the unit test can read them through the
// real module: the script file only parses arguments and calls in, and keeps
// no main-module comparison. Everything here decides from values passed in
// as data; anything the gate cannot read throws instead of passing.
export class GateError extends Error {}

/** Publication recovery is a fresh run, never another execution of verify. */
export function assertReleaseAttempt(attempt) {
  if (Number(attempt) !== 1)
    throw new GateError(
      `Release verification is on attempt ${String(attempt)}: nothing is started again on the same commit (AGENTS.md rule 2). Use a new commit, or a fresh artifact-only recovery run after publication failed.`,
    )
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** REST paths and GITHUB_WORKFLOW_REF identify the same file despite @ref. */
export function workflowPath(reference, repository = '') {
  const prefix = `${repository}/`
  const relative =
    repository !== '' && reference.startsWith(prefix) ? reference.slice(prefix.length) : reference
  return relative.split('@', 1)[0] ?? ''
}

/** The fields of a workflow run the gate reads, checked. */
export function runOf(value) {
  if (
    !isRecord(value) ||
    typeof value['id'] !== 'number' ||
    typeof value['name'] !== 'string' ||
    typeof value['path'] !== 'string' ||
    typeof value['event'] !== 'string' ||
    typeof value['status'] !== 'string' ||
    typeof value['run_attempt'] !== 'number' ||
    typeof value['head_sha'] !== 'string'
  )
    throw new GateError("a workflow run in GitHub's answer lacks a field the gate reads")
  return {
    id: value['id'],
    name: value['name'],
    path: workflowPath(value['path']),
    event: value['event'],
    status: value['status'],
    conclusion: typeof value['conclusion'] === 'string' ? value['conclusion'] : '',
    attempt: value['run_attempt'],
    headSha: value['head_sha'],
  }
}

/**
 * One entry of the commits/pulls answer, checked. Anything the gate cannot
 * read fails closed: an entry that claims this merge but names no head to
 * check would otherwise drop that pull request out of the release door.
 */
export function pullOf(value) {
  if (!isRecord(value) || typeof value['number'] !== 'number')
    throw new GateError("a pull request in GitHub's answer lacks a field the gate reads")
  const mergedAt = value['merged_at']
  const mergeSha = value['merge_commit_sha']
  const head = value['head']
  if (
    (mergedAt !== null && typeof mergedAt !== 'string') ||
    (mergeSha !== null && typeof mergeSha !== 'string') ||
    !isRecord(head) ||
    (head['sha'] !== null && typeof head['sha'] !== 'string')
  )
    throw new GateError("a pull request in GitHub's answer lacks a field the gate reads")
  return {
    number: value['number'],
    mergedAt,
    mergeSha,
    headSha: head['sha'],
  }
}

/** Different workflow files may test a head; one file must not execute twice. */
export function duplicateExecutions(runs) {
  const first = new Map()
  const refusals = []
  for (const run of runs) {
    const key = `${run.headSha}:${run.path}`
    const earlier = first.get(key)
    if (earlier === undefined) first.set(key, run.id)
    else if (earlier !== run.id)
      refusals.push(
        `${run.path} has distinct runs ${String(earlier)} and ${String(run.id)} on head ${run.headSha}: nothing is started again on the same commit (AGENTS.md rule 2). Push a new commit: its run decides.`,
      )
  }
  return refusals
}

/** Successful execution, not a skipped/neutral workflow, is hosted evidence. */
export function isSuccessfulRun(run) {
  return run.status === 'completed' && run.conclusion === 'success'
}

/** The final release snapshot must still contain evidence, with nothing pending. */
export function releaseRecheck(tag, heads, runs) {
  return [
    ...missingEvidence(tag, heads, runs),
    ...duplicateExecutions(runs),
    ...runs
      .filter((run) => run.status !== 'completed')
      .map(
        (run) =>
          `${run.name} run ${String(run.id)} is still ${run.status} at the final release recheck: no result to pass on.`,
      ),
  ]
}

/** Every expected commit needs a successful executed workflow of its own. */
export function missingEvidence(tag, heads, runs) {
  const labels = new Map([[tag, `commit ${tag}`]])
  for (const head of heads) {
    if (head.sha === tag || labels.has(head.sha)) continue
    labels.set(head.sha, `pull request ${String(head.number)} head ${head.sha}`)
  }
  const missing = []
  for (const [commit, label] of labels)
    if (runs.every((run) => !(run.headSha === commit && isSuccessfulRun(run))))
      missing.push(
        `${label} has no successful workflow run: there is no hosted result to release on`,
      )
  return missing
}
