const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const WebSocket = require(require.resolve('ws', { paths: [path.join(root, 'relay-server'),
    path.resolve(root, '../../relay-server')] }));
const Stream = require('../relay-server/minecraft-stream');
const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
let latency, editStart, peak;
const watchdog = setTimeout(() => { console.error('FAIL: integration timeout'); process.exit(1); }, 10000);
server.on('connection', socket => {
    const stream = new Stream(socket);
    let editInjected = false;
    socket.on('message', raw => {
        const packet = JSON.parse(raw);
        if (packet.type === 'LATENCY_PROBE_ACK') latency = performance.now() - editStart;
        if (packet.type === 'CONNECT') {
            assert.equal(packet.world_stream, 1);
            stream.start((function* () {
                yield { type: 'WORLD_SNAPSHOT_BEGIN' };
                for (let i = 0; i < 1_000_000; i++) yield { type: 'MC_SET_BLOCK', x: i, y: 2, z: 0, revision: 1 };
                yield { type: 'WORLD_SNAPSHOT_END' };
            })());
        }
        if (packet.type === 'WORLD_BATCH_ACK') {
            if (!editInjected) {
                editInjected = true; editStart = performance.now();
                stream.enqueue({ type: 'MC_SET_BLOCK', x: 5, y: 3, z: 5, revision: 999 });
            }
            stream.ack(packet.stream_id, packet.batch_id);
        }
    });
    socket.on('close', () => { peak = stream.stats.peakPending; stream.close(); });
});
server.on('listening', () => {
    const cp = ['tests', 'clients/minecraft-bridge/target/multisandboxengine-minecraft.jar'].join(path.delimiter);
    const child = spawn('java', ['-cp', cp, 'RelayConnectionTest', `ws://127.0.0.1:${server.address().port}`], { cwd: path.resolve(__dirname, '..') });
    child.stdout.on('data', data => process.stdout.write(data));
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('exit', code => {
        clearTimeout(watchdog);
        server.close();
        assert.equal(code, 0);
        assert.equal(peak, 256);
        assert.ok(latency != null && latency < 1000, 'edit must arrive within 1 second');
        console.log(`PASS: million-cell transfer stayed bounded at 256 packets; prioritized edit round trip ${latency.toFixed(1)} ms (transport simulation, not game FPS).`);
    });
});
