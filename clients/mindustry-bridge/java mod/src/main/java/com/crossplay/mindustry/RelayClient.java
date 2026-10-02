package com.crossplay.network;

import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;
import org.json.JSONObject;

import java.net.URI;

public class RelayClient extends WebSocketClient {
    private final String gameName;
    private final PacketListener listener;

    public interface PacketListener {
        void onPacketReceived(JSONObject json);
    }

    public RelayClient(URI serverUri, String gameName, PacketListener listener) {
        super(serverUri);
        this.gameName = gameName;
        this.listener = listener;
    }

    private void log(String message) {
        System.out.println("[MSE-" + gameName + "] " + message);
    }

    @Override
    public void onOpen(ServerHandshake handshakedata) {
        log("WebSocket OPEN");
        JSONObject handshake = new JSONObject();
        handshake.put("type", "CONNECT");
        handshake.put("game", gameName);
        log("TX " + handshake);
        send(handshake.toString());
    }

    @Override
    public void onMessage(String message) {
        log("RX RAW " + message);
        try {
            JSONObject packet = new JSONObject(message);
            if (listener != null) {
                listener.onPacketReceived(packet);
            } else {
                log("RX packet has no listener: " + packet.optString("type", "UNKNOWN"));
            }
        } catch (Exception e) {
            System.err.println("[MSE-" + gameName + "] RX ERROR " + e.getMessage());
        }
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        log("WebSocket CLOSE code=" + code + " remote=" + remote + " reason=" + reason);
    }

    @Override
    public void onError(Exception ex) {
        System.err.println("[MSE-" + gameName + "] WebSocket ERROR " + ex.getMessage());
    }

    public void sendBlockPlace(int x, int y, int z, String blockId, boolean isWall) {
        if (!isOpen()) {
            log("TX PLACE_BLOCK skipped: socket is not open");
            return;
        }

        JSONObject packet = new JSONObject();
        packet.put("type", "PLACE_BLOCK");
        packet.put("source_game", gameName);
        packet.put("x", x);
        packet.put("y", y);
        packet.put("z", z);
        packet.put("block_id", blockId);
        packet.put("is_wall", isWall);

        log("TX " + packet);
        send(packet.toString());
    }
}
