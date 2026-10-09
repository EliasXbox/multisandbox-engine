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
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataType;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.file.*;
import java.util.*;

/** Virtual inventories are views. Only the Mindustry host can commit a transfer. */
public final class BuildingInteractions implements Listener {
    private final MinecraftBridge plugin;
    private final MindustryItems items;
    private final Map<String,JSONObject> cells = new HashMap<>();
    private final Map<UUID,JSONObject> pending = new LinkedHashMap<>();
    private final Map<UUID,Menu> menus = new HashMap<>();
    private final Map<UUID,JSONObject> linkSources = new HashMap<>();
    private final NamespacedKey receipts;
    private final NamespacedKey reservation;
    private final Path journal;
    private static final class Menu implements InventoryHolder {
        Inventory inventory; JSONObject cell; String[] ids=new String[27];
        public Inventory getInventory(){return inventory;}
    }
    public BuildingInteractions(MinecraftBridge plugin,MindustryItems items){
        this.plugin=plugin;this.items=items;receipts=new NamespacedKey(plugin,"inventory_receipts");reservation=new NamespacedKey(plugin,"inventory_reservation");
        journal=plugin.getDataFolder().toPath().resolve("inventory-transfers.json");
        try{if(Files.exists(journal))for(Object raw:new JSONArray(Files.readString(journal))) {JSONObject record=(JSONObject)raw;pending.put(UUID.fromString(record.getString("player_id")),record);}}
        catch(Exception error){throw new IllegalStateException("Could not recover inventory transfer journal",error);}
    }
    private String key(int x,int y,int z){return x+":"+y+":"+z;}
    public void clearCells(){cells.clear();linkSources.clear();for(UUID id:new HashSet<>(menus.keySet())){Player p=Bukkit.getPlayer(id);if(p!=null)p.closeInventory();}menus.clear();}
    public void updateCell(int x,int y,int z,JSONObject packet,Material material){
        String key=key(x,y,z);
        if(material==Material.AIR||(!packet.optBoolean("has_items")&&packet.optString("configuration").isEmpty())){cells.remove(key);return;}
        cells.put(key,packet);
    }
    private void save(){
        try{Files.createDirectories(journal.getParent());Path temporary=journal.resolveSibling(journal.getFileName()+".tmp");
            Files.writeString(temporary,new JSONArray(pending.values()).toString());
            try{Files.move(temporary,journal,StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE);}
            catch(AtomicMoveNotSupportedException ignored){Files.move(temporary,journal,StandardCopyOption.REPLACE_EXISTING);}
        }catch(IOException error){throw new IllegalStateException("Could not save inventory transfer journal",error);}
    }
    private JSONObject request(Player player,JSONObject cell,String operation,String resource,int amount){
        JSONObject packet=new JSONObject().put("type","BUILDING_INVENTORY_REQUEST").put("request_id",UUID.randomUUID().toString())
            .put("player_id",player.getUniqueId().toString()).put("object_id",cell.getString("object_id"))
            .put("operation",operation).put("resource",resource==null?"":resource).put("amount",amount)
            .put("world_epoch",plugin.worldEpoch());
        return packet;
    }
    private void read(Player player,Menu menu){plugin.sendGameplay(request(player,menu.cell,"read",null,0));}
    @EventHandler(ignoreCancelled=true)public void interact(PlayerInteractEvent event){
        if(event.getHand()!=EquipmentSlot.HAND||event.getAction()!=Action.RIGHT_CLICK_BLOCK||event.getClickedBlock()==null)return;
        var block=event.getClickedBlock();JSONObject cell=cells.get(key(block.getX(),block.getY(),block.getZ()));
        if(cell==null)return;event.setCancelled(true);
        Player player=event.getPlayer();if(!plugin.readyForGameplay()){player.sendMessage("§e[MSE] Please wait for World Sync.");return;}
        if(player.isSneaking()){
            JSONObject source=linkSources.remove(player.getUniqueId());
            if(source!=null){plugin.sendGameplay(new JSONObject().put("type","BUILDING_CONFIGURE").put("player_id",player.getUniqueId().toString()).put("object_id",source.optString("object_id")).put("target_id",cell.optString("object_id")));player.sendMessage("§a[MSE] Link request sent to Mindustry.");return;}
            if(cell.optString("configuration").equals("item")){
                String resource=items.id(player.getInventory().getItemInMainHand());
                if(resource==null&&!player.getInventory().getItemInMainHand().getType().isAir()){player.sendMessage("§e[MSE] Hold a resource to select the filter, or use an empty hand to clear it.");return;}
                plugin.sendGameplay(new JSONObject().put("type","BUILDING_CONFIGURE").put("player_id",player.getUniqueId().toString()).put("object_id",cell.optString("object_id")).put("resource",resource==null?"":resource));return;
            }
            if(cell.optString("configuration").equals("link")){linkSources.put(player.getUniqueId(),cell);player.sendMessage("§e[MSE] Source selected. Sneak + right-click the target to toggle the link.");return;}
        }
        if(!cell.optBoolean("has_items")){player.sendMessage("§e[MSE] Sneak + right-click to select a link.");return;}
        if(pending.containsKey(player.getUniqueId())){player.sendMessage("§e[MSE] Waiting for the previous transfer to be confirmed.");return;}
        Menu menu=new Menu();menu.cell=cell;menu.inventory=Bukkit.createInventory(menu,36,"[MSE] "+plugin.buildingRecipes().label(cell.optString("mindustry_block")));
        ItemStack help=new ItemStack(Material.PAPER);var meta=help.getItemMeta();meta.setDisplayName("§eWithdraw / deposit resources");
        meta.setLore(List.of("§7Click: withdraw 1; Shift: withdraw up to 64", "§7Click a resource in your inventory to deposit it", "§7Shift-click a resource to deposit its stack"));help.setItemMeta(meta);menu.inventory.setItem(31,help);
        if(cell.optString("mindustry_block").startsWith("core-")){ItemStack craft=new ItemStack(Material.CRAFTING_TABLE);var craftMeta=craft.getItemMeta();craftMeta.setDisplayName("§aMSE Workshop");craft.setItemMeta(craftMeta);menu.inventory.setItem(33,craft);}
        menus.put(player.getUniqueId(),menu);player.openInventory(menu.inventory);read(player,menu);
    }
    @EventHandler public void click(InventoryClickEvent event){
        if(!(event.getView().getTopInventory().getHolder() instanceof Menu menu))return;event.setCancelled(true);
        if(!(event.getWhoClicked() instanceof Player player)||pending.containsKey(player.getUniqueId())||!plugin.readyForGameplay())return;
        String resource;String operation;int amount;ItemStack escrow=null;
        int slot=event.getRawSlot();
        if(slot==33&&menu.cell.optString("mindustry_block").startsWith("core-")){plugin.openWorkshop(player);return;}
        if(slot>=0&&slot<27){resource=menu.ids[slot];if(resource==null)return;operation="take";amount=event.isShiftClick()?64:1;
            ItemStack output=items.item(resource,amount);if(!MindustryItems.canGive(player,output)){player.sendMessage("§c[MSE] Make room in your inventory.");return;}}
        else if(event.getClickedInventory()==player.getInventory()){
            ItemStack stack=event.getCurrentItem();resource=items.id(stack);if(resource==null)return;operation="put";amount=event.isShiftClick()?stack.getAmount():1;
            escrow=stack.clone();escrow.setAmount(amount);
        }else return;
        JSONObject record=request(player,menu.cell,operation,resource,amount);
        if(escrow!=null)record.put("escrow",encode(escrow));
        pending.put(player.getUniqueId(),record);save();
        if(escrow!=null){ItemStack stack=event.getCurrentItem();if(stack.getAmount()==amount)event.setCurrentItem(null);else{stack.setAmount(stack.getAmount()-amount);event.setCurrentItem(stack);}
            player.getPersistentDataContainer().set(reservation,PersistentDataType.STRING,record.getString("request_id"));player.saveData();}
        plugin.sendGameplay(new JSONObject(record.toString()));
    }
    @EventHandler public void drag(InventoryDragEvent event){if(event.getView().getTopInventory().getHolder() instanceof Menu)event.setCancelled(true);}
    @EventHandler public void closeMenu(org.bukkit.event.inventory.InventoryCloseEvent event){if(event.getInventory().getHolder() instanceof Menu menu && menus.get(event.getPlayer().getUniqueId())==menu)menus.remove(event.getPlayer().getUniqueId());}
    public void result(JSONObject packet){
        UUID id;try{id=UUID.fromString(packet.getString("player_id"));}catch(Exception ignored){return;}
        Player player=Bukkit.getPlayer(id);Menu menu=menus.get(id);
        if(player!=null&&menu!=null&&player.getOpenInventory().getTopInventory()==menu.inventory &&
                packet.optString("object_id").equals(menu.cell.optString("object_id"))&&packet.optLong("world_epoch")==plugin.worldEpoch()){
            Arrays.fill(menu.ids,null);for(int i=0;i<27;i++)menu.inventory.setItem(i,null);
            JSONArray resources=packet.optJSONArray("items");if(resources!=null){int slot=0;for(Object raw:resources){if(slot>=27)break;JSONObject entry=(JSONObject)raw;String resource=entry.getString("item");int count=entry.getInt("amount");ItemStack display=items.item(resource,Math.min(64,Math.max(1,count)));if(display==null)continue;
                var meta=display.getItemMeta();meta.setDisplayName("§d"+items.label(resource)+" §f× "+count);display.setItemMeta(meta);menu.ids[slot]=resource;menu.inventory.setItem(slot++,display);}}
        }
        JSONObject record=pending.get(id);if(record==null||!record.optString("request_id").equals(packet.optString("request_id")))return;
        if(packet.optString("status").equals("unknown")){if(player!=null)player.sendMessage("§c[MSE] The transfer was not confirmed after the map changed. It has been preserved for recovery.");return;}
        record.put("result",packet);save();deliver(id,record);
    }
    private void deliver(UUID id,JSONObject record){
        Player player=Bukkit.getPlayer(id);if(player==null||!record.has("result"))return;
        String token=record.getString("request_id");String log=player.getPersistentDataContainer().getOrDefault(receipts,PersistentDataType.STRING,"");
        if(!Arrays.asList(log.split(",")).contains(token)){
            JSONObject result=record.getJSONObject("result");int accepted=Math.max(0,Math.min(record.getInt("amount"),result.optInt("accepted")));
            ItemStack output=null;
            if(record.getString("operation").equals("take")){if(accepted>0)output=items.item(record.getString("resource"),accepted);}
            else{int refund=record.getInt("amount")-accepted;if(refund>0){output=decode(record.getString("escrow"));output.setAmount(refund);}}
            if(output!=null&&!MindustryItems.canGive(player,output)){player.sendMessage("§e[MSE] Make room to receive the pending transfer.");return;}
            if(output!=null)player.getInventory().addItem(output);
            List<String> history=new ArrayList<>(Arrays.asList(log.split(",")));history.remove("");history.add(token);while(history.size()>512)history.remove(0);
            player.getPersistentDataContainer().set(receipts,PersistentDataType.STRING,String.join(",",history));player.getPersistentDataContainer().remove(reservation);player.saveData();
            player.sendMessage("§a[MSE] Transfer confirmed: "+accepted+" × "+items.label(record.getString("resource")));
        }
        pending.remove(id);save();
    }
    public void tick(){
        for(var entry:new ArrayList<>(pending.entrySet())){
            Player player=Bukkit.getPlayer(entry.getKey());
            if(player==null)continue;
            if(entry.getValue().has("escrow")&&!entry.getValue().has("result")&&
                    !entry.getValue().getString("request_id").equals(player.getPersistentDataContainer().get(reservation,PersistentDataType.STRING))){
                // Journal saved before the reservation reached player data: no request was sent.
                pending.remove(entry.getKey());save();continue;
            }
            if(entry.getValue().has("result"))deliver(entry.getKey(),entry.getValue());
            else if(plugin.readyForGameplay())plugin.sendGameplay(new JSONObject(entry.getValue().toString()));
        }
    }
    public void close(){save();}
    private static String encode(ItemStack item){try{var bytes=new ByteArrayOutputStream();try(var out=new org.bukkit.util.io.BukkitObjectOutputStream(bytes)){out.writeObject(item);}return Base64.getEncoder().encodeToString(bytes.toByteArray());}catch(IOException error){throw new IllegalStateException(error);}}
    private static ItemStack decode(String text){try(var in=new org.bukkit.util.io.BukkitObjectInputStream(new ByteArrayInputStream(Base64.getDecoder().decode(text)))){return (ItemStack)in.readObject();}catch(Exception error){throw new IllegalStateException(error);}}
}
