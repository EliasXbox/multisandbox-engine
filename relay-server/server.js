const http = require('http');
const WebSocket = require('ws');

// Tabela de mapeamento de blocos do Mindustry para Minecraft
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

let lastChatMessage = "";
let lastChatTime = 0;

// Função para determinar o tamanho da estrutura no Mindustry
function getBlockSize(blockName) {
    if (blockName.includes("large") || blockName === "build2") return 2;
    if (blockName === "build3") return 3;
    if (blockName === "build4") return 4;
    return 1;
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/event') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const data = JSON.parse(body);

                if (data.action === "PLACE_BLOCK") {
                    let minecraftBlock = "STONE";
                    const size = getBlockSize(data.block);

                    // Se começar com 'build', é treated como destruição de bloco (AIR)
                    if (data.block.startsWith("build")) {
                        minecraftBlock = "AIR";
                    } else if (BLOCK_MAP[data.block]) {
                        minecraftBlock = BLOCK_MAP[data.block];
                    }

                    // Envio cobrindo a área baseada no tamanho do bloco (1x1, 2x2, etc.)
                    for (let dx = 0; dx < size; dx++) {
                        for (let dz = 0; dz < size; dz++) {
                            const payload = {
                                type: "MC_SET_BLOCK",     // Compatível com o MinecraftBridge.java
                                game: "MINDUSTRY",
                                x: data.x + dx,
                                y: 64,                 // Altura padrão
                                z: data.y + dz,         // Y do Mindustry vira Z no Minecraft
                                block_id: minecraftBlock // Compatível com o MinecraftBridge.java
                            };
                            broadcast(payload);
                        }
                    }
                    console.log(`[+] [MSE] Ação: ${data.block} (${size}x${size}) -> ${minecraftBlock} em X:${data.x} Z:${data.y}`);

                } else if (data.action === "CHAT_MESSAGE") {
                    const now = Date.now();
                    const msgKey = `${data.player}:${data.message}`;

                    if (msgKey !== lastChatMessage || (now - lastChatTime) > 500) {
                        lastChatMessage = msgKey;
                        lastChatTime = now;

                        const payload = {
                            type: "CHAT_MESSAGE",
                            game: "MINDUSTRY",
                            player: data.player || "MindustryUser",
                            message: data.message
                        };
                        broadcast(payload);
                        console.log(`[Chat Crossplay] [Mindustry] ${data.player}: ${data.message}`);
                    }
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok' }));
            } catch (err) {
                res.writeHead(400);
                res.end('JSON invalido');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const wss = new WebSocket.Server({ server });

function broadcast(payload) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    });
}

wss.on('connection', (ws) => {
    console.log('[+] Novo cliente WebSocket conectado');

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === "CHAT_MESSAGE" && data.game === "MINECRAFT") {
                console.log(`[Chat Crossplay] [Minecraft] ${data.player}: ${data.message}`);
                broadcast(data);
            }
        } catch (e) {
            console.error("Erro no processamento do WebSocket:", e);
        }
    });
});

server.listen(8080, () => {
    console.log('[Relay Server] Escutando na porta 8080');
});