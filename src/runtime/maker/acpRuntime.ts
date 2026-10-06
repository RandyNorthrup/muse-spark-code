import { randomUUID } from 'node:crypto'
import type { AcpMakerRuntime } from '../../acp/maker'
import { makerSurfaceMessageSchema, type ApprovalRequest } from '../../shared/makerProtocol'
import { UI_TEXT } from '../../shared/constants'
import { createRuntimeMakerService, type RuntimeMakerServiceDeps } from './service'
import { startCompanion } from './companionServer'

/** A workspace engine, with exactly one attended editor session eligible to answer. */
export function createAcpMakerRuntime(
  deps: Omit<RuntimeMakerServiceDeps, 'workspace' | 'ask' | 'interactive'>,
): AcpMakerRuntime {
  type Service = Awaited<ReturnType<typeof createRuntimeMakerService>>
  type Asker = (request: ApprovalRequest) => Promise<unknown>
  const entries = new Map<string, Promise<{ service: Service; active: Map<string, Asker> }>>()
  const servers = new Set<Awaited<ReturnType<typeof startCompanion>>>()
  function workspace(cwd: string) {
    let entry = entries.get(cwd)
    if (entry === undefined) {
      entry = (async () => {
        const active = new Map<string, Asker>()
        const service = await createRuntimeMakerService({
          ...deps,
          workspace: cwd,
          interactive: () => active.size === 1,
          ask: (request) =>
            active.size === 1
              ? (active.values().next().value?.(request) ?? Promise.resolve(undefined))
              : Promise.resolve(undefined),
        })
        return { service, active }
      })()
      entries.set(cwd, entry)
    }
    return entry
  }
  const ready = new Map<string, Service>()
  return {
    async session(cwd, ask) {
      const { service, active } = await workspace(cwd)
      ready.set(cwd, service)
      const id = randomUUID()
      const server = await startCompanion({
        host: service.host,
        dispatch: service.dispatch,
        // Only this top-level session receives its MCP endpoint. Plan/idle/released sessions offer nothing.
        tools: () => (active.has(id) && active.size === 1 ? service.tools() : []),
        assets: new Map(),
      })
      servers.add(server)
      return {
        server: server.mcp,
        setInteractive(isEligible) {
          if (isEligible) active.set(id, ask)
          else active.delete(id)
          if (active.size !== 1) service.host.cancelApprovals()
        },
        async command(text) {
          const match = /^\/(hardware|machines|stop-machine)(?:\s+(.*))?$/.exec(text.trim())
          if (match === null) return
          const command = match[1],
            argumentsText = match[2]?.trim() ?? ''
          if (command === 'stop-machine') {
            await service.stop(
              argumentsText === '' || argumentsText === '--all' ? undefined : argumentsText,
            )
            return UI_TEXT.makerSoftwareStopWarning
          }
          if (command === 'hardware') {
            const [operation, ...reason] = argumentsText.split(/\s+/)
            if (operation === 'enable') await service.host.setHardware(true, reason.join(' '))
            else if (operation === 'disable') await service.host.setHardware(false)
            else if (operation !== 'status' && operation !== '')
              throw new Error(UI_TEXT.makerHardwareReason)
            await service.host.refresh()
            return service.host.hardwareEnabled()
              ? UI_TEXT.makerHardwareEnabled
              : UI_TEXT.makerHardwareDisabled
          }
          if (argumentsText.startsWith('add ')) {
            if (!service.host.isTrusted() || !service.host.isInteractive())
              throw new Error(UI_TEXT.makerUnattendedDenied)
            try {
              const raw: unknown = JSON.parse(argumentsText.slice('add '.length))
              const envelope = makerSurfaceMessageSchema.parse(raw)
              if (envelope.type !== 'makerAddMachine') throw new Error(UI_TEXT.makerAddMachine)
              await service.dispatch(envelope, new AbortController().signal)
            } catch {
              // Parser/registration errors can echo pasted input; use only fixed display text.
              throw new Error(UI_TEXT.makerAddMachine)
            }
          } else if (argumentsText.startsWith('remove ')) {
            if (!service.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
            await service.registry.remove(argumentsText.slice('remove '.length).trim())
          } else if (argumentsText !== '' && argumentsText !== 'list')
            throw new Error(UI_TEXT.makerAddMachine)
          return JSON.stringify(await service.registry.list())
        },
        cancel() {
          active.delete(id)
          service.host.cancelApprovals()
          service.serial.stop()
          return Promise.resolve()
        },
        async close() {
          active.delete(id)
          service.host.cancelApprovals()
          if (servers.delete(server)) await server.close()
        },
      }
    },
    toolsFor(cwd) {
      return ready.get(cwd)?.tools() ?? []
    },
    async close() {
      await Promise.all([...servers].map((server) => server.close()))
      await Promise.all(
        Array.from(entries.values(), async (entry) => {
          const { service } = await entry
          await service.close()
        }),
      )
      servers.clear()
      entries.clear()
      ready.clear()
    },
  }
}
