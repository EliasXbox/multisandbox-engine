# World Sync Update — v1.2.0-world-sync-dev2

This is the new Minecraft ↔ Mindustry baseline tested in-game by EliasGX / EliasXbox on October 8, 2026. The creator confirmed world reconstruction, its transition, mapped blocks, multi-cell destruction and player visuals, and demonstrated partial campaign/story-mode compatibility.

## Changes

- Snapshots now include floors, ore overlays, fluids, natural walls, scenery and buildings. Previously, the scanner only collected non-air blocks and the Relay dropped content outside the small registry.
- Unmapped content retains its Mindustry identity while using provisional Minecraft visuals: common terrain has explicit materials, other floors use stone and unmapped synthetic structures use light gray concrete.
- Floors/ores render at Y=2; structures begin at Y=3. Fluids include shallow/deep beds at Y=1/Y=0. Minecraft Y is absolute; negative Y remains valid.
- Original building center tiles are retained separately from minimum volume corners. This fixes shifted footprints and incomplete removal of large structures.
- Breaking any occupied cell of a Blast Drill clears the full 4×4×3 object. Replacing a structure also clears the previous object's complete representation. Minecraft breaks outside its vertical range do not delete it.
- Mass Driver is 3×3×2 bamboo planks.
- Titanium conveyor accepts sandstone slab and smooth sandstone slab from Minecraft.
- All six core variants render as yellow terracotta: Shard/Foundation/Nucleus/Bastion/Citadel/Acropolis use footprints 3/4/5/4/5/6 and a provisional height of two blocks. Minecraft yellow terracotta defaults to Core Shard.
- Minecraft player proxies interpolate position/heading in Mindustry. HTTP polling is 100ms, requests do not overlap, and queued player updates are coalesced.
- Heading conversion handles the different Minecraft/Mindustry angle conventions and optional axis flips.
- Minecraft applies reconstruction in bounded batches with physics disabled and records its owned cells for later cleanup. High-volume packet logging is suppressed.
- Mindustry retries failed snapshots and detects Relay restarts. Minecraft retries closed WebSocket connections. Snapshot chunks must match the active authority and snapshot ID.
- Literal newline syntax errors in the Relay and Mindustry script are fixed.

## Campaign / story mode

MSE is **semi-compatible / partially compatible** with Mindustry campaign maps. The creator's campaign-sector recording demonstrates world reconstruction and the existing synchronization bridge while a campaign map is active.

Sector progression, objectives, waves/enemies, research, inventories, item logistics and power simulation are not synchronized. This is not a campaign-save transfer and has not been verified across every sector or save.

## Packages

- `dist/multisandboxengine-minecraft-world-sync-dev2.jar`
- `dist/multisandbox-engine-mindustry-worldsync-dev2.zip`

Use the JavaScript ZIP mod; the old Java mod remains historical reference only. Start Relay → Purpur → Mindustry, then open the map and wait for the snapshot to finish. Back up test worlds and keep free disk space available for saves.

## Verification

- In-game test confirmed by the project creator, including campaign-sector gameplay.
- `node tests/world-sync-regression.cjs` tests actual Relay handlers in isolation: both sandstone slabs, every Blast Drill cell, anchor round trips, replacement cleanup, Mass Driver, terrain/fluids, snapshot IDs, deferred changes, flipped coordinates, cores, cardinal headings, player coalescing, linked building scanning and interpolation.
- Mindustry script compiled with the Rhino engine bundled with installed Mindustry 160.4.
- Minecraft plugin built with cached Maven dependencies; package version and installed JAR verified.

Conveyors still use slabs; directional stairs remain future work. Terrain/ore reverse editing, inventory/resource simulation and player combat remain outside this update.
