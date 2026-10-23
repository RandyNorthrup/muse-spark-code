package io.github.randynorthrup.musespark

import com.intellij.openapi.editor.colors.CodeInsightColors
import com.intellij.openapi.editor.colors.EditorColors
import com.intellij.openapi.editor.colors.EditorColorsManager
import com.intellij.openapi.editor.colors.EditorColorsScheme
import com.intellij.ui.JBColor
import java.awt.Color
import javax.swing.UIManager

object NativeTheme {
  fun css(): String {
    val scheme = EditorColorsManager.getInstance().globalScheme
    val palette = ThemeColors(scheme)
    val values = mutableMapOf<String, String>()
    uiColors(values, palette)
    editorColors(values, palette)
    values["diffEditor-insertedLineBackground"] = color(palette.success, DIFF_ALPHA)
    values["diffEditor-removedLineBackground"] = color(palette.error, DIFF_ALPHA)
    values["widget-shadow"] = "transparent"
    val font = UIManager.getFont("Label.font")
    values["font-family"] = quote(font?.family ?: scheme.editorFontName) + ", system-ui, sans-serif"
    values["font-size"] = "${font?.size ?: scheme.editorFontSize}px"
    values["editor-font-family"] = quote(scheme.editorFontName) + ", ui-monospace, monospace"
    values["editor-font-size"] = "${scheme.editorFontSize}px"
    return ":root{" + values.entries.joinToString("") { (key, value) -> "--muse-$key:$value;--vscode-$key:$value;" } +
      "}"
  }

  private fun uiColors(
    values: MutableMap<String, String>,
    palette: ThemeColors,
  ) {
    colors(
      values,
      palette.foreground,
      "foreground",
      "textPreformat-foreground",
      "editorWidget-foreground",
      "editor-foreground",
      "button-secondaryForeground",
    )
    colors(
      values,
      palette.background,
      "sideBar-background",
      "editorWidget-background",
      "button-secondaryBackground",
    )
    colors(values, palette.muted, "descriptionForeground", "disabledForeground", "input-placeholderForeground")
    colors(
      values,
      palette.border,
      "contrastBorder",
      "contrastActiveBorder",
      "textBlockQuote-border",
      "panel-border",
      "widget-border",
      "editorWidget-border",
      "button-border",
      "input-border",
      "checkbox-border",
    )
    colors(
      values,
      palette.selected,
      "button-background",
      "badge-background",
      "list-activeSelectionBackground",
      "progressBar-background",
      "focusBorder",
      "toolbar-hoverBackground",
      "list-hoverBackground",
      "button-hoverBackground",
      "button-secondaryHoverBackground",
    )
    colors(
      values,
      palette.selectedForeground,
      "button-foreground",
      "badge-foreground",
      "list-activeSelectionForeground",
    )
    uiValidationColors(values, palette)
  }

  private fun uiValidationColors(
    values: MutableMap<String, String>,
    palette: ThemeColors,
  ) {
    colors(
      values,
      palette.error,
      "errorForeground",
      "charts-red",
      "testing-iconFailed",
      "gitDecoration-deletedResourceForeground",
      "inputValidation-errorForeground",
      "inputValidation-errorBorder",
    )
    colors(
      values,
      palette.warning,
      "editorWarning-foreground",
      "list-warningForeground",
      "inputValidation-warningForeground",
      "charts-orange",
    )
    colors(values, palette.success, "testing-iconPassed", "gitDecoration-addedResourceForeground")
    colors(
      values,
      palette.scheme.defaultBackground,
      "editor-background",
      "textCodeBlock-background",
      "inputValidation-errorBackground",
      "inputValidation-warningBackground",
    )
  }

  private fun editorColors(
    values: MutableMap<String, String>,
    palette: ThemeColors,
  ) {
    colors(values, UIManager.getColor("TextField.background") ?: palette.background, "input-background")
    colors(values, UIManager.getColor("TextField.foreground") ?: palette.foreground, "input-foreground")
    colors(values, UIManager.getColor("ComboBox.background") ?: palette.background, "dropdown-background")
    colors(values, UIManager.getColor("ComboBox.foreground") ?: palette.foreground, "dropdown-foreground")
    colors(values, UIManager.getColor("Component.linkColor") ?: palette.selected, "charts-purple")
    colors(
      values,
      palette.scheme.getAttributes(EditorColors.TEXT_SEARCH_RESULT_ATTRIBUTES)?.backgroundColor ?: palette.selected,
      "editor-findMatchHighlightBackground",
    )
    colors(
      values,
      palette.scheme.getColor(EditorColors.CARET_COLOR) ?: palette.foreground,
      "editorCursor-foreground",
    )
    colors(
      values,
      palette.scheme.getAttributes(EditorColors.REFERENCE_HYPERLINK_COLOR)?.foregroundColor ?: palette.selected,
      "textLink-foreground",
      "textLink-activeForeground",
    )
    colors(
      values,
      palette.foreground,
      "debugTokenExpression-number",
      "debugTokenExpression-string",
      "symbolIcon-functionForeground",
      "symbolIcon-keywordForeground",
    )
  }

  val tokens: com.google.gson.JsonObject
    get() =
      json().also { tokens ->
        Regex("(--muse-[a-zA-Z][\\w-]*):([^;]+);").findAll(css()).forEach { match ->
          tokens.addProperty(match.groupValues[1], match.groupValues[2])
        }
      }

  fun dark(): Boolean = !JBColor.isBright()

  fun install(
    project: com.intellij.openapi.project.Project,
    owner: com.intellij.openapi.Disposable,
    changed: () -> Unit,
  ) {
    val listener =
      java.beans.PropertyChangeListener { event ->
        if (event.propertyName == "lookAndFeel") javax.swing.SwingUtilities.invokeLater(changed)
      }
    UIManager.addPropertyChangeListener(listener)
    com.intellij.openapi.util.Disposer
      .register(owner) { UIManager.removePropertyChangeListener(listener) }
    project.messageBus.connect(owner).subscribe(
      EditorColorsManager.TOPIC,
      com.intellij.openapi.editor.colors.EditorColorsListener {
        javax.swing.SwingUtilities.invokeLater(changed)
      },
    )
  }

  private fun colors(
    values: MutableMap<String, String>,
    value: Color,
    vararg names: String,
  ) {
    names.forEach { values[it] = color(value) }
  }

  private class ThemeColors(
    val scheme: EditorColorsScheme,
  ) {
    val foreground = UIManager.getColor("Label.foreground") ?: scheme.defaultForeground
    val background = UIManager.getColor("Panel.background") ?: scheme.defaultBackground
    val selected = UIManager.getColor("List.selectionBackground") ?: scheme.defaultBackground
    val selectedForeground = UIManager.getColor("List.selectionForeground") ?: foreground
    val muted = UIManager.getColor("Label.disabledForeground") ?: foreground
    val border = UIManager.getColor("Component.borderColor") ?: muted
    val error = effect(scheme, CodeInsightColors.ERRORS_ATTRIBUTES, foreground)
    val warning = effect(scheme, CodeInsightColors.WARNINGS_ATTRIBUTES, foreground)
    val success = effect(scheme, CodeInsightColors.INFORMATION_ATTRIBUTES, foreground)
  }

  private fun effect(
    scheme: EditorColorsScheme,
    key: com.intellij.openapi.editor.colors.TextAttributesKey,
    fallback: Color,
  ): Color = scheme.getAttributes(key)?.let { it.foregroundColor ?: it.effectColor } ?: fallback

  private fun color(
    value: Color,
    alpha: Int? = null,
  ): String = "#" + listOfNotNull(value.red, value.green, value.blue, alpha).joinToString("") { "%02x".format(it) }

  private fun quote(value: String): String =
    "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("<", "\\3c ") + "\""

  private const val DIFF_ALPHA = 32
}
