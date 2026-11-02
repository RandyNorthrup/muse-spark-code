import { fileIdentityKey, statIdentitySync } from '../fs/fileIdentity'
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  opendirSync,
  readSync,
  readdirSync,
  type Dirent,
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
export function hasPositiveHardwareEvidence(context: HardwareContext): boolean {
  return (
    context.isHardwareWorkspace === true ||
    context.isMakerEnabled === true ||
    context.isHardwareProject === true ||
    // A connected board is proof only when the inventory that reported it
    // was actually read: an unknown inventory reports no board at all, and
    // a shape that still pairs the two never counts as proof either.
    (context.isInventoryKnown !== false && context.hasConnectedBoard === true) ||
    (context.targets?.length ?? 0) > 0 ||
    (context.boardRoots?.length ?? 0) > 0
  )
}

/**
The project the person opened is the workspace root, so only a marker
among the root's own files makes this workspace a hardware project. A
marker deeper down - a test fixture, a vendored example, a docs folder
or a contained subproject of a larger repository - describes that
folder's project, not this workspace; device commands aimed at it stay
classified by the guard table wherever they run, and a board actually
connected is positive evidence through the inventory either way.
True: a root marker was found. False: scanned clean. Undefined: cannot say.
*/
function scanForProject(root: string | undefined): boolean | undefined {
  if (root === undefined) return undefined
  try {
    if (/(?:^|\/)CIRCUITPY\/?$/i.test(root.replaceAll('\\', '/'))) return true
    const entries = readRootEntries(root)
    if (entries === undefined) return undefined
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isDirectory()) continue
      if (entry.isSymbolicLink() || !entry.isFile()) return undefined
      if (
        /^(?:platformio\.ini|sdkconfig(?:\.defaults)?|pico_sdk_import\.cmake|printer\.cfg|Configuration.*\.h|prj\.conf|west\.ya?ml|code\.py|boot\.py|package\.xml)$|\.ino$/i.test(
          entry.name,
        )
      )
        return true
      if (!/^(?:CMakeLists\.txt)$|\.ya?ml$/i.test(entry.name)) continue
      const sniffed = sniffProjectFile(path.join(root, entry.name))
      if (sniffed === 'marker') return true
      if (sniffed === 'unknown') return undefined
    }
    return false
  } catch (error) {
    if (isScanFailure(error)) return undefined
    throw error
  }
}

/**
The root's entries in name order under one fixed locale, or undefined
past the file budget: the budget ends the scan at the same entry on
every OS instead of at each filesystem's own directory order, so one
folder holds the same evidence everywhere.
*/
function readRootEntries(root: string): readonly Dirent[] | undefined {
  const folder = opendirSync(root, { bufferSize: 1 })
  try {
    const entries: Dirent[] = []
    for (let entry = folder.readSync(); entry !== null; entry = folder.readSync()) {
      entries.push(entry)
      if (entries.length >= MAKER_DETECT_MAX_FILES) return undefined
    }
    return entries.toSorted((left, right) => left.name.localeCompare(right.name, 'en'))
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
    // Positive evidence never counts the latch's own output: current()
    // publishes isHardwareWorkspace from the latch, and hosts observe that
    // back in, which must not manufacture proof of hardware.
    const { isHardwareWorkspace: _workspace, ...positive } = evidence
    this.hasPositiveEvidence ||= hasPositiveHardwareEvidence(positive)
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
      // A mount root that cannot be listed is skipped, never a failed
      // inventory: it proves no board, and the ports still read.
      if (error instanceof Error && 'code' in error && typeof error.code === 'string') continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const address = path.join(root, entry.name)
      if (/^(?:CIRCUITPY|RPI-RP2)$/i.test(entry.name)) boards.push(address)
      else if (platform !== 'darwin') {
        let mounted
        try {
          mounted = readdirSync(address, { withFileTypes: true })
        } catch (error: unknown) {
          // Another person's /media/<name> cannot be listed (EACCES): that
          // folder is skipped like the root above, never proof of a board.
          if (error instanceof Error && 'code' in error && typeof error.code === 'string') continue
          throw error
        }
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
      // Windows discovery is not qualified yet. The unknown inventory
      // latches commands fail-safe through `isInventoryKnown` alone
      // (hasHardwareEvidence, SessionHardwareGuard.authorize); it reports
      // no board, so it is never positive evidence against a whole turn.
      return { hasConnectedBoard: false, isInventoryKnown: false }
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
    // A failed read is an unknown inventory, as on Windows above: fail-safe
    // for commands through `isInventoryKnown`, never a board that was seen.
    if (isInventoryFailure(error)) return { hasConnectedBoard: false, isInventoryKnown: false }
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
