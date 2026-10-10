package io.musespark.eclipse;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.function.*;

/** Immutable binding and admission precede both browser execution and transport writes. */
public final class PanelSurface {
    private final Contract contract;
    private final Consumer<JsonObject> send;
    private final ToIntFunction<String> purge;
    private final Consumer<String> log;
    public final String id;
    public final String session;
    public final String kind;
    private long outgoing = 1;
    private long incoming = 1;
    private boolean opened;
    private volatile boolean ready;
    private volatile boolean closed;
    private boolean reloading;
    private JsonElement state;
    public PanelSurface(Contract contract, String id, String session, String kind, Consumer<JsonObject> send, ToIntFunction<String> purge, Consumer<String> log) {
        this.contract = contract; this.id = id; this.session = session; this.kind = kind; this.send = send; this.purge = purge; this.log = log;
        contract.panel("binding", Json.object("surface", id, "sessionId", session, "surfaceKind", kind));
    }
    public boolean isReady() { return ready && !closed; }
    public synchronized void opened() { if (opened || closed) throw new IllegalStateException("MHP_PANEL_INVALID_LIFECYCLE"); send.accept(lifecycle("opened")); opened = true; }
    public synchronized void ready() { checkOpen(); if (!opened) throw new IllegalStateException("MHP_PANEL_INVALID_LIFECYCLE"); send.accept(lifecycle("ready")); ready = true; }
    public synchronized void reload() {
        checkOpen();
        JsonObject frame = lifecycle("reloaded"); frame.add("stateRequest", stateRequest());
        contract.panel("lifecycle", frame); send.accept(frame); ready = false; reloading = true;
    }
    public synchronized void hidden() { checkOpen(); send.accept(lifecycle("hidden")); }
    public synchronized void post(JsonElement payload) {
        checkOpen();
        if (!ready) throw new IllegalArgumentException("MHP_PANEL_NOT_READY");
        contract.payload(kind, "toHost", payload);
        if (reloading && payload.isJsonObject() && stateRequest().isJsonObject() && payload.getAsJsonObject().get("type").equals(stateRequest().getAsJsonObject().get("type"))) { reloading = false; return; }
        JsonObject frame = Json.object("mhp", "1.5", "kind", "panel", "surface", id, "direction", "toHost", "seq", outgoing, "payload", payload);
        admit(frame, "toHost", outgoing); send.accept(frame); outgoing++;
    }
    public synchronized JsonElement receive(JsonObject frame) {
        return receive(frame, payload -> { });
    }
    public synchronized JsonElement receive(JsonObject frame, Consumer<JsonElement> enqueue) {
        admit(frame, "toPanel", incoming); enqueue.accept(frame.get("payload")); incoming++; return frame.get("payload");
    }
    private void admit(JsonObject frame, String direction, long sequence) {
        contract.panel("envelope", frame);
        if (closed || !id.equals(frame.get("surface").getAsString())) throw new IllegalArgumentException("MHP_PANEL_UNKNOWN_SURFACE");
        if (!direction.equals(frame.get("direction").getAsString())) throw new IllegalArgumentException("MHP_PANEL_WRONG_DIRECTION");
        if (sequence != frame.get("seq").getAsLong()) throw new IllegalArgumentException("MHP_PANEL_OUT_OF_ORDER");
        if (!ready) throw new IllegalArgumentException("MHP_PANEL_NOT_READY");
        if (frame.toString().getBytes(StandardCharsets.UTF_8).length > contract.frameCap) throw new IllegalArgumentException("MHP_PANEL_TOO_LARGE");
        contract.payload(kind, direction, frame.get("payload"));
    }
    public synchronized JsonElement state() { return state == null ? null : state.deepCopy(); }
    public synchronized void state(JsonElement value) { checkOpen(); contract.state(value); state = value.deepCopy(); }
    public synchronized void close(int browserDrops) {
        if (closed) return;
        try {
            int count = browserDrops + purge.applyAsInt(id);
            JsonObject frame = lifecycle("closed"); frame.addProperty("droppedMessages", count);
            contract.panel("lifecycle", frame); send.accept(frame);
            if (count != 0) log.accept("MHP_PANEL_DROPPED " + count);
        } finally { closed = true; ready = false; state = null; }
    }
    private void checkOpen() { if (closed) throw new IllegalStateException("MHP_PANEL_UNKNOWN_SURFACE"); }
    private JsonElement stateRequest() {
        return kind.equals("whatsNew") ? JsonNull.INSTANCE : Json.object("type", kind.equals("tasks") ? "tasksReady" : kind.equals("usage") ? "readUsage" : "ready");
    }
    private JsonObject lifecycle(String event) {
        JsonObject frame = Json.object("mhp", "1.5", "kind", "surface", "surface", id, "sessionId", session, "surfaceKind", kind, "event", event);
        if (!event.equals("closed") && !event.equals("reloaded")) contract.panel("lifecycle", frame);
        return frame;
    }
}
