// M103 lane D. Workspace data is evidence, never a command or an endpoint.
import path from 'node:path'
import {
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_FILES,
  MAKER_PROJECT_KINDS,
} from '../../../shared/constants'
import { decodeContextText } from '../../context/contextFiles'
import { isSafeCheckPath } from '../../verify/checkCommands'
import { resolveWorkspacePath } from '../../workspacePath'
import { pathModule } from '../../workspaceRoot'
import { nodeProjectDetectIo } from './projectIo'

export type MakerProjectKind = (typeof MAKER_PROJECT_KINDS)[number]

/** The same read-only seam is usable in an extension host, ACP or headless. */
export interface ProjectDetectIo {
  /** Relative regular-file names. Traversal counts directories and skipped entries too. */
  files(root: string, maxNames: number): AsyncIterable<string>
  /** At most maxBytes, regular files only, confined to root; never follows a link out. */
  read(root: string, relative: string, maxBytes: number): Promise<Uint8Array | undefined>
  /** OS mount metadata only, for the volume root; absent/failed probes leave no label. */
  volumeLabel?(root: string, platform: NodeJS.Platform): Promise<string | undefined>
}

export interface MakerProjectMarker {
  readonly kind: MakerProjectKind
  /** Forward-slash relative name; empty means the CIRCUITPY root itself. */
  readonly path: string
}

export interface MakerProjectDetection {
  readonly kinds: readonly MakerProjectKind[]
  readonly markers: readonly MakerProjectMarker[]
  readonly skillIds: readonly string[]
  readonly isCircuitPyRoot: boolean
  readonly hasMachineConfig: boolean
}

const SKILLS: Readonly<Record<MakerProjectKind, readonly string[]>> = {
  platformio: ['maker_firmware', 'maker_simulation'],
  'esp-idf': ['maker_firmware', 'maker_simulation'],
  arduino: ['maker_firmware', 'maker_simulation'],
  micropython: ['maker_micropython'],
  circuitpython: ['maker_micropython'],
  'pico-sdk': ['maker_firmware', 'maker_simulation'],
  zephyr: ['maker_firmware', 'maker_simulation'],
  esphome: ['maker_firmware'],
  ros2: ['maker_ros2', 'maker_simulation'],
  klipper: ['maker_printers', 'maker_simulation'],
  marlin: ['maker_printers', 'maker_firmware'],
  gcode: ['maker_printers', 'maker_cnc'],
  openscad: ['maker_cad'],
  cadquery: ['maker_cad'],
  kicad: ['maker_kicad'],
  wokwi: ['maker_simulation'],
  renode: ['maker_simulation'],
  gazebo: ['maker_ros2', 'maker_simulation'],
  'raspberry-pi': ['maker_raspberry_pi'],
}

/** Includes the OS-detected Pi kind when the host combines local facts with workspace markers. */
export function makerSkillIdsForKinds(kinds: readonly MakerProjectKind[]): readonly string[] {
  return [...new Set(kinds.flatMap((kind) => SKILLS[kind]))]
}

function namedKinds(name: string): readonly MakerProjectKind[] {
  const base = path.posix.basename(name).toLowerCase()
  if (base === 'platformio.ini') return ['platformio']
  if (base === 'sketch.yaml' || base.endsWith('.ino')) return ['arduino']
  if (base === '.micropico' || base === 'micropython.mk') return ['micropython']
  if (base === 'boot_out.txt') return ['circuitpython']
  if (base === 'pico_sdk_import.cmake') return ['pico-sdk']
  if (base === 'west.yml' || base === 'west.yaml' || name === '.west/config') return ['zephyr']
  if (base === 'colcon.meta' || /\.launch\.(?:py|xml|yaml)$/.test(base)) return ['ros2']
  if (base === 'printer.cfg') return ['klipper']
  if (/^configuration(?:_adv)?\.h$/.test(base)) return ['marlin']
  if (/\.(?:gcode|gco|gc|nc)$/.test(base)) return ['gcode']
  if (base.endsWith('.scad')) return ['openscad']
  if (/\.kicad_(?:pro|sch|pcb)$/.test(base)) return ['kicad']
  return base === 'wokwi.toml' ? ['wokwi'] : []
}

function sniffedKinds(name: string, text: string): readonly MakerProjectKind[] {
  const base = path.posix.basename(name).toLowerCase()
  if (base === 'cmakelists.txt') {
    const code = text.replaceAll(/#[^\r\n]*/g, '')
    return [
      ...(/include\s*\(\s*\S*\$ENV\{IDF_PATH\}\/tools\/cmake\/project\.cmake["']?\s*\)/i.test(code)
        ? ['esp-idf' as const]
        : []),
      ...(/(?:pico_sdk_init|pico_sdk_import)\s*\(/i.test(code) ? ['pico-sdk' as const] : []),
      ...(/find_package\s*\(\s*Zephyr\b/.test(code) ? ['zephyr' as const] : []),
    ]
  }
  if (base === 'package.xml' && /<build_type>\s*ament_(?:cmake|python)\s*<\/build_type>/.test(text))
    return ['ros2']
  if (/\.ya?ml$/.test(base) && /^esphome:\s*(?:#.*)?$/m.test(text)) return ['esphome']
  if (
    base.endsWith('.cfg') &&
    /^\[(?:printer|stepper_[xyz]|extruder|gcode_macro\s+[^\]]+)\]/m.test(text)
  )
    return ['klipper']
  if (base.endsWith('.py')) {
    return [
      ...(/^\s*(?:from\s+(?:machine|micropython|rp2)\s+import\b|import\s+(?:machine|micropython|rp2)\b)/m.test(
        text,
      )
        ? ['micropython' as const]
        : []),
      ...(/^\s*(?:from\s+(?:board|digitalio|busio)\s+import\b|import\s+(?:board|digitalio|busio)\b)/m.test(
        text,
      )
        ? ['circuitpython' as const]
        : []),
      ...(/^\s*(?:from\s+(?:cadquery|build123d)\s+import\b|import\s+(?:cadquery|build123d)\b)/m.test(
        text,
      )
        ? ['cadquery' as const]
        : []),
    ]
  }
  if (base.endsWith('.robot') && /(?:Create Machine|mach create|\.resc\b)/.test(text))
    return ['renode']
  return base.endsWith('.sdf') && /<sdf\b/.test(text) && /<world\b/.test(text) ? ['gazebo'] : []
}

function requiresSniff(name: string): boolean {
  return /(?:^|\/)(?:CMakeLists\.txt|package\.xml)$|\.(?:py|ya?ml|cfg|robot|sdf)$/i.test(name)
}

/** Marker-free workspaces add no kinds or skills. Never reads sdkconfig or secret files. */
export async function detectProjectKinds(
  root: string,
  platform: NodeJS.Platform,
  io: ProjectDetectIo = nodeProjectDetectIo,
): Promise<MakerProjectDetection> {
  const markers: MakerProjectMarker[] = []
  let isCircuitPyRoot = pathModule(platform).basename(root).toUpperCase() === 'CIRCUITPY'
  // Missing optional OS metadata leaves basename and root boot-log evidence in force.
  const [labelAttempt] =
    io.volumeLabel === undefined
      ? [{ status: 'fulfilled', value: undefined } as const]
      : await Promise.allSettled([io.volumeLabel(root, platform)])
  if (labelAttempt.status === 'fulfilled' && labelAttempt.value?.toUpperCase() === 'CIRCUITPY')
    isCircuitPyRoot = true
  const pythonFiles: string[] = []
  const add = (kind: MakerProjectKind, name: string) => {
    markers.push({ kind, path: name })
  }
  const entries = io.files(root, MAKER_DETECT_MAX_FILES)[Symbol.asyncIterator]()
  try {
    for (let seen = 0; seen < MAKER_DETECT_MAX_FILES; seen += 1) {
      const next = await entries.next()
      if (next.done === true) break
      const name = next.value
      // An injected host also has to obey confinement and shell argument rules.
      if (
        !isSafeCheckPath(name, platform) ||
        name.includes('\\') ||
        pathModule(platform).isAbsolute(name) ||
        !resolveWorkspacePath(root, name, platform).ok
      )
        continue
      for (const kind of namedKinds(name)) add(kind, name)
      if (name.toLowerCase() === 'boot_out.txt') isCircuitPyRoot = true
      if (name.endsWith('.py')) pythonFiles.push(name)
      if (!requiresSniff(name) || /(?:^|\/)(?:secrets\.ya?ml|settings\.toml)$/i.test(name)) continue
      const bytes = await io.read(root, name, MAKER_DETECT_MAX_BYTES)
      if (bytes === undefined || bytes.length > MAKER_DETECT_MAX_BYTES) continue
      const decoded = decodeContextText(bytes)
      if (decoded.ok) for (const kind of sniffedKinds(name, decoded.text)) add(kind, name)
    }
  } finally {
    await entries.return?.()
  }
  if (isCircuitPyRoot) {
    add('circuitpython', '')
    for (const name of pythonFiles) add('circuitpython', name)
  }
  const found = new Set(markers.map((marker) => marker.kind))
  const kinds = MAKER_PROJECT_KINDS.filter((kind) => found.has(kind))
  return {
    kinds,
    markers,
    skillIds: makerSkillIdsForKinds(kinds),
    isCircuitPyRoot,
    hasMachineConfig: found.has('klipper') || found.has('marlin'),
  }
}
