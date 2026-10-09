# Multi-Sandbox Engine (MSE)

> An experimental cross-game engine for sandbox games.

Multi-Sandbox Engine connects games through a central Relay and game-specific bridges. The goal is a shared crossplay session: each game represents the same world, players and actions through its own visuals and controls. **Minecraft and Mindustry are the first integration.** More games and a Host/Client session interface are planned.

**Current release: [v1.3.0 — Survival Foundation Update](https://github.com/EliasXbox/multisandbox-engine/releases/tag/v1.3.0).** Play Minecraft Survival inside a reconstructed Mindustry map, gather resources, craft buildings, help the Mindustry player and fight alongside them. The creator tested the development build for approximately an hour across Serpulo and Erekir. The final English release adds two Erekir progression recipes, verified separately by automated tests.

**[Installation tutorial](docs/installation.md) · [Survival guide](docs/survival-foundation.md) · [Release notes](docs/releases/v1.3.0.md)**

> **Online multiplayer status:** v1.3.0 was tested with the Mindustry host, Purpur server and Relay on the same computer. Sessions with friends over the Internet or a VPN, multiple Mindustry players and components running on separate computers **have not been validated**. Do not treat this release as confirmed support for those setups. See [Playing with friends / online multiplayer](#playing-with-friends--online-multiplayer).

## What works

- World reconstruction for **Serpulo and Erekir**: floors, ore overlays, liquids, natural walls and buildings.
- Two-way building placement and destruction, including complete multi-tile volumes. One recovered **[MSE]** item represents the whole structure.
- Representations and workshop recipes for **all 245 survival-buildable structures in Mindustry 160.4**, with native horizontal footprints and resource costs. Visual models are Minecraft block approximations.
- Renewable resource deposits, pickaxe progression, adapted processing recipes and quick recipes for common buildings.
- Shared player/unit health and combat: melee, bow projectiles and Minecraft armor reduction. Mindustry controls its units, deaths and respawns.
- Item withdrawal/deposit through cores and other item-holding buildings, with confirmed transfers and retry protection.
- Item filters for sorters/unloaders, and links for supported power nodes, mass drivers and traditional bridges.
- Directional stair conveyors, interpolated player proxies and cross-game chat.
- Bounded map streaming, a core area that becomes playable first, asynchronous state saves and cleanup when changing maps.
- Recoverable manufactured walls and **26 natural wall types**. Sneak while breaking an ore-bearing wall to recover the whole wall instead of mining its resource.
- English MSE menus, item labels and messages. The games' own language settings remain independent.

## Erekir Survival progression

| Recipe | Result | Where |
| --- | --- | --- |
| 4 beryllium (emeralds) | 4 oak planks | Crafting grid or MSE Workshop |
| 4 graphite (charcoal) | 1 iron ingot | Crafting grid or MSE Workshop |
| 4 scrap or 4 spore pods | 4 oak planks | Crafting grid |

Graphite deposits can be gathered with a wooden pickaxe. These are gameplay adaptations: Erekir players can make tools without depending on Serpulo's scrap and lead. A core's inventory menu opens the workshop, so an existing crafting table is not needed to make the first planks.

## Installation essentials

The tested setup uses **Minecraft Java 1.20.1 with Purpur, Mindustry 160.4, Java 17 or newer and Node.js** (Relay tested with Node.js 24.19.0). The current bridges connect to a Relay on `localhost:8080`; run them on the same computer for the default setup. Use all three v1.3.0 components together.

**The Purpur server's primary world must be 100% empty and dedicated to MSE.** Existing Minecraft terrain conflicts with map reconstruction. Back up saves and stop the games/Relay before replacing components. Follow the [tutorial](docs/installation.md) to create a new void world without deleting an existing save.

Mindustry is the world authority. Load a map in the Mindustry instance running the mod, then join Minecraft and wait for **Core area ready**. The rest of a large map can continue loading in the background.

## Playing with friends / online multiplayer

**Online multiplayer with friends is experimental and has not been validated for v1.3.0.** The published gameplay tests cover a local Minecraft–Mindustry session, not a complete multiplayer session over the Internet. In particular, multiple Mindustry players and their cross-game proxies, shared health and inventory interactions still need multiplayer testing.

The default architecture keeps the Mindustry host, Purpur server and Relay on one computer, where the bridges use `localhost:8080`. A remote Minecraft player would connect to the host's reachable server address rather than `localhost:25565`. A VPN can provide a private network path between friends, but **it does not validate MSE's multiplayer behavior** and is not an inherent requirement of the engine.

Running a bridge on another computer requires changing its Relay endpoint; the current endpoints are hardcoded. This release does not provide a tested distributed-setup tutorial. If you experiment with an online or VPN session, back up saves and report your setup and results rather than assuming full multiplayer compatibility.

## Campaign compatibility

Campaign / story mode is **partially compatible** on Serpulo and Erekir. The creator completed Ground Zero while testing and also played Erekir. Mindustry still owns objectives, research, waves and sector progression; MSE does not reproduce every campaign interface or specialized building control in Minecraft. Logic editors, full unit-factory controls, payload interfaces and other specialized controls remain outside this release's Minecraft menus.

This remains an experimental project. Transfer journals protect ordinary retries and reconnects; they cannot make independent game save files a single atomic transaction after an operating-system failure.

## World Sync demonstrations

These promotional excerpts show the earlier World Sync milestone; they are retained as demonstrations of the project's world reconstruction. Survival Foundation extends it with the features above.

| Campaign test | World Sync test | World Sync test |
| --- | --- | --- |
| [![Campaign test](docs/media/world-sync-demo-1.jpg)](docs/media/world-sync-demo-1.mp4) | [![World Sync test 2](docs/media/world-sync-demo-2.jpg)](docs/media/world-sync-demo-2.mp4) | [![World Sync test 3](docs/media/world-sync-demo-3.jpg)](docs/media/world-sync-demo-3.mp4) |

## Project layout

- `relay-server/`: Relay, canonical world state, mapping registry and gameplay routing.
- `clients/minecraft-bridge/`: Minecraft/Purpur plugin.
- `clients/mindustry-bridge/zip mod/`: current Mindustry JavaScript mod.
- `clients/mindustry-bridge/java mod/`: historical implementation.
- `docs/`: installation, gameplay, protocol, release notes and demonstrations.
- `tests/`: isolated regression checks; no live saves are used.
- `tools/`: registry generation and packaging helpers.

Build the Minecraft plugin with `mvn -f clients/minecraft-bridge/pom.xml package`. Package the Mindustry mod with `tools/package-mindustry.ps1` on Windows, or zip `mod.json` and `scripts/main.js` with forward-slash entry names. Release downloads contain ready-to-use packages.
