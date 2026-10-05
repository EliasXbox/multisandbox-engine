// Multi-Sandbox Engine - Mindustry JS Bridge
// Current transport: Mindustry -> Relay via HTTP POST /event.
// Minecraft receives translated events from the Relay over WebSocket.

const relayEventUrl = "http://localhost:8080/event";

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function postEvent(packet){
    const body = JSON.stringify(packet);
    mseLog("TX " + body);

    Http.post(relayEventUrl, body, res => {
        mseLog("Relay HTTP " + res.getStatus());
    }, err => {
        Log.err("[MSE-MINDUSTRY] Relay HTTP ERROR: " + err);
    });
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

    // build1/build4 are deletion markers understood by the Relay.
    // Keep the current convention while the mapping protocol is still experimental.
    if(event.breaking){
        blockName = blockSize > 1 ? "build4" : "build1";
    }

    postEvent({
        type: "PLACE_BLOCK",
        action: "PLACE_BLOCK",
        game: "MINDUSTRY",
        source_game: "MINDUSTRY",
        x: tile.x,
        y: tile.y,
        z: 64,
        block: blockName,
        block_id: blockName,
        size: blockSize,
        breaking: event.breaking
    });
}

Events.on(EventType.ClientLoadEvent, cons(event => {
    mseLog("JS bridge loaded. Relay endpoint: " + relayEventUrl);
}));

Events.on(EventType.BlockBuildEndEvent, cons(event => {
    sendBlockEvent(event);
}));

mseLog("Script initialized.");
