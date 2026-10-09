// The Git hooks `npm run prepare` installs must fail closed (UIHOOK017,
// docs/certification/rel017ci.md). On Windows a failing pre-commit hook used
// to land its commit when the reader of git's output had gone before the hook
// finished: husky's runtime died of SIGPIPE writing "script failed", and Git
// for Windows reads an MSYS2 signal death (13 << 8) as exit code 0.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureGitEnvironment } from './helpers/fixtureGit'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const installer = path.join(repoRoot, 'scripts/install-git-hooks.mjs')
const HUSKY_STUB = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"'
const READER_GONE = 'reader-gone'
// Writes, waits until the test has closed its end of git's stderr, writes
// again (into the closed pipe), then fails.
const LATE_FAILURE = [
  'echo "probe: checks failed"',
  `until [ -e ${READER_GONE} ]; do sleep 0.05; done`,
  'echo "probe: details nobody reads"',
  'exit 1',
  '',
].join('\n')

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** Git's environment for a throwaway repository: nothing inherited that steers or skips hooks. */
function cleanEnvironment() {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith('GIT_') && name !== 'HUSKY' && name !== 'MUSE_GIT_HOOK_STUB',
  )
  return fixtureGitEnvironment({
    ...Object.fromEntries(inherited),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
  })
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

/** A repository with the hooks prepare installs and `hook` as .husky/pre-commit. */
function repository(hook) {
  mkdirSync(path.join(repoRoot, 'temp'), { recursive: true })
  const root = mkdtempSync(path.join(repoRoot, 'temp', 'hook-stubs-'))
  folders.push(root)
  const env = cleanEnvironment()
  run('git', ['init', '-q'], root, env)
  run('git', ['config', 'user.name', 'Hook test'], root, env)
  run('git', ['config', 'user.email', 'hooks@example.invalid'], root, env)
  run(process.execPath, [installer], root, env)
  writeFileSync(path.join(root, '.husky', 'pre-commit'), hook)
  writeFileSync(path.join(root, 'file.txt'), 'staged\n')
  run('git', ['add', 'file.txt'], root, env)
  return { root, env }
}

function commitCount({ root, env }) {
  return spawnSync('git', ['rev-list', '--all', '--count'], {
    cwd: root,
    env,
    encoding: 'utf8',
  }).stdout.trim()
}

/** `git commit` whose stderr reader leaves after the first chunk, as `| Select-Object -First 1` does. */
function commitWithShortReader({ root, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['commit', '-q', '-m', 'probe'], {
      cwd: root,
      env,
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr.once('data', () => {
      child.stderr.destroy()
      writeFileSync(path.join(root, READER_GONE), '')
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
}

describe('fail-closed Git hook stubs', () => {
  it('keeps a hook failure after the output reader has gone', async () => {
    const repo = repository(LATE_FAILURE)
    const { code } = await commitWithShortReader(repo)
    expect(code).not.toBe(0)
    expect(commitCount(repo)).toBe('0')
  })

  it('still commits when the hook passes', () => {
    const repo = repository('echo "probe: checks passed"\n')
    run('git', ['commit', '-q', '-m', 'probe'], repo.root, repo.env)
    expect(commitCount(repo)).toBe('1')
  })

  it("refuses the repository's pre-commit under husky's own stubs", () => {
    const repo = repository('')
    copyFileSync(
      path.join(repoRoot, '.husky', 'pre-commit'),
      path.join(repo.root, '.husky', 'pre-commit'),
    )
    writeFileSync(path.join(repo.root, '.husky', '_', 'pre-commit'), HUSKY_STUB)
    const result = spawnSync('git', ['commit', '-q', '-m', 'probe'], {
      cwd: repo.root,
      env: repo.env,
      encoding: 'utf8',
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('npm run prepare')
    expect(commitCount(repo)).toBe('0')
  })
})
