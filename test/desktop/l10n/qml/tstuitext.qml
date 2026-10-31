// Muse Desktop (M111, D91.20) lane IN: the generated QML singleton under
// real Qt (qmltestrunner, offscreen). Run with:
//   node test/desktop/l10n/qml-check.mjs
import QtTest
import MuseL10n 1.0

TestCase {
    name: "UiText"

    function test_english_lookup() {
        UiText.localeName = "en"
        compare(UiText.text("desktop.orSignInWith"), "Or sign in with")
        compare(UiText.text("desktop.notificationsCount.other"), "{count} notifications")
    }

    function test_locale_switch_and_english_fallback() {
        UiText.localeName = "de"
        compare(UiText.text("desktop.orSignInWith"), "Oder anmelden mit")
        UiText.localeName = "xx"
        compare(UiText.text("desktop.orSignInWith"), "Or sign in with")
        UiText.localeName = "en"
    }

    function test_unknown_key_echoes() {
        UiText.localeName = "en"
        compare(UiText.text("desktop.noSuchKey"), "desktop.noSuchKey")
    }

    function test_direction_from_qt_locale_data() {
        verify(UiText.isRtl("ar"))
        verify(UiText.isRtl("he"))
        verify(!UiText.isRtl("en"))
        verify(!UiText.isRtl("de"))
        verify(!UiText.isRtl("ja"))
        UiText.localeName = "de"
        verify(!UiText.isRtl())
        UiText.localeName = "en"
    }

    function test_number_uses_qt_locale_grouping() {
        UiText.localeName = "en"
        compare(UiText.formatNumber(12345.678), "12,345.68")
        UiText.localeName = "de"
        compare(UiText.formatNumber(12345.678), "12.345,68")
        UiText.localeName = "en"
    }

    function test_date_uses_qt_locale_names() {
        UiText.localeName = "en"
        compare(UiText.formatDate(2026, 10, 31), "31 Oct 2026")
        UiText.localeName = "de"
        compare(UiText.formatDate(2026, 10, 31), "31 Okt. 2026")
        UiText.localeName = "en"
    }
}
