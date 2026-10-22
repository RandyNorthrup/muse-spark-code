import { NODE_HEALTH_OK, NODE_HEALTH_UNREADY } from '../../shared/constants'
import type { NodeStateStore } from './state'

export interface NodeHealthPorts {
  readonly state: NodeStateStore
  journalsReadable(): Promise<boolean>
  isKeyStoreSealed(): boolean
  keysNeeded(): boolean
}

/** The deployment binds this only on loopback; replies contain fixed status words. */
export async function nodeHealth(
  route: '/livez' | '/readyz',
  ports: NodeHealthPorts,
): Promise<{
  status: typeof NODE_HEALTH_OK | typeof NODE_HEALTH_UNREADY
  word: 'live' | 'ready' | 'not-ready'
}> {
  if (route === '/livez') return { status: NODE_HEALTH_OK, word: 'live' }
  try {
    if (!(await ports.journalsReadable()) || (ports.keysNeeded() && ports.isKeyStoreSealed()))
      return { status: NODE_HEALTH_UNREADY, word: 'not-ready' }
    ports.state.read()
    await ports.state.files.write('health.probe', '')
    return { status: NODE_HEALTH_OK, word: 'ready' }
  } catch {
    return { status: NODE_HEALTH_UNREADY, word: 'not-ready' }
  }
}
