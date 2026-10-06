// One lazy, host-neutral reference implementation for VS Code and ACP.
import * as z from 'zod/mini'
import { REFERENCE_DOCS_URL, UI_TEXT } from '../constants'
import type { UiText } from '../l10n/en'
import { formatNumber, setUiText } from '../l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../protocol'
import { referenceModel } from './reference.generated'
const REFERENCE = referenceModel()
import { referenceName, referenceText } from './text'

export type ReferenceRequest = Extract<
  WebviewToHostMessage,
  { type: 'readReference' | 'openReferenceSetting' | 'runReferenceCommand' }
>
export interface ReferenceHost {
  readNls(): Promise<unknown>
  currentValue(key: string): unknown
  /** Native editors open their settings page at this key's anchor. */
  openSetting(key: string): Promise<void>
  runCommand(command: string): Promise<void>
  post(message: HostToWebviewMessage): void
}

function configurationValue(value: unknown): string {
  if (value === undefined) return '—'
  return typeof value === 'number' ? formatNumber(value) : JSON.stringify(value)
}

export function createReference(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    all(): string {
      const lines = [
        UI_TEXT.helpReferenceTitle,
        UI_TEXT.referenceIntro,
        REFERENCE_DOCS_URL,
        '',
        UI_TEXT.referenceFeatures,
      ]
      for (const f of REFERENCE.features)
        lines.push(
          `${referenceName(f.name, REFERENCE, {}, UI_TEXT)}: ${referenceText(f.summary, REFERENCE, {}, UI_TEXT)}`,
          referenceText(f.description, REFERENCE, {}, UI_TEXT),
          ...f.commands,
          ...f.settings,
          f.docs,
        )
      lines.push('', UI_TEXT.groupSlashCommands)
      for (const c of REFERENCE.slash)
        lines.push(
          `/${c.name}: ${Object.entries(c.descriptions)
            .map(([backend, text]) => `${backend}: ${referenceText(text, REFERENCE, {}, UI_TEXT)}`)
            .join('; ')}`,
        )
      lines.push('', UI_TEXT.referenceCommands)
      for (const c of REFERENCE.commands)
        lines.push(
          `${c.category}: ${c.name} (${c.id}): ${referenceText(c.text, REFERENCE, {}, UI_TEXT)}`,
          ...(c.enablement === undefined ? [] : [c.enablement]),
        )
      lines.push('', UI_TEXT.referenceSettings)
      for (const s of REFERENCE.settings)
        lines.push(
          `${s.id}: ${s.description}`,
          `${UI_TEXT.referenceDefault}: ${configurationValue(s.default)}; ${s.scope}`,
          ...(s.enum?.map((v, i) => `${configurationValue(v)}: ${s.enumDescriptions?.[i] ?? ''}`) ??
            []),
        )
      lines.push('', UI_TEXT.referenceShortcuts)
      for (const k of REFERENCE.shortcuts)
        lines.push(
          `${k.command}: ${k.key}${k.mac === undefined ? '' : `; macOS: ${k.mac}`}${k.win === undefined ? '' : `; Windows: ${k.win}`}${k.linux === undefined ? '' : `; Linux: ${k.linux}`}${k.when === undefined ? '' : `; ${k.when}`}`,
        )
      lines.push('', 'ACP / CLI')
      for (const c of REFERENCE.cli) lines.push(`${c.name}: ${c.description}`)
      return lines.join('\n')
    },
    async handle(message: ReferenceRequest, host: ReferenceHost): Promise<void> {
      if (message.type === 'openReferenceSetting') {
        if (REFERENCE.settings.every((s) => s.id !== message.key))
          throw new Error(UI_TEXT.actionFailed)
        await host.openSetting(message.key)
        return
      }
      if (message.type === 'runReferenceCommand') {
        if (REFERENCE.commands.every((c) => !(c.id === message.command && c.canRun)))
          throw new Error(UI_TEXT.actionFailed)
        await host.runCommand(message.command)
        return
      }
      const nls = z.record(z.string(), z.string()).parse(await host.readNls())
      const values = Object.fromEntries(
        REFERENCE.settings.map((s) => [
          s.id,
          // Values may be secrets despite the manifest's warning. They never cross the bridge.
          s.id === 'museSpark.environmentVariables'
            ? UI_TEXT.referenceHidden
            : configurationValue(host.currentValue(s.id)),
        ]),
      )
      host.post({ type: 'referenceValues', model: JSON.stringify(REFERENCE), values, nls })
    },
  }
}
