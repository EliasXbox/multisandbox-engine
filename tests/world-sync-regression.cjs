const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const WorldState = require('../relay-server/world-state');
const Mappings = require('../relay-server/mappings');
const config = JSON.parse(fs.readFileSync(path.join(root, 'relay-server/config/world-sync.json')));
const packets = [], writes = [];
class SocketServer { constructor() { this.clients = new Set(); } on() {} }
const sandbox = { console: { log() {}, warn() {}, error() {} }, URL, __dirname: path.join(root, 'relay-server'),
    require(id) {
        if (id === 'http') return { createServer() { return { listen() {} }; } };
        if (id === 'fs') return { existsSync() { return false; }, mkdirSync() {}, writeFileSync(...args) { writes.push(args); }, renameSync() {} };
        if (id === 'path') return path;
        if (id === 'ws') return { Server: SocketServer, OPEN: 1 };
        if (id === './world-state') return WorldState;
        if (id === './mappings') return Mappings;
        if (id === './config/world-sync.json') return config;
        throw Error(id);
    }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'relay-server/server.js'), 'utf8') +
    '\nglobalThis.test = { world, clients, httpQueues, handlePacket, objectFromMindustry };', sandbox);
const api = sandbox.test;
api.clients.set('MINECRAFT', { readyState: 1, send(data) { packets.push(JSON.parse(data)); } });
function send(type, game, data = {}) { api.handlePacket({ type, game, source_game: game, ...data }); }
function reset() { api.world.loadData(); packets.length = 0; api.httpQueues.set('MINDUSTRY', []); }

reset();
send('PLACE_BLOCK', 'MINECRAFT', { block_id: 'smooth_sandstone_slab', x: 10, y: 3, z: 10 });
assert.equal(api.world.findAt(10, 10).mindustry, 'titanium-conveyor');
assert.equal(api.httpQueues.get('MINDUSTRY')[0].block_id, 'titanium-conveyor');

reset();
send('PLACE_BLOCK', 'MINDUSTRY', { block_id: 'blast-drill', x: 20, y: 20, size: 4 });
const drill = api.world.findAt(19, 19);
assert.deepEqual(drill.volume, { x: 4, z: 4, y: 3 });
assert.equal(packets.length, 48);
assert.equal(api.world.findAt(22, 22).id, drill.id);
packets.length = 0;
send('BREAK_BLOCK', 'MINECRAFT', { x: 22, z: 22, y: 5 });
assert.equal(api.world.objects.size, 0);
assert.equal(packets.filter(p => p.block_id === 'minecraft:air').length, 48);
assert.equal(api.httpQueues.get('MINDUSTRY')[0].x, 20);
assert.equal(api.httpQueues.get('MINDUSTRY')[0].y, 20);
assert.ok(writes.length > 0);

for (let dx = 0; dx < 4; dx++) {
    for (let dz = 0; dz < 4; dz++) {
        for (let dy = 0; dy < 3; dy++) {
            reset();
            send('PLACE_BLOCK', 'MINDUSTRY', { block_id: 'blast-drill', x: 20, y: 20, size: 4 });
            packets.length = 0;
            send('BREAK_BLOCK', 'MINECRAFT', { x: 19 + dx, z: 19 + dz, y: 3 + dy });
            assert.equal(api.world.objects.size, 0);
            assert.equal(packets.length, 48);
        }
    }
}

reset();
send('PLACE_BLOCK', 'MINECRAFT', { block_id: 'bamboo_planks', x: 10, z: 10, y: 3 });
assert.equal(api.world.findAt(12, 12).mindustry, 'mass-driver');
assert.equal(api.httpQueues.get('MINDUSTRY')[0].x, 11);
assert.equal(packets.length, 18);
packets.length = 0;
send('PLACE_BLOCK', 'MINECRAFT', { block_id: 'stone_slab', x: 12, z: 12, y: 3 });
assert.equal(packets.filter(p => p.block_id === 'minecraft:air').length, 18);
assert.equal(api.world.objects.size, 1);

reset();
send('WORLD_SNAPSHOT_BEGIN', 'MINDUSTRY', { snapshot_id: 'map-a', width: 4, height: 4 });
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', { snapshot_id: 'wrong', objects: [{ block_id: 'grass', layer: 'floor', x: 1, y: 1 }] });
assert.equal(api.world.snapshot.objects.length, 0);
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', { snapshot_id: 'map-a', objects: [
    { block_id: 'grass', layer: 'floor', x: 1, y: 1 },
    { block_id: 'ore-copper', layer: 'overlay', x: 1, y: 1 },
    { block_id: 'conveyor', layer: 'block', x: 1, y: 1 },
    { block_id: 'deepwater', layer: 'floor', x: 2, y: 2, liquid: true, deep: true },
    { block_id: 'stone-wall', layer: 'block', x: 3, y: 3, solid: true }
] });
send('WORLD_SNAPSHOT_END', 'MINDUSTRY', { snapshot_id: 'map-a' });
assert.equal(api.world.objects.size, 5);
assert.equal(api.world.findAt(1, 1, 'floor').origin.y, 2);
assert.equal(api.world.findAt(1, 1, 'block').origin.y, 3);
assert.equal(api.world.meta.width, 4);
assert.equal(packets[0].type, 'WORLD_SNAPSHOT_BEGIN');
assert.equal(packets.at(-1).type, 'WORLD_SNAPSHOT_END');
assert.ok(packets.some(p => p.x === 2 && p.z === 2 && p.y === 0 && p.block_id === 'minecraft:stone'));

reset();
send('WORLD_SNAPSHOT_BEGIN', 'MINDUSTRY', { snapshot_id: 'pending', width: 4, height: 4 });
send('PLACE_BLOCK', 'MINECRAFT', { block_id: 'iron_block', x: 1, z: 1, y: 3 });
assert.equal(api.world.objects.size, 0);
send('WORLD_SNAPSHOT_END', 'MINDUSTRY', { snapshot_id: 'pending' });
assert.equal(api.world.findAt(2, 2).mindustry, 'pneumatic-drill');
send('BREAK_BLOCK', 'MINECRAFT', { x: 1, z: 1, y: 2 });
assert.equal(api.world.objects.size, 1, 'breaking terrain below a machine must not delete the machine');

reset();
config.mindustry_to_mse.flip_x = true;
config.mindustry_to_mse.flip_z = true;
send('WORLD_SNAPSHOT_BEGIN', 'MINDUSTRY', { snapshot_id: 'flipped', width: 100, height: 100 });
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', { snapshot_id: 'flipped', objects: [{ block_id: 'blast-drill', x: 20, y: 20, size: 4 }] });
send('WORLD_SNAPSHOT_END', 'MINDUSTRY', { snapshot_id: 'flipped' });
assert.equal(api.world.findAt(77, 77).mindustry, 'blast-drill');
send('BREAK_BLOCK', 'MINECRAFT', { x: 80, z: 80, y: 5 });
assert.equal(api.httpQueues.get('MINDUSTRY').at(-1).x, 20);
config.mindustry_to_mse.flip_x = false;
config.mindustry_to_mse.flip_z = false;

reset();
send('PLACE_BLOCK', 'MINECRAFT', { block_id: 'yellow_terracotta', x: 5, z: 5, y: 3 });
assert.equal(api.world.findAt(7, 7).mindustry, 'core-shard');
assert.equal(Mappings.blocks.get('core-nucleus').volume.x, 5);
for (const [yaw, angle] of [[0, 90], [90, 180], [180, 270], [-90, 0]]) {
    send('PLAYER_STATE', 'MINECRAFT', { player_id: 'mc', rotation: yaw });
    const queue = api.httpQueues.get('MINDUSTRY').filter(p => p.type === 'PLAYER_STATE');
    assert.equal(queue.length, 1);
    assert.equal(queue[0].rotation, angle);
}
send('PLAYER_STATE', 'MINDUSTRY', { player_id: 'md', rotation: 90 });
assert.equal(packets.at(-1).rotation, 0);

// Exercise the actual adapter scanner with linked building tiles and all terrain layers.
const callbacks = {};
const block = (name, size = 1, solid = false, synthetic = false) => ({ name, size, solid, isLiquid: false,
    synthetic() { return synthetic; }, isDeep() { return false; } });
const air = block('air'), grass = block('grass'), copper = block('ore-copper'), blast = block('blast-drill', 4, true, true);
const build = { tile: { x: 1, y: 1 }, rotation: 2 };
const tiles = Array.from({ length: 4 }, (_, x) => Array.from({ length: 4 }, (_, y) => ({
    x, y, build, floor() { return grass; }, overlay() { return x === 0 && y === 0 ? copper : air; }, block() { return blast; }
})));
const adapter = { console, Log: { info() {}, err() {} }, cons: f => f, run: f => f,
    Events: { on(type, f) { callbacks[type] = f; }, run(type, f) { callbacks[type] = f; } },
    EventType: { ClientLoadEvent: 'load', WorldLoadEvent: 'world', BlockBuildEndEvent: 'block', ClientChatEvent: 'chat' },
    Trigger: { draw: 'draw' }, Vars: { world: { width() { return 4; }, height() { return 4; }, tile(x, y) { return tiles[x][y]; } } },
    UnitTypes: { dagger: { fullIcon: { width: 1, height: 1, scl() { return 1; } } } },
    Time: { delta: 1 }, Draw: { rect() {} }
};
vm.createContext(adapter);
vm.runInContext(fs.readFileSync(path.join(root, 'clients/mindustry-bridge/zip mod/scripts/main.js'), 'utf8') +
    '\nglobalThis.api = { collectSnapshotObjects, applyRelayEvent, minecraftPlayers };', adapter);
const objects = adapter.api.collectSnapshotObjects();
assert.equal(objects.filter(p => p.layer === 'floor').length, 16);
assert.equal(objects.filter(p => p.layer === 'overlay').length, 1);
assert.equal(objects.filter(p => p.layer === 'block').length, 1);
adapter.api.applyRelayEvent({ type: 'PLAYER_STATE', source_game: 'MINECRAFT', id: 'mc', x: 0, y: 0, rotation: 350 });
adapter.api.applyRelayEvent({ type: 'PLAYER_STATE', source_game: 'MINECRAFT', id: 'mc', x: 10, y: 10, rotation: 10 });
callbacks.draw();
const proxy = adapter.api.minecraftPlayers.mc;
assert.ok(proxy.x > 0 && proxy.x < 10);
assert.ok(proxy.rotation > 350 || proxy.rotation < 10);
console.log('PASS: reverse titanium, 48-cell drill removal, center/corner round trip, mass-driver, overlap cleanup, terrain snapshot, fluids, cores, angle conversion, queue coalescing, terrain scanner, proxy interpolation. No live servers or saves were used.');
