const http = require("http");\nconst fs = require("fs");\nconst path = require("path");
const WebSocket = require("ws");
const WorldState = require("./world-state");
const BLOCK_REGISTRY = require("./registry/block-mappings.json");
const WORLD_CONFIG = require("./config/world-sync.json");

const BLOCK_MAP = Object.fromEntries(BLOCK_REGISTRY.mappings.map(entry => [entry.mindustry, entry]));
const REVERSE_BLOCK_MAP = Object.fromEntries(
    BLOCK_REGISTRY.mappings.map(entry => [entry.minecraft.replace(/^minecraft:/, "").toUpperCase(), entry])
);

const world = new WorldState();
const STATE_FILE = path.join(__dirname, "data", "world-state.json");
const deferredDuringSnapshot = [];

function persistWorld() {
    try {
        fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
        const temp = STATE_FILE + ".tmp";
        fs.writeFileSync(temp, JSON.stringify(world.exportData(), null, 2));
        fs.renameSync(temp, STATE_FILE);
    } catch (err) {
        console.error("[MSE] Could not persist world state:", err.message);
    }
}

function loadPersistedWorld() {
    try {
        if (!fs.existsSync(STATE_FILE)) return;
        world.loadData(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")));
        console.log(`[MSE] Restored persisted world state: ${world.objects.size} objects at r${world.revision}`);
    } catch (err) {
        console.error("[MSE] Could not restore persisted world state:", err.message);
    }
}

loadPersistedWorld();
const clients = new Map();
const httpQueues = new Map([["MINDUSTRY", []]]);
let lastChatMessage = "";
let lastChatTime = 0;

function normalizeType(data) {
    return data.type || data.action || null;
}

function enqueue(targetGame, payload) {
    const game = String(targetGame).toUpperCase();
    if (!httpQueues.has(game)) httpQueues.set(game, []);
    const queue = httpQueues.get(game);
    queue.push(payload);
    if (queue.length > 4096) queue.shift();
}

function sendTo(targetGame, payload) {
    const socket = clients.get(String(targetGame).toUpperCase());
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(payload));
        return true;
    }
    return false;
}

function broadcast(payload, exceptSocket = null) {
    wss.clients.forEach(client => {
        if (client !== exceptSocket && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    });
}

function mindustryToMse(rawX, rawY) {
    const cfg = WORLD_CONFIG.mindustry_to_mse || {};
    const width = Number(world.meta.width || 0);
    const height = Number(world.meta.height || 0);
    let x = Number(rawX);
    let z = Number(rawY);

    if (cfg.flip_x) x = width > 0 ? (width - 1 - x) : -x;
    if (cfg.flip_z) z = height > 0 ? (height - 1 - z) : -z;

    return {
        x: x + Number(cfg.offset_x || 0),
        z: z + Number(cfg.offset_z || 0)
    };
}

function mseToMindustry(rawX, rawZ) {
    const cfg = WORLD_CONFIG.mindustry_to_mse || {};
    const width = Number(world.meta.width || 0);
    const height = Number(world.meta.height || 0);
    let x = Number(rawX) - Number(cfg.offset_x || 0);
    let y = Number(rawZ) - Number(cfg.offset_z || 0);

    if (cfg.flip_x) x = width > 0 ? (width - 1 - x) : -x;
    if (cfg.flip_z) y = height > 0 ? (height - 1 - y) : -y;

    return { x, y };
}

function objectFromMindustry(data) {
    const blockName = String(data.block || data.block_id || "unknown");
    const entry = BLOCK_MAP[blockName];
    if (!entry) return null;
    const pos = mindustryToMse(data.x, data.y);
    return {
        kind: "block",
        layer: data.layer || "block",
        mindustry: entry.mindustry,
        minecraft: entry.minecraft,
        x: pos.x,
        z: pos.z,
        y: 1,
        volume: entry.volume || { x: 1, z: 1, y: 1 },
        rotation: data.rotation || 0,
        source_game: "MINDUSTRY"
    };
}

function renderObjectToMinecraft(object, material = null) {
    const blockId = material || object.minecraft || "minecraft:air";
    for (let dx = 0; dx < object.volume.x; dx++) {
        for (let dz = 0; dz < object.volume.z; dz++) {
            for (let dy = 0; dy < object.volume.y; dy++) {
                sendTo("MINECRAFT", {
                    type: "MC_SET_BLOCK",
                    source_game: "MSE",
                    object_id: object.id,
                    revision: object.revision,
                    x: object.origin.x + dx,
                    z: object.origin.z + dz,
                    y: object.origin.y + dy,
                    block_id: blockId,
                    mse_origin: object.origin,
                    mse_volume: object.volume
                });
            }
        }
    }
}

function sendObjectToMindustry(object, blockId = null) {
    const pos = mseToMindustry(object.origin.x, object.origin.z);
    enqueue("MINDUSTRY", {
        type: "MINDUSTRY_SET_BLOCK",
        source_game: "MSE",
        object_id: object.id,
        revision: object.revision,
        x: pos.x,
        y: pos.y,
        block_id: blockId || object.mindustry || "air",
        rotation: object.rotation || 0,
        mse_volume: object.volume
    });
}

function publishCreate(object, sourceGame) {
    if (sourceGame !== "MINECRAFT") renderObjectToMinecraft(object);
    else renderObjectToMinecraft(object); // completes multi-cell/3D representation around the placed anchor.

    if (sourceGame !== "MINDUSTRY") sendObjectToMindustry(object);
    console.log(`[MSE][WORLD r${object.revision}] CREATE ${object.id} ${object.mindustry} <-> ${object.minecraft} @ ${object.origin.x},${object.origin.z} volume ${object.volume.x}x${object.volume.z}x${object.volume.y}`);
}

function publishRemove(object, sourceGame) {
    renderObjectToMinecraft(object, "minecraft:air");
    sendObjectToMindustry(object, "air");
    console.log(`[MSE][WORLD r${object.revision}] REMOVE ${object.id} requested by ${sourceGame}`);
}

function handleMindustryBlock(data) {
    if (world.snapshot) {
        deferredDuringSnapshot.push({ ...data });
        return;
    }

    const destroying = data.destroy === true || data.breaking === true ||
        String(data.block || data.block_id || "").startsWith("build");
    const pos = mindustryToMse(data.x, data.y);

    if (destroying) {
        const removed = world.removeAt(pos.x, pos.z, data.layer || "block");
        if (!removed) {
            console.warn(`[MSE] Mindustry destroy found no MSE object @ ${pos.x},${pos.z}`);
            return;
        }
        publishRemove(removed, "MINDUSTRY");
        return;
    }

    const spec = objectFromMindustry(data);
    if (!spec) {
        console.warn(`[MSE] UNMAPPED Mindustry block: ${data.block || data.block_id}; skipped.`);
        return;
    }
    publishCreate(world.createObject(spec), "MINDUSTRY");\n    persistWorld();
}

function handleMinecraftBlock(data) {
    const minecraftBlock = String(data.block_id || data.block || "AIR").replace(/^minecraft:/i, "").toUpperCase();
    const entry = REVERSE_BLOCK_MAP[minecraftBlock];
    if (!entry) {
        console.warn(`[MSE] UNMAPPED Minecraft block: ${minecraftBlock}; skipped.`);
        return;
    }

    const object = world.createObject({
        kind: "block",
        layer: "block",
        mindustry: entry.mindustry,
        minecraft: entry.minecraft,
        x: Number(data.x),
        z: Number(data.z),
        y: 1,
        volume: entry.volume || { x: 1, z: 1, y: 1 },
        source_game: "MINECRAFT"
    });
    publishCreate(object, "MINECRAFT");\n    persistWorld();
}

function handleMinecraftBreak(data) {
    const removed = world.removeAt(Number(data.x), Number(data.z), "block");
    if (!removed) {
        console.warn(`[MSE] Minecraft break found no MSE object @ ${data.x},${data.z}`);
        return;
    }
    publishRemove(removed, "MINECRAFT");\n    persistWorld();
}

function handleSnapshotBegin(data) {
    if (String(data.source_game || data.game || "").toUpperCase() !== String(WORLD_CONFIG.authority || "MINDUSTRY").toUpperCase()) {
        console.warn("[MSE] Snapshot rejected: source is not current authority.");
        return;
    }
    world.beginSnapshot({
        width: Number(data.width || 0) || null,
        height: Number(data.height || 0) || null,
        authority: String(data.source_game || data.game).toUpperCase(),
        snapshot_id: data.snapshot_id || null
    });
    console.log(`[MSE][SNAPSHOT] BEGIN ${data.snapshot_id || ""} ${data.width || "?"}x${data.height || "?"}`);
}

function handleSnapshotChunk(data) {
    if (!world.snapshot) return;
    const converted = [];
    for (const item of (data.objects || [])) {
        const spec = objectFromMindustry(item);
        if (spec) converted.push(spec);
    }
    world.appendSnapshot(converted);
    console.log(`[MSE][SNAPSHOT] CHUNK +${converted.length} mapped objects`);
}

function sendSnapshotToMinecraft() {
    sendTo("MINECRAFT", { type: "WORLD_SNAPSHOT_BEGIN", revision: world.revision, meta: world.meta });
    for (const object of world.objects.values()) renderObjectToMinecraft(object);
    sendTo("MINECRAFT", { type: "WORLD_SNAPSHOT_END", revision: world.revision, object_count: world.objects.size });
}

function handleSnapshotEnd(data) {
    if (!world.snapshot) return;
    const committed = world.commitSnapshot();
    console.log(`[MSE][SNAPSHOT] COMMIT r${committed.revision}: ${committed.objects.length} objects`);
    while (deferredDuringSnapshot.length > 0) {
        handleMindustryBlock(deferredDuringSnapshot.shift());
    }
    persistWorld();
    sendSnapshotToMinecraft();
}

function handlePlayerState(data) {
    const sourceGame = String(data.source_game || data.game || "UNKNOWN").toUpperCase();
    let x = Number(data.x || 0), z = Number(data.z != null ? data.z : data.y || 0);
    if (sourceGame === "MINDUSTRY") {
        const pos = mindustryToMse(x, z);
        x = pos.x; z = pos.z;
    }

    const player = world.setPlayer({
        id: data.player_id || `${sourceGame}:${data.player || "player"}`,
        source_game: sourceGame,
        name: data.player || data.name || "Player",
        x, z,
        y: data.mse_y == null ? 5 : data.mse_y,
        rotation: data.rotation || 0,
        connected: true
    });

    const packet = { type: "PLAYER_STATE", ...player };
    if (sourceGame === "MINDUSTRY") sendTo("MINECRAFT", packet);
    else if (sourceGame === "MINECRAFT") {
        const pos = mseToMindustry(player.x, player.z);
        enqueue("MINDUSTRY", { ...packet, x: pos.x, y: pos.y });
    }
}

function handlePlayerDespawn(data) {
    const id = data.player_id || `${String(data.source_game || data.game || "UNKNOWN").toUpperCase()}:${data.player || "player"}`;
    const player = world.removePlayer(id);
    if (!player) return;
    const packet = { type: "PLAYER_DESPAWN", player_id: id, source_game: player.source_game };
    if (player.source_game === "MINDUSTRY") sendTo("MINECRAFT", packet);
    else enqueue("MINDUSTRY", packet);
}

function handleChat(data, sourceGame, sourceSocket = null) {
    const now = Date.now();
    const player = data.player || `${sourceGame}User`;
    const message = data.message || "";
    const msgKey = `${sourceGame}:${player}:${message}`;
    if (!message) return;
    if (msgKey === lastChatMessage && (now - lastChatTime) <= 500) return;

    lastChatMessage = msgKey;
    lastChatTime = now;
    const payload = { type: "CHAT_MESSAGE", game: sourceGame, source_game: sourceGame, player, message };
    if (sourceGame === "MINDUSTRY") broadcast(payload, sourceSocket);
    else {
        enqueue("MINDUSTRY", payload);
        broadcast(payload, sourceSocket);
    }
}

function handlePacket(data, ws = null) {
    const packetType = normalizeType(data);
    const sourceGame = String(data.game || data.source_game || "").toUpperCase();

    if (packetType === "CONNECT") {
        if (!sourceGame || !ws) return;
        clients.set(sourceGame, ws);
        ws.mseGame = sourceGame;
        ws.send(JSON.stringify({ type: "CONNECTED", game: sourceGame, status: "ok", world: world.summary() }));
        if (sourceGame === "MINECRAFT" && world.objects.size > 0) sendSnapshotToMinecraft();
        return;
    }

    if (packetType === "PLACE_BLOCK") {
        if (sourceGame === "MINDUSTRY") handleMindustryBlock(data);
        else if (sourceGame === "MINECRAFT") handleMinecraftBlock(data);
        return;
    }
    if (packetType === "BREAK_BLOCK" && sourceGame === "MINECRAFT") return handleMinecraftBreak(data);
    if (packetType === "WORLD_SNAPSHOT_BEGIN") return handleSnapshotBegin(data);
    if (packetType === "WORLD_SNAPSHOT_CHUNK") return handleSnapshotChunk(data);
    if (packetType === "WORLD_SNAPSHOT_END") return handleSnapshotEnd(data);
    if (packetType === "PLAYER_STATE") return handlePlayerState(data);
    if (packetType === "PLAYER_DESPAWN") return handlePlayerDespawn(data);
    if (packetType === "CHAT_MESSAGE") return handleChat(data, sourceGame || "UNKNOWN", ws);

    console.log("[MSE] Ignored packet:", data);
}

const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/event") {
        let body = "";
        req.on("data", chunk => body += chunk.toString());
        req.on("end", () => {
            try {
                handlePacket(JSON.parse(body));
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ok", revision: world.revision }));
            } catch (err) {
                console.error("[MSE] Invalid HTTP event:", err);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "error", error: err.message }));
            }
        });
        return;
    }

    if (req.method === "GET" && req.url.startsWith("/poll")) {
        const url = new URL(req.url, "http://localhost");
        const game = String(url.searchParams.get("game") || "").toUpperCase();
        const queue = httpQueues.get(game) || [];
        const events = queue.splice(0, queue.length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", revision: world.revision, events }));
        return;
    }

    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            websocketClients: wss.clients.size,
            registeredGames: Array.from(clients.keys()),
            queuedMindustryEvents: (httpQueues.get("MINDUSTRY") || []).length,
            world: world.summary()
        }));
        return;
    }

    if (req.method === "GET" && req.url === "/world") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ...world.summary(), objects: Array.from(world.objects.values()), players: Array.from(world.players.values()) }));
        return;
    }

    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({ server });
wss.on("connection", ws => {
    console.log("[+] New WebSocket client connected");
    ws.on("message", message => {
        try { handlePacket(JSON.parse(message.toString()), ws); }
        catch (err) { console.error("[MSE] WebSocket processing error:", err); }
    });
    ws.on("close", () => {
        if (ws.mseGame && clients.get(ws.mseGame) === ws) clients.delete(ws.mseGame);
    });
});

server.listen(8080, () => {
    console.log("[Relay Server] MSE World Sync Core listening on :8080");
    console.log("[Relay Server] GET /health for state summary; GET /world for debug state.");
});
