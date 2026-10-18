// Shared B1 drill setup: the Linux and macOS confinement suites run the same
// fixture, spelling matrix and runner against their own helper binary.
import { writeFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { fileIdentityKey, statIdentity } from '../../../src/core/fs/fileIdentity'
import { InspectRunner } from '../../../src/core/judge/fast/inspectExec'
import { inspectPathSpellings, inspectProtectedPaths } from './inspectPaths'
import { inspectStart } from './inspectStart'

export interface InspectCase {
  readonly root: string
  readonly workspace: string
  readonly binding: { root: string; identity: string }
  readonly home: string
  readonly allowed: string
  readonly outside: string
  readonly args: (
    program: string,
    operands: string[],
    tool: string[],
    isRecursive?: boolean,
  ) => string[]
}

export async function inspectFixture(scratch: string): Promise<InspectCase> {
  const root = await mkdtemp(path.join(scratch, 'case-'))
  const workspace = path.join(root, 'workspace'),
    home = path.join(root, 'home')
  await mkdir(workspace)
  await mkdir(home, { mode: 0o700 })
  const allowed = path.join(workspace, 'allowed.txt'),
    outside = path.join(root, 'outside.txt')
  writeFileSync(allowed, 'ALLOWED_CANARY\n')
  writeFileSync(outside, 'FORBIDDEN_CANARY\n')
  const identity = fileIdentityKey(await statIdentity(workspace))
  if (identity === undefined) throw new Error('Missing workspace identity')
  const args = (program: string, operands: string[], tool: string[], isRecursive = false) => [
    'run',
    workspace,
    identity,
    home,
    isRecursive ? 'recursive' : 'single',
    program,
    ...operands,
    '--',
    ...tool,
  ]
  return {
    root,
    workspace,
    binding: { root: workspace, identity },
    home,
    allowed,
    outside,
    args,
  }
}

export function inspectSpellingMatrix(): { spellings: string[]; expected: string } {
  const canonicalPaths = [
    'allowed.txt',
    ...inspectProtectedPaths.flatMap((name) => [
      name,
      name.toUpperCase(),
      `pkg/${name}/probe.txt`,
      `pkg/${name.toUpperCase()}/probe.txt`,
    ]),
  ]
  const spellings = canonicalPaths.flatMap((canonical) => inspectPathSpellings(canonical))
  const expected = canonicalPaths
    .flatMap((canonical, index) =>
      inspectPathSpellings(canonical).map(
        (spelling) =>
          `${canonical}\t${String(index === 0 && spelling === canonical ? 0 : 1)}\t${String(index === 0 ? 0 : 1)}\n`,
      ),
    )
    .join('')
  return { spellings, expected }
}

export function openInspectRunner(helper: string, root: string): InspectRunner {
  return new InspectRunner({
    helper,
    storage: path.join(root, 'storage'),
    start: inspectStart,
  })
}
