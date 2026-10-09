# Installing MSE 1.3.0

This tutorial covers the default setup: Mindustry, the Minecraft server and the Relay run on **the same computer**. Minecraft players connect to that Purpur server. The bridge endpoints currently use `localhost:8080`; a distributed setup requires changing the bridge endpoints and is not configured by this tutorial.

## 1. Download the matching components

Open the [v1.3.0 release](https://github.com/EliasXbox/multisandbox-engine/releases/tag/v1.3.0) and download:

- `multisandboxengine-minecraft-1.3.0.jar`
- `multisandbox-engine-mindustry-1.3.0.zip`
- `mse-relay-server-1.3.0.zip`
- Optionally, `SHA256SUMS.txt` to verify downloaded files.

Use Minecraft Java **1.20.1**, a Purpur server for **1.20.1**, Mindustry **160.4**, Java **17 or newer** and Node.js. The tested Relay runtime was Node.js **24.19.0**. The Mindustry mod requires game build 160 or newer; newer builds are not covered by the 160.4 catalog test.

If upgrading, first stop Minecraft/Purpur, Mindustry and the Relay. Back up both game saves, the Minecraft plugin's data directory and the Relay's `data/` directory. Keep the plugin data when replacing its JAR: it tracks synced cells and pending transfers. Keep the same Relay data when upgrading the matching session.

## 2. Create a completely empty Minecraft world

**World Sync needs a 100% void primary world.** Use a dedicated Purpur server. Do not point it at a Minecraft world you want to keep playing normally.

On a new server, after accepting Minecraft's EULA yourself and generating `server.properties`, stop the server and set:

```properties
level-name=mse-world
level-type=minecraft:flat
generator-settings={"biome":"minecraft:the_void","layers":[],"structures":{}}
generate-structures=false
spawn-protection=0
gamemode=survival
```

Choose a **new, unused `level-name`**. Changing the generator settings does not erase terrain in a previously generated world. Preserve old world folders; do not delete them to follow this tutorial. The plugin operates on the server's primary world, so keep this server dedicated to MSE.

Place `multisandboxengine-minecraft-1.3.0.jar` in Purpur's `plugins/` directory. Remove an older MSE JAR from the active `plugins/` directory by moving it to your backup folder; only one version should load. Start Purpur with Java. For a machine with 8 GB RAM running both games, the existing test setup used a 2 GB server heap, view distance 4 and simulation distance 3; allow room for the games and Windows.

## 3. Install the Mindustry mod

In Mindustry, open **Mods → Import Mod** and choose `multisandbox-engine-mindustry-1.3.0.zip`, or put the ZIP in Mindustry's mods directory. Keep the ZIP intact. Move duplicate older MSE mods to your backup folder, then restart Mindustry.

Check that the mod shows **1.3.0** and the startup notification mentions **Survival Foundation Update**. The Mindustry instance loading the map must run the mod and own the simulation; simply adding the mod to a client connected to an unmodified remote host is not this setup.

## 4. Start the Relay

Extract `mse-relay-server-1.3.0.zip`. Open a terminal in its `relay-server/` directory and run:

```console
npm install
npm start
```

Keep that terminal open. On Windows, `StartRelay.bat` can start it after dependencies have been installed. The Relay listens on port **8080**; `http://localhost:8080/health` shows its state summary. Use `npm start` for play sessions; `npm run dev` is for development and restarts when files change.

## 5. Play

1. Start the Relay, then Purpur and Mindustry with their matching components.
2. Load a Mindustry map or campaign sector on the modded local host.
3. In Minecraft Multiplayer, connect to `localhost:25565` (or your configured Purpur port).
4. Wait for **Core area ready**. The core area is released first, while the rest of a large map continues loading.
5. Open the [Survival guide](survival-foundation.md) for gathering resources, crafting and helping through a core.

When changing Mindustry maps, MSE clears the tracked old map before reconstructing the new one. Do not start building during the transition. For a component upgrade, stop everything before replacing files.

## If a bridge does not connect

- Confirm all three components are v1.3.0 and the Mindustry startup notification appeared.
- Confirm the Relay terminal is still running and `/health` opens locally.
- Check that another process is not using port 8080 and that only one Relay is running.
- Check Purpur's log for the MSE plugin loading and its Relay connection; check Mindustry's log for `BOOT OK` and any `Relay HTTP ERROR` / `Poll ERROR`.
- If the world is incomplete, wait for reconstruction; large maps continue after the core becomes playable. Confirm the primary Minecraft world was void before the first sync.
- Keep disk space available for saves and backups. Preserve logs when reporting a problem, but remove private information before posting them publicly.
