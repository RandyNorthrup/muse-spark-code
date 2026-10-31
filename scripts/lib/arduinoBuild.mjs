// M103-A: one product, two host floors. ACP keeps its own Node 22 target.
export function buildProfile(arduino) {
  return arduino
    ? { host: 'node20.14', browser: 'chrome124', vscode: '^1.96.0', node: '>=20.14.0' }
    : { host: 'node20.18', browser: 'chrome128' }
}

export function requireArduinoBuild(record) {
  const expected = buildProfile(true)
  if (
    record.production !== true ||
    Object.entries(expected).some(([key, value]) => record[key] !== value)
  ) {
    throw new Error(
      'An Arduino production build is required: node scripts/build.mjs --production --arduino',
    )
  }
}
