// M111 lane OB: the Electron main and renderer processes export
// OTLP/HTTP JSON to the local loopback receiver, each under its service
// name; a non-loopback base URL is refused.
import { describe, expect, it } from 'vitest'
import {
  electronMainOtelOptions,
  electronRendererOtelOptions,
  o11yReceiverBaseUrl,
} from '../../../src/core/o11y/electron'

describe('Electron OTel wiring', () => {
  it('points both processes at the local receiver with their service names', () => {
    expect(o11yReceiverBaseUrl()).toBe('http://127.0.0.1:4318')
    expect(electronMainOtelOptions()).toEqual({
      serviceName: 'app-main',
      tracesUrl: 'http://127.0.0.1:4318/v1/traces',
      metricsUrl: 'http://127.0.0.1:4318/v1/metrics',
      logsUrl: 'http://127.0.0.1:4318/v1/logs',
      protocol: 'http-json',
    })
    expect(electronRendererOtelOptions().serviceName).toBe('app-renderer')
  })

  it('refuses a non-loopback base URL and a malformed one', () => {
    expect(() => electronMainOtelOptions('https://collector:4318')).toThrow(RangeError)
    expect(() => electronMainOtelOptions('not a url')).toThrow(RangeError)
  })
})
