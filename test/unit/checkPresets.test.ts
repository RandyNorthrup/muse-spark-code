import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  checkPresets,
  detectAndOfferMakerPresets,
  type MakerDetectHost,
} from '../../src/core/maker/detect/checkPresets'
import {
  presetsOfferedSchema,
  type MakerPresetsOffered,
} from '../../src/core/maker/detect/presetOffers'
import { type PiDetectIo } from '../../src/core/maker/detect/onPi'
import {
  detectProjectKinds,
  makerSkillIdsForKinds,
  type MakerProjectDetection,
  type MakerProjectKind,
  type ProjectDetectIo,
} from '../../src/core/maker/detect/projectKinds'
import {
  MAKER_PRESETS_MAX,
  MAKER_PROJECT_KINDS,
  MAKER_SIMULATION_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  CHECK_COMMAND_MAX_CHARS,
  CHECK_NAME_MAX_CHARS,
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_FILES,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText, UI_TEXT } from '../../src/shared/l10n/text'

const projects = z
  .array(z.object({ kind: z.enum(MAKER_PROJECT_KINDS), files: z.record(z.string(), z.string()) }))
  .parse(JSON.parse(await readFile('test/fixtures/maker/projects.json', 'utf8')))
const noPi: PiDetectIo = {
  readModel: () => Promise.resolve(undefined),
  isExecutable: vi.fn(),
  run: vi.fn(),
}

function ioFor(files: Record<string, string>): ProjectDetectIo {
  return {
    async *files() {
      await Promise.resolve()
      yield* Object.keys(files)
    },
    read: (_root, name, maxBytes) =>
      Promise.resolve(
        files[name] === undefined ? undefined : Buffer.from(files[name]).subarray(0, maxBytes),
      ),
  }
}
function project(kind: MakerProjectKind, file: string): MakerProjectDetection {
  return {
    kinds: [kind],
    markers: [{ kind, path: file }],
    skillIds: makerSkillIdsForKinds([kind]),
    isCircuitPyRoot: false,
    hasMachineConfig: kind === 'marlin' || kind === 'klipper',
  }
}
const options = {
  arduinoFqbn: 'arduino:avr:uno',
  zephyrBoard: 'nucleo_f401re',
  allowWokwiCloud: true,
  wokwiExpectedText: 'TEST PASSED',
  qemuCheck: { name: 'QEMU tests', command: 'ctest --test-dir build -R qemu', timeoutSeconds: 60 },
  klipperCheck: {
    name: 'Klipper tests',
    command: 'pytest tests/test_klipper.py',
    timeoutSeconds: 60,
  },
}
afterEach(() => {
  setUiText(EN, 'en')
})

describe('portable maker preset suggestions', () => {
  it.each(projects)(
    'offers bounded offline checks or analysis for $kind',
    async ({ kind, files }) => {
      const detection = await detectProjectKinds('/ws', 'linux', ioFor(files))
      const presets = checkPresets(detection, 'linux', options)
      const counts: Partial<Record<MakerProjectKind, number>> = {
        marlin: 0,
        'pico-sdk': 0,
        zephyr: 0,
        platformio: 2,
        'esp-idf': 2,
        kicad: 2,
      }
      expect(presets.length).toBe(counts[kind] ?? 1)
      const tools: Partial<Record<MakerProjectKind, string>> = {
        platformio: 'pio ',
        arduino: 'arduino-cli compile',
        micropython: 'python3 -c',
        circuitpython: 'python3 -c',
        'pico-sdk': 'cmake -S',
        zephyr: 'west build',
        esphome: 'esphome compile',
        ros2: 'colcon build',
        klipper: 'pytest',
        openscad: 'openscad -o',
        cadquery: 'python3 -c',
        kicad: 'kicad-cli',
        wokwi: 'wokwi-cli',
        renode: 'renode-test',
        gazebo: 'gz sim',
      }
      if (kind === 'gcode') expect(presets[0]?.type).toBe('gcode')
      for (const preset of presets) {
        expect(preset.kind).toBe(kind)
        if (preset.type !== 'command') {
          continue
        }

        expect(preset.check.timeoutSeconds).toBeGreaterThan(0)
        expect(preset.check.command).not.toMatch(/\b(?:flash|upload|monitor|gpioset|burn-efuse)\b/)
        expect(preset.cloud).toBe(kind === 'wokwi')
        const tool = tools[kind]
        if (tool !== undefined) expect(preset.check.command).toContain(tool)
      }
      if (kind !== 'esp-idf') return
      expect(presets[0]).toMatchObject({ check: { command: 'idf.py build' } })
      expect(presets[1]).toMatchObject({ check: options.qemuCheck })
    },
  )

  it('does not invent Arduino or Zephyr targets or simulator test commands', () => {
    expect(checkPresets(project('arduino', 'sketch.yaml'), 'linux')).toEqual([])
    expect(checkPresets(project('zephyr', '.west/config'), 'linux')).toEqual([])
    expect(checkPresets(project('klipper', 'printer.cfg'), 'linux')).toEqual([])
    expect(checkPresets(project('esp-idf', 'CMakeLists.txt'), 'linux')).toHaveLength(1)
  })

  it.each(['linux', 'darwin', 'win32'] as const)(
    'offers Pico and Zephyr builds only from application CMakeLists.txt on %s',
    async (platform) => {
      const files = {
        '.west/config': '[manifest]',
        'west.yml': 'manifest:',
        'app/CMakeLists.txt': 'find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})',
        'pico/CMakeLists.txt': 'pico_sdk_init()',
        'pico/cmake/pico_sdk_import.cmake': '# toolchain metadata',
      }
      const root = platform === 'win32' ? String.raw`C:\ws` : '/ws'
      const detected = await detectProjectKinds(root, platform, ioFor(files))
      const presets = checkPresets(detected, platform, options)
      expect(presets).toHaveLength(2)
      expect(presets.map((preset) => preset.id)).toEqual([
        'zephyr:build:app/CMakeLists.txt',
        'pico-sdk:build:pico/CMakeLists.txt',
      ])
      expect(presets).toMatchObject([
        {
          check: {
            command:
              platform === 'win32'
                ? "Set-Location -LiteralPath 'app' -ErrorAction Stop; west build -b 'nucleo_f401re' ."
                : "cd -- 'app' && west build -b 'nucleo_f401re' .",
          },
        },
        {
          check: {
            command:
              platform === 'win32'
                ? "Set-Location -LiteralPath 'pico' -ErrorAction Stop; cmake -S . -B build; if ($LASTEXITCODE -eq 0) { cmake --build build } else { exit $LASTEXITCODE }"
                : "cd -- 'pico' && cmake -S . -B build && cmake --build build",
          },
        },
      ])
      const metadata = await detectProjectKinds(
        root,
        platform,
        ioFor({
          '.west/config': '',
          'west.yml': '',
          'cmake/pico_sdk_import.cmake': '',
        }),
      )
      expect(metadata.kinds).toEqual(['pico-sdk', 'zephyr'])
      expect(metadata.skillIds).toContain('maker_firmware')
      expect(checkPresets(metadata, platform, options)).toEqual([])
    },
  )

  it('keeps a user-selected finite simulator check intact without changing the selection', () => {
    const qemuCheck = Object.freeze({
      name: 'QEMU tests',
      command: 'ctest --test-dir build -R qemu',
      changedFiles: false,
      timeoutSeconds: 60,
    })
    const selected = Object.freeze({ qemuCheck })
    const presets = checkPresets(project('esp-idf', 'CMakeLists.txt'), 'linux', selected)
    expect(presets[1]).toMatchObject({ type: 'command', check: qemuCheck })
    expect(selected.qemuCheck).toBe(qemuCheck)
  })

  it('refuses an invalid or unbounded injected check before offering it', () => {
    const presets = checkPresets(project('esp-idf', 'CMakeLists.txt'), 'linux', {
      qemuCheck: {
        name: 'Bad QEMU check',
        command: 'x'.repeat(CHECK_COMMAND_MAX_CHARS + 1),
        timeoutSeconds: 0,
      },
    })
    expect(presets).toHaveLength(1)
    expect(presets[0]?.id).not.toContain('qemu')
  })

  it('requires explicit cloud opt-in and an expected Wokwi result', () => {
    const detection = project('wokwi', 'wokwi.toml')
    expect(checkPresets(detection, 'linux')).toEqual([])
    expect(checkPresets(detection, 'linux', { wokwiExpectedText: 'PASS' })).toEqual([])
    expect(checkPresets(detection, 'linux', { allowWokwiCloud: true })).toEqual([])
    const [preset] = checkPresets(detection, 'linux', options)
    expect(preset).toMatchObject({
      type: 'command',
      cloud: true,
      check: {
        timeoutSeconds: MAKER_SIMULATION_TIMEOUT_MS / MILLISECONDS_PER_SECOND,
        command: "wokwi-cli --timeout 60000 --expect-text 'TEST PASSED'",
      },
    })
  })

  it('bounds the catalogue, removes duplicate markers, and refuses unsafe paths on either platform', () => {
    const detection = project('openscad', 'part.scad')
    const lots = {
      ...detection,
      markers: Array.from({ length: MAKER_PRESETS_MAX + 1 }, (_, i) => ({
        kind: 'openscad' as const,
        path: `${String(i)}.scad`,
      })),
    }
    expect(checkPresets(lots, 'linux')).toHaveLength(MAKER_PRESETS_MAX)
    expect(
      checkPresets(
        { ...detection, markers: [...detection.markers, ...detection.markers] },
        'linux',
      ),
    ).toHaveLength(1)
    for (const file of ['../part.scad', '/tmp/part.scad', '-part.scad', 'part\n.scad'])
      expect(checkPresets(project('openscad', file), 'linux')).toEqual([])
    for (const file of ['part&.scad', 'part%.scad', 'part".scad'])
      expect(checkPresets(project('openscad', file), 'win32')).toEqual([])
  })

  it('uses PowerShell-compatible working directories, board quoting and CMake chaining', () => {
    const [arduino] = checkPresets(project('arduino', "O'Brien/blink.ino"), 'win32', options)
    expect(arduino).toMatchObject({
      check: {
        command:
          "Set-Location -LiteralPath 'O''Brien' -ErrorAction Stop; arduino-cli compile --fqbn 'arduino:avr:uno' .",
      },
    })
    const [pico] = checkPresets(project('pico-sdk', 'CMakeLists.txt'), 'win32')
    expect(pico).toMatchObject({
      check: {
        command:
          'cmake -S . -B build; if ($LASTEXITCODE -eq 0) { cmake --build build } else { exit $LASTEXITCODE }',
      },
    })
  })

  it('quotes shell metacharacters and checks Python syntax without executing code or writing bytecode', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'm103-d-syntax-'))
    try {
      const filename = "a$(touch injected);b'file.py"
      await writeFile(
        path.join(root, filename),
        'import cadquery\nraise RuntimeError("must not execute")\n',
      )
      const [preset] = checkPresets(project('cadquery', filename), process.platform)
      expect(preset?.type).toBe('command')
      if (preset?.type !== 'command') throw new Error('Missing syntax check')
      const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh'
      const args =
        process.platform === 'win32'
          ? ['-NoProfile', '-NonInteractive', '-Command', preset.check.command]
          : ['-c', preset.check.command]
      await promisify(execFile)(shell, args, {
        cwd: root,
        env: { PATH: process.env['PATH'], SystemRoot: process.env['SystemRoot'] },
      })
      await expect(readFile(path.join(root, 'injected'))).rejects.toThrow()
      await expect(readFile(path.join(root, '__pycache__'))).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads labels only when invoked, after the installed language changes', () => {
    setUiText({ ...EN, makerDetectBuild: 'Compilar {target}' }, 'es')
    expect(checkPresets(project('platformio', 'platformio.ini'), 'linux')[0]).toMatchObject({
      check: { name: 'Compilar PlatformIO' },
    })
  })
})

describe('presetsOffered host seam', () => {
  it.each([
    { platform: 'win32' as const, root: 'E:\\', label: 'CIRCUITPY' },
    { platform: 'darwin' as const, root: '/Volumes/CIRCUITPY', label: 'CIRCUITPY' },
    { platform: 'linux' as const, root: '/media/board', label: 'CIRCUITPY' },
  ])(
    'keeps the physical-root notice and generic Python syntax offer at a $platform volume root',
    async ({ platform, root, label }) => {
      const host: MakerDetectHost = { isTrusted: () => true, notify: vi.fn() }
      const io = {
        ...ioFor({ 'code.py': 'print("hello")', 'boot_out.txt': 'CircuitPython' }),
        volumeLabel: vi.fn(() => Promise.resolve(label)),
      }
      const event = await detectAndOfferMakerPresets({ root, platform, host, io, piIo: noPi })
      expect(io.volumeLabel).toHaveBeenCalledWith(root, platform)
      expect(event?.isCircuitPyRoot).toBe(true)
      expect(event?.kinds).toEqual(['circuitpython'])
      expect(event?.notices).toContain(UI_TEXT.makerDetectCircuitPy)
      expect(event?.presets).toMatchObject([
        { id: 'circuitpython:syntax:code.py', type: 'command' },
      ])
      expect(host.notify).toHaveBeenCalledWith(event)
      const labelOnly = await detectAndOfferMakerPresets({
        root,
        platform,
        host,
        piIo: noPi,
        io: { ...ioFor({ 'code.py': 'print("hello")' }), volumeLabel: io.volumeLabel },
      })
      expect(labelOnly?.isCircuitPyRoot).toBe(true)
      expect(labelOnly?.notices).toContain(UI_TEXT.makerDetectCircuitPy)
      expect(labelOnly?.presets).toMatchObject([{ id: 'circuitpython:syntax:code.py' }])
    },
  )

  it('uses root boot_out.txt even with an unavailable label and never promotes a nested boot log', async () => {
    const host: MakerDetectHost = { isTrusted: () => true, notify: vi.fn() }
    const input = { root: 'E:\\', platform: 'win32' as const, host, piIo: noPi }
    const event = await detectAndOfferMakerPresets({
      ...input,
      io: ioFor({ 'code.py': 'print("hello")', 'boot_out.txt': '' }),
    })
    expect(event?.isCircuitPyRoot).toBe(true)
    expect(event?.presets).toHaveLength(1)
    const nested = await detectAndOfferMakerPresets({
      ...input,
      io: ioFor({ 'code.py': 'print("hello")', 'docs/boot_out.txt': '' }),
    })
    expect(nested?.isCircuitPyRoot).toBe(false)
    expect(nested?.notices).toEqual([])
    expect(nested?.presets).toEqual([])
    const labelled = await detectAndOfferMakerPresets({
      ...input,
      io: {
        ...ioFor({ 'code.py': 'print("hello")' }),
        volumeLabel: () => Promise.resolve('CIRCUITPY'),
      },
    })
    expect(labelled?.isCircuitPyRoot).toBe(true)
    expect(labelled?.presets).toHaveLength(1)
    const failedLabel = await detectAndOfferMakerPresets({
      ...input,
      io: {
        ...ioFor({ 'code.py': 'print("hello")', 'boot_out.txt': '' }),
        volumeLabel: () => Promise.reject(new Error('unavailable mount metadata')),
      },
    })
    expect(failedLabel?.isCircuitPyRoot).toBe(true)
    expect(failedLabel?.presets).toHaveLength(1)
  })

  it.each(['panel', 'ACP', 'headless'])(
    'notifies the %s host with the same validated event, without running checks',
    async () => {
      const host: MakerDetectHost = { isTrusted: () => true, notify: vi.fn() }
      const input = {
        root: '/ws',
        platform: 'linux' as const,
        host,
        io: ioFor({ 'platformio.ini': '[env:esp32]' }),
        piIo: noPi,
      }
      const event = await detectAndOfferMakerPresets(input)
      expect(host.notify).toHaveBeenCalledOnce()
      expect(host.notify).toHaveBeenCalledWith(event)
      expect(event).toMatchObject({
        type: 'presetsOffered',
        kinds: ['platformio'],
        skillIds: ['maker_firmware', 'maker_simulation'],
        notices: [],
        isCircuitPyRoot: false,
        hasMachineConfig: false,
      })
      expect(presetsOfferedSchema.parse(event)).toEqual(event)
      expect(noPi.run).not.toHaveBeenCalled()
    },
  )

  it('emits nothing and reads nothing without trust, and emits nothing after trust is revoked', async () => {
    let isTrusted = false
    const host: MakerDetectHost = { isTrusted: () => isTrusted, notify: vi.fn() }
    const io = { files: vi.fn(ioFor({ 'part.scad': 'cube(1);' }).files), read: vi.fn() }
    const input = { root: '/ws', platform: 'linux' as const, host, io, piIo: noPi }
    expect(await detectAndOfferMakerPresets(input)).toBeUndefined()
    expect(io.files).not.toHaveBeenCalled()
    isTrusted = true
    const piIo = {
      ...noPi,
      readModel: () => {
        isTrusted = false
        return Promise.resolve(undefined)
      },
    }
    expect(await detectAndOfferMakerPresets({ ...input, piIo })).toBeUndefined()
    expect(host.notify).not.toHaveBeenCalled()
  })

  it('keeps marker-free workspaces quiet and offers board selection and physical-edit notices', async () => {
    const host: MakerDetectHost = { isTrusted: () => true, notify: vi.fn() }
    const input = { root: '/ws', platform: 'linux' as const, host, piIo: noPi }
    expect(
      await detectAndOfferMakerPresets({ ...input, io: ioFor({ 'README.md': 'Web app' }) }),
    ).toBeUndefined()
    expect(host.notify).not.toHaveBeenCalled()
    const arduino = await detectAndOfferMakerPresets({ ...input, io: ioFor({ 'sketch.yaml': '' }) })
    expect(arduino?.notices).toContain(UI_TEXT.makerDetectBoardRequired)
    const circuit = await detectAndOfferMakerPresets({
      ...input,
      root: '/CIRCUITPY',
      io: ioFor({ 'code.py': 'print("hello")' }),
    })
    expect(circuit?.isCircuitPyRoot).toBe(true)
    expect(circuit?.presets).toHaveLength(1)
    expect(circuit?.notices).toContain(UI_TEXT.makerDetectCircuitPy)
    const marlin = await detectAndOfferMakerPresets({
      ...input,
      io: ioFor({ 'Configuration_adv.h': '#define THERMAL_PROTECTION' }),
    })
    expect(marlin?.hasMachineConfig).toBe(true)
    expect(marlin?.notices).toContain(UI_TEXT.makerDetectMachineConfig)
  })

  it('includes explicit Wokwi privacy and OS-only Pi facts without probing other hardware', async () => {
    const host: MakerDetectHost = { isTrusted: () => true, notify: vi.fn() }
    const event = await detectAndOfferMakerPresets({
      root: '/ws',
      platform: 'linux',
      host,
      io: ioFor({ 'wokwi.toml': '' }),
      options,
      piIo: {
        ...noPi,
        readModel: () => Promise.resolve(Buffer.from('Raspberry Pi 5\0')),
        isExecutable: () => Promise.resolve(false),
      },
    })
    expect(event?.kinds).toEqual(['wokwi', 'raspberry-pi'])
    expect(event?.skillIds).toEqual(['maker_simulation', 'maker_raspberry_pi'])
    expect(event?.pi).toEqual({ model: 'Raspberry Pi 5' })
    expect(event?.notices).toContain(UI_TEXT.makerDetectCloud)
  })

  it('rejects unknown fields, kinds, unbounded catalogues and escaped analyser paths', async () => {
    const input = {
      root: '/ws',
      platform: 'linux' as const,
      host: { isTrusted: () => true, notify: vi.fn() },
      io: ioFor({ 'part.gcode': 'G21' }),
      piIo: noPi,
    }
    const event = await detectAndOfferMakerPresets(input)
    if (event === undefined) throw new Error('Missing event')
    const bad: unknown[] = [
      { ...event, confirm: true },
      { ...event, kinds: ['unknown'] },
      { ...event, kinds: Array.from({ length: MAKER_PROJECT_KINDS.length + 1 }, () => 'gcode') },
      { ...event, skillIds: Array.from({ length: MAKER_DETECT_MAX_FILES + 1 }, () => 'maker_cnc') },
      { ...event, skillIds: ['other_cnc'] },
      { ...event, skillIds: [`maker_${'a'.repeat(CHECK_NAME_MAX_CHARS)}`] },
      { ...event, notices: Array.from({ length: MAKER_PROJECT_KINDS.length + 1 }, () => 'Notice') },
      { ...event, notices: ['x'.repeat(CHECK_COMMAND_MAX_CHARS + 1)] },
      { ...event, title: 'x'.repeat(CHECK_COMMAND_MAX_CHARS + 1) },
      { ...event, pi: { model: 'x'.repeat(MAKER_DETECT_MAX_BYTES + 1) } },
      { ...event, pi: { model: 'Raspberry Pi', temperatureCelsius: Infinity } },
      { ...event, pi: { model: 'Raspberry Pi', throttled: -1 } },
      { ...event, presets: Array.from({ length: MAKER_PRESETS_MAX + 1 }, () => event.presets[0]) },
      { ...event, presets: [{ ...event.presets[0], id: 'x'.repeat(CHECK_COMMAND_MAX_CHARS + 1) }] },
      { ...event, presets: [{ ...event.presets[0], name: 'x'.repeat(CHECK_NAME_MAX_CHARS + 1) }] },
      {
        ...event,
        presets: [{ ...event.presets[0], path: 'x'.repeat(CHECK_COMMAND_MAX_CHARS + 1) }],
      },
      { ...event, presets: [{ ...event.presets[0], path: '../device' }] },
      { ...event, presets: [{ ...event.presets[0], path: '/tmp/device' }] },
      { ...event, presets: [{ ...event.presets[0], path: 'C:/device' }] },
      {
        ...event,
        presets: [
          {
            type: 'command',
            id: 'bad',
            kind: 'platformio',
            cloud: false,
            check: { name: 'Bad check', command: 'pio run', confirm: true },
          },
        ],
      },
    ]
    for (const value of bad) expect(presetsOfferedSchema.safeParse(value).success).toBe(false)
    const copy: MakerPresetsOffered = presetsOfferedSchema.parse(event)
    expect(copy.presets[0]).toMatchObject({
      type: 'gcode',
      name: 'Check G-code',
      path: 'part.gcode',
    })
  })
})
