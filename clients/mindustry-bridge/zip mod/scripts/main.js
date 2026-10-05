// Multi-Sandbox Engine - Mindustry JS Bridge
// DEBUG BOOT PROBE: prove that this exact ZIP/main.js is being executed.

const relayEventUrl = "http://localhost:8080/event";
const bridgeVersion = "1.1.1-debug";

function mseLog(message){
    Log.info("[MSE-MINDUSTRY] " + message);
}

function showBootProbe(){
    mseLog("BOOT OK - Mindustry Bridge " + bridgeVersion);
    mseLog("Relay endpoint: " + relayEventUrl);

    // Visible in-game probe, so testing does not depend only on the console.
    try{
        Vars.ui.showInfoToast(
            "[accent]Multi-Sandbox Engine[]\nMindustry Bridge loaded!\n[lightgray]" + bridgeVersion + "[]",
            8
        );
    }catch(err){
        Log.err("[MSE-MINDUSTRY] Could not show boot toast: " + err);
    }
}

function postEvent(packet){
    const body = JSON.stringify(packet);
    mseLog("TX " + body);

    // Arc Http.post(url, body) returns a request builder.
    // Configure callbacks on that request, then submit it.
    Http.post(relayEventUrl, body)
        .header("Content-Type", "application/json")
        .error(cons(err => {
            Log.err("[MSE-MINDUSTRY] Relay HTTP ERROR: " + err);
        }))
        .submit(new Packages.arc.func.ConsT({
            get: function(res){
                mseLog("Relay HTTP " + res.getStatus());
            }
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
    showBootProbe();
}));

Events.on(EventType.BlockBuildEndEvent, cons(event => {
    mseLog("BlockBuildEndEvent received.");
    sendBlockEvent(event);
}));

mseLog("main.js parsed - waiting for ClientLoadEvent.");
