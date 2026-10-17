// Meta entries a runtime providers file must refuse (CM108ACC): shared by the
// account service and runtime services suites.
const META = { policyProvider: 'meta', product: 'model-api', auth: 'apiKey' } as const

/** Two accounts under one id. */
export function duplicateAccountsEntry(origin: string) {
  return {
    id: 'meta',
    ...META,
    origin,
    accounts: [
      { id: 'default', label: 'Default', order: 0, thresholds: {} },
      { id: 'default', label: 'Copy', order: 1, thresholds: {} },
    ],
  }
}

/** An entry whose id is not the key it stands under. */
export function mismatchedIdEntry(origin: string) {
  return { id: 'other', ...META, origin }
}

/** A providers file holding one entry under the `meta` key. */
export function providersFileOf(entry: object): string {
  return JSON.stringify({ providers: { meta: entry } })
}
