package io.musespark.eclipse;

import java.util.*;
import org.eclipse.core.runtime.Status;
import org.eclipse.ui.*;
import org.eclipse.ui.plugin.AbstractUIPlugin;
import org.osgi.framework.BundleContext;

public final class MusePlugin extends AbstractUIPlugin {
    private static volatile MusePlugin instance;
    // Registry access is guarded by this; close dispatches native state to its display.
    private final Map<IWorkbenchWindow, WindowSession> sessions = new HashMap<>();
    public static MusePlugin get() { return instance; }
    @Override public void start(BundleContext context) throws Exception { super.start(context); instance = this; }
    public synchronized WindowSession session(IWorkbenchWindow window) throws Exception {
        WindowSession session = sessions.get(window);
        if (session == null || session.isClosed()) { session = new WindowSession(window); sessions.put(window, session); }
        return session;
    }
    public void log(String code) { getLog().log(new Status(Status.WARNING, "io.musespark.eclipse", code)); }
    @Override public void stop(BundleContext context) throws Exception {
        List<WindowSession> owned;
        synchronized (this) { owned = List.copyOf(sessions.values()); sessions.clear(); }
        for (WindowSession session : owned) session.close();
        instance = null; super.stop(context);
    }
}
