package com.crossplay.minecraft;

import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.CreatureSpawnEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;

/** Minecraft creatures are not part of a Mindustry-authoritative map. */
public final class MseWorldRules implements Listener {
    private final MinecraftBridge plugin;
    public MseWorldRules(MinecraftBridge plugin) { this.plugin = plugin; }
    private boolean mseWorld(World world) {
        return !Bukkit.getWorlds().isEmpty() && world.equals(Bukkit.getWorlds().get(0));
    }
    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onSpawn(CreatureSpawnEvent event) {
        if (mseWorld(event.getLocation().getWorld()) && !plugin.isSpawningProxy()) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (mseWorld(event.getEntity().getWorld()) && event.getDamager() instanceof LivingEntity &&
                !(event.getDamager() instanceof Player)) event.setCancelled(true);
        if (mseWorld(event.getEntity().getWorld()) && event.getDamager() instanceof org.bukkit.entity.Projectile projectile &&
                projectile.getShooter() instanceof LivingEntity && !(projectile.getShooter() instanceof Player)) event.setCancelled(true);
    }
    @EventHandler public void onLoad(org.bukkit.event.world.EntitiesLoadEvent event) {
        if (!mseWorld(event.getWorld())) return;
        for (org.bukkit.entity.Entity entity : event.getEntities()) {
            if (entity instanceof LivingEntity && !(entity instanceof Player) && !plugin.isMseProxy(entity)) entity.remove();
        }
    }
    public void removeUnrelatedCreatures() {
        if (Bukkit.getWorlds().isEmpty()) return;
        for (LivingEntity entity : Bukkit.getWorlds().get(0).getLivingEntities()) {
            if (!(entity instanceof Player) && !plugin.isMseProxy(entity)) entity.remove();
        }
    }
}
