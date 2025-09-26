
import fs from 'fs';
import prism from 'prism-media';
import ffmpeg from 'fluent-ffmpeg';
import tmp from 'tmp';

class Recorder {
    /**
     * options:
     *  - bufferMs: how long to keep audio (ms)
     */
    constructor(options = {}) {
        this.bufferMs = options.bufferMs || 5 * 60 * 1000;
        this.perUserBuffers = new Map();
        this.connection = null;
        this.channel = null;
        this.textChannel = null;
        this.subscribers = new Map();
        this.rawSampleRate = 48000;
        this.channels = 2;
        this.bytesPerSample = 2;
        this.maxBufferBytesEstimate = this.bufferMs / 1000 * this.rawSampleRate * this.channels * this.bytesPerSample;
    }

    async start(connection, voiceChannel, textChannel) {
        this.stop();
        this.connection = connection;
        this.channel = voiceChannel;
        this.textChannel = textChannel;

        const receiver = connection.receiver;
        receiver.speaking.on('start', (userId) => {
            this._startUserStream(userId, receiver);
        });

        receiver.speaking.on('end', () => {
            // we keep buffer; nothing to do special
        });

        // clean stale buffers periodically (optional)
        this._cleanupInterval = setInterval(() => this._garbageCollectBuffers(), 30 * 1000);
    }

    stop() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        // remove all current subscriptions
        for (const [userId, s] of this.subscribers) {
            try {
                if (s.stream && s.stream.destroy) s.stream.destroy();
            } catch {
                console.error('Failed to destroy pcm stream for user', userId);
            }
        }
        this.subscribers.clear();
        this.connection = null;
        this.channel = null;
        this.textChannel = null;
        this.perUserBuffers.clear();
    }

    status() {
        const totalUsers = this.perUserBuffers.size;
        const sizes = [...this.perUserBuffers.entries()].map(([id, arr]) => `${id}:${arr.length}`);
        return `Buffered users: ${totalUsers}\nSamples per-user: ${sizes.join(', ')}`;
    }

    _startUserStream(userId, receiver) {
        if (this.subscribers.has(userId)) return; // already subscribed

        // subscribe to opus for this user; receive Opus, decode to PCM s16le 48k stereo
        const opusStream = receiver.subscribe(userId, { end: { behavior: 'silence', duration: 100 } }); // default options
        // decode from opus to PCM
        const decoder = new prism.opus.Decoder({ frameSize: 960, channels: this.channels, rate: this.rawSampleRate });

        const pcmStream = opusStream.pipe(decoder);

        pcmStream.on('data', (chunk) => {
            // chunk is raw PCM s16le interleaved stereo at 48k
            const now = Date.now();
            if (!this.perUserBuffers.has(userId)) this.perUserBuffers.set(userId, []);
            const arr = this.perUserBuffers.get(userId);
            arr.push({ timestamp: now, chunk });
            // trim to bufferMs
            const cutoff = now - this.bufferMs;
            while (arr.length && arr[0].timestamp < cutoff) arr.shift();
            // if memory gets too big, drop oldest
            // We don't try to be exact by bytes; this is a simple protection
            if (arr.length > 0 && this._approxBufferSize(arr) > this.maxBufferBytesEstimate * 1.5) {
                while (arr.length && this._approxBufferSize(arr) > this.maxBufferBytesEstimate) arr.shift();
            }
        });

        pcmStream.on('error', (err) => {
            // ignore per-user decode errors
            console.warn('PCM stream error', err);
        });

        this.subscribers.set(userId, { stream: pcmStream, decoder, opusStream });
    }

    _approxBufferSize(arr) {
        return arr.reduce((acc, it) => acc + (it.chunk ? it.chunk.length : 0), 0);
    }

    _garbageCollectBuffers() {
        const now = Date.now();
        for (const [userId, arr] of this.perUserBuffers.entries()) {
            if (!arr.length) {
                // if there hasn't been anything for bufferMs * 2, remove entirely
                // or simpler: if last timestamp older than bufferMs*2, delete
                this.perUserBuffers.delete(userId);
            } else {
                const last = arr[arr.length - 1].timestamp;
                if (now - last > this.bufferMs * 3) this.perUserBuffers.delete(userId);
            }
        }
    }

    /**
     * Save each user's buffer to a separate audio file.
     * options:
     *   - format: 'mp3'|'wav'
     *   - usersMap: Map<userId, usernameOrTag>
     * returns: { [userId]: filePath }
     */
    async saveBuffersToFiles(options = {}) {
        const format = options.format || 'mp3';
        const usersMap = options.usersMap || new Map();
        if (this.perUserBuffers.size === 0) return null;

        const userFiles = {};
        const tempFiles = [];
        try {
            for (const [userId, arr] of this.perUserBuffers.entries()) {
                if (!arr.length) continue;
                const tmpObj = tmp.fileSync({ postfix: `.pcm` });
                const pcmPath = tmpObj.name;
                tempFiles.push({ path: pcmPath, removeCallback: tmpObj.removeCallback });
                // write raw PCM (s16le)
                const w = fs.createWriteStream(pcmPath);
                for (const item of arr) {
                    if (item.chunk) w.write(item.chunk);
                }
                w.end();

                // Custom output file name
                const nameSafe = (usersMap.get(userId) || 'test')
                    .replace(/[<>:"/\\|?*]/g, '_');
                const outputName = `voice_${nameSafe}.${format}`;
                const outputPath = `${process.cwd()}/${outputName}`;
                await new Promise((resolve, reject) => {
                    ffmpeg()
                        .input(pcmPath)
                        .inputOptions([`-f s16le`, `-ar ${this.rawSampleRate}`, `-ac ${this.channels}`])
                        .format(format)
                        .outputOptions(['-ar 48000', '-ac 2'])
                        .save(outputPath)
                        .on('end', () => resolve())
                        .on('error', (err) => reject(err));
                });
                userFiles[userId] = outputPath;
            }
            return userFiles;
        } finally {
            for (const f of tempFiles) {
                try { f.removeCallback(); } catch {
                    console.error('Failed to remove temp file', f.path);
                }
            }
        }
    }

}

export default Recorder;
