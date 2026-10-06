package com.crossplay.minecraft;

import com.crossplay.network.RelayClient;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.JSONObject;

import java.net.URI;

public class MinecraftBridge extends JavaPlugin implements Listener {
    private RelayClient relayClient;

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);

        try {
            URI serverUri = new URI("ws://localhost:8080");
            relayClient = new RelayClient(serverUri, "MINECRAFT", this::handleIncomingPacket);
            relayClient.connect();
        } catch (Exception e) {
            getLogger().severe("[MSE-MINECRAFT] Failed to start Relay client: " + e.getMessage());
        }
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        if (relayClient == null) return;

        Location loc = event.getBlock().getLocation();
        String blockId = event.getBlock().getType().name().toLowerCase();
        getLogger().info("[MSE-MINECRAFT] PLACE_BLOCK local " + blockId + " @ " +
                loc.getBlockX() + "," + loc.getBlockY() + "," + loc.getBlockZ());

        relayClient.sendBlockPlace(
                loc.getBlockX(), loc.getBlockY(), loc.getBlockZ(), blockId, false);
    }

    @EventHandler
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        if (relayClient == null) return;
        relayClient.sendChatMessage(event.getPlayer().getName(), event.getMessage());
    }

    private void handleIncomingPacket(JSONObject packet) {
        String type = packet.optString("type", "UNKNOWN");
        getLogger().info("[MSE-MINECRAFT] RX type=" + type);

        if ("CONNECTED".equals(type)) {
            getLogger().info("[MSE-MINECRAFT] Relay handshake confirmed.");
            return;
        }

        if ("CHAT_MESSAGE".equals(type)) {
            String game = packet.optString("game", "UNKNOWN");
            String player = packet.optString("player", "Unknown");
            String message = packet.optString("message", "");
            Bukkit.getScheduler().runTask(this, () ->
                    Bukkit.broadcastMessage("[MSE][" + game + "] <" + player + "> " + message));
            return;
        }

        if (!"MC_SET_BLOCK".equals(type)) {
            getLogger().info("[MSE-MINECRAFT] Ignoring packet type " + type);
            return;
        }

        int x = packet.optInt("x");
        int logicalY = packet.optInt("y", 1);
        int y = logicalY + MSE_Y_OFFSET;
        int z = packet.optInt("z");
        String blockId = packet.optString("block_id", "STONE");

        getLogger().info("[MSE-MINECRAFT] Scheduling " + blockId + " @ " + x + "," + y + "," + z +
                " (MSE logical Y=" + logicalY + ", offset=+" + MSE_Y_OFFSET + ")");

        Bukkit.getScheduler().runTask(this, () -> {
            if (Bukkit.getWorlds().isEmpty()) {
                getLogger().severe("[MSE-MINECRAFT] No loaded world available.");
                return;
            }

            Material mat = Material.matchMaterial(blockId);
            if (mat == null) {
                getLogger().warning("[MSE-MINECRAFT] Unknown material " + blockId + "; using STONE.");
                mat = Material.STONE;
            }

            Location loc = new Location(Bukkit.getWorlds().get(0), x, y, z);
            loc.getBlock().setType(mat);
            getLogger().info("[MSE-MINECRAFT] Applied " + mat.name() + " @ " + x + "," + y + "," + z);
        });
    }
}
