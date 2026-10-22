// M103-A: called lazily by the maker host. The IDE owns its board selection
// and serial monitor; this reader opens no port and changes no IDE state.
import * as z from 'zod/mini'

const ARDUINO_API_EXTENSION_ID = 'dankeboy36.vscode-arduino-api'
const portSchema = z.object({
  address: z.string(),
  label: z.string(),
  hardwareId: z.string(),
  protocol: z.string(),
  protocolLabel: z.string(),
  properties: z.record(z.string(), z.string()),
})
const selectionSchema = z.object({
  sketchPath: z.optional(z.string()),
  fqbn: z.optional(z.string()),
  port: z.optional(portSchema),
})

/** Injected by the VS Code maker adapter; absent in editors without the provider. */
export interface ArduinoApiSource {
  getExtension(id: string):
    | {
        readonly isActive: boolean
        readonly exports: unknown
        activate(): PromiseLike<unknown>
      }
    | undefined
}

/** Read fresh for each action, so a board/port switch cannot leave a cached target. */
export async function readArduinoSelection(source: ArduinoApiSource) {
  const extension = source.getExtension(ARDUINO_API_EXTENSION_ID)
  if (extension === undefined) return
  const api: unknown = extension.isActive ? extension.exports : await extension.activate()
  // zod reads the provider's getters, validates the boundary and copies only
  // selection fields; compile summaries and arbitrary provider data stay out.
  return selectionSchema.parse(api)
}
