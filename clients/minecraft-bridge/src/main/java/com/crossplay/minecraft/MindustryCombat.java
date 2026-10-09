package com.crossplay.minecraft;

import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.attribute.Attribute;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Zombie;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/** Mindustry owns unit AI, health and death; Minecraft creatures are controlled projections. */
public final class MindustryCombat implements Listener {
    private final MinecraftBridge plugin;
    private final Map<String, LivingEntity> units = new HashMap<>();
    private final Map<UUID, String> targets = new HashMap<>();
    private final Map<UUID, String> lives = new HashMap<>();
    private final Set<UUID> linkedPlayers = new HashSet<>();
    private final AtomicReference<JSONObject> latestFrame = new AtomicReference<>();
    public MindustryCombat(MinecraftBridge plugin) { this.plugin = plugin; }
    public String life(Player player) { return lives.computeIfAbsent(player.getUniqueId(), id -> UUID.randomUUID().toString()); }
    public boolean isProxy(Entity entity) { return targets.containsKey(entity.getUniqueId()); }
    public void unregister(Entity entity) { targets.remove(entity.getUniqueId()); }
    public void playerProxy(String id, LivingEntity entity) { targets.put(entity.getUniqueId(), id); entity.setInvulnerable(false); }
    public void frame(JSONObject packet) { latestFrame.set(packet); }
    public void tick() {
        if (!plugin.readyForGameplay()) return;
        JSONObject frame = latestFrame.getAndSet(null);
        if (frame == null || frame.optLong("world_epoch") != plugin.worldEpoch() || Bukkit.getWorlds().isEmpty()) return;
        Set<String> seen = new HashSet<>();
        JSONArray list = frame.optJSONArray("units");
        if (list != null) for (int i = 0; i < Math.min(512, list.length()); i++) {
            JSONObject state = list.getJSONObject(i);
            String id = state.getString("id"); seen.add(id);
            Location location = new Location(Bukkit.getWorlds().get(0), state.getDouble("x") + .5,
                    state.getDouble("y"), state.getDouble("z") + .5, (float) state.optDouble("rotation"), 0);
            LivingEntity entity = units.get(id);
            if (entity == null || !entity.isValid()) {
                EntityType type = state.optBoolean("flying") ? EntityType.VEX : EntityType.ZOMBIE;
                entity = plugin.spawnProxy(location, type);
                entity.setAI(false); entity.setGravity(false); entity.setSilent(true); entity.setPersistent(false);
                entity.setCollidable(false); entity.setRemoveWhenFarAway(false);
                if (entity instanceof Zombie zombie) { zombie.setBaby(false); zombie.setCanPickupItems(false); }
                ItemStack helmet = new ItemStack(Material.LEATHER_HELMET);
                LeatherArmorMeta meta = (LeatherArmorMeta) helmet.getItemMeta();
                try { meta.setColor(Color.fromRGB(Integer.parseInt(state.optString("team_color", "ffd37f").substring(0, 6), 16))); }
                catch (Exception ignored) { meta.setColor(Color.YELLOW); }
                meta.setUnbreakable(true); helmet.setItemMeta(meta);
                entity.getEquipment().setHelmet(helmet); entity.getEquipment().setHelmetDropChance(0);
                targets.put(entity.getUniqueId(), id); units.put(id, entity);
            }
            entity.teleport(location);
            double fraction = Math.max(0, Math.min(1, state.optDouble("health_fraction", 1)));
            entity.setCustomName("[MSE] " + state.optString("unit_type") + " " + Math.round(fraction * 100) + "%");
            entity.setCustomNameVisible(true);
            if (fraction > 0) entity.setHealth(Math.max(.01, entity.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue() * fraction));
        }
        for (String id : new HashSet<>(units.keySet())) if (!seen.contains(id)) {
            LivingEntity entity = units.remove(id); targets.remove(entity.getUniqueId()); entity.remove();
        }
        JSONArray health = frame.optJSONArray("minecraft_health");
        if (health != null) for (int i = 0; i < health.length(); i++) {
            JSONObject state = health.getJSONObject(i);
            UUID id;
            try { id = UUID.fromString(state.getString("id").replace("MINECRAFT:", "")); } catch (Exception err) { continue; }
            Player player = Bukkit.getPlayer(id);
            if (player == null || !life(player).equals(state.optString("life_id")) || player.isDead()) continue;
            linkedPlayers.add(id);
            if (player.getGameMode() != GameMode.SURVIVAL) continue;
            double fraction = Math.max(0, Math.min(1, state.optDouble("health_fraction", 1)));
            player.setHealth(player.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue() * fraction);
        }
    }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player && plugin.worldEpoch() != 0 && !plugin.readyForGameplay()) {
            event.setCancelled(true); return;
        }
        String target = targets.get(event.getEntity().getUniqueId());
        if (target != null) {
            event.setCancelled(true);
            if (!plugin.readyForGameplay() || !(event instanceof EntityDamageByEntityEvent hit)) return;
            Player attacker = hit.getDamager() instanceof Player p ? p :
                    hit.getDamager() instanceof Projectile projectile && projectile.getShooter() instanceof Player p ? p : null;
            if (attacker == null || attacker.getGameMode() != GameMode.SURVIVAL) return;
            boolean ranged = hit.getDamager() instanceof Projectile;
            // A cancelled proxy hit otherwise leaves the arrow colliding again next tick.
            if (ranged) hit.getDamager().remove();
            plugin.sendGameplay(new JSONObject().put("type", "ENTITY_DAMAGE").put("target_id", target)
                    .put("attack_kind", ranged ? "projectile" : "melee")
                    .put("player_id", attacker.getUniqueId().toString()).put("amount_fraction", Math.min(1, event.getFinalDamage() /
                            ((LivingEntity) event.getEntity()).getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue())));
            return;
        }
        if (event.getEntity() instanceof Player player && linkedPlayers.contains(player.getUniqueId()) &&
                player.getGameMode() == GameMode.SURVIVAL && plugin.readyForGameplay()) {
            event.setCancelled(true);
            plugin.sendGameplay(new JSONObject().put("type", "PLAYER_HEALTH_DELTA").put("player_id", player.getUniqueId().toString())
                    .put("life_id", life(player)).put("amount_fraction", -Math.min(1, event.getFinalDamage() /
                            player.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue())));
        }
    }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onHeal(EntityRegainHealthEvent event) {
        if (!(event.getEntity() instanceof Player player) || !linkedPlayers.contains(player.getUniqueId()) ||
                player.getGameMode() != GameMode.SURVIVAL || !plugin.readyForGameplay()) return;
        event.setCancelled(true);
        plugin.sendGameplay(new JSONObject().put("type", "PLAYER_HEALTH_DELTA").put("player_id", player.getUniqueId().toString())
                .put("life_id", life(player)).put("amount_fraction", Math.min(1, event.getAmount() /
                        player.getAttribute(Attribute.GENERIC_MAX_HEALTH).getValue())));
    }
    @EventHandler public void onRespawn(PlayerRespawnEvent event) {
        lives.put(event.getPlayer().getUniqueId(), UUID.randomUUID().toString()); linkedPlayers.remove(event.getPlayer().getUniqueId());
        event.setRespawnLocation(plugin.safeSpawn());
    }
    @EventHandler public void onProxyDeath(org.bukkit.event.entity.EntityDeathEvent event) {
        if (isProxy(event.getEntity())) { event.getDrops().clear(); event.setDroppedExp(0); }
    }
    public void clear() {
        for (LivingEntity entity : units.values()) entity.remove();
        units.clear(); targets.clear(); linkedPlayers.clear(); latestFrame.set(null);
    }
}
