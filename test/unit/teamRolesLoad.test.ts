// D119 catch burn-down: unreadable roots and files fail closed into
// refusals, and only an unproven widening refuses as widening. The
// file system fails for real below.
import { describe, expect, it } from 'vitest'
import type { AgentRoot } from '../../src/core/context/customAgents'
import { loadRoles } from '../../src/core/team/roles'

const encoder = new TextEncoder()

function roleFile(body: string): Uint8Array {
  return encoder.encode(body)
}

function accessRefusal(): Error {
  return Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
}

function io(files: Readonly<Record<string, string>>, failures: readonly string[] = []) {
  return {
    realPath: (absolute: string) =>
      failures.includes('realPath') ? Promise.reject(accessRefusal()) : Promise.resolve(absolute),
    listDirectory: (absolute: string) =>
      failures.includes('listDirectory')
        ? Promise.reject(accessRefusal())
        : Promise.resolve(
            Object.keys(files)
              .filter((path) => path.startsWith(`${absolute}/`))
              .map((path) => path.slice(absolute.length + 1).split('/', 1)[0]!),
          ),
    readFile: (absolute: string) =>
      failures.includes('readFile')
        ? Promise.reject(accessRefusal())
        : Promise.resolve(files[absolute] === undefined ? undefined : roleFile(files[absolute])),
  }
}

const REVIEWER = '---\nname: reviewer\ndescription: Reviews code\n---\n\nReview carefully.\n'

function userRoot(): AgentRoot {
  return { source: 'user', directory: '/roles', confineTo: undefined }
}

function environment(): {
  kind: 'known'
  value: {
    session: {
      offered: string[]
      delegates: string[]
      webSearchAllowed: boolean
      imagesAllowed: boolean
    }
    approvalMode: 'denyUnmatched'
    ceilings: { writePaths: string[]; approvalMode: 'denyUnmatched' }[]
    allowances: Record<string, never>
  }
} {
  return {
    kind: 'known',
    value: {
      session: { offered: [], delegates: [], webSearchAllowed: false, imagesAllowed: false },
      approvalMode: 'denyUnmatched',
      ceilings: [],
      allowances: {},
    },
  }
}

describe('role catalogue load failures', () => {
  it('refuses an unreadable catalogue root', async () => {
    const loaded = await loadRoles({ io: io({}, ['realPath']), platform: 'linux' }, [userRoot()], {
      trustedWorkspace: true,
      inputs: environment(),
    })
    expect(loaded.snapshot).toMatchObject({
      kind: 'unknown',
      input: 'catalogue',
      issue: 'unreadable',
      source: 'user',
    })
  })

  it('refuses an unreadable role file', async () => {
    const loaded = await loadRoles(
      {
        io: io({ '/roles/reviewer/AGENT.md': REVIEWER }, ['readFile']),
        platform: 'linux',
      },
      [userRoot()],
      { trustedWorkspace: true, inputs: environment() },
    )
    expect(loaded.snapshot).toMatchObject({
      kind: 'unknown',
      input: 'role',
      issue: 'unreadable',
      id: 'reviewer',
    })
  })

  it('loads a valid role with no holes', async () => {
    const loaded = await loadRoles(
      { io: io({ '/roles/reviewer/AGENT.md': REVIEWER }), platform: 'linux' },
      [userRoot()],
      { trustedWorkspace: true, inputs: environment() },
    )
    expect(loaded.holes).toEqual([])
    expect(loaded.snapshot.kind).toBe('known')
    expect(loaded.roles.some((role) => role.id === 'reviewer')).toBe(true)
  })

  it('refuses only an unproven widening as widening', async () => {
    const loaded = await loadRoles(
      {
        io: io({
          '/ws/roles/widener/AGENT.md':
            '---\nname: widener\ndescription: Widens paths\nwrite-paths: src/**\n---\n\nWidens.\n',
        }),
        platform: 'linux',
      },
      [{ source: 'project', directory: '/ws/roles', confineTo: '/ws' }],
      {
        trustedWorkspace: true,
        inputs: {
          kind: 'known',
          value: {
            session: {
              offered: [],
              delegates: [],
              webSearchAllowed: false,
              imagesAllowed: false,
            },
            approvalMode: 'denyUnmatched',
            ceilings: [{ writePaths: ['docs/**'], approvalMode: 'denyUnmatched' }],
            allowances: {},
          },
        },
      },
    )
    expect(loaded.snapshot).toMatchObject({
      kind: 'unknown',
      input: 'role',
      issue: 'widening',
      source: 'project',
    })
    expect(loaded.holes.some((hole) => hole.source === 'project' && hole.id === 'widener')).toBe(
      true,
    )
  })
})
