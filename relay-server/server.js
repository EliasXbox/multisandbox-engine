const http = require('http');
const WebSocket = require('ws');

const BLOCK_MAP = {
    "conveyor": "REDSTONE_WIRE",
    "titanium-conveyor": "POWERED_RAIL",
    "armored-conveyor": "RAIL",
    "router": "HOPPER",
    "junction": "REPEATER",
    "duo": "DISPENSER",
    "scatter": "OBSERVER",
    "scorch": "MAGMA_BLOCK",
    "hail": "TNT",
    "wave": "SPONGE",
    "copper-wall": "DRIED_KELP_BLOCK",
    "copper-wall-large": "NETHERITE_BLOCK",
    "titanium-wall": "IRON_BLOCK",
    "thorium-wall": "PURPUR_BLOCK",
    "pneumatic-drill": "DIAMOND_ORE",
    "mechanical-drill": "IRON_ORE",
    "power-node": "LIGHTNING_ROD"
};

const clients = new Map();
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
    let minecraftBlock = "STONE";
    const size = getBlockSize(blockName);

    if (blockName.startsWith("build") || data.destroy === true) {
        minecraftBlock = "AIR";
    } else if (BLOCK_MAP[blockName]) {
        minecraftBlock = BLOCK_MAP[blockName];
    }

    let sent = 0;

    for (let dx = 0; dx < size; dx++) {
        for (let dz = 0; dz < size; dz++) {
            const payload = {
                type: "MC_SET_BLOCK",
                game: "MINDUSTRY",
                source_game: "MINDUSTRY",
                x: Number(data.x) + dx,
                y: 64,
                z: Number(data.y) + dz,
                block_id: minecraftBlock
            };

            if (sendTo("MINECRAFT", payload)) {
                sent++;
            } else {
                broadcast(payload);
            }
        }
    }

    console.log(
        `[MSE] MINDUSTRY PLACE_BLOCK ${blockName} (${size}x${size}) -> ${minecraftBlock} @ X:${data.x} Z:${data.y} | direct sends: ${sent}`
    );
}

function handleMinecraftBlock(data) {
    const payload = {
        type: "PLACE_BLOCK",
        game: "MINECRAFT",
        source_game: "MINECRAFT",
        x: Number(data.x),
        y: Number(data.y),
        z: Number(data.z),
        block_id: data.block_id || data.block || "STONE"
    };

    const sent = sendTo("MINDUSTRY", payload);
    if (!sent) {
        broadcast(payload);
    }

    console.log(
        `[MSE] MINECRAFT PLACE_BLOCK ${payload.block_id} @ X:${payload.x} Y:${payload.y} Z:${payload.z} | mindustry connected: ${sent}`
    );
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

        const payload = {
            type: "CHAT_MESSAGE",
            game: sourceGame,
            player,
            message
        };

        broadcast(payload, sourceSocket);
        console.log(`[Chat Crossplay] [${sourceGame}] ${player}: ${message}`);
    }
}

function handlePacket(data, ws = null) {
    const packetType = normalizeType(data);
    const sourceGame = String(data.game || data.source_game || "").toUpperCase();

    if (packetType === "CONNECT") {
        const game = String(data.game || data.source_game || "").toUpperCase();
        if (!game || !ws) return;

        clients.set(game, ws);
        ws.mseGame = game;
        console.log(`[+] [MSE] Game registered: ${game}`);
        ws.send(JSON.stringify({ type: "CONNECTED", game, status: "ok" }));
        return;
    }

    if (packetType === "PLACE_BLOCK") {
        if (sourceGame === "MINDUSTRY" || (data.y !== undefined && data.z === undefined)) {
            handleMindustryBlock(data);
        } else if (sourceGame === "MINECRAFT") {
            handleMinecraftBlock(data);
        } else {
            console.warn("[MSE] PLACE_BLOCK without recognized source_game/game:", data);
        }
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

    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            status: "ok",
            websocketClients: wss.clients.size,
            registeredGames: Array.from(clients.keys())
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
        try {
            const data = JSON.parse(message.toString());
            handlePacket(data, ws);
        } catch (err) {
            console.error("[MSE] WebSocket processing error:", err.message);
        }
    });

    ws.on("close", () => {
        if (ws.mseGame && clients.get(ws.mseGame) === ws) {
            clients.delete(ws.mseGame);
            console.log(`[-] [MSE] Game disconnected: ${ws.mseGame}`);
        } else {
            console.log("[-] WebSocket client disconnected");
        }
    });
});

server.listen(8080, () => {
    console.log("[Relay Server] Listening on port 8080");
    console.log("[Relay Server] WebSocket: ws://localhost:8080");
    console.log("[Relay Server] HTTP compatibility: POST http://localhost:8080/event");
    console.log("[Relay Server] Health: http://localhost:8080/health");
});
