// Multi-Sandbox Engine - Mindustry JS Bridge
// World Sync experimental core: snapshots, incremental blocks, chat and visual player proxies.

const relayBaseUrl = "http://localhost:8080";
const relayEventUrl = relayBaseUrl + "/event";
const relayPollUrl = relayBaseUrl + "/poll?game=MINDUSTRY";
const bridgeVersion = "1.3.0 - Survival Foundation Update";
const snapshotChunkSize = 512;
const minecraftPlayers = {};
// A dedicated type avoids the automatic despawn of unused core units and the normal unit cap.
const steveUnitType = extend(Packages.mindustry.type.UnitType, 'steve-proxy', { draw: function(unit){} });
function steveArmoredDamage(unit, amount){
    let profile = null;
    for(let id in minecraftPlayers){ if(minecraftPlayers[id].unit === unit) profile = minecraftPlayers[id]; }
    if(profile == null) return amount;
    const armor = Math.max(0, Math.min(30, Number(profile.armor || 0)));
    const toughness = Math.max(0, Math.min(20, Number(profile.toughness || 0)));
    const protection = Math.max(0, Math.min(20, Number(profile.protection || 0)));
    const hearts = amount / Math.max(1, unit.maxHealth) * 20;
    const effective = Math.min(20, Math.max(armor / 5, armor - hearts / (2 + toughness / 4)));
    return amount * (1 - effective / 25) * (1 - protection / 25);
}
steveUnitType.constructor = prov(() => new JavaAdapter(Packages.mindustry.gen.UnitEntity, {
    controller: function(controller){
        if(arguments.length === 0) return this.super$controller();
        this.super$controller(controller);
    },
    rawDamage: function(amount){ this.super$rawDamage(steveArmoredDamage(this, amount)); }
}));
steveUnitType.useUnitCap = false;
steveUnitType.canDrown = false;
// Erekir's scorching environment must not automatically kill the shared Steve unit.
steveUnitType.envEnabled = -1;
steveUnitType.envDisabled = 0;
steveUnitType.envRequired = 0;
steveUnitType.hidden = true;
steveUnitType.health = 150;
steveUnitType.hitSize = 8;
steveUnitType.speed = 0;
steveUnitType.itemCapacity = 0;
steveUnitType.playerControllable = false;
steveUnitType.logicControllable = false;
steveUnitType.allowedInPayloads = false;
let applyingRemoteBlock = false;
let polling = false;
let snapshotNeeded = true;
let snapshotSending = false;
let lastRelaySession = null;
let worldEpoch = Date.now();
let snapshotGeneration = 0;

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function javaCallback(fn){
    return new Packages.arc.func.ConsT({ get: fn });
}

function postEvent(packet, onDone, onError){
    if(packet.world_epoch == null) packet.world_epoch = worldEpoch;
    const body = JSON.stringify(packet);
    Http.post(relayEventUrl, body)
        .header("Content-Type", "application/json")
        .error(cons(err => {
            Log.err("[MSE-MINDUSTRY] Relay HTTP ERROR: " + err);
            if(onError) onError();
        }))
        .submit(javaCallback(function(res){
            if(res.getStatus() >= 400){
                mseLog("Relay HTTP " + res.getStatus());
                if(onError) onError();
                return;
            }
            if(onDone) onDone();
        }));
}

function sendBlockEvent(event){
    if(applyingRemoteBlock) return;
    const tile = event.tile;
    if(tile == null) return;

    let blockName = "unknown";
    let blockSize = 1;
    let rotation = 0;

    try{
        if(tile.block() != null){
            blockName = tile.block().name;
            blockSize = tile.block().size;
        }
        if(tile.build != null) rotation = tile.build.rotation;
    }catch(err){
        mseLog("Could not read block metadata: " + err);
    }

    postEvent({
        type: "PLACE_BLOCK",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        x: tile.build != null ? tile.build.tile.x : tile.x,
        y: tile.build != null ? tile.build.tile.y : tile.y,
        block_id: blockName,
        size: blockSize,
        synthetic: tile.block() != null && tile.block().synthetic(),
        solid: tile.block() != null && tile.block().solid,
        rotation: rotation,
        layer: "block",
        breaking: event.breaking
    });
}

function describeTile(x, y, block, layer, rotation){
    const tile = Vars.world.tile(x, y);
    return { x: x, y: y, block_id: String(block.name), layer: layer,
        has_items: tile != null && tile.build != null && tile.build.items != null,
        team: tile != null && tile.build != null ? Number(tile.build.team.id) : 1,
        rotation: rotation || 0, size: Number(block.size || 1),
        synthetic: block.synthetic(), solid: block.solid,
        liquid: layer === 'floor' && block.isLiquid,
        deep: layer === 'floor' && block.isDeep() };
}

function collectSnapshotObjects(){
    const objects = [];
    const seenBuildings = {};

    for(let x = 0; x < Vars.world.width(); x++){
        for(let y = 0; y < Vars.world.height(); y++){
            const tile = Vars.world.tile(x, y);
            if(tile == null) continue;
            if(tile.floor() != null && tile.floor().name !== 'air'){
                objects.push(describeTile(x, y, tile.floor(), 'floor', 0));
            }
            if(tile.overlay() != null && tile.overlay().name !== 'air'){
                objects.push(describeTile(x, y, tile.overlay(), 'overlay', 0));
            }
            if(tile.block() == null) continue;

            const block = tile.block();
            if(block.name === "air") continue;

            let originX = x;
            let originY = y;
            let rotation = 0;

            try{
                if(tile.build != null && tile.build.tile != null){
                    originX = tile.build.tile.x;
                    originY = tile.build.tile.y;
                    rotation = tile.build.rotation;
                    const buildingKey = originX + ":" + originY;
                    if(seenBuildings[buildingKey]) continue;
                    seenBuildings[buildingKey] = true;
                }
            }catch(err){}

            objects.push(describeTile(originX, originY, block, 'block', rotation));
        }
    }

    return objects;
}

function sendWorldSnapshot(){
    if(snapshotSending || Vars.state == null || !Vars.state.isGame() ||
        Vars.world == null || Vars.world.width() === 0) return;
    snapshotSending = true;
    snapshotNeeded = false;
    let spawn = {x: Math.floor(Vars.world.width() / 2), y: Math.floor(Vars.world.height() / 2)};
    try{ const core = Vars.player.team().core(); if(core) spawn = {x: core.tile.x, y: core.tile.y}; }catch(err){}

    const snapshotId = "mindustry-" + Date.now();
    const generation = ++snapshotGeneration;
    const epoch = worldEpoch;
    let objects;
    try{ objects = collectSnapshotObjects(); }
    catch(err){
        snapshotSending = false; snapshotNeeded = true;
        Log.err('[MSE-MINDUSTRY] Snapshot scan ERROR: ' + err);
        return;
    }
    const chunks = [];
    for(let i = 0; i < objects.length; i += snapshotChunkSize){
        chunks.push(objects.slice(i, i + snapshotChunkSize));
    }

    mseLog("Snapshot BEGIN " + snapshotId + " with " + objects.length + " terrain/building objects");
    function failed(){
        Core.app.post(run(() => { if(generation === snapshotGeneration){ snapshotSending = false; snapshotNeeded = true; } }));
    }

    function sendChunk(index){
        if(generation !== snapshotGeneration || epoch !== worldEpoch) return;
        if(index >= chunks.length){
            postEvent({
                type: "WORLD_SNAPSHOT_END",
                game: "MINDUSTRY",
                source_game: "MINDUSTRY",
                snapshot_id: snapshotId
                ,world_epoch: epoch
            }, function(){
                mseLog("Snapshot END " + snapshotId);
                Core.app.post(run(() => { if(generation === snapshotGeneration) snapshotSending = false; }));
            }, failed);
            return;
        }

        postEvent({
            type: "WORLD_SNAPSHOT_CHUNK",
            game: "MINDUSTRY",
            source_game: "MINDUSTRY",
            snapshot_id: snapshotId,
            world_epoch: epoch,
            objects: chunks[index]
        }, function(){ sendChunk(index + 1); }, failed);
    }

    postEvent({
        type: "WORLD_SNAPSHOT_BEGIN",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        snapshot_id: snapshotId,
        world_epoch: epoch,
        map_id: Vars.state.rules.sector != null ? 'sector:' + Vars.state.rules.sector.planet.name + ':' + Vars.state.rules.sector.id : 'map:' + Vars.state.map.file.nameWithoutExtension(),
        environment: Vars.state.rules.env,
        planet: Vars.state.rules.sector != null ? String(Vars.state.rules.sector.planet.name) : null,
        map_name: Vars.state.map.name(),
        width: Vars.world.width(),
        height: Vars.world.height()
        ,spawn: spawn
    }, function(){ sendChunk(0); }, failed);
}

function sendLocalPlayerState(){
    try{
        if(Vars.player == null || Vars.player.unit() == null) return;
        const tileSize = Vars.tilesize;
        postEvent({
            type: "PLAYER_STATE",
            game: "MINDUSTRY",
            source_game: "MINDUSTRY",
            player_id: "MINDUSTRY:" + Vars.player.uuid(),
            player: Vars.player.name,
            x: Vars.player.x / tileSize,
            y: Vars.player.y / tileSize,
            mse_y: 5,
            rotation: Vars.player.unit().rotation,
            health_fraction: Math.max(0, Vars.player.unit().health / Vars.player.unit().maxHealth),
            unit_id: Vars.player.unit().id,
            life_id: String(Vars.player.unit().id),
            team: Vars.player.team().id
        });
    }catch(err){
        mseLog("Player state ERROR: " + err);
    }
}

function applyRelayEvent(packet){
    if(packet.type === 'BUILDING_INVENTORY_REQUEST'){ applyInventoryRequest(packet); return; }
    if(packet.world_epoch && Number(packet.world_epoch) !== worldEpoch) return;
    if(packet.type === 'BUILDING_CONFIGURE'){ applyBuildingConfiguration(packet); return; }
    if(packet.type === 'ENTITY_DAMAGE' || packet.type === 'PLAYER_HEALTH_DELTA'){
        applyCombatEvent(packet); return;
    }
    if(packet.type === "CHAT_MESSAGE"){
        if(Vars.ui && Vars.ui.chatfrag){
            Vars.ui.chatfrag.addMessage("[#55FF55][MSE][" + packet.game + "] [white]<" + packet.player + "> " + packet.message);
        }
        return;
    }

    if(packet.type === "PLAYER_STATE" && packet.source_game === "MINECRAFT"){
        const id = String(packet.id || packet.player_id);
        let p = minecraftPlayers[id];
        if(p == null){
            p = { x: Number(packet.x), y: Number(packet.y), rotation: Number(packet.rotation || 0) };
            minecraftPlayers[id] = p;
        }
        p.targetX = Number(packet.x); p.targetY = Number(packet.y);
        p.targetRotation = Number(packet.rotation || 0); p.received = Date.now();
        p.name = String(packet.name || packet.player || 'Minecraft');
        p.creative = packet.creative === true;
        p.armor = packet.armor; p.toughness = packet.toughness; p.protection = packet.protection;
        if(p.life !== packet.life_id){
            if(p.unit != null) p.unit.remove();
            p.unit = null; p.life = packet.life_id; p.dead = false;
            p.initialHealth = Number(packet.health_fraction == null ? 1 : packet.health_fraction);
        }
        return;
    }

    if(packet.type === "PLAYER_DESPAWN"){
        const old = minecraftPlayers[String(packet.player_id)];
        if(old && old.unit) old.unit.remove();
        delete minecraftPlayers[String(packet.player_id)];
        return;
    }

    if(packet.type === "MINDUSTRY_SET_BLOCK"){
        const x = Math.round(Number(packet.x));
        const y = Math.round(Number(packet.y));
        const blockName = String(packet.block_id || "air");
        const tile = Vars.world.tile(x, y);
        if(tile == null) return;

        const block = Vars.content.block(blockName);
        if(block == null){
            mseLog("RX unknown block " + blockName);
            return;
        }

        Core.app.post(run(() => {
            applyingRemoteBlock = true;
            try{
                if(blockName === 'air') tile.removeNet();
                else {
                    tile.setNet(block, Vars.player != null ? Vars.player.team() : Team.sharded, Number(packet.rotation || 0));
                    if(tile.build != null) tile.build.placed();
                }
                mseLog("RX applied " + blockName + " @ " + x + "," + y);
            }finally{
                applyingRemoteBlock = false;
            }
        }));
    }
}

function applyBuildingConfiguration(packet){
    if(!hostAuthority())return;
    const player=minecraftPlayers['MINECRAFT:'+packet.player_id];
    const tile=Vars.world.tile(Math.round(Number(packet.x)),Math.round(Number(packet.y)));
    const build=tile==null?null:tile.build;
    if(!player||player.dead||!build||String(build.block.name)!==String(packet.block_id)||
        (Vars.player!=null&&build.team.id!==Vars.player.team().id)||
        Math.sqrt(Math.pow(player.targetX-tile.x,2)+Math.pow(player.targetY-tile.y,2))>12)return;
    if(packet.configuration==='item'){
        const name=String(build.block.name);
        if(name!=='sorter'&&name!=='inverted-sorter'&&name!=='unloader'&&name!=='directional-unloader')return;
        const item=String(packet.resource)===''?null:Vars.content.item(String(packet.resource));
        if(item!=null||String(packet.resource)==='')build.configure(item);
    }else if(packet.configuration==='link'){
        const target=Vars.world.tile(Math.round(Number(packet.target_x)),Math.round(Number(packet.target_y)));
        const other=target==null?null:target.build;
        if(!other||other===build||other.team.id!==build.team.id)return;
        const name=String(build.block.name);
        if(name==='power-node'||name==='power-node-large'||name==='surge-tower'){
            if(other.power!=null)build.configure(new java.lang.Integer(other.pos()));
        }else if(name==='mass-driver'||name==='payload-mass-driver'){
            if(String(other.block.name)!==name||build.dst(other)>build.block.range)return;
            build.configure(new java.lang.Integer(build.link===other.pos()?-1:other.pos()));
        }else if(name==='bridge-conveyor'||name==='phase-conveyor'||name==='bridge-conduit'||name==='phase-conduit'){
            if(String(other.block.name)!==name||(tile.x!==target.x&&tile.y!==target.y)||
                Math.max(Math.abs(tile.x-target.x),Math.abs(tile.y-target.y))>build.block.range)return;
            build.configure(new java.lang.Integer(build.link===other.pos()?-1:other.pos()));
        }
    }
}
let inventoryReceipts = null;
function applyInventoryRequest(packet){
    if(!hostAuthority()) return;
    if(inventoryReceipts == null){
        try{ inventoryReceipts = JSON.parse(String(Core.settings.getString('mse-inventory-receipts', '{}'))); }
        catch(err){ mseLog('Inventory receipts could not be read; transfers disabled: ' + err); return; }
    }
    const token = String(packet.request_id || '');
    try{ if(String(java.util.UUID.fromString(token).toString()) !== token.toLowerCase()) return; }
    catch(err){ return; }
    if(inventoryReceipts[token]){ postEvent(inventoryReceipts[token]); return; }
    const reply = {type:'BUILDING_INVENTORY_RESULT',game:'MINDUSTRY',source_game:'MINDUSTRY',
        request_id:token,player_id:packet.player_id,object_id:packet.object_id,world_epoch:packet.world_epoch,
        accepted:0,status:'rejected',items:[]};
    if(packet.lookup_only || Number(packet.world_epoch) !== worldEpoch){ reply.status='unknown';postEvent(reply);return; }
    const player = minecraftPlayers['MINECRAFT:' + packet.player_id];
    const tile = Vars.world.tile(Math.round(Number(packet.x)), Math.round(Number(packet.y)));
    const build = tile == null ? null : tile.build;
    if(build != null && player && !player.dead && build.items != null &&
        String(build.block.name) === String(packet.block_id) && build.team.id === Number(packet.team) &&
        (Vars.player == null || build.team.id === Vars.player.team().id) &&
        Math.sqrt(Math.pow(player.targetX - tile.x,2) + Math.pow(player.targetY - tile.y,2)) <= 12){
        const amount = Number(packet.amount);
        const item = Vars.content.item(String(packet.resource));
        if(packet.operation === 'read') reply.status='ok';
        else if(item != null && Number.isInteger(amount) && amount > 0 && amount <= 64){
            if(packet.operation === 'take'){
                reply.accepted = build.removeStack(item, Math.min(amount, build.items.get(item)));
                reply.status='ok';
            }else if(packet.operation === 'put'){
                reply.accepted = Math.max(0, Math.min(amount, build.acceptStack(item,amount,player.unit)));
                if(reply.accepted > 0){
                    const before = build.items.get(item);
                    build.handleStack(item,reply.accepted,player.unit);
                    reply.accepted = Math.max(0, Math.min(reply.accepted, build.items.get(item) - before));
                }
                reply.status='ok';
            }
        }
        Vars.content.items().each(cons(item => { const amount=build.items.get(item);if(amount>0)reply.items.push({item:String(item.name),amount:amount}); }));
    }
    if(packet.operation !== 'read'){
        inventoryReceipts[token]=reply;
        const keys=Object.keys(inventoryReceipts);while(keys.length>4096)delete inventoryReceipts[keys.shift()];
        Core.settings.put('mse-inventory-receipts',JSON.stringify(inventoryReceipts));Core.settings.forceSave();
    }
    postEvent(reply);
}

function pollRelay(){
    if(polling) return;
    polling = true;
    Http.get(relayPollUrl)
        .error(cons(err => {
            polling = false;
            Log.err("[MSE-MINDUSTRY] Poll ERROR: " + err);
        }))
        .submit(javaCallback(function(res){
            try{
                const data = JSON.parse(res.getResultAsString());
                Core.app.post(run(() => {
                    if(data.relay_session && data.relay_session !== lastRelaySession){
                        lastRelaySession = data.relay_session; snapshotNeeded = true;
                    }
                    if(data.events){
                        for(let i = 0; i < data.events.length; i++) applyRelayEvent(data.events[i]);
                    }
                }));
            }catch(err){
                Log.err("[MSE-MINDUSTRY] Poll parse/apply ERROR: " + err);
            }
            polling = false;
        }));
}

Events.on(EventType.ClientLoadEvent, cons(event => {
    mseLog("BOOT OK - Mindustry Bridge " + bridgeVersion);
    try{ Vars.ui.showInfoToast("[accent]Multi-Sandbox Engine[]\n[lightgray]" + bridgeVersion + "[]", 5); }catch(err){}
    Timer.schedule(run(() => pollRelay()), 0.1, 0.1);
    Timer.schedule(run(() => sendLocalPlayerState()), 1.0, 0.2);
    Timer.schedule(run(() => Core.app.post(run(() => sendEntityFrame()))), 1.0, 0.1);
    Timer.schedule(run(() => {
        Core.app.post(run(() => { if(snapshotNeeded) sendWorldSnapshot(); }));
    }), 2.0, 2.0);
}));

Events.on(EventType.WorldLoadEvent, cons(event => {
    worldEpoch = Math.max(Date.now(), worldEpoch + 1);
    snapshotGeneration++; snapshotSending = false;
    snapshotNeeded = true;
    for(let id in minecraftPlayers) delete minecraftPlayers[id];
}));

// Temporary bridge units must never become permanent units in the user's saves.
Events.on(EventType.SaveWriteEvent, cons(event => {
    for(let id in minecraftPlayers){
        const p = minecraftPlayers[id];
        if(p.unit){
            p.initialHealth = Math.max(0, Math.min(1, p.unit.health / p.unit.maxHealth));
            p.dead = p.dead || p.unit.dead;
            p.unit.remove(); p.unit = null;
        }
    }
}));

Events.on(EventType.BlockBuildEndEvent, cons(event => {
    sendBlockEvent(event);
}));

Events.on(EventType.ClientChatEvent, cons(event => {
    let playerName = "MindustryPlayer";
    try{ if(Vars.player != null && Vars.player.name != null) playerName = Vars.player.name; }catch(err){}
    postEvent({
        type: "CHAT_MESSAGE",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        player: playerName,
        message: event.message
    });
}));

// The Mindustry host owns health/death. Remote network clients keep visual proxies only.
let entitySequence = 0;
function hostAuthority(){ return Vars.net == null || !Vars.net.client(); }
function applyCombatEvent(packet){
    if(!hostAuthority()) return;
    let unit = null;
    const id = String(packet.target_id || '');
    if(id.indexOf('MINECRAFT:') === 0){
        const player = minecraftPlayers[id];
        if(!player || player.life !== packet.life_id || player.creative) return;
        unit = player.unit;
    }else if(id.indexOf('UNIT:') === 0){
        unit = Groups.unit.getByID(Number(id.substring(5)));
    }else if(id.indexOf('MINDUSTRY:') === 0){
        Groups.player.each(cons(p => { if('MINDUSTRY:' + p.uuid() === id) unit = p.unit(); }));
        if(unit != null && packet.life_id && String(unit.id) !== String(packet.life_id)) return;
    }
    const fraction = Number(packet.amount_fraction);
    if(unit == null || unit.dead || !Number.isFinite(fraction) || Math.abs(fraction) > 1) return;
    if(packet.type === 'ENTITY_DAMAGE' && fraction > 0) unit.damagePierce(fraction * unit.maxHealth);
    if(packet.type === 'PLAYER_HEALTH_DELTA'){
        // Bukkit already applied armor to environmental damage; do not apply it twice.
        if(fraction < 0){
            if(id.indexOf('MINECRAFT:') === 0) unit.super$rawDamage(-fraction * unit.maxHealth);
            else unit.damagePierce(-fraction * unit.maxHealth);
        }
        else unit.heal(fraction * unit.maxHealth);
    }
}
function updateMinecraftUnits(){
    if(!hostAuthority() || Vars.state == null || !Vars.state.isGame()) return;
    for(let id in minecraftPlayers){
        const p = minecraftPlayers[id];
        if(Date.now() - p.received > 5000){ if(p.unit) p.unit.remove(); delete minecraftPlayers[id]; continue; }
        if(p.unit && (p.unit.dead || !p.unit.isAdded())) p.dead = true;
        if(p.unit == null && !p.dead){
            const unit = steveUnitType.create(Vars.player != null ? Vars.player.team() : Team.sharded);
            unit.spawnedByCore = false;
            unit.super$controller(extend(Packages.mindustry.entities.units.AIController, {
                updateMovement: function(){}, updateWeapons: function(){},
                updateTargeting: function(){}, shouldShoot: function(){ return false; }
            }));
            unit.set(p.targetX * Vars.tilesize, p.targetY * Vars.tilesize);
            unit.health = Math.max(0.01, Math.min(1, p.initialHealth || 1) * unit.maxHealth);
            unit.add(); p.unit = unit;
        }
        if(p.unit && !p.dead){
            p.unit.vel.setZero();
            p.unit.set(p.x * Vars.tilesize, p.y * Vars.tilesize);
            p.unit.rotation = p.rotation;
            if(p.creative) p.unit.health = p.unit.maxHealth;
        }
    }
}
function sendEntityFrame(){
    if(!hostAuthority() || snapshotSending || snapshotNeeded || Vars.state == null || !Vars.state.isGame()) return;
    const units = [], health = [], remoteIds = {};
    for(let id in minecraftPlayers){
        const p = minecraftPlayers[id];
        if(p.unit){
            remoteIds[p.unit.id] = true;
            health.push({id: id, life_id: p.life, health_fraction: p.dead ? 0 : Math.max(0, p.unit.health / p.unit.maxHealth)});
        }
    }
    const nearby = [];
    Groups.unit.each(cons(unit => {
        if(unit.dead || unit.isPlayer() || remoteIds[unit.id]) return;
        let distance = Infinity;
        for(let id in minecraftPlayers){ const p = minecraftPlayers[id];
            const dx = unit.x / Vars.tilesize - p.targetX, dy = unit.y / Vars.tilesize - p.targetY;
            distance = Math.min(distance, dx * dx + dy * dy);
        }
        if(distance <= 48 * 48) nearby.push({unit: unit, distance: distance});
    }));
    nearby.sort((a, b) => a.distance - b.distance);
    for(let i = 0; i < Math.min(64, nearby.length); i++){
        const unit = nearby[i].unit;
        units.push({id: 'UNIT:' + unit.id, unit_type: String(unit.type.name), x: unit.x / Vars.tilesize,
            y: unit.y / Vars.tilesize, rotation: unit.rotation, flying: unit.type.flying,
            team: unit.team.id, team_color: String(unit.team.color.toString()), health_fraction: unit.health / unit.maxHealth});
    }
    postEvent({type: 'ENTITY_FRAME', game: 'MINDUSTRY', seq: ++entitySequence, units: units, minecraft_health: health});
}
Events.run(Trigger.update, run(() => updateMinecraftUnits()));
Events.run(Trigger.draw, run(() => {
    try{
        const region = UnitTypes.dagger.fullIcon;
        const tileSize = Vars.tilesize;
        for(let id in minecraftPlayers){
            const p = minecraftPlayers[id];
            if(Date.now() - p.received > 5000){ delete minecraftPlayers[id]; continue; }
            const alpha = 1 - Math.exp(-Number(Time.delta) / 6);
            p.x += (p.targetX - p.x) * alpha; p.y += (p.targetY - p.y) * alpha;
            const angleDelta = (((p.targetRotation - p.rotation + 180) % 360 + 360) % 360) - 180;
            p.rotation = (p.rotation + angleDelta * alpha + 360) % 360;
            if(!p.dead) Draw.rect(region, Number(p.x) * tileSize, Number(p.y) * tileSize,
                region.width * region.scl(), region.height * region.scl(), Number(p.rotation || 0) - 90);
            Draw.reset();
            Packages.mindustry.graphics.Drawf.text('[MSE] ' + p.name,
                Number(p.x) * tileSize, Number(p.y) * tileSize + 12,
                Packages.arc.graphics.Color.white, 0.7);
        }
    }catch(err){}
}));

mseLog("main.js parsed - " + bridgeVersion);
