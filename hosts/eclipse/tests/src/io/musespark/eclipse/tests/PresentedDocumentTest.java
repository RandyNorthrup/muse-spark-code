package io.musespark.eclipse.tests;

import static org.junit.Assert.*;

import io.musespark.eclipse.PresentedDocument;
import org.junit.Test;

public class PresentedDocumentTest {
    @Test public void peerHtmlCannotRunAScriptOrSkipTheHostPolicy() {
        String peer = "<!DOCTYPE html><html><head>"
            + "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'unsafe-inline' https:\">"
            + "<script nonce=\"__MUSE_NONCE__\">evil()</script>"
            + "<iframe src=\"file:///etc/passwd\"></iframe>"
            + "<a href=\"javascript:evil()\">x</a>"
            + "</head><body onload=\"evil()\">shown</body></html>";
        String page = PresentedDocument.compose(peer, PresentedDocument.strictCsp("abc"), "window.__museHost=1;", "abc");
        assertFalse(page.contains("evil()"));
        assertFalse(page.contains("unsafe-inline"));
        assertFalse(page.contains("https:"));
        assertFalse(page.contains("<iframe"));
        assertFalse(page.contains("javascript:"));
        assertFalse(page.contains("onload"));
        assertFalse(page.contains("file:"));
        assertTrue(page.contains("shown"));
        assertTrue(page.contains("script-src 'nonce-abc'"));
        assertTrue(page.contains("window.__museHost=1;"));
        assertEquals(1, page.split("<script", -1).length - 1);
        assertThrows(IllegalArgumentException.class, () -> PresentedDocument.compose("<script>evil()</script>", "csp", "bridge", "n"));
    }
}
