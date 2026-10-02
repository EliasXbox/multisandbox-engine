// Exibe mensagens vindas do Minecraft no chat do Mindustry
function onMinecraftChatMessage(player, message) {
    if (Vars.ui && Vars.ui.chatfrag) {
        Vars.ui.chatfrag.addMessage("[#55FF55][Minecraft] [white]" + player + ": " + message);
    }
}