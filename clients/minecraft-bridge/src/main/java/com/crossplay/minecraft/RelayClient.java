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
        try {
            JSONObject packet = new JSONObject(message);
            String type = packet.optString("type");
            if (!"MC_SET_BLOCK".equals(type) && !"PLAYER_STATE".equals(type)) log("RX " + packet);
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

    public void sendChatMessage(String player, String message) {
        if (!isOpen() || message == null || message.trim().isEmpty()) return;

        JSONObject packet = new JSONObject();
        packet.put("type", "CHAT_MESSAGE");
        packet.put("source_game", gameName);
        packet.put("game", gameName);
        packet.put("player", player);
        packet.put("message", message);

        log("TX CHAT_MESSAGE <" + player + "> " + message);
        send(packet.toString());
    }

    public void sendBlockBreak(int x, int y, int z) {
        if (!isOpen()) return;
        JSONObject packet = new JSONObject();
        packet.put("type", "BREAK_BLOCK");
        packet.put("source_game", gameName);
        packet.put("game", gameName);
        packet.put("x", x);
        packet.put("y", y);
        packet.put("z", z);
        log("TX " + packet);
        send(packet.toString());
    }

    public void sendPlayerState(String playerId, String playerName, double x, double z, double mseY, float rotation) {
        if (!isOpen()) return;
        JSONObject packet = new JSONObject();
        packet.put("type", "PLAYER_STATE");
        packet.put("source_game", gameName);
        packet.put("game", gameName);
        packet.put("player_id", playerId);
        packet.put("player", playerName);
        packet.put("x", x);
        packet.put("z", z);
        packet.put("mse_y", mseY);
        packet.put("rotation", rotation);
        send(packet.toString());
    }

    public void sendPlayerDespawn(String playerId, String playerName) {
        if (!isOpen()) return;
        JSONObject packet = new JSONObject();
        packet.put("type", "PLAYER_DESPAWN");
        packet.put("source_game", gameName);
        packet.put("game", gameName);
        packet.put("player_id", playerId);
        packet.put("player", playerName);
        send(packet.toString());
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
