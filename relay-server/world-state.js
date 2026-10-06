class WorldState {
    constructor() {
        this.objects = new Map();
        this.cells = new Map();
        this.players = new Map();
        this.revision = 0;
        this.nextObjectId = 1;
        this.snapshot = null;
        this.meta = { width: null, height: null, authority: null };
    }

    cellKey(x, z, layer = "block") {
        return `${layer}:${Number(x)}:${Number(z)}`;
    }

    nextRevision() {
        this.revision += 1;
        return this.revision;
    }

    createObject(spec) {
        const volume = spec.volume || { x: 1, z: 1, y: 1 };
        const object = {
            id: spec.id || `obj-${this.nextObjectId++}`,
            kind: spec.kind || "block",
            layer: spec.layer || "block",
            mindustry: spec.mindustry || null,
            minecraft: spec.minecraft || null,
            origin: { x: Number(spec.x), z: Number(spec.z), y: Number(spec.y || 1) },
            volume: { x: Number(volume.x || 1), z: Number(volume.z || 1), y: Number(volume.y || 1) },
            rotation: Number(spec.rotation || 0),
            source_game: spec.source_game || "UNKNOWN",
            revision: this.nextRevision()
        };

        const overlaps = new Set();
        for (let dx = 0; dx < object.volume.x; dx++) {
            for (let dz = 0; dz < object.volume.z; dz++) {
                const existingId = this.cells.get(this.cellKey(object.origin.x + dx, object.origin.z + dz, object.layer));
                if (existingId) overlaps.add(existingId);
            }
        }
        for (const existingId of overlaps) this.removeObject(existingId);

        this.objects.set(object.id, object);
        for (let dx = 0; dx < object.volume.x; dx++) {
            for (let dz = 0; dz < object.volume.z; dz++) {
                this.cells.set(this.cellKey(object.origin.x + dx, object.origin.z + dz, object.layer), object.id);
            }
        }
        return object;
    }

    findAt(x, z, layer = "block") {
        const id = this.cells.get(this.cellKey(x, z, layer));
        return id ? this.objects.get(id) || null : null;
    }

    removeObject(id) {
        const object = this.objects.get(id);
        if (!object) return null;
        for (let dx = 0; dx < object.volume.x; dx++) {
            for (let dz = 0; dz < object.volume.z; dz++) {
                const key = this.cellKey(object.origin.x + dx, object.origin.z + dz, object.layer);
                if (this.cells.get(key) === id) this.cells.delete(key);
            }
        }
        this.objects.delete(id);
        object.revision = this.nextRevision();
        return object;
    }

    removeAt(x, z, layer = "block") {
        const object = this.findAt(x, z, layer);
        return object ? this.removeObject(object.id) : null;
    }

    beginSnapshot(meta = {}) {
        this.snapshot = { objects: [], meta, startedAt: Date.now() };
    }

    appendSnapshot(objects = []) {
        if (!this.snapshot) throw new Error("snapshot_not_started");
        this.snapshot.objects.push(...objects);
    }

    commitSnapshot() {
        if (!this.snapshot) throw new Error("snapshot_not_started");
        const pending = this.snapshot;
        this.snapshot = null;
        this.objects.clear();
        this.cells.clear();
        this.nextObjectId = 1;
        this.meta = { ...this.meta, ...pending.meta };
        const created = pending.objects.map(obj => this.createObject(obj));
        return { revision: this.revision, objects: created, meta: this.meta };
    }

    setPlayer(player) {
        const normalized = {
            id: String(player.id),
            source_game: String(player.source_game || "UNKNOWN").toUpperCase(),
            name: player.name || "Player",
            x: Number(player.x || 0),
            z: Number(player.z || 0),
            y: Number(player.y == null ? 5 : player.y),
            rotation: Number(player.rotation || 0),
            connected: player.connected !== false,
            updated_at: Date.now()
        };
        this.players.set(normalized.id, normalized);
        return normalized;
    }

    removePlayer(id) {
        const player = this.players.get(String(id)) || null;
        this.players.delete(String(id));
        return player;
    }

    exportData() {
        return {
            revision: this.revision,
            nextObjectId: this.nextObjectId,
            meta: this.meta,
            objects: Array.from(this.objects.values())
        };
    }

    loadData(data = {}) {
        this.objects.clear();
        this.cells.clear();
        this.players.clear();
        this.revision = Number(data.revision || 0);
        this.nextObjectId = Number(data.nextObjectId || 1);
        this.meta = { ...this.meta, ...(data.meta || {}) };

        for (const object of (data.objects || [])) {
            this.objects.set(object.id, object);
            for (let dx = 0; dx < object.volume.x; dx++) {
                for (let dz = 0; dz < object.volume.z; dz++) {
                    this.cells.set(this.cellKey(object.origin.x + dx, object.origin.z + dz, object.layer || "block"), object.id);
                }
            }
        }
    }

    summary() {
        return {
            revision: this.revision,
            objects: this.objects.size,
            players: this.players.size,
            snapshotInProgress: !!this.snapshot,
            meta: this.meta
        };
    }
}

module.exports = WorldState;
