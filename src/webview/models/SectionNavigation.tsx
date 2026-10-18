import { UI_TEXT } from '../../shared/constants'
import type { ModelsPanelSection } from '../../shared/modelsPanel'
import { MODEL_SECTIONS, type PanelSectionDef } from './sections'

/** Identical shell during entry loading and the live panel: no reload shrink. */
export function SectionNavigation({
  activeId,
  pendingSection,
  pendingShown = false,
  navigate,
  sections = MODEL_SECTIONS.filter((section) => section.isOffered?.(undefined) ?? true),
}: {
  readonly activeId: ModelsPanelSection
  readonly pendingSection?: ModelsPanelSection | undefined
  readonly pendingShown?: boolean
  readonly navigate?: ((section: ModelsPanelSection) => void) | undefined
  /** Only sections the host offers; a hidden section gets no nav button. */
  readonly sections?: readonly PanelSectionDef[]
}) {
  return (
    <nav className="models-nav" aria-label={UI_TEXT.modelsPanelTitle}>
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          disabled={navigate === undefined}
          className={
            section.id === activeId ? 'models-nav-item models-nav-item-active' : 'models-nav-item'
          }
          aria-current={section.id === activeId ? 'page' : undefined}
          aria-busy={(pendingShown && pendingSection === section.id) || undefined}
          data-deferred-loading={pendingSection === section.id || undefined}
          onClick={() => {
            navigate?.(section.id)
          }}
        >
          <section.icon />
          {section.getTitle()}
          {pendingShown && pendingSection === section.id && (
            <span className="models-visually-hidden" role="status">
              {UI_TEXT.loadingOutput}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
