package io.musespark.eclipse;

import java.util.regex.Pattern;

/**
 * Peer HTML is shown only inside the host document. A script, frame, foreign
 * content-security policy or event handler from the runtime does not run, and
 * the host policy is installed even when the peer document omitted one.
 */
public final class PresentedDocument {
    private static final Pattern SCRIPT = Pattern.compile("(?is)<script\\b[^>]*>.*?</script\\s*>");
    private static final Pattern SCRIPT_OPEN = Pattern.compile("(?i)<script\\b");
    private static final Pattern CSP = Pattern.compile("(?i)<meta\\b[^>]*http-equiv\\s*=\\s*[\"']?content-security-policy[\"']?[^>]*>");
    private static final Pattern REFRESH = Pattern.compile("(?i)<meta\\b[^>]*http-equiv\\s*=\\s*[\"']?refresh[\"']?[^>]*>");
    private static final Pattern FRAMED = Pattern.compile("(?is)<(?:iframe|object|embed|base)\\b[^>]*(?:>.*?</(?:iframe|object|embed|base)\\s*>|/?>)");
    private static final Pattern LINK = Pattern.compile("(?is)<link\\b[^>]*>");
    private static final Pattern HANDLER = Pattern.compile("(?i)\\s+on[a-z]+\\s*=\\s*(?:\"[^\"]*\"|'[^']*'|[^\\s>]+)");
    private static final Pattern SCRIPT_URL = Pattern.compile("(?i)(\\s(?:href|src|action)\\s*=\\s*)(?:([\"'])\\s*javascript:[^\"']*\\2|javascript:[^\\s>]*)");
    private static final Pattern HEAD = Pattern.compile("(?i)<head>");
    private PresentedDocument() { }
    public static String admit(String html) {
        String document = SCRIPT.matcher(html).replaceAll("");
        if (SCRIPT_OPEN.matcher(document).find()) throw new IllegalArgumentException("MHP_INVALID_HTML");
        document = CSP.matcher(document).replaceAll("");
        document = REFRESH.matcher(document).replaceAll("");
        document = FRAMED.matcher(document).replaceAll("");
        document = LINK.matcher(document).replaceAll("");
        document = HANDLER.matcher(document).replaceAll("");
        document = SCRIPT_URL.matcher(document).replaceAll("$1\"\"");
        if (!HEAD.matcher(document).find() || !java.util.regex.Pattern.compile("(?i)</head>").matcher(document).find()) throw new IllegalArgumentException("MHP_INVALID_HTML");
        return document;
    }
    /** The presented document's policy: no file URL, no remote URL, host nonce only. */
    public static String strictCsp(String nonce) {
        return "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data:; font-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src swt://browserfunction; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'\">";
    }
    public static String compose(String html, String cspMeta, String bootstrap, String nonce) {
        String admitted = admit(html);
        java.util.regex.Matcher head = HEAD.matcher(admitted);
        if (!head.find()) throw new IllegalArgumentException("MHP_INVALID_HTML");
        String script = "<script nonce=\"" + nonce + "\">" + bootstrap + "</script>";
        return admitted.substring(0, head.end()) + cspMeta + script + admitted.substring(head.end());
    }
}
