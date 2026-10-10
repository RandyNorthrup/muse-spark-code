import { mkdir, symlink } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editAutomaticallyChoice, isReviewableApproval } from '../../src/core/agent/approvalRules'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { resolveWorkspacePath } from '../../src/core/workspacePath'
import { holdFor } from '../../src/core/worktreeConversations'
import { ShadowGit, ShadowStorageInWorkspaceError } from '../../src/host/checkpoints/shadowGit'
import { MODEL_TEXT, UI_TEXT } from '../../src/shared/constants'
import { CAPTURED_TURN_ID, capturedWriteRequested } from './helpers/protectedWriteCapture'
import { checkpointPort, harness, removeCheckpointFolders } from './helpers/checkpointHarness'
import { withCheckpointStorageGuard } from '../../src/host/checkpoints/checkpointHost'
import { noopToolIo } from './helpers/fakeToolIo'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import * as fileIdentity from '../../src/core/fs/fileIdentity'
import { adminShare } from './helpers/secWinShare'
import { isUncPath } from '../../src/core/windowsPathSpelling'
import { pathIdentityRelation } from '../../src/core/pathIdentity'

afterEach(removeCheckpointFolders)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ROOT = String.raw`C:\repo`
const REFUSED = [
  String.raw`\\?\C:\repo\..\outside`,
  '//?/C:/repo/x',
  String.raw`\\.\C:\repo\x`,
  '//./C:/repo/x',
  '\\\\.\\',
  '//.',
  String.raw`\??\C:\repo\x`,
  String.raw`\\localhost\C$\repo\x`,
  String.raw`\\127.0.0.1\c$\repo\x`,
  'file.txt::$DATA',
  'file.txt:stream',
  'CON:',
  'CON',
  'con...',
  'COM1',
  'NUL',
  '.git.',
  '.git ',
  '.git./config',
  '.git /config',
  String.raw`C:\repo. \x`,
  String.raw`repo. \x`,
  'COM¹',
  'COM² ',
  'COM³',
  'LPT¹',
  'LPT².',
  'LPT³',
  'aux ',
  'NUL..',
  'CONIN$',
  'conout$',
]
const SUBJECTS = [
  String.raw`C:\repo\.claude.\settings.json`,
  String.raw`C:\repo\AGENTS.md.`,
  String.raw`C:\repo\AGENTS.md `,
  String.raw`C:\repo\AGENTS.md::$DATA`,
  String.raw`\\?\C:\storage\checkpoints.\key\m86\x\journal.jsonl`,
  '//?/C:/storage/checkpoints/key/m86/x/journal.jsonl',
  String.raw`\\.\C:\storage\checkpoints\key\m86\x\journal.jsonl`,
  '//./C:/storage/checkpoints/key/m86/x/journal.jsonl',
  String.raw`\\localhost\C$\storage\checkpoints\key\m86\x\journal.jsonl`,
  String.raw`\\127.0.0.1\c$\storage\checkpoints\key\m86\x\journal.jsonl`,
  String.raw`C:\storage\checkpoints.\key\m86\x\journal.jsonl`,
  String.raw`C:\repo\shadow.git.\config`,
]

describe('SECWINPATH raw spelling and approval admission', () => {
  it('refuses every audit spelling before Windows workspace admission', () => {
    for (const given of REFUSED)
      expect(resolveWorkspacePath(ROOT, given, 'win32').ok, given).toBe(false)
    for (const given of ['PROGRA~1/x', 'GIT~1/config', String.raw`.GIT\config`, '.Git/hooks']) {
      expect(resolveWorkspacePath(ROOT, given, 'win32').ok, given).toBe(true)
    }
  })

  it('leaves POSIX backslashes, streams, devices and trailing characters literal', () => {
    for (const given of REFUSED) {
      if (given.startsWith('/')) continue
      expect(resolveWorkspacePath('/ws', given, 'linux').ok, given).toBe(true)
    }
  })

  it.each(SUBJECTS)(
    'requires a manual once-only choice through the captured mapper: %s',
    (subjectPath) => {
      vi.stubGlobal('process', { ...process, platform: 'win32' })
      const captured = capturedWriteRequested('session', subjectPath, false)
      const choices = captured['availableChoices']
      if (!Array.isArray(choices)) throw new Error('missing captured choices')
      const mapped = mapNotification({
        method: 'approval/requested',
        params: {
          ...captured,
          availableChoices: [
            ...choices,
            {
              choiceId: 'allow_local_prefix',
              label: 'Always allow in this workspace: write_file ...',
              decision: 'approvedPolicyAmendment',
              scope: 'localPersistent',
            },
          ],
        },
      })
      if (
        typeof mapped === 'string' ||
        !('event' in mapped) ||
        mapped.event.type !== 'approvalRequested'
      ) {
        throw new Error('captured approval did not map')
      }
      const event = mapped.event
      expect(event.isProtectedWrite).toBe(true)
      expect(event.availableChoices.map((choice) => choice.choiceId)).toEqual([
        'allow_once',
        'abort',
      ])
      expect(editAutomaticallyChoice(event, 'acceptEdits')).toBeUndefined()
      expect(isReviewableApproval(event, 'auto', CAPTURED_TURN_ID)).toBe(false)
      const unflagged = { ...event, isProtectedWrite: false }
      expect(editAutomaticallyChoice(unflagged, 'acceptEdits')).toBeUndefined()
      expect(isReviewableApproval(unflagged, 'auto', CAPTURED_TURN_ID)).toBe(false)
      const update = mapNotification({
        method: 'approval/updated',
        params: {
          sessionId: 'session',
          approvalId: captured['approvalId'],
          currentRequirementId: captured['currentRequirementId'],
          subject: captured['subject'],
          availableChoices: [
            ...choices,
            { choiceId: 'always', label: 'Always allow', decision: 'approved', scope: 'session' },
          ],
        },
      })
      expect(update).toMatchObject({
        event: { availableChoices: [{ choiceId: 'allow_once' }, { choiceId: 'abort' }] },
      })
    },
  )
})

describe('SECWINPATH native storage and hold ancestry', () => {
  it('admits proven UNC descendants and refuses a junction outside the UNC workspace', async (ctx) => {
    if (process.platform !== 'win32') return
    const h = await harness({ git: 'none' })
    await mkdir(h.storage, { recursive: true })
    await symlink(h.storage, path.join(h.root, 'escape'), 'junction')
    const uncRoot = adminShare(h.root)
    if (uncRoot === undefined) {
      ctx.skip('administrative share unavailable; reason printed')
      return
    }
    expect(resolveWorkspacePath(uncRoot, 'new.txt', 'win32').ok).toBe(true)
    expect(resolveWorkspacePath(uncRoot, 'escape/new.txt', 'win32').ok).toBe(false)
    const store = h.reopenAt(h.storage, uncRoot)
    const destination = String.raw`${uncRoot}\new.txt`
    expect(store.isStoragePath(destination)).toBe(false)
    expect(() => {
      checkpointPort({ store }).refuseStorageWrite(destination)
    }).not.toThrow()
    expect(store.isStoragePath(String.raw`${uncRoot}\escape\journal.jsonl`)).toBe(true)
  })

  // Another volume serial is another volume (outside); a same-volume ID that
  // matches no ancestor of storage cannot prove exclusion (held).
  it.for(['dev', 'ino'] as const)(
    'judges a UNC window by its SMB %s identity',
    async (field, ctx) => {
      if (process.platform !== 'win32') return
      const h = await harness({ git: 'none' })
      await mkdir(h.storage, { recursive: true })
      const unc = adminShare(h.root)
      if (unc === undefined) {
        ctx.skip('administrative share unavailable; reason printed')
        return
      }
      const nativeStat = fileIdentity.statIdentitySync
      // Far from any neighbour: NTFS gives folders made one after another
      // adjacent file IDs, so `+ 1` could land on the storage folder itself.
      const OFFSET = 1n << 40n
      vi.spyOn(fileIdentity, 'statIdentitySync').mockImplementation((given) => {
        const native = nativeStat(given)
        return given.startsWith('\\\\') ? { ...native, [field]: native[field] ^ OFFSET } : native
      })
      expect(pathIdentityRelation(unc, h.storage, 'win32')).toBe(
        field === 'dev' ? 'outside' : 'unknown',
      )
      if (field === 'dev') expect(holdFor([unc], [h.storage], [], 'win32')).toBeUndefined()
      else expect(holdFor([unc], [h.storage], [], 'win32')).toBeDefined()
    },
  )

  it('refuses an unreadable native exclusion proof', async () => {
    const h = await harness({ git: 'none' })
    await mkdir(h.storage, { recursive: true })
    const nativeStat = fileIdentity.statIdentitySync
    vi.spyOn(fileIdentity, 'statIdentitySync').mockImplementation((given) => {
      if (given === h.root) throw Object.assign(new Error('refused'), { code: 'EACCES' })
      return nativeStat(given)
    })
    expect(h.store.isStoragePath(path.join(h.root, 'new.txt'))).toBe(true)
    expect(holdFor([h.root], [h.storage], [], process.platform)).toBeDefined()
  })

  it.each(['replaced', 'missing'])(
    'refuses a %s native ancestor while its name is resolved',
    async (change) => {
      const h = await harness({ git: 'none' })
      await mkdir(h.storage, { recursive: true })
      const nativeStat = fileIdentity.statIdentitySync
      let hasSampled = false
      vi.spyOn(fileIdentity, 'statIdentitySync').mockImplementation((given) => {
        const native = nativeStat(given)
        if (given !== h.root) return native
        if (hasSampled) {
          if (change === 'missing') throw Object.assign(new Error('removed'), { code: 'ENOENT' })
          return { ...native, ino: native.ino + 1n }
        }
        hasSampled = true
        return native
      })
      expect(h.store.isStoragePath(path.join(h.root, 'new.txt'))).toBe(true)
    },
  )

  it('refuses every flagged storage spelling through all three real writer adapters', async () => {
    const h = await harness({ git: 'none' })
    const writes = vi.fn(() => Promise.resolve())
    const conditional = vi.fn<ToolIo['writeFileIfUnchanged']>(() => Promise.resolve('written'))
    const reserve = vi.fn(noopToolIo.reserveFile)
    const guarded = withCheckpointStorageGuard(
      { ...noopToolIo, writeFile: writes, writeFileIfUnchanged: conditional, reserveFile: reserve },
      checkpointPort(h),
    )
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    // A share is not storage by its spelling: workspace confinement owns UNC
    // admission, and the native suites judge shares by identity.
    const local = SUBJECTS.filter((subject) => !isUncPath(subject))
    for (const spelling of local) {
      expect(h.store.isStoragePath(spelling), spelling).toBe(true)
      // Its own sentence, not the storage one: these paths never touch storage.
      expect(h.store.storagePathProblem(spelling), spelling).toBe('spelling')
      const message = UI_TEXT.windowsPathRefused
      await expect(guarded.writeFile(spelling, 'x')).rejects.toThrow(message)
      await expect(
        guarded.writeFileIfUnchanged(spelling, 'before', 'x', {
          expectedCanonicalPath: spelling,
          unsavedAt: [],
        }),
      ).rejects.toThrow(message)
      await expect(guarded.reserveFile(spelling)).rejects.toThrow(message)
    }
    expect(writes).not.toHaveBeenCalled()
    expect(conditional).not.toHaveBeenCalled()
    expect(reserve).not.toHaveBeenCalled()
  })
  it('refuses a junction to journals even when the destination has no existing leaf', async () => {
    const h = await harness({ git: 'none' })
    await mkdir(h.storage, { recursive: true })
    const alias = path.join(h.root, 'alias')
    await symlink(h.storage, alias, 'junction')
    const destination = path.join(alias, 'm86', 'missing', 'journal.jsonl')
    expect(h.store.isStoragePath(destination)).toBe(true)
    expect(() => {
      checkpointPort(h).refuseStorageWrite(destination)
    }).toThrow(MODEL_TEXT.checkpointStorageWrite)
  })

  it('keeps a junction window held, including native descendants', async () => {
    const h = await harness({ git: 'none' })
    await mkdir(h.storage, { recursive: true })
    const alias = path.join(h.root, 'held-alias')
    await symlink(h.storage, alias, 'junction')
    expect(holdFor([path.join(alias, 'missing')], [h.storage], [], process.platform)).toBeDefined()
  })

  it('retains holds through both loopback shares by native identity', async (ctx) => {
    if (process.platform !== 'win32') return
    const h = await harness({ git: 'none' })
    await mkdir(h.storage, { recursive: true })
    for (const host of ['localhost', '127.0.0.1']) {
      const unc = adminShare(h.storage, host)
      if (unc === undefined) {
        ctx.skip('administrative share unavailable; reason printed')
        return
      }
      expect(holdFor([unc], [h.storage], [], 'win32'), host).toBeDefined()
      const shadow = new ShadowGit(
        {
          storageDir: path.join(h.storage, 'checkpoint'),
          top: unc,
          platform: 'win32',
          instance: 'oracle',
        },
        {
          git: () => Promise.reject(new Error('must not start git')),
          env: {},
          signal: new AbortController().signal,
        },
      )
      await expect(shadow.assertSeparate()).rejects.toBeInstanceOf(ShadowStorageInWorkspaceError)
    }
  })
})
