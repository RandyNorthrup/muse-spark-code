// One lazy, host-neutral reference implementation for VS Code and ACP.
import * as z from 'zod/mini'
import { REFERENCE_DOCS_URL, UI_TEXT } from '../constants'
import type { UiText } from '../l10n/en'
import { fill, formatNumber, setUiText } from '../l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../protocol'
import { referenceModel } from './reference.generated'
const REFERENCE = referenceModel()
import { referenceName, referenceText, referenceSchema } from './text'

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
    all(input: unknown = {}): string {
      const nls = z.record(z.string(), z.string()).parse(input)
      const lines = [
        UI_TEXT.helpReferenceTitle,
        UI_TEXT.referenceIntro,
        REFERENCE_DOCS_URL,
        '',
        UI_TEXT.referenceUnavailable,
        UI_TEXT.referenceAcp,
        UI_TEXT.referenceFeatures,
      ]
      for (const f of REFERENCE.features)
        lines.push(
          `${referenceName(f.name, REFERENCE, nls, UI_TEXT)}: ${referenceText(f.summary, REFERENCE, nls, UI_TEXT)}`,
          referenceText(f.description, REFERENCE, nls, UI_TEXT),
          ...f.details.map((text) => referenceText(text, REFERENCE, nls, UI_TEXT)),
          JSON.stringify(referenceSchema(f.facts, nls)),
          f.surfaces.join(', '),
          ...(f.paid ? [UI_TEXT.referencePaid] : []),
          ...f.commands,
          ...f.settings,
          f.docs,
        )
      lines.push('', UI_TEXT.groupSlashCommands)
      for (const c of REFERENCE.slash)
        lines.push(
          `/${c.name}: ${c.syntax.join(' | ')}: ${Object.entries(c.descriptions)
            .map(([backend, text]) => `${backend}: ${referenceText(text, REFERENCE, nls, UI_TEXT)}`)
            .join('; ')}`,
        )
      lines.push('', UI_TEXT.referenceCommands)
      for (const c of REFERENCE.commands)
        lines.push(
          `${c.categoryKey === undefined ? c.category : (nls[c.categoryKey] ?? c.category)}: ${c.nameKey === undefined ? c.name : (nls[c.nameKey] ?? c.name)} (${c.id}): ${referenceText(c.text, REFERENCE, nls, UI_TEXT)}`,
          ...(c.enablement === undefined ? [] : [c.enablement]),
        )
      lines.push('', UI_TEXT.referenceSettings)
      for (const s of REFERENCE.settings)
        lines.push(
          `${s.id}: ${s.text === undefined ? (s.descriptionKey === undefined ? s.description : (nls[s.descriptionKey] ?? s.description)) : referenceText(s.text, REFERENCE, nls, UI_TEXT)}`,
          `${UI_TEXT.referenceDefault}: ${configurationValue(s.default)}; ${JSON.stringify(s.type)}; ${s.scope}`,
          JSON.stringify(referenceSchema(s.schema, nls)),
          ...s.refinements,
          ...(s.enum?.map(
            (v, i) =>
              `${configurationValue(v)}: ${(s.enumDescriptionKeys?.[i] === undefined || s.enumDescriptionKeys[i] === null ? undefined : nls[s.enumDescriptionKeys[i]]) ?? s.enumDescriptions?.[i] ?? ''}`,
          ) ?? []),
        )
      lines.push('', UI_TEXT.referenceShortcuts)
      for (const k of REFERENCE.shortcuts)
        lines.push(
          `${k.command}: ${k.key}${k.mac === undefined ? '' : `; macOS: ${k.mac}`}${k.win === undefined ? '' : `; Windows: ${k.win}`}${k.linux === undefined ? '' : `; Linux: ${k.linux}`}${k.when === undefined ? '' : `; ${k.when}`}`,
        )
      for (const k of REFERENCE.shortcuts)
        if (k.text !== undefined) lines.push(referenceText(k.text, REFERENCE, nls, UI_TEXT))
      lines.push('', 'ACP / CLI')
      for (const c of REFERENCE.cli)
        lines.push(
          `${c.name}: ${c.usageKey !== undefined && c.usageLine !== undefined ? (fill(UI_TEXT[c.usageKey], { command: REFERENCE.executable }).split('\n')[c.usageLine] ?? c.description) : fill(c.text === undefined ? c.description : referenceText(c.text, REFERENCE, nls, UI_TEXT), { command: REFERENCE.executable })}${c.contract === undefined ? '' : ` ${JSON.stringify(c.contract)}`}`,
        )
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
      try {
        const nls = z.record(z.string(), z.string()).parse(await host.readNls())
        const values: Record<string, string> = {}
        for (const setting of REFERENCE.settings) {
          // A sensitive setting is never read, even to detect host support.
          if (setting.id === 'museSpark.environmentVariables') continue
          const value = host.currentValue(setting.id)
          if (value !== undefined) values[setting.id] = configurationValue(value)
        }
        if (Object.keys(values).length > 0)
          values['museSpark.environmentVariables'] = UI_TEXT.referenceHidden
        host.post({ type: 'referenceValues', model: JSON.stringify(REFERENCE), values, nls })
      } catch {
        host.post({ type: 'referenceValues', model: '', values: {}, nls: {}, error: true })
      }
    },
  }
}
