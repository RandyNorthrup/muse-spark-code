import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import type { AcpMakerRuntime } from '../../acp/maker'
import { parseMakerSlashCommand } from '../../acp/maker'
import { makerSurfaceMessageSchema, type ApprovalRequest } from '../../shared/makerProtocol'
import { RUNTIME_MAKER_AGENT_MARKERS, UI_TEXT } from '../../shared/constants'
import { createRuntimeMakerService, runtimeMakerLan, type RuntimeMakerServiceDeps } from './service'
import { stopRuntimeMachines, stopResultText } from './stop'
import { startCompanion } from './companionServer'

/** Workspace authority is lazy. Stop needs neither authority nor a writable workspace. */
export function createAcpMakerRuntime(
  deps: Omit<RuntimeMakerServiceDeps, 'workspace' | 'ask' | 'interactive'>,
): AcpMakerRuntime {
  const isUnattended = RUNTIME_MAKER_AGENT_MARKERS.some(
    (key) => (deps.native.env[key] ?? '') !== '',
  )
  type Service = Awaited<ReturnType<typeof createRuntimeMakerService>>
  type Asker = (request: ApprovalRequest) => Promise<unknown>
  const entries = new Map<
    string,
    {
      active: Map<string, Asker>
      service?: Service
      starting?: Promise<Service>
    }
  >()
  const aliases = new Map<string, string>()
  const servers = new Set<Awaited<ReturnType<typeof startCompanion>>>()
  const stop = (id?: string) =>
    stopRuntimeMachines(
      {
        dataDirectory: deps.dataDirectory,
        platform: deps.native.platform,
        secrets: deps.secrets,
        lan: deps.lan ?? runtimeMakerLan,
      },
      id,
    )
  return {
    async session(cwd, ask) {
      const canonical = await realpath(cwd)
      let entry = entries.get(canonical)
      if (entry === undefined) {
        entry = { active: new Map() }
        entries.set(canonical, entry)
      }
      aliases.set(cwd, canonical)
      const held = entry
      async function service() {
        held.starting ??= createRuntimeMakerService({
          ...deps,
          workspace: canonical,
          interactive: () => !isUnattended && held.active.size === 1,
          ask: (request) =>
            held.active.size === 1
              ? (held.active.values().next().value?.(request) ?? Promise.resolve(undefined))
              : Promise.resolve(undefined),
        })
        try {
          held.service = await held.starting
          return held.service
        } catch (error) {
          delete held.starting // A failed grant store must not poison later sessions or Stop.
          throw error
        }
      }
      const id = randomUUID()
      const server = await startCompanion({
        dispatch: () => {
          throw new Error('maker-mcp-only')
        },
        // MCP carries no captured/authenticated turn identity on this base. Physical tools fail closed.
        tools: () =>
          !isUnattended && held.active.has(id) && held.active.size === 1
            ? (held.service
                ?.tools()
                .filter((tool) => tool.name !== 'machine_send' && tool.name !== 'device_serial') ??
              [])
            : [],
        assets: new Map(),
      })
      servers.add(server)
      return {
        server: server.mcp,
        setInteractive(isEligible) {
          if (isEligible) held.active.set(id, ask)
          else held.active.delete(id)
          if (held.active.size !== 1) held.service?.host.cancelApprovals()
        },
        async command(text) {
          const parsed = parseMakerSlashCommand(text)
          if (parsed?.name === 'stop-machine') {
            held.service?.host.cancelApprovals()
            held.service?.serial.stop()
            try {
              return stopResultText(
                await stop(parsed.args === '' || parsed.args === '--all' ? undefined : parsed.args),
              )
            } catch (error) {
              // Stop errors already contain fixed localized text and registry machine names.
              return error instanceof Error ? error.message : UI_TEXT.makerPhysicalStopRequired
            }
          }
          let current: Service
          try {
            current = await service()
          } catch {
            if (parsed === undefined) return // Chat in home remains possible, with no physical tools.
            throw new Error(UI_TEXT.makerUnattendedDenied)
          }
          if (parsed === undefined) return
          const argumentsText = parsed.args
          if (parsed.name === 'hardware') {
            const [operation, ...reason] = argumentsText.split(/\s+/)
            if (operation === 'enable') await current.host.setHardware(true, reason.join(' '))
            else if (operation === 'disable') await current.host.setHardware(false)
            else if (operation !== 'status' && operation !== '')
              throw new Error(UI_TEXT.makerHardwareReason)
            await current.host.refresh()
            return current.host.hardwareEnabled()
              ? UI_TEXT.makerHardwareEnabled
              : UI_TEXT.makerHardwareDisabled
          }
          if (argumentsText.startsWith('add ')) {
            if (!current.host.isTrusted() || !current.host.isInteractive())
              throw new Error(UI_TEXT.makerUnattendedDenied)
            try {
              const raw: unknown = JSON.parse(argumentsText.slice('add '.length))
              const envelope = makerSurfaceMessageSchema.parse(raw)
              if (envelope.type !== 'makerAddMachine') throw new Error(UI_TEXT.makerAddMachine)
              await current.dispatch(envelope, new AbortController().signal)
            } catch {
              throw new Error(UI_TEXT.makerAddMachine)
            }
          } else if (argumentsText.startsWith('remove ')) {
            if (!current.host.isTrusted()) throw new Error(UI_TEXT.makerTrustRequired)
            await current.registry.remove(argumentsText.slice('remove '.length).trim())
          } else if (argumentsText !== '' && argumentsText !== 'list')
            throw new Error(UI_TEXT.makerAddMachine)
          return JSON.stringify(await current.registry.list())
        },
        cancel() {
          held.active.delete(id)
          held.service?.host.cancelApprovals()
          held.service?.serial.stop()
          return Promise.resolve()
        },
        async close() {
          held.active.delete(id)
          held.service?.host.cancelApprovals()
          if (servers.delete(server)) await server.close()
        },
      }
    },
    toolsFor(cwd) {
      return entries.get(aliases.get(cwd) ?? cwd)?.service?.tools() ?? []
    },
    async close() {
      await Promise.all([...servers].map((server) => server.close()))
      await Promise.all(
        Array.from(entries.values(), async (entry) => {
          await entry.service?.close()
        }),
      )
      servers.clear()
      entries.clear()
      aliases.clear()
    },
  }
}
