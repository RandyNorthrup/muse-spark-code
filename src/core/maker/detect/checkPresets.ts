// M103 D: suggestions only. Hosts choose and persist checks through their normal settings UI.
import path from 'node:path'
import {
  MAKER_DETECT_MAX_FILES,
  MAKER_GAZEBO_ITERATIONS,
  MAKER_PRESET_TIMEOUT_SECONDS,
  MAKER_PRESETS_MAX,
  MAKER_SIMULATION_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  type CheckCommandSetting,
} from '../../../shared/constants'
import { fill, UI_TEXT } from '../../../shared/l10n/text'
import { terminalArgument } from '../../shellQuote'
import { isSafeCheckPath } from '../../verify/checkCommands'
import { detectOnPi, type PiDetectIo } from './onPi'
import {
  presetSchema,
  presetsOfferedSchema,
  relativePathSchema,
  type MakerCheckPreset,
  type MakerPresetsOffered,
} from './presetOffers'
import {
  detectProjectKinds,
  makerSkillIdsForKinds,
  type MakerProjectDetection,
  type MakerProjectKind,
  type ProjectDetectIo,
} from './projectKinds'

import type { MakerHost } from '../ports'

/** Detection uses only trust and the shared notice port. */
export type MakerDetectHost = Pick<MakerHost, 'isTrusted' | 'notify'>

export interface MakerPresetOptions {
  /** User/IDE-selected targets. A workspace marker never chooses a board to program. */
  readonly arduinoFqbn?: string
  readonly zephyrBoard?: string
  /** A finite local harness chosen by the user; no guessed success output or installation paths. */
  readonly qemuCheck?: CheckCommandSetting
  readonly klipperCheck?: CheckCommandSetting
  /** Both are explicit user choices. No token is read or handled by the detector. */
  readonly allowWokwiCloud?: boolean
  readonly wokwiExpectedText?: string
}

/** Names used as arguments or working directories, never shell fragments. */
function isUsablePath(name: string, platform: NodeJS.Platform): boolean {
  return relativePathSchema.safeParse(name).success && isSafeCheckPath(name, platform)
}

/** Builds a bounded catalogue; commands stay behind the normal check-command permission path. */
export function checkPresets(
  project: MakerProjectDetection,
  platform: NodeJS.Platform,
  options: MakerPresetOptions = {},
): readonly MakerCheckPreset[] {
  const presets = new Map<string, MakerCheckPreset>()
  const quote = (name: string) => terminalArgument(name, platform)
  const python = platform === 'win32' ? 'python' : 'python3'
  const command = (
    kind: MakerProjectKind,
    file: string,
    action: string,
    name: string,
    line: string,
    timeoutSeconds = MAKER_PRESET_TIMEOUT_SECONDS,
    isCloud = false,
    shouldScopeFiles?: boolean,
  ) => {
    const id = `${kind}:${action}:${file}`
    const candidate: MakerCheckPreset = {
      type: 'command',
      id,
      kind,
      cloud: isCloud,
      check: {
        name,
        command: line,
        timeoutSeconds,
        ...(shouldScopeFiles !== undefined && { changedFiles: shouldScopeFiles }),
      },
    }
    if (presetSchema.safeParse(candidate).success) presets.set(id, candidate)
  }
  const inDirectory = (file: string, line: string) => {
    const directory = path.posix.dirname(file)
    if (directory === '.') return line
    return platform === 'win32'
      ? `Set-Location -LiteralPath ${quote(directory)} -ErrorAction Stop; ${line}`
      : `cd -- ${quote(directory)} && ${line}`
  }
  const offer = ({ kind, path: file }: MakerProjectDetection['markers'][number]) => {
    if (!isUsablePath(file, platform)) return
    const build = (target: string, line: string) => {
      command(
        kind,
        file,
        'build',
        fill(UI_TEXT.makerDetectBuild, { target }),
        inDirectory(file, line),
      )
    }
    switch (kind) {
      case 'platformio': {
        build('PlatformIO', 'pio run')
        command(
          kind,
          file,
          'check',
          fill(UI_TEXT.makerDetectCheck, { target: 'PlatformIO' }),
          inDirectory(file, 'pio check --json-output --fail-on-defect'),
        )
        return
      }
      case 'esp-idf': {
        build('ESP-IDF', 'idf.py build')
        if (options.qemuCheck !== undefined)
          command(
            kind,
            file,
            'qemu',
            options.qemuCheck.name,
            options.qemuCheck.command,
            options.qemuCheck.timeoutSeconds,
            false,
            options.qemuCheck.changedFiles,
          )
        return
      }
      case 'arduino': {
        if (options.arduinoFqbn !== undefined && isSafeCheckPath(options.arduinoFqbn, platform))
          build('Arduino', `arduino-cli compile --fqbn ${quote(options.arduinoFqbn)} .`)
        return
      }
      case 'pico-sdk': {
        if (path.posix.basename(file).toLowerCase() !== 'cmakelists.txt') return
        build(
          'Pico SDK',
          platform === 'win32'
            ? 'cmake -S . -B build; if ($LASTEXITCODE -eq 0) { cmake --build build } else { exit $LASTEXITCODE }'
            : 'cmake -S . -B build && cmake --build build',
        )
        return
      }
      case 'zephyr': {
        if (path.posix.basename(file).toLowerCase() !== 'cmakelists.txt') return
        if (options.zephyrBoard !== undefined && isSafeCheckPath(options.zephyrBoard, platform))
          build('Zephyr', `west build -b ${quote(options.zephyrBoard)} .`)
        return
      }
      case 'esphome': {
        command(
          kind,
          file,
          'build',
          fill(UI_TEXT.makerDetectBuild, { target: 'ESPHome' }),
          `esphome compile ${quote(file)}`,
        )
        return
      }
      case 'ros2': {
        command(
          kind,
          file,
          'build',
          fill(UI_TEXT.makerDetectBuild, { target: 'ROS 2' }),
          'colcon build',
        )
        return
      }
      case 'micropython':
      case 'circuitpython':
      case 'cadquery': {
        if (file.endsWith('.py'))
          command(
            kind,
            file,
            'syntax',
            UI_TEXT.makerDetectPython,
            `${python} -c ${quote('import ast,pathlib,sys; ast.parse(pathlib.Path(sys.argv[1]).read_bytes())')} ${quote(file)}`,
          )
        return
      }
      case 'klipper': {
        if (options.klipperCheck !== undefined)
          command(
            kind,
            file,
            'simulation',
            options.klipperCheck.name,
            options.klipperCheck.command,
            options.klipperCheck.timeoutSeconds,
            false,
            options.klipperCheck.changedFiles,
          )
        return
      }
      case 'gcode': {
        presets.set(`gcode:${file}`, {
          type: 'gcode',
          id: `gcode:${file}`,
          kind,
          path: file,
          name: fill(UI_TEXT.makerDetectCheck, { target: 'G-code' }),
        })
        return
      }
      case 'openscad': {
        command(
          kind,
          file,
          'render',
          fill(UI_TEXT.makerDetectBuild, { target: 'OpenSCAD' }),
          `openscad -o ${quote(`${file}.stl`)} ${quote(file)}`,
        )
        return
      }
      case 'kicad': {
        const isSchematic = file.endsWith('.kicad_sch')
        if (isSchematic || file.endsWith('.kicad_pcb'))
          command(
            kind,
            file,
            isSchematic ? 'erc' : 'drc',
            fill(UI_TEXT.makerDetectCheck, { target: isSchematic ? 'KiCad ERC' : 'KiCad DRC' }),
            `kicad-cli ${isSchematic ? 'sch erc' : 'pcb drc --schematic-parity'} --format json --exit-code-violations -o ${quote(`${file}.report.json`)} ${quote(file)}`,
          )
        return
      }
      case 'wokwi': {
        if (
          options.allowWokwiCloud === true &&
          options.wokwiExpectedText !== undefined &&
          isSafeCheckPath(options.wokwiExpectedText, platform)
        )
          command(
            kind,
            file,
            'simulation',
            fill(UI_TEXT.makerDetectSimulate, { target: 'Wokwi' }),
            inDirectory(
              file,
              `wokwi-cli --timeout ${String(MAKER_SIMULATION_TIMEOUT_MS)} --expect-text ${quote(options.wokwiExpectedText)}`,
            ),
            MAKER_SIMULATION_TIMEOUT_MS / MILLISECONDS_PER_SECOND,
            true,
          )
        return
      }
      case 'renode': {
        command(
          kind,
          file,
          'simulation',
          fill(UI_TEXT.makerDetectSimulate, { target: 'Renode' }),
          `renode-test ${quote(file)}`,
        )
        return
      }
      case 'gazebo': {
        command(
          kind,
          file,
          'simulation',
          fill(UI_TEXT.makerDetectSimulate, { target: 'Gazebo' }),
          `gz sim -s -r --iterations ${String(MAKER_GAZEBO_ITERATIONS)} ${quote(file)}`,
        )
        return
      }
      case 'marlin':
      case 'raspberry-pi': {
        return
      }
    }
  }
  for (const marker of project.markers.slice(0, MAKER_DETECT_MAX_FILES)) offer(marker)
  const offered: MakerCheckPreset[] = []
  for (const [, preset] of presets) offered.push(preset)
  return offered.slice(0, MAKER_PRESETS_MAX)
}

/** The single shared entrypoint for panel, ACP and headless hosts, loaded lazily by lane W. */
export async function detectAndOfferMakerPresets(input: {
  readonly root: string
  readonly platform: NodeJS.Platform
  readonly host: MakerDetectHost
  readonly io?: ProjectDetectIo
  readonly piIo?: PiDetectIo
  readonly options?: MakerPresetOptions
}): Promise<MakerPresetsOffered | undefined> {
  if (!input.host.isTrusted()) return
  const detected = await detectProjectKinds(input.root, input.platform, input.io)
  const pi = await detectOnPi(input.platform, input.piIo)
  if (!input.host.isTrusted()) return
  const kinds = [...detected.kinds, ...(pi === undefined ? [] : ['raspberry-pi' as const])]
  if (kinds.length === 0) return
  const project = { ...detected, kinds, skillIds: makerSkillIdsForKinds(kinds) }
  const presets = checkPresets(project, input.platform, input.options)
  const event = presetsOfferedSchema.parse({
    type: 'presetsOffered',
    title: UI_TEXT.makerDetectPresetsTitle,
    kinds,
    skillIds: project.skillIds,
    presets,
    isCircuitPyRoot: project.isCircuitPyRoot,
    hasMachineConfig: project.hasMachineConfig,
    notices: [
      ...(project.isCircuitPyRoot ? [UI_TEXT.makerDetectCircuitPy] : []),
      ...(project.hasMachineConfig ? [UI_TEXT.makerDetectMachineConfig] : []),
      ...(presets.some((preset) => preset.type === 'command' && preset.cloud)
        ? [UI_TEXT.makerDetectCloud]
        : []),
      ...((kinds.includes('arduino') && input.options?.arduinoFqbn === undefined) ||
      (kinds.includes('zephyr') && input.options?.zephyrBoard === undefined)
        ? [UI_TEXT.makerDetectBoardRequired]
        : []),
    ],
    ...(pi !== undefined && { pi }),
  })
  await input.host.notify(event)
  return event
}
