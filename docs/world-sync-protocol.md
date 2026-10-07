# MSE World Sync Protocol (experimental)

This document describes the first canonical-world implementation used by the Minecraft ↔ Mindustry bridge.

## Core model

The Relay owns a canonical World State. A multi-tile or volumetric structure is one semantic object with an origin and an `X × Z × Y` volume. Adapter-rendered cells are not independent MSE objects.

Each object contains:

- `id`: session/persistence object ID.
- `kind`: currently `block`; designed to expand.
- `layer`: `block` today; `floor` and `overlay` are reserved for terrain/ore mappings.
- `mindustry` / `minecraft`: adapter representations.
- `origin {x,z,y}`.
- `volume {x,z,y}`.
- `rotation`.
- `revision`.

The Relay maintains an ownership index from occupied X/Z cells to the semantic object. Breaking any occupied cell can therefore remove the complete object.

## Snapshot lifecycle

Mindustry is the provisional world authority for the current MVP.

1. `WORLD_SNAPSHOT_BEGIN` announces snapshot ID and map dimensions.
2. One or more `WORLD_SNAPSHOT_CHUNK` packets carry semantic objects.
3. `WORLD_SNAPSHOT_END` commits the snapshot.
4. Incremental block changes that arrive during a snapshot are deferred and replayed after commit.
5. The Relay sends `WORLD_SNAPSHOT_BEGIN`, rendered object cells, then `WORLD_SNAPSHOT_END` to Minecraft.

Mindustry sends chunks sequentially so HTTP completion order cannot commit an incomplete snapshot.

## Incremental updates

- `PLACE_BLOCK`: creates/replaces a semantic object.
- `BREAK_BLOCK`: removes the object occupying the requested cell.
- Mindustry break events also remove by ownership lookup instead of guessing a 2D deletion size.

The Relay persists canonical objects to `relay-server/data/world-state.json`. Runtime player proxies are intentionally transient.

## Coordinates

Canonical order is `X × Z × Y`.

Minecraft uses X/Z directly and MSE Y as an absolute rendering coordinate. The temporary `logical Y + 1` adapter offset has been retired.

The default Mindustry surface is rendered at Minecraft Y=2. Y=0 is not a floor or world boundary: Y=0 and negative Y remain valid MSE/Minecraft space reserved for future underground gameplay. The Minecraft target world for an authoritative Mindustry snapshot should therefore start empty; the Relay reconstructs the synchronized terrain instead of layering it over a superflat preset.

Mindustry uses its tile X/Y plane as MSE X/Z through the transform in `relay-server/config/world-sync.json`. `flip_x`, `flip_z`, `offset_x`, and `offset_z` exist so calibration maps can fix mirroring without changing protocol code.

### Terrain and fluid rendering rules

World State semantics determine whether an object is a `floor`, `overlay`, or `block`/wall. Minecraft materials do not have to be unique between layers: for example, a Stone floor and Stone wall may both render with `minecraft:stone` while remaining distinct semantic objects.

The initial Minecraft terrain convention is:

- normal surface/floor: Y=2;
- shallow fluid: fluid at Y=2, supporting/variant bed at Y=1;
- deep fluid: fluid at Y=2 and Y=1, supporting/variant bed at Y=0;
- Y<0: valid space, currently left empty/reserved.

The canonical state keeps the original terrain/fluid identity even when multiple Mindustry variants share the same visible Minecraft fluid material. This lets an adapter restore the correct underlying terrain later.

## Player proxy base

`PLAYER_STATE` contains player identity, source game, X/Z, logical Y and rotation. `PLAYER_DESPAWN` removes a proxy.

Current experimental representations:

- Mindustry player → Minecraft Phantom proxy with AI/gravity/collision disabled.
- Minecraft player → visual-only Dagger sprite in Mindustry; no real Mindustry Unit is spawned.

This is presence/position visualization only. Combat, health, inventory and interaction are outside this first proxy implementation.

## Mapping expansion

The registry remains the source of truth for reversible block mappings. World Sync is designed for additional `floor` and `overlay` entries so Mindustry floors, walls and ore overlays do not need to be flattened into one block layer.
