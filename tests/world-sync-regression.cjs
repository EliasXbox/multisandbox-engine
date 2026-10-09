const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const WorldState = require('../relay-server/world-state');
const Mappings = require('../relay-server/mappings');
const config = JSON.parse(fs.readFileSync(path.join(root, 'relay-server/config/world-sync.json')));
assert.equal(config.mindustry_to_mse.flip_z, true, 'Mindustry up must map to Minecraft north');
assert.deepEqual(config.map_overrides, {}, 'orientation no longer depends on per-map X exceptions');
config.mindustry_to_mse.flip_z = false; // Generic mapping fixtures use identity coordinates.
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
        if (id === './survival') return require('../relay-server/survival');
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
    '\nglobalThis.test = { world, clients, httpQueues, handlePacket, objectFromMindustry, minecraftStreams, sendSnapshotToMinecraft };', sandbox);
const api = sandbox.test;
api.clients.set('MINECRAFT', { readyState: 1, send(data) { packets.push(JSON.parse(data)); } });
function send(type, game, data = {}) { api.handlePacket({ type, game, source_game: game, ...data }); }
function reset() { api.world.loadData(); api.world.meta = { width: null, height: null, authority: null }; packets.length = 0; api.httpQueues.set('MINDUSTRY', []); }

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

reset();
config.mindustry_to_mse.flip_z = true;
send('WORLD_SNAPSHOT_BEGIN', 'MINDUSTRY', {snapshot_id: 'arch', world_epoch: 10, map_id: 'map:archipelago', width: 100, height: 100});
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', {snapshot_id: 'arch', world_epoch: 10, objects: [{block_id: 'conveyor', x: 20, y: 30}]});
send('WORLD_SNAPSHOT_END', 'MINDUSTRY', {snapshot_id: 'arch', world_epoch: 10});
assert.equal(api.world.findAt(20, 69).mindustry, 'conveyor', 'Archipelago uses the same north-up transform');
send('WORLD_SNAPSHOT_BEGIN', 'MINDUSTRY', {snapshot_id: 'next', world_epoch: 11, map_id: 'map:other', width: 100, height: 100});
send('PLACE_BLOCK', 'MINDUSTRY', {world_epoch: 10, block_id: 'conveyor', x: 50, y: 50});
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', {snapshot_id: 'arch', world_epoch: 10, objects: [{block_id: 'conveyor', x: 55, y: 55}]});
send('WORLD_SNAPSHOT_CHUNK', 'MINDUSTRY', {snapshot_id: 'next', world_epoch: 11, objects: [{block_id: 'conveyor', x: 20, y: 30}]});
send('WORLD_SNAPSHOT_END', 'MINDUSTRY', {snapshot_id: 'next', world_epoch: 11});
assert.equal(api.world.objects.size, 1, 'old map and late events are gone');
assert.equal(api.world.findAt(20, 69).mindustry, 'conveyor', 'other maps use the same orientation');
send('PLAYER_STATE', 'MINDUSTRY', {world_epoch: 11, player_id: 'north', x: 20, y: 30, rotation: 90});
assert.equal(packets.at(-1).rotation, 180, 'Mindustry up faces Minecraft north');
config.mindustry_to_mse.flip_z = false;
reset();
send('PLACE_BLOCK', 'MINDUSTRY', {block_id: 'blast-drill', x: 20, y: 20, size: 4});
packets.length = 0;
send('BREAK_BLOCK', 'MINECRAFT', {x: 20, z: 20, y: 4, refund: true, player_id: 'steve'});
send('BREAK_BLOCK', 'MINECRAFT', {x: 21, z: 20, y: 4, refund: true, player_id: 'steve'});
assert.equal(packets.filter(p => p.type === 'BUILDING_REFUND').length, 1, 'one drill refund for entire volume');

// Exercise the actual adapter scanner with linked building tiles and all terrain layers.
reset();config.mindustry_to_mse.flip_z=true;
send('WORLD_SNAPSHOT_BEGIN','MINDUSTRY',{snapshot_id:'stairs',world_epoch:30,width:100,height:100});
send('WORLD_SNAPSHOT_END','MINDUSTRY',{snapshot_id:'stairs',world_epoch:30});
send('PLACE_BLOCK','MINDUSTRY',{block_id:'conveyor',x:10,y:10,rotation:1});
assert.equal(packets.at(-1).facing,270,'Mindustry up points Minecraft stair north');
send('PLACE_BLOCK','MINECRAFT',{mindustry_block:'titanium-conveyor',block_id:'sandstone_stairs',x:20,z:20,y:3,facing:270});
assert.equal(api.httpQueues.get('MINDUSTRY').at(-1).rotation,1,'Minecraft north points Mindustry belt up');
config.mindustry_to_mse.flip_z=false;reset();
api.world.meta.spawn={x:3,z:3};api.world.meta.world_epoch=40;
api.world.createObject({mindustry:'stone',layer:'floor',x:90,z:90,y:2,minecraft:'minecraft:stone'});
api.world.createObject({mindustry:'stone',layer:'floor',x:3,z:3,y:2,minecraft:'minecraft:stone'});
api.world.createObject({mindustry:'core-shard',layer:'block',x:3,z:3,y:3,minecraft:'minecraft:yellow_terracotta',volume:{x:3,z:3,y:2}});
const streamJobs=[],streamPackets=[];
const streamSocket={readyState:1,send(raw){streamPackets.push(JSON.parse(raw));}};
const priorityStream=new (require('../relay-server/minecraft-stream'))(streamSocket,{schedule(job){streamJobs.push(job);}});
api.clients.set('MINECRAFT',streamSocket);api.minecraftStreams.set(streamSocket,priorityStream);
api.sendSnapshotToMinecraft();while(streamJobs.length)streamJobs.shift()();
const batch=streamPackets.find(p=>p.type==='WORLD_BLOCK_BATCH').packets;
const ready=batch.findIndex(p=>p.type==='WORLD_PLAY_AREA_READY');
assert.ok(ready>0);assert.ok(batch.slice(0,ready).some(p=>p.block_id==='minecraft:yellow_terracotta'));
assert.ok(!batch.slice(0,ready).some(p=>p.x===90),'distant terrain must not delay playable core');
assert.ok(batch.slice(ready+1).some(p=>p.x===90),'distant terrain still belongs to full snapshot');priorityStream.close();
const callbacks = {};
const block = (name, size = 1, solid = false, synthetic = false) => ({ name, size, solid, isLiquid: false,
    synthetic() { return synthetic; }, isDeep() { return false; } });
const air = block('air'), grass = block('grass'), copper = block('ore-copper'), blast = block('blast-drill', 4, true, true);
const build = { tile: { x: 1, y: 1 }, rotation: 2, team: { id: 1 } };
const tiles = Array.from({ length: 4 }, (_, x) => Array.from({ length: 4 }, (_, y) => ({
    x, y, build, floor() { return grass; }, overlay() { return x === 0 && y === 0 ? copper : air; }, block() { return blast; }
})));
const adapter = { console, Log: { info() {}, err() {} }, cons: f => f, run: f => f, prov: f => f,
    JavaAdapter: function(type, overrides) {
        const unit = adapter.UnitTypes.dagger.create();
        unit.super$controller = unit.controller;
        unit.super$rawDamage = unit.damagePierce;
        return unit;
    },
    extend(type, ...args) { return args.length === 2 ? { create() { return this.constructor(); } } : args[0]; },
    Events: { on(type, f) { callbacks[type] = f; }, run(type, f) { callbacks[type] = f; } },
    EventType: { ClientLoadEvent: 'load', WorldLoadEvent: 'world', SaveWriteEvent: 'save', BlockBuildEndEvent: 'block', ClientChatEvent: 'chat' },
    Trigger: { draw: 'draw' }, Vars: { world: { width() { return 4; }, height() { return 4; }, tile(x, y) { return tiles[x][y]; } } },
    UnitTypes: { dagger: { fullIcon: { width: 1, height: 1, scl() { return 1; } } } },
    Time: { delta: 1 }, Draw: { rect() {}, reset() {} },
    Packages: { mindustry: { type: {UnitType: function(){}}, gen: {UnitEntity: {create() { return adapter.UnitTypes.dagger.create(); }}}, graphics: { Drawf: { text() {} } } }, arc: { graphics: { Color: { white: {} } } } }
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
let created = 0;
adapter.Vars.net = {client() { return false; }};
adapter.Vars.state = {isGame() { return true; }}; adapter.Vars.tilesize = 8;
adapter.Team = {sharded: {id: 1}};
adapter.Packages.mindustry.entities = {units: {AIController: function() {}}};
adapter.extend = (type, controller) => controller;
adapter.UnitTypes.dagger.create = () => ({id: ++created, health: 100, maxHealth: 100, dead: false,
    vel: {setZero() {}}, controller() {}, set() {}, add() {}, remove() {this.dead = true;},
    isAdded() {return !this.dead;}, damagePierce(amount) {this.health -= amount; if(this.health <= 0) this.dead = true;},
    heal(amount) {this.health = Math.min(this.maxHealth, this.health + amount);}});
adapter.api.applyRelayEvent({type: 'PLAYER_STATE', source_game: 'MINECRAFT', id: 'MINECRAFT:steve', life_id: 'one', x: 10, y: 10, health_fraction: .5});
adapter.updateMinecraftUnits();
const steve = adapter.api.minecraftPlayers['MINECRAFT:steve'];
assert.equal(steve.unit.health, 50);
assert.equal(steve.unit.spawnedByCore, false, 'Steve must not be automatically despawned as an unused core unit');
adapter.applyCombatEvent({type: 'PLAYER_HEALTH_DELTA', target_id: 'MINECRAFT:steve', life_id: 'stale', amount_fraction: -.2});
assert.equal(steve.unit.health, 50, 'old life damage cannot affect respawn');
adapter.applyCombatEvent({type: 'PLAYER_HEALTH_DELTA', target_id: 'MINECRAFT:steve', life_id: 'one', amount_fraction: -.5});
adapter.updateMinecraftUnits(); const createdAtDeath = created;
adapter.api.applyRelayEvent({type: 'PLAYER_STATE', source_game: 'MINECRAFT', id: 'MINECRAFT:steve', life_id: 'one', x: 10, y: 10, health_fraction: 1});
adapter.updateMinecraftUnits(); assert.equal(created, createdAtDeath, 'periodic position does not resurrect dead unit');
adapter.api.applyRelayEvent({type: 'PLAYER_STATE', source_game: 'MINECRAFT', id: 'MINECRAFT:steve', life_id: 'two', x: 10, y: 10, health_fraction: 1});
adapter.updateMinecraftUnits(); assert.equal(created, createdAtDeath + 1);
adapter.Vars.net.client = () => true;
adapter.applyCombatEvent({type: 'PLAYER_HEALTH_DELTA', target_id: 'MINECRAFT:steve', life_id: 'two', amount_fraction: -.5});
assert.equal(steve.unit.health, 100, 'remote Mindustry clients never mutate authoritative health');
adapter.Vars.net.client = () => false;
steve.unit.health = 25;
callbacks.save(); assert.equal(steve.unit, null, 'temporary Steve units are excluded before save serialization');
adapter.updateMinecraftUnits(); assert.equal(steve.unit.health, 25, 'save does not heal or kill the active Steve');
console.log('PASS: reverse titanium, 48-cell drill removal, center/corner round trip, mass-driver, overlap cleanup, terrain snapshot, fluids, cores, angle conversion, queue coalescing, terrain scanner, proxy interpolation. No live servers or saves were used.');
