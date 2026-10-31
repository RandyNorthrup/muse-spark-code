import {
  MAKER_PROTOCOL_VERSION,
  MAKER_PREVIEW_MAX_TRIANGLES,
  MAKER_TRIANGLE_COMPONENTS,
  MAKER_PREVIEW_VALIDATION_CHUNK,
  MAKER_PREVIEW_VALIDATION_DEADLINE_MS,
} from '../../shared/makerPreviewConstants'
import type { MakerSurfaceMessage } from '../../shared/makerProtocol'
import { makerMeshMessageSchema } from '../../shared/makerProtocolPreview'
import type { HostBridge } from '../hostBridge'
import { createMeshRenderer } from './meshRenderer'

/** The renderer's own fixed refusal words for an unusable WebGL surface. */
function isRenderFailure(error: unknown): boolean {
  return (
    error instanceof RangeError || (error instanceof Error && error.message.startsWith('webgl'))
  )
}

/** Host supplies localized HTML and CSP; this page never reads files or URLs. */
export function wireMakerPreview(document: Document, host: HostBridge<MakerSurfaceMessage>) {
  const canvas = document.querySelector<HTMLCanvasElement>('#maker-canvas')
  const unavailable = document.querySelector<HTMLElement>('#maker-preview-unavailable')
  if (canvas === null || unavailable === null) throw new Error('makerPreviewDocument')
  const artifact = makerMeshMessageSchema.shape.artifactId.safeParse(
    document.body.dataset['artifactId'],
  )
  if (!artifact.success) throw new Error('makerPreviewArtifact')
  const artifactId = artifact.data
  const stops = document.createElement('div')
  stops.className = 'maker-stop-stack maker-preview-controls'
  const stopButtons = [...document.querySelectorAll<HTMLElement>('[data-maker-stop]')]
  const stopAll = stopButtons.find((button) => !button.dataset['makerStop'])
  const list = document.createElement('div')
  list.className = 'maker-stop-list'
  list.append(...stopButtons.filter((button) => button !== stopAll))
  if (stopAll !== undefined) stops.append(stopAll)
  stops.append(list)
  document.body.append(stops)
  let renderer: ReturnType<typeof createMeshRenderer> | undefined
  let isDisposed = false
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const fail = () => {
    renderer?.dispose()
    renderer = undefined
    unavailable.hidden = false
    canvas.dataset['rendered'] = 'false'
  }
  const receive = (event: MessageEvent<unknown>) => {
    const raw = event.data
    if (
      isDisposed ||
      typeof raw !== 'object' ||
      raw === null ||
      !('type' in raw) ||
      raw.type !== 'makerMesh' ||
      !('artifactId' in raw) ||
      raw.artifactId !== artifactId
    )
      return
    const current = ++generation
    clearTimeout(timer)
    fail()
    if (
      !('positions' in raw) ||
      !Array.isArray(raw.positions) ||
      raw.positions.length < MAKER_TRIANGLE_COMPONENTS ||
      raw.positions.length > MAKER_PREVIEW_MAX_TRIANGLES * MAKER_TRIANGLE_COMPONENTS ||
      raw.positions.length % MAKER_TRIANGLE_COMPONENTS !== 0
    )
      return
    const positions: unknown[] = raw.positions
    const parsed: number[] = []
    const deadline = performance.now() + MAKER_PREVIEW_VALIDATION_DEADLINE_MS
    let offset = 0
    const step = () => {
      if (isDisposed || current !== generation || performance.now() >= deadline) return
      const result = makerMeshMessageSchema.safeParse({
        ...raw,
        positions: positions.slice(offset, offset + MAKER_PREVIEW_VALIDATION_CHUNK),
      })
      if (!result.success) return
      parsed.push(...result.data.positions)
      offset += result.data.positions.length
      if (offset < positions.length) {
        timer = setTimeout(step, 0)
        return
      }
      try {
        renderer = createMeshRenderer(canvas, parsed)
        unavailable.hidden = true
        canvas.dataset['rendered'] = 'true'
      } catch (error: unknown) {
        if (!isRenderFailure(error)) throw error
        fail()
      }
    }
    step()
  }
  const onControl = (event: Event) => {
    if (!(event.target instanceof Element)) return
    const stop = event.target.closest<HTMLElement>('[data-maker-stop]')
    if (stop !== null) {
      generation += 1
      clearTimeout(timer)
      const machineId = stop.dataset['makerStop']
      host.post({
        v: MAKER_PROTOCOL_VERSION,
        type: 'makerStop',
        ...(machineId !== undefined && machineId !== '' && { machineId }),
      })
      return
    }
    switch (event.target.closest<HTMLElement>('[data-maker-view]')?.dataset['makerView']) {
      case 'left': {
        renderer?.rotate(-1)
        break
      }
      case 'right': {
        renderer?.rotate(1)
        break
      }
      case 'in': {
        renderer?.zoom(1)
        break
      }
      case 'out': {
        renderer?.zoom(-1)
        break
      }
      case 'reset': {
        renderer?.reset()
        break
      }
    }
  }
  const lost = (event: Event) => {
    generation += 1
    clearTimeout(timer)
    event.preventDefault()
    fail()
  }
  host.messages.addEventListener('message', receive)
  document.addEventListener('click', onControl)
  canvas.addEventListener('webglcontextlost', lost)
  host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerReady' })
  return () => {
    isDisposed = true
    clearTimeout(timer)
    renderer?.dispose()
    host.messages.removeEventListener('message', receive)
    document.removeEventListener('click', onControl)
    canvas.removeEventListener('webglcontextlost', lost)
    stops.remove()
  }
}
