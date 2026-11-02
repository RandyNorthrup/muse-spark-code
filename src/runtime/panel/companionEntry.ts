// dist/runtimePanelCompanion.js (M104 lane C): `muse-spark-code-acp panel
// --companion`, the same panel host lane B serves on stdio, served to one
// browser window instead. The companion transport feeds the host a
// synthetic handshake, mints the window's binding when the session opens
// its surface, prints the launch URL and opens the person's browser. The
// window then chats over the companion server's MHP routes. Loaded only
// by `panel --companion`.
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { failureForLog } from '../../core/backends/musecode/logText'
import { PANEL_COMPANION_LIMITS } from '../../shared/constants'
import { loadUsageTable } from '../../shared/l10n/usageTable'
import type { PanelOptions } from '../cliArgs'
import { startCompanionServer } from '../companion/server'
import { readUsageTableFile } from '../usage/usageTableFile'
import { createPanelCompanionTransport } from './companionTransport'
import { createPanelHost, type PanelRuntimeDeps } from './panelEntry'
import { portablePage } from './portablePage'

/** Serves the panel to one browser window; exits when the server or connection ends. */
export async function runPanelCompanion(
  options: PanelOptions,
  deps: PanelRuntimeDeps,
): Promise<number> {
  const { log } = deps
  const started: { server?: Awaited<ReturnType<typeof startCompanionServer>> } = {}
  const host = await createPanelHost(options, deps, {
    onClosed: () => {
      void started.server?.close()
    },
  })
  const page = await portablePage(path.join(deps.distDir, 'webview', 'portable'))
  const table = await loadUsageTable({
    language: deps.locale,
    readTableFile: (segments) => readUsageTableFile(path.dirname(deps.distDir), segments),
    warn: (message) => {
      log.warn(message)
    },
  })
  const transport = createPanelCompanionTransport({
    connection: host.connection,
    log,
    version: deps.version,
    locale: deps.locale,
    workspaceUri: pathToFileURL(host.workspace).href,
    workspaceName: path.basename(host.workspace),
    issueLaunch: (context) => {
      if (started.server === undefined) throw new Error('EPANEL_CLOSED')
      return started.server.launchUrl(context)
    },
    retireLaunch: (context) => {
      started.server?.retireContext(context)
    },
    announce: (url) => {
      deps.stdout.write(`${url}\n`, (error) => {
        if (error != null) log.warn(`The launch URL could not be printed: ${failureForLog(error)}`)
      })
      void deps.openBrowser(url).catch((error: unknown) => {
        // REPORTED: the URL is printed above; a browser that did not open
        // is logged, and the panel keeps serving.
        log.warn(`The browser did not open: ${failureForLog(error)}`)
      })
    },
  })
  const server = await startCompanionServer({
    handler: transport.handler,
    services: transport.services,
    limits: PANEL_COMPANION_LIMITS,
    assets: page.assets,
    renderPage: (nonce, context = '') => {
      const bound = transport.bindingFor(context)
      if (bound === undefined) throw new Error('MHP_SESSION_NOT_FOUND')
      return page.render(bound, nonce, {
        locale: deps.locale,
        title: deps.table.companionPanelTitle,
        uiTable: { locale: deps.locale, table: deps.table },
        usageTable: { type: 'usage/table', ...table },
      })
    },
    report: (error) => {
      log.warn(`The companion server failed a request: ${failureForLog(error)}`)
    },
  })
  started.server = server
  transport.handshake()
  await server.closed
  // The server ended (signal, idle, or the connection's own close): the
  // connection ends with it, and its exit code is the process's.
  host.connection.close(false)
  return await host.closed
}
