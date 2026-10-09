const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const Survival = require('../relay-server/survival');
const WorldState = require('../relay-server/world-state');
const Mappings = require('../relay-server/mappings');
const config = require('../relay-server/config/world-sync.json');
config.mindustry_to_mse.flip_z = false; // Resource fixtures are independent of map orientation.
const packets = [];
class SocketServer { constructor() { this.clients = new Set(); } on() {} }
const sandbox = { console: { log() {}, warn() {}, error() {} }, URL, __dirname: path.join(root, 'relay-server'),
    require(id) {
        if (id === 'http') return { createServer() { return { listen() {} }; } };
        if (id === 'fs') return { existsSync() { return false; }, mkdirSync() {}, writeFileSync() {}, renameSync() {} };
        if (id === 'path') return path;
        if (id === 'ws') return { Server: SocketServer, OPEN: 1 };
        if (id === './world-state') return WorldState;
        if (id === './mappings') return Mappings;
        if (id === './survival') return Survival;
        if (id === './minecraft-stream') return require('../relay-server/minecraft-stream');
        if (id === './world-store') return require('../relay-server/world-store');
        if (id === './building-inventory') return require('../relay-server/building-inventory');
        if (id === './combat') return require('../relay-server/combat');
        if (id === './config/world-sync.json') return config;
        throw Error(id);
    }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'relay-server/server.js'), 'utf8') +
    '\nglobalThis.test = { world, clients, handlePacket, sendSnapshotToMinecraft };', sandbox);
const api = sandbox.test;
api.clients.set('MINECRAFT', { readyState: 1, send(data) { packets.push(JSON.parse(data)); } });
function send(type, data) { api.handlePacket({ type, game: 'MINDUSTRY', ...data }); }
const terrain = [
    { block_id: 'stone', layer: 'floor', x: 0, y: 0 },
    { block_id: 'ore-scrap', layer: 'overlay', x: 0, y: 0 },
    { block_id: 'ore-lead', layer: 'overlay', x: 1, y: 0 },
    { block_id: 'ore-titanium', layer: 'overlay', x: 2, y: 0 },
    { block_id: 'ore-thorium', layer: 'overlay', x: 3, y: 0 },
    { block_id: 'pine', layer: 'block', x: 4, y: 0 },
    { block_id: 'stone-wall', layer: 'block', x: 5, y: 0, solid: true },
    { block_id: 'core-shard', layer: 'block', x: 7, y: 2, size: 3 },
    { block_id: 'deepwater', layer: 'floor', x: 10, y: 0, liquid: true, deep: true }
];
send('WORLD_SNAPSHOT_BEGIN', { snapshot_id: 'survival', width: 16, height: 8 });
send('WORLD_SNAPSHOT_CHUNK', { snapshot_id: 'survival', objects: terrain });
send('WORLD_SNAPSHOT_END', { snapshot_id: 'survival' });
const scrap = packets.findLast(p => p.x === 0 && p.z === 0 && p.y === 2 && p.type === 'MC_SET_BLOCK');
assert.equal(scrap.survival_resource.id, 'scrap');
assert.equal(scrap.survival_resource.min_pickaxe_tier, 0);
assert.equal(scrap.survival_protected, true);
assert.equal(packets.find(p => p.mindustry_block === 'ore-lead').survival_resource.material, 'RAW_IRON');
assert.equal(packets.find(p => p.mindustry_block === 'ore-titanium').survival_resource.min_pickaxe_tier, 3);
assert.equal(packets.find(p => p.mindustry_block === 'ore-thorium').survival_resource.min_pickaxe_tier, 4);
assert.equal(packets.filter(p => p.mindustry_block === 'pine').length, 3);
assert.ok(packets.filter(p => p.mindustry_block === 'pine').every(p => p.block_id === 'minecraft:oak_log'));
assert.equal(packets.find(p => p.mindustry_block === 'stone-wall').survival_resource.material, 'COBBLESTONE');
assert.equal(packets.find(p => p.mindustry_block === 'core-shard').survival_resource, null);
assert.ok(packets.filter(p => p.mindustry_block === 'deepwater').every(p => p.survival_protected));
assert.equal(Survival.resourceFor({ layer: 'block', mindustry: 'ore-scrap' }), null, 'layer matters');
assert.equal(Survival.resourceFor({ layer: 'block', mindustry: 'copper-wall' }), null, 'built walls are not natural ore');
const before = JSON.stringify(api.world.exportData());
packets.length = 0;
api.sendSnapshotToMinecraft();
assert.equal(JSON.stringify(api.world.exportData()), before, 'rendering resource metadata does not consume deposits');
assert.ok(packets.some(p => p.survival_resource?.id === 'scrap'), 'reconnect restores resource identity');
console.log('PASS: canonical resource identity, layered deposits, natural wood/stone, protected fluids and reconnect metadata. No live saves were accessed.');
