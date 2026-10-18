// RVCM971C: adversarial text in every slot of all pinned templates.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { licenseTemplateSet, readLicenseText } from '../../../src/core/legal/licenseTemplates'
import { PINNED_TEMPLATE_IDS, canonicalText } from './templates'
const LEGAL_DATA = path.join(__dirname, '../../../src/core/legal/legal-data')

/** RVCM971C: each language and every pinned variable, including closed slots. */
export const RESTRICTION_SENTENCES = [
  'Redistribution Is Limited To Members Of Example Corp.',
  'Paying Customers Get Access.',
  'ExampleNonprofit',
  'NoncommercialUse',
  'non_commercial',
  'Example_Nonprofit',
  'Nur Für Den Privaten Gebrauch.',
  'Usage Commercial Uniquement.',
  'Solo Para Clientes De Pago.',
  'Solo Per Uso Personale.',
  'Apenas Para Uso Não Comercial.',
  'Коммерческое Использование Запрещено.',
  'Pouze Pro Soukromé Použití.',
  'Csak Magáncélú Használatra.',
  'Tylko Do Użytku Prywatnego.',
  'Yalnızca Özel Kullanım İçin.',
  '仅限非商业用途。',
  '僅限非商業用途。',
  '教育目的に限定する。',
  '개인 용도로만 사용 가능합니다.',
]
const SLOT_CASES = PINNED_TEMPLATE_IDS.flatMap((id) => {
  const source = readFileSync(path.join(LEGAL_DATA, 'templates', `${id}.template.txt`), 'utf8')
  return Array.from(source.matchAll(/<<var;name="([\s\S]*?)";/gu), (match, index) => ({
    id,
    index,
    name: match[1] ?? '',
  }))
})

/** Register one of three disjoint whole-file partitions; no cases are omitted. */
export function defineSlotPartition(partition: number): void {
  describe('all pinned slots reject multilingual restrictions', () => {
    const slots = SLOT_CASES.filter(
      (slot) => PINNED_TEMPLATE_IDS.indexOf(slot.id) % 3 === partition,
    )
    it.each(
      slots.flatMap((slot) => RESTRICTION_SENTENCES.map((sentence) => ({ ...slot, sentence }))),
    )('rejects $sentence in $id slot $index ($name)', ({ id, index, name, sentence }) => {
      const set = licenseTemplateSet()
      const own = { ...set, templates: set.templates.filter((template) => template.id === id) }
      const words = sentence.replace(/[.。]$/u, '').split(/\s+/u)
      const forms = [
        sentence,
        words.join('_'),
        words.join('-'),
        words.map((word, at) => (at === 0 ? word.toLowerCase() : word)).join(''),
      ]
      const uniqueForms = new Set(forms)
      for (const value of uniqueForms) {
        const reading = readLicenseText(
          canonicalText(id, true, {
            index,
            value: name === 'copyright' ? `Copyright (c) 2026 ${value}` : value,
          }),
          own,
        )
        expect(reading?.exact, `${id} slot ${String(index)}: ${value}`).not.toBe(true)
      }
    })
  })
}
