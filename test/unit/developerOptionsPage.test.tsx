// @vitest-environment jsdom
// M108 X: the panel's Developer options entry renders real owner
// snapshots: locked reads the unlock hint with the install's version line,
// whose clicks post versionClick; unlocked shows the badge, the expiry and
// the working switches; the reducer stores pushed replies and counts page
// openings.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountStore } from '../../src/core/providers/accounts'
import { openEditorDeveloperOptions } from '../../src/host/developer/editorDeveloper'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import type { DeveloperRequest, DeveloperSnapshot } from '../../src/shared/developerOptions'
import { fill, formatDateTime } from '../../src/shared/l10n/text'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import DeveloperOptionsEntry from '../../src/webview/developer/DeveloperOptionsEntry'
import packageManifest from '../../package.json'

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterEach(() => {
  cleanup()
})

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

async function snapshot(isUnlocked: boolean): Promise<{
  readonly snapshot: DeveloperSnapshot
  readonly pushes: number
}> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rlf-m108-page-'))
  try {
    let pushes = 0
    const owner = await openEditorDeveloperOptions({
      dataDir,
      store: new AccountStore(metadata(), vault()),
      metadata: metadata(),
      confirm: () => Promise.resolve(true),
      changed: () => {
        pushes += 1
      },
    })
    const state = isUnlocked ? await owner.unlock('palette') : owner.snapshot()
    return { snapshot: state, pushes }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

function renderEntry(message: unknown, posted: DeveloperRequest[], closes: number[]) {
  render(
    <DeveloperOptionsEntry
      message={message}
      version={packageManifest.version}
      post={(request) => {
        posted.push(request)
      }}
      onClose={() => {
        closes.push(1)
      }}
    />,
  )
}

describe('developer options entry', () => {
  it('reads loading before the first reply, with no alert', () => {
    renderEntry(undefined, [], [])
    expect(screen.getByRole('status')).toHaveTextContent(UI_TEXT.loadingOutput)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reads a locked snapshot with the unlock hint and a clicking version line', async () => {
    const posted: DeveloperRequest[] = []
    const { snapshot: locked } = await snapshot(false)
    renderEntry(locked, posted, [])
    expect(screen.getByText(UI_TEXT.developer.helpUnlock)).toBeVisible()
    expect(screen.queryByRole('status', { name: UI_TEXT.developer.badge })).toBeNull()
    const version = screen.getByRole('button', {
      name: fill(UI_TEXT.developer.versionLine, { version: packageManifest.version }),
    })
    fireEvent.click(version)
    expect(posted).toEqual([{ type: 'developer/versionClick' }])
  })

  it('reads an unlocked snapshot with the badge, expiry and working switches', async () => {
    const posted: DeveloperRequest[] = []
    const { snapshot: unlocked } = await snapshot(true)
    renderEntry(unlocked, posted, [])
    expect(screen.getByRole('status', { name: UI_TEXT.developer.badge })).toBeVisible()
    expect(
      screen.getByText(
        fill(UI_TEXT.developer.expires, {
          time: formatDateTime(unlocked.expiresAt ?? 0),
        }),
      ),
    ).toBeVisible()
    const multiple = screen.getByRole('checkbox', { name: UI_TEXT.developer.allowMultiple })
    expect(multiple).toBeEnabled()
    fireEvent.click(multiple)
    expect(posted).toEqual([{ type: 'developer/setMultiple', enabled: true }])
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.developer.reset }))
    expect(posted[1]).toEqual({ type: 'developer/reset' })
  })

  it('reads an error reply in fixed words', () => {
    renderEntry({ type: 'developer/error', code: 'locked' }, [], [])
    expect(screen.getByRole('alert')).toHaveTextContent(UI_TEXT.developer.locked)
  })
})

describe('developer host messages', () => {
  it('stores the pushed reply with its version', async () => {
    const { snapshot: unlocked } = await snapshot(true)
    const next = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: { type: 'developerReply', version: packageManifest.version, reply: unlocked },
      at: 0,
    })
    expect(next.developerReply).toEqual({ version: packageManifest.version, reply: unlocked })
  })

  it('counts page openings', () => {
    const once = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: { type: 'openDeveloper' },
      at: 0,
    })
    const twice = uiReducer(once, {
      type: 'hostMessage',
      message: { type: 'openDeveloper' },
      at: 0,
    })
    expect([once.developerRequests, twice.developerRequests]).toEqual([1, 2])
  })
})
