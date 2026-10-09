import com.crossplay.minecraft.*;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.inventory.*;
import sun.misc.Unsafe;
import java.lang.reflect.*;
import java.util.*;

/** Exercises actual Survival event decisions with in-memory Bukkit interfaces. */
public class WallHarvestTest {
    static boolean sneaking;
    static Material tool;
    static Object proxy(Class<?> type, InvocationHandler handler){return Proxy.newProxyInstance(type.getClassLoader(),new Class[]{type},handler);}
    static void field(Object target,String name,Object value)throws Exception{Field field=target.getClass().getDeclaredField(name);field.setAccessible(true);field.set(target,value);}
    public static void main(String[] args)throws Exception{
        Field unsafeField=Unsafe.class.getDeclaredField("theUnsafe");unsafeField.setAccessible(true);Unsafe unsafe=(Unsafe)unsafeField.get(null);
        SurvivalFoundation survival=(SurvivalFoundation)unsafe.allocateInstance(SurvivalFoundation.class);
        UUID worldId=UUID.randomUUID(),playerId=UUID.randomUUID();
        World world=(World)proxy(World.class,(o,m,a)->m.getName().equals("getUID")?worldId:null);
        Location location=new Location(world,2,3,4);
        Block block=(Block)proxy(Block.class,(o,m,a)->m.getName().equals("getLocation")?location:null);
        PlayerInventory inventory=(PlayerInventory)proxy(PlayerInventory.class,(o,m,a)->switch(m.getName()){
            case "getItemInMainHand"->new ItemStack(tool);
            case "getStorageContents"->new ItemStack[]{new ItemStack(Material.STONE,64)};
            default->null;
        });
        Player player=(Player)proxy(Player.class,(o,m,a)->switch(m.getName()){
            case "getGameMode"->GameMode.SURVIVAL;case "getInventory"->inventory;
            case "isSneaking"->sneaking;case "getUniqueId"->playerId;default->null;
        });
        Class<?> cellType=Class.forName("com.crossplay.minecraft.SurvivalFoundation$Cell");
        Constructor<?> constructor=cellType.getDeclaredConstructors()[0];constructor.setAccessible(true);
        Map<String,Object> cells=new HashMap<>();field(survival,"cells",cells);field(survival,"lastHint",new HashMap<>());field(survival,"lastHarvest",new HashMap<>());
        for(String resource:List.of("stone","graphite","")){
            int tier=resource.equals("graphite")?3:1;
            cells.put(worldId+":2:3:4",constructor.newInstance(true,resource,null,tier,1000L,true));
            tool=Material.IRON_PICKAXE;sneaking=!resource.equals("stone")&&!resource.isEmpty();
            BlockBreakEvent event=new BlockBreakEvent(block,player);survival.onBreak(event);
            if(event.isCancelled())throw new AssertionError("wall recovery blocked: "+resource);
            tool=Material.STICK;event=new BlockBreakEvent(block,player);survival.onBreak(event);
            if(!event.isCancelled())throw new AssertionError("wall recovered without pickaxe");
        }
        cells.put(worldId+":2:3:4",constructor.newInstance(true,"graphite",null,3,1000L,true));
        sneaking=false;tool=Material.IRON_PICKAXE;BlockBreakEvent normalMining=new BlockBreakEvent(block,player);survival.onBreak(normalMining);
        if(!normalMining.isCancelled())throw new AssertionError("normal graphite mining removed the deposit");
        System.out.println("PASS: whole-wall recovery needs a pickaxe; graphite recovery needs Shift; normal deposit mining remains protected.");
    }
}
