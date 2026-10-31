// M111 lane OB: the OTLP/HTTP JSON ingest parses the published wire
// shapes (opentelemetry-proto, Stable), scrubs what it keeps, and refuses
// the rest in fixed words. Payloads below follow that spec's field names
// and 64-bit-as-string JSON mapping; the redactor is the real one.
import { describe, expect, it } from 'vitest'
import { NANOSECONDS_PER_MILLISECOND, REDACTED_MARK } from '../../../src/shared/constants'
import { ingestOtlpLogs, ingestOtlpMetrics, ingestOtlpTraces } from '../../../src/core/o11y/signals'

const NANOS = '1761864000000000000'
const MS = 1_761_864_000_000

function resource(component: string): unknown {
  return { attributes: [{ key: 'service.name', value: { stringValue: component } }] }
}

function wrapMetrics(res: unknown, met: unknown): unknown {
  return { resourceMetrics: [{ resource: res, scopeMetrics: [{ metrics: [met] }] }] }
}

function wrapLogRecord(traceId: string, spanId: string): unknown {
  return {
    resourceLogs: [
      {
        resource: resource('app-main'),
        scopeLogs: [{ logRecords: [{ timeUnixNano: NANOS, body: {}, traceId, spanId }] }],
      },
    ],
  }
}

describe('OTLP metrics ingest', () => {
  it('parses gauge points with their component, name and value', () => {
    const body = {
      resourceMetrics: [
        {
          resource: resource('compositor'),
          scopeMetrics: [
            {
              scope: { name: 'muse-compositor' },
              metrics: [
                {
                  name: 'hyprland.ipc.latency',
                  unit: 'ms',
                  gauge: {
                    dataPoints: [
                      {
                        timeUnixNano: NANOS,
                        asDouble: 12.5,
                        attributes: [{ key: 'monitor', value: { stringValue: 'DP-1' } }],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const parsed = ingestOtlpMetrics(body)
    expect(parsed).toEqual({
      ok: true,
      records: [
        {
          at: MS,
          component: 'compositor',
          name: 'hyprland.ipc.latency',
          value: 12.5,
          unit: 'ms',
          attributes: [{ key: 'monitor', value: 'DP-1' }],
        },
      ],
    })
  })

  it('parses sums with integer values and drops unknown SDK fields', () => {
    const body = {
      resourceMetrics: [
        {
          resource: resource('node'),
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'muse.node.requests',
                  aggregationTemporality: 2,
                  sum: {
                    dataPoints: [
                      {
                        timeUnixNano: 1500 * NANOSECONDS_PER_MILLISECOND,
                        asInt: '42',
                        flags: 1,
                        droppedAttributesCount: 3,
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    }
    const parsed = ingestOtlpMetrics(body)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0]).toMatchObject({ component: 'node', value: 42 })
  })

  it('refuses an unknown component, a bad name and a bad time in fixed words', () => {
    const point = { timeUnixNano: NANOS, asDouble: 1 }
    const metric = { name: 'ok.metric', gauge: { dataPoints: [point] } }
    expect(ingestOtlpMetrics(wrapMetrics(resource('some-daemon'), metric))).toEqual({
      ok: false,
      reason: 'unknownComponent',
    })
    expect(
      ingestOtlpMetrics(wrapMetrics(resource('node'), { ...metric, name: 'has spaces in it' })),
    ).toEqual({ ok: false, reason: 'badName' })
    expect(
      ingestOtlpMetrics(
        wrapMetrics(resource('node'), {
          name: 'ok.metric',
          gauge: { dataPoints: [{ ...point, timeUnixNano: 'not-a-time' }] },
        }),
      ),
    ).toEqual({ ok: false, reason: 'badTime' })
    expect(ingestOtlpMetrics({ hello: 'world' })).toEqual({ ok: false, reason: 'notOtlp' })
  })
})

describe('OTLP logs ingest', () => {
  it('parses log records and redacts secret-shaped message text', () => {
    const body = {
      resourceLogs: [
        {
          resource: resource('sysd'),
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: NANOS,
                  severityNumber: 17,
                  body: { stringValue: 'wifi connected sk-xxxxxxxxxxxxxxxxxxxxxxxx' },
                },
              ],
            },
          ],
        },
      ],
    }
    const parsed = ingestOtlpLogs(body)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.records).toHaveLength(1)
    const record = parsed.records[0]
    expect(record).toMatchObject({ at: MS, component: 'sysd', severity: 17 })
    expect(record?.message).toContain(REDACTED_MARK)
    expect(record?.message).not.toContain('sk-')
  })

  it('keeps trace links only when both ids are well formed', () => {
    const good = ingestOtlpLogs(wrapLogRecord('a'.repeat(32), 'b'.repeat(16)))
    expect(good.ok).toBe(true)
    expect(ingestOtlpLogs(wrapLogRecord('short', 'b'.repeat(16)))).toEqual({
      ok: false,
      reason: 'badId',
    })
  })
})

describe('OTLP traces ingest', () => {
  it('parses spans with their timing and error status', () => {
    const body = {
      resourceSpans: [
        {
          resource: resource('app-renderer'),
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'a'.repeat(32),
                  spanId: 'b'.repeat(16),
                  name: 'workbench.render',
                  startTimeUnixNano: NANOS,
                  endTimeUnixNano: '1761864001000000000',
                  status: { code: 2 },
                },
              ],
            },
          ],
        },
      ],
    }
    const parsed = ingestOtlpTraces(body)
    expect(parsed).toEqual({
      ok: true,
      records: [
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          component: 'app-renderer',
          name: 'workbench.render',
          startMs: MS,
          endMs: MS + 1000,
          error: true,
          attributes: [],
        },
      ],
    })
  })

  it('refuses a span that ends before it starts', () => {
    const body = {
      resourceSpans: [
        {
          resource: resource('node'),
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'a'.repeat(32),
                  spanId: 'b'.repeat(16),
                  name: 'x',
                  startTimeUnixNano: '1761864001000000000',
                  endTimeUnixNano: NANOS,
                },
              ],
            },
          ],
        },
      ],
    }
    expect(ingestOtlpTraces(body)).toEqual({ ok: false, reason: 'badTime' })
  })
})
