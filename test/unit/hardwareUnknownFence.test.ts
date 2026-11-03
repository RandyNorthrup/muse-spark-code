// RLF-MAKERFENCE: an unknown scan or inventory is fail-safe for commands
// the guard table classifies as physical (and for opaque commands while
// the inventory is unknown), but it is not positive evidence of hardware:
// ordinary shell work runs as it would in any workspace. Only a proven
// hardware workspace fences every shell command (D83).
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { approvalHardwareAction, hasHardwareApproval } from '../../src/core/agent/approvalHardware'
import { choicesFor, PermissionEngine } from '../../src/core/backends/modelapi/permissions'
import { hardwareAction } from '../../src/core/maker/guard/hardwareCommands'
import type { HardwareContext } from '../../src/core/maker/guard/httpCommands'
import { isBoardVolumeWorkspace } from '../../src/core/maker/guard/modes'
import {
  createHardwareContexts,
  readHardwareInventory,
  readWindowsSerialComm,
  type HardwareWorkspace,
} from '../../src/core/maker/hardwareContext'
import { SessionHardwareGuard } from '../../src/core/maker/sessionGuard'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { MAKER_DETECT_MAX_BYTES, UI_TEXT } from '../../src/shared/constants'

type Card = Extract<AgentEvent, { type: 'approvalRequested' }>

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'muse-fence-'))
  roots.push(root)
  return root
}

const knownEmpty: HardwareContext = {
  isInventoryKnown: true,
  hasConnectedBoard: false,
  targets: [],
  boardRoots: [],
}

/** A root the scan cannot read (missing): latched, never positive. */
function unknownScan(): HardwareWorkspace {
  return createHardwareContexts(() => knownEmpty)(path.join(workspace(), 'missing'))
}

/** A clean root whose inventory could not be read: latched, never positive. */
function unknownInventory(): HardwareWorkspace {
  return createHardwareContexts(() => ({ isInventoryKnown: false, hasConnectedBoard: false }))(
    workspace(),
  )
}

/** A real hardware project at the root: positive evidence. */
function positiveProject(): HardwareWorkspace {
  const root = workspace()
  writeFileSync(path.join(root, 'platformio.ini'), '[env:board]')
  return createHardwareContexts(() => knownEmpty)(root)
}

function guard(owner: HardwareWorkspace): SessionHardwareGuard {
  return new SessionHardwareGuard(
    () => owner.current(),
    () => undefined,
    () => undefined,
  )
}

function shellCard(command: string): Card {
  return {
    type: 'approvalRequested',
    approvalId: 'approval-1',
    itemId: 'item-1',
    toolName: 'Bash',
    rawArgs: JSON.stringify({ command }),
    requirementId: { approvalId: 'approval-1', sourceIndex: 0 },
    subject: { kind: 'shell', command, toolName: 'Bash' },
    availableChoices: [...choicesFor('Bash', command)],
    isJudgeEscalated: false,
    isProtectedWrite: false,
  }
}

function decisions(card: {
  readonly availableChoices: readonly { readonly decision: string }[]
}): string[] {
  return card.availableChoices.map((choice) => choice.decision)
}

describe('what counts as a hardware workspace (root scan)', () => {
  it('a marker deep in a fixture folder does not make the workspace hardware', () => {
    const root = workspace()
    const fixture = path.join(root, 'test', 'fixtures', 'maker-emulators', 'esp32s3')
    mkdirSync(fixture, { recursive: true })
    writeFileSync(path.join(fixture, 'sdkconfig.defaults'), 'CONFIG_IDF_TARGET="esp32s3"')
    writeFileSync(path.join(root, 'package.json'), '{}')
    const owner = createHardwareContexts(() => knownEmpty)(root)
    expect(owner.current().isHardwareWorkspace).toBe(false)
    expect(owner.isPositivelyHardware()).toBe(false)
  })

  it('the scan ends at the same root entry whatever the directory order', () => {
    // An oversize project file cannot be sniffed (unknown). Name order,
    // not filesystem order, decides whether the marker is seen first.
    const oversize = 'x'.repeat(MAKER_DETECT_MAX_BYTES + 1)
    const unknownFirst = workspace()
    writeFileSync(path.join(unknownFirst, 'a.yaml'), oversize)
    writeFileSync(path.join(unknownFirst, 'z.ino'), 'void setup() {}')
    const first = createHardwareContexts(() => knownEmpty)(unknownFirst)
    expect(first.current().isHardwareWorkspace).toBe(true)
    expect(first.isPositivelyHardware()).toBe(false)

    const markerFirst = workspace()
    writeFileSync(path.join(markerFirst, 'a.ino'), 'void setup() {}')
    writeFileSync(path.join(markerFirst, 'z.yaml'), oversize)
    const second = createHardwareContexts(() => knownEmpty)(markerFirst)
    expect(second.current().isHardwareWorkspace).toBe(true)
    expect(second.isPositivelyHardware()).toBe(true)
  })

  it('a board-volume root is the one workspace refused at turn start', () => {
    const root = path.join(workspace(), 'CIRCUITPY')
    mkdirSync(root)
    const owner = createHardwareContexts(() => knownEmpty)(root)
    expect(owner.isPositivelyHardware()).toBe(true)
    expect(isBoardVolumeWorkspace(owner.current())).toBe(true)
    expect(isBoardVolumeWorkspace(positiveProject().current())).toBe(false)
  })
})

describe('unknown evidence classifies by the guard table alone', () => {
  it('ordinary commands are not device actions; physical ones still are', () => {
    for (const owner of [unknownScan(), unknownInventory()]) {
      const context = owner.current()
      expect(context.isHardwareWorkspace).toBe(true)
      expect(owner.isPositivelyHardware()).toBe(false)
      expect(approvalHardwareAction({ kind: 'shell', command: 'pwd' }, context)).toBeUndefined()
      expect(
        approvalHardwareAction({ kind: 'shell', command: 'git status --short' }, context),
      ).toBeUndefined()
      expect(
        approvalHardwareAction(
          { kind: 'shell', command: 'esptool write_flash 0x0 firmware.bin' },
          context,
        ),
      ).toBe('program')
      expect(
        approvalHardwareAction({ kind: 'shell', command: 'espefuse burn_key K k.bin' }, context),
      ).toBe('refused')
    }
  })

  it('an opaque interpreter command is ordinary only while the inventory is known', () => {
    // Known-empty inventory: no board is connected, so `node server.js`
    // is ordinary work. Unknown inventory: a board may be connected
    // unseen, so a command the classifier cannot read stays actuate.
    expect(hardwareAction('node server.js', 'bash', unknownScan().current())).toBeUndefined()
    expect(hardwareAction('node server.js', 'bash', unknownInventory().current())).toBe('actuate')
    expect(hardwareAction('pwd', 'bash', unknownInventory().current())).toBeUndefined()
  })

  it('a proven hardware workspace still fences every shell command', () => {
    const context = positiveProject().current()
    expect(approvalHardwareAction({ kind: 'shell', command: 'pwd' }, context)).toBe('actuate')
    expect(hardwareAction('node server.js', 'bash', context)).toBe('actuate')
  })
})

describe('the Muse Code session guard under unknown evidence', () => {
  it('a plain shell approval keeps its choices and an approval stands', () => {
    for (const owner of [unknownScan(), unknownInventory()]) {
      const session = guard(owner)
      try {
        const card = shellCard('pwd')
        const scrubbed = session.scrub(card, 'Bash')
        expect(decisions(scrubbed)).toContain('approved')
        expect(() => {
          session.validate(scrubbed.availableChoices[0], scrubbed.subject)
        }).not.toThrow()
        expect(session.admit(shellCard('pwd'))).toBe(true)
        expect(hasHardwareApproval(card)).toBe(false)
      } finally {
        session.dispose()
      }
    }
  })

  it('a physical action is still stopped: deny-only card, approval refused', () => {
    for (const owner of [unknownScan(), unknownInventory(), positiveProject()]) {
      const session = guard(owner)
      try {
        const card = shellCard('esptool write_flash 0x0 firmware.bin')
        const scrubbed = session.scrub(card, 'Bash')
        expect(decisions(scrubbed)).not.toContain('approved')
        expect(scrubbed.note).toBe(UI_TEXT.hardwareBindingUnavailable)
        expect(() => {
          session.validate(
            { choiceId: 'x', label: 'x', decision: 'approved', scope: 'once' },
            scrubbed.subject,
          )
        }).toThrow(UI_TEXT.hardwareBindingUnavailable)
      } finally {
        session.dispose()
      }
    }
  })

  it('a proven hardware workspace still fences a plain command on this adapter', () => {
    const session = guard(positiveProject())
    try {
      const scrubbed = session.scrub(shellCard('pwd'), 'Bash')
      expect(decisions(scrubbed)).not.toContain('approved')
    } finally {
      session.dispose()
    }
  })
})

describe('the Model API permission engine under unknown evidence', () => {
  it('ordinary work is judged by the mode, not settled as hardware', () => {
    for (const owner of [unknownScan(), unknownInventory()]) {
      const hardware = owner.current()
      expect(
        new PermissionEngine('allowAll').judge({
          toolName: 'bash',
          toolClass: 'shell',
          command: 'pwd',
          dialect: 'bash',
          hardware,
        }).verdict,
      ).toBe('allow')
      const asked = new PermissionEngine('onRequest').judge({
        toolName: 'bash',
        toolClass: 'shell',
        command: 'pwd',
        dialect: 'bash',
        hardware,
      })
      expect(asked.verdict).toBe('ask')
      expect(asked.settledBy).not.toBe('hardwareDetected')
      expect(asked.hasSessionChoice).toBe(true)
    }
  })

  it('physical and opaque commands stay refused while the inventory is unknown', () => {
    const hardware = unknownInventory().current()
    for (const command of ['esptool write_flash 0x0 firmware.bin', 'python opaque.py']) {
      expect(
        new PermissionEngine('onRequest').judge({
          toolName: 'bash',
          toolClass: 'shell',
          command,
          dialect: 'bash',
          hardware,
        }),
      ).toMatchObject({ verdict: 'deny', settledBy: 'hardwareDetected' })
    }
    // The same physical command asks exactly once when the inventory is
    // known (the binding can be minted on this backend).
    expect(
      new PermissionEngine('onRequest').judge({
        toolName: 'bash',
        toolClass: 'shell',
        command: 'esptool write_flash 0x0 firmware.bin',
        dialect: 'bash',
        hardware: unknownScan().current(),
      }),
    ).toMatchObject({ verdict: 'ask', settledBy: 'hardwareDetected', hasSessionChoice: false })
  })
})

// Root ignores directory permissions, so the EACCES case below cannot
// be staged as root or on Windows.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe('the inventory read', () => {
  it('the win32 path latches without becoming positive evidence', () => {
    const devices = workspace()
    const missing = path.join(devices, 'no-such-system-root')
    const owner = createHardwareContexts(() =>
      readHardwareInventory('win32', devices, [], () => readWindowsSerialComm(missing)),
    )(workspace())
    expect(owner.current().isHardwareWorkspace).toBe(true)
    expect(owner.isPositivelyHardware()).toBe(false)
  })

  it.skipIf(process.platform === 'win32' || isRoot)(
    'an unlistable mount folder is skipped, never a failed inventory',
    () => {
      const devices = workspace()
      const mounts = workspace()
      mkdirSync(path.join(mounts, 'CIRCUITPY'))
      const other = path.join(mounts, 'someone-else')
      mkdirSync(path.join(other, 'RPI-RP2'), { recursive: true })
      chmodSync(other, 0o000)
      try {
        const inventory = readHardwareInventory('linux', devices, [mounts])
        expect(inventory.isInventoryKnown).toBe(true)
        expect(inventory.boardRoots).toEqual([path.join(mounts, 'CIRCUITPY')])
      } finally {
        chmodSync(other, 0o755)
      }
    },
  )
})
