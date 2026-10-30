// M108 X: the window's developer owner opens real machine state in its
// data folder: locked at first, unlockable with confirmation, shared with
// a second open of the same folder, and refusing unknown accounts.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountStore } from '../../src/core/providers/accounts'
import { handleDeveloperRequest } from '../../src/core/developer/surfaces'
import type { DeveloperSnapshot } from '../../src/shared/developerOptions'
import { openEditorDeveloperOptions } from '../../src/host/developer/editorDeveloper'

function metadata() {
  const entry = {
    id: 'meta',
    policyProvider: 'meta',
    product: 'model-api',
    auth: 'apiKey' as const,
    origin: 'https://example.com/',
    accounts: [{ id: 'default', label: 'Default', order: 0, thresholds: {} }],
  }
  return { read: () => Promise.resolve(entry), writeAccounts: () => Promise.resolve() }
}

function vault() {
  return {
    read: () => Promise.resolve(undefined),
    readForRemoval: () => Promise.resolve(undefined),
    write: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  }
}

function setup(isConfirmed: boolean) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rlf-m108-developer-'))
  const changed: DeveloperSnapshot[] = []
  const open = () =>
    openEditorDeveloperOptions({
      dataDir,
      store: new AccountStore(metadata(), vault()),
      metadata: metadata(),
      confirm: () => Promise.resolve(isConfirmed),
      changed: (snapshot) => {
        changed.push(snapshot)
      },
    })
  return {
    open,
    changed,
    clean: () => {
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

describe('window developer owner', () => {
  it('starts locked and unlocks with confirmation', async () => {
    const live = setup(true)
    try {
      const owner = await live.open()
      expect(owner.snapshot().isUnlocked).toBe(false)
      const unlocked = await owner.unlock('palette')
      expect(unlocked.isUnlocked).toBe(true)
      expect(unlocked.expiresAt).not.toBeNull()
      expect(live.changed.length).toBeGreaterThan(0)
    } finally {
      live.clean()
    }
  })

  it('stays locked when confirmation denies', async () => {
    const live = setup(false)
    try {
      const owner = await live.open()
      // A denial answers the locked state, not a failure: nothing was attempted.
      const denied = await owner.unlock('palette')
      expect(denied.isUnlocked).toBe(false)
      expect(owner.snapshot().isUnlocked).toBe(false)
    } finally {
      live.clean()
    }
  })

  it('shares the unlock with a second open of the same folder', async () => {
    const live = setup(true)
    try {
      const first = await live.open()
      await first.unlock('palette')
      const second = await live.open()
      // Either host honours the other's unlock: the stored grant opens
      // unlocked without asking again.
      expect(second.snapshot().isUnlocked).toBe(true)
      expect(second.snapshot().expiresAt).toBe(first.snapshot().expiresAt)
    } finally {
      live.clean()
    }
  })

  it('refuses a profile for an account the pool does not hold', async () => {
    const live = setup(true)
    try {
      const owner = await live.open()
      await owner.unlock('palette')
      await owner.setMultiple(true, 'palette')
      const reply = await handleDeveloperRequest(
        owner,
        { id: 'test', isLocal: true, kind: 'terminal' },
        { type: 'developer/addProfile', provider: 'meta', account: 'missing' },
      )
      expect(reply).toEqual({ type: 'developer/error', code: 'invalidRequest' })
    } finally {
      live.clean()
    }
  })
})
