import * as vscode from 'vscode'
import {
  type REPORT_FORMATS,
  REPORT_KINDS,
  UI_TEXT,
  WEBVIEW_DIST_SEGMENTS,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { reportsMethods, type ReportsHostPort } from '../../shared/hostApi/reports'
import {
  reportDiffSchema,
  type ReportDocument,
  type ReportRenderer,
  type ReportTheme,
  type ReportOptions,
} from '../../shared/reportSchema'
import {
  reportingWebviewMessageSchema,
  type ReportingHostMessage,
  type ReportingWebviewMessage,
} from '../../webview/reporting/protocol'
import { buildWebviewHtml, createNonce } from '../html'
import type { WebviewHostContext } from '../views/webviewSetup'
import { parseReportRequest } from './reportRequest'
import { relativeTime } from '../../shared/sessions'
import { scrubFields } from '../../core/reporting/render/redaction'

type HistoryEntry = NonNullable<ReportingHostMessage['history']>[number]
// Newest instant first; saved id breaks ties by code unit, never locale or insertion order.
function newestFirst(a: HistoryEntry, b: HistoryEntry): number {
  return (
    Date.parse(b.header.asOf) - Date.parse(a.header.asOf) ||
    Number(a.id > b.id) - Number(a.id < b.id)
  )
}

/** K/S/H provide the real operations; R supplies verified, scrubbed output. */
export interface ReportPanelEngine {
  readonly reports: Pick<ReportsHostPort, 'run' | 'history' | 'get' | 'compare'>
  readonly render: Readonly<Record<(typeof REPORT_FORMATS)[number], ReportRenderer>>
  readonly verify: (input: unknown) => ReportDocument
  readonly scrub: (text: string) => string
}
export interface ReportPanelDeps {
  readonly context: Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'>
  readonly workspaceKey: string
  readonly engine: () => ReportPanelEngine
  readonly now: () => string
  readonly theme: () => ReportTheme
  readonly attachMarkdown: (text: string) => Promise<void>
  readonly openProblem: () => Promise<void>
}

/** One report tab, with all writes restricted to the user's save-dialog selection. */
export class ReportPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private document: ReportDocument | undefined
  private options: ReportOptions | undefined
  private ready = false
  private nonce = ''
  private state: ReportingHostMessage = {
    type: 'reportingState',
    busy: false,
    header: null,
    html: '',
    history: null,
    diff: null,
    status: '',
    isError: false,
  }
  public constructor(private readonly deps: ReportPanelDeps) {}

  private post(patch: Partial<ReportingHostMessage> = {}, target = this.panel): void {
    if (this.panel !== target) return
    this.state = { ...this.state, ...patch }
    if (this.ready) void this.panel?.webview.postMessage(this.state)
  }

  private show(): void {
    if (this.panel !== undefined) {
      this.panel.reveal()
      return
    }
    const bundleRoot = vscode.Uri.joinPath(this.deps.context.extensionUri, ...WEBVIEW_DIST_SEGMENTS)
    const panel = vscode.window.createWebviewPanel(
      'museSpark.reportingPanel',
      UI_TEXT.reportUi.title,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [bundleRoot],
      },
    )
    this.panel = panel
    this.nonce = createNonce()
    panel.webview.html = buildWebviewHtml({
      scriptUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, 'reportingPage.js'))
        .toString(),
      styleUri: panel.webview
        .asWebviewUri(vscode.Uri.joinPath(bundleRoot, 'reportingPage.css'))
        .toString(),
      cspSource: panel.webview.cspSource,
      nonce: this.nonce,
      l10n: this.deps.context.l10n,
    })
    const receive = panel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = reportingWebviewMessageSchema.safeParse(raw)
      if (!message.success || this.panel !== panel) return
      if (message.data.type === 'reportingReady') {
        this.ready = true
        this.post()
        return
      }
      void this.act(message.data)
    })
    panel.onDidDispose(() => {
      receive.dispose()
      if (this.panel !== panel) {
        return
      }

      this.panel = undefined
      this.ready = false
      this.state = { ...this.state, busy: false, header: null, html: '', history: null, diff: null }
      this.document = undefined
      this.options = undefined
    })
  }

  private display(document: ReportDocument): void {
    const engine = this.deps.engine()
    const verified = engine.verify(document)
    // The srcDoc inherits the shell's CSP. Only R's trusted style gets its nonce;
    // the empty iframe sandbox and the shell's policy remain in force.
    const html = engine.render
      .html(verified, this.deps.context.l10n.locale, this.deps.theme())
      .replace("style-src 'unsafe-inline'", () => `style-src 'nonce-${this.nonce}'`)
      .replace('<style>', () => `<style nonce="${this.nonce}">`)
    this.document = verified
    this.post({
      header: verified.header,
      html,
      history: null,
      diff: null,
      status: '',
      isError: false,
    })
  }

  private async listHistory(): Promise<void> {
    const target = this.panel
    const kind = this.document?.header.kind ?? this.options?.kind ?? 'project'
    const result = reportsMethods['reports/history'].result.parse(
      await this.deps.engine().reports.history({ workspaceKey: this.deps.workspaceKey, kind }),
    )
    if (result.status === 'failed') throw new Error(UI_TEXT.reportUi.generationFailed)
    if (this.panel !== target) return
    const entries = result.entries.toSorted(newestFirst).map((entry) => ({
      ...entry,
      header: { ...entry.header, scope: this.deps.engine().scrub(entry.header.scope) },
    }))
    this.post({
      history: entries,
      diff: null,
      status: entries.length === 0 ? UI_TEXT.reportUi.noHistory : '',
    })
  }

  private async generate(options: ReportOptions): Promise<void> {
    const target = this.panel
    const result = reportsMethods['reports/run'].result.parse(
      await this.deps.engine().reports.run({ workspaceKey: this.deps.workspaceKey, options }),
    )
    if (result.status === 'failed') throw new Error(UI_TEXT.reportUi.generationFailed)
    if (result.document.header.kind !== options.kind)
      throw new Error(UI_TEXT.reportUi.generationFailed)
    if (this.panel !== target) return
    this.display(result.document)
    this.options = options
  }

  /** Every kind is listed, including unavailable kinds whose engine returns an explicit failure. */
  private async pick(): Promise<void> {
    const target = this.panel
    if (target === undefined) return
    const cancellation = new vscode.CancellationTokenSource()
    const lifetime = target.onDidDispose(() => {
      cancellation.cancel()
    })
    try {
      const engine = this.deps.engine()
      const choices = []
      for (const kind of REPORT_KINDS) {
        const result = reportsMethods['reports/history'].result.parse(
          await engine.reports.history({ workspaceKey: this.deps.workspaceKey, kind }),
        )
        if (this.panel !== target) return
        const newest =
          result.status === 'listed' ? result.entries.toSorted(newestFirst)[0] : undefined
        let description = UI_TEXT.reportUi.generationFailed
        if (result.status === 'listed') {
          description =
            newest === undefined
              ? UI_TEXT.reportUi.noHistory
              : fill(UI_TEXT.reportUi.lastReport, {
                  age: relativeTime(newest.header.asOf, Date.parse(this.deps.now())),
                })
        }
        choices.push({
          label: UI_TEXT.reportKinds[kind],
          description,
          argumentsText: kind,
        })
      }
      choices.push({
        label: UI_TEXT.reportUi.problem,
        description: UI_TEXT.reportDescriptionWarning,
        argumentsText: 'problem',
      })
      const choice = await vscode.window.showQuickPick(
        choices,
        { title: UI_TEXT.reportUi.show },
        cancellation.token,
      )
      if (choice === undefined || this.panel !== target) return
      let argumentsText = choice.argumentsText
      if (argumentsText === 'milestone' || argumentsText === 'release') {
        const scope = await vscode.window.showInputBox(
          {
            title: UI_TEXT.reportKinds[argumentsText],
            prompt: UI_TEXT.reportUi.scope,
          },
          cancellation.token,
        )
        if (scope === undefined || this.panel !== target) return
        argumentsText += ` ${scope}`
      }
      const request = parseReportRequest(argumentsText, this.deps.now())
      if (request.action === 'problem') await this.deps.openProblem()
      else if (request.action === 'run') await this.generate(request.options)
    } finally {
      lifetime.dispose()
      cancellation.dispose()
    }
  }

  private async work(
    operation: () => Promise<void>,
    failure = UI_TEXT.reportUi.generationFailed,
  ): Promise<void> {
    if (this.state.busy) return
    const target = this.panel
    this.post({ busy: true, status: '', isError: false })
    try {
      await operation()
    } catch {
      if (this.panel === target) this.post({ status: failure, isError: true })
      this.deps.context.log.warn('Report action failed')
    } finally {
      if (this.panel === target) this.post({ busy: false })
    }
  }

  private async comparePrevious(): Promise<void> {
    const target = this.panel
    const current = this.document
    if (current === undefined) return
    const engine = this.deps.engine()
    const params = { workspaceKey: this.deps.workspaceKey, kind: current.header.kind }
    const listed = reportsMethods['reports/history'].result.parse(
      await engine.reports.history(params),
    )
    if (this.panel !== target) return
    if (listed.status === 'failed') throw new Error(UI_TEXT.reportUi.generationFailed)
    const entries = listed.entries.toSorted(newestFirst)
    const index = entries.findIndex(
      (entry) =>
        entry.header.asOf === current.header.asOf &&
        entry.header.contentHash === current.header.contentHash,
    )
    const previous =
      index === -1
        ? entries.find((entry) => Date.parse(entry.header.asOf) < Date.parse(current.header.asOf))
        : entries[index + 1]
    if (previous === undefined) {
      this.post({ status: UI_TEXT.reportUi.noHistory })
      return
    }
    const result = reportsMethods['reports/get'].result.parse(
      await engine.reports.get({ ...params, id: previous.id }),
    )
    if (this.panel !== target) return
    if (result.status === 'failed') throw new Error(UI_TEXT.reportUi.generationFailed)
    const before = engine.verify(result.document)
    if (
      before.header.contentHash !== previous.header.contentHash ||
      before.header.asOf !== previous.header.asOf ||
      before.header.kind !== current.header.kind
    )
      throw new Error(UI_TEXT.reportUi.generationFailed)
    if (before.header.contentHash === current.header.contentHash) {
      this.post({
        diff: null,
        history: null,
        status: fill(UI_TEXT.reportUi.noChange, { asOf: before.header.asOf }),
      })
      return
    }
    const selected = entries[index]
    if (selected === undefined) {
      this.post({ status: UI_TEXT.reportUi.historyRequired })
      return
    }
    const compared = reportsMethods['reports/compare'].result.parse(
      await engine.reports.compare({ ...params, fromId: previous.id, toId: selected.id }),
    )
    if (this.panel !== target) return
    if (
      compared.status === 'failed' ||
      compared.diff.from.contentHash !== before.header.contentHash ||
      compared.diff.to.contentHash !== current.header.contentHash
    )
      throw new Error(UI_TEXT.reportUi.generationFailed)
    // H's normalized diff is scrubbed again before the page receives any source text.
    const clean = structuredClone(compared.diff.sections)
    scrubFields(clean, engine.scrub)
    this.post({
      history: null,
      diff: reportDiffSchema.parse({ from: before.header, to: current.header, sections: clean }),
    })
  }

  private async act(message: ReportingWebviewMessage): Promise<void> {
    const action = message.type === 'reportingAction' ? message.action : message.type
    const target = this.panel
    let failure = UI_TEXT.reportUi.generationFailed
    if (action === 'copy') failure = UI_TEXT.reportUi.copyFailed
    else if (action === 'reportingSave') failure = UI_TEXT.reportUi.saveFailed
    await this.work(async () => {
      if (action === 'pick') {
        await this.pick()
        return
      }
      if (message.type === 'reportingOpen') {
        if (!this.state.history?.some((entry) => entry.id === message.id))
          throw new Error(UI_TEXT.reportUi.generationFailed)
        const kind = this.document?.header.kind ?? this.options?.kind ?? 'project'
        const result = reportsMethods['reports/get'].result.parse(
          await this.deps
            .engine()
            .reports.get({ workspaceKey: this.deps.workspaceKey, kind, id: message.id }),
        )
        if (this.panel !== target) return
        if (result.status === 'failed' || result.document.header.kind !== kind)
          throw new Error(UI_TEXT.reportUi.generationFailed)
        const selected = this.state.history.find((entry) => entry.id === message.id)
        if (
          selected?.header.contentHash !== result.document.header.contentHash ||
          selected.header.asOf !== result.document.header.asOf
        )
          throw new Error(UI_TEXT.reportUi.generationFailed)
        this.display(result.document)
        this.options = undefined
        return
      }
      if (action === 'history') {
        await this.listHistory()
        return
      }
      if (action === 'diff') {
        await this.comparePrevious()
        return
      }
      if (action === 'refresh') {
        const options =
          this.options ??
          (this.document === undefined
            ? undefined
            : {
                kind: this.document.header.kind,
                scope: this.document.header.scope,
                full: false,
                network: false,
                failOn: [],
              })
        if (options === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
        await this.generate({ ...options, asOf: this.deps.now() })
        return
      }
      const document = this.document
      if (document === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
      const engine = this.deps.engine()
      const format = message.type === 'reportingSave' ? message.format : 'md'
      const text = engine.render[format](document, this.deps.context.l10n.locale, this.deps.theme())
      if (action === 'copy') {
        await vscode.env.clipboard.writeText(text)
        this.post({ status: UI_TEXT.reportUi.copied }, target)
      } else if (action === 'attach') {
        await this.deps.attachMarkdown(text)
        this.post({ status: UI_TEXT.reportUi.attached }, target)
      } else if (message.type === 'reportingSave') {
        const extension = format === 'text' ? 'txt' : format
        const uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(`${document.header.kind}.${extension}`),
          filters: { [format]: [extension] },
          saveLabel: UI_TEXT.reportUi.saveAs,
        })
        if (uri === undefined || this.panel !== target) return
        await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'))
        this.post(
          { status: fill(UI_TEXT.reportUi.saved, { path: engine.scrub(uri.fsPath) }) },
          target,
        )
      }
    }, failure)
  }

  public async open(argumentsText = ''): Promise<void> {
    if (this.state.busy) throw new Error(UI_TEXT.reportUi.generationFailed)
    const request = parseReportRequest(argumentsText, this.deps.now())
    if (request.action === 'problem') {
      await this.deps.openProblem()
      return
    }
    this.show()
    await this.work(async () => {
      if (request.action === 'pick') await this.pick()
      else if (request.action === 'history') await this.listHistory()
      else await this.generate(request.options)
    })
  }

  public dispose(): void {
    this.panel?.dispose()
  }
}
