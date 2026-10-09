package com.crossplay.minecraft;

import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.json.JSONObject;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** One resource vocabulary shared by building costs and Mindustry inventories. */
public final class MindustryItems {
    private final NamespacedKey tag;
    private final Map<String, Material> materials = new LinkedHashMap<>();
    private final Map<String, String> labels = new LinkedHashMap<>();
    public MindustryItems(MinecraftBridge plugin, JSONObject catalog) {
        tag = new NamespacedKey(plugin, "mindustry_resource");
        String[][] entries = {{"copper","RAW_COPPER"},{"lead","RAW_IRON"},{"metaglass","GLASS"},
            {"graphite","CHARCOAL"},{"sand","SAND"},{"coal","COAL"},{"titanium","DIAMOND"},
            {"thorium","AMETHYST_SHARD"},{"scrap","IRON_NUGGET"},{"silicon","FLINT"},
            {"plastanium","PRISMARINE_CRYSTALS"},{"phase-fabric","PHANTOM_MEMBRANE"},
            {"surge-alloy","GLOWSTONE_DUST"},{"spore-pod","PURPLE_DYE"},{"blast-compound","GUNPOWDER"},
            {"pyratite","BLAZE_POWDER"},{"beryllium","EMERALD"},{"tungsten","RAW_GOLD"},
            {"oxide","ORANGE_DYE"},{"carbide","NETHERITE_SCRAP"},{"fissile-matter","LIME_DYE"},
            {"dormant-cyst","HONEYCOMB"}};
        for (String[] entry : entries) materials.put(entry[0], Material.valueOf(entry[1]));
        for (Object raw : catalog.getJSONArray("items")) {
            JSONObject entry = (JSONObject) raw; labels.put(entry.getString("name"), entry.optString("label", entry.getString("name")));
        }
    }
    public String label(String id) { return labels.getOrDefault(id, id); }
    public ItemStack item(String id, int count) {
        Material material = materials.get(id);
        if (material == null || count <= 0) return null;
        ItemStack item = new ItemStack(material, count);
        if (List.of("copper","lead","sand","coal","graphite","titanium","thorium","beryllium","tungsten").contains(id)) return item;
        var meta = item.getItemMeta();
        meta.setDisplayName("§d[MSE] " + label(id));
        meta.getPersistentDataContainer().set(tag, PersistentDataType.STRING, id.equals("spore-pod") ? "spore" : id);
        if (id.equals("scrap") || id.equals("spore-pod")) meta.setLore(List.of("§74 units = 4 wooden planks"));
        item.setItemMeta(meta); return item;
    }
    public String id(ItemStack item) {
        if (item == null || item.getType().isAir()) return null;
        if (item.hasItemMeta()) {
            String tagged = item.getItemMeta().getPersistentDataContainer().get(tag, PersistentDataType.STRING);
            if (tagged != null) return tagged.equals("spore") ? "spore-pod" : materials.containsKey(tagged) ? tagged : null;
            // Construction items must never be interpreted as their visual resource.
            if (!item.getItemMeta().getPersistentDataContainer().getKeys().isEmpty()) return null;
        }
        for (String id : List.of("copper","lead","sand","coal","graphite","titanium","thorium","beryllium","tungsten"))
            if (item.getType() == materials.get(id)) return id;
        return switch (item.getType()) { case COPPER_INGOT -> "copper"; case IRON_INGOT -> "lead"; case GOLD_INGOT -> "tungsten"; default -> null; };
    }
    public int count(Player player, String id) {
        int total = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) if (id.equals(id(stack))) total += stack.getAmount();
        return total;
    }
    public void consume(Player player, String id, int amount) {
        var inventory = player.getInventory();
        for (int slot = 0; slot < inventory.getStorageContents().length && amount > 0; slot++) {
            ItemStack stack = inventory.getItem(slot);
            if (!id.equals(id(stack))) continue;
            int taken = Math.min(amount, stack.getAmount()); amount -= taken;
            if (taken == stack.getAmount()) inventory.setItem(slot, null);
            else { stack.setAmount(stack.getAmount() - taken); inventory.setItem(slot, stack); }
        }
        if (amount != 0) throw new IllegalStateException("Resource inventory changed during craft");
    }
    public static boolean canGive(Player player, ItemStack output) {
        int capacity = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack == null || stack.getType().isAir()) capacity += output.getMaxStackSize();
            else if (stack.isSimilar(output)) capacity += Math.max(0, stack.getMaxStackSize() - stack.getAmount());
        }
        return capacity >= output.getAmount();
    }
}
