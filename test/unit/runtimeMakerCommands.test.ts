import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeMakerService } from '../../src/runtime/maker/service'
import { parseMakerCommand } from '../../src/runtime/maker/commandArgs'
import { runMakerCommand } from '../../src/runtime/maker/commands'
import { UI_TEXT } from '../../src/shared/constants'
import { makerHostMessageSchema } from '../../src/shared/makerProtocol'
import { randomUUID } from 'node:crypto'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function commands(isTrusted = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'maker-commands-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const service = await createRuntimeMakerService({
    dataDirectory: path.join(root, 'data'),
    workspace,
    trusted: () => isTrusted,
    flagged: () => true,
    interactive: () => true,
    secrets: {
      get: () => Promise.resolve(undefined),
      store: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
    native: { platform: 'win32', env: {}, packageRoot: path.resolve('.') },
  })
  const output: string[] = []
  const readSecret = vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined)
  return {
    service,
    output,
    readSecret,
    async run(args: readonly string[]) {
      const command = parseMakerCommand(args)
      if (command === undefined) throw new Error('missing-command')
      const done = new AbortController()
      done.abort()
      try {
        return await runMakerCommand(command, {
          service,
          readSecret,
          print: (line) => {
            output.push(line)
          },
          distDirectory: path.resolve('dist'),
          done: done.signal,
        })
      } finally {
        await service.close()
      }
    },
  }
}
const registration = {
  machine: {
    id: 'printer',
    name: 'Bench printer',
    kind: 'moonraker',
    category: 'printer',
    endpoint: 'https://192.168.1.10',
    limits: {},
  },
  allowPlainHttp: false,
}
describe('runtime maker command execution without a credential store or device', () => {
  it('runs hardware enable, status and disable against host-owned storage', async () => {
    const fixture = await commands()
    expect(
      await fixture.run([
        'hardware',
        'enable',
        '--reason',
        'supervised bench',
        '--trust-workspace',
      ]),
    ).toBe(0)
    expect(await fixture.run(['hardware', 'status'])).toBe(0)
    expect(fixture.output).toEqual([UI_TEXT.makerHardwareEnabled, UI_TEXT.makerHardwareEnabled])
    expect(await fixture.run(['hardware', 'disable'])).toBe(0)
    expect(fixture.output.at(-1)).toBe(UI_TEXT.makerHardwareDisabled)
  })
  it('runs secretless add, list and remove without a network request', async () => {
    const fixture = await commands()
    expect(
      await fixture.run([
        'machines',
        'add',
        '--registration',
        JSON.stringify(registration),
        '--trust-workspace',
      ]),
    ).toBe(0)
    expect(await fixture.run(['machines', 'list'])).toBe(0)
    expect(await fixture.service.registry.list()).toHaveLength(1)
    expect(fixture.readSecret).not.toHaveBeenCalled()
    expect(await fixture.run(['machines', 'remove', 'printer', '--trust-workspace'])).toBe(0)
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('refuses an empty key-stdin instead of registering without that key', async () => {
    const fixture = await commands()
    await expect(
      fixture.run([
        'machines',
        'add',
        '--registration',
        JSON.stringify(registration),
        '--key-stdin',
        '--trust-workspace',
      ]),
    ).rejects.toThrow()
    expect(fixture.readSecret).toHaveBeenCalledTimes(1)
    expect(await fixture.service.registry.list()).toEqual([])
  })
  it('keeps Stop available with no trust or hardware grant', async () => {
    const fixture = await commands(false)
    expect(await fixture.run(['stop-machine', '--all'])).toBe(0)
    expect(fixture.output).toEqual([UI_TEXT.makerSoftwareStopWarning])
    expect(fixture.service.tools().map((tool) => tool.name)).toEqual(['machine_stop'])
    await expect(fixture.run(['hardware', 'enable', '--reason', 'bench'])).rejects.toThrow()
  })
  it('starts and closes the loopback panel and v2 provider without a serial open', async () => {
    const fixture = await commands(false)
    expect(await fixture.run(['panel'])).toBe(0)
    expect(fixture.output).toHaveLength(3)
    expect(fixture.output[0]).toMatch(/^MUSE_SPARK_COMPANION_URL http:\/\/127\.0\.0\.1:\d+\/$/)
    expect(fixture.output[1]).toMatch(/^MUSE_SPARK_COMPANION_LAUNCH [\da-f]+$/)
    expect(fixture.output[2]).toMatch(/^MUSE_SPARK_PROVIDER 127\.0\.0\.1 \d+ [\da-f]+$/)
  })
  it('returns correlated makerResult messages for the shared serial surface', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'supervised bench')
    const execute = vi.spyOn(fixture.service.serial, 'execute')
    const message = {
      v: 1 as const,
      type: 'makerSerial' as const,
      id: randomUUID(),
      operation: 'read' as const,
      target: { kind: 'serial' as const, port: 'COM99' },
      baud: 115_200,
      durationMs: 100,
      dtr: false,
      rts: false,
      payloadHex: '',
    }
    try {
      execute.mockResolvedValueOnce({ status: 'refused', reason: 'classification' })
      const refused = makerHostMessageSchema.parse(
        await fixture.service.dispatch(message, new AbortController().signal),
      )
      expect(refused).toMatchObject({ type: 'makerResult', id: message.id, outcome: 'refused' })
      execute.mockResolvedValueOnce({
        status: 'complete',
        capture: { bytes: Buffer.alloc(0), reason: 'stopped' },
      })
      expect(
        makerHostMessageSchema.parse(
          await fixture.service.dispatch(message, new AbortController().signal),
        ),
      ).toMatchObject({ type: 'makerResult', id: message.id, outcome: 'stopped' })
    } finally {
      await fixture.service.close()
    }
  })
  it('refuses a raw serial write before discovery when no reviewed classifier is supplied', async () => {
    const fixture = await commands()
    await fixture.service.host.setHardware(true, 'supervised bench')
    try {
      expect(
        await fixture.service.serial.execute(
          {
            operation: 'write',
            identity: { port: 'COM99' },
            baud: 115_200,
            durationMs: 100,
            dtr: false,
            rts: false,
            payloadHex: '00',
          },
          new AbortController().signal,
        ),
      ).toEqual({ status: 'refused', reason: 'classification' })
    } finally {
      await fixture.service.close()
    }
  })
})
