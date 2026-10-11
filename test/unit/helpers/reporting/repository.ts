import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PACKAGE_FIXTURE, PLAN_FORMAT_FIXTURE } from './plans'

// A caller-owned root. No configuration writes, hooks overrides, global Git
// settings, network, signing keys or user credentials are needed by this fixture.
export async function buildFixtureRepository(
  root: string,
): Promise<{ root: string; first: string; head: string; git(args: readonly string[]): string }> {
  await mkdir(root, { recursive: true })
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    SystemRoot: process.env['SystemRoot'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_AUTHOR_NAME: 'Reporting Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Reporting Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-10-05T12:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-10-05T12:00:00+00:00',
  }
  function git(args: readonly string[]): string {
    return execFileSync('git', ['-C', root, ...args], {
      env,
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  }
  git(['init', '-b', 'main'])
  await writeFile(path.join(root, 'PLAN.md'), PLAN_FORMAT_FIXTURE)
  await writeFile(path.join(root, 'package.json'), PACKAGE_FIXTURE)
  await writeFile(
    path.join(root, 'CHANGELOG.md'),
    '# Changelog\n\n## [Unreleased]\n\n- Fixture change.\n\n## [0.14.2] - 2026-10-05\n\n- Fixture release.\n',
  )
  git(['add', 'PLAN.md', 'CHANGELOG.md', 'package.json'])
  git(['commit', '-m', 'M12: fixture contracts'])
  const first = git(['rev-parse', 'HEAD'])
  git(['tag', 'v0.14.2'])
  git(['branch', 'm12/0'])
  await writeFile(path.join(root, 'README.md'), '# Fixture\n\nA second commit.\n')
  env['GIT_AUTHOR_DATE'] = '2026-10-06T11:00:00+00:00'
  env['GIT_COMMITTER_DATE'] = '2026-10-06T11:00:00+00:00'
  git(['add', 'README.md'])
  git(['commit', '-m', 'M110a0: fixture runtime'])
  return { root, first, head: git(['rev-parse', 'HEAD']), git }
}
