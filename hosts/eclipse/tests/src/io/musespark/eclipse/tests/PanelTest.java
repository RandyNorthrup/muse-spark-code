package io.musespark.eclipse.tests;

import static org.junit.Assert.*;
import com.google.gson.*;
import io.musespark.eclipse.*;
import java.util.*;
import org.junit.Test;

public class PanelTest {
    @Test public void panelRefusesUnreadyWrongSurfaceDirectionAndSequence() throws Exception {
        List<JsonObject> sent = new ArrayList<>(); PanelSurface surface = surface("chat", sent); surface.opened();
        assertThrows(IllegalStateException.class, surface::opened);
        assertThrows(IllegalArgumentException.class, () -> surface.post(Json.object("type", "ready")));
        surface.ready(); surface.post(Json.object("type", "ready"));
        JsonObject frame = inbound(1); surface.receive(frame);
        assertThrows(IllegalArgumentException.class, () -> surface.receive(frame));
        assertThrows(IllegalArgumentException.class, () -> surface.receive(inbound(3)));
        JsonObject wrong = inbound(2); wrong.addProperty("surface", "other"); JsonObject wrongSurface = wrong; assertThrows(IllegalArgumentException.class, () -> surface.receive(wrongSurface));
        wrong = inbound(2); wrong.addProperty("direction", "toHost"); wrong.add("payload", Json.object("type", "ready")); JsonObject direction = wrong; assertEquals("MHP_PANEL_WRONG_DIRECTION", assertThrows(IllegalArgumentException.class, () -> surface.receive(direction)).getMessage());
        surface.receive(inbound(2));
        assertEquals(1, sent.get(2).get("seq").getAsInt());
    }
    @Test public void rejectedPayloadDoesNotAdvanceAndSurfaceKindsAreIsolated() throws Exception {
        List<JsonObject> sent = new ArrayList<>(); PanelSurface surface = surface("tasks", sent); surface.opened(); surface.ready();
        assertThrows(IllegalArgumentException.class, () -> surface.post(Json.object("type", "sendMessage", "localId", "x", "text", "x", "attachmentIds", new JsonArray())));
        surface.post(Json.object("type", "tasksReady")); assertEquals(1, sent.get(2).get("seq").getAsInt());
        assertThrows(IllegalArgumentException.class, () -> surface.receive(inbound(1)));
    }
    @Test public void reloadRetainsStateAndSequencesAndSuppressesDuplicateReplay() throws Exception {
        List<JsonObject> sent = new ArrayList<>(); PanelSurface surface = surface("chat", sent); surface.opened(); surface.ready(); surface.post(Json.object("type", "ready"));
        surface.state(Json.object("draft", "unfinished")); surface.reload();
        assertThrows(IllegalArgumentException.class, () -> surface.receive(inbound(1)));
        surface.ready(); surface.post(Json.object("type", "ready")); surface.post(Json.object("type", "surfaceFocused"));
        assertEquals(2, sent.get(sent.size() - 1).get("seq").getAsInt());
        assertEquals("unfinished", surface.state().getAsJsonObject().get("draft").getAsString()); surface.receive(inbound(1));
        surface.hidden(); surface.receive(inbound(2));
    }
    @Test public void closePurgesCountsDropsClearsStateAndRefusesReuse() throws Exception {
        Contract contract = new Contract(); List<JsonObject> sent = new ArrayList<>(); List<String> logs = new ArrayList<>();
        PanelSurface surface = new PanelSurface(contract, "surface", "session", "chat", sent::add, id -> 2, logs::add);
        surface.opened(); surface.ready(); surface.state(Json.object("draft", "x")); surface.close(1);
        assertNull(surface.state()); assertEquals(3, sent.get(sent.size() - 1).get("droppedMessages").getAsInt()); assertEquals(List.of("MHP_PANEL_DROPPED 3"), logs);
        assertThrows(IllegalStateException.class, () -> surface.post(Json.object("type", "ready")));
        assertThrows(IllegalArgumentException.class, () -> surface.receive(inbound(1)));
    }
    @Test public void backpressureDoesNotConsumeSurfaceSequence() throws Exception {
        List<JsonObject> sent = new ArrayList<>(); boolean[] full = {false};
        PanelSurface surface = new PanelSurface(new Contract(), "surface", "session", "chat", frame -> { if (full[0]) throw new IllegalStateException("MHP_PANEL_BACKPRESSURE"); sent.add(frame); }, id -> 0, code -> fail(code));
        surface.opened(); surface.ready(); full[0] = true;
        assertThrows(IllegalStateException.class, () -> surface.post(Json.object("type", "ready")));
        full[0] = false; surface.post(Json.object("type", "ready")); assertEquals(1, sent.get(2).get("seq").getAsInt());
        full[0] = true;
        assertThrows(IllegalStateException.class, () -> surface.receive(inbound(1), payload -> { throw new IllegalStateException("MHP_PANEL_BACKPRESSURE"); }));
        surface.receive(inbound(1));
    }
    @Test public void transportFailureStillRetiresTheSurfaceAndRefusesReuse() throws Exception {
        List<JsonObject> sent = new ArrayList<>(); boolean[] offline = {false};
        PanelSurface surface = new PanelSurface(new Contract(), "surface", "session", "chat", frame -> {
            if (offline[0]) throw new IllegalStateException("MHP_CLOSED"); sent.add(frame);
        }, id -> 0, code -> fail(code));
        surface.opened(); surface.ready(); surface.state(Json.object("draft", "x")); offline[0] = true;
        assertEquals("MHP_CLOSED", assertThrows(IllegalStateException.class, () -> surface.close(0)).getMessage());
        assertFalse("retirement cannot depend on a live transport", surface.isReady()); assertNull(surface.state());
        surface.close(0);
        assertThrows(IllegalStateException.class, () -> surface.post(Json.object("type", "ready")));
        assertThrows(IllegalArgumentException.class, () -> surface.receive(inbound(1)));
    }
    private static PanelSurface surface(String kind, List<JsonObject> sent) throws Exception { return new PanelSurface(new Contract(), "surface", "session", kind, sent::add, id -> 0, code -> fail(code)); }
    private static JsonObject inbound(long seq) { return Json.object("mhp", "1.5", "kind", "panel", "surface", "surface", "direction", "toPanel", "seq", seq, "payload", Json.object("type", "conversationCleared")); }
}
