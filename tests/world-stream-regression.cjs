const assert = require('node:assert/strict');
const Stream = require('../relay-server/minecraft-stream');
const sent = [], jobs = [];
const socket = { readyState: 1, send(text) { sent.push(JSON.parse(text)); } };
const stream = new Stream(socket, { schedule: fn => jobs.push(fn) });
let generated = 0;
function* hugeMap() {
    yield { type: 'WORLD_SNAPSHOT_BEGIN' };
    for (let i = 0; i < 1_000_000; i++) {
        generated++;
        yield { type: 'MC_SET_BLOCK', x: i, y: 2, z: 0, revision: 1 };
    }
    yield { type: 'WORLD_SNAPSHOT_END' };
}
const drain = () => { while (jobs.length) jobs.shift()(); };
const lastBatch = () => sent.findLast(p => p.type === 'WORLD_BLOCK_BATCH');
stream.start(hugeMap()); drain();
assert.equal(sent.length, 2, 'only reset plus one batch sent');
assert.equal(generated, 255, 'million-cell snapshot stays lazy');
assert.equal(stream.stats.peakPending, 256);
drain(); assert.equal(sent.length, 2, 'wait for application ACK, not socket buffering');
stream.enqueue({ type: 'MC_SET_BLOCK', x: 9, y: 3, z: 9, revision: 2, block_id: 'minecraft:stone_slab' });
stream.enqueue({ type: 'MC_SET_BLOCK', x: 9, y: 3, z: 9, revision: 3, block_id: 'minecraft:air' });
assert.equal(stream.deltas.size, 1, 'same-cell deltas coalesce');
stream.ack(stream.streamId, -1); drain(); assert.equal(sent.length, 2, 'invalid ACK rejected');
stream.ack(stream.streamId, lastBatch().batch_id); drain();
assert.equal(lastBatch().packets[0].block_id, 'minecraft:air', 'latest edit bypasses bulk map');
const obsolete = { stream_id: stream.streamId, batch_id: lastBatch().batch_id };
stream.start((function* () { yield { type: 'WORLD_SNAPSHOT_BEGIN' }; yield { type: 'WORLD_SNAPSHOT_END' }; })()); drain();
const newBatch = lastBatch();
stream.ack(obsolete.stream_id, obsolete.batch_id); drain();
assert.equal(stream.pending.id, newBatch.batch_id, 'old transfer cannot acknowledge replacement');
stream.ack(stream.streamId, newBatch.batch_id); drain();
assert.equal(stream.pending, null);
stream.close(); assert.equal(stream.deltas.size, 0); assert.equal(stream.snapshot, null);
const windowJobs=[],windowSent=[];
const pipelined=new Stream({readyState:1,send(raw){windowSent.push(JSON.parse(raw));}},
    {maxInflight:3,schedule(job){windowJobs.push(job);}});
const drainWindow=()=>{while(windowJobs.length)windowJobs.shift()();};
pipelined.start(hugeMap());drainWindow();
assert.equal(pipelined.inflight.size,3,'pipeline never exceeds three batches');
assert.equal(windowSent.filter(p=>p.type==='WORLD_BLOCK_BATCH').reduce((sum,p)=>sum+p.packets.length+1,0),771,'Minecraft queue bound includes ACK markers');
const oldId=pipelined.streamId,first=windowSent[1].batch_id;
pipelined.ack(oldId,first);drainWindow();assert.equal(pipelined.inflight.size,3);
pipelined.start((function*(){yield{type:'WORLD_SNAPSHOT_BEGIN'};yield{type:'WORLD_SNAPSHOT_END'};})());drainWindow();
pipelined.ack(oldId,first+1);assert.equal(pipelined.inflight.size,1,'stale pipeline ACK cannot release replacement map');pipelined.close();
console.log('PASS: million-cell lazy snapshot; 256-cell bound; ACK flow control; priority/coalesced edits; cancellation and stale ACKs.');
