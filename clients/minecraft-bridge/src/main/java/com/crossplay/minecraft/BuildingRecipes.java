package com.crossplay.minecraft;

import org.bukkit.Bukkit;
import org.bukkit.ChatColor;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.ShapelessRecipe;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;

/** Building items represent one whole Mindustry building, never one voxel of its model. */
public final class BuildingRecipes {
    private final NamespacedKey tag;
    private final List<NamespacedKey> recipes = new ArrayList<>();
    private final Map<String, Material> materials = new LinkedHashMap<>();
    private final Map<String, String> labels = new LinkedHashMap<>();
    private final Map<String, org.json.JSONObject> definitions = new LinkedHashMap<>();
    public BuildingRecipes(MinecraftBridge plugin) {
        tag = new NamespacedKey(plugin, "mindustry_building");
        add(plugin, "conveyor", Material.STONE_STAIRS, 8, Material.COBBLESTONE, Material.RAW_COPPER);
        add(plugin, "titanium-conveyor", Material.SANDSTONE_STAIRS, 8, Material.RAW_COPPER, Material.DIAMOND);
        add(plugin, "armored-conveyor", Material.NETHER_BRICK_STAIRS, 8, Material.IRON_INGOT, Material.DIAMOND);
        add(plugin, "plastanium-conveyor", Material.PURPUR_STAIRS, 8, Material.DIAMOND, Material.AMETHYST_SHARD);
        add(plugin, "junction", Material.CHISELED_STONE_BRICKS, 1, Material.COBBLESTONE, Material.RAW_COPPER, Material.RAW_COPPER);
        add(plugin, "router", Material.COBBLESTONE, 1, Material.OAK_PLANKS, Material.RAW_COPPER);
        add(plugin, "distributor", Material.CHISELED_POLISHED_BLACKSTONE, 1, Material.OAK_PLANKS, Material.IRON_INGOT, Material.RAW_COPPER);
        add(plugin, "sorter", Material.SMOOTH_STONE, 1, Material.COBBLESTONE, Material.RAW_COPPER, Material.COAL);
        add(plugin, "inverted-sorter", Material.MOSSY_STONE_BRICKS, 1, Material.COBBLESTONE, Material.IRON_INGOT, Material.COAL);
        add(plugin, "overflow-gate", Material.LODESTONE, 1, Material.RAW_COPPER, Material.RAW_COPPER, Material.IRON_INGOT);
        add(plugin, "underflow-gate", Material.MOSSY_COBBLESTONE, 1, Material.RAW_COPPER, Material.IRON_INGOT, Material.IRON_INGOT);
        add(plugin, "mechanical-drill", Material.ACACIA_PLANKS, 1, Material.OAK_PLANKS, Material.COBBLESTONE, Material.RAW_COPPER);
        add(plugin, "pneumatic-drill", Material.IRON_BLOCK, 1, Material.COBBLESTONE, Material.RAW_COPPER, Material.IRON_INGOT);
        add(plugin, "laser-drill", Material.PURPUR_BLOCK, 1, Material.IRON_INGOT, Material.DIAMOND, Material.DIAMOND);
        add(plugin, "blast-drill", Material.END_STONE_BRICKS, 1, Material.DIAMOND, Material.DIAMOND, Material.AMETHYST_SHARD);
        add(plugin, "mass-driver", Material.BAMBOO_PLANKS, 1, Material.OAK_PLANKS, Material.IRON_INGOT, Material.IRON_INGOT, Material.DIAMOND);
        add(plugin, "combustion-generator", Material.BLAST_FURNACE, 1, Material.COBBLESTONE, Material.RAW_COPPER, Material.COAL);
        add(plugin, "kiln", Material.FURNACE, 1, Material.COBBLESTONE, Material.COAL, Material.RAW_COPPER, Material.RAW_COPPER);
        add(plugin, "power-node", Material.LIGHTNING_ROD, 1, Material.RAW_COPPER, Material.RAW_COPPER, Material.STICK);
        add(plugin, "power-node-large", Material.END_ROD, 1, Material.IRON_INGOT, Material.RAW_COPPER, Material.STICK);
        add(plugin, "core-shard", Material.YELLOW_TERRACOTTA, 1, Material.RAW_COPPER, Material.RAW_IRON, Material.OAK_PLANKS);
        add(plugin, "core-foundation", Material.YELLOW_TERRACOTTA, 1, Material.IRON_INGOT, Material.DIAMOND, Material.OAK_PLANKS);
        add(plugin, "core-nucleus", Material.YELLOW_TERRACOTTA, 1, Material.IRON_INGOT, Material.DIAMOND, Material.AMETHYST_SHARD);
        add(plugin, "core-bastion", Material.YELLOW_TERRACOTTA, 1, Material.EMERALD, Material.RAW_GOLD, Material.OAK_PLANKS);
        add(plugin, "core-citadel", Material.YELLOW_TERRACOTTA, 1, Material.EMERALD, Material.RAW_GOLD, Material.DIAMOND);
        add(plugin, "core-acropolis", Material.YELLOW_TERRACOTTA, 1, Material.EMERALD, Material.RAW_GOLD, Material.AMETHYST_SHARD);
        for (Object raw : plugin.catalogResource("block-mappings.json").getJSONArray("mappings")) {
            org.json.JSONObject entry = (org.json.JSONObject) raw;
            materials.put(entry.getString("mindustry"), Material.matchMaterial(entry.getString("minecraft")));
            labels.put(entry.getString("mindustry"), entry.optString("label",entry.getString("mindustry")));
            definitions.put(entry.getString("mindustry"),entry);
        }
        for (Object raw : plugin.catalogResource("natural-walls.json").getJSONArray("mappings")) {
            org.json.JSONObject entry=(org.json.JSONObject)raw;
            String name=entry.getString("mindustry");
            materials.put(name,Material.matchMaterial(entry.getString("minecraft")));
            labels.put(name,entry.optString("label",name));definitions.put(name,entry);
        }
        for (Player player : Bukkit.getOnlinePlayers()) discover(player);
    }
    private void add(MinecraftBridge plugin, String block, Material material, int count, Material... ingredients) {
        materials.put(block, material);
        NamespacedKey key = new NamespacedKey(plugin, "building_" + block.replace('-', '_'));
        Bukkit.removeRecipe(key);
        ShapelessRecipe recipe = new ShapelessRecipe(key, item(block, count));
        for (Material ingredient : ingredients) recipe.addIngredient(ingredient);
        Bukkit.addRecipe(recipe); recipes.add(key);
    }
    public ItemStack item(String block, int count) {
        Material material = materials.get(block);
        if (material == null) return null;
        ItemStack item = new ItemStack(material, count);
        ItemMeta meta = item.getItemMeta();
        meta.setDisplayName(ChatColor.AQUA + "[MSE] " + label(block));
        meta.setLore(List.of(ChatColor.GRAY + "1 item = 1 complete Mindustry structure",
                ChatColor.GRAY + "Place to build in Mindustry"));
        meta.getPersistentDataContainer().set(tag, PersistentDataType.STRING, block);
        item.setItemMeta(meta); return item;
    }
    public String block(ItemStack item) {
        return item != null && item.hasItemMeta() ? item.getItemMeta().getPersistentDataContainer().get(tag, PersistentDataType.STRING) : null;
    }
    public String mappedBuilding(Material material) {
        if (material == Material.YELLOW_TERRACOTTA) return "core-shard";
        for (Map.Entry<String, Material> entry : materials.entrySet()) if (entry.getValue() == material && !definitions.get(entry.getKey()).optBoolean("natural_wall")) return entry.getKey();
        return null;
    }
    public String label(String block) {
        if (labels.containsKey(block)) return labels.get(block);
        return switch (block) {
            case "conveyor" -> "Conveyor";
            case "titanium-conveyor" -> "Titanium Conveyor";
            case "armored-conveyor" -> "Armored Conveyor";
            case "plastanium-conveyor" -> "Plastanium Conveyor";
            case "mechanical-drill" -> "Mechanical Drill";
            case "pneumatic-drill" -> "Pneumatic Drill";
            case "laser-drill" -> "Laser Drill";
            case "blast-drill" -> "Airblast Drill";
            case "mass-driver" -> "Mass Driver";
            case "router" -> "Router";
            case "distributor" -> "Distributor";
            case "junction" -> "Junction";
            case "sorter" -> "Sorter";
            case "inverted-sorter" -> "Inverted Sorter";
            case "overflow-gate" -> "Overflow Gate";
            case "underflow-gate" -> "Underflow Gate";
            case "power-node" -> "Power Node";
            case "power-node-large" -> "Large Power Node";
            case "combustion-generator" -> "Combustion Generator";
            case "kiln" -> "Kiln";
            case "core-shard" -> "Core: Shard";
            case "core-foundation" -> "Core: Foundation";
            case "core-nucleus" -> "Core: Nucleus";
            case "core-bastion" -> "Core: Bastion";
            case "core-citadel" -> "Core: Citadel";
            case "core-acropolis" -> "Core: Acropolis";
            default -> block;
        };
    }
    public boolean compatible(String block, int environment) {
        org.json.JSONObject definition=definitions.get(block);if(definition==null)return false;
        int required=definition.optInt("env_required");
        return (definition.optInt("env_enabled",1)&environment)!=0 && (definition.optInt("env_disabled")&environment)==0 && (required&environment)==required;
    }
    public void discover(Player player) { player.discoverRecipes(recipes); }
    public void close() { for (NamespacedKey recipe : recipes) Bukkit.removeRecipe(recipe); }
}
