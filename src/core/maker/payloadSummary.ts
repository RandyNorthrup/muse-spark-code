import {
  MAKER_DIGEST_RADIX,
  MAKER_REVIEW_BATCH_MS,
  MAKER_REVIEW_ELF_ENTRY_OFFSET,
  MAKER_REVIEW_ELF_HEADER_BYTES,
  MAKER_REVIEW_ELF_CLASS_OFFSET,
  MAKER_REVIEW_ELF_ENDIAN_OFFSET,
  MAKER_REVIEW_BYTE_MAX,
  MAKER_REVIEW_SUMMARY_LINE_CHARS,
} from '../../shared/constants'
import type { ApprovalRequest, MakerMachineSummary } from '../../shared/makerProtocol'

export interface PayloadHighlight {
  readonly line: number
  readonly reason: 'temperature' | 'travel' | 'safety' | 'unknown'
  readonly detail: string
}
export interface PayloadSummary {
  readonly temperatures: Readonly<Partial<Record<'extruder' | 'bed' | 'chamber', number>>>
  readonly temperatureSettings: Readonly<Record<'extruder' | 'bed' | 'chamber', readonly number[]>>
  readonly fan: number | undefined
  readonly feed: number | undefined
  readonly seconds: number | undefined
  readonly entryPoint: string | undefined
  readonly bounds: Extract<ApprovalRequest, { kind: 'machine' }>['analysis']['bounds']
  readonly highlights: readonly PayloadHighlight[]
  readonly dangers: readonly PayloadHighlight['reason'][]
}

/** Supplement the host's authoritative analysis; never classify or admit a hardware action. */
export async function summarizePayload(
  bytes: Uint8Array,
  request: ApprovalRequest | undefined,
  limits: MakerMachineSummary['limits'] | undefined,
  signal: AbortSignal,
): Promise<PayloadSummary> {
  const text = new TextDecoder().decode(bytes)
  const temperatures: Partial<Record<'extruder' | 'bed' | 'chamber', number>> = {}
  const temperatureSettings = {
    extruder: new Set<number>(),
    bed: new Set<number>(),
    chamber: new Set<number>(),
  }
  const highlights: PayloadHighlight[] = []
  const dangers = new Set<PayloadHighlight['reason']>()
  const analysis = request?.kind === 'machine' ? request.analysis : undefined
  let fan: number | undefined
  let feed = analysis?.maxFeedMmMin
  let seconds: number | undefined
  let start = 0
  let line = 1
  const endings = /\r\n?|\n/g
  const heaters: Readonly<Record<string, 'extruder' | 'bed' | 'chamber'>> = {
    M104: 'extruder',
    M109: 'extruder',
    M140: 'bed',
    M190: 'bed',
    M141: 'chamber',
    M191: 'chamber',
  }
  let started = performance.now()
  const bounds = analysis?.bounds
  const isTravelUnsafe =
    bounds !== undefined &&
    (limits?.travel === undefined ||
      (['x', 'y', 'z'] as const).some(
        (axis) =>
          bounds.min[axis] < (limits.travel?.min[axis] ?? 0) ||
          bounds.max[axis] > (limits.travel?.max[axis] ?? 0),
      ))
  while (start < text.length) {
    signal.throwIfAborted()
    const ending = endings.exec(text)
    const end = ending?.index ?? text.length
    const raw = text.slice(start, end)
    const command = raw
      .slice(0, MAKER_REVIEW_SUMMARY_LINE_CHARS)
      .replaceAll(/\([^)]*\)|;.*$/g, '')
      .toUpperCase()
    const header = /^\s*(?:N\d+\s*)?([GMT]\d+|\$[^\s]*|[A-Z_][A-Z_0-9]*)/.exec(command)
    const rawHead = header?.[1] ?? ''
    const head = rawHead.replace(/^([GMT])0+(\d+)$/, '$1$2')
    const parameter = (letter: string) => {
      const value = new RegExp(String.raw`${letter}\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))`).exec(
        command,
      )?.[1]
      return value === undefined ? undefined : Number(value)
    }
    const highlight = (reason: PayloadHighlight['reason']) => {
      highlights.push({ line, reason, detail: head })
      dangers.add(reason)
    }
    const heater = heaters[head]
    const temperature = heater === undefined ? undefined : (parameter('S') ?? parameter('R'))
    const tail = command.slice(header?.[0].length ?? 0).replace(/\*\d+\s*$/, '')
    // Only complete, finite numeric words are understood. Prefixes of expressions
    // and duplicate temperature words must never stand in for their actual value.
    const hasLiteralWords = /^(?:\s*[A-Z]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+))*\s*$/.test(tail)
    const isLiteralTemperature =
      hasLiteralWords &&
      (tail.match(/[SR]/g)?.length ?? 0) === 1 &&
      temperature !== undefined &&
      Number.isFinite(temperature)
    if (heater !== undefined && !isLiteralTemperature) {
      highlight('temperature')
    } else if (heater !== undefined && temperature !== undefined) {
      temperatureSettings[heater].add(temperature)
      temperatures[heater] = Math.max(temperatures[heater] ?? 0, temperature)
      const maximum = heater === 'chamber' ? undefined : limits?.[heater]
      if (maximum === undefined || temperature > maximum) highlight('temperature')
    }
    if (head === 'M106') fan = Math.max(fan ?? 0, parameter('S') ?? MAKER_REVIEW_BYTE_MAX)
    if (head === 'M107' && fan === undefined) fan = 0
    if (/^G[0-3]$/.test(head)) {
      const commandedFeed = parameter('F')
      if (commandedFeed !== undefined) feed = Math.max(feed ?? 0, commandedFeed)
      if (isTravelUnsafe || bounds === undefined) highlight('travel')
    }
    if (
      // Command-wide acknowledgement avoids firmware boolean/parameter spelling gaps.
      /^(?:M(?:42|80|81|121|143|211|302|564|570)|SET_GCODE_OFFSET|SET_STEPPER_CARRIAGES|SET_KINEMATIC_POSITION|FORCE_MOVE|SET_VELOCITY_LIMIT|SET_PIN|SHUTDOWN_MACHINE)$/.test(
        head,
      ) ||
      /\$(?:20|21)\s*=\s*0\b/.test(command) ||
      /THERMAL_RUNAWAY|THERMAL_PROTECTION|VERIFY_HEATER/.test(command)
    )
      highlight('safety')
    // These firmware equivalents lack a portable heater-to-limit mapping; disclose the risk.
    if (/^(?:G10|M568|SET_HEATER_TEMPERATURE|TEMPERATURE_WAIT)$/.test(head))
      highlight('temperature')
    // A serial request has no analyser. An unrecognised command/macro can set
    // heaters or move a machine, so absence of host analysis cannot imply safety.
    const isUnderstood =
      hasLiteralWords &&
      /^(?:G[0-4]|G20|G21|G90|G91|M82|M83|M10[4-7]|M109|M11[459]|M140|M141|M190|M191|M400|M503|STATUS|HELP|GET_POSITION|QUERY_ENDSTOPS|\$\$|\$#|\$G|\$I|\$N)$/.test(
        head,
      )
    if (
      (request !== undefined && !isUnderstood && command.trim() !== '') ||
      analysis?.unknown.includes(head) ||
      analysis?.unknown.includes(rawHead) ||
      analysis?.refused.includes(head) ||
      analysis?.refused.includes(rawHead) ||
      /[GM]\d+[\s\S]*?[GM]\d+/.test(command) ||
      raw.length > MAKER_REVIEW_SUMMARY_LINE_CHARS
    )
      highlight('unknown')
    const estimate = /^\s*;\s*TIME:\s*(\d+(?:\.\d+)?)\s*$/i.exec(raw)?.[1]
    if (estimate !== undefined) seconds = Number(estimate)
    start = end + (ending?.[0].length ?? 0)
    line += 1
    if (!(performance.now() - started >= MAKER_REVIEW_BATCH_MS)) {
      continue
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    started = performance.now()
  }
  let entryPoint: string | undefined
  if (bytes.length >= MAKER_REVIEW_ELF_HEADER_BYTES && text.startsWith('\u{7F}ELF')) {
    // Read the ELF entry only when its class and endianness are explicit.
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (
      bytes[MAKER_REVIEW_ELF_CLASS_OFFSET] === 1 &&
      [1, 2].includes(bytes[MAKER_REVIEW_ELF_ENDIAN_OFFSET] ?? 0)
    )
      entryPoint = `0x${view.getUint32(MAKER_REVIEW_ELF_ENTRY_OFFSET, bytes[MAKER_REVIEW_ELF_ENDIAN_OFFSET] === 1).toString(MAKER_DIGEST_RADIX)}`
  }
  return {
    temperatures,
    temperatureSettings: {
      extruder: [...temperatureSettings.extruder],
      bed: [...temperatureSettings.bed],
      chamber: [...temperatureSettings.chamber],
    },
    fan,
    feed,
    seconds,
    entryPoint,
    bounds,
    highlights,
    dangers: [...dangers],
  }
}
