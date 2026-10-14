// The pure pieces of scripts/rule2-gate.mjs (AGENTS.md rule 2 at the merge
// and release doors), kept here so the unit test can read them through the
// real module: the script file only parses arguments and calls in, and keeps
// no main-module comparison. Everything here decides from values passed in
// as data; anything the gate cannot read throws instead of passing.
export class GateError extends Error {}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
    path: value['path'],
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

/**
 * The commits the release door needs hosted evidence for that have none.
 * Every expected commit is counted on its own: runs on the tagged commit
 * must not stand in for a pull request head whose runs were skipped or
 * deleted, and the other way round.
 */
export function missingEvidence(tag, heads, runs) {
  const labels = new Map([[tag, `commit ${tag}`]])
  for (const head of heads) {
    if (head.sha === tag || labels.has(head.sha)) continue
    labels.set(head.sha, `pull request ${String(head.number)} head ${head.sha}`)
  }
  const missing = []
  for (const [commit, label] of labels)
    if (runs.every((run) => run.headSha !== commit))
      missing.push(`${label} has no workflow run: there is no hosted result to release on`)
  return missing
}
