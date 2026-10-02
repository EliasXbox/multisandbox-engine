package com.crossplay.minecraft.listeners;

import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.AsyncPlayerChatEvent;
import org.json.JSONObject;
import com.crossplay.minecraft.network.WebSocketClientManager; // Adapte para sua classe de WebSocket

public class ChatListener implements Listener {

    private final WebSocketClientManager wsManager;

    public ChatListener(WebSocketClientManager wsManager) {
        this.wsManager = wsManager;
    }

    @EventHandler
    public void onPlayerChat(AsyncPlayerChatEvent event) {
        String player = event.getPlayer().getName();
        String message = event.getMessage();

        JSONObject json = new JSONObject();
        json.put("type", "CHAT_MESSAGE");
        json.put("game", "MINECRAFT");
        json.put("player", player);
        json.put("message", message);

        if (wsManager != null && wsManager.isConnected()) {
            wsManager.sendMessage(json.toString());
        }
    }
}