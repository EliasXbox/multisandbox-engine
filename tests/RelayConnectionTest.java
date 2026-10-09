import com.crossplay.network.RelayClient;
import org.json.JSONObject;
import java.net.URI;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicReference;

class RelayConnectionTest {
    public static void main(String[] args) throws Exception {
        ScheduledExecutorService ticks = Executors.newSingleThreadScheduledExecutor();
        CountDownLatch edit = new CountDownLatch(1);
        AtomicReference<RelayClient> reference = new AtomicReference<>();
        RelayClient client = new RelayClient(new URI(args[0]), "MINECRAFT", packet -> {
            if (!"WORLD_BLOCK_BATCH".equals(packet.optString("type"))) return;
            if (packet.getJSONArray("packets").length() > 256) throw new AssertionError("Unbounded batch");
            for (Object raw : packet.getJSONArray("packets")) {
                if (((JSONObject) raw).optInt("revision") == 999) {
                    reference.get().send(new JSONObject().put("type", "LATENCY_PROBE_ACK").toString());
                    edit.countDown();
                }
            }
            ticks.schedule(() -> reference.get().acknowledgeBatch(packet.getLong("stream_id"),
                    packet.getLong("batch_id")), 50, TimeUnit.MILLISECONDS);
        });
        reference.set(client);
        try {
            if (!client.connectBlocking(3, TimeUnit.SECONDS)) throw new AssertionError("Connection failed");
            if (!edit.await(3, TimeUnit.SECONDS)) throw new AssertionError("Small edit starved behind snapshot");
            client.closeBlocking();
            for (int i = 0; i < 100; i++) client.sendPlayerState("test", "test", 0, 0, 5, 0);
            System.out.println("PASS: real Java WebSocket client, ACK batches, prioritized edit and safe sends after disconnect.");
        } finally { ticks.shutdownNow(); client.close(); }
    }
}
