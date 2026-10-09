package com.crossplay.minecraft;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.block.Block;
import org.bukkit.enchantments.Enchantment;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockDamageEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapelessRecipe;
import org.bukkit.inventory.meta.Damageable;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;

/** Minecraft-local survival rewards. Collection never mutates Mindustry deposits. */
public final class SurvivalFoundation implements Listener {
    private final MinecraftBridge plugin;
    private final NamespacedKey resourceKey;
    private final NamespacedKey scrapRecipe;
    private final NamespacedKey sporeRecipe;
    private final NamespacedKey berylliumRecipe;
    private final NamespacedKey graphiteRecipe;
    private final Map<String, Cell> cells = new HashMap<>();
    private final Map<UUID, Long> lastHarvest = new HashMap<>();
    private final Map<UUID, Long> lastHint = new HashMap<>();
    private boolean applyingSnapshot;

    private record Cell(boolean protectedCell, String resource, Material drop, int tier, long cooldown, boolean naturalWall) {}

    public SurvivalFoundation(MinecraftBridge plugin) {
        this.plugin = plugin;
        resourceKey = new NamespacedKey(plugin, "mindustry_resource");
        scrapRecipe = new NamespacedKey(plugin, "scrap_planks");
        sporeRecipe = new NamespacedKey(plugin, "spore_planks");
        berylliumRecipe = new NamespacedKey(plugin, "beryllium_planks");
        graphiteRecipe = new NamespacedKey(plugin, "graphite_iron");
        registerConversion(berylliumRecipe, Material.EMERALD, Material.OAK_PLANKS, 4);
        registerConversion(graphiteRecipe, Material.CHARCOAL, Material.IRON_INGOT, 1);
        registerWoodRecipe(scrapRecipe, resourceItem("scrap", Material.IRON_NUGGET));
        registerWoodRecipe(sporeRecipe, resourceItem("spore", Material.PURPLE_DYE));
        for (Player player : Bukkit.getOnlinePlayers()) discover(player);
    }

    private void registerConversion(NamespacedKey key, Material ingredient, Material output, int count) {
        Bukkit.removeRecipe(key);
        ShapelessRecipe recipe = new ShapelessRecipe(key, new ItemStack(output, count));
        for (int i = 0; i < 4; i++) recipe.addIngredient(ingredient);
        Bukkit.addRecipe(recipe);
    }

    private void registerWoodRecipe(NamespacedKey key, ItemStack ingredient) {
        Bukkit.removeRecipe(key);
        ShapelessRecipe recipe = new ShapelessRecipe(key, new ItemStack(Material.OAK_PLANKS, 4));
        String resource = ingredient.getItemMeta().getPersistentDataContainer().get(resourceKey, PersistentDataType.STRING);
        ItemStack previous = ingredient.clone();
        ItemMeta previousMeta = previous.getItemMeta();
        previousMeta.setDisplayName("§d[MSE] " + ("scrap".equals(resource) ? "Sucata" : "Casulo de Esporos"));
        previousMeta.setLore(List.of("§74 unidades = 4 tábuas de madeira"));
        previous.setItemMeta(previousMeta);
        for (int i = 0; i < 4; i++) recipe.addIngredient(new RecipeChoice.ExactChoice(ingredient, previous, legacyResourceItem(resource, ingredient.getType())));
        Bukkit.addRecipe(recipe);
    }

    private ItemStack resourceItem(String resource, Material material) {
        if (plugin.mindustryItems() != null) {
            ItemStack canonical = plugin.mindustryItems().item("spore".equals(resource) ? "spore-pod" : resource, 1);
            if (canonical != null) return canonical;
        }
        return legacyResourceItem(resource, material);
    }
    private ItemStack legacyResourceItem(String resource, Material material) {
        ItemStack item = new ItemStack(material);
        if (!"scrap".equals(resource) && !"spore".equals(resource)) return item;
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(ChatColor.LIGHT_PURPLE + ("scrap".equals(resource) ? "Sucata do Mindustry" : "Esporos do Mindustry"));
        meta.setLore(List.of(ChatColor.GRAY + "4 unidades = 4 tabuas de madeira"));
        meta.getPersistentDataContainer().set(resourceKey, PersistentDataType.STRING, resource);
        item.setItemMeta(meta);
        return item;
    }

    private String key(Location loc) {
        return loc.getWorld().getUID() + ":" + loc.getBlockX() + ":" + loc.getBlockY() + ":" + loc.getBlockZ();
    }

    public void beginSnapshot() { applyingSnapshot = true; cells.clear(); }
    public boolean applyingSnapshot() { return applyingSnapshot; }
    public void endSnapshot() { applyingSnapshot = false; }

    public void updateCell(Location loc, JSONObject packet, Material material) {
        String key = key(loc);
        if (material == Material.AIR) { cells.remove(key); return; }
        JSONObject resource = packet.optJSONObject("survival_resource");
        Material drop = resource == null ? null : Material.matchMaterial(resource.optString("material"));
        cells.put(key, new Cell(packet.optBoolean("survival_protected", false),
                resource == null ? "" : resource.optString("id"), drop,
                resource == null ? 0 : resource.optInt("min_pickaxe_tier"),
                resource == null ? 1000 : Math.max(0L, resource.optLong("cooldown_ms", 1000)), packet.optBoolean("natural_wall")));
    }

    // Utility blocks crafted in Survival remain ordinary Minecraft blocks.
    public boolean isLocalPlacement(Player player, Material material) {
        return player.getGameMode() == GameMode.SURVIVAL && Set.of(Material.CRAFTING_TABLE, Material.FURNACE,
                Material.BLAST_FURNACE, Material.SMOKER, Material.CHEST, Material.BARREL).contains(material);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(BlockDamageEvent event) {
        if (event.getPlayer().getGameMode() != GameMode.SURVIVAL || applyingSnapshot) return;
        Cell cell = cells.get(key(event.getBlock().getLocation()));
        // Normal arm/block breaking time is the collection interval for scrap.
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (event.getPlayer().getGameMode() != GameMode.SURVIVAL) return;
        Cell cell = cells.get(key(event.getBlock().getLocation()));
        if (applyingSnapshot || (cell == null && plugin.isTrackedCell(event.getBlock().getLocation()))) {
            event.setCancelled(true);
            hint(event.getPlayer(), "Please wait for World Sync to finish synchronizing.");
            return;
        }
        if (cell != null && cell.naturalWall && (cell.resource.isEmpty() || "stone".equals(cell.resource) || event.getPlayer().isSneaking())) {
            if (!HarvestRules.canHarvest(event.getPlayer().getInventory().getItemInMainHand().getType().name(), Math.max(1,cell.tier))) {
                event.setCancelled(true); hint(event.getPlayer(), "Use a suitable pickaxe to recover the entire wall.");
            }
            // The bridge removes the canonical volume and returns one reusable wall item.
            return;
        }
        if (cell == null || !cell.protectedCell) return;
        event.setCancelled(true);
        if (cell.drop == null) {
            hint(event.getPlayer(), "This Mindustry terrain is protected.");
            return;
        }
        Player player = event.getPlayer();
        ItemStack tool = player.getInventory().getItemInMainHand();
        if (!HarvestRules.canHarvest(tool.getType().name(), cell.tier)) {
            hint(player, cell.tier >= 4 ? "Use a diamond or netherite pickaxe." :
                    cell.tier >= 3 ? "Use an iron pickaxe or better." :
                    cell.tier >= 2 ? "Use a stone pickaxe or better." : "Use a pickaxe to mine this resource.");
            return;
        }
        long now = System.currentTimeMillis();
        if (!"scrap".equals(cell.resource) && now - lastHarvest.getOrDefault(player.getUniqueId(), 0L) < cell.cooldown) return;
        ItemStack reward = resourceItem(cell.resource, cell.drop);
        // No reward is lost or spawned into the void when the inventory is full.
        boolean room = false;
        for (ItemStack slot : player.getInventory().getStorageContents()) {
            if (slot == null || slot.getType() == Material.AIR ||
                    (slot.isSimilar(reward) && slot.getAmount() < slot.getMaxStackSize())) { room = true; break; }
        }
        if (!room) { hint(player, "Your inventory is full."); return; }
        player.getInventory().addItem(reward);
        lastHarvest.put(player.getUniqueId(), now);
        wearTool(player, tool);
        player.spigot().sendMessage(net.md_5.bungee.api.ChatMessageType.ACTION_BAR,
                new net.md_5.bungee.api.chat.TextComponent(ChatColor.GREEN + "+1 " + cell.resource + " (deposit preserved)"));
    }

    private void wearTool(Player player, ItemStack tool) {
        if (tool.getType().getMaxDurability() <= 0 || !(tool.getItemMeta() instanceof Damageable meta)) return;
        if (meta.isUnbreakable() || ThreadLocalRandom.current().nextInt(tool.getEnchantmentLevel(Enchantment.DURABILITY) + 1) != 0) return;
        int damage = meta.getDamage() + 1;
        if (damage >= tool.getType().getMaxDurability()) player.getInventory().setItemInMainHand(new ItemStack(Material.AIR));
        else { meta.setDamage(damage); tool.setItemMeta(meta); }
    }

    private void hint(Player player, String message) {
        long now = System.currentTimeMillis();
        if (now - lastHint.getOrDefault(player.getUniqueId(), 0L) < 1500) return;
        lastHint.put(player.getUniqueId(), now);
        player.sendMessage(ChatColor.YELLOW + "[MSE] " + message);
    }

    private void discover(Player player) { player.discoverRecipes(List.of(scrapRecipe, sporeRecipe, berylliumRecipe, graphiteRecipe)); }
    @EventHandler public void onJoin(PlayerJoinEvent event) { discover(event.getPlayer()); }
    @EventHandler public void onQuit(PlayerQuitEvent event) {
        lastHarvest.remove(event.getPlayer().getUniqueId()); lastHint.remove(event.getPlayer().getUniqueId());
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onEntityExplosion(EntityExplodeEvent event) { event.blockList().removeIf(this::protectedBlock); }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBlockExplosion(BlockExplodeEvent event) { event.blockList().removeIf(this::protectedBlock); }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBurn(BlockBurnEvent event) { if (protectedBlock(event.getBlock())) event.setCancelled(true); }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPistonExtend(BlockPistonExtendEvent event) {
        if (event.getBlocks().stream().anyMatch(this::protectedBlock)) event.setCancelled(true);
    }
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPistonRetract(BlockPistonRetractEvent event) {
        if (event.getBlocks().stream().anyMatch(this::protectedBlock)) event.setCancelled(true);
    }
    private boolean protectedBlock(Block block) { return plugin.isTrackedCell(block.getLocation()); }

    public void close() {
        Bukkit.removeRecipe(scrapRecipe); Bukkit.removeRecipe(sporeRecipe);
        Bukkit.removeRecipe(berylliumRecipe); Bukkit.removeRecipe(graphiteRecipe);
        cells.clear(); lastHarvest.clear(); lastHint.clear();
    }
}
