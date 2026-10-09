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
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.CompletableFuture;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public class MinecraftBridge extends JavaPlugin implements Listener {
    private static final long PLAYER_SEND_INTERVAL_MS = 100L;

    private RelayClient relayClient;
    private SurvivalFoundation survival;
    private BuildingRecipes buildingRecipes;
    private MindustryItems mindustryItems;
    public MindustryItems mindustryItems() { return mindustryItems; }
    private BuildingInteractions interactions;
    private MseWorkshop workshop;
    public void openWorkshop(org.bukkit.entity.Player player) { workshop.open(player,0,false); }
    public JSONObject catalogResource(String name) {
        try (java.io.InputStream input = getResource(name)) {
            if (input == null) throw new IllegalStateException("Missing catalog: " + name);
            return new JSONObject(new String(input.readAllBytes(), StandardCharsets.UTF_8));
        } catch (java.io.IOException error) { throw new IllegalStateException(error); }
    }
    public BuildingRecipes buildingRecipes() { return buildingRecipes; }
    public long worldEpoch() { return appliedWorldEpoch; }
    public void sendGameplay(JSONObject packet) {
        if (relayClient != null && relayClient.isOpen()) relayClient.send(packet.put("game", "MINECRAFT").put("world_epoch", packet.optLong("world_epoch", appliedWorldEpoch)).toString());
    }
    private MseWorldRules worldRules;
    private MindustryCombat combat;
    private Location mapSpawn;
    private boolean relocateAfterSnapshot;
    public boolean readyForGameplay() { return appliedWorldEpoch != 0 && !survival.applyingSnapshot() && relayClient != null && relayClient.isOpen(); }
    public Location safeSpawn() { return mapSpawn != null ? mapSpawn.clone() : Bukkit.getWorlds().get(0).getSpawnLocation(); }
    public org.bukkit.entity.LivingEntity spawnProxy(Location location, EntityType type) {
        spawningProxy = true;
        try { return (org.bukkit.entity.LivingEntity) location.getWorld().spawnEntity(location, type); }
        finally { spawningProxy = false; }
    }
    private boolean spawningProxy;
    public boolean isSpawningProxy() { return spawningProxy; }
    public boolean isMseProxy(org.bukkit.entity.Entity entity) { return mindustryPlayerProxies.containsValue(entity) || combat != null && combat.isProxy(entity); }
    private final Set<String> mseCells = new HashSet<>();
    private final Map<String, Phantom> mindustryPlayerProxies = new HashMap<>();
    private final Map<UUID, Long> lastPlayerSend = new HashMap<>();
    private final Map<UUID, Long> lastBuildingHint = new HashMap<>();
    private final Queue<JSONObject> worldPackets = new ArrayBlockingQueue<>(1024);
    private final AtomicReference<JSONObject> streamReset = new AtomicReference<>();
    private volatile long activeStreamId;
    private long appliedWorldEpoch;
    private int worldEnvironment = 1;
    public int worldEnvironment() { return worldEnvironment; }
    private boolean mustClearOldMap;
    private Set<String> snapshotRemaining;
    private final Map<String, Long> snapshotOverrides = new HashMap<>();
    private JSONObject snapshotEnd;
    private CompletableFuture<Void> ownershipSave = CompletableFuture.completedFuture(null);
    private final Queue<String> cellsToClear = new ArrayDeque<>();
    private CompletableFuture<java.util.List<String>> clearPlan;
    private final Map<Long, CompletableFuture<?>> pendingChunks = new HashMap<>();
    private final java.util.LinkedHashMap<Long, int[]> chunkTickets = new java.util.LinkedHashMap<>(32, .75f, true);
    private java.lang.reflect.Method asyncChunkLoader;
    private boolean chunkLoaderChecked;

    private boolean prepareChunk(World world, int x, int z) {
        int cx = x >> 4, cz = z >> 4;
        long key = ((long) cx << 32) ^ (cz & 0xffffffffL);
        if (world.isChunkLoaded(cx, cz)) {
            pendingChunks.remove(key);
            if (!chunkTickets.containsKey(key)) {
                world.addPluginChunkTicket(cx, cz, this); chunkTickets.put(key, new int[]{cx, cz});
                if (chunkTickets.size() > 16) {
                    Long oldest = chunkTickets.keySet().iterator().next(); int[] chunk = chunkTickets.remove(oldest);
                    world.removePluginChunkTicket(chunk[0], chunk[1], this);
                }
            } else chunkTickets.get(key);
            return true;
        }
        if (!chunkLoaderChecked) {
            chunkLoaderChecked = true;
            try { asyncChunkLoader = world.getClass().getMethod("getChunkAtAsync", int.class, int.class, boolean.class); }
            catch (NoSuchMethodException ignored) { getLogger().warning("Async chunk loading unavailable; use Purpur/Paper for large maps."); }
        }
        if (asyncChunkLoader == null) return true;
        if (!pendingChunks.containsKey(key) && pendingChunks.size() < 4) {
            try { pendingChunks.put(key, (CompletableFuture<?>) asyncChunkLoader.invoke(world, cx, cz, true)); }
            catch (ReflectiveOperationException error) {
                getLogger().warning("Could not request chunk " + cx + "," + cz + ": " + error.getMessage());
            }
        }
        return false;
    }

    private void releaseChunkTickets(World world) {
        pendingChunks.clear(); world.removePluginChunkTickets(this); chunkTickets.clear();
    }

    @Override
    public void onEnable() {
        getServer().getPluginManager().registerEvents(this, this);
        mindustryItems = new MindustryItems(this, catalogResource("mindustry-content.json"));
        survival = new SurvivalFoundation(this);
        buildingRecipes = new BuildingRecipes(this);
        interactions = new BuildingInteractions(this, mindustryItems);
        getServer().getPluginManager().registerEvents(interactions, this);
        workshop = new MseWorkshop(this, catalogResource("block-mappings.json"), mindustryItems);
        getServer().getPluginManager().registerEvents(workshop, this);
        Bukkit.getScheduler().runTaskTimer(this, interactions::tick, 20L, 20L);
        worldRules = new MseWorldRules(this);
        combat = new MindustryCombat(this);
        getServer().getPluginManager().registerEvents(combat, this);
        Bukkit.getScheduler().runTaskTimer(this, combat::tick, 2L, 2L);
        getServer().getPluginManager().registerEvents(worldRules, this);
        Bukkit.getScheduler().runTask(this, worldRules::removeUnrelatedCreatures);
        getServer().getPluginManager().registerEvents(survival, this);
        try {
            File ownership = new File(getDataFolder(), "synced-cells.txt");
            if (ownership.isFile()) mseCells.addAll(Files.readAllLines(ownership.toPath(), StandardCharsets.UTF_8));
        } catch (Exception e) { getLogger().warning("Could not load synced cells: " + e.getMessage()); }
        Bukkit.getScheduler().runTaskTimer(this, this::applyWorldPackets, 1L, 1L);
        Bukkit.getScheduler().runTaskTimer(this, () -> {
            for (org.bukkit.entity.Player player : Bukkit.getOnlinePlayers()) {
                sendPlayer(player.getUniqueId(), player.getName(), player.getLocation());
            }
        }, 2L, 2L);
        try {
            relayClient = new RelayClient(new URI("ws://localhost:8080"), "MINECRAFT", this::handleIncomingPacket);
            relayClient.connect();
            Bukkit.getScheduler().runTaskTimerAsynchronously(this, () -> {
                if (relayClient != null) relayClient.tryReconnect();
            }, 20L, 20L);
        } catch (Exception e) {
            getLogger().severe("[MSE-MINECRAFT] Failed to start Relay client: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (!Bukkit.getWorlds().isEmpty()) releaseChunkTickets(Bukkit.getWorlds().get(0));
        if (relayClient != null) relayClient.stop();
        if (combat != null) combat.clear();
        if (survival != null) survival.close();
        if (buildingRecipes != null) buildingRecipes.close();
        if (interactions != null) interactions.close();
        saveTrackedCells();
        ownershipSave.join();
        for (Phantom proxy : mindustryPlayerProxies.values()) {
            if (proxy != null && proxy.isValid()) proxy.remove();
        }
        mindustryPlayerProxies.clear();
        if (relayClient != null) relayClient.close();
    }

    @EventHandler(ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        if (relayClient == null) return;
        String building = buildingRecipes.block(event.getItemInHand());
        if (event.getPlayer().getGameMode() == org.bukkit.GameMode.SURVIVAL && building == null) {
            String mapped = buildingRecipes.mappedBuilding(event.getBlock().getType());
            long now = System.currentTimeMillis();
            if (mapped != null && now - lastBuildingHint.getOrDefault(event.getPlayer().getUniqueId(), 0L) > 20000) {
                event.getPlayer().sendMessage("[MSE] This is an ordinary Minecraft block. To build in Mindustry, craft [MSE] " + buildingRecipes.label(mapped) + " in the recipe book or MSE Workshop.");
                lastBuildingHint.put(event.getPlayer().getUniqueId(), now);
            }
            return;
        }
        Location loc = event.getBlock().getLocation();
        int facing = (int)Math.floorMod(Math.round((event.getPlayer().getLocation().getYaw()+90)/90f)*90,360);
        if (event.getBlock().getBlockData() instanceof org.bukkit.block.data.Directional directional) {
            facing = switch (directional.getFacing()) { case EAST -> 0; case SOUTH -> 90; case WEST -> 180; case NORTH -> 270; default -> 0; };
        }
        if (building != null) {
            if (!buildingRecipes.compatible(building,worldEnvironment)) {
                event.setCancelled(true); event.getPlayer().sendMessage("§c[MSE] This building cannot operate in this map environment."); return;
            }
            if (!readyForGameplay() || !relayClient.isOpen()) { event.setCancelled(true); return; }
            sendGameplay(new JSONObject().put("type", "PLACE_BLOCK").put("block_id", event.getBlock().getType().name())
                    .put("mindustry_block", building).put("facing", facing).put("x", loc.getBlockX()).put("y", loc.getBlockY()).put("z", loc.getBlockZ()));
            return;
        }
        sendGameplay(new JSONObject().put("type", "PLACE_BLOCK").put("x", loc.getBlockX()).put("y", loc.getBlockY())
                .put("z", loc.getBlockZ()).put("facing", facing).put("block_id", event.getBlock().getType().name().toLowerCase()));
    }

    @EventHandler(priority = org.bukkit.event.EventPriority.HIGHEST, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        if (relayClient == null) return;
        Location loc = event.getBlock().getLocation();
        if (!isTrackedCell(loc)) return;
        // Synced structures have one canonical owner and do not yield duplicate vanilla drops.
        if (event.getPlayer().getGameMode() == org.bukkit.GameMode.SURVIVAL) {
            event.setCancelled(true);
            sendGameplay(new JSONObject().put("type", "BREAK_BLOCK").put("x", loc.getBlockX()).put("y", loc.getBlockY())
                    .put("z", loc.getBlockZ()).put("refund", true).put("player_id", event.getPlayer().getUniqueId().toString()));
            return;
        }
        sendGameplay(new JSONObject().put("type", "BREAK_BLOCK").put("x", loc.getBlockX()).put("y", loc.getBlockY()).put("z", loc.getBlockZ()));
    }

    @EventHandler
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        if (relayClient != null) relayClient.sendChatMessage(event.getPlayer().getName(), event.getMessage());
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent event) {
        buildingRecipes.discover(event.getPlayer());
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
        org.bukkit.entity.Player player = Bukkit.getPlayer(uuid);
        if (player == null || !loc.getWorld().equals(Bukkit.getWorlds().get(0))) return;
        int protection = 0;
        for (org.bukkit.inventory.ItemStack item : player.getInventory().getArmorContents())
            if (item != null) protection += item.getEnchantmentLevel(org.bukkit.enchantments.Enchantment.PROTECTION_ENVIRONMENTAL);
        sendGameplay(new JSONObject().put("type", "PLAYER_STATE").put("player_id", "MINECRAFT:" + uuid).put("player", name)
                .put("x", loc.getX()).put("z", loc.getZ()).put("mse_y", 5).put("rotation", loc.getYaw())
                .put("life_id", combat.life(player)).put("health_fraction", player.getHealth() /
                        player.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue())
                .put("creative", player.getGameMode() != org.bukkit.GameMode.SURVIVAL)
                .put("armor", player.getAttribute(org.bukkit.attribute.Attribute.GENERIC_ARMOR).getValue())
                .put("toughness", player.getAttribute(org.bukkit.attribute.Attribute.GENERIC_ARMOR_TOUGHNESS).getValue())
                .put("protection", protection));
    }

    private String cellKey(int x, int y, int z) {
        return x + ":" + y + ":" + z;
    }

    public boolean isTrackedCell(Location loc) {
        return !Bukkit.getWorlds().isEmpty() && loc.getWorld().equals(Bukkit.getWorlds().get(0)) &&
                mseCells.contains(cellKey(loc.getBlockX(), loc.getBlockY(), loc.getBlockZ()));
    }

    private void clearTrackedMseCells() {
        planCellRemoval(mseCells);
    }

    private void planCellRemoval(Set<String> cells) {
        ArrayList<String> snapshot = new ArrayList<>(cells);
        clearPlan = CompletableFuture.supplyAsync(() -> {
            java.util.TreeMap<Long, java.util.List<String>> chunks = new java.util.TreeMap<>();
            for (String cell : snapshot) {
                int first = cell.indexOf(':'), last = cell.lastIndexOf(':');
                if (first < 0 || last <= first) continue;
                try {
                    int x = Integer.parseInt(cell, 0, first, 10) >> 4;
                    int z = Integer.parseInt(cell, last + 1, cell.length(), 10) >> 4;
                    long key = ((long) x << 32) ^ (z & 0xffffffffL);
                    chunks.computeIfAbsent(key, unused -> new ArrayList<>()).add(cell);
                } catch (NumberFormatException ignored) {}
            }
            ArrayList<String> ordered = new ArrayList<>(snapshot.size());
            for (java.util.List<String> chunk : chunks.values()) ordered.addAll(chunk);
            return ordered;
        });
    }

    private void saveTrackedCells() {
        ArrayList<String> ownership = new ArrayList<>(mseCells);
        File target = new File(getDataFolder(), "synced-cells.txt");
        ownershipSave = ownershipSave.handle((unused, error) -> null).thenRunAsync(() -> {
            try {
                target.getParentFile().mkdirs();
                File temp = new File(target.getParentFile(), "synced-cells.txt.tmp");
                Files.write(temp.toPath(), ownership, StandardCharsets.UTF_8);
                Files.move(temp.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            } catch (Exception e) { getLogger().warning("Could not save synced cells: " + e.getMessage()); }
        });
    }

    private void applyWorldPackets() {
        if (Bukkit.getWorlds().isEmpty()) return;
        World world = Bukkit.getWorlds().get(0);
        if (streamReset.getAndSet(null) != null) {
            releaseChunkTickets(world);
            clearPlan = null;
            cellsToClear.clear(); snapshotRemaining = null; snapshotOverrides.clear(); snapshotEnd = null;
        }
        long deadline = System.nanoTime() + 4_000_000L;
        // Bound each tick's work so full-map snapshots do not schedule thousands of tasks.
        for (int count = 0; count < 1000 && System.nanoTime() < deadline; count++) {
            if (clearPlan != null) {
                if (!clearPlan.isDone()) break;
                cellsToClear.addAll(clearPlan.join()); clearPlan = null;
            }
            if (!cellsToClear.isEmpty()) {
                String key = cellsToClear.peek();
                String[] parts = key.split(":");
                if (parts.length == 3) {
                    try {
                        int x = Integer.parseInt(parts[0]), y = Integer.parseInt(parts[1]), z = Integer.parseInt(parts[2]);
                        if (!prepareChunk(world, x, z)) break;
                        org.bukkit.block.Block oldBlock = world.getBlockAt(x, y, z);
                        if (oldBlock.getType() != Material.AIR) oldBlock.setType(Material.AIR, false);
                    } catch (NumberFormatException ignored) {}
                }
                cellsToClear.poll();
                mseCells.remove(key);
                continue;
            }
            JSONObject packet = worldPackets.peek();
            if (packet == null) break;
            if (packet.optLong("stream_id", activeStreamId) != activeStreamId) { worldPackets.poll(); continue; }
            String type = packet.optString("type");
            if ("MC_SET_BLOCK".equals(type) && !prepareChunk(world, packet.optInt("x"), packet.optInt("z"))) break;
            if (("WORLD_SNAPSHOT_END".equals(type) || "WORLD_PLAY_AREA_READY".equals(type)) && mapSpawn != null && !prepareChunk(world, mapSpawn.getBlockX(), mapSpawn.getBlockZ())) break;
            worldPackets.poll();
            if ("WORLD_BATCH_ACK".equals(type)) {
                if (snapshotEnd != null) {
                    survival.endSnapshot(); saveTrackedCells();
                    if (relocateAfterSnapshot && mapSpawn != null) {
                        mapSpawn.setY(world.getHighestBlockYAt(mapSpawn.getBlockX(), mapSpawn.getBlockZ()) + 1);
                        world.setSpawnLocation(mapSpawn);
                        for (org.bukkit.entity.Player player : world.getPlayers()) player.teleport(mapSpawn);
                        relocateAfterSnapshot = false;
                    }
                    getLogger().info("[MSE] World snapshot applied: " + snapshotEnd.optInt("object_count") + " objects.");
                    snapshotEnd = null;
                    releaseChunkTickets(world);
                }
                relayClient.acknowledgeBatch(packet.optLong("stream_id"), packet.optLong("batch_id"));
                continue;
            }
            if ("WORLD_SNAPSHOT_BEGIN".equals(type)) {
                getLogger().info("[MSE] Applying world snapshot in acknowledged batches.");
                long nextEpoch = packet.optJSONObject("meta") == null ? 0 : packet.getJSONObject("meta").optLong("world_epoch");
                JSONObject spawn = packet.optJSONObject("meta") == null ? null : packet.getJSONObject("meta").optJSONObject("spawn");
                worldEnvironment = packet.optJSONObject("meta") == null ? 1 : packet.getJSONObject("meta").optInt("environment",1);
                if (spawn != null) mapSpawn = new Location(world, spawn.optDouble("x") + .5, 8, spawn.optDouble("z") + .5);
                survival.beginSnapshot();
                if (interactions != null) interactions.clearCells();
                if (mustClearOldMap || nextEpoch != appliedWorldEpoch) {
                    combat.clear();
                    for (Phantom proxy : mindustryPlayerProxies.values()) if (proxy != null && proxy.isValid()) proxy.remove();
                    mindustryPlayerProxies.clear();
                    relocateAfterSnapshot = true;
                    clearTrackedMseCells(); snapshotRemaining = new HashSet<>(); mustClearOldMap = false;
                } else snapshotRemaining = new HashSet<>(mseCells);
                appliedWorldEpoch = nextEpoch; snapshotOverrides.clear(); continue;
            }
            if ("WORLD_MAP_CLEAR".equals(type)) {
                combat.clear();
                survival.beginSnapshot(); clearTrackedMseCells(); mustClearOldMap = true;
                for (Phantom proxy : mindustryPlayerProxies.values()) if (proxy != null && proxy.isValid()) proxy.remove();
                mindustryPlayerProxies.clear(); continue;
            }
            if ("WORLD_SNAPSHOT_END".equals(type)) {
                if (snapshotRemaining != null) planCellRemoval(snapshotRemaining);
                snapshotRemaining = null; snapshotOverrides.clear(); snapshotEnd = packet;
                continue;
            }
            if ("WORLD_PLAY_AREA_READY".equals(type)) {
                survival.endSnapshot();
                if (relocateAfterSnapshot && mapSpawn != null) {
                    mapSpawn.setY(world.getHighestBlockYAt(mapSpawn.getBlockX(), mapSpawn.getBlockZ()) + 1);
                    world.setSpawnLocation(mapSpawn);
                    for (org.bukkit.entity.Player player : world.getPlayers()) {
                        player.teleport(mapSpawn);
                        player.sendMessage("§a[MSE] Core area ready. The rest of the map is still loading.");
                    }
                    relocateAfterSnapshot = false;
                }
                continue;
            }
            int x = packet.optInt("x"), y = packet.optInt("y", 2), z = packet.optInt("z");
            if (y < world.getMinHeight() || y >= world.getMaxHeight()) continue;
            Material material = Material.matchMaterial(packet.optString("block_id", "minecraft:air"));
            if (material == null) { getLogger().warning("Unknown MSE material: " + packet.optString("block_id")); continue; }
            String key = cellKey(x, y, z);
            if (snapshotRemaining != null) {
                snapshotRemaining.remove(key);
                if (packet.optBoolean("delta")) snapshotOverrides.put(key, packet.optLong("revision"));
                else if (snapshotOverrides.getOrDefault(key, -1L) >= packet.optLong("revision")) continue;
            }
            org.bukkit.block.Block block = world.getBlockAt(x, y, z);
            if (block.getType() != material) block.setType(material, false);
            if (block.getBlockData() instanceof org.bukkit.block.data.type.Stairs stairs) {
                stairs.setFacing(switch ((packet.optInt("facing") + 45) / 90 % 4) {
                    case 1 -> org.bukkit.block.BlockFace.SOUTH; case 2 -> org.bukkit.block.BlockFace.WEST;
                    case 3 -> org.bukkit.block.BlockFace.NORTH; default -> org.bukkit.block.BlockFace.EAST;
                });
                stairs.setHalf(org.bukkit.block.data.Bisected.Half.BOTTOM);
                stairs.setShape(org.bukkit.block.data.type.Stairs.Shape.STRAIGHT);
                if (!block.getBlockData().equals(stairs)) block.setBlockData(stairs, false);
            }
            survival.updateCell(new Location(world, x, y, z), packet, material);
            if (interactions != null) interactions.updateCell(x,y,z,packet,material);
            if (material == Material.AIR) mseCells.remove(key); else mseCells.add(key);
        }
    }

    private void handleIncomingPacket(JSONObject packet) {
        String type = packet.optString("type", "UNKNOWN");
        if ("BUILDING_INVENTORY_RESULT".equals(type)) {
            Bukkit.getScheduler().runTask(this, () -> interactions.result(packet)); return;
        }
        if (!"PLAYER_STATE".equals(type) && !"MC_SET_BLOCK".equals(type) && !"WORLD_BLOCK_BATCH".equals(type) && !"ENTITY_FRAME".equals(type))
            getLogger().info("[MSE-MINECRAFT] RX type=" + type);

        if ("CONNECTED".equals(type)) return;
        if ("ENTITY_FRAME".equals(type)) { combat.frame(packet); return; }

        if ("BUILDING_REFUND".equals(type)) {
            Bukkit.getScheduler().runTask(this, () -> {
                org.bukkit.entity.Player player = Bukkit.getPlayer(UUID.fromString(packet.getString("player_id")));
                ItemStackRefund(player, packet.optString("mindustry_block"));
            }); return;
        }

        if ("WORLD_STREAM_RESET".equals(type)) {
            activeStreamId = packet.optLong("stream_id");
            worldPackets.clear(); streamReset.set(packet); return;
        }
        if ("WORLD_BLOCK_BATCH".equals(type)) {
            long streamId = packet.optLong("stream_id");
            if (streamId != activeStreamId) return;
            org.json.JSONArray packets = packet.optJSONArray("packets");
            if (packets == null || packets.length() > 256 || worldPackets.size() + packets.length() + 1 > 1024) {
                relayClient.close(1008, "Invalid or overflowing world batch"); return;
            }
            for (int i = 0; i < packets.length(); i++) {
                worldPackets.offer(packets.getJSONObject(i).put("stream_id", streamId));
            }
            worldPackets.offer(new JSONObject().put("type", "WORLD_BATCH_ACK")
                    .put("stream_id", streamId).put("batch_id", packet.optLong("batch_id")));
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

        if ("WORLD_SNAPSHOT_BEGIN".equals(type)) {
            if (!worldPackets.offer(packet)) relayClient.close(1008, "World queue overflow: update Relay");
            return;
        }

        if ("WORLD_SNAPSHOT_END".equals(type)) {
            if (!worldPackets.offer(packet)) relayClient.close(1008, "World queue overflow: update Relay");
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

        if (!worldPackets.offer(packet)) relayClient.close(1008, "World queue overflow: update Relay");
    }

    private void applyMindustryPlayerProxy(JSONObject packet) {
        if (!readyForGameplay() || packet.optLong("world_epoch", appliedWorldEpoch) != appliedWorldEpoch) return;
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
            spawningProxy = true;
            try { proxy = (Phantom) Bukkit.getWorlds().get(0).spawnEntity(loc, EntityType.PHANTOM); }
            finally { spawningProxy = false; }
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
        combat.playerProxy(id, proxy);
        double health = Math.max(0, Math.min(1, packet.optDouble("health_fraction", 1)));
        if (health > 0) proxy.setHealth(proxy.getAttribute(org.bukkit.attribute.Attribute.GENERIC_MAX_HEALTH).getValue() * health);
        else { combat.unregister(proxy); proxy.remove(); mindustryPlayerProxies.remove(id); }
    }

    private void removeMindustryPlayerProxy(String id) {
        Phantom proxy = mindustryPlayerProxies.remove(id);
        if (proxy != null) { combat.unregister(proxy); if (proxy.isValid()) proxy.remove(); }
    }

    private void ItemStackRefund(org.bukkit.entity.Player player, String block) {
        if (player == null) return;
        org.bukkit.inventory.ItemStack item = buildingRecipes.item(block, 1);
        if (item == null) return;
        for (org.bukkit.inventory.ItemStack leftover : player.getInventory().addItem(item).values())
            player.getWorld().dropItemNaturally(player.getLocation(), leftover);
    }
}
