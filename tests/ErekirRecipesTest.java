import com.crossplay.minecraft.*;
import org.bukkit.*;
import org.bukkit.inventory.*;
import org.json.JSONObject;
import sun.misc.Unsafe;
import java.lang.reflect.*;
import java.util.*;

/** Executes the actual recipe registration and workshop outputs without a live server. */
public final class ErekirRecipesTest {
    public static void main(String[] args) throws Exception {
        List<ShapelessRecipe> registered = new ArrayList<>();
        ItemFactory factory=(ItemFactory)Proxy.newProxyInstance(ItemFactory.class.getClassLoader(),new Class[]{ItemFactory.class},(o,m,a)->m.getName().equals("equals")?Objects.equals(a[0],a[1]):null);
        Server server = (Server) Proxy.newProxyInstance(Server.class.getClassLoader(),new Class[]{Server.class},(o,m,a)->switch(m.getName()) {
            case "getLogger" -> java.util.logging.Logger.getLogger("MSE recipe test");
            case "getName", "getVersion", "getBukkitVersion" -> "in-memory";
            case "getItemFactory" -> factory;
            case "addRecipe" -> { registered.add((ShapelessRecipe)a[0]); yield true; }
            case "removeRecipe" -> false;
            default -> null;
        });
        Bukkit.setServer(server);
        Field field = Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true);
        SurvivalFoundation survival=(SurvivalFoundation)((Unsafe)field.get(null)).allocateInstance(SurvivalFoundation.class);
        Method register=SurvivalFoundation.class.getDeclaredMethod("registerConversion",NamespacedKey.class,Material.class,Material.class,int.class);register.setAccessible(true);
        register.invoke(survival,NamespacedKey.minecraft("test_wood"),Material.EMERALD,Material.OAK_PLANKS,4);
        register.invoke(survival,NamespacedKey.minecraft("test_iron"),Material.CHARCOAL,Material.IRON_INGOT,1);
        Material[] inputs={Material.EMERALD,Material.CHARCOAL}, outputs={Material.OAK_PLANKS,Material.IRON_INGOT}; int[] counts={4,1};
        for(int i=0;i<2;i++){
            ShapelessRecipe recipe=registered.get(i);
            if(recipe.getIngredientList().size()!=4||recipe.getIngredientList().stream().anyMatch(item->item.getType()!=inputs[registered.indexOf(recipe)]))throw new AssertionError("Wrong ingredients");
            if(recipe.getResult().getType()!=outputs[i]||recipe.getResult().getAmount()!=counts[i])throw new AssertionError("Wrong output");
        }
        MseWorkshop workshop=new MseWorkshop(null,new JSONObject().put("mappings",new org.json.JSONArray()),null);
        Method output=MseWorkshop.class.getDeclaredMethod("processedOutput",String.class);output.setAccessible(true);
        Field processing=MseWorkshop.class.getDeclaredField("processing");processing.setAccessible(true);
        Map<?,?> recipes=(Map<?,?>)processing.get(workshop);
        if(!recipes.get("wood").equals(Map.of("beryllium",4))||!recipes.get("iron").equals(Map.of("graphite",4)))throw new AssertionError("Wrong workshop costs");
        for(int i=0;i<2;i++){ItemStack item=(ItemStack)output.invoke(workshop,i==0?"wood":"iron");if(item.getType()!=outputs[i]||item.getAmount()!=counts[i])throw new AssertionError("Workshop differs from crafting grid");}
        System.out.println("PASS: 4 beryllium -> 4 planks and 4 graphite -> 1 iron in the crafting grid and core workshop.");
    }
}
