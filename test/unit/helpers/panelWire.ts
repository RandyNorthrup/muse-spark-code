// A real MHP connection of the runtime panel in this process (M104 lane B), with the
// editor's end of it: the suite's feature code asks the editor through the
// connection exactly as the runtime does, and the editor answers as a host's
// services would. The connection answers the host nothing of its own: a request
// the host makes of the runtime is refused as not served.
import { PassThrough } from 'node:stream'
import { stderrLogger } from '../../../src/runtime/stderrLog'
import { MHP, MHP_ERROR_CODES } from '../../../src/shared/constants'
import type { MhpCapability } from '../../../src/shared/hostApi/capabilities'
import { panelInitializeResultSchema } from '../../../src/shared/hostApi/panel'
import { MhpServiceError, PanelConnection } from '../../../src/runtime/panel/connection'
import { streamWriter } from '../../../src/runtime/panel/delivery'
import { connectMhpHost, type MhpWire } from './mhpHost'

export async function connectedWire(
  offered: readonly MhpCapability[],
  options: { readonly trusted?: boolean } = {},
): Promise<{ readonly connection: PanelConnection; readonly editor: MhpWire }> {
  const toRuntime = new PassThrough()
  const fromRuntime = new PassThrough()
  const connection = new PanelConnection(
    {
      capabilities: ['lifecycle'],
      initialize: () => Promise.resolve(),
      request: () =>
        Promise.reject(
          new MhpServiceError(MHP_ERROR_CODES.unsupportedCapability, 'MHP_UNSUPPORTED_CAPABILITY'),
        ),
      notify: () => undefined,
      view: () => undefined,
      closed: () => undefined,
    },
    stderrLogger(() => undefined, 'warn'),
  )
  connection.delivery.connect(streamWriter(connection.delivery, fromRuntime))
  let buffered = ''
  toRuntime.setEncoding('utf8')
  toRuntime.on('data', (chunk: string) => {
    buffered += chunk
    for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
      connection.receive(buffered.slice(0, end))
      buffered = buffered.slice(end + 1)
    }
  })
  const editor = connectMhpHost(toRuntime, fromRuntime)
  panelInitializeResultSchema.parse(
    await editor.request('initialize', {
      host: { id: 'runtime-feature-suite', version: '1.0.0' },
      protocolRange: { minimum: MHP.minimumVersion, maximumExclusive: MHP.maximumVersionExclusive },
      capabilities: [...offered],
      locale: 'en',
      theme: { kind: 'dark', tokens: {} },
      folders: [],
      trusted: options.trusted ?? true,
    }),
  )
  return { connection, editor }
}
