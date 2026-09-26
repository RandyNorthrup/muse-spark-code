import { describe, expect, it } from 'vitest'
import {
  isMemoryTool,
  memoryToolDefinitions,
  placeMemoryCall,
  runMemoryCall,
} from '../../src/core/backends/modelapi/memoryTools'
import { projectMemoryFolder } from '../../src/core/memory/memoryLocation'
import { HOME_DATA, memoryStoreOver } from './helpers/fakeMemoryIo'

const PROJECT = '/ws/.agents/memory'

function setup(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  return { files, ...memoryStoreOver(files) }
}

async function run(store: ReturnType<typeof setup>['store'], name: string, args: unknown) {
  const placed = await placeMemoryCall(store, name, JSON.stringify(args))
  if (!placed.ok) {
    throw new Error(placed.reason)
  }
  return await runMemoryCall(store, placed.value)
}

describe('memory tools on the Model API backend (M49)', () => {
  it('offers Muse Code’s three tools with its arguments, the note path always required', () => {
    const tools = memoryToolDefinitions()
    expect(tools.map((tool) => [tool.name, tool.parameters['required']])).toEqual([
      ['read_memory', ['path']],
      ['add_memory', ['path', 'content']],
      ['edit_memory', ['path', 'old_str', 'new_str']],
    ])
    expect(Object.keys(tools[1]?.parameters['properties'] ?? {})).toEqual([
      'path',
      'scope',
      'content',
      'type',
      'description',
    ])
    expect(tools[0]?.parameters['properties']).toMatchObject({
      scope: { enum: ['personal_project', 'project', 'personal'] },
    })
    expect(
      ['read_memory', 'add_memory', 'edit_memory', 'read_file'].map((name) => isMemoryTool(name)),
    ).toEqual([true, true, true, false])
  })

  it('answers with Muse Code’s JSON, to the model and the row alike, in the default scope', async () => {
    const t = setup()
    const added = await run(t.store, 'add_memory', { path: 'palette.md', content: 'Teal.' })
    const written =
      '{"success":true,"scope":"personal_project","path":"palette.md","operation":"add","message":"memory note written"}'
    expect(added).toEqual({ output: written, visibleOutput: written })
    const folder = projectMemoryFolder([], '/ws', 'linux')
    expect(t.files.get(`${HOME_DATA}/projects/${folder}/palette.md`)).toBe('Teal.')
    const edited = await run(t.store, 'edit_memory', {
      path: 'palette.md',
      old_str: 'Teal.',
      new_str: 'Navy.',
    })
    expect(JSON.parse(edited.output)).toMatchObject({
      operation: 'edit',
      message: 'memory note edited',
    })
    const read = await run(t.store, 'read_memory', { path: 'palette.md', offset: 1, limit: 500 })
    expect(JSON.parse(read.visibleOutput)).toMatchObject({ content: 'Navy.', truncated: false })
  })

  it('reports a failed call as the row’s failure and the model’s error', async () => {
    const t = setup({ [`${PROJECT}/deploy.md`]: 'Fridays.' })
    await expect(
      run(t.store, 'edit_memory', {
        scope: 'project',
        path: 'deploy.md',
        old_str: 'Mondays',
        new_str: 'x',
      }),
    ).resolves.toEqual({
      output: 'Error: old_str not found: "Mondays"',
      visibleOutput: 'old_str not found: "Mondays"',
      failureReason: 'old_str not found: "Mondays"',
    })
  })

  it('refuses bad arguments and paths before anything is asked or written', async () => {
    const { store } = setup()
    const refusal = async (name: string, args: string) => {
      const placed = await placeMemoryCall(store, name, args)
      return placed.ok ? 'placed' : placed.reason
    }
    await expect(refusal('read_memory', '{')).resolves.toBe('arguments are not valid JSON')
    await expect(
      refusal('add_memory', '{"path":"a.md","content":"x","scope":"team"}'),
    ).resolves.toMatch(/^invalid arguments: /)
    await expect(
      refusal('add_memory', '{"path":"a.md","content":"x","type":"mood"}'),
    ).resolves.toMatch(/^invalid arguments: /)
    await expect(refusal('read_memory', '{"path":"a.md","offset":1.5}')).resolves.toMatch(
      /^invalid arguments: /,
    )
    await expect(refusal('edit_memory', '{"path":"a.md"}')).resolves.toMatch(/^invalid arguments: /)
    await expect(refusal('add_memory', '{"path":"../a.md","content":"x"}')).resolves.toBe(
      'memory path traversal is not allowed',
    )
    await expect(refusal('write_memory', '{"path":"a.md"}')).resolves.toBe(
      'unknown tool write_memory',
    )
  })
})
