const http = require('http');
const WebSocket = require('ws');

// v1.2 mapping registry: one source of truth for both directions.
const BLOCK_REGISTRY = require('./registry/block-mappings.json');

const BLOCK_MAP = Object.fromEntries(
    BLOCK_REGISTRY.mappings.map(entry => [entry.mindustry, entry])
);
const REVERSE_BLOCK_MAP = Object.fromEntries(
    BLOCK_REGISTRY.mappings.map(entry => [entry.minecraft.replace(/^minecraft:/, '').toUpperCase(), entry])
);

const clients = new Map();
const httpQueues = new Map([["MINDUSTRY", []]]);
let lastChatMessage = "";
let lastChatTime = 0;

function getBlockSize(blockName = "") {
    if (blockName.includes("large") || blockName === "build2") return 2;
    if (blockName === "build3") return 3;
    if (blockName === "build4") return 4;
    return 1;
}

function normalizeType(data) {
    return data.type || data.action || null;
}

function enqueue(targetGame, payload) {
    const game = String(targetGame).toUpperCase();
    if (!httpQueues.has(game)) httpQueues.set(game, []);
    const queue = httpQueues.get(game);
    queue.push(payload);
    if (queue.length > 256) queue.shift();
}

function sendTo(targetGame, payload) {
    const socket = clients.get(targetGame);
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

function handleMindustryBlock(data) {
    const blockName = data.block || data.block_id || "unknown";
    const destroying = blockName.startsWith("build") || data.destroy === true || data.breaking === true;
    const entry = BLOCK_MAP[blockName] || null;

    if (!destroying && !entry) {
        console.warn(`[MSE] UNMAPPED Mindustry block: ${blockName}; event skipped to preserve reversible mappings.`);
        return;
    }

    const minecraftBlock = destroying ? "AIR" : entry.minecraft;
    const volume = destroying
        ? { x: getBlockSize(blockName), z: getBlockSize(blockName), y: 1 }
        : (entry.volume || { x: 1, z: 1, y: 1 });

    let sent = 0;
    for (let dx = 0; dx < volume.x; dx++) {
        for (let dz = 0; dz < volume.z; dz++) {
            for (let dy = 1; dy <= volume.y; dy++) {
                const payload = {
                    type: "MC_SET_BLOCK",
                    game: "MINDUSTRY",
                    source_game: "MINDUSTRY",
                    x: Number(data.x) + dx,
                    y: dy,
                    z: Number(data.y) + dz,
                    block_id: minecraftBlock,
                    mse_volume: volume,
                    mse_origin: { x: Number(data.x), z: Number(data.y), y: 1 }
                };
                if (sendTo("MINECRAFT", payload)) sent++;
                else broadcast(payload);
            }
        }
    }

    console.log(`[MSE] MINDUSTRY ${blockName} -> ${minecraftBlock} | volume ${volume.x}x${volume.z}x${volume.y} (XxZxY) @ X:${data.x} Z:${data.y} | direct sends: ${sent}`);
}

function handleMinecraftBlock(data) {
    const minecraftBlock = String(data.block_id || data.block || "AIR")
        .replace(/^minecraft:/i, "")
        .toUpperCase();
    const entry = minecraftBlock === "AIR" ? null : REVERSE_BLOCK_MAP[minecraftBlock];
    const mindustryBlock = minecraftBlock === "AIR" ? "air" : (entry && entry.mindustry);

    if (!mindustryBlock) {
        console.warn(`[MSE] UNMAPPED Minecraft block: ${minecraftBlock}; event skipped.`);
        return;
    }

    const payload = {
        type: "MINDUSTRY_SET_BLOCK",
        game: "MINECRAFT",
        source_game: "MINECRAFT",
        x: Number(data.x),
        y: Number(data.z),
        block_id: mindustryBlock
    };

    enqueue("MINDUSTRY", payload);
    console.log(`[MSE] MINECRAFT ${minecraftBlock} -> ${mindustryBlock} @ X:${payload.x} Y:${payload.y} | queued for Mindustry`);
}

function handleChat(data, sourceGame, sourceSocket = null) {
    const now = Date.now();
    const player = data.player || `${sourceGame}User`;
    const message = data.message || "";
    const msgKey = `${sourceGame}:${player}:${message}`;
    if (!message) return;

    if (msgKey !== lastChatMessage || (now - lastChatTime) > 500) {
        lastChatMessage = msgKey;
        lastChatTime = now;

        const payload = { type: "CHAT_MESSAGE", game: sourceGame, source_game: sourceGame, player, message };

        if (sourceGame === "MINDUSTRY") {
            broadcast(payload, sourceSocket);
        } else {
            enqueue("MINDUSTRY", payload);
            broadcast(payload, sourceSocket);
        }

        console.log(`[Chat Crossplay] [${sourceGame}] ${player}: ${message}`);
    }
}

function handlePacket(data, ws = null) {
    const packetType = normalizeType(data);
    const sourceGame = String(data.game || data.source_game || "").toUpperCase();

    if (packetType === "CONNECT") {
        const game = sourceGame;
        if (!game || !ws) return;
        clients.set(game, ws);
        ws.mseGame = game;
        console.log(`[+] [MSE] Game registered: ${game}`);
        ws.send(JSON.stringify({ type: "CONNECTED", game, status: "ok" }));
        return;
    }

    if (packetType === "PLACE_BLOCK") {
        if (sourceGame === "MINDUSTRY") handleMindustryBlock(data);
        else if (sourceGame === "MINECRAFT") handleMinecraftBlock(data);
        else console.warn("[MSE] PLACE_BLOCK without recognized source:", data);
        return;
    }

    if (packetType === "CHAT_MESSAGE") {
        handleChat(data, sourceGame || "UNKNOWN", ws);
        return;
    }

    console.log("[MSE] Ignored packet:", data);
}

const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/event") {
        let body = "";
        req.on("data", chunk => body += chunk.toString());
        req.on("end", () => {
            try {
                const data = JSON.parse(body);
                handlePacket(data);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "ok" }));
            } catch (err) {
                console.error("[MSE] Invalid HTTP JSON:", err.message);
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "error", error: "invalid_json" }));
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
        res.end(JSON.stringify({ status: "ok", events }));
        return;
    }

    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            websocketClients: wss.clients.size,
            registeredGames: Array.from(clients.keys()),
            queuedMindustryEvents: (httpQueues.get("MINDUSTRY") || []).length
        }));
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
        catch (err) { console.error("[MSE] WebSocket processing error:", err.message); }
    });
    ws.on("close", () => {
        if (ws.mseGame && clients.get(ws.mseGame) === ws) {
            clients.delete(ws.mseGame);
            console.log(`[-] [MSE] Game disconnected: ${ws.mseGame}`);
        }
    });
});

server.listen(8080, () => {
    console.log("[Relay Server] Listening on port 8080");
    console.log("[Relay Server] WebSocket: ws://localhost:8080");
    console.log("[Relay Server] HTTP events: POST http://localhost:8080/event");
    console.log("[Relay Server] Mindustry poll: GET http://localhost:8080/poll?game=MINDUSTRY");
});
