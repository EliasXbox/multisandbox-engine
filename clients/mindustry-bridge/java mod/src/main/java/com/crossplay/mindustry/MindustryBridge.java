package com.crossplay.mindustry;

import com.crossplay.network.RelayClient;
import mindustry.Vars;
import mindustry.game.EventType;
import mindustry.mod.Mod;
import org.json.JSONObject;

import java.net.URI;

public class MindustryBridge extends Mod {
    private RelayClient relayClient;

    public MindustryBridge() {
        try {
            URI serverUri = new URI("ws://localhost:8080");
            relayClient = new RelayClient(serverUri, "MINDUSTRY", this::handleIncomingPacket);
            relayClient.connect();
        } catch (Exception e) {
            System.err.println("[MSE-MINDUSTRY] Failed to start Relay client: " + e.getMessage());
        }

        Vars.events.on(EventType.BlockBuildEndEvent.class, event -> {
            if (!event.breaking && relayClient != null) {
                int x = event.tile.x;
                int y = event.tile.y;
                String blockId = event.tile.block().name;

                System.out.println("[MSE-MINDUSTRY] PLACE_BLOCK local " + blockId +
                        " @ " + x + "," + y);
                relayClient.sendBlockPlace(x, y, 64, blockId, false);
            }
        });
    }

    private void handleIncomingPacket(JSONObject packet) {
        String type = packet.optString("type", "UNKNOWN");
        System.out.println("[MSE-MINDUSTRY] RX type=" + type + " packet=" + packet);

        if ("CONNECTED".equals(type)) {
            System.out.println("[MSE-MINDUSTRY] Relay handshake confirmed.");
        }

        // For this debug pass we only prove that Minecraft -> Mindustry packets arrive.
        // Applying Minecraft blocks to Mindustry will be implemented after transport is verified.
    }
}
