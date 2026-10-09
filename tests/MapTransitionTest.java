import com.crossplay.minecraft.MinecraftBridge;
import com.crossplay.minecraft.SurvivalFoundation;
import com.crossplay.minecraft.MindustryCombat;
import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.plugin.PluginDescriptionFile;
import org.bukkit.plugin.PluginLogger;
import org.json.JSONObject;
import sun.misc.Unsafe;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** Runs the real Minecraft block application loop against an in-memory Bukkit world. */
public class MapTransitionTest {
    static final Map<String, Material> blocks = new HashMap<>();
    static final List<String> edits = new ArrayList<>();
    static World world;
    static boolean loaded = true;
    static CompletableFuture<Chunk> loading = new CompletableFuture<>();
    static Object empty(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == long.class) return 0L;
        if (type == double.class) return 0d;
        if (type == float.class) return 0f;
        if (type == void.class) return null;
        return 0;
    }
    static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class[]{type}, handler));
    }
    static void set(Object object, String name, Object value) throws Exception {
        Class<?> type = object.getClass();
        while (type != null) {
            try { Field field = type.getDeclaredField(name); field.setAccessible(true); field.set(object, value); return; }
            catch (NoSuchFieldException ignored) { type = type.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }
    static MinecraftBridge bridge(long oldEpoch, Unsafe unsafe) throws Exception {
        MinecraftBridge bridge = (MinecraftBridge) unsafe.allocateInstance(MinecraftBridge.class);
        set(bridge, "server", Bukkit.getServer());
        set(bridge, "description", new PluginDescriptionFile("MSE", "test", MinecraftBridge.class.getName()));
        set(bridge, "logger", new PluginLogger(bridge));
        set(bridge, "mseCells", new HashSet<>(Set.of("0:2:0", "1:2:0")));
        set(bridge, "mindustryPlayerProxies", new HashMap<>());
        set(bridge, "worldPackets", new ArrayBlockingQueue<JSONObject>(1024));
        set(bridge, "streamReset", new AtomicReference<JSONObject>());
        set(bridge, "snapshotOverrides", new HashMap<>());
        set(bridge, "cellsToClear", new ArrayDeque<String>());
        set(bridge, "pendingChunks", new HashMap<>()); set(bridge, "chunkTickets", new LinkedHashMap<>());
        set(bridge, "appliedWorldEpoch", oldEpoch); set(bridge, "activeStreamId", 1L);
        SurvivalFoundation survival = (SurvivalFoundation) unsafe.allocateInstance(SurvivalFoundation.class);
        set(survival, "cells", new HashMap<>()); set(survival, "plugin", bridge); set(bridge, "survival", survival);
        set(bridge, "combat", new MindustryCombat(bridge));
        return bridge;
    }
    static Queue<JSONObject> queue(MinecraftBridge bridge) throws Exception {
        Field field = MinecraftBridge.class.getDeclaredField("worldPackets"); field.setAccessible(true);
        return (Queue<JSONObject>) field.get(bridge);
    }
    static void apply(MinecraftBridge bridge) throws Exception {
        Method apply = MinecraftBridge.class.getDeclaredMethod("applyWorldPackets"); apply.setAccessible(true);
        for (int i = 0; i < 1000; i++) { apply.invoke(bridge); Thread.yield(); }
    }
    public static void main(String[] args) throws Exception {
        Field field = Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true); Unsafe unsafe = (Unsafe) field.get(null);
        world = proxy(World.class, (obj, method, values) -> switch (method.getName()) {
            case "getUID" -> new UUID(1, 1);
            case "getMinHeight" -> -64;
            case "getMaxHeight" -> 320;
            case "isChunkLoaded" -> loaded;
            case "getChunkAtAsync" -> loading;
            case "getBlockAt" -> {
                String key = values[0] + ":" + values[1] + ":" + values[2];
                yield proxy(Block.class, (block, call, arguments) -> switch (call.getName()) {
                    case "getType" -> blocks.getOrDefault(key, Material.AIR);
                    case "setType" -> { blocks.put(key, (Material) arguments[0]); edits.add(key + "=" + arguments[0]); yield null; }
                    default -> empty(call.getReturnType());
                });
            }
            default -> empty(method.getReturnType());
        });
        Bukkit.setServer(proxy(Server.class, (obj, method, values) -> switch (method.getName()) {
            case "getWorlds" -> List.of(world);
            case "getLogger" -> java.util.logging.Logger.getLogger("MSE-Test");
            case "getName", "getVersion", "getBukkitVersion" -> "in-memory-test";
            default -> empty(method.getReturnType());
        }));
        for (boolean changed : new boolean[]{true, false}) {
            blocks.clear(); edits.clear(); blocks.put("0:2:0", Material.STONE); blocks.put("1:2:0", Material.STONE);
            MinecraftBridge bridge = bridge(10, unsafe);
            queue(bridge).add(new JSONObject().put("type", "WORLD_SNAPSHOT_BEGIN").put("meta", new JSONObject().put("world_epoch", changed ? 11 : 10)));
            queue(bridge).add(new JSONObject().put("type", "MC_SET_BLOCK").put("x", 0).put("y", 2).put("z", 0).put("block_id", "minecraft:dirt"));
            apply(bridge);
            if (blocks.get("0:2:0") != Material.DIRT) throw new AssertionError("new map cell missing");
            if (changed) {
                if (blocks.get("1:2:0") != Material.AIR) throw new AssertionError("old map remained");
                if (!edits.subList(0, 2).stream().allMatch(edit -> edit.endsWith("=AIR"))) throw new AssertionError("new map placed before clear");
            } else if (blocks.get("1:2:0") != Material.STONE) throw new AssertionError("same-map reconnect cleared too early");
        }
        MinecraftBridge waiting = bridge(10, unsafe);
        loaded = false; edits.clear();
        queue(waiting).add(new JSONObject().put("type", "MC_SET_BLOCK").put("x", 32).put("y", 2).put("z", 32).put("block_id", "minecraft:dirt"));
        apply(waiting);
        if (!edits.isEmpty() || queue(waiting).size() != 1) throw new AssertionError("block application forced an unloaded chunk");
        loaded = true; loading.complete(null); apply(waiting);
        if (blocks.get("32:2:32") != Material.DIRT || !queue(waiting).isEmpty()) throw new AssertionError("ready chunk did not resume");
        System.out.println("PASS: real Minecraft application loop clears old map before new blocks; same-map reconnect retains diff behavior. In-memory world only.");
    }
}
