import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { UiText } from '../../shared/l10n/en'
import { setUiText, UI_TEXT, uiLocale, fill, formatNumber } from '../../shared/l10n/text'
import { escapeHtml } from '../../core/htmlText'
import type { PaidUseAnswer } from '../../core/paid/paidConsent'
import type { CoreLogger } from '../../core/logging'
import { PaidUsage } from '../../core/paid/paidFeatures'
import type { UsageRecording } from '../../core/usage/recording'
import { locateDictationHelper } from '../../core/voice/helperLocation'
import { spawnHelper } from '../../host/voice/voiceProcesses'
import { createRuntimeDailyBudget } from '../runtimeAccountingEntry'
import { paidGrantFile } from '../paidGrants'
import { companionVoiceHandler } from './voiceHandler'
import { paidVoiceWindow } from './voicePaid'
import { transcribeCompanionSystem } from './voiceSystem'
import { startCompanionServer } from './server'
import {
  ACP_AGENT_NAME,
  ACP_SESSIONS_SUBFOLDER,
  ACP_PAID_GRANTS_FILE,
  USAGE_COMPANION_IDLE_MS,
  USAGE_COMPANION_MAX_WINDOWS,
  USAGE_STALE_MS,
  VOICE_TEXT_MAX_BYTES,
  WEBVIEW_L10N_ELEMENT_ID,
} from '../../shared/constants'
import {
  COMPANION_VOICE_BODY_BYTES,
  COMPANION_VOICE_MAX_SECONDS,
  COMPANION_VOICE_REQUEST_MS,
} from '../../shared/companionVoice'

export interface VoiceCompanionContext {
  readonly cwd: string
  readonly isCurrent: () => boolean
  readonly signal: AbortSignal
  readonly askPaid?: (
    title: string,
    detail: string,
    canRemember: boolean,
    signal: AbortSignal,
  ) => Promise<PaidUseAnswer>
  readonly send: (text: string, signal: AbortSignal) => Promise<void>
}
export type VoiceCompanion = Awaited<ReturnType<typeof openVoiceCompanion>>

/** First-use bundle factory; never imports vscode or takes a key in arguments. */
export async function openVoiceCompanion(
  deps: {
    readonly packageRoot: string
    readonly dataFolder: string
    readonly temporaryRoot: string
    readonly platform: NodeJS.Platform
    readonly systemRoot: string | undefined
    readonly programFiles: string | undefined
    readonly isVoiceOn: () => boolean
    readonly canRemember: () => boolean
    readonly getKey: () => Promise<string | undefined>
    readonly fetch: typeof globalThis.fetch
    readonly sleep: (ms: number) => Promise<void>
    readonly log: CoreLogger
    readonly recording?: UsageRecording
  },
  context: VoiceCompanionContext,
  table: UiText,
  locale: string,
) {
  setUiText(table, locale)
  context.signal.throwIfAborted()
  const assets = new Map([
    [
      '/voice.js',
      {
        content: await readFile(
          path.join(deps.packageRoot, 'dist', 'webview', 'voiceCompanion.js'),
        ),
        contentType: 'text/javascript',
      },
    ],
    [
      '/voice.css',
      {
        content: await readFile(
          path.join(deps.packageRoot, 'dist', 'webview', 'voiceCompanion.css'),
        ),
        contentType: 'text/css',
      },
    ],
  ])
  const helper = locateDictationHelper({
    platform: deps.platform,
    systemRoot: deps.systemRoot,
    programFiles: deps.programFiles,
    remoteName: undefined,
    appName: ACP_AGENT_NAME,
    helperDir: path.join(deps.packageRoot, 'native'),
    fileExists: existsSync,
  })
  const daily = createRuntimeDailyBudget({
    dataFolder: deps.dataFolder,
    now: Date.now,
    sleep: deps.sleep,
  })
  const grants = paidGrantFile({
    file: path.join(deps.dataFolder, ACP_SESSIONS_SUBFOLDER, ACP_PAID_GRANTS_FILE),
    log: deps.log,
    sleep: deps.sleep,
  })
  if (!deps.isVoiceOn()) {
    try {
      await grants.forget(['voice'])
    } catch {
      deps.log.warn('Companion voice workspace grants could not be forgotten')
    }
    if (!helper.isAvailable) throw new Error(helper.reason)
  }
  const usage = new PaidUsage(deps.log, deps.recording)
  const handler = companionVoiceHandler({
    isCurrent: context.isCurrent,
    send: context.send,
    ...(context.askPaid !== undefined && { askPaid: context.askPaid }),
    transcribeSystem: async (wav, signal) => {
      if (!helper.isAvailable) throw new Error(helper.reason)
      return await transcribeCompanionSystem(wav, signal, {
        platform: deps.platform,
        temporaryRoot: deps.temporaryRoot,
        invocation: helper.invocation,
        spawn: spawnHelper,
      })
    },
    createPaidWindow: () =>
      paidVoiceWindow({
        getKey: deps.getKey,
        isOn: deps.isVoiceOn,
        isCurrent: context.isCurrent,
        canRemember: deps.canRemember,
        workspaceRoot: context.cwd,
        grants,
        dailyBudgetUsd: () => daily.capUsd(),
        reserve: (cost, signal) => daily.reserve(cost, signal),
        usage,
        fetch: deps.fetch,
        log: deps.log,
      }),
  })
  const embedded = JSON.stringify({ table, locale }).replaceAll('<', String.raw`\u003c`)
  return await startCompanionServer({
    handler,
    assets,
    signal: context.signal,
    limits: {
      maxBodyBytes: COMPANION_VOICE_BODY_BYTES,
      maxEventBytes: VOICE_TEXT_MAX_BYTES,
      requestTimeoutMs: COMPANION_VOICE_REQUEST_MS,
      idleTimeoutMs: USAGE_COMPANION_IDLE_MS,
      launchCodeTtlMs: USAGE_STALE_MS,
      sessionTtlMs: USAGE_COMPANION_IDLE_MS,
      maxSessions: USAGE_COMPANION_MAX_WINDOWS,
    },
    renderPage: (nonce) =>
      `<!doctype html><html lang="${escapeHtml(uiLocale())}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(UI_TEXT.companionVoiceTitle)}</title><link rel="stylesheet" href="/voice.css"><script nonce="${nonce}" id="${WEBVIEW_L10N_ELEMENT_ID}" type="application/json">${embedded}</script></head><body><main><h1>${escapeHtml(UI_TEXT.companionVoiceTitle)}</h1><p>${escapeHtml(fill(UI_TEXT.companionVoiceLimit, { seconds: formatNumber(COMPANION_VOICE_MAX_SECONDS) }))}</p><label for="engine">${escapeHtml(UI_TEXT.dictationLabel)}</label><select id="engine">${helper.isAvailable ? `<option value="system">${escapeHtml(UI_TEXT.companionVoiceFree)}</option>` : ''}${deps.isVoiceOn() ? `<option value="museVoice">${escapeHtml(UI_TEXT.dictationPaidLabel)}</option>` : ''}</select><div class="actions"><button id="dictate">${escapeHtml(UI_TEXT.companionVoiceTitle)}</button><button id="stop" disabled>${escapeHtml(UI_TEXT.stopTitle)}</button><button id="cancel" disabled>${escapeHtml(UI_TEXT.companionVoiceCancel)}</button></div><p id="status" role="status" aria-live="polite">${escapeHtml(UI_TEXT.companionVoiceReview)}</p><label for="prompt">${escapeHtml(UI_TEXT.companionVoiceReview)}</label><textarea id="prompt"></textarea><button id="send" disabled>${escapeHtml(UI_TEXT.sendTitle)}</button><dialog id="consent" aria-labelledby="consent-title" aria-describedby="consent-detail"><h2 id="consent-title"></h2><p id="consent-detail" class="consent-detail"></p><div class="actions"><button id="once">${escapeHtml(UI_TEXT.allowOnce)}</button><button id="always">${escapeHtml(UI_TEXT.paidAllowAlways)}</button><button id="deny">${escapeHtml(UI_TEXT.paidDeny)}</button></div></dialog></main><script nonce="${nonce}" type="module" src="/voice.js"></script></body></html>`,
  })
}
