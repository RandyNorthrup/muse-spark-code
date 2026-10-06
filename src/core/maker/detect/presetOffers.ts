// M103 D: Node-free event contract for the panel, ACP, companion and native surfaces.
import * as z from 'zod/mini'
import {
  CHECK_COMMAND_MAX_CHARS,
  CHECK_NAME_MAX_CHARS,
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_FILES,
  MAKER_PRESETS_MAX,
  MAKER_PROJECT_KINDS,
} from '../../../shared/constants'
import { checkCommandSchema, isSafeCheckPath } from '../../verify/checkCommands'

const kindSchema = z.enum(MAKER_PROJECT_KINDS)
const labelSchema = z.string().check(z.minLength(1), z.maxLength(CHECK_NAME_MAX_CHARS))
const idSchema = z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS))
export const relativePathSchema = z.string().check(
  z.minLength(1),
  z.maxLength(CHECK_COMMAND_MAX_CHARS),
  z.refine(
    (name) =>
      !/^(?:\/|[a-z]:)/i.test(name) &&
      !name.includes('\\') &&
      !name.split('/').includes('..') &&
      isSafeCheckPath(name, 'linux'),
  ),
)

export const presetSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('command'),
    id: idSchema,
    kind: kindSchema,
    check: z.strictObject(checkCommandSchema.shape),
    cloud: z.boolean(),
  }),
  // The analyser is offline and a portable engine operation, not a guessed CLI command.
  z.strictObject({
    type: z.literal('gcode'),
    id: idSchema,
    kind: z.literal('gcode'),
    name: labelSchema,
    path: relativePathSchema,
  }),
])

/** Lane I may compose this strict event into the full makerProtocol union. */
export const presetsOfferedSchema = z.strictObject({
  type: z.literal('presetsOffered'),
  title: z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)),
  kinds: z.array(kindSchema).check(z.maxLength(MAKER_PROJECT_KINDS.length)),
  skillIds: z
    .array(z.string().check(z.maxLength(CHECK_NAME_MAX_CHARS), z.regex(/^maker_[a-z0-9_]+$/)))
    .check(z.maxLength(MAKER_DETECT_MAX_FILES)),
  presets: z.array(presetSchema).check(z.maxLength(MAKER_PRESETS_MAX)),
  notices: z
    .array(z.string().check(z.minLength(1), z.maxLength(CHECK_COMMAND_MAX_CHARS)))
    .check(z.maxLength(MAKER_PROJECT_KINDS.length)),
  isCircuitPyRoot: z.boolean(),
  hasMachineConfig: z.boolean(),
  pi: z.optional(
    z.strictObject({
      model: z.string().check(z.minLength(1), z.maxLength(MAKER_DETECT_MAX_BYTES)),
      temperatureCelsius: z.optional(z.number()),
      throttled: z.optional(z.int().check(z.gte(0))),
    }),
  ),
})
export type MakerPresetsOffered = z.infer<typeof presetsOfferedSchema>
export type MakerCheckPreset = MakerPresetsOffered['presets'][number]
