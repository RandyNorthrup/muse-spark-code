// Loaded only for /help, in every shared-webview host. Host-specific settings
// navigation and command execution stay behind the validated bridge.
import type * as ReactLibrary from 'react'
import type { UiText } from '../../shared/l10n/en'
import type { fill as fillTemplate, formatNumber as numberFormatter } from '../../shared/l10n/text'
import type { SettingsSnapshot, WebviewToHostMessage } from '../../shared/protocol'
import { parseReferenceModel } from '../../shared/reference/reference.generated'
import { referenceName, referenceText, referenceSchema } from '../../shared/reference/text'
import type { Modal as ModalComponent } from './Modal'
import './reference.css'

interface ReferencePageProps {
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly values:
    | {
        readonly model: string
        readonly error?: boolean | undefined
        readonly values: Readonly<Record<string, string>>
        readonly nls: Readonly<Record<string, string>>
      }
    | undefined
  readonly settings: SettingsSnapshot
  readonly onClose: () => void
}

interface ReferencePageRuntime {
  readonly react: Pick<
    typeof ReactLibrary,
    'createElement' | 'Fragment' | 'useEffect' | 'useMemo' | 'useState'
  >
  readonly text: UiText
  readonly fill: typeof fillTemplate
  readonly formatNumber: typeof numberFormatter
  readonly Modal: typeof ModalComponent
}

// The independent lazy ESM entry shares the caller's React and installed
// language. It carries neither a second React nor an English fallback.
export function createReferencePage(runtime: ReferencePageRuntime) {
  const { react: React, text: UI_TEXT, fill, formatNumber, Modal } = runtime
  const { useState, useEffect, useMemo } = React
  /** Values are configuration syntax. Numbers use the installed locale. */
  function valueText(value: unknown): string {
    if (value === undefined) return '—'
    return typeof value === 'number' ? formatNumber(value) : JSON.stringify(value)
  }

  return function ReferencePage({ postMessage, values, settings, onClose }: ReferencePageProps) {
    const [requestedFrom, setRequestedFrom] = useState<typeof values>()
    const isRetrying = requestedFrom !== undefined && requestedFrom === values
    const [query, setQuery] = useState('')
    useEffect(() => {
      postMessage({ type: 'readReference' })
    }, [postMessage, settings])
    const modelText = values?.model
    const model = useMemo(() => {
      if (modelText === undefined || values?.error) return
      try {
        return parseReferenceModel(JSON.parse(modelText))
      } catch {
        return
      }
    }, [modelText, values?.error])
    if (model === undefined)
      return (
        <Modal
          title={UI_TEXT.helpReferenceTitle}
          titleId="reference-title"
          isWide
          onClose={onClose}
        >
          {values === undefined || isRetrying ? (
            <p role="status">{UI_TEXT.loadingOutput}</p>
          ) : (
            <>
              <p role="alert">{UI_TEXT.actionFailed}</p>
              <button
                type="button"
                onClick={() => {
                  setRequestedFrom(values)
                  postMessage({ type: 'readReference' })
                }}
              >
                {UI_TEXT.retryAction}
              </button>
            </>
          )}
        </Modal>
      )
    const nls = values?.nls ?? {}
    const translated = (key: string | null | undefined, fallback: string) =>
      key === undefined || key === null ? fallback : (nls[key] ?? fallback)
    const isMatch = (...text: readonly string[]) =>
      text.join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    const features = model.features.filter((f) =>
      isMatch(
        f.id,
        referenceName(f.name, model, nls, UI_TEXT),
        referenceText(f.summary, model, nls, UI_TEXT),
        referenceText(f.description, model, nls, UI_TEXT),
        ...f.details.map((text) => referenceText(text, model, nls, UI_TEXT)),
        JSON.stringify(f.facts),
        ...f.surfaces,
        ...f.settings,
        ...f.commands,
      ),
    )
    const commands = model.commands.filter((c) =>
      isMatch(c.id, translated(c.nameKey, c.name), referenceText(c.text, model, nls, UI_TEXT)),
    )
    const settingsRows = model.settings.filter((s) =>
      isMatch(
        s.id,
        translated(s.nameKey, s.name),
        translated(s.descriptionKey, s.description),
        JSON.stringify(s.schema),
      ),
    )
    const slashRows = model.slash.filter((c) =>
      isMatch(
        c.name,
        ...c.syntax,
        ...Object.values(c.descriptions).map((text) => referenceText(text, model, nls, UI_TEXT)),
      ),
    )
    const shortcuts = model.shortcuts.filter((k) =>
      isMatch(
        k.command,
        k.key,
        k.mac ?? '',
        k.win ?? '',
        k.linux ?? '',
        model.commands.find((c) => c.id === k.command)?.description ?? '',
      ),
    )
    const cliDescription = (entry: (typeof model.cli)[number]) =>
      entry.usageKey !== undefined && entry.usageLine !== undefined
        ? (fill(UI_TEXT[entry.usageKey], { command: model.executable }).split('\n')[
            entry.usageLine
          ] ?? entry.description)
        : fill(
            entry.text === undefined
              ? entry.description
              : referenceText(entry.text, model, nls, UI_TEXT),
            { command: model.executable },
          )
    const cliRows = model.cli.filter((entry) =>
      isMatch(entry.name, cliDescription(entry), JSON.stringify(entry.contract ?? {})),
    )
    const hasResults = [features, commands, settingsRows, slashRows, shortcuts, cliRows].some(
      (rows) => rows.length > 0,
    )
    const openSetting = (key: string) => {
      postMessage({ type: 'openReferenceSetting', key })
    }
    const docs = (url: string) => {
      postMessage({ type: 'openExternal', url })
    }
    return (
      <Modal title={UI_TEXT.helpReferenceTitle} titleId="reference-title" isWide onClose={onClose}>
        <div className="reference-page">
          <p>{UI_TEXT.referenceIntro}</p>
          <label htmlFor="reference-search">{UI_TEXT.referenceSearch}</label>
          <input
            id="reference-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
          />
          <nav aria-label={UI_TEXT.helpReferenceTitle}>
            {[
              ['features', UI_TEXT.referenceFeatures],
              ['slash', UI_TEXT.groupSlashCommands],
              ['commands', UI_TEXT.referenceCommands],
              ['settings', UI_TEXT.referenceSettings],
              ['shortcuts', UI_TEXT.referenceShortcuts],
              ['cli', 'ACP / CLI'],
            ].map(([id, label]) => (
              <a key={id} href={`#reference-${id ?? ''}`}>
                {label}
              </a>
            ))}
          </nav>
          <div role="status">{hasResults ? null : UI_TEXT.referenceNoMatches}</div>
          <section id="reference-features" aria-labelledby="reference-features-title">
            <h3 id="reference-features-title">{UI_TEXT.referenceFeatures}</h3>
            {features.map((f) => (
              <article key={f.id}>
                <h4>{referenceName(f.name, model, nls, UI_TEXT)}</h4>
                <p>{referenceText(f.summary, model, nls, UI_TEXT)}</p>
                {referenceText(f.description, model, nls, UI_TEXT) ===
                referenceText(f.summary, model, nls, UI_TEXT) ? null : (
                  <p>{referenceText(f.description, model, nls, UI_TEXT)}</p>
                )}
                <p className="reference-meta">{f.surfaces.join(', ')}</p>
                {f.paid ? <p>{UI_TEXT.referencePaid}</p> : null}
                {f.details.map((text, index) => (
                  <p key={index}>{referenceText(text, model, nls, UI_TEXT)}</p>
                ))}
                {Object.keys(f.facts).length === 0 ? null : (
                  <pre>{JSON.stringify(f.facts, null, 2)}</pre>
                )}
                <div className="reference-links">
                  {f.settings.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        openSetting(id)
                      }}
                    >
                      {UI_TEXT.referenceOpenSetting}: {id}
                    </button>
                  ))}
                  {f.commands.map((id) => (
                    <a
                      key={id}
                      href={`#reference-command-${id}`}
                      onClick={() => {
                        setQuery('')
                      }}
                    >
                      {translated(model.commands.find((c) => c.id === id)?.nameKey, id)}
                    </a>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      docs(f.docs)
                    }}
                  >
                    {UI_TEXT.referenceDocs}: {referenceName(f.name, model, nls, UI_TEXT)}
                  </button>
                </div>
              </article>
            ))}
          </section>
          <section id="reference-slash" aria-labelledby="reference-slash-title">
            <h3 id="reference-slash-title">{UI_TEXT.groupSlashCommands}</h3>
            <p>{UI_TEXT.referenceAcp}</p>
            {slashRows.map((c) => (
              <article key={c.name}>
                <h4>/{c.name}</h4>
                {c.syntax.map((syntax) => (
                  <p key={syntax}>
                    <code>{syntax}</code>
                  </p>
                ))}
                <p>
                  {Object.entries(c.descriptions).map(([backend, text]) => (
                    <span key={backend}>
                      {backend}: {referenceText(text, model, nls, UI_TEXT)}
                      <br />
                    </span>
                  ))}
                </p>
                <p className="reference-meta">{c.backends.join(', ')}</p>
              </article>
            ))}
          </section>
          <section id="reference-commands" aria-labelledby="reference-commands-title">
            <h3 id="reference-commands-title">{UI_TEXT.referenceCommands}</h3>
            {commands.map((c) => (
              <article key={c.id} id={`reference-command-${c.id}`}>
                <h4>
                  {translated(c.categoryKey, c.category)}: {translated(c.nameKey, c.name)}
                </h4>
                <code>{c.id}</code>
                <p>{referenceText(c.text, model, nls, UI_TEXT)}</p>
                {c.enablement === undefined ? null : (
                  <p className="reference-meta">
                    <code>{c.enablement}</code>
                  </p>
                )}
                {c.canRun ? (
                  <button
                    type="button"
                    onClick={() => {
                      postMessage({ type: 'runReferenceCommand', command: c.id })
                    }}
                  >
                    {UI_TEXT.referenceRun}: {translated(c.nameKey, c.name)}
                  </button>
                ) : null}
              </article>
            ))}
          </section>
          <section id="reference-settings" aria-labelledby="reference-settings-title">
            <h3 id="reference-settings-title">{UI_TEXT.referenceSettings}</h3>
            {Object.keys(values?.values ?? {}).length === 0 ? (
              <p role="status">{UI_TEXT.referenceUnavailable}</p>
            ) : null}
            {settingsRows.map((s) => (
              <article key={s.id}>
                <h4>{translated(s.nameKey, s.name)}</h4>
                <code>{s.id}</code>
                <p>{translated(s.descriptionKey, s.description)}</p>
                <dl>
                  <dt>{UI_TEXT.referenceCurrent}</dt>
                  <dd>
                    <code>{values?.values[s.id] ?? '—'}</code>
                  </dd>
                  <dt>{UI_TEXT.referenceDefault}</dt>
                  <dd>
                    <code>{valueText(s.default)}</code>
                  </dd>
                </dl>
                <p className="reference-meta">
                  <code>
                    {Array.isArray(s.type) ? s.type.join(' | ') : s.type} · {s.scope}
                  </code>
                </p>
                <pre>{JSON.stringify(referenceSchema(s.schema, nls), null, 2)}</pre>
                {s.refinements.map((rule) => (
                  <p key={rule}>
                    <code>{rule}</code>
                  </p>
                ))}
                {s.enum === undefined ? null : (
                  <ul>
                    {s.enum.map((v, i) => (
                      <li key={JSON.stringify(v)}>
                        <code>{valueText(v)}</code>:{' '}
                        {translated(s.enumDescriptionKeys?.[i], s.enumDescriptions?.[i] ?? '')}
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => {
                    openSetting(s.id)
                  }}
                >
                  {UI_TEXT.referenceOpenSetting}: {s.id}
                </button>
              </article>
            ))}
          </section>
          <section id="reference-shortcuts" aria-labelledby="reference-shortcuts-title">
            <h3 id="reference-shortcuts-title">{UI_TEXT.referenceShortcuts}</h3>
            {shortcuts.map((k) => (
              <article key={`${k.command}:${k.key}`}>
                <h4>
                  {translated(model.commands.find((c) => c.id === k.command)?.nameKey, k.command)}
                </h4>
                <p>
                  {referenceText(
                    model.commands.find((c) => c.id === k.command)?.text ?? {
                      setting: 'tabTrigger',
                    },
                    model,
                    nls,
                    UI_TEXT,
                  )}
                </p>
                <p>
                  <kbd>{k.key}</kbd>
                  {k.mac === undefined ? null : (
                    <>
                      {' '}
                      · macOS: <kbd>{k.mac}</kbd>
                    </>
                  )}
                </p>
                {k.win === undefined ? null : (
                  <p>
                    Windows: <kbd>{k.win}</kbd>
                  </p>
                )}
                {k.linux === undefined ? null : (
                  <p>
                    Linux: <kbd>{k.linux}</kbd>
                  </p>
                )}
                {k.text === undefined ? null : <p>{referenceText(k.text, model, nls, UI_TEXT)}</p>}
                {k.when === undefined ? null : <code className="reference-meta">{k.when}</code>}
              </article>
            ))}
          </section>
          <section id="reference-cli" aria-labelledby="reference-cli-title">
            <h3 id="reference-cli-title">ACP / CLI</h3>
            {cliRows.map((entry) => (
              <article key={entry.name}>
                <h4>
                  <code>{entry.name}</code>
                </h4>
                <p>{cliDescription(entry)}</p>
                {entry.contract === undefined ? null : (
                  <pre>{JSON.stringify(entry.contract, null, 2)}</pre>
                )}
              </article>
            ))}
          </section>
        </div>
      </Modal>
    )
  }
}
