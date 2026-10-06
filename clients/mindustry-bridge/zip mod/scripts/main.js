// Multi-Sandbox Engine - Mindustry JS Bridge
// World Sync experimental core: snapshots, incremental blocks, chat and visual player proxies.

const relayBaseUrl = "http://localhost:8080";
const relayEventUrl = relayBaseUrl + "/event";
const relayPollUrl = relayBaseUrl + "/poll?game=MINDUSTRY";
const bridgeVersion = "world-sync-dev1";
const snapshotChunkSize = 128;
const minecraftPlayers = {};\nlet applyingRemoteBlock = false;

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function javaCallback(fn){
    return new Packages.arc.func.ConsT({ get: fn });
}

function postEvent(packet, onDone){
    const body = JSON.stringify(packet);
    Http.post(relayEventUrl, body)
        .header("Content-Type", "application/json")
        .error(cons(err => Log.err("[MSE-MINDUSTRY] Relay HTTP ERROR: " + err)))
        .submit(javaCallback(function(res){
            if(res.getStatus() >= 400) mseLog("Relay HTTP " + res.getStatus());
            if(onDone) onDone();
        }));
}

function sendBlockEvent(event){
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
        x: tile.x,
        y: tile.y,
        block_id: blockName,
        size: blockSize,
        rotation: rotation,
        layer: "block",
        breaking: event.breaking
    });
}

function collectSnapshotObjects(){
    const objects = [];
    const seenBuildings = {};

    for(let x = 0; x < Vars.world.width(); x++){
        for(let y = 0; y < Vars.world.height(); y++){
            const tile = Vars.world.tile(x, y);
            if(tile == null || tile.block() == null) continue;

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

            objects.push({
                x: originX,
                y: originY,
                block_id: block.name,
                layer: "block",
                rotation: rotation
            });
        }
    }

    // Floor/overlay/ore layers intentionally join this same snapshot format
    // after the conversion registry is expanded.
    return objects;
}

function sendWorldSnapshot(){
    if(Vars.world == null) return;

    const snapshotId = "mindustry-" + Date.now();
    const objects = collectSnapshotObjects();
    const chunks = [];
    for(let i = 0; i < objects.length; i += snapshotChunkSize){
        chunks.push(objects.slice(i, i + snapshotChunkSize));
    }

    mseLog("Snapshot BEGIN " + snapshotId + " with " + objects.length + " block objects");

    function sendChunk(index){
        if(index >= chunks.length){
            postEvent({
                type: "WORLD_SNAPSHOT_END",
                game: "MINDUSTRY",
                source_game: "MINDUSTRY",
                snapshot_id: snapshotId
            }, function(){ mseLog("Snapshot END " + snapshotId); });
            return;
        }

        postEvent({
            type: "WORLD_SNAPSHOT_CHUNK",
            game: "MINDUSTRY",
            source_game: "MINDUSTRY",
            snapshot_id: snapshotId,
            objects: chunks[index]
        }, function(){ sendChunk(index + 1); });
    }

    postEvent({
        type: "WORLD_SNAPSHOT_BEGIN",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        snapshot_id: snapshotId,
        width: Vars.world.width(),
        height: Vars.world.height()
    }, function(){ sendChunk(0); });
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
        minecraftPlayers[String(packet.id || packet.player_id)] = packet;
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
                tile.setNet(block, Team.sharded, Number(packet.rotation || 0));
                mseLog("RX applied " + blockName + " @ " + x + "," + y);
            }finally{
                applyingRemoteBlock = false;
            }
        }));
    }
}

function pollRelay(){
    Http.get(relayPollUrl)
        .error(cons(err => Log.err("[MSE-MINDUSTRY] Poll ERROR: " + err)))
        .submit(javaCallback(function(res){
            try{
                const data = JSON.parse(res.getResultAsString());
                if(data.events){
                    for(let i = 0; i < data.events.length; i++) applyRelayEvent(data.events[i]);
                }
            }catch(err){
                Log.err("[MSE-MINDUSTRY] Poll parse/apply ERROR: " + err);
            }
        }));
}

Events.on(EventType.ClientLoadEvent, cons(event => {
    mseLog("BOOT OK - Mindustry Bridge " + bridgeVersion);
    try{ Vars.ui.showInfoToast("[accent]Multi-Sandbox Engine[]\n[lightgray]" + bridgeVersion + "[]", 5); }catch(err){}
    Timer.schedule(run(() => pollRelay()), 0.5, 0.5);
    Timer.schedule(run(() => sendLocalPlayerState()), 1.0, 0.2);
}));

Events.on(EventType.WorldLoadEvent, cons(event => {
    // Give the world/buildings a moment to finish loading before scanning.
    Timer.schedule(run(() => sendWorldSnapshot()), 2.0);
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
            Draw.rect(region, Number(p.x) * tileSize, Number(p.y) * tileSize,
                region.width * region.scl(), region.height * region.scl(), Number(p.rotation || 0) - 90);
        }
    }catch(err){}
}));

mseLog("main.js parsed - " + bridgeVersion);
