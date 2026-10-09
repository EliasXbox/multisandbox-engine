package com.crossplay.minecraft;

import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.EquipmentSlot;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Exact Mindustry costs need a workshop because recipes can require thousands of items. */
public final class MseWorkshop implements Listener {
    private final MinecraftBridge plugin;
    private final MindustryItems items;
    private final List<JSONObject> buildings = new ArrayList<>();
    private final Map<String, Map<String,Integer>> processing = new LinkedHashMap<>();
    private static final class Menu implements InventoryHolder {
        Inventory inventory; final int page; final boolean resources;
        Menu(int page, boolean resources) { this.page = page; this.resources = resources; }
        public Inventory getInventory() { return inventory; }
    }
    public MseWorkshop(MinecraftBridge plugin, JSONObject registry, MindustryItems items) {
        this.plugin = plugin; this.items = items;
        for (Object raw : registry.getJSONArray("mappings")) buildings.add((JSONObject) raw);
        recipe("wood", "beryllium", 4);
        recipe("iron", "graphite", 4);
        recipe("graphite", "coal", 2);
        recipe("metaglass", "sand", 1, "lead", 1);
        recipe("silicon", "sand", 2, "coal", 1);
        recipe("pyratite", "coal", 1, "lead", 2, "sand", 2);
        recipe("blast-compound", "pyratite", 1, "spore-pod", 1);
        recipe("plastanium", "titanium", 2, "spore-pod", 1, "coal", 1);
        recipe("phase-fabric", "thorium", 4, "sand", 10);
        recipe("surge-alloy", "copper", 3, "lead", 4, "titanium", 2, "silicon", 3);
        recipe("oxide", "beryllium", 3, "coal", 1);
        recipe("carbide", "tungsten", 2, "graphite", 3);
        recipe("fissile-matter", "thorium", 2, "beryllium", 1);
    }
    private ItemStack processedOutput(String id) {
        if ("wood".equals(id)) return new ItemStack(Material.OAK_PLANKS, 4);
        if ("iron".equals(id)) return new ItemStack(Material.IRON_INGOT, 1);
        return items.item(id, 1);
    }
    private String outputLabel(String id) {
        return "wood".equals(id) ? "Oak Planks" : "iron".equals(id) ? "Iron Ingot" : items.label(id);
    }
    private void recipe(String output, Object... costs) {
        Map<String,Integer> entries = new LinkedHashMap<>();
        for (int i=0;i<costs.length;i+=2) entries.put((String)costs[i],(Integer)costs[i+1]);
        processing.put(output,entries);
    }
    public void open(Player player, int page, boolean resources) {
        int size = resources ? processing.size() : buildings.size();
        page = Math.max(0, Math.min(page, (size - 1) / 45));
        Menu menu = new Menu(page,resources);
        menu.inventory = Bukkit.createInventory(menu,54,"[MSE] " + (resources?"Resources":"Buildings") + " " + (page+1));
        for (int slot=0;slot<45 && page*45+slot<size;slot++) {
            int index=page*45+slot;
            String id = resources ? new ArrayList<>(processing.keySet()).get(index) : buildings.get(index).getString("mindustry");
            ItemStack display = resources ? processedOutput(id) : plugin.buildingRecipes().item(id,1);
            if (display==null) continue;
            var meta=display.getItemMeta(); List<String> lore=new ArrayList<>();
            for(var cost:costs(index,resources).entrySet()) lore.add("§7"+cost.getValue()+" × "+items.label(cost.getKey()));
            lore.add("§eClick to craft " + display.getAmount()); meta.setLore(lore); display.setItemMeta(meta); menu.inventory.setItem(slot,display);
        }
        menu.inventory.setItem(45,button(Material.ARROW,"§ePrevious"));
        menu.inventory.setItem(49,button(Material.CRAFTING_TABLE,resources?"§aBuildings":"§aProcess resources"));
        menu.inventory.setItem(53,button(Material.ARROW,"§eNext")); player.openInventory(menu.inventory);
    }
    private ItemStack button(Material material,String title) { ItemStack item=new ItemStack(material); var meta=item.getItemMeta();meta.setDisplayName(title);item.setItemMeta(meta);return item; }
    private Map<String,Integer> costs(int index,boolean resources) {
        if(resources)return new ArrayList<>(processing.values()).get(index);
        Map<String,Integer> costs=new LinkedHashMap<>();
        for(Object raw:buildings.get(index).getJSONArray("requirements")){ JSONObject entry=(JSONObject)raw;costs.merge(entry.getString("item"),entry.getInt("amount"),Integer::sum); }
        return costs;
    }
    @EventHandler(ignoreCancelled=true) public void interact(PlayerInteractEvent event) {
        if(event.getHand()!=EquipmentSlot.HAND || event.getAction()!=Action.RIGHT_CLICK_BLOCK || !event.getPlayer().isSneaking() || event.getClickedBlock().getType()!=Material.CRAFTING_TABLE)return;
        event.setCancelled(true);open(event.getPlayer(),0,false);
    }
    @EventHandler public void click(InventoryClickEvent event) {
        if(!(event.getView().getTopInventory().getHolder() instanceof Menu menu))return;
        event.setCancelled(true);if(!(event.getWhoClicked() instanceof Player player))return;
        int slot=event.getRawSlot();if(slot==45){open(player,menu.page-1,menu.resources);return;}if(slot==53){open(player,menu.page+1,menu.resources);return;}if(slot==49){open(player,0,!menu.resources);return;}
        int index=menu.page*45+slot, size=menu.resources?processing.size():buildings.size();if(slot<0||slot>=45||index>=size)return;
        String id=menu.resources?new ArrayList<>(processing.keySet()).get(index):buildings.get(index).getString("mindustry");
        if(!menu.resources&&!plugin.buildingRecipes().compatible(id,plugin.worldEnvironment())){player.sendMessage("§c[MSE] This building belongs to another environment. It is available on the corresponding map.");return;}
        ItemStack output=menu.resources?processedOutput(id):plugin.buildingRecipes().item(id,1);
        Map<String,Integer> costs=costs(index,menu.resources);
        for(var cost:costs.entrySet())if(items.count(player,cost.getKey())<cost.getValue()){player.sendMessage("§c[MSE] Missing "+items.label(cost.getKey())+" ("+cost.getValue()+").");return;}
        if(!MindustryItems.canGive(player,output)){player.sendMessage("§c[MSE] Make room in your inventory.");return;}
        for(var cost:costs.entrySet())items.consume(player,cost.getKey(),cost.getValue());
        player.getInventory().addItem(output);player.sendMessage("§a[MSE] Crafted: "+(menu.resources?outputLabel(id):plugin.buildingRecipes().label(id)));
    }
    @EventHandler public void drag(InventoryDragEvent event){if(event.getView().getTopInventory().getHolder() instanceof Menu)event.setCancelled(true);}
}
