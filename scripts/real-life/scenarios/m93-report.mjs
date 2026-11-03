// M93: the packed agent writes a problem report about itself.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/packaging/moduleExports.test.mjs, `production module exports >
//   resolves the report-problem handler through the packaged bundles`
//   (the handler runs from the packed bundles; the dialog rows stay manual)
//
// Expected model attempts: 0. Dollar cap: $0.00.
const REPORT = 'real-life-report.md'

export default {
  title: 'report writes the description to a file',
  exec: {
    claims: ['ref/cli/report/report', 'ref/feature/problem-report'],
    requests: 0,
    maxUsd: '0.00',
    async run(person, see) {
      const marker = person.marker()
      const written = await person.command([
        'report',
        '--out',
        REPORT,
        '--description',
        `Real-life probe ${marker}`,
      ])
      see(
        'report --out ends with exit code 0',
        written.code === 0,
        `exit ${String(written.code)}: ${`${written.stdout} ${written.stderr}`.trim()}`,
      )
      const file = person.file(REPORT)
      see('the report is on disk', file !== undefined, file ?? 'no such file')
      see(
        'the report carries the description',
        file?.includes(marker) === true,
        file === undefined ? 'no such file' : 'description present',
      )
      const bare = await person.command(['report'])
      see('a bare report ends with exit code 0', bare.code === 0, `exit ${String(bare.code)}`)
      see('a bare report prints text', bare.stdout.trim() !== '', bare.stdout.trim())
    },
  },
}
