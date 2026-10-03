import { expect, it, vi } from 'vitest'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import {
  type ImagePlan,
  prepareImageCall,
  runImageCall,
} from '../../src/core/backends/modelapi/imageGeneration'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { MODEL_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'

/** A generation planned for `out.png` and run over `io`, its image bought from the fake API. */
async function generated(io: ToolIo) {
  const prepared = await prepareImageCall(
    'generate',
    { prompt: 'draw', path: 'out.png' },
    { workspaceRoot: '/ws', platform: 'linux', io },
  )
  if (!prepared.ok) {
    throw new Error(prepared.reason)
  }
  const plan: ImagePlan = prepared.plan
  const billed = vi.fn()
  const result = await runImageCall(plan, {
    client: fakeModelApiClient(fakeModelApi(), new FakeLogOutputChannel()),
    io,
    signal: new AbortController().signal,
    isStillOn: () => true,
    onBilled: billed,
  })
  return { result, billed }
}

it('prepares a paid image edit from the checked target after a source link retargets', async () => {
  const base = memoryToolIo({}, '/ws')
  const inside = new Uint8Array([1, 2, 3])
  const outside = new Uint8Array([4, 5, 6])
  base.binaries.set('/ws/safe/source.png', inside)
  base.binaries.set('/ws/outside/source.png', outside)
  let target = '/ws/safe'
  const io = {
    ...base,
    realPath: (absolutePath: string) => {
      if (absolutePath !== '/ws/link/source.png') {
        return Promise.resolve(absolutePath)
      }
      const checked = `${target}/source.png`
      target = '/ws/outside'
      return Promise.resolve(checked)
    },
    readBytes: (absolutePath: string, maxBytes: number) =>
      base.readBytes(
        absolutePath === '/ws/link/source.png' ? `${target}/source.png` : absolutePath,
        maxBytes,
      ),
  }
  const result = await prepareImageCall(
    'edit',
    { prompt: 'edit', images: ['link/source.png'], path: 'edited.png' },
    { workspaceRoot: '/ws', platform: 'linux', io },
  )
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.reason)
  }
  expect(result.plan.sources[0]?.bytes).toEqual(inside)
  expect(result.plan.sources[0]?.bytes).not.toEqual(outside)
  // prepareImageCall is the pre-confirmation stage: no paid API call occurs here.
})

it('reserves paid image output at the checked target after a link retargets, before any request', async () => {
  const base = memoryToolIo({}, '/ws')
  const reserved: string[] = []
  const io = {
    ...base,
    realPath: (absolutePath: string) =>
      Promise.resolve(
        absolutePath === '/ws/link/output.png' ? '/ws/safe/output.png' : absolutePath,
      ),
    pathExists: (absolutePath: string) =>
      base.pathExists(absolutePath === '/ws/link/output.png' ? '/etc/output.png' : absolutePath),
    reserveFile: (absolutePath: string) => {
      reserved.push(absolutePath === '/ws/link/output.png' ? '/etc/output.png' : absolutePath)
      return Promise.reject(new Error('EEXIST'))
    },
  }
  const prepared = await prepareImageCall(
    'generate',
    { prompt: 'draw', path: 'link/output.png' },
    { workspaceRoot: '/ws', platform: 'linux', io },
  )
  if (!prepared.ok) {
    throw new Error(prepared.reason)
  }
  const request = vi.fn<() => Promise<Response>>(() => Promise.reject(new Error('paid request')))
  const client = new ModelApiClient({
    fetch: request,
    baseUrl: 'https://api.example.test/v1',
    apiKey: () => Promise.resolve(undefined),
    sleep: () => Promise.resolve(),
    now: () => 0,
    random: () => 0,
    log: new FakeLogOutputChannel(),
  })
  const billed = vi.fn()
  const result = await runImageCall(prepared.plan, {
    client,
    io,
    signal: new AbortController().signal,
    isStillOn: () => true,
    onBilled: billed,
  })
  expect(result.failureReason).toBeDefined()
  expect(reserved).toEqual(['/ws/safe/output.png'])
  expect(request).not.toHaveBeenCalled()
  expect(billed).not.toHaveBeenCalled()
})

it('leaves a reserved file someone wrote into as it is, and says so (M86 I)', async () => {
  const base = memoryToolIo({}, '/ws')
  const released = vi.fn(() => Promise.resolve('changed' as const))
  const io: ToolIo = {
    ...base,
    reserveFile: () =>
      Promise.resolve({ fill: () => Promise.resolve('changed'), release: released }),
  }
  const { result, billed } = await generated(io)
  expect(result.failureReason).toBe(MODEL_TEXT.imageFileChanged)
  // The image was bought; nothing of it was written, and the file is not released either.
  expect(billed).toHaveBeenCalledOnce()
  expect(released).not.toHaveBeenCalled()
})

it('says why a reservation was refused when the path is not taken (M86 N)', async () => {
  const base = memoryToolIo({}, '/ws')
  const refusal = 'out.png was not written: the record a restore needs could not be saved'
  const taken = await generated({
    ...base,
    reserveFile: () => Promise.reject(Object.assign(new Error('EEXIST'), { code: 'EEXIST' })),
  })
  expect(taken.result.failureReason).toBe(MODEL_TEXT.imagePathTaken)
  const refused = await generated({
    ...base,
    reserveFile: () => Promise.reject(new Error(refusal)),
  })
  expect(refused.result.failureReason).toBe(refusal)
  expect(refused.billed).not.toHaveBeenCalled()
})
