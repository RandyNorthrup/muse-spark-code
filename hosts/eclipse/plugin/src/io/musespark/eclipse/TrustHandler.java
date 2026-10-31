package io.musespark.eclipse;
import com.google.gson.*;
import org.eclipse.core.commands.*;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.ui.handlers.HandlerUtil;
public final class TrustHandler extends AbstractHandler {
    @Override public Object execute(ExecutionEvent event) throws ExecutionException {
        try {
            var window = HandlerUtil.getActiveWorkbenchWindowChecked(event);
            JsonObject table = Assets.table(org.eclipse.core.runtime.Platform.getNL());
            if (MessageDialog.openQuestion(window.getShell(), "Muse Spark Code (Unofficial)", table.get("hooksModelApiWarning").getAsString())) MusePlugin.get().session(window).grantTrust();
            return null;
        } catch (Exception ex) { throw new ExecutionException("MHP_TRUST_FAILURE"); }
    }
}
