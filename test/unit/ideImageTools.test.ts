// The image tools the `ide` session server offers Muse Code (M44, PLAN.md
// D37): offered only while image generation is on and a key is stored,
// every call confirmed with its price, checked before anything is asked,
// and billed to the key through the Model API's image endpoints.
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import type { ImagePlan } from '../../src/core/backends/modelapi/imageGeneration'
import { ideImageTools } from '../../src/host/ide/imageTools'
import { fakeModelApi, fakeModelApiClient, TINY_PNG_BASE64 } from './helpers/fakeModelApi'
import { FakeLogOutputChannel } from './helpers/fakes'
import { memoryToolIo } from './helpers/fakeToolIo'

const ROOT = '/ws'
const PNG = Buffer.from(TINY_PNG_BASE64, 'base64')

function setup(options: { isOffered?: () => boolean; answer?: boolean; hasFolder?: boolean } = {}) {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({ 'taken.png': 'x' }, ROOT)
  io.binaries.set(`${ROOT}/fox.png`, PNG)
  const asked: ImagePlan[] = []
  let billed = 0
  const tools = () =>
    ideImageTools({
      isOffered: options.isOffered ?? (() => true),
      workspace:
        options.hasFolder === false ? undefined : { workspaceRoot: ROOT, platform: 'linux', io },
      client: fakeModelApiClient(api, log),
      confirm: (plan) => {
        asked.push(plan)
        return Promise.resolve(options.answer ?? true)
      },
      onBilled: () => {
        billed += 1
      },
      log,
    })
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = tools().find((candidate) => candidate.name === name)
    if (tool === undefined) {
      throw new Error(`no tool ${name}`)
    }
    return await tool.call(args)
  }
  return { api, io, asked, tools, call, billed: () => billed }
}

describe('the ide server’s image tools (M44)', () => {
  it('offers generateImage and editImage only while on, with a key, and a folder open', () => {
    expect(
      setup()
        .tools()
        .map((tool) => tool.name),
    ).toEqual(['generateImage', 'editImage'])
    expect(setup({ isOffered: () => false }).tools()).toEqual([])
    expect(setup({ hasFolder: false }).tools()).toEqual([])
    const [generate, edit] = setup().tools()
    expect(generate?.inputSchema).toMatchObject({ required: ['prompt', 'path'] })
    expect(edit?.inputSchema).toMatchObject({ required: ['prompt', 'images', 'path'] })
    expect(generate?.description).toContain('billed to the user')
  })

  it('asks with the price first, then buys with the key, writes the PNG and counts it', async () => {
    const t = setup()
    const output = await t.call('generateImage', { prompt: 'a lighthouse', path: 'media/l.png' })
    expect(t.asked).toEqual([
      expect.objectContaining({ kind: 'generate', prompt: 'a lighthouse', sources: [] }),
    ])
    expect(t.api.imageBodies()).toEqual([expect.objectContaining({ prompt: 'a lighthouse' })])
    expect(t.api.requests[0]?.headers['Authorization']).toBe('Bearer LLM|1|secret')
    expect(t.io.binaries.get(`${ROOT}/media/l.png`)?.subarray(0, 4)).toEqual(PNG.subarray(0, 4))
    expect(t.billed()).toBe(1)
    expect(output).toContain('Created media/l.png')
  })

  it('edits from workspace images, sending them inline', async () => {
    const t = setup()
    const output = await t.call('editImage', {
      prompt: 'add a hat',
      images: ['fox.png'],
      path: 'fox-hat.png',
    })
    expect(t.asked[0]?.sources.map((source) => source.relative)).toEqual(['fox.png'])
    expect(t.api.editBodies()).toEqual([
      expect.objectContaining({
        images: [{ image_url: `data:image/png;base64,${TINY_PNG_BASE64}` }],
      }),
    ])
    expect(output).toContain('from fox.png')
  })

  it('refuses before asking what could not be made or saved', async () => {
    const t = setup()
    await expect(t.call('generateImage', { prompt: 'x', path: 'taken.png' })).rejects.toThrow(
      'already exists',
    )
    await expect(
      t.call('editImage', { prompt: 'x', images: ['missing.png'], path: 'out.png' }),
    ).rejects.toThrow('does not exist')
    await expect(t.call('generateImage', { prompt: 'x', path: '../out.png' })).rejects.toThrow(
      'outside',
    )
    expect(t.asked).toEqual([])
    expect(t.api.requests).toEqual([])
  })

  it('buys nothing when the user declines, or when it was turned off meanwhile', async () => {
    const declined = setup({ answer: false })
    await expect(declined.call('generateImage', { prompt: 'x', path: 'no.png' })).rejects.toThrow(
      'declined',
    )
    expect(declined.api.requests).toEqual([])
    expect(declined.io.binaries.has(`${ROOT}/no.png`)).toBe(false)
    let isOn = true
    const late = setup({ isOffered: () => isOn })
    const [generate] = late.tools()
    isOn = false
    await expect(generate?.call({ prompt: 'x', path: 'late.png' })).rejects.toThrow(
      'image generation is off',
    )
    expect(late.api.requests).toEqual([])
    expect(late.billed()).toBe(0)
  })

  it('reports a refusal from Meta as the tool’s error, counting and writing nothing', async () => {
    const t = setup()
    t.api.images.push({ httpError: { status: 400, message: 'prompt rejected by moderation' } })
    await expect(t.call('generateImage', { prompt: 'x', path: 'bad.png' })).rejects.toThrow(
      'prompt rejected by moderation',
    )
    expect(t.billed()).toBe(0)
    expect(t.io.binaries.has(`${ROOT}/bad.png`)).toBe(false)
  })
})
