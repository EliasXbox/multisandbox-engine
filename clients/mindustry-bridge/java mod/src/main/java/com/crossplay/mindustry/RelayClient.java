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

    @Override
    public void onOpen(ServerHandshake handshakedata) {
        System.out.println("[MSE-Relay] Conectado ao servidor Relay com sucesso!");

        // Pacote de Handshake para se registrar no Servidor Relay
        JSONObject handshake = new JSONObject();
        handshake.put("type", "CONNECT");
        handshake.put("game", this.gameName);
        send(handshake.toString());
    }

    @Override
    public void onMessage(String message) {
        try {
            JSONObject packet = new JSONObject(message);
            if (listener != null) {
                listener.onPacketReceived(packet);
            }
        } catch (Exception e) {
            System.err.println("[MSE-Relay] Erro ao processar mensagem: " + e.getMessage());
        }
    }

    @Override
    public void onClose(int code, String reason, boolean remote) {
        System.out.println("[MSE-Relay] Conexão fechada: " + reason + ". Tentando reconectar...");
    }

    @Override
    public void onError(Exception ex) {
        System.err.println("[MSE-Relay] Erro no WebSocket: " + ex.getMessage());
    }

    /**
     * Envia um evento de bloco colocado para o Relay
     */
    public void sendBlockPlace(int x, int y, int z, String blockId, boolean isWall) {
        if (!isOpen()) return;

        JSONObject packet = new JSONObject();
        packet.put("type", "PLACE_BLOCK");
        packet.put("source_game", this.gameName);
        packet.put("x", x);
        packet.put("y", y);
        packet.put("z", z);
        packet.put("block_id", blockId);
        packet.put("is_wall", isWall);

        send(packet.toString());
    }
}