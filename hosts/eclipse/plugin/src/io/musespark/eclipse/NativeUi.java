package io.musespark.eclipse;

import com.google.gson.*;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.List;
import java.util.function.BooleanSupplier;
import org.eclipse.jface.dialogs.*;
import org.eclipse.jface.action.*;
import org.eclipse.ui.*;
import org.eclipse.jface.viewers.LabelProvider;
import org.eclipse.jface.window.Window;
import org.eclipse.swt.SWT;
import org.eclipse.swt.dnd.*;
import org.eclipse.swt.program.Program;
import org.eclipse.swt.widgets.*;
import org.eclipse.ui.dialogs.ElementListSelectionDialog;

/** Window-owned native prompts; choice identifiers are opaque, never translated decisions. */
public class NativeUi implements AutoCloseable {
    private final WindowSession owner;
    private record Notice(IStatusLineManager manager, ContributionItem item) { }
    private final Map<String, Notice> notices = new HashMap<>();
    private final Set<Window> dialogs = new HashSet<>();
    private boolean closed;
    public NativeUi(WindowSession owner) { this.owner = owner; }
    private void current(BooleanSupplier cancelled) {
        if (closed || owner.isClosed()) throw new IllegalArgumentException("MHP_CLOSED");
        if (cancelled.getAsBoolean()) throw new IllegalArgumentException("MHP_CANCELLED");
    }
    public JsonElement request(String method, JsonObject params, BooleanSupplier cancelled) throws Exception {
        current(cancelled);
        Shell shell = owner.window.getShell();
        return switch (method) {
            case "ui/confirm" -> {
                JsonArray choices = params.getAsJsonArray("choices");
                String[] labels = choices.asList().stream().map(value -> value.getAsJsonObject().get("title").getAsString()).toArray(String[]::new);
                MessageDialog dialog = new MessageDialog(shell, params.get("title").getAsString(), null, params.get("message").getAsString(), MessageDialog.QUESTION, labels, -1);
                int choice = open(dialog, cancelled);
                yield choice >= 0 && choice < choices.size() ? choices.get(choice).getAsJsonObject().get("id").deepCopy() : JsonNull.INSTANCE;
            }
            case "ui/input" -> {
                InputDialog dialog = new InputDialog(shell, params.get("title").getAsString(), params.get("prompt").getAsString(), params.has("value") ? params.get("value").getAsString() : "", null);
                yield open(dialog, cancelled) == Window.OK ? new JsonPrimitive(dialog.getValue()) : JsonNull.INSTANCE;
            }
            case "ui/pick" -> {
                ElementListSelectionDialog dialog = new ElementListSelectionDialog(shell, new LabelProvider() {
                    @Override public String getText(Object value) { return ((JsonObject) value).get("title").getAsString(); }
                });
                dialog.setTitle(params.get("title").getAsString()); dialog.setMultipleSelection(params.get("multiple").getAsBoolean());
                dialog.setElements(params.getAsJsonArray("items").asList().stream().map(JsonElement::getAsJsonObject).toArray());
                if (open(dialog, cancelled) != Window.OK) yield JsonNull.INSTANCE;
                JsonArray result = new JsonArray(); for (Object value : dialog.getResult()) result.add(((JsonObject) value).get("id").deepCopy());
                yield result;
            }
            case "ui/clipboard" -> {
                Clipboard clipboard = new Clipboard(shell.getDisplay());
                try { current(cancelled); clipboard.setContents(new Object[] {params.get("text").getAsString()}, new Transfer[] {TextTransfer.getInstance()}); } finally { clipboard.dispose(); }
                yield JsonNull.INSTANCE;
            }
            case "ui/openExternal" -> {
                URI target = externalTarget(params.get("uri").getAsString());
                current(cancelled); if (!Program.launch(target.toASCIIString())) throw new IllegalArgumentException("MHP_UI_UNAVAILABLE");
                yield JsonNull.INSTANCE;
            }
            case "ui/notify" -> {
                int kind = switch (params.get("severity").getAsString()) { case "error" -> MessageDialog.ERROR; case "warning" -> MessageDialog.WARNING; default -> MessageDialog.INFORMATION; };
                String label = org.eclipse.jface.resource.JFaceResources.getString("ok");
                open(new MessageDialog(shell, shell.getText(), null, params.get("message").getAsString(), kind, new String[] {label}, 0), cancelled);
                yield JsonNull.INSTANCE;
            }
            case "ui/status", "ui/progress" -> { notice(method, params, cancelled); yield JsonNull.INSTANCE; }
            case "ui/openFile" -> {
                current(cancelled);
                String[] chosen = chooseFile(SWT.OPEN, params.get("title").getAsString(), null);
                current(cancelled);
                yield chosen == null ? JsonNull.INSTANCE : new JsonPrimitive(Path.of(chosen[1]).toUri().toASCIIString());
            }
            case "ui/saveText" -> {
                current(cancelled);
                String[] chosen = chooseFile(SWT.SAVE, params.get("title").getAsString(), params.get("suggestedName").getAsString());
                current(cancelled);
                if (chosen == null) { yield new JsonPrimitive(false); }
                current(cancelled);
                try { Files.writeString(Path.of(chosen[1]), params.get("text").getAsString(), StandardCharsets.UTF_8, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING); }
                catch (IOException ex) { throw new IllegalArgumentException("MHP_SAVE_FAILED"); }
                yield new JsonPrimitive(true);
            }
            case "ui/showSetting" -> {
                current(cancelled);
                // Eclipse preferences do not expose the runtime's requested setting.
                throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
            }
            default -> throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
        };
    }
    protected String[] chooseFile(int style, String title, String fileName) {
        FileDialog dialog = new FileDialog(owner.window.getShell(), style);
        dialog.setText(title);
        if (fileName != null) dialog.setFileName(fileName);
        String name = dialog.open();
        return name == null ? null : new String[] {dialog.getFilterPath(), name};
    }
    public static URI externalTarget(String value) {
        URI target = URI.create(value);
        if (!Set.of("http", "https").contains(target.getScheme())) throw new IllegalArgumentException("MHP_PERMISSION_DENIED");
        return target;
    }
    private int open(Window dialog, BooleanSupplier cancelled) {
        current(cancelled); dialogs.add(dialog);
        Display display = owner.window.getShell().getDisplay();
        Runnable poll = new Runnable() {
            @Override public void run() {
                if (!dialogs.contains(dialog)) return;
                if (closed || owner.isClosed() || cancelled.getAsBoolean()) dialog.close();
                else display.timerExec(100, this);
            }
        };
        display.timerExec(100, poll);
        try { int result = dialog.open(); current(cancelled); return result; }
        finally { dialogs.remove(dialog); dialog.close(); display.timerExec(-1, poll); }
    }
    private void notice(String method, JsonObject params, BooleanSupplier cancelled) {
        JsonPrimitive value = params.getAsJsonPrimitive("id");
        String id = method + ":" + (value.isString() ? value : new JsonPrimitive(value.getAsLong()));
        Notice previous = notices.remove(id); if (previous != null) { previous.manager.remove(previous.item); previous.item.dispose(); previous.manager.update(true); }
        boolean done = method.equals("ui/status") ? !params.get("visible").getAsBoolean() : params.get("done").getAsBoolean();
        if (done) return;
        if (notices.size() >= owner.contract.queueMessages) throw new IllegalArgumentException("MHP_PANEL_BACKPRESSURE");
        current(cancelled);
        IWorkbenchPart part = owner.window.getActivePage().getActivePart();
        IActionBars bars = part != null && part.getSite() instanceof IViewSite site ? site.getActionBars() : part != null && part.getSite() instanceof IEditorSite site ? site.getActionBars() : null;
        if (bars == null) throw new IllegalArgumentException("MHP_UI_UNAVAILABLE");
        if (params.has("command") && !owner.hasCommand(params.get("command").getAsString())) throw new IllegalArgumentException("MHP_CAPABILITY_UNAVAILABLE");
        String text = method.equals("ui/status") ? params.get("text").getAsString() : params.get("title").getAsString();
        ControlContribution item = new ControlContribution(id) {
            @Override protected Control createControl(Composite parent) {
                Composite container = new Composite(parent, SWT.NONE); container.setLayout(new org.eclipse.swt.layout.RowLayout());
                Label label = new Label(container, SWT.NONE); label.setText(text);
                if (params.has("message")) label.setToolTipText(params.get("message").getAsString());
                if (method.equals("ui/progress")) {
                    ProgressBar progress = new ProgressBar(container, params.has("fraction") ? SWT.NONE : SWT.INDETERMINATE);
                    if (params.has("fraction")) progress.setSelection((int) Math.round(params.get("fraction").getAsDouble() * progress.getMaximum()));
                }
                if (params.has("command")) label.addListener(SWT.MouseUp, event -> { if (!closed && !owner.isClosed()) owner.notify("commands/execute", Json.object("id", params.get("command"))); });
                return container;
            }
        };
        current(cancelled); IStatusLineManager manager = bars.getStatusLineManager();
        notices.put(id, new Notice(manager, item)); manager.add(item); manager.update(true);
    }
    @Override public void close() {
        closed = true;
        for (Window dialog : List.copyOf(dialogs)) dialog.close(); dialogs.clear();
        for (Notice notice : List.copyOf(notices.values())) { notice.manager.remove(notice.item); notice.item.dispose(); notice.manager.update(true); } notices.clear();
    }
}
