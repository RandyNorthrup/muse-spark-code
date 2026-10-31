package io.musespark.eclipse;
import java.util.UUID;
import org.eclipse.core.commands.*;
import org.eclipse.ui.*;
import org.eclipse.ui.handlers.HandlerUtil;
public final class OpenHandler extends AbstractHandler {
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        try { openPanel(HandlerUtil.getActiveWorkbenchWindowChecked(event)); return null; }
        catch (Exception ex) { throw new ExecutionException("MHP_VIEW_FAILURE"); }
    }
    public static void openPanel(IWorkbenchWindow window) throws Exception {
        IWorkbenchPage page = window.getActivePage();
        WindowSession session = MusePlugin.get().session(window);
        String owned = session.chatSession();
        MuseView active = null;
        for (IViewReference reference : page.getViewReferences()) {
            if (!reference.getId().equals("io.musespark.panel")) continue;
            IViewPart part = reference.getView(false);
            if (part == null || part instanceof MuseView view && view.binding() == null) page.hideView(reference);
            else if (part instanceof MuseView view && view.binding().session.equals(owned) && view.binding().kind.equals("chat")) active = view;
        }
        if (active != null) { page.activate(active); return; }
        // Without a runtime-owned chat session there is nothing to configure: the runtime's
        // initial surfaces/open creates the view once startup completes. Publishing an invented
        // session here would be rejected as unowned and leave a dead view behind.
        if (owned == null) return;
        String secondary = UUID.randomUUID().toString();
        MuseView.configure(secondary, owned, "chat", session);
        page.showView("io.musespark.panel", secondary, IWorkbenchPage.VIEW_ACTIVATE);
    }
}
