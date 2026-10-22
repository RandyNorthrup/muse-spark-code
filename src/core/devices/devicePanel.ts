// One host-owned revision stream per Devices document, shared by every editor.
import {
  deviceHostMessageSchema,
  devicesPanelStateSchema,
  parseDeviceWebviewRequest,
  type DeviceHostMessage,
  type DevicesPanelPort,
  type DevicesPanelState,
  type DeviceWebviewRequest,
} from '../../shared/devicesPanel'

export interface DevicePanelDeps {
  perform(request: DeviceWebviewRequest): Promise<NonNullable<DeviceHostMessage['setup']>>
  snapshot(): Promise<DevicesPanelState>
  publish(message: DeviceHostMessage): void
}

async function settlePanelObservation(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (error) {
    // A malformed snapshot or an exhausted revision refuses this observation
    // only; anything else poisons the stream so later reads fail loudly
    // instead of going quietly stale.
    if (
      error instanceof TypeError &&
      (error.message === 'capacity' || error.message === 'invalid-snapshot')
    )
      return
    throw error
  }
}

export class DevicePanel implements DevicesPanelPort {
  private revision = 0
  private isReady = false
  private latest: DeviceHostMessage | undefined
  private observations = Promise.resolve()
  public constructor(private readonly deps: DevicePanelDeps) {}

  public async observe(): Promise<DeviceHostMessage> {
    const previous = this.observations
    const capture = async (): Promise<DeviceHostMessage> => {
      await previous
      const parsed = devicesPanelStateSchema.safeParse(await this.deps.snapshot())
      if (!parsed.success) throw new TypeError('invalid-snapshot')
      const state = parsed.data
      const revision = this.revision + 1
      if (!Number.isSafeInteger(revision)) throw new TypeError('capacity')
      this.revision = revision
      const message: DeviceHostMessage = { type: 'deviceState', revision, state }
      this.latest = message
      return message
    }
    const operation = capture()
    this.observations = settlePanelObservation(operation)
    return await operation
  }

  /** Readiness replays the latest complete observation, including after reload. */
  public async ready(): Promise<DeviceHostMessage> {
    this.isReady = true
    const message = this.latest ?? (await this.observe())
    this.deps.publish(message)
    return message
  }

  public publishObservation(message: DeviceHostMessage): void {
    if (this.isReady) this.deps.publish(message)
  }

  public async request(
    input: DeviceWebviewRequest,
    signal?: AbortSignal,
  ): Promise<DeviceHostMessage> {
    const parsed = parseDeviceWebviewRequest(input)
    const isAborted = () => signal?.aborted === true
    if (!parsed.ok || parsed.message.revision > this.revision || isAborted())
      throw new Error('invalid-device-message')
    const request = parsed.message
    const setup = deviceHostMessageSchema.shape.setup.parse(await this.deps.perform(request))
    if (setup?.viewId !== request.viewId || setup.requestId !== request.requestId || isAborted())
      throw new Error('invalid-device-message')
    // Aborting a browser wait never cancels already authorized durable work.
    const message = await this.observe()
    if (isAborted()) throw new Error('invalid-device-message')
    return { ...message, setup }
  }
}
