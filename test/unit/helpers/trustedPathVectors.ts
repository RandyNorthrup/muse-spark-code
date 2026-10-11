import * as z from 'zod/mini'

const componentSchema = z.strictObject({
  owner: z.enum(['root', 'user', 'foreign']),
  mode: z.int(),
  group: z.optional(
    z.enum([
      'private',
      'shared',
      'unknown',
      'wrongGid',
      'listed',
      'nameMismatch',
      'groupUnusable',
      'passwdUnusable',
      'passwdEmpty',
      'passwdMalformed',
      'userMissing',
      'userMismatch',
      'identityUnusable',
    ]),
  ),
  sticky: z.boolean(),
  directory: z.boolean(),
  symlink: z.boolean(),
  acl: z.boolean(),
  writableForeign: z.boolean(),
})
export const ancestryVectorsSchema = z.array(
  z.strictObject({
    name: z.string(),
    components: z.array(componentSchema),
    posix: z.boolean(),
    windows: z.boolean(),
  }),
)
