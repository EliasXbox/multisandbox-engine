class Combat {
    constructor(world, send, enqueue, convert, angle) {
        this.world = world; this.send = send; this.enqueue = enqueue;
        this.convert = convert; this.angle = angle; this.units = new Map(); this.seq = -1; this.epoch = null;
        this.lastHits = new Map();
    }
    frame(data) {
        if (this.epoch !== this.world.meta.world_epoch) { this.units.clear(); this.seq = -1; this.lastHits.clear(); this.epoch = this.world.meta.world_epoch; }
        if (!Number.isFinite(Number(data.seq)) || Number(data.seq) <= this.seq) return;
        this.seq = Number(data.seq);
        const units = [];
        this.units.clear();
        for (const raw of (data.units || []).slice(0, 512)) {
            const pos = this.convert(raw.x, raw.y);
            if (![pos.x, pos.z, raw.health_fraction].every(Number.isFinite)) continue;
            const unit = { ...raw, x: pos.x, z: pos.z, y: raw.flying ? 5 : 3,
                rotation: this.angle(raw.rotation) };
            this.units.set(unit.id, unit); units.push(unit);
        }
        this.send('MINECRAFT', { type: 'ENTITY_FRAME', units,
            minecraft_health: data.minecraft_health || [], world_epoch: this.world.meta.world_epoch });
    }
    hit(data) {
        const amount = Number(data.amount_fraction);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1) return;
        const actor = this.world.players.get('MINECRAFT:' + data.player_id);
        if (!actor) return;
        const target = this.units.get(data.target_id) || this.world.players.get(data.target_id);
        if (!target) return;
        const reach = data.attack_kind === 'projectile' ? 64 : 8;
        if (Math.hypot(target.x - actor.x, target.z - actor.z) > reach) return;
        const key = data.player_id + ':' + data.target_id;
        if (Date.now() - (this.lastHits.get(key) || 0) < 250) return;
        this.lastHits.set(key, Date.now());
        this.enqueue('MINDUSTRY', { type: 'ENTITY_DAMAGE', target_id: data.target_id,
            life_id: target.life_id, amount_fraction: amount, world_epoch: this.world.meta.world_epoch });
    }
    localHealth(data) {
        const fraction = Number(data.amount_fraction);
        const target = 'MINECRAFT:' + data.player_id;
        if (!this.world.players.has(target) || !Number.isFinite(fraction) || Math.abs(fraction) > 1) return;
        this.enqueue('MINDUSTRY', { type: 'PLAYER_HEALTH_DELTA', target_id: target,
            life_id: data.life_id, amount_fraction: fraction, world_epoch: this.world.meta.world_epoch });
    }
}
module.exports = Combat;
