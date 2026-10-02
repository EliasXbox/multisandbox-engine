package com.crossplay.minecraft;

import com.crossplay.network.RelayClient;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Location;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.JSONObject;

import java.net.URI;

public class MinecraftBridge extends JavaPlugin implements Listener {

    private RelayClient relayClient;

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);

        try {
            // Conecta ao Servidor Relay em Node.js
            URI serverUri = new URI("ws://localhost:8080");
            relayClient = new RelayClient(serverUri, "MINECRAFT", this::handleIncomingPacket);
            relayClient.connect();
        } catch (Exception e) {
            getLogger().severe("Falha ao iniciar cliente Relay: " + e.getMessage());
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        Location loc = event.getBlock().getLocation();
        String blockId = event.getBlock().getType().name().toLowerCase();

        // Envia o bloco colocado no MC para o Relay
        relayClient.sendBlockPlace(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ(), blockId, false);
    }

    private void handleIncomingPacket(JSONObject packet) {
        String type = packet.getString("type");

        if ("MC_SET_BLOCK".equals(type)) {
            int x = packet.getInt("x");
            int y = packet.getInt("y");
            int z = packet.getInt("z");
            String blockId = packet.getString("block_id");

            // Executa na Thread principal do Minecraft para colocar o bloco no mundo
            Bukkit.getScheduler().runTask(this, () -> {
                Location loc = new Location(Bukkit.getWorlds().get(0), x, y, z);
                Material mat = Material.matchMaterial(blockId);
                if (mat == null) mat = Material.STONE; // Fallback de segurança

                loc.getBlock().setType(mat);
            });
        }
    }
}