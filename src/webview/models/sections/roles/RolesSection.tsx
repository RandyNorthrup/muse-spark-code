import './roles.css'
import { useState } from 'react'
import { UI_TEXT, TEAM_BUILTIN_ROLE_IDS } from '../../../../shared/constants'
import { teamIntensityLevels } from '../../../../shared/team'
import { teamTemplateSchema, teamPreviewSampleSchema } from '../../../../shared/teamPanel'
import { fill } from '../../../../shared/l10n/text'
import type { SectionProps } from '../../sections'
import { SearchableSelect } from '../../components/SearchableSelect'
import { deferred } from '../../../components/DeferredSurface'

const RoleEditor = deferred(async () => {
  const module = await import('./RoleEditor')
  return { default: module.RoleEditor }
})
import { ModelSettings } from './fields'

export function RolesSection({ panelState, post, highlightedItem }: SectionProps) {
  const slice = panelState.roles
  const [step, setStep] = useState(0)
  // The guide leaves only once an imported draft actually arrives (the
  // host announces it); cancelling the file picker changes nothing, so
  // the guide stays.
  const [guided, setGuided] = useState(
    panelState.roles?.hasSavedConfiguration === false &&
      panelState.roles.document.roles.length === 0,
  )
  // Only a fresh import arrival ends the guide: a notice that was
  // already there (a cancelled picker, a reset draft) changes nothing.
  const [seenNotice, setSeenNotice] = useState(slice?.notice)
  if (slice?.notice !== seenNotice) {
    setSeenNotice(slice?.notice)
    if (guided && slice?.notice === UI_TEXT.teamImportDraft) setGuided(false)
  }
  const [template, setTemplate] = useState<'solo' | 'pair' | 'full' | 'custom'>('pair')
  const [roleId, setRoleId] = useState('')
  const [chip, setChip] = useState<string | undefined>()
  const [selection, setSelection] = useState<{ role: string; link: string | undefined }>()
  if (slice === undefined) return null
  const selected = selection?.link === highlightedItem ? selection?.role : undefined
  const setSelected = (role: string) => {
    setSelection({ role, link: highlightedItem })
  }
  const document = slice.document
  const active =
    document.roles.find((role) => role.role === (selected ?? highlightedItem)) ?? document.roles[0]
  const orchestrator = document.orchestrator?.agent
  const orchestratorOffer =
    orchestrator === undefined
      ? undefined
      : slice.offers.find(
          (offer) =>
            offer.agent.agentId === orchestrator.agentId &&
            offer.agent.model === orchestrator.model &&
            offer.agent.kind === orchestrator.kind &&
            offer.agent.provider === orchestrator.provider &&
            offer.agent.pays === orchestrator.pays,
        )
  const names = [
    UI_TEXT.teamSetupSteps.template,
    UI_TEXT.teamSetupSteps.agents,
    UI_TEXT.teamSetupSteps.pools,
    UI_TEXT.teamSetupSteps.limits,
    UI_TEXT.teamSetupSteps.preview,
  ]
  const isFirstRun = guided && step < names.length - 1
  const templateId = isFirstRun ? template : document.template
  const next = () => {
    if (step === 0) post({ type: 'roles/template', template })
    if (step === names.length - 2) post({ type: 'roles/save' })
    setStep(step + 1)
  }
  return (
    <section className="team-editor" aria-labelledby="roles-title">
      <h2 id="roles-title">{UI_TEXT.teamRolesTitle}</h2>
      {panelState.notice === undefined ? null : <p role="alert">{panelState.notice}</p>}
      {slice.notice === undefined ? null : <p role="status">{slice.notice}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (isFirstRun) next()
          else post({ type: 'roles/save' })
        }}
      >
        <fieldset className="team-editor-card">
          <legend>{isFirstRun ? names[step] : UI_TEXT.teamSetupSteps.template}</legend>
          <label className="team-editor-field">
            {UI_TEXT.teamSetupSteps.template}
            <select
              value={templateId}
              onChange={(event) => {
                const parsed = teamTemplateSchema.safeParse(event.target.value)
                if (!parsed.success) {
                  return
                }

                setTemplate(parsed.data)
                if (!isFirstRun) post({ type: 'roles/template', template: parsed.data })
              }}
            >
              {['solo', 'pair', 'full', 'custom'].map((id) => {
                const key = teamTemplateSchema.parse(id)
                return (
                  <option key={key} value={key}>
                    {UI_TEXT.teamTemplates[key]}
                  </option>
                )
              })}
            </select>
          </label>
          <p>{UI_TEXT.teamTemplateDetails[templateId]}</p>
          {isFirstRun ? (
            <>
              <p>{names[step]}</p>
              <button
                type="submit"
                className="models-button models-button-primary"
                disabled={step === names.length - 2 && slice.issues.length > 0}
              >
                {step === names.length - 2 ? UI_TEXT.teamEditor.save : UI_TEXT.wizardContinue}
              </button>
              {step > 0 ? (
                <button
                  type="button"
                  className="models-button"
                  onClick={() => {
                    setStep(step - 1)
                  }}
                >
                  {UI_TEXT.wizardBack}
                </button>
              ) : null}
            </>
          ) : null}
        </fieldset>
        {step === 1 ? (
          <ul>
            {slice.offers.map((offer) => (
              <li key={offer.ref}>{offer.label}</li>
            ))}
          </ul>
        ) : null}
        <fieldset className="team-editor-card">
          <legend>{UI_TEXT.teamOrchestratorSlot}</legend>
          <p>
            {orchestratorOffer?.label ??
              fill(UI_TEXT.teamDefaultResolves, { model: slice.defaultRef })}
          </p>
          <SearchableSelect
            label={UI_TEXT.teamOrchestratorSlot}
            placeholder={UI_TEXT.groupModel}
            options={slice.offers
              .filter((offer) => offer.agent.kind !== 'external')
              .map((offer) => ({
                value: offer.ref,
                label: offer.label,
                description: offer.agent.model,
                category: offer.agent.kind,
              }))}
            chips={[]}
            activeChip={chip}
            onChip={setChip}
            onSelect={(modelRef) => {
              post({ type: 'roles/orchestrator', modelRef })
            }}
          />
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'roles/orchestrator' })
            }}
          >
            {UI_TEXT.teamResetToDefault}
          </button>
          {orchestratorOffer === undefined ? null : (
            <ModelSettings
              controls={orchestratorOffer.controls}
              value={document.orchestrator?.settings}
              onChange={(settings) => {
                post({ type: 'roles/orchestrator', modelRef: orchestratorOffer.ref, settings })
              }}
            />
          )}
        </fieldset>
        <fieldset className="team-editor-card">
          <legend>{UI_TEXT.teamIntensityTitle}</legend>
          <p>{slice.levelCosts[document.intensity]}</p>
          <label className="team-editor-field">
            {UI_TEXT.teamIntensityTitle}
            <select
              value={document.intensity}
              onChange={(event) => {
                const level = teamIntensityLevels.find((value) => value === event.target.value)
                if (level !== undefined) post({ type: 'roles/intensity', level })
              }}
            >
              {teamIntensityLevels.map((level) => (
                <option key={level} value={level}>
                  {UI_TEXT.teamIntensityLevels[level]} · {slice.levelCosts[level]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
        <SearchableSelect
          label={UI_TEXT.teamRolesTitle}
          placeholder={UI_TEXT.teamRolesTitle}
          options={TEAM_BUILTIN_ROLE_IDS.map((id) => ({
            value: id,
            label: UI_TEXT.teamEditorRoles[id],
            description: id,
            category: 'role',
          }))}
          chips={[]}
          activeChip={undefined}
          onChip={setChip}
          onSelect={(role) => {
            setSelected(role)
            if (document.roles.every((item) => item.role !== role))
              post({ type: 'roles/addRole', role })
          }}
        />
        <label className="team-editor-field">
          {UI_TEXT.teamEditor.roleId}
          <input
            value={roleId}
            onChange={(event) => {
              setRoleId(event.target.value)
            }}
          />
        </label>
        <button
          type="button"
          className="models-button"
          disabled={roleId.trim() === ''}
          onClick={() => {
            post({ type: 'roles/addRole', role: roleId.trim() })
            setSelected(roleId.trim())
            setRoleId('')
          }}
        >
          {UI_TEXT.teamAddCustomRole}
        </button>
        <div className="team-editor-actions">
          {document.roles.map((role) => (
            <button
              type="button"
              key={role.role}
              className="models-chip"
              aria-pressed={active?.role === role.role}
              onClick={() => {
                setSelected(role.role)
              }}
            >
              {slice.roleViews.find((view) => view.role === role.role)?.name ?? role.role}
            </button>
          ))}
        </div>
        {active === undefined ? null : (
          <RoleEditor
            key={`${document.template}-${active.role}`}
            role={active}
            slice={slice}
            post={post}
          />
        )}
        {slice.suggestions.map((suggestion) => (
          <div className="team-editor-card" key={`${suggestion.role}/${suggestion.kind}`}>
            <p>{suggestion.reason}</p>
            <div className="team-editor-actions">
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  post({
                    type: 'roles/suggestion',
                    role: suggestion.role,
                    kind: suggestion.kind,
                    decision: 'accept',
                  })
                }}
              >
                {UI_TEXT.teamSuggestionAccept}
              </button>
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  setSelected(suggestion.role)
                }}
              >
                {UI_TEXT.teamSuggestionChange}
              </button>
              <button
                type="button"
                className="models-button"
                onClick={() => {
                  post({
                    type: 'roles/suggestion',
                    role: suggestion.role,
                    kind: suggestion.kind,
                    decision: 'dismiss',
                  })
                }}
              >
                {UI_TEXT.teamSuggestionDismiss}
              </button>
            </div>
          </div>
        ))}
        <fieldset className="team-editor-card">
          <legend>{UI_TEXT.teamPreviewTitle}</legend>
          <p>{UI_TEXT.teamEditor.noCalls}</p>
          <label className="team-editor-field">
            {UI_TEXT.teamPreviewSample}
            <select
              value={slice.sample}
              onChange={(event) => {
                const parsed = teamPreviewSampleSchema.safeParse(event.target.value)
                if (parsed.success) post({ type: 'roles/preview', sample: parsed.data })
              }}
            >
              <option value="feature-tests">{UI_TEXT.teamPreviewFeatureTests}</option>
              <option value="research-library">{UI_TEXT.teamPreviewResearchLibrary}</option>
              <option value="review-branch">{UI_TEXT.teamPreviewReviewBranch}</option>
            </select>
          </label>
          <p>{slice.preview.cost}</p>
          <p>{slice.preview.switches}</p>
          <ul>
            {slice.preview.steps.map((item, index) => (
              <li key={index}>
                {item.role}: {item.model}
                {item.switched ? ` · ${UI_TEXT.teamSwitchReasons.cap}` : ''}
              </li>
            ))}
            {slice.preview.unstaffed.map((role) => (
              <li key={role}>
                {role}: {UI_TEXT.teamNotStaffed}
              </li>
            ))}
          </ul>
          {slice.dryRunCost === undefined ? null : (
            <button
              type="button"
              className="models-button"
              onClick={() => {
                post({ type: 'roles/try' })
              }}
            >
              {fill(UI_TEXT.teamTryWithOrchestrator, { cost: slice.dryRunCost })}
            </button>
          )}
        </fieldset>
        {slice.issues.map((issue, index) => (
          <p role="alert" key={index}>
            {issue}
          </p>
        ))}
        <div className="team-editor-actions">
          {isFirstRun ? null : (
            <button
              type="submit"
              className="models-button models-button-primary"
              disabled={slice.issues.length > 0 || !slice.dirty}
            >
              {UI_TEXT.teamEditor.save}
            </button>
          )}
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'roles/reset' })
              setStep(0)
              // Cancelling back to an empty, unsaved workspace restores
              // guided setup; a saved configuration stays out of the guide.
              if (!slice.hasSavedConfiguration) setGuided(true)
            }}
          >
            {UI_TEXT.wizardCancel}
          </button>
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'roles/import' })
            }}
          >
            {UI_TEXT.providerImport}
          </button>
          <button
            type="button"
            className="models-button"
            onClick={() => {
              post({ type: 'roles/export' })
            }}
          >
            {UI_TEXT.providerExport}
          </button>
        </div>
      </form>
    </section>
  )
}
