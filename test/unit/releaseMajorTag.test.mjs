import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const moveName = 'move the M80 v0 tag after all channels published'
const reportName = 'report the M80 major-tag outcome'
const releaseSha = 'b'.repeat(40)
const currentSha = 'a'.repeat(40)
const channels =
  '| GitHub Release | published |\n| Marketplace | published |\n| Open VSX | published |\n| npm (ACP) | published |\n'
const fixture = { directory: '', summary: '', api: '' }

beforeEach(() => {
  mkdirSync('dist', { recursive: true })
  fixture.directory = mkdtempSync(path.join('dist', 'major-tag-test-'))
  fixture.summary = path.join(fixture.directory, 'summary.md')
  fixture.api = path.join(fixture.directory, 'api.txt')
  writeFileSync(fixture.summary, channels)
  writeFileSync(fixture.api, '')
})
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }))

function step(name) {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
  const body = workflow.split(`\n      - name: ${name}\n`, 2)[1]
  expect(body, `workflow step ${name}`).toBeDefined()
  return body.split(/\n(?: {6}- | {2}[a-z][\w-]*:)/, 1)[0]
}

function runStep(name, environment = {}) {
  const script = step(name).split('        run: |\n', 2)[1]
  expect(script, `shell for ${name}`).toBeDefined()
  // Execute the workflow's actual shell; functions replace only external Git/API
  // calls, so fixtures cannot contact GitHub or mutate a real tag.
  const commands = String.raw`
git() {
  case "$1" in
    show-ref) [ "$TAG_EXISTS" = true ] ;;
    rev-parse) printf '%s\n' "$CURRENT_SHA" ;;
    merge-base)
      if [ "$3" = "$GITHUB_SHA" ]; then
        [ "$TAG_HISTORY" = already ]
      else
        [ "$TAG_HISTORY" != divergent ]
      fi ;;
    *) return 2 ;;
  esac
}
gh() {
  printf '%s\n' "$*" >> "$API_LOG"
  if [ "$API_STATUS" != 0 ]; then
    printf '%s\n' 'gh: HTTP 422 (release tags ruleset)' >&2
  fi
  return "$API_STATUS"
}
${script.replaceAll(/^ {10}/gm, '')}`
  const bash =
    process.platform === 'win32'
      ? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
      : 'bash'
  const child = spawnSync(bash, ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', commands], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: 'fixture/repository',
      GITHUB_SHA: releaseSha,
      GITHUB_STEP_SUMMARY: fixture.summary.replaceAll('\\', '/'),
      CURRENT_SHA: currentSha,
      TAG_EXISTS: 'true',
      TAG_HISTORY: 'forward',
      API_STATUS: '0',
      API_LOG: fixture.api.replaceAll('\\', '/'),
      ...environment,
    },
  })
  expect(child.error).toBeUndefined()
  return child
}

describe('M80 major-tag release outcomes (RELFAST3)', () => {
  it('keeps a tag failure nonblocking and reports its real outcome after channel reporting', () => {
    const move = step(moveName)
    const report = step(reportName)
    expect(move).toContain('id: major-tag\n        continue-on-error: true')
    expect(move).toContain(
      "steps.report.outputs.all-published == 'true' && hashFiles('action/action.yml') != ''",
    )
    expect(report).toContain(
      "if: ${{ !cancelled() && (steps.major-tag.outcome == 'success' || steps.major-tag.outcome == 'failure') }}",
    )
    expect(report).toContain('MAJOR_TAG_OUTCOME: ${{ steps.major-tag.outcome }}')
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8')
    expect(workflow.indexOf('run: node scripts/release-summary.mjs')).toBeLessThan(
      workflow.indexOf(`- name: ${moveName}`),
    )
    expect(step('report all channels and fail any incomplete job')).not.toContain(
      'continue-on-error',
    )
  })

  it.each(['true', 'false'])(
    'preserves HTTP 422 as a failed update/create when tag exists=%s',
    (exists) => {
      const child = runStep(moveName, { TAG_EXISTS: exists, API_STATUS: '1' })
      expect(child.status).toBe(1)
      expect(child.stderr).toContain('HTTP 422')
      expect(readFileSync(fixture.api, 'utf8')).toContain(
        exists === 'true' ? '--method PATCH' : '--method POST',
      )
    },
  )

  it('requests only a fast-forward update', () => {
    expect(runStep(moveName).status).toBe(0)
    expect(readFileSync(fixture.api, 'utf8')).toBe(
      `api --method PATCH repos/fixture/repository/git/refs/tags/v0 -f sha=${releaseSha} -F force=false\n`,
    )
  })

  it('creates a missing major tag', () => {
    expect(runStep(moveName, { TAG_EXISTS: 'false' }).status).toBe(0)
    expect(readFileSync(fixture.api, 'utf8')).toBe(
      `api --method POST repos/fixture/repository/git/refs -f ref=refs/tags/v0 -f sha=${releaseSha}\n`,
    )
  })

  it('keeps a current or newer descendant without an API call', () => {
    expect(runStep(moveName, { TAG_HISTORY: 'already' }).status).toBe(0)
    expect(readFileSync(fixture.api, 'utf8')).toBe('')
    expect(readFileSync(fixture.summary, 'utf8')).toContain(
      'v0 already points at this release or a newer descendant',
    )
  })

  it('refuses divergent history before an API call', () => {
    const child = runStep(moveName, { TAG_HISTORY: 'divergent' })
    expect(child.status).toBe(1)
    expect(child.stderr).toContain('v0 is on a divergent history; owner review required')
    expect(readFileSync(fixture.api, 'utf8')).toBe('')
  })

  it('reports admin recovery after failure and preserves all four published channel rows', () => {
    const child = runStep(reportName, { MAJOR_TAG_OUTCOME: 'failure' })
    expect(child.status).toBe(0)
    expect(child.stdout).toContain('::warning::M80 v0 update failed; admin move required')
    const summary = readFileSync(fixture.summary, 'utf8')
    expect(summary.startsWith(channels)).toBe(true)
    expect(summary).toContain('**admin move required**')
    expect(summary).toContain(releaseSha)
    expect(summary).toContain('docs/RELEASING.md')
    expect(summary).not.toContain('current or newer release')
  })

  it('reports success without requesting an admin move', () => {
    expect(runStep(reportName, { MAJOR_TAG_OUTCOME: 'success' }).status).toBe(0)
    const summary = readFileSync(fixture.summary, 'utf8')
    expect(summary.startsWith(channels)).toBe(true)
    expect(summary).toContain('current or newer release')
    expect(summary).not.toContain('admin move required')
  })
})
