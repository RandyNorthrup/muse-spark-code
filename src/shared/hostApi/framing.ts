// A stateless NDJSON boundary, not the runtime stream/queue implementation.
import * as z from 'zod/mini'
import { MHP, MHP_PANEL } from '../constants'
import { type MhpRequestMethod } from './methods'
import {
  panelEnvelopeSchema,
  panelErrorSchema,
  panelInitializeResultSchema,
  panelLifecycleSchema,
} from './panel'
import { failureFrameSchema, parseMhpCall, parseMhpResult } from './protocol'

export function parseMhpStdioLine(
  line: string,
  context: {
    protocolVersion: string
    pendingMethod?: MhpRequestMethod
  },
) {
  if (context.protocolVersion !== MHP.version) throw new TypeError('MHP_INCOMPATIBLE_VERSION')
  const body = line.replace(/\r?\n$/u, '')
  if (new TextEncoder().encode(body).byteLength > MHP_PANEL.maximumEnvelopeBytes)
    throw new TypeError('MHP_PANEL_TOO_LARGE')
  if (body.includes('\n') || body.trim().length === 0) throw new TypeError('MHP_INVALID_REQUEST')
  const value: unknown = JSON.parse(body)
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('MHP_INVALID_REQUEST')
  if ('mhp' in value) {
    return z.union([panelEnvelopeSchema, panelLifecycleSchema, panelErrorSchema]).parse(value)
  }
  if ('method' in value) return parseMhpCall(value)
  if ('error' in value) return failureFrameSchema.parse(value)
  if (context.pendingMethod === undefined) throw new TypeError('MHP_UNCORRELATED_RESULT')
  return context.pendingMethod === 'initialize'
    ? panelInitializeResultSchema.parse(value)
    : parseMhpResult(context.pendingMethod, value)
}
