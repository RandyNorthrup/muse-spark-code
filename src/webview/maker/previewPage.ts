import { MAKER_PROTOCOL_VERSION } from '../../shared/makerPreviewConstants'
import type { MakerSurfaceMessage } from '../../shared/makerProtocol'
import { makerMeshMessageSchema } from '../../shared/makerProtocolPreview'
import type { HostBridge } from '../hostBridge'
import { createMeshRenderer } from './meshRenderer'

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
  let renderer: ReturnType<typeof createMeshRenderer> | undefined
  let isDisposed = false
  const fail = () => {
    renderer?.dispose()
    renderer = undefined
    unavailable.hidden = false
    delete canvas.dataset['rendered']
  }
  const receive = (event: MessageEvent<unknown>) => {
    const result = makerMeshMessageSchema.safeParse(event.data)
    if (isDisposed || !result.success || result.data.artifactId !== artifactId) return
    renderer?.dispose()
    try {
      renderer = createMeshRenderer(canvas, result.data.positions)
      unavailable.hidden = true
      canvas.dataset['rendered'] = 'true'
    } catch {
      fail()
    }
  }
  const onControl = (event: Event) => {
    if (!(event.target instanceof Element)) return
    const stop = event.target.closest<HTMLElement>('[data-maker-stop]')
    if (stop !== null) {
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
    event.preventDefault()
    fail()
  }
  host.messages.addEventListener('message', receive)
  document.addEventListener('click', onControl)
  canvas.addEventListener('webglcontextlost', lost)
  host.post({ v: MAKER_PROTOCOL_VERSION, type: 'makerReady' })
  return () => {
    isDisposed = true
    renderer?.dispose()
    host.messages.removeEventListener('message', receive)
    document.removeEventListener('click', onControl)
    canvas.removeEventListener('webglcontextlost', lost)
  }
}
