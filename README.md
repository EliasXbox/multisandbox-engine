# Multi-Sandbox Engine (MSE)

**Branch:** `main` — stable development baseline / released milestones

> Experimental cross-game synchronization layer for sandbox games.

Multi-Sandbox Engine is an experimental project that connects different sandbox games through a central Relay Server and game-specific bridges. The long-term goal is to let players in different games share the same crossplay session while each game translates the shared state into something it understands.

## First Functional Milestone

**v1.1.1-beta — First "Functional Release"**

The first end-to-end gameplay path is now working:

```text
Mindustry
   |
   | block event (HTTP)
   v
MSE Relay Server
   |
   | translated MC_SET_BLOCK (WebSocket)
   v
Minecraft 1.20.1 / Purpur
```

This release is intentionally called "functional" in quotes: synchronization is currently one-way, many blocks are not mapped yet, and several planned crossplay systems are still missing.

## Current Game Support

| Game | Bridge | Status |
| --- | --- | --- |
| Minecraft 1.20.1 | Purpur server plugin | Working receiver / WebSocket client |
| Mindustry | JavaScript ZIP mod | Working sender / HTTP events |
| Mindustry Java mod | Java mod | **OUTDATED — reference only** |

## What Works Today

- Mindustry block placement events can reach the Relay.
- The Relay translates supported Mindustry blocks to Minecraft blocks.
- Minecraft receives Relay packets through a persistent WebSocket connection and changes the world.
- Conveyor-family mappings can currently be represented as Minecraft hoppers.
- Mindustry block deletion uses the experimental `build1` / `build4` deletion markers.

## Not Implemented Yet

- Minecraft -> Mindustry block synchronization.
- Complete block mappings and richer multi-block representations.
- Crossplay chat in the current functional build.
- Visible cross-game players.
- Mobs/entities.
- Shared items, inventories and crafting.
- Host/client session UI and configurable Relay address.

## Architecture

```text
                  +------------------+
                  | MSE Relay Server |
                  +--------+---------+
                           |
             +-------------+-------------+
             |                           |
          HTTP events                WebSocket
             |                           |
   +---------+---------+       +---------+---------+
   | Mindustry JS Mod |       | Minecraft Plugin |
   +-------------------+       +-------------------+
```

The Relay is responsible for routing and translation. Each game bridge is responsible for reading its own game state and applying MSE events in a game-appropriate way.

The current transport is intentionally asymmetric while the MVP is being developed. A future protocol may use persistent connections on both sides.

## Repository Layout

```text
multisandbox-engine/
|-- relay-server/                 # Central Relay
|-- clients/
|   |-- minecraft-bridge/         # Current Minecraft/Purpur bridge
|   |-- mindustry-bridge/
|       |-- zip mod/              # CURRENT Mindustry bridge
|       |-- java mod/             # OUTDATED / historical implementation
|-- README.md
```

## Running the Current Prototype

1. Start the MSE Relay Server on port `8080`.
2. Start the Minecraft 1.20.1 Purpur server with the MSE Minecraft plugin installed.
3. Confirm that the Minecraft bridge connects and registers with the Relay.
4. Install/enable the current MSE JavaScript ZIP mod in Mindustry.
5. Enter a Mindustry map and place a currently mapped block.
6. The event should travel through the Relay and appear as its mapped representation in Minecraft.

The current Mindustry bridge targets `localhost:8080`, so this prototype expects the Relay to run on the same machine unless the bridge is modified.

## Protocol Direction Today

```text
Mindustry  ---- PLACE_BLOCK ---->  Relay  ---- MC_SET_BLOCK ---->  Minecraft
              WORKING                         WORKING

Minecraft   ---- PLACE_BLOCK ----> Relay ---- Mindustry adapter ----> Mindustry
                                                     NOT YET
```

## Roadmap

The immediate goal after v1.1.1-beta is **two-way Minecraft <-> Mindustry synchronization**. After the basic block pipeline is stable, the project can expand mappings, chat, players/entities, items and eventually a Host/Client session system.

A future Host/Client interface is planned to reuse the player's identity from the game itself and only require connection/session information such as the Relay address. Other sandbox games can be added through their own adapters over time.

## Development Status

MSE is **early experimental software**. Protocols, mappings, file structure and bridge implementations may change between builds. Expect bugs, incomplete mappings and compatibility breaks.

The v1.1.1-beta release is the first known working baseline for Mindustry -> Relay -> Minecraft block synchronization.

## Project

Created by **EliasGX / EliasXbox**.

Contributions, experiments and testing are welcome while the architecture evolves.
