package com.crossplay.minecraft.network;

import java.net.URI;
import org.java_websocket.client.WebSocketClient;
import org.java_websocket.handshake.ServerHandshake;

public class WebSocketClientManager {

    private WebSocketClient client;
    private final String serverUri;

    public WebSocketClientManager(String serverUri) {
        this.serverUri = serverUri;
        connect();
    }

    public void connect() {
        try {
            client = new WebSocketClient(new URI(serverUri)) {
                @Override
                public void onOpen(ServerHandshake handshakedata) {
                    System.out.println("[MSE] Conectado ao Relay WebSocket com sucesso!");
                }

                @Override
                public void onMessage(String message) {
                    // Trata mensagens recebidas do Relay
                }

                @Override
                public void onClose(int code, String reason, boolean remote) {
                    System.out.println("[MSE] Conexão WebSocket fechada: " + reason);
                }

                @Override
                public void onError(Exception ex) {
                    ex.printStackTrace();
                }
            };
            client.connect();
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public boolean isConnected() {
        return client != null && client.isOpen();
    }

    public void sendMessage(String message) {
        if (isConnected()) {
            client.send(message);
        }
    }
}