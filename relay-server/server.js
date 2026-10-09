const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const WorldState = require("./world-state");
const Mappings = require("./mappings");
const Survival = require("./survival");
const MinecraftStream = require("./minecraft-stream");
const WorldStore = require("./world-store");
const Combat = require('./combat');
const BuildingInventory = require('./building-inventory');
const WORLD_CONFIG = require("./config/world-sync.json");

const world = new WorldState();
const STATE_FILE = path.join(__dirname, "data", "world-state.json");
const deferredDuringSnapshot = [];
const relaySession = String(Date.now());
let lastMindustryPoll = 0;
const minecraftStreams = new Map();
const worldStore = new WorldStore(fs, STATE_FILE, () => world.exportData());
const combat = new Combat(world, sendTo, enqueue, mindustryToMse, rotation =>
    Mappings.normalizeAngle(Mappings.transformAngle(Number(rotation || 0), world.meta.transform || WORLD_CONFIG.mindustry_to_mse) - 90));
const buildingInventory = new BuildingInventory(world, sendTo, enqueue);

function persistWorld() {
    worldStore.markDirty();
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
    if (payload.type === 'PLAYER_STATE') {
        const existing = queue.findIndex(item => item.type === 'PLAYER_STATE' && item.id === payload.id);
        if (existing >= 0) queue.splice(existing, 1);
    }
    queue.push(payload);
    if (queue.length > 4096) queue.shift();
}

function sendTo(targetGame, payload) {
    const socket = clients.get(String(targetGame).toUpperCase());
    if (socket && socket.readyState === WebSocket.OPEN) {
        const stream = minecraftStreams.get(socket);
        if (stream && payload.type === 'MC_SET_BLOCK') { stream.enqueue(payload); return true; }
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

function mindustryToMse(rawX, rawY, meta = world.meta) {
    const cfg = meta.transform || WORLD_CONFIG.mindustry_to_mse || {};
    const width = Number(meta.width || 0);
    const height = Number(meta.height || 0);
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
    const cfg = world.meta.transform || WORLD_CONFIG.mindustry_to_mse || {};
    const width = Number(world.meta.width || 0);
    const height = Number(world.meta.height || 0);
    let x = Number(rawX) - Number(cfg.offset_x || 0);
    let y = Number(rawZ) - Number(cfg.offset_z || 0);

    if (cfg.flip_x) x = width > 0 ? (width - 1 - x) : -x;
    if (cfg.flip_z) y = height > 0 ? (height - 1 - y) : -y;

    return { x, y };
}

function objectFromMindustry(data) {
    const entry = Mappings.resolve(data);
    if (!entry) return null;
    const layer = data.layer || 'block';
    const volume = entry.volume || { x: 1, z: 1, y: 1 };
    const meta = world.snapshot ? world.snapshot.meta : world.meta;
    // Mindustry sends the building's center tile; MSE stores its minimum corner.
    const offset = layer === 'block' ? -Math.floor((Number(data.size || volume.x) - 1) / 2) : 0;
    const near = mindustryToMse(Number(data.x) + offset, Number(data.y) + offset, meta);
    const far = mindustryToMse(Number(data.x) + offset + volume.x - 1,
        Number(data.y) + offset + volume.z - 1, meta);
    const surface = Number((WORLD_CONFIG.minecraft || {}).surface_y || 2);
    return {
        kind: layer,
        layer,
        mindustry: entry.mindustry,
        minecraft: entry.minecraft,
        x: Math.min(near.x, far.x),
        z: Math.min(near.z, far.z),
        y: Number(data.mse_y != null ? data.mse_y : layer === 'block' ? surface + 1 : surface),
        volume,
        fluidDepth: entry.fluidDepth || 0,
        inventory: data.has_items === true,
        team: data.team,
        mindustry_anchor: { x: Number(data.x), y: Number(data.y) },
        rotation: data.rotation || 0,
        source_game: "MINDUSTRY"
    };
}

function* minecraftObjectPackets(object, material = null) {
    const blockId = material || object.minecraft || "minecraft:air";
    for (let dx = 0; dx < object.volume.x; dx++) {
        for (let dz = 0; dz < object.volume.z; dz++) {
            for (let dy = 0; dy < object.volume.y; dy++) {
                yield {
                    type: "MC_SET_BLOCK",
                    source_game: "MSE",
                    object_id: object.id,
                    revision: object.revision,
                    x: object.origin.x + dx,
                    z: object.origin.z + dz,
                    y: object.origin.y + dy,
                    block_id: blockId,
                    facing: Mappings.normalizeAngle(Mappings.transformAngle(object.rotation * 90,
                        world.meta.transform || WORLD_CONFIG.mindustry_to_mse)),
                    ...Survival.cellMetadata(object),
                    mse_origin: object.origin,
                    mse_volume: object.volume
                    ,mindustry_anchor: object.mindustry_anchor,
                    has_items: object.inventory,
                    natural_wall: Mappings.naturalWalls.has(object.mindustry) && object.layer === 'block',
                    configuration: Mappings.blocks.get(object.mindustry)?.configuration || null,
                    team: object.team
                };
            }
        }
    }
    if (object.fluidDepth > 0) {
        // Bed first, then fluid; the adapter suppresses Minecraft physics.
        const surface = object.origin.y;
        for (let depth = object.fluidDepth; depth >= 1; depth--) {
            yield { type: 'MC_SET_BLOCK', source_game: 'MSE', revision: object.revision,
                x: object.origin.x, z: object.origin.z, y: surface - depth,
                mindustry_block: object.mindustry, mse_layer: object.layer,
                survival_resource: null, survival_protected: true,
                block_id: material || (depth === object.fluidDepth ? 'minecraft:stone' : object.minecraft) };
        }
    }
}

function renderObjectToMinecraft(object, material = null) {
    for (const packet of minecraftObjectPackets(object, material)) sendTo('MINECRAFT', packet);
}

function sendObjectToMindustry(object, blockId = null) {
    const pos = object.mindustry_anchor || mseToMindustry(object.origin.x, object.origin.z);
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
        ,world_epoch: world.meta.world_epoch
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
    if (sourceGame !== 'MINDUSTRY') sendObjectToMindustry(object, "air");
    console.log(`[MSE][WORLD r${object.revision}] REMOVE ${object.id} requested by ${sourceGame}`);
}

function createAndPublish(spec, sourceGame) {
    const overlaps = new Set();
    for (let dx = 0; dx < spec.volume.x; dx++) {
        for (let dz = 0; dz < spec.volume.z; dz++) {
            const object = world.findAt(spec.x + dx, spec.z + dz, spec.layer || 'block');
            if (object) overlaps.add(object);
        }
    }
    for (const object of overlaps) {
        world.removeObject(object.id);
        publishRemove(object, sourceGame);
    }
    publishCreate(world.createObject(spec), sourceGame);
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
        persistWorld();
        return;
    }

    const spec = objectFromMindustry(data);
    if (!spec) {
        console.warn(`[MSE] UNMAPPED Mindustry block: ${data.block || data.block_id}; skipped.`);
        return;
    }
    createAndPublish(spec, "MINDUSTRY");
    persistWorld();
}

function handleMinecraftBlock(data) {
    if (world.snapshot) { deferredDuringSnapshot.push({ ...data }); return; }
    const minecraftBlock = String(data.block_id || data.block || "AIR").replace(/^minecraft:/i, "").toUpperCase();
    const explicit = data.mindustry_block && (Mappings.blocks.get(String(data.mindustry_block)) || Mappings.naturalWalls.get(String(data.mindustry_block)));
    const entry = explicit && [explicit.minecraft, ...(explicit.minecraft_aliases || [])]
        .some(name => name.replace(/^minecraft:/, '').toUpperCase() === minecraftBlock) ? explicit : Mappings.reverse.get(minecraftBlock);
    if (!entry) {
        console.warn(`[MSE] UNMAPPED Minecraft block: ${minecraftBlock}; skipped.`);
        return;
    }

    const volume = entry.volume || { x: 1, z: 1, y: 1 };
    const cfg = world.meta.transform || WORLD_CONFIG.mindustry_to_mse || {};
    const corner = mseToMindustry(Number(data.x) + (cfg.flip_x ? volume.x - 1 : 0),
        Number(data.z) + (cfg.flip_z ? volume.z - 1 : 0));
    const offset = Math.floor((volume.x - 1) / 2);
    createAndPublish({
        kind: "block",
        layer: "block",
        mindustry: entry.mindustry,
        minecraft: entry.minecraft,
        x: Number(data.x),
        z: Number(data.z),
        y: Number(data.y),
        volume,
        rotation: Math.round(Mappings.transformAngle(Number(data.facing || 0), cfg) / 90) % 4,
        inventory: entry.has_items === true,
        mindustry_anchor: { x: corner.x + offset, y: corner.y + offset },
        source_game: "MINECRAFT"
    }, "MINECRAFT");
    persistWorld();
}

function handleMinecraftBreak(data) {
    if (world.snapshot) { deferredDuringSnapshot.push({ ...data }); return; }
    const object = world.findAt(Number(data.x), Number(data.z), 'block');
    if (object && (Number(data.y) < object.origin.y || Number(data.y) >= object.origin.y + object.volume.y)) return;
    const removed = object ? world.removeObject(object.id) : null;
    if (!removed) {
        console.warn(`[MSE] Minecraft break found no MSE object @ ${data.x},${data.z}`);
        return;
    }
    publishRemove(removed, "MINECRAFT");
    if (data.refund === true && data.player_id && (Mappings.blocks.has(removed.mindustry) || Mappings.naturalWalls.has(removed.mindustry))) {
        sendTo('MINECRAFT', { type: 'BUILDING_REFUND', player_id: data.player_id,
            mindustry_block: removed.mindustry, object_id: removed.id, world_epoch: world.meta.world_epoch });
    }
    persistWorld();
}

function handleSnapshotBegin(data) {
    if (String(data.source_game || data.game || "").toUpperCase() !== String(WORLD_CONFIG.authority || "MINDUSTRY").toUpperCase()) {
        console.warn("[MSE] Snapshot rejected: source is not current authority.");
        return;
    }
    if (data.world_epoch && Number(data.world_epoch) < Number(world.meta.world_epoch || 0)) return;
    if (world.snapshot && data.world_epoch && Number(data.world_epoch) < Number(world.snapshot.meta.world_epoch || 0)) return;
    const mapChanged = data.world_epoch && Number(data.world_epoch) !== Number(world.meta.world_epoch || 0);
    if (mapChanged) {
        deferredDuringSnapshot.length = 0;
        httpQueues.set('MINDUSTRY', []);
        world.players.clear();
        const stream = minecraftStreams.get(clients.get('MINECRAFT'));
        if (stream) stream.start((function* () { yield { type: 'WORLD_MAP_CLEAR', world_epoch: data.world_epoch }; })());
    }
    const overrides = (WORLD_CONFIG.map_overrides || {})[String(data.map_id || '')] || {};
    world.beginSnapshot({
        width: Number(data.width || 0) || null,
        height: Number(data.height || 0) || null,
        authority: String(data.source_game || data.game).toUpperCase(),
        snapshot_id: data.snapshot_id || null
        ,world_epoch: data.world_epoch || null,
        map_id: data.map_id || null,
        map_name: data.map_name || null,
        environment: data.environment || 1,
        planet: data.planet || null,
        transform: { ...(WORLD_CONFIG.mindustry_to_mse || {}), ...overrides }
    });
    if(data.spawn) world.snapshot.meta.spawn = mindustryToMse(Number(data.spawn.x), Number(data.spawn.y), world.snapshot.meta);
    console.log(`[MSE][SNAPSHOT] BEGIN ${data.snapshot_id || ""} ${data.width || "?"}x${data.height || "?"}`);
}

function handleSnapshotChunk(data) {
    if (!validSnapshotPacket(data)) return;
    const converted = [];
    for (const item of (data.objects || [])) {
        const spec = objectFromMindustry(item);
        if (spec) converted.push(spec);
    }
    world.appendSnapshot(converted);
    console.log(`[MSE][SNAPSHOT] CHUNK +${converted.length} mapped objects`);
}

function validSnapshotPacket(data) {
    return world.snapshot && data.snapshot_id === world.snapshot.meta.snapshot_id &&
        String(data.source_game || data.game || '').toUpperCase() === world.snapshot.meta.authority;
}

function sendSnapshotToMinecraft(previousObjects = []) {
    const socket = clients.get('MINECRAFT');
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const stream = minecraftStreams.get(socket);
    if (stream) {
        const objects = Array.from(world.objects.values());
        const revision = world.revision;
        const meta = { ...world.meta };
        const nearSpawn = object => meta.spawn &&
            object.origin.x + object.volume.x >= meta.spawn.x - 32 && object.origin.x <= meta.spawn.x + 32 &&
            object.origin.z + object.volume.z >= meta.spawn.z - 32 && object.origin.z <= meta.spawn.z + 32;
        function* snapshotPackets() {
            yield { type: 'WORLD_SNAPSHOT_BEGIN', revision, meta };
            // Complete the playable core area before filling distant terrain on large maps.
            for (const priority of [true, false]) {
                for (const layer of ['floor', 'overlay', 'block']) {
                    for (const object of objects) {
                        if (object.layer === layer && !!nearSpawn(object) === priority) yield* minecraftObjectPackets(object);
                    }
                }
                if (priority && meta.spawn) yield { type: 'WORLD_PLAY_AREA_READY', world_epoch: meta.world_epoch };
            }
            yield { type: 'WORLD_SNAPSHOT_END', revision, object_count: objects.length };
        }
        stream.start(snapshotPackets());
        return;
    }
    sendTo("MINECRAFT", { type: "WORLD_SNAPSHOT_BEGIN", revision: world.revision, meta: world.meta });
    // Clear cells owned by the old canonical state, including prior adapter versions.
    for (const object of previousObjects) renderObjectToMinecraft(object, 'minecraft:air');
    for (const layer of ['floor', 'overlay', 'block']) {
        for (const object of world.objects.values()) {
            if (object.layer === layer) renderObjectToMinecraft(object);
        }
    }
    sendTo("MINECRAFT", { type: "WORLD_SNAPSHOT_END", revision: world.revision, object_count: world.objects.size });
}

function handleSnapshotEnd(data) {
    if (!validSnapshotPacket(data)) return;
    const committed = world.commitSnapshot();
    console.log(`[MSE][SNAPSHOT] COMMIT r${committed.revision}: ${committed.objects.length} objects`);
    while (deferredDuringSnapshot.length > 0) {
        handlePacket(deferredDuringSnapshot.shift());
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

    const cfg = world.meta.transform || WORLD_CONFIG.mindustry_to_mse || {};
    const rotation = sourceGame === 'MINDUSTRY' ? Mappings.transformAngle(Number(data.rotation || 0), cfg) :
        Mappings.normalizeAngle(Number(data.rotation || 0) + 90);
    const player = world.setPlayer({
        id: data.player_id || `${sourceGame}:${data.player || "player"}`,
        source_game: sourceGame,
        name: data.player || data.name || "Player",
        x, z,
        y: data.mse_y == null ? 5 : data.mse_y,
        rotation,
        connected: true
        ,health_fraction: data.health_fraction,
        life_id: data.life_id,
        unit_id: data.unit_id,
        team: data.team,
        creative: data.creative,
        armor: data.armor, toughness: data.toughness, protection: data.protection
    });

    const packet = { type: "PLAYER_STATE", ...player, world_epoch: world.meta.world_epoch };
    if (sourceGame === "MINDUSTRY") sendTo("MINECRAFT", { ...packet,
        rotation: Mappings.normalizeAngle(player.rotation - 90) });
    else if (sourceGame === "MINECRAFT") {
        const pos = mseToMindustry(player.x, player.z);
        enqueue("MINDUSTRY", { ...packet, x: pos.x, y: pos.y,
            rotation: Mappings.transformAngle(player.rotation, cfg) });
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
    if (packetType === 'BUILDING_INVENTORY_REQUEST' && sourceGame === 'MINECRAFT') return buildingInventory.request(data);
    if (packetType === 'BUILDING_INVENTORY_RESULT' && sourceGame === 'MINDUSTRY') return buildingInventory.result(data);
    if (packetType === 'BUILDING_CONFIGURE' && sourceGame === 'MINECRAFT') return buildingInventory.configure(data);
    const currentEpoch = world.snapshot ? world.snapshot.meta.world_epoch : world.meta.world_epoch;
    if (!String(packetType).startsWith('WORLD_SNAPSHOT') && data.world_epoch && currentEpoch &&
        Number(data.world_epoch) !== Number(currentEpoch)) return;

    if (packetType === "CONNECT") {
        if (!sourceGame || !ws) return;
        if (sourceGame === 'MINECRAFT') {
            if (data.world_stream !== 1) {
                ws.close(1008, 'Update the Minecraft bridge: world-stream-v1 required');
                return;
            }
            const previous = clients.get(sourceGame);
            if (previous && previous !== ws) {
                minecraftStreams.get(previous)?.close();
                minecraftStreams.delete(previous);
                previous.close(1000, 'Replaced connection');
            }
            minecraftStreams.set(ws, new MinecraftStream(ws, { maxInflight: 3, resnapshot: sendSnapshotToMinecraft }));
        }
        clients.set(sourceGame, ws);
        ws.mseGame = sourceGame;
        ws.send(JSON.stringify({ type: "CONNECTED", game: sourceGame, status: "ok", world: world.summary() }));
        if (sourceGame === "MINECRAFT" && world.objects.size > 0) sendSnapshotToMinecraft();
        else if (sourceGame === 'MINECRAFT') ws.send(JSON.stringify({ type: 'WORLD_STREAM_RESET',
            stream_id: minecraftStreams.get(ws).streamId }));
        return;
    }

    if (packetType === 'WORLD_BATCH_ACK' && sourceGame === 'MINECRAFT') {
        minecraftStreams.get(ws)?.ack(Number(data.stream_id), Number(data.batch_id));
        return;
    }
    if (world.snapshot && ['ENTITY_FRAME', 'ENTITY_DAMAGE', 'PLAYER_HEALTH_DELTA', 'PLAYER_STATE'].includes(packetType)) return;
    if (packetType === 'ENTITY_FRAME' && sourceGame === 'MINDUSTRY') return combat.frame(data);
    if (packetType === 'ENTITY_DAMAGE' && sourceGame === 'MINECRAFT') return combat.hit(data);
    if (packetType === 'PLAYER_HEALTH_DELTA' && sourceGame === 'MINECRAFT') return combat.localHealth(data);

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
        if (game === 'MINDUSTRY') lastMindustryPoll = Date.now();
        const queue = httpQueues.get(game) || [];
        const events = queue.splice(0, queue.length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", relay_session: relaySession, revision: world.revision, events }));
        return;
    }

    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            websocketClients: wss.clients.size,
            registeredGames: Array.from(new Set([...clients.keys(),
                ...(lastMindustryPoll && Date.now() - lastMindustryPoll < 3000 ? ['MINDUSTRY'] : [])])),
            queuedMindustryEvents: (httpQueues.get("MINDUSTRY") || []).length,
            minecraftTransfer: (() => {
                const stream = minecraftStreams.get(clients.get('MINECRAFT'));
                return stream ? { stream_id: stream.streamId, queued_edits: stream.deltas.size,
                    awaiting_ack: !!stream.pending, snapshot_active: !!stream.snapshot,
                    max_batch: stream.stats.peakPending, sent_operations: stream.stats.cells } : null;
            })(),
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
        minecraftStreams.get(ws)?.close();
        minecraftStreams.delete(ws);
        if (ws.mseGame && clients.get(ws.mseGame) === ws) clients.delete(ws.mseGame);
    });
    ws.on('error', err => console.error('[MSE] WebSocket error:', err.message));
});

server.listen(8080, () => {
    console.log("[Relay Server] MSE World Sync Core listening on :8080");
    console.log("[Relay Server] GET /health for state summary; GET /world for debug state.");
});

if (typeof process !== 'undefined') {
    let stopping = false;
    async function shutdown() {
        if (stopping) return;
        stopping = true;
        server.close();
        for (const stream of minecraftStreams.values()) stream.close();
        for (const socket of wss.clients) socket.close(1001, 'Relay shutdown');
        await worldStore.close();
        process.exit(worldStore.dirty ? 1 : 0);
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
