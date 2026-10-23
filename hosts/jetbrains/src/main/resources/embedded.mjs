const areEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length
const clone = (value) => structuredClone(value)
// These are the complete patterns in the frozen panel/state contract. Never
// compile schema-provided source: a future pattern needs review and a literal.
const schemaPatterns = new Map(
  [
    /^[\w-][\w.-]*$/u,
    /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))$/u,
    /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/u,
    /^[^\s\-\p{Cc}][^\s\p{Cc}]*$/u,
    /^(?!meta$)[a-z][a-z0-9-]{0,31}$/u,
    /^[a-f0-9]{64}$/u,
    /^[a-z][a-z0-9-]{0,31}$/u,
  ].map((pattern) => [pattern.source, pattern]),
)
// This compatibility boundary uses JSON wire semantics, including omitted undefined fields.
const serializeForWire = (value) => {
  const encoded = JSON.stringify(value)
  return JSON.parse(encoded)
}
const matchesAt = (schema, value, root) => {
  if (typeof schema === 'boolean') return schema
  if (schema.$ref) {
    let target = root
    if (schema.$ref !== '#') {
      for (const key of schema.$ref.slice(2).split('/'))
        target = target[key.replaceAll('~1', '/').replaceAll('~0', '~')]
    }
    if (!matchesAt(target, value, root)) return false
  }
  if ('const' in schema && !areEqual(schema.const, value)) return false
  if (schema.enum && schema.enum.every((item) => !areEqual(item, value))) return false
  if (schema.anyOf && schema.anyOf.every((item) => !matchesAt(item, value, root))) return false
  if (schema.oneOf && schema.oneOf.filter((item) => matchesAt(item, value, root)).length !== 1)
    return false
  let type = typeof value
  if (value === null) type = 'null'
  else if (Array.isArray(value)) type = 'array'
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (
    schema.type &&
    types.every((declared) =>
      declared === 'integer' ? !Number.isSafeInteger(value) : declared !== type,
    )
  )
    return false
  if (
    type === 'number' &&
    (!Number.isFinite(value) ||
      ('minimum' in schema && value < schema.minimum) ||
      ('maximum' in schema && value > schema.maximum) ||
      ('exclusiveMinimum' in schema && value <= schema.exclusiveMinimum) ||
      ('exclusiveMaximum' in schema && value >= schema.exclusiveMaximum))
  )
    return false
  switch (type) {
    case 'string': {
      if (schema.minLength !== undefined && value.length < schema.minLength) return false
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return false
      if (schema.pattern !== undefined) {
        const pattern = schemaPatterns.get(schema.pattern)
        if (pattern === undefined) throw new Error('MHP_SCHEMA_UNSUPPORTED')
        if (!pattern.test(value)) return false
      }
      if (schema.format === 'uri') {
        try {
          new URL(value)
        } catch {
          return false
        }
      }

      break
    }
    case 'object': {
      const prototype = Object.getPrototypeOf(value)
      if (
        prototype !== null &&
        (!Object.hasOwn(prototype, 'constructor') || prototype.constructor.name !== 'Object')
      )
        return false
      if (schema.required?.some((key) => !Object.hasOwn(value, key))) return false
      for (const [key, item] of Object.entries(value)) {
        if (schema.propertyNames && !matchesAt(schema.propertyNames, key, root)) return false
        const child = schema.properties?.[key] ?? schema.additionalProperties
        if (child !== undefined && !matchesAt(child, item, root)) return false
      }

      break
    }
    case 'array': {
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return false
      if (schema.minItems !== undefined && value.length < schema.minItems) return false
      if (
        schema.uniqueItems &&
        new Set(value.map((item) => JSON.stringify(item))).size !== value.length
      )
        return false
      if (schema.contains && value.every((item) => !matchesAt(schema.contains, item, root)))
        return false
      if (schema.items && value.some((item) => !matchesAt(schema.items, item, root))) return false

      break
    }
    // No default
  }
  return true
}
const matches = (schema, value) => matchesAt(schema, value, schema)

/* The JCEF carrier; the shared React bundle uses window.museHost. */
/* global TextEncoder, MessageEvent, structuredClone */
Object.defineProperty(globalThis, 'installMuseHost', {
  value: function installMuseHost(config, query) {
    const listeners = new Set()
    let isSubscribed = false
    let saved = config.state
    let pendingMessages = 0
    let pendingBytes = 0
    const dispatch = (operation, value) => {
      const request = JSON.stringify({ operation, value })
      const size = new TextEncoder().encode(request).length
      if (size > config.limits.maximumEnvelopeBytes) throw new Error('MHP_PANEL_TOO_LARGE')
      if (
        pendingMessages >= config.limits.maximumQueuedMessages ||
        pendingBytes + size > config.limits.maximumQueuedBytes
      )
        throw new Error('MHP_PANEL_BACKPRESSURE')
      pendingMessages++
      pendingBytes += size
      const release = () => {
        pendingMessages--
        pendingBytes -= size
      }
      try {
        query(request, release, release)
      } catch (error) {
        release()
        throw error
      }
    }
    const api = Object.freeze({
      postMessage(payload) {
        if (!isSubscribed) throw new Error('MHP_PANEL_NOT_READY')
        if (bytes(payload) > config.limits.maximumEnvelopeBytes)
          throw new Error('MHP_PANEL_TOO_LARGE')
        if (!matches(config.toHost, payload)) throw new Error('MHP_PANEL_INVALID_PAYLOAD')
        dispatch('post', payload)
      },
      onMessage(listener) {
        if (typeof listener !== 'function') throw new TypeError('MHP_PANEL_INVALID_PAYLOAD')
        listeners.add(listener)
        if (!isSubscribed) {
          dispatch('ready', null)
          isSubscribed = true
        }
        return () => listeners.delete(listener)
      },
      getState() {
        return saved === undefined ? undefined : clone(saved)
      },
      setState(state) {
        if (bytes(state) > config.limits.maximumEnvelopeBytes)
          throw new Error('MHP_PANEL_TOO_LARGE')
        if (!matches(config.stateSchema, state)) throw new Error('MHP_PANEL_INVALID_PAYLOAD')
        dispatch('state', state)
        saved = clone(state)
      },
    })
    Object.defineProperties(globalThis, {
      __museTheme: {
        value(css, isDark) {
          const doc = globalThis.document
          let style = doc.querySelector('#muse-theme')
          if (!style) {
            style = doc.createElement('style')
            style.id = 'muse-theme'
            style.nonce = config.nonce
            doc.head.append(style)
          }
          style.textContent = css
          const applyKind = () => {
            doc.body.classList.toggle('vscode-dark', isDark)
            doc.body.classList.toggle('vscode-light', !isDark)
          }
          if (doc.body) applyKind()
          else doc.addEventListener('DOMContentLoaded', applyKind, { once: true })
        },
      },
      museHost: { value: api, configurable: false, writable: false },
      __museReceive: {
        value(payload, sequence) {
          if (!matches(config.toPanel, payload)) throw new Error('MHP_PANEL_INVALID_PAYLOAD')
          try {
            for (const listener of listeners) listener(clone(payload))
          } finally {
            dispatch('delivered', sequence)
          }
        },
      },
    })
    if (config.themeCss) globalThis.__museTheme(config.themeCss, config.dark)
    // A real compatibility adapter for the pre-lane-D panel bundle.
    Object.defineProperty(globalThis, 'acquireVsCodeApi', {
      value: () => {
        api.onMessage((data) => globalThis.dispatchEvent(new MessageEvent('message', { data })))
        return {
          postMessage: (value) => api.postMessage(serializeForWire(value)),
          getState: api.getState,
          setState: (value) => api.setState(serializeForWire(value)),
        }
      },
    })
  },
})
