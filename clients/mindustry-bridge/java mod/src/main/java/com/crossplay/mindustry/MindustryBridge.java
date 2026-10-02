package com.crossplay.mindustry;

import com.crossplay.network.RelayClient;
import mindustry.game.EventType;
import mindustry.mod.Mod;
import mindustry.Vars;
import java.net.URI;

public class MindustryBridge extends Mod {

    private RelayClient relayClient;

    public MindustryBridge() {
        try {
            URI serverUri = new URI("ws://localhost:8080");
            relayClient = new RelayClient(serverUri, "MINDUSTRY", null);
            relayClient.connect();
        } catch (Exception e) {
            Vars.ui.showException(e);
        }

        // Escuta quando uma construção é finalizada no Mindustry
        mindustry.Vars.events.on(EventType.BlockBuildEndEvent.class, event -> {
            if (!event.breaking && relayClient != null) {
                int x = event.tile.x;
                int y = event.tile.y;
                String blockId = event.tile.block().name;

                // Envia para o Minecraft (Z é mantido como Y no Mindustry)
                relayClient.sendBlockPlace(x, y, 64, blockId, false);
            }
        });
    }
}