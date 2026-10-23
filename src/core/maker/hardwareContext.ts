import { fileIdentityKey, statIdentitySync } from '../fs/fileIdentity'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readSync,
  readdirSync,
} from 'node:fs'
import path from 'node:path'
import { MAKER_DETECT_MAX_BYTES, MAKER_DETECT_MAX_FILES, UI_TEXT } from '../../shared/constants'
import type { HardwareContext } from './guard/httpCommands'

function isScanFailure(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
}

// Inventory reads ports and the registry: transport and filesystem failures
// leave the inventory unknown (fail-safe); programming errors propagate.
function isInventoryFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    !(error instanceof ReferenceError) &&
    !(error instanceof SyntaxError) &&
    !(error instanceof RangeError)
  )
}

/** The only hardware detection and latch owner. Sources are host observations. */
export function hasHardwareEvidence(context: HardwareContext): boolean {
  return (
    context.isInventoryKnown === false ||
    (context.hardwareSessionLatched ??
      (context.isHardwareWorkspace === true ||
        context.isMakerEnabled === true ||
        context.isHardwareProject === true ||
        context.hasConnectedBoard === true ||
        (context.targets?.length ?? 0) > 0 ||
        (context.boardRoots?.length ?? 0) > 0))
  )
}

/**
Positive evidence only: an unknown inventory is fail-safe for commands, but
it is not proof of hardware. Attach-time fences (resume on an adapter that
cannot verify targets) refuse on this, so an unscannable or unqualified
machine does not make every session unresumable.
*/
function hasPositiveHardwareEvidence(context: HardwareContext): boolean {
  return (
    context.isHardwareWorkspace === true ||
    context.isMakerEnabled === true ||
    context.isHardwareProject === true ||
    context.hasConnectedBoard === true ||
    (context.targets?.length ?? 0) > 0 ||
    (context.boardRoots?.length ?? 0) > 0
  )
}

/** True: a marker was found. False: scanned clean. Undefined: cannot say. */
function scanForProject(root: string | undefined): boolean | undefined {
  if (root === undefined) return undefined
  try {
    const pending = [root]
    const budget = { files: 0 }
    while (pending.length > 0) {
      const directory = pending.pop()
      if (directory === undefined) break
      const found = scanDirectoryMarker(directory, pending, budget)
      if (found === 'marker') return true
      if (found === 'unknown') return undefined
    }
    return /(?:^|\/)CIRCUITPY\/?$/i.test(root.replaceAll('\\', '/'))
  } catch (error) {
    if (isScanFailure(error)) return undefined
    throw error
  }
}

function scanDirectoryMarker(
  directory: string,
  pending: string[],
  budget: { files: number },
): 'marker' | 'unknown' | undefined {
  const folder = opendirSync(directory, { bufferSize: 1 })
  try {
    for (let entry = folder.readSync(); entry !== null; entry = folder.readSync()) {
      budget.files += 1
      if (budget.files >= MAKER_DETECT_MAX_FILES) return 'unknown'
      if (/^(?:\.|node_modules$|vendor$|dist$|build$|temp$)/.test(entry.name)) continue
      const file = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) return 'unknown'
      if (entry.isDirectory()) {
        pending.push(file)
        continue
      }
      if (!entry.isFile()) return 'unknown'
      if (
        /^(?:platformio\.ini|sdkconfig(?:\.defaults)?|pico_sdk_import\.cmake|printer\.cfg|Configuration.*\.h|prj\.conf|west\.ya?ml|code\.py|boot\.py|package\.xml)$|\.ino$/i.test(
          entry.name,
        )
      )
        return 'marker'
      if (!/^(?:CMakeLists\.txt)$|\.ya?ml$/i.test(entry.name)) {
        continue
      }

      const sniffed = sniffProjectFile(file)
      if (sniffed !== false) return sniffed
    }
    return undefined
  } finally {
    folder.closeSync()
  }
}

function sniffProjectFile(file: string): 'marker' | 'unknown' | false {
  // Enumeration can race a replacement: never wait for a FIFO writer or follow a link.
  const descriptor = openSync(
    file,
    constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW,
  )
  try {
    const stat = fstatSync(descriptor)
    if (!stat.isFile() || stat.size > MAKER_DETECT_MAX_BYTES) return 'unknown'
    const buffer = Buffer.alloc(MAKER_DETECT_MAX_BYTES)
    const count = readSync(descriptor, buffer, 0, buffer.length, 0)
    return /IDF_PATH|pico_sdk_import|pico_sdk_init|^\s*esphome\s*:/m.test(
      buffer.toString('utf8', 0, count),
    )
      ? 'marker'
      : false
  } finally {
    closeSync(descriptor)
  }
}

/** One workspace lease; disappearing evidence cannot unlatch it. */
export class HardwareWorkspace {
  private isLatched: boolean
  private hasPositiveEvidence: boolean
  private observation = ''
  private readonly activity = new Set<() => boolean>()
  public constructor(private readonly source: () => HardwareContext) {
    const initial = source()
    const scanned = scanForProject(initial.workspaceRoot)
    this.isLatched = initial.hardwareSessionLatched ?? scanned !== false
    this.hasPositiveEvidence = scanned === true
    this.observe(initial)
  }
  private signature(context: HardwareContext): string {
    return JSON.stringify([
      context.isInventoryKnown,
      context.isHardwareWorkspace,
      context.isMakerEnabled,
      context.isHardwareProject,
      context.hasConnectedBoard,
      context.targets,
      context.boardRoots,
    ])
  }
  public observe(context: HardwareContext): void {
    const { hardwareSessionLatched: _latched, ...evidence } = context
    this.isLatched ||= hasHardwareEvidence(evidence)
    this.hasPositiveEvidence ||= hasPositiveHardwareEvidence(evidence)
    this.observation = this.signature(context)
  }
  public current(): HardwareContext {
    const live = this.source()
    if (this.signature(live) !== this.observation) this.observe(live)
    return {
      ...live,
      hardwareOwner: this,
      isHardwareWorkspace: this.isLatched,
      hardwareSessionLatched: this.isLatched,
    }
  }
  public startSession(): void {
    const source = this.source()
    const scanned = scanForProject(source.workspaceRoot)
    this.isLatched ||= source.hardwareSessionLatched ?? scanned !== false
    this.hasPositiveEvidence ||= scanned === true
  }
  /** Positive evidence only (never the fail-safe latch); see the resume fence. */
  public isPositivelyHardware(): boolean {
    this.current()
    return this.hasPositiveEvidence
  }
  public trackActivity(isActive: () => boolean): () => void {
    this.activity.add(isActive)
    return () => {
      this.activity.delete(isActive)
    }
  }
  public reset(): void {
    if (this.source().isInventoryKnown === false) throw new Error(UI_TEXT.hardwareRefused)
    if ([...this.activity].some((isActive) => isActive())) throw new Error(UI_TEXT.hardwareRefused)
    this.isLatched = false
    this.hasPositiveEvidence = false
    this.observation = this.signature(this.source())
  }
}

/** Created once in each composition root; every consumer shares its workspace leases. */
export function createHardwareContexts(
  inventory: (workspaceRoot: string | undefined) => HardwareContext = connectedBoards,
) {
  const workspaces = new Map<string | undefined, HardwareWorkspace>()
  return (workspaceRoot: string | undefined): HardwareWorkspace => {
    const key = workspaceRoot?.replaceAll('\\', '/')
    let owner = workspaces.get(key)
    if (owner === undefined) {
      owner = new HardwareWorkspace(() => ({
        ...inventory(workspaceRoot),
        ...(workspaceRoot !== undefined && { workspaceRoot }),
      }))
      workspaces.set(key, owner)
    }
    return owner
  }
}

function mountedBoards(platform: NodeJS.Platform, roots: readonly string[]): readonly string[] {
  const boards: string[] = []
  for (const root of roots) {
    let entries
    try {
      entries = readdirSync(root, { withFileTypes: true })
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const address = path.join(root, entry.name)
      if (/^(?:CIRCUITPY|RPI-RP2)$/i.test(entry.name)) boards.push(address)
      else if (platform !== 'darwin') {
        const mounted = readdirSync(address, { withFileTypes: true })
        for (const board of mounted) {
          if (board.isDirectory() && /^(?:CIRCUITPY|RPI-RP2)$/i.test(board.name))
            boards.push(path.join(address, board.name))
        }
      }
    }
  }
  return boards
}

export function readHardwareInventory(
  platform: NodeJS.Platform,
  deviceRoot: string,
  mountRoots: readonly string[],
): HardwareContext {
  try {
    if (platform === 'win32') {
      // Windows discovery is not qualified yet. Unknown inventory is hardware,
      // never an empty inventory that permits an opaque command to actuate.
      return { hasConnectedBoard: true, isInventoryKnown: false }
    }
    const ports = readdirSync(deviceRoot).filter((name) =>
      /^(?:ttyUSB|ttyACM|cu\.(?:usb|wch|SLAB|UART))/i.test(name),
    )
    const targets = ports.map((name) => {
      const address = path.join(deviceRoot, name)
      const identity = statIdentitySync(address)
      const key = fileIdentityKey(identity)
      if (key === undefined) throw new Error(UI_TEXT.hardwareRefused)
      return {
        address,
        connectionId: `${key}:${String(identity.rdev)}:${String(identity.birthtimeNs)}`,
      }
    })
    return {
      isInventoryKnown: true,
      hasConnectedBoard: targets.length > 0,
      targets,
      boardRoots: mountedBoards(platform, mountRoots),
    }
  } catch (error) {
    if (isInventoryFailure(error)) return { hasConnectedBoard: true, isInventoryKnown: false }
    throw error
  }
}

function connectedBoards(): HardwareContext {
  return readHardwareInventory(
    process.platform,
    '/dev',
    process.platform === 'darwin' ? ['/Volumes'] : ['/media', '/run/media'],
  )
}
