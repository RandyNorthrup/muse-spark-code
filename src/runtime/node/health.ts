import { NODE_HEALTH_OK, NODE_HEALTH_UNREADY } from '../../shared/constants'
import {
  evaluateDesktopReadiness,
  type DesktopReadiness,
  type DesktopReadinessPort,
} from '../../core/o11y/readiness'
import type { NodeStateStore } from './state'

export interface NodeHealthPorts {
  readonly state: NodeStateStore
  journalsReadable(): Promise<boolean>
  isKeyStoreSealed(): boolean
  keysNeeded(): boolean
  /** The desktop's probes (M111 lane OB); absent outside the desktop profile. */
  readonly desktop?: DesktopReadinessPort
}

/** Engine failures are bugs; every other probe failure means not-ready. */
function isStorageFailure(error: unknown): boolean {
  return !(error instanceof TypeError) && !(error instanceof RangeError)
}

/**
The desktop's readiness, or undefined outside the desktop profile. A
failing probe reads as no probes at all (not ready); an engine failure
is a bug and surfaces.
*/
async function desktopReadiness(
  port: DesktopReadinessPort | undefined,
): Promise<DesktopReadiness | undefined> {
  if (port === undefined) return undefined
  try {
    // Readiness probes are fast local reads by contract; the compositor's
    // own 250 ms bound judges the measured ping, not this call.
    return evaluateDesktopReadiness(await port.probe(new AbortController().signal))
  } catch (error: unknown) {
    if (!isStorageFailure(error)) throw error
    return evaluateDesktopReadiness([])
  }
}

/** The deployment binds this only on loopback; replies contain fixed status words. */
export async function nodeHealth(
  route: '/livez' | '/readyz',
  ports: NodeHealthPorts,
): Promise<{
  status: typeof NODE_HEALTH_OK | typeof NODE_HEALTH_UNREADY
  word: 'live' | 'ready' | 'not-ready'
  desktop?: DesktopReadiness
}> {
  if (route === '/livez') return { status: NODE_HEALTH_OK, word: 'live' }
  const desktop = await desktopReadiness(ports.desktop)
  let isNodeReady: boolean
  try {
    if (!(await ports.journalsReadable()) || (ports.keysNeeded() && ports.isKeyStoreSealed())) {
      isNodeReady = false
    } else {
      ports.state.read()
      await ports.state.files.write('health.probe', '')
      isNodeReady = true
    }
  } catch (error: unknown) {
    // Every storage failure is not-ready; engine failures are bugs and surface.
    if (!isStorageFailure(error)) throw error
    isNodeReady = false
  }
  const isReady = isNodeReady && (desktop === undefined || desktop.ready)
  return {
    status: isReady ? NODE_HEALTH_OK : NODE_HEALTH_UNREADY,
    word: isReady ? 'ready' : 'not-ready',
    ...(desktop !== undefined && { desktop }),
  }
}
