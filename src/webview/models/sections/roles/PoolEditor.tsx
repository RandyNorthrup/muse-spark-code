import { useMemo, useState } from 'react'
import { webviewKey } from '../../../../shared/keybindings'
import { UI_TEXT } from '../../../../shared/constants'
import { fill, formatNumber } from '../../../../shared/l10n/text'
import { teamCapMeasures, teamCapWindows } from '../../../../shared/teamConfig'
import type { TeamEditorRole, TeamPanelMessage, TeamPanelSlice } from '../../../../shared/teamPanel'
import { SearchableSelect } from '../../components/SearchableSelect'
import { ModelSettings, NumberField } from './fields'
import { usePropDraft } from './propDraft'

export function PoolEditor({
  role,
  slice,
  post,
}: {
  readonly role: TeamEditorRole
  readonly slice: TeamPanelSlice
  readonly post: (message: TeamPanelMessage) => void
}) {
  const [announcement, announce] = useState('')
  const [chip, setChip] = useState<string | undefined>()
  const [dragged, setDragged] = useState<string | undefined>()
  const move = (entryId: string, index: number) => {
    post({ type: 'roles/moveEntry', role: role.role, entryId, to: index })
    announce(
      fill(UI_TEXT.teamEditor.moveLabel, { entry: entryId, position: formatNumber(index + 1) }),
    )
  }
  // Rapid consecutive cap edits build on the latest local caps, never on
  // host props that may predate an edit the host has not echoed yet. The
  // record keeps its identity while the pool does, so local renders do
  // not look like new host values to the draft.
  const poolCaps = useMemo(
    () => Object.fromEntries(role.pool.map((entry) => [entry.id, entry.caps])),
    [role.pool],
  )
  const [capDrafts, updateCapDrafts] = usePropDraft(poolCaps)
  const view = slice.roleViews.find((item) => item.role === role.role)
  const measureNames = {
    tokens: UI_TEXT.teamUsageTokens,
    inputTokens: UI_TEXT.accounts.inputTokens,
    outputTokens: UI_TEXT.accounts.outputTokens,
    spendUsd: UI_TEXT.accounts.spend,
    tasks: UI_TEXT.teamUsageTasks,
  }
  const options = [
    {
      value: 'default',
      label: fill(UI_TEXT.teamDefaultResolves, { model: slice.defaultRef }),
      description: UI_TEXT.teamDefaultEntry,
      category: 'default',
    },
    ...slice.offers.map((offer) => ({
      value: offer.ref,
      label: offer.label,
      description: `${offer.agent.provider ?? offer.agent.agentId} · ${offer.agent.model}`,
      category: offer.agent.kind,
    })),
  ]
  return (
    <fieldset className="team-editor-card">
      <legend>{UI_TEXT.teamEditor.pools}</legend>
      <p className="models-hint">{UI_TEXT.teamEditor.poolKeys}</p>
      <p className="models-visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <SearchableSelect
        label={UI_TEXT.teamAddEntry}
        placeholder={UI_TEXT.groupModel}
        options={options}
        chips={[]}
        activeChip={chip}
        onChip={setChip}
        onSelect={(modelRef) => {
          post({ type: 'roles/addEntry', role: role.role, modelRef })
        }}
      />
      <ol className="team-editor-pool">
        {role.pool.map((entry, index) => {
          const offer =
            entry.agent === undefined
              ? undefined
              : slice.offers.find(
                  (item) =>
                    item.agent.kind === entry.agent?.kind &&
                    item.agent.agentId === entry.agent.agentId &&
                    item.agent.model === entry.agent.model &&
                    item.agent.provider === entry.agent.provider &&
                    item.agent.pays === entry.agent.pays,
                )
          const label =
            entry.agent === undefined
              ? fill(UI_TEXT.teamDefaultResolves, { model: slice.defaultRef })
              : (offer?.label ?? entry.agent.model)
          const caps = capDrafts[entry.id] ?? entry.caps
          const capPost = (capIndex: number, cap: (typeof caps)[number] | undefined) => {
            updateCapDrafts((previous) => {
              const current = previous[entry.id] ?? entry.caps
              const next = [...current]
              if (cap === undefined) next.splice(capIndex, 1)
              else next.splice(capIndex, capIndex === current.length ? 0 : 1, cap)
              return { ...previous, [entry.id]: next }
            })
            post({ type: 'roles/cap', role: role.role, entryId: entry.id, index: capIndex, cap })
          }
          return (
            <li
              key={entry.id}
              className="team-editor-entry"
              draggable
              onDragStart={() => {
                setDragged(entry.id)
              }}
              onDragOver={(event) => {
                event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged !== undefined) move(dragged, index)
                setDragged(undefined)
              }}
            >
              <div className="team-editor-actions">
                <button
                  type="button"
                  className="team-editor-order"
                  aria-label={label}
                  onKeyDown={(event) => {
                    const action = webviewKey('team.pool', event)
                    if (action === undefined) return
                    event.preventDefault()
                    const next = index + (action === 'previous' ? -1 : 1)
                    if (next >= 0 && next < role.pool.length) move(entry.id, next)
                  }}
                >
                  {formatNumber(index + 1)} · {label}
                </button>
                <button
                  type="button"
                  className="models-button"
                  onClick={() => {
                    post({ type: 'roles/removeEntry', role: role.role, entryId: entry.id })
                  }}
                >
                  {UI_TEXT.providerRemove}
                </button>
              </div>
              {offer === undefined && entry.agent !== undefined ? (
                <p role="alert">{UI_TEXT.teamEntryMissing}</p>
              ) : null}
              <NumberField
                label={UI_TEXT.teamEditor.concurrent}
                value={entry.concurrent}
                min={1}
                step={1}
                max={Math.min(slice.maxWorkers, offer?.ceiling ?? slice.maxWorkers)}
                onChange={(concurrent) => {
                  post({
                    type: 'roles/updateEntry',
                    role: role.role,
                    entryId: entry.id,
                    fields: { concurrent },
                  })
                }}
              />
              <p className="models-hint">{view?.reasons[entry.id]}</p>
              <fieldset className="team-editor-caps">
                <legend>{UI_TEXT.teamEditor.caps}</legend>
                {caps.map((cap, capIndex) => (
                  <div key={capIndex} className="team-editor-cap">
                    {role.custom === true ? null : (
                      <p className="models-hint">
                        {fill(UI_TEXT.teamCapPrefillDefault, {
                          amount: formatNumber(cap.amount),
                          window: UI_TEXT.teamEditor[cap.window],
                          role: view?.name ?? role.role,
                        })}
                      </p>
                    )}
                    <label>
                      {UI_TEXT.teamEditor.caps}
                      <select
                        value={cap.measure}
                        onChange={(event) => {
                          const measure = teamCapMeasures.find(
                            (item) => item === event.target.value,
                          )
                          if (measure !== undefined) capPost(capIndex, { ...cap, measure })
                        }}
                      >
                        {teamCapMeasures.map((measure) => (
                          <option key={measure} value={measure}>
                            {measureNames[measure]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {UI_TEXT.teamEditor.task}
                      <select
                        value={cap.window}
                        onChange={(event) => {
                          const window = teamCapWindows.find((item) => item === event.target.value)
                          if (window !== undefined) capPost(capIndex, { ...cap, window })
                        }}
                      >
                        {teamCapWindows.map((window) => (
                          <option key={window} value={window}>
                            {UI_TEXT.teamEditor[window]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <NumberField
                      label={UI_TEXT.teamEditor.caps}
                      value={cap.amount}
                      min={0}
                      onChange={(amount) => {
                        capPost(capIndex, { ...cap, amount })
                      }}
                    />
                    <button
                      type="button"
                      className="models-button"
                      onClick={() => {
                        capPost(capIndex, undefined)
                      }}
                    >
                      {UI_TEXT.providerRemove}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="models-button"
                  onClick={() => {
                    capPost(caps.length, {
                      measure: 'tokens',
                      window: 'lifetime',
                      amount:
                        slice.document.roles.find((item) => item.role === role.role)?.pool[0]
                          ?.caps[0]?.amount ?? 1,
                    })
                  }}
                >
                  {UI_TEXT.teamEditor.addCap}
                </button>
              </fieldset>
              {offer === undefined ? null : (
                <ModelSettings
                  controls={offer.controls}
                  value={entry.settings}
                  onChange={(settings) => {
                    post({
                      type: 'roles/updateEntry',
                      role: role.role,
                      entryId: entry.id,
                      fields: { settings },
                    })
                  }}
                />
              )}
            </li>
          )
        })}
      </ol>
      {view?.issues.map((issue) => (
        <p role="alert" key={issue}>
          {issue}
        </p>
      ))}
      {view?.warnings.map((warning) => (
        <p className="models-hint" key={warning}>
          {warning}
        </p>
      ))}
    </fieldset>
  )
}
