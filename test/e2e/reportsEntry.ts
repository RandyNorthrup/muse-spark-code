// Test-only integration binding for the unmerged S/K/H lanes; never shipped.
import {
  createRuntimeReports as create,
  type RuntimeReportsInput,
} from '../../src/runtime/reporting/reportsEntry'
import { finalizeReport, verifyReport } from '../../src/core/reporting/render/canonical'

export function createRuntimeReports(input: RuntimeReportsInput) {
  return create({
    ...input,
    servicesFor: async (cwd) => {
      const value = await input.readSaved(cwd, 'fixture.json')
      const fixture = verifyReport(value)
      return {
        keepHistory: false,
        services: {
          generate: (options) =>
            Promise.resolve(
              options.scope === 'M999'
                ? { status: 'notFound' as const, id: 'M999', nearest: ['M113'] }
                : {
                    status: 'generated' as const,
                    document: finalizeReport({
                      ...fixture,
                      header: {
                        ...fixture.header,
                        kind: options.kind,
                        scope: options.scope,
                        asOf: options.asOf,
                      },
                    }),
                  },
            ),
          conditions: () => [],
        },
      }
    },
  })
}
