// Multi-Sandbox Engine - Mindustry JS Bridge
// v1.2 experimental: two-way blocks + crossplay chat.

const relayBaseUrl = "http://localhost:8080";
const relayEventUrl = relayBaseUrl + "/event";
const relayPollUrl = relayBaseUrl + "/poll?game=MINDUSTRY";
const bridgeVersion = "1.2-dev1";

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function javaCallback(fn){
    return new Packages.arc.func.ConsT({ get: fn });
}

function postEvent(packet){
    const body = JSON.stringify(packet);
    mseLog("TX " + body);

    Http.post(relayEventUrl, body)
        .header("Content-Type", "application/json")
        .error(cons(err => Log.err("[MSE-MINDUSTRY] Relay HTTP ERROR: " + err)))
        .submit(javaCallback(function(res){
            mseLog("Relay HTTP " + res.getStatus());
        }));
}

function sendBlockEvent(event){
    const tile = event.tile;
    if(tile == null) return;

    let blockName = "unknown";
    let blockSize = 1;

    try{
        if(tile.block() != null){
            blockName = tile.block().name;
            blockSize = tile.block().size;
        }
    }catch(err){
        mseLog("Could not read block metadata: " + err);
    }

    if(event.breaking){
        blockName = blockSize > 1 ? "build4" : "build1";
    }

    postEvent({
        type: "PLACE_BLOCK",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        x: tile.x,
        y: tile.y,
        block_id: blockName,
        size: blockSize,
        breaking: event.breaking
    });
}

function applyRelayEvent(packet){
    if(packet.type === "CHAT_MESSAGE"){
        if(Vars.ui && Vars.ui.chatfrag){
            Vars.ui.chatfrag.addMessage(
                "[#55FF55][MSE][" + packet.game + "] [white]<" + packet.player + "> " + packet.message
            );
        }
        return;
    }

    if(packet.type === "MINDUSTRY_SET_BLOCK"){
        const x = Number(packet.x);
        const y = Number(packet.y);
        const blockName = String(packet.block_id || "air");
        const tile = Vars.world.tile(x, y);

        if(tile == null){
            mseLog("RX block ignored: tile outside world @ " + x + "," + y);
            return;
        }

        const block = Vars.content.block(blockName);
        if(block == null){
            mseLog("RX block ignored: unknown Mindustry block " + blockName);
            return;
        }

        Core.app.post(run(() => {
            tile.setNet(block, Team.sharded, 0);
            mseLog("RX applied " + blockName + " @ " + x + "," + y);
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
                    for(let i = 0; i < data.events.length; i++){
                        applyRelayEvent(data.events[i]);
                    }
                }
            }catch(err){
                Log.err("[MSE-MINDUSTRY] Poll parse/apply ERROR: " + err);
            }
        }));
}

Events.on(EventType.ClientLoadEvent, cons(event => {
    mseLog("BOOT OK - Mindustry Bridge " + bridgeVersion);
    try{
        Vars.ui.showInfoToast("[accent]Multi-Sandbox Engine[]\n[lightgray]" + bridgeVersion + "[]", 5);
    }catch(err){}

    // HTTP compatibility transport: poll Relay twice per second for inbound MSE events.
    Timer.schedule(run(() => pollRelay()), 0.5, 0.5);
}));

Events.on(EventType.BlockBuildEndEvent, cons(event => {
    sendBlockEvent(event);
}));

// ClientChatEvent fires only for chat sent by this local Mindustry client.
Events.on(EventType.ClientChatEvent, cons(event => {
    let playerName = "MindustryPlayer";
    try{
        if(Vars.player != null && Vars.player.name != null) playerName = Vars.player.name;
    }catch(err){}

    postEvent({
        type: "CHAT_MESSAGE",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        player: playerName,
        message: event.message
    });
}));

mseLog("main.js parsed - " + bridgeVersion);
