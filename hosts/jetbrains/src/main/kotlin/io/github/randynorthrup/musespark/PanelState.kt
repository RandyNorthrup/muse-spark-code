package io.github.randynorthrup.musespark

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import java.util.UUID

@Service(Service.Level.PROJECT)
@State(name = "MuseSparkPanel", storages = [Storage("museSparkPanel.xml")])
class PanelState : PersistentStateComponent<PanelState.Saved> {
  class Saved {
    var sessionId: String = UUID.randomUUID().toString()
  }

  private var saved = Saved()

  override fun getState(): Saved = saved

  override fun loadState(state: Saved) {
    require(state.sessionId.isNotEmpty()) { "MHP_PANEL_BINDING_MISMATCH" }
    saved = state
  }
}
