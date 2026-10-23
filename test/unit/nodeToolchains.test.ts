// M110t TA: the read-only `toolchains` tool answers from the pack
// manager's capability file, and the one stable context line changes
// only when packs change — without packs, requests stay byte-identical.
import { describe, expect, it } from 'vitest'
import { instructionsFor } from '../../src/core/backends/modelapi/instructions'
import { toolDefinitions, type ToolDefinitionOptions } from '../../src/core/backends/modelapi/tools'
import {
  runToolchainsCall,
  toolchainsLine,
  type ToolchainsRead,
  type ToolchainsReader,
} from '../../src/core/tools/toolchains'
import { MODEL_API_TOOLS } from '../../src/shared/constants'
import { toolchainsSchema, type ToolchainsFile } from '../../src/shared/toolchains'

const FILE: ToolchainsFile = toolchainsSchema.parse({
  version: 1,
  packs: [
    {
      name: 'shell',
      version: '1.0.0',
      languages: ['shell'],
      tools: [
        { name: 'bash', version: '5.2' },
        { name: 'shellcheck', version: '0.10.0' },
      ],
      checks: [{ name: 'shellcheck', command: ['shellcheck', '.'] }],
    },
    {
      name: 'python',
      version: '1.0.0',
      languages: ['python'],
      tools: [{ name: 'ruff', version: '0.17.2' }],
      checks: [{ name: 'ruff', command: ['ruff', 'check', '.'] }],
    },
  ],
  updatedAt: '2026-10-22T00:00:00.000Z',
})

const reader =
  (value: unknown): ToolchainsReader =>
  () =>
    Promise.resolve<ToolchainsRead>({ status: 'ok', value })
const missingReader: ToolchainsReader = () => Promise.resolve({ status: 'missing' })
const corruptReader: ToolchainsReader = () => Promise.resolve({ status: 'corrupt' })
const live = (): AbortSignal => new AbortController().signal

function toolNames(options: ToolDefinitionOptions): readonly string[] {
  return toolDefinitions('linux', options).map((tool) => tool.name)
}

describe('toolchains tool', () => {
  it('reads the capability file, validated before its JSON leaves', async () => {
    const outcome = await runToolchainsCall({}, reader(FILE), live())
    expect(outcome.ok).toBe(true)
    expect(outcome.ok ? toolchainsSchema.parse(JSON.parse(outcome.json)) : undefined).toEqual(FILE)
  })
  it('refuses without a reader, with arguments, and without a file', async () => {
    expect(await runToolchainsCall({}, undefined, live())).toEqual({
      ok: false,
      reason: 'unknown tool toolchains',
    })
    expect(await runToolchainsCall({ pack: 'shell' }, reader(FILE), live())).toEqual({
      ok: false,
      reason: 'invalid arguments: pack',
    })
    expect(await runToolchainsCall({}, missingReader, live())).toEqual({
      ok: false,
      reason: 'no toolchains are installed',
    })
  })
  it('a corrupt file or an invalid value refuses as invalid, never half-read', async () => {
    expect(await runToolchainsCall({}, corruptReader, live())).toEqual({
      ok: false,
      reason: 'the toolchains file is invalid; reinstall the packs to repair it',
    })
    const outcome = await runToolchainsCall({}, reader({ version: 99 }), live())
    expect(outcome.ok).toBe(false)
    expect(outcome.ok ? '' : outcome.reason).toContain('the toolchains file is invalid')
  })
  it('a cancelled turn throws instead of answering', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runToolchainsCall({}, reader(FILE), controller.signal)).rejects.toThrow(
      'the toolchains read was cancelled',
    )
  })
  it('the tool list carries toolchains only behind its flag', () => {
    expect(toolNames({ hasShell: true, hasSkills: false })).not.toContain(
      MODEL_API_TOOLS.toolchains,
    )
    expect(toolNames({ hasShell: true, hasSkills: false, hasToolchains: true })).toContain(
      MODEL_API_TOOLS.toolchains,
    )
  })
})

describe('toolchains context line', () => {
  it('names every installed tool with its version, in file order', () => {
    expect(toolchainsLine(FILE)).toBe(
      'Toolchains: bash 5.2, shellcheck 0.10.0, ruff 0.17.2. The toolchains tool has the full file.',
    )
  })
  it('is absent without packs, so requests stay byte-identical', () => {
    expect(toolchainsLine(undefined)).toBeUndefined()
    expect(toolchainsLine({ ...FILE, packs: [] })).toBeUndefined()
    const facts = {
      workspaceRoot: '/ws',
      platform: 'linux' as const,
      shellToolName: 'bash',
      shellName: 'bash',
      today: '2026-10-22',
      environment: { git: undefined },
      hasMemory: false,
      hasCodeIntel: false,
      hasShell: true,
      context: { rules: undefined, skills: [], agents: [], memory: [] },
    }
    const baseline = instructionsFor(facts)
    const withPacks = instructionsFor({ ...facts, toolchains: FILE })
    expect(withPacks).toContain(
      'Toolchains: bash 5.2, shellcheck 0.10.0, ruff 0.17.2. The toolchains tool has the full file.',
    )
    expect(withPacks.length).toBeGreaterThan(baseline.length)
  })
})
