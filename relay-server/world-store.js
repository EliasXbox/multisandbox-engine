const path = require('path');

class WorldStore {
    constructor(fs, filename, exportData, onError = console.error) {
        this.fs = fs; this.filename = filename; this.exportData = exportData; this.onError = onError;
        this.timer = null; this.writing = false; this.dirty = false; this.closed = false;
    }

    markDirty() {
        // The legacy test harness supplies a tiny, synchronous in-memory filesystem.
        if (!this.fs.promises) {
            this.fs.mkdirSync(path.dirname(this.filename), { recursive: true });
            this.fs.writeFileSync(this.filename + '.tmp', JSON.stringify(this.exportData()));
            this.fs.renameSync(this.filename + '.tmp', this.filename);
            return;
        }
        this.dirty = true;
        if (this.timer || this.writing || this.closed) return;
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 2000);
    }

    flush() {
        if (this.writing) return this.currentWrite;
        if (!this.dirty) return Promise.resolve();
        this.currentWrite = this.write();
        return this.currentWrite;
    }

    async write() {
        this.writing = true; this.dirty = false;
        try {
            const data = this.exportData();
            await this.fs.promises.mkdir(path.dirname(this.filename), { recursive: true });
            const file = await this.fs.promises.open(this.filename + '.tmp', 'w');
            try {
                const { objects, ...header } = data;
                await file.writeFile(JSON.stringify(header).slice(0, -1) + ',"objects":[');
                for (let i = 0; i < objects.length; i += 256) {
                    const chunk = objects.slice(i, i + 256).map(object => JSON.stringify(object)).join(',');
                    await file.writeFile((i ? ',' : '') + chunk);
                    await new Promise(resolve => setImmediate(resolve));
                }
                await file.writeFile(']}');
            } finally { await file.close(); }
            await this.fs.promises.rename(this.filename + '.tmp', this.filename);
        } catch (err) { this.dirty = true; this.onError('[MSE] World save failed: ' + err.message); }
        finally { this.writing = false; if (this.dirty) this.markDirty(); }
    }

    async close() {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        if (this.writing) await this.currentWrite;
        if (this.dirty) await this.flush();
    }
}
module.exports = WorldStore;
