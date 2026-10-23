// What the node can build with (M110t TA/TP2, PLAN.md D90.27):
// toolchains.json, the capability file the pack manager writes on every
// install, update and removal, and the `toolchains` tool reads. Packs
// present with their gate commands; no packs means no file, and requests
// stay byte-identical. Pure.
import * as z from 'zod/mini'

export const TOOLCHAINS_VERSION = 1

/** The file's name beside the pack store. */
export const TOOLCHAINS_FILE = 'toolchains.json'

/** One installed pack's capability: its tools, gates and languages. */
export const toolchainPackSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: z.string().check(z.minLength(1)),
  languages: z.array(z.string().check(z.minLength(1))),
  tools: z.array(
    z.strictObject({
      name: z.string().check(z.minLength(1)),
      version: z.string().check(z.minLength(1)),
    }),
  ),
  checks: z.array(
    z.strictObject({
      name: z.string().check(z.minLength(1)),
      command: z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
    }),
  ),
})
export type ToolchainPack = z.infer<typeof toolchainPackSchema>

/** toolchains.json: the installed packs' capabilities, versioned. */
export const toolchainsSchema = z.strictObject({
  version: z.literal(TOOLCHAINS_VERSION),
  packs: z.array(toolchainPackSchema),
  updatedAt: z.string(),
})
export type ToolchainsFile = z.infer<typeof toolchainsSchema>
