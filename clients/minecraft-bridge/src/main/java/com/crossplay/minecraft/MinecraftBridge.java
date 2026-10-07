package com.crossplay.minecraft;

import com.crossplay.network.RelayClient;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Phantom;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;
import org.json.JSONObject;

import java.net.URI;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class MinecraftBridge extends JavaPlugin implements Listener {
    private static final long PLAYER_SEND_INTERVAL_MS = 100L;

    private RelayClient relayClient;
    private final Set<String> mseCells = new HashSet<>();
    private final Map<String, Phantom> mindustryPlayerProxies = new HashMap<>();
    private final Map<UUID, Long> lastPlayerSend = new HashMap<>();

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        try {
            relayClient = new RelayClient(new URI("ws://localhost:8080"), "MINECRAFT", this::handleIncomingPacket);
            relayClient.connect();
        } catch (Exception e) {
            getLogger().severe("[MSE-MINECRAFT] Failed to start Relay client: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        for (Phantom proxy : mindustryPlayerProxies.values()) {
            if (proxy != null && proxy.isValid()) proxy.remove();
        }
        mindustryPlayerProxies.clear();
        if (relayClient != null) relayClient.close();
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        if (relayClient == null) return;
        Location loc = event.getBlock().getLocation();
        relayClient.sendBlockPlace(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ(),
                event.getBlock().getType().name().toLowerCase(), false);
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        if (relayClient == null) return;
        Location loc = event.getBlock().getLocation();
        relayClient.sendBlockBreak(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ());
    }

    @EventHandler
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        if (relayClient != null) relayClient.sendChatMessage(event.getPlayer().getName(), event.getMessage());
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        sendPlayer(event.getPlayer().getUniqueId(), event.getPlayer().getName(), event.getPlayer().getLocation());
    }

    @EventHandler
    public void onPlayerMove(PlayerMoveEvent event) {
        if (event.getTo() == null || relayClient == null) return;
        long now = System.currentTimeMillis();
        UUID id = event.getPlayer().getUniqueId();
        long last = lastPlayerSend.getOrDefault(id, 0L);
        if (now - last < PLAYER_SEND_INTERVAL_MS) return;
        lastPlayerSend.put(id, now);
        sendPlayer(id, event.getPlayer().getName(), event.getTo());
    }

    @EventHandler
    public void onPlayerQuit(PlayerQuitEvent event) {
        lastPlayerSend.remove(event.getPlayer().getUniqueId());
        if (relayClient != null) {
            relayClient.sendPlayerDespawn("MINECRAFT:" + event.getPlayer().getUniqueId(), event.getPlayer().getName());
        }
    }

    private void sendPlayer(UUID uuid, String name, Location loc) {
        if (relayClient == null) return;
        relayClient.sendPlayerState("MINECRAFT:" + uuid, name, loc.getX(), loc.getZ(), 5, loc.getYaw());
    }

    private String cellKey(int x, int y, int z) {
        return x + ":" + y + ":" + z;
    }

    private void clearTrackedMseCells() {
        if (Bukkit.getWorlds().isEmpty()) return;
        World world = Bukkit.getWorlds().get(0);
        for (String key : new HashSet<>(mseCells)) {
            String[] parts = key.split(":");
            if (parts.length != 3) continue;
            try {
                world.getBlockAt(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2]))
                        .setType(Material.AIR);
            } catch (NumberFormatException ignored) {}
        }
        mseCells.clear();
    }

    private void handleIncomingPacket(JSONObject packet) {
        String type = packet.optString("type", "UNKNOWN");
        getLogger().info("[MSE-MINECRAFT] RX type=" + type);

        if ("CONNECTED".equals(type)) return;

        if ("CHAT_MESSAGE".equals(type)) {
            String game = packet.optString("game", "UNKNOWN");
            String player = packet.optString("player", "Unknown");
            String message = packet.optString("message", "");
            Bukkit.getScheduler().runTask(this, () ->
                    Bukkit.broadcastMessage("[MSE][" + game + "] <" + player + "> " + message));
            return;
        }

        if ("WORLD_SNAPSHOT_BEGIN".equals(type)) {
            Bukkit.getScheduler().runTask(this, this::clearTrackedMseCells);
            return;
        }

        if ("WORLD_SNAPSHOT_END".equals(type)) {
            getLogger().info("[MSE-MINECRAFT] World snapshot applied at revision " + packet.optLong("revision", 0));
            return;
        }

        if ("PLAYER_STATE".equals(type)) {
            if ("MINDUSTRY".equalsIgnoreCase(packet.optString("source_game"))) {
                Bukkit.getScheduler().runTask(this, () -> applyMindustryPlayerProxy(packet));
            }
            return;
        }

        if ("PLAYER_DESPAWN".equals(type)) {
            String id = packet.optString("player_id");
            Bukkit.getScheduler().runTask(this, () -> removeMindustryPlayerProxy(id));
            return;
        }

        if (!"MC_SET_BLOCK".equals(type)) return;

        int x = packet.optInt("x");
        int y = packet.optInt("y", 2);
        int z = packet.optInt("z");
        String blockId = packet.optString("block_id", "minecraft:stone");

        Bukkit.getScheduler().runTask(this, () -> {
            if (Bukkit.getWorlds().isEmpty()) return;
            Material mat = Material.matchMaterial(blockId);
            if (mat == null) {
                getLogger().warning("[MSE-MINECRAFT] Unknown material " + blockId + "; using STONE.");
                mat = Material.STONE;
            }

            Bukkit.getWorlds().get(0).getBlockAt(x, y, z).setType(mat);
            String key = cellKey(x, y, z);
            if (mat == Material.AIR) mseCells.remove(key);
            else mseCells.add(key);
        });
    }

    private void applyMindustryPlayerProxy(JSONObject packet) {
        if (Bukkit.getWorlds().isEmpty()) return;
        String id = packet.optString("id", packet.optString("player_id", "MINDUSTRY:player"));
        String name = packet.optString("name", packet.optString("player", "MindustryPlayer"));
        double x = packet.optDouble("x", 0);
        double z = packet.optDouble("z", 0);
        double y = packet.optDouble("y", 5);
        float yaw = (float) packet.optDouble("rotation", 0);
        Location loc = new Location(Bukkit.getWorlds().get(0), x + 0.5, y, z + 0.5, yaw, 0);

        Phantom proxy = mindustryPlayerProxies.get(id);
        if (proxy == null || !proxy.isValid()) {
            proxy = (Phantom) Bukkit.getWorlds().get(0).spawnEntity(loc, EntityType.PHANTOM);
            proxy.setAI(false);
            proxy.setGravity(false);
            proxy.setInvulnerable(true);
            proxy.setSilent(true);
            proxy.setCollidable(false);
            proxy.setPersistent(false);
            proxy.setCustomName("[MSE] " + name);
            proxy.setCustomNameVisible(true);
            mindustryPlayerProxies.put(id, proxy);
        } else {
            proxy.teleport(loc);
        }
    }

    private void removeMindustryPlayerProxy(String id) {
        Phantom proxy = mindustryPlayerProxies.remove(id);
        if (proxy != null && proxy.isValid()) proxy.remove();
    }
}
