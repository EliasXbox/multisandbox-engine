import arc.Core;
import arc.Settings;
import arc.util.I18NBundle;
import mindustry.Vars;
import mindustry.core.ContentLoader;
import mindustry.core.GameState;
import mindustry.world.Block;
import mindustry.world.meta.BuildVisibility;
import mindustry.type.Item;
import mindustry.type.ItemStack;
import org.json.*;
import java.nio.file.*;
import java.util.Properties;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class ExportMindustryContent {
    public static void main(String[] args) throws Exception {
        Vars.headless = true; Core.settings = new Settings(); Core.bundle = I18NBundle.createEmptyBundle();
        Vars.content = new ContentLoader(); Vars.state = new GameState(); Vars.content.createBaseContent();
        Properties labels = new Properties();
        try (var stream = ExportMindustryContent.class.getClassLoader().getResourceAsStream("bundles/bundle.properties")) {
            if (stream != null) labels.load(new InputStreamReader(stream, StandardCharsets.UTF_8));
        }
        JSONArray blocks = new JSONArray(), items = new JSONArray();
        for (Block block : Vars.content.blocks()) {
            JSONArray requirements = new JSONArray();
            for (ItemStack item : block.requirements) requirements.put(new JSONObject().put("item", item.item.name).put("amount", item.amount));
            boolean buildable = block.requirements.length > 0 && block.buildVisibility != BuildVisibility.hidden && block.buildVisibility != BuildVisibility.editorOnly;
            blocks.put(new JSONObject().put("name", block.name).put("label", labels.getProperty("block." + block.name + ".name", block.name))
                .put("size", block.size).put("category", block.category.name()).put("class", block.getClass().getSimpleName())
                .put("buildable", buildable).put("synthetic", block.synthetic()).put("floor", block.isFloor()).put("overlay", block.isOverlay())
                .put("rotate", block.rotate).put("has_items", block.hasItems).put("has_liquids", block.hasLiquids)
                .put("solid", block.solid).put("color", block.mapColor.toString()).put("item_drop", block.itemDrop == null ? JSONObject.NULL : block.itemDrop.name)
                .put("env_enabled", block.envEnabled).put("env_disabled", block.envDisabled).put("env_required", block.envRequired)
                .put("requirements", requirements));
        }
        for (Item item : Vars.content.items()) items.put(new JSONObject().put("name", item.name)
            .put("label", labels.getProperty("item." + item.name + ".name", item.name)).put("color", item.color.toString()));
        JSONObject output = new JSONObject().put("mindustry_version", "160.4").put("blocks", blocks).put("items", items);
        Files.writeString(Path.of(args[0]), output.toString(2));
        System.out.println("Exported " + blocks.length() + " blocks and " + items.length() + " items from the installed game.");
    }
}
