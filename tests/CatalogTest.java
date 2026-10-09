import org.bukkit.Material;
import org.json.JSONObject;
public final class CatalogTest {
    public static void main(String[] args)throws Exception{
        var registry=new JSONObject(java.nio.file.Files.readString(java.nio.file.Path.of(args[0])));
        int count=0;
        for(Object raw:registry.getJSONArray("mappings")){
            JSONObject entry=(JSONObject)raw;Material material=Material.matchMaterial(entry.getString("minecraft"));
            if(material==null||!material.isBlock())throw new AssertionError("Invalid model: "+entry.getString("mindustry"));
            if(entry.getJSONArray("requirements").isEmpty())throw new AssertionError("Missing survival costs: "+entry.getString("mindustry"));count++;
        }
        if(count!=245)throw new AssertionError("Incomplete catalog: "+count);
        System.out.println("PASS: all 245 models use valid Minecraft 1.20.1 block materials and have survival costs.");
    }
}
