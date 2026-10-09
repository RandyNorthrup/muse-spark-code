package io.musespark.eclipse;
import org.eclipse.core.commands.*;
import org.eclipse.ui.handlers.HandlerUtil;
public final class OpenHandler extends AbstractHandler {
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        try { HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage().showView("io.musespark.panel"); return null; }
        catch (Exception ex) { throw new ExecutionException("MHP_VIEW_FAILURE"); }
    }
}
