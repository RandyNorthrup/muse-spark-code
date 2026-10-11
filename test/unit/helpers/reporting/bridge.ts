import { reportsMethods, type ReportsHostPort } from '../../../../src/shared/hostApi/reports'

/** Fake native/browser transport: frozen payloads only, with no invented MHP envelope. */
export function reportsBridge(port: ReportsHostPort) {
  return async (method: keyof typeof reportsMethods, encoded: string): Promise<unknown> => {
    const input: unknown = JSON.parse(encoded)
    let result: unknown
    switch (method) {
      case 'reports/run': {
        result = await port.run(reportsMethods[method].params.parse(input))
        break
      }
      case 'reports/history': {
        result = await port.history(reportsMethods[method].params.parse(input))
        break
      }
      case 'reports/get': {
        result = await port.get(reportsMethods[method].params.parse(input))
        break
      }
      case 'reports/compare': {
        result = await port.compare(reportsMethods[method].params.parse(input))
        break
      }
      case 'reports/open': {
        result = await port.open(reportsMethods[method].params.parse(input))
        break
      }
    }
    const encodedResult = JSON.stringify(result)
    const wire: unknown = JSON.parse(encodedResult)
    return reportsMethods[method].result.parse(wire)
  }
}
