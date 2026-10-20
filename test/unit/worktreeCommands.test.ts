// The worktree commands' failure reads (src/host/commands/worktreeCommands.ts):
// every git refusal reaches the person in true words with its kind recorded;
// only git's own exit verdicts steer the flow (an invalid branch name, a
// missing branch, an unknown listing); anything else (a revoked trust, a git
// that never answered) throws to the caller with its cause.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  newWorktree,
  removeWorktree,
  type WorktreeDeps,
} from '../../src/host/commands/worktreeCommands'
import { UI_TEXT } from '../../src/shared/constants'
import { denyAccess } from './helpers/deniedAccess'
import { realGit } from './helpers/realGit'

const runFile = promisify(execFile)
const sleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

interface Seen {
  readonly errors: string[]
  readonly warnings: string[]
  readonly infos: string[]
}

function makeDeps(seen: Seen, overrides: Partial<WorktreeDeps> = {}): WorktreeDeps {
  return {
    workspaceRoot: undefined,
    platform: process.platform,
    isWorkspaceTrusted: () => true,
    runGit: realGit,
    pathExists: existsSync,
    askBranchName: () => Promise.resolve(undefined),
    pick: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
    offerOpen: () => Promise.resolve(false),
    openFolder: () => Promise.resolve(),
    recordWorktree: () => Promise.resolve(),
    showInformation: () => undefined,
    showWarning: () => undefined,
    showError: (message) => {
      seen.errors.push(message)
    },
    log: {
      trace: () => undefined,
      info: (message) => {
        seen.infos.push(message)
      },
      warn: (message) => {
        seen.warnings.push(message)
      },
      error: () => undefined,
    },
    ...overrides,
  }
}

function seen(): Seen {
  return { errors: [], warnings: [], infos: [] }
}

type Validate = (value: string) => Promise<string | undefined>

/** The branch prompt's check, captured mid-flow so the test can drive it. */
async function capturedCheck(
  start: (askBranchName: WorktreeDeps['askBranchName']) => Promise<void>,
): Promise<{ readonly validate: Validate; readonly dismiss: () => Promise<void> }> {
  let captured: Validate | undefined
  const { promise, resolve } = Promise.withResolvers<string | undefined>()
  const running = start((check) => {
    captured = check
    return promise
  })
  for (let waited = 0; captured === undefined && waited < 200; waited += 1) {
    await sleep(10)
  }
  if (captured === undefined) {
    throw new Error('the branch prompt never ran')
  }
  const validate = captured
  return {
    validate,
    dismiss: async () => {
      resolve(undefined)
      await running
    },
  }
}

describe('worktreeCommands failures', () => {
  let repo = ''
  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), 'worktree-commands-'))
    await runFile('git', ['init'], { cwd: repo })
    await runFile('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
    await runFile('git', ['config', 'user.name', 'Test'], { cwd: repo })
    await writeFile(path.join(repo, 'file.txt'), 'content\n')
    await runFile('git', ['add', '.'], { cwd: repo })
    await runFile('git', ['commit', '-m', 'initial'], { cwd: repo })
  })
  afterAll(async () => {
    await rm(repo, { recursive: true, force: true })
  })

  it('says a workspace outside any repository is not one', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'worktree-plain-'))
    try {
      const seenMessages = seen()
      await newWorktree(makeDeps(seenMessages, { workspaceRoot: folder }))
      expect(seenMessages.errors).toEqual([expect.stringContaining(UI_TEXT.worktreeNotRepository)])
      expect(seenMessages.warnings).toEqual([expect.stringContaining('No worktree repository')])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('validates branch names against real git verdicts', async () => {
    const abbrev = await realGit(['rev-parse', '--abbrev-ref', 'HEAD'], repo)
    const current = abbrev.trim()
    const seenMessages = seen()
    const check = await capturedCheck((askBranchName) =>
      newWorktree(makeDeps(seenMessages, { workspaceRoot: repo, askBranchName })),
    )
    await expect(check.validate('a bad name!')).resolves.toBe(UI_TEXT.worktreeBranchInvalid)
    await expect(check.validate('brand-new-branch')).resolves.toBeUndefined()
    await expect(check.validate(current)).resolves.toBe(UI_TEXT.worktreeBranchExists)
    await check.dismiss()
    expect(seenMessages.errors).toEqual([])
  })

  it('throws the revoked trust instead of misreading the branch', async () => {
    let isTrusted = true
    const seenMessages = seen()
    const check = await capturedCheck((askBranchName) =>
      newWorktree(
        makeDeps(seenMessages, {
          workspaceRoot: repo,
          askBranchName,
          isWorkspaceTrusted: () => isTrusted,
        }),
      ),
    )
    isTrusted = false
    await expect(check.validate('some-branch')).rejects.toThrow(UI_TEXT.worktreeUntrusted)
    expect(seenMessages.errors).toEqual([])
    isTrusted = true
    await check.dismiss()
  })

  it('creates the worktree and records it on the real flow', async () => {
    const seenMessages = seen()
    const recorded: { readonly folder: string; readonly branch: string }[] = []
    await newWorktree(
      makeDeps(seenMessages, {
        workspaceRoot: repo,
        askBranchName: () => Promise.resolve('feature-one'),
        pick: (items) => Promise.resolve(items[0]?.id),
        recordWorktree: (folder, branch) => {
          recorded.push({ folder, branch })
          return Promise.resolve()
        },
      }),
    )
    try {
      expect(recorded).toHaveLength(1)
      expect(existsSync(recorded[0]?.folder ?? '')).toBe(true)
      expect(seenMessages.errors).toEqual([])
    } finally {
      await runFile('git', ['worktree', 'remove', '--force', recorded[0]?.folder ?? ''], {
        cwd: repo,
      })
    }
  })

  it('shows a bad base instead of creating anything', async () => {
    const seenMessages = seen()
    await newWorktree(
      makeDeps(seenMessages, {
        workspaceRoot: repo,
        askBranchName: () => Promise.resolve('feature-bad'),
        pick: () => Promise.resolve('no-such-ref'),
      }),
    )
    expect(seenMessages.errors).toEqual([expect.stringContaining(UI_TEXT.worktreeAddFailed)])
    expect(seenMessages.warnings).toEqual([expect.stringContaining('worktree add failed')])
  })

  it('still offers the worktree when its record was refused', async () => {
    const vault = await mkdtemp(path.join(tmpdir(), 'worktree-vault-'))
    // A real permission failure (chmod 0 on POSIX, a deny entry on Windows).
    const restore = await denyAccess(vault)
    try {
      const seenMessages = seen()
      let wasOffered = false
      await newWorktree(
        makeDeps(seenMessages, {
          workspaceRoot: repo,
          askBranchName: () => Promise.resolve('feature-unrecorded'),
          pick: (items) => Promise.resolve(items[0]?.id),
          recordWorktree: () => writeFile(path.join(vault, 'record.json'), '{}'),
          offerOpen: () => {
            wasOffered = true
            return Promise.resolve(false)
          },
        }),
      )
      expect(wasOffered).toBe(true)
      expect(seenMessages.warnings).toEqual([expect.stringContaining('was not recorded')])
    } finally {
      await restore()
      await rm(vault, { recursive: true, force: true })
    }
  })

  /** Adds a branch worktree in the shared repo, returning its folder. */
  async function addWorktree(branch: string): Promise<string> {
    const added: string[] = []
    await newWorktree(
      makeDeps(seen(), {
        workspaceRoot: repo,
        askBranchName: () => Promise.resolve(branch),
        pick: (items) => Promise.resolve(items[0]?.id),
        recordWorktree: (folder) => {
          added.push(folder)
          return Promise.resolve()
        },
      }),
    )
    const folder = added[0] ?? ''
    expect(existsSync(folder)).toBe(true)
    return folder
  }

  /** Removes the folder through the flow, recording every confirm asked. */
  async function removeRecording(folder: string, seenMessages: Seen): Promise<string[]> {
    const confirms: string[] = []
    await removeWorktree(
      makeDeps(seenMessages, {
        workspaceRoot: repo,
        pick: () => Promise.resolve(folder),
        confirm: (message) => {
          confirms.push(message)
          return Promise.resolve(true)
        },
      }),
    )
    return confirms
  }

  it('removes a dirty worktree only after the second yes, with force', async () => {
    const folder = await addWorktree('feature-dirty')
    await writeFile(path.join(folder, 'dirty.txt'), 'uncommitted\n')
    const seenMessages = seen()
    const confirms = await removeRecording(folder, seenMessages)
    expect(confirms).toEqual([UI_TEXT.worktreeRemoveConfirm, UI_TEXT.worktreeDirtyConfirm])
    expect(existsSync(folder)).toBe(false)
    expect(seenMessages.errors).toEqual([])
  })

  it('removes a clean worktree with only the first yes', async () => {
    const folder = await addWorktree('feature-clean')
    const seenMessages = seen()
    const confirms = await removeRecording(folder, seenMessages)
    expect(confirms).toEqual([UI_TEXT.worktreeRemoveConfirm])
    expect(existsSync(folder)).toBe(false)
    expect(seenMessages.errors).toEqual([])
  })

  it('says listing the worktrees failed outside a repository', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'worktree-plain-'))
    try {
      const seenMessages = seen()
      await removeWorktree(makeDeps(seenMessages, { workspaceRoot: folder }))
      expect(seenMessages.errors).toEqual([expect.stringContaining(UI_TEXT.worktreeNotRepository)])
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
