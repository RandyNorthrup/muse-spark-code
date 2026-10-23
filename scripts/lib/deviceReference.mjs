// Renders the Devices documentation inventory from real English keys and
// availability. Exported from lib (not the script) so `gen-reference.mjs`
// stays a side-effect-free-on-import CLI entry and satisfies the
// no-exports-in-scripts rule; both the script and the catalog test read it.
const cell = (text) => text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')

export function renderDeviceReference(catalog, table) {
  const ids = new Set()
  const entries = catalog.map((feature) => {
    const title = table.devices[feature.titleKey]
    const detail = table.devices[feature.detailKey]
    if (
      typeof title !== 'string' ||
      typeof detail !== 'string' ||
      feature.availability !== 'unshipped' ||
      ids.has(feature.id)
    )
      throw new Error(`Invalid Devices catalog entry: ${feature.id}`)
    ids.add(feature.id)
    return `| ${cell(feature.id)} | ${cell(title)} | Unshipped | ${cell(detail)} |`
  })
  return [
    '# Devices feature reference',
    '',
    'Generated from `src/shared/featureCatalog.ts` and the English table.',
    '',
    'This is an implementation inventory, not an installed command list. Devices',
    'has no registered product command or setting on this integration base.',
    'QR and mDNS have no qualified runtime binding. No board, Git-result or',
    'physical-device support is claimed. All editors share the method port;',
    'remote and headless receivers remain unqualified.',
    '',
    '| Id | Feature | Availability | Contract |',
    '| --- | --- | --- | --- |',
    ...entries,
    '',
  ].join('\n')
}
