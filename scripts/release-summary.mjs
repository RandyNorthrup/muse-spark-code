import { appendFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Missing/blocked/cancelled jobs are failures, never silently skipped channels. */
export function releaseSummary(needs) {
  const labels = {
    release: 'GitHub Release',
    publish: 'Marketplace',
    openvsx: 'Open VSX',
    npm: 'npm (ACP)',
  }
  const rows = Object.entries(labels).map(([job, label]) => {
    const entry = needs[job]
    const output = entry?.outputs?.outcome
    const outcome =
      entry?.result === 'success' &&
      (output === 'published' || (job !== 'release' && output === 'skipped-no-secret'))
        ? output
        : 'failed'
    return { label, outcome }
  })
  return {
    failed: rows.some(({ outcome }) => outcome === 'failed'),
    allPublished: rows.every(({ outcome }) => outcome === 'published'),
    markdown: `| Channel | Outcome |\n| --- | --- |\n${rows.map(({ label, outcome }) => `| ${label} | ${outcome} |`).join('\n')}\n`,
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const summary = releaseSummary(JSON.parse(process.env.RELEASE_NEEDS))
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.markdown)
  appendFileSync(process.env.GITHUB_OUTPUT, `all-published=${String(summary.allPublished)}\n`)
  if (summary.failed) process.exitCode = 1
}
