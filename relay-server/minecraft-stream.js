// A bounded window of acknowledged batches. Snapshots remain lazy.
let nextStreamId = Date.now() * 1000;
class MinecraftStream {
    constructor(socket, options = {}) {
        this.socket = socket;
        this.limit = options.batchSize || 256;
        this.window = Math.max(1, Math.min(3, options.maxInflight || 1));
        this.inflight = new Map();
        this.schedule = options.schedule || setImmediate;
        this.snapshot = null;
        this.deltas = new Map();
        this.pending = null;
        this.streamId = ++nextStreamId;
        this.nextBatch = 1;
        this.scheduled = false;
        this.closed = false;
        this.stats = { batches: 0, cells: 0, peakPending: 0 };
        this.resnapshot = options.resnapshot;
    }

    start(iterator) {
        if (this.closed) return;
        this.streamId = ++nextStreamId;
        this.snapshot = iterator;
        this.beginPending = true;
        this.deltas.clear();
        this.pending = null;
        this.inflight.clear();
        this.socket.send(JSON.stringify({ type: 'WORLD_STREAM_RESET', stream_id: this.streamId }));
        this.wake();
    }

    enqueue(packet) {
        if (this.closed) return;
        const key = `${packet.x}:${packet.y}:${packet.z}`;
        this.deltas.set(key, { ...packet, delta: true });
        // Extreme bursts rebuild from canonical state rather than accumulate indefinitely.
        if (this.deltas.size > 4096) {
            this.deltas.clear();
            if (this.resnapshot) this.resnapshot();
        }
        this.wake();
    }

    ack(streamId, batchId) {
        if (streamId !== this.streamId || !this.inflight.has(batchId)) return;
        this.inflight.delete(batchId);
        this.pending = this.inflight.values().next().value || null;
        this.wake();
    }

    wake() {
        if (this.closed || this.scheduled || this.inflight.size >= this.window) return;
        this.scheduled = true;
        this.schedule(() => { this.scheduled = false; this.pump(); });
    }

    pump() {
        if (this.closed || this.inflight.size >= this.window || this.socket.readyState !== 1) return;
        const packets = [];
        // BEGIN must precede deltas so the adapter initializes snapshot ownership first.
        if (this.snapshot && this.beginPending) {
            packets.push(this.snapshot.next().value);
            this.beginPending = false;
        }
        while (this.deltas.size && packets.length < this.limit) {
            const [key, packet] = this.deltas.entries().next().value;
            this.deltas.delete(key);
            packets.push(packet);
        }
        while (this.snapshot && packets.length < this.limit) {
            const next = this.snapshot.next();
            if (next.done) { this.snapshot = null; break; }
            packets.push(next.value);
        }
        if (!packets.length) return;
        const id = this.nextBatch++;
        this.inflight.set(id, { id });
        this.pending = this.inflight.values().next().value;
        this.stats.batches++;
        this.stats.cells += packets.length;
        this.stats.peakPending = Math.max(this.stats.peakPending, packets.length);
        try {
            this.socket.send(JSON.stringify({ type: 'WORLD_BLOCK_BATCH', stream_id: this.streamId,
                batch_id: id, packets }));
        } catch (err) { this.close(); }
        this.wake();
    }

    close() { this.closed = true; this.snapshot = null; this.deltas.clear(); this.pending = null; this.inflight.clear(); }
}
module.exports = MinecraftStream;
