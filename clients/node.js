const { WebSocketServer } = require('ws');
const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log('[Relay Server] Rodando na porta ' + PORT);

const clients = {
MINECRAFT: null,
MINDUSTRY: null,
TERRARIA: null,
STARDEW: null,
DONT_STARVE: null
};

wss.on('connection', (ws) => {
let currentGame = null;

ws.on('message', (message) => {
try {
const data = JSON.parse(message);

  if (data.type === 'CONNECT') {
    currentGame = data.game;
    clients[currentGame] = ws;
    console.log('[+] Jogo conectado: ' + currentGame);
    return;
  }

  handleIncomingPacket(data);
} catch (err) {
  console.error('[-] Erro:', err.message);
}
});

ws.on('close', () => {
if (currentGame) {
console.log('[-] Jogo desconectado: ' + currentGame);
clients[currentGame] = null;
}
});
});

function handleIncomingPacket(packet) {
if (packet.type === 'PLACE_BLOCK') {
const converted = translateCoordinates(packet);
broadcastTo('MINECRAFT', {
type: 'MC_SET_BLOCK',
x: converted.x,
y: converted.y,
z: converted.z,
block_id: converted.block_id,
source_game: packet.source_game
});
}
}

function translateCoordinates(packet) {
if (packet.source_game === 'MINDUSTRY') {
return { x: packet.x, y: 64, z: packet.y, block_id: packet.block_id };
}
if (packet.source_game === 'TERRARIA') {
const scale = 4;
const targetZ = packet.is_wall ? 1 : 3;
return { x: packet.x * scale, y: packet.y * scale, z: targetZ, block_id: packet.block_id };
}
return { x: packet.x, y: packet.y, z: packet.z || 64, block_id: packet.block_id };
}

function broadcastTo(targetGame, data) {
const targetClient = clients[targetGame];
if (targetClient && targetClient.readyState === 1) {
targetClient.send(JSON.stringify(data));
}
}