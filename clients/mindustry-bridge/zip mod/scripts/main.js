// Multi-Sandbox Engine - Mindustry JS Bridge
// World Sync experimental core: snapshots, incremental blocks, chat and visual player proxies.

const relayBaseUrl = "http://localhost:8080";
const relayEventUrl = relayBaseUrl + "/event";
const relayPollUrl = relayBaseUrl + "/poll?game=MINDUSTRY";
const bridgeVersion = "world-sync-dev2";
const snapshotChunkSize = 512;
const minecraftPlayers = {};
let applyingRemoteBlock = false;
let polling = false;
let snapshotNeeded = true;
let snapshotSending = false;
let lastRelaySession = null;

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function javaCallback(fn){
    return new Packages.arc.func.ConsT({ get: fn });
}

function postEvent(packet, onDone, onError){
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
    return { x: x, y: y, block_id: String(block.name), layer: layer,
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

    const snapshotId = "mindustry-" + Date.now();
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
        Core.app.post(run(() => { snapshotSending = false; snapshotNeeded = true; }));
    }

    function sendChunk(index){
        if(index >= chunks.length){
            postEvent({
                type: "WORLD_SNAPSHOT_END",
                game: "MINDUSTRY",
                source_game: "MINDUSTRY",
                snapshot_id: snapshotId
            }, function(){
                mseLog("Snapshot END " + snapshotId);
                Core.app.post(run(() => { snapshotSending = false; }));
            }, failed);
            return;
        }

        postEvent({
            type: "WORLD_SNAPSHOT_CHUNK",
            game: "MINDUSTRY",
            source_game: "MINDUSTRY",
            snapshot_id: snapshotId,
            objects: chunks[index]
        }, function(){ sendChunk(index + 1); }, failed);
    }

    postEvent({
        type: "WORLD_SNAPSHOT_BEGIN",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        snapshot_id: snapshotId,
        width: Vars.world.width(),
        height: Vars.world.height()
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
            rotation: Vars.player.unit().rotation
        });
    }catch(err){
        mseLog("Player state ERROR: " + err);
    }
}

function applyRelayEvent(packet){
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
        return;
    }

    if(packet.type === "PLAYER_DESPAWN"){
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
                else tile.setNet(block, Team.sharded, Number(packet.rotation || 0));
                mseLog("RX applied " + blockName + " @ " + x + "," + y);
            }finally{
                applyingRemoteBlock = false;
            }
        }));
    }
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
    Timer.schedule(run(() => {
        Core.app.post(run(() => { if(snapshotNeeded) sendWorldSnapshot(); }));
    }), 2.0, 2.0);
}));

Events.on(EventType.WorldLoadEvent, cons(event => {
    snapshotNeeded = true;
    for(let id in minecraftPlayers) delete minecraftPlayers[id];
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

// Minecraft players are visual-only Dagger proxies in this first implementation.
// No Unit is spawned, so the proxy cannot fight, collide, pathfind or affect gameplay.
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
            Draw.rect(region, Number(p.x) * tileSize, Number(p.y) * tileSize,
                region.width * region.scl(), region.height * region.scl(), Number(p.rotation || 0) - 90);
        }
    }catch(err){}
}));

mseLog("main.js parsed - " + bridgeVersion);
