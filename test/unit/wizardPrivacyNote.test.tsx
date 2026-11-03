// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import type { PresetCard } from '../../src/shared/modelsPanel'
import { Wizard } from '../../src/webview/models/Wizard'
import { OLLAMA_PRESET, makeDraft, makeState } from './modelsPanelFixtures'

// The credential step shows the preset card's privacy note where the key
// is entered (PROV-HONEST): Gemini's store=false sentence rides the
// gemini card from the host, and a preset without one shows no note.
const GEMINI_PRESET: PresetCard = {
  id: 'gemini',
  label: 'Google Gemini',
  description: 'Gemini models on the generateContent API',
  category: 'cloud',
  format: 'gemini',
  originKind: 'fixed',
  originDisplay: 'https://generativelanguage.googleapis.com',
  auth: 'apiKey',
  connectOAuth: false,
  keyHint: 'The key from AI Studio',
  keyPage: 'https://aistudio.google.com/apikey',
  privacyNote: EN.providerText.privacyNotes.geminiStore,
}

function renderCredentialStep(presetId: string): { readonly posted: unknown[] } {
  const posted: unknown[] = []
  const panelState = makeState({ presets: [OLLAMA_PRESET, GEMINI_PRESET] })
  const draft = makeDraft({ step: 'credential', presetId, blockers: [] })
  render(
    <Wizard
      panelState={panelState}
      draft={draft}
      life={{ generation: 1, isCurrent: (generation) => generation === 1 }}
      post={(message) => {
        posted.push(message)
      }}
      onNavigateModels={() => {
        posted.push('navigate-models')
      }}
      onClose={() => {
        posted.push('close')
      }}
    />,
  )
  return { posted }
}

describe('Wizard credential step privacy note', () => {
  it('shows the preset note beside the key entry', () => {
    const { posted } = renderCredentialStep('gemini')
    expect(screen.getByText(EN.providerText.privacyNotes.geminiStore)).toBeInTheDocument()
    expect(posted).toEqual([])
  })

  it('shows no note while the preset carries none', () => {
    renderCredentialStep('ollama')
    expect(screen.queryByText(EN.providerText.privacyNotes.geminiStore)).toBeNull()
    expect(screen.getByText('No key needed')).toBeInTheDocument()
  })
})
