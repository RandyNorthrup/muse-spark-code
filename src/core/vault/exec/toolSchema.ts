// Generated from the validators with zod/mini.toJSONSchema; vaultExec.test.ts guards drift.
// Static descriptors keep conversion out of shipped Node bundles (PLAN D6).
import { VAULT_LIMITS } from '../../../shared/constants'
const secrets: Record<string, unknown> = {
  type: 'object',
  properties: {
    env: {
      type: 'object',
      propertyNames: {
        type: 'string',
        pattern: '^[A-Za-z_][A-Za-z0-9_]*$',
      },
      additionalProperties: {
        type: 'string',
        pattern: String.raw`^secret:\/\/[a-z][a-z0-9-]{0,47}$`,
      },
    },
    stdin: {
      type: 'string',
      pattern: String.raw`^secret:\/\/[a-z][a-z0-9-]{0,47}$`,
    },
    totp: {
      type: 'string',
      pattern: String.raw`^secret:\/\/[a-z][a-z0-9-]{0,47}$`,
    },
    git: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          pattern: String.raw`^secret:\/\/[a-z][a-z0-9-]{0,47}$`,
        },
        protocol: {
          type: 'string',
          const: 'https',
        },
        host: {
          type: 'string',
          minLength: 1,
          maxLength: VAULT_LIMITS.text,
          pattern: String.raw`^[^\0\r\n]*$`,
        },
        path: {
          type: 'string',
          minLength: 1,
          maxLength: VAULT_LIMITS.text,
          pattern: String.raw`^[^\0\r\n]*$`,
        },
      },
      required: ['handle', 'protocol', 'host', 'path'],
      additionalProperties: false,
    },
    sudo: {
      type: 'object',
      properties: {
        handle: {
          type: 'string',
          pattern: String.raw`^secret:\/\/[a-z][a-z0-9-]{0,47}$`,
        },
        path: {
          type: 'string',
          minLength: 1,
          maxLength: VAULT_LIMITS.text,
          pattern: String.raw`^[^\0\r\n]*$`,
        },
        askpass: {
          type: 'boolean',
        },
      },
      required: ['handle', 'path'],
      additionalProperties: false,
    },
    ssh: {
      type: 'boolean',
      const: true,
    },
  },
  additionalProperties: false,
}
export const VAULT_EXEC_PARAMETERS: Readonly<
  Record<'list' | 'request' | 'run' | 'secrets', Record<string, unknown>>
> = {
  list: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  request: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      name: {
        type: 'string',
        maxLength: VAULT_LIMITS.name,
        pattern: '^[a-z][a-z0-9-]{0,47}$',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  run: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      command: {
        type: 'object',
        properties: {
          executable: {
            type: 'string',
            minLength: 1,
            maxLength: VAULT_LIMITS.text,
            pattern: String.raw`^[^\0\r\n]*$`,
          },
          argv: {
            maxItems: VAULT_LIMITS.argv,
            type: 'array',
            items: {
              type: 'string',
              maxLength: VAULT_LIMITS.text,
              pattern: String.raw`^[^\0]*$`,
            },
          },
          cwd: {
            type: 'string',
            minLength: 1,
            maxLength: VAULT_LIMITS.text,
            pattern: String.raw`^[^\0\r\n]*$`,
          },
        },
        required: ['executable', 'argv', 'cwd'],
        additionalProperties: false,
      },
      secrets: secrets,
    },
    required: ['command', 'secrets'],
    additionalProperties: false,
  },
  secrets: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...secrets },
}
