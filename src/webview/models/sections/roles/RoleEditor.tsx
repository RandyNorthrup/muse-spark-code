import {
  UI_TEXT,
  TEAM_EXHAUSTED_POLICIES,
  TEAM_ROLE_WHEN_TO_USE_MAX_CHARS,
  TEAM_BORROW_COOLDOWN_MS,
  TEAM_BORROW_DEMAND_WAIT_MIN_MS,
  TEAM_BORROW_DEMAND_WAIT_MS,
  TEAM_BORROW_FINISH_GRACE_MS,
  TEAM_BORROW_LOOKAHEAD_MS,
  TEAM_BORROW_RECALL_WAIT_MS,
  MILLISECONDS_PER_SECOND,
  PERMISSION_MODES,
} from '../../../../shared/constants'
import { teamWorkspaceModes, teamReportShapes } from '../../../../shared/team'
import type { TeamBorrowTimers } from '../../../../shared/teamPreference'
import type { TeamEditorRole, TeamPanelMessage, TeamPanelSlice } from '../../../../shared/teamPanel'
import { useState } from 'react'
import { NumberField, TextField } from './fields'
import { PoolEditor } from './PoolEditor'
import { usePropDraft } from './propDraft'

/** The role's borrow timers with the plan's defaults for what it never set. */
function currentTimers(borrow: TeamBorrowTimers | undefined): TeamBorrowTimers {
  return {
    demandWaitMs: borrow?.demandWaitMs ?? TEAM_BORROW_DEMAND_WAIT_MS,
    lookaheadMs: borrow?.lookaheadMs ?? TEAM_BORROW_LOOKAHEAD_MS,
    finishGraceMs: borrow?.finishGraceMs ?? TEAM_BORROW_FINISH_GRACE_MS,
    recallWaitMs: borrow?.recallWaitMs ?? TEAM_BORROW_RECALL_WAIT_MS,
    cooldownMs: borrow?.cooldownMs ?? TEAM_BORROW_COOLDOWN_MS,
  }
}

export function RoleEditor({
  role,
  slice,
  post,
}: {
  readonly role: TeamEditorRole
  readonly slice: TeamPanelSlice
  readonly post: (message: TeamPanelMessage) => void
}) {
  const [toolQuery, setToolQuery] = useState('')
  // Rapid consecutive ticks build on the latest local tool set, never on
  // host props that may predate a tick the host has not echoed yet.
  const [tools, updateTools] = usePropDraft(role.tools)
  // Timer edits post the whole timers object, so consecutive edits build
  // on the latest local draft for the same reason.
  const [borrowDraft, updateBorrowDraft] = usePropDraft(role.borrow)
  const timers = currentTimers(borrowDraft)
  const setTimer = (key: keyof TeamBorrowTimers, seconds: number) => {
    const next = updateBorrowDraft((previous) => ({
      ...currentTimers(previous),
      [key]: Math.round(seconds * MILLISECONDS_PER_SECOND),
    }))
    update({ borrow: next })
  }
  const view = slice.roleViews.find((item) => item.role === role.role)
  const update = (fields: Extract<TeamPanelMessage, { type: 'roles/updateRole' }>['fields']) => {
    post({ type: 'roles/updateRole', role: role.role, fields })
  }
  const modeNames = {
    'read-only': UI_TEXT.teamAccessModes.readOnly,
    'own-branch': UI_TEXT.teamAccessModes.ownBranch,
    'in-place': UI_TEXT.teamAccessModes.inPlace,
  }
  return (
    <div className="team-editor-role">
      <div className="team-editor-actions">
        <h3>{view?.name ?? role.role}</h3>
        <button
          type="button"
          className="models-button"
          onClick={() => {
            post({ type: 'roles/removeRole', role: role.role })
          }}
        >
          {UI_TEXT.providerRemove}
        </button>
        {role.custom === true ? (
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'roles/reapply', role: role.role })
            }}
          >
            {UI_TEXT.teamEditor.reapply}
          </button>
        ) : null}
      </div>
      <TextField
        label={UI_TEXT.teamEditor.purpose}
        value={role.purpose ?? ''}
        maxLength={TEAM_ROLE_WHEN_TO_USE_MAX_CHARS}
        onChange={(purpose) => {
          update({ purpose })
        }}
      />
      <TextField
        label={UI_TEXT.teamEditor.done}
        value={role.done ?? ''}
        maxLength={TEAM_ROLE_WHEN_TO_USE_MAX_CHARS}
        onChange={(done) => {
          update({ done })
        }}
      />
      <TextField
        label={UI_TEXT.teamEditor.guidance}
        value={role.guidance ?? ''}
        onChange={(guidance) => {
          update({ guidance })
        }}
      />
      <label className="team-editor-field">
        {UI_TEXT.teamEditor.workspace}
        <select
          value={role.workspace ?? 'read-only'}
          onChange={(event) => {
            const workspace = teamWorkspaceModes.find((mode) => mode === event.target.value)
            if (workspace !== undefined) update({ workspace })
          }}
        >
          {teamWorkspaceModes
            .filter(
              (mode) =>
                mode !== 'in-place' ||
                role.pool.every(
                  (entry) =>
                    entry.agent?.kind === 'engine' ||
                    (entry.agent === undefined &&
                      slice.offers.find((offer) => offer.ref === slice.defaultRef)?.agent.kind ===
                        'engine'),
                ),
            )
            .map((mode) => (
              <option key={mode} value={mode}>
                {modeNames[mode]}
              </option>
            ))}
        </select>
      </label>
      <fieldset className="team-editor-card">
        <legend>{UI_TEXT.teamToolChecklist}</legend>
        <label className="team-editor-field">
          {UI_TEXT.teamEditor.toolSearch}
          <input
            type="search"
            value={toolQuery}
            onChange={(event) => {
              setToolQuery(event.target.value)
            }}
          />
        </label>
        {view?.allowedTools
          .filter((group) =>
            UI_TEXT.teamToolGroups[group].toLowerCase().includes(toolQuery.trim().toLowerCase()),
          )
          .map((group) => (
            <label key={group} className="team-editor-tool">
              <input
                type="checkbox"
                checked={tools?.includes(group) ?? false}
                onChange={(event) => {
                  const draft = updateTools((previous) =>
                    event.target.checked
                      ? [...(previous ?? []), group]
                      : (previous?.filter((item) => item !== group) ?? []),
                  )
                  update({ tools: draft })
                }}
              />
              {UI_TEXT.teamToolGroups[group]}
            </label>
          ))}
      </fieldset>
      <label className="team-editor-field">
        {UI_TEXT.teamReportTitle}
        <select
          value={role.report ?? 'summary'}
          onChange={(event) => {
            const report = teamReportShapes.find((shape) => shape === event.target.value)
            if (report !== undefined) update({ report })
          }}
        >
          {teamReportShapes.map((report) => (
            <option key={report} value={report}>
              {UI_TEXT.teamReportShapes[report]}
            </option>
          ))}
        </select>
      </label>
      <label className="team-editor-field">
        {UI_TEXT.permissionModeTitle}
        <select
          value={role.permissionMode ?? 'plan'}
          onChange={(event) => {
            update({ permissionMode: event.target.value })
          }}
        >
          {PERMISSION_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {UI_TEXT.permissionModes[mode]}
            </option>
          ))}
        </select>
      </label>
      <label className="team-editor-field">
        {UI_TEXT.teamWaitingTitle}
        <select
          value={role.exhausted ?? 'ask'}
          onChange={(event) => {
            const exhausted = TEAM_EXHAUSTED_POLICIES.find((item) => item === event.target.value)
            if (exhausted !== undefined) update({ exhausted })
          }}
        >
          <option value="ask">{UI_TEXT.teamWaitingTitle}</option>
          <option value="queue">{UI_TEXT.teamWaitingQueue}</option>
          <option value="self">{UI_TEXT.teamWaitingSelf}</option>
        </select>
      </label>
      <fieldset className="team-editor-card">
        <legend>{UI_TEXT.teamBorrowTimersTitle}</legend>
        <NumberField
          label={UI_TEXT.teamBorrowDemandWait}
          value={timers.demandWaitMs / MILLISECONDS_PER_SECOND}
          min={TEAM_BORROW_DEMAND_WAIT_MIN_MS / MILLISECONDS_PER_SECOND}
          step={1}
          onChange={(seconds) => {
            setTimer('demandWaitMs', seconds)
          }}
        />
        <NumberField
          label={UI_TEXT.teamBorrowLookahead}
          value={timers.lookaheadMs / MILLISECONDS_PER_SECOND}
          min={0}
          step={1}
          onChange={(seconds) => {
            setTimer('lookaheadMs', seconds)
          }}
        />
        <NumberField
          label={UI_TEXT.teamBorrowFinishGrace}
          value={timers.finishGraceMs / MILLISECONDS_PER_SECOND}
          min={0}
          step={1}
          onChange={(seconds) => {
            setTimer('finishGraceMs', seconds)
          }}
        />
        <NumberField
          label={UI_TEXT.teamBorrowRecallWait}
          value={timers.recallWaitMs / MILLISECONDS_PER_SECOND}
          min={0}
          step={1}
          onChange={(seconds) => {
            setTimer('recallWaitMs', seconds)
          }}
        />
        <NumberField
          label={UI_TEXT.teamBorrowCooldown}
          value={timers.cooldownMs / MILLISECONDS_PER_SECOND}
          min={0}
          step={1}
          onChange={(seconds) => {
            setTimer('cooldownMs', seconds)
          }}
        />
      </fieldset>
      <label className="team-editor-tool">
        <input
          type="checkbox"
          checked={role.autoOrder === true}
          onChange={(event) => {
            update({ autoOrder: event.target.checked })
          }}
        />
        {UI_TEXT.teamAutoOrder}
      </label>
      <details>
        <summary>{UI_TEXT.teamCharterEnforced}</summary>
        <pre className="team-editor-charter" lang="en">
          {view?.generated}
        </pre>
      </details>
      <PoolEditor role={role} slice={slice} post={post} />
    </div>
  )
}
