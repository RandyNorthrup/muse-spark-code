package io.musespark.eclipse;
import org.eclipse.core.commands.*;
import org.eclipse.ui.handlers.HandlerUtil;
public final class CompleteHandler extends AbstractHandler {
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        try { Completion.invoke(MusePlugin.get().session(HandlerUtil.getActiveWorkbenchWindowChecked(event))); return null; }
        catch (Exception ex) { throw new ExecutionException("MHP_COMPLETION_FAILURE"); }
    }
}
