import { OpusDecoder } from "opus-decoder";

interface OpusPlayerOptions {
    encoding?: '8bitInt' | '16bitInt' | '32bitInt' | '32bitFloat';
    channels?: number;
    sampleRate?: number;
    flushingTime?: number;
}

export class OpusPlayer {
    private option!: Required<OpusPlayerOptions>;
    private samples!: Float32Array;
    private intervalId!: number;
    private audioCtx!: AudioContext;
    private gainNode!: GainNode;
    private startTime!: number;

    private decoder: OpusDecoder;
    private decoderReady: Promise<void>;

    private _decoderSampleRate?: number;
    private _decoderChannels?: number;

    constructor(options: OpusPlayerOptions = {}) {
        this.initOptions(options);

        this.decoder = new OpusDecoder();
        this.decoderReady = this.decoder.ready;

        this.intervalId = window.setInterval(() => this.flush(), this.option.flushingTime);
    }

    private initOptions(options: OpusPlayerOptions) {
        this.option = {
            encoding: '16bitInt',
            channels: 2,
            sampleRate: 48000,
            flushingTime: 20,
            ...options,
        };

        this.samples = new Float32Array(0);
        this.createContext();
    }

    private createContext() {
        this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        this.gainNode = this.audioCtx.createGain();
        this.gainNode.connect(this.audioCtx.destination);
        this.startTime = this.audioCtx.currentTime;
        this.audioCtx.resume?.();
    }

    private isTypedArray(data: any): data is ArrayBufferView {
        return !!data && typeof data.byteLength === 'number' && data.buffer instanceof ArrayBuffer;
    }

    public async feed(data: ArrayBufferView) {
        if (!this.isTypedArray(data)) return;
        await this.decoderReady;

        const packet = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const { channelData, sampleRate } = this.decoder.decodeFrame(packet);

        if (this._decoderSampleRate == null) {
            this._decoderSampleRate = sampleRate;
            this._decoderChannels = channelData.length;
        }

        const ch = channelData.length;
        const len = channelData[0].length;
        const inter = new Float32Array(len * ch);

        for (let i = 0; i < len; i++) {
            for (let c = 0; c < ch; c++) {
                inter[i * ch + c] = channelData[c][i];
            }
        }

        const buff = new Float32Array(this.samples.length + inter.length);
        buff.set(this.samples, 0);
        buff.set(inter, this.samples.length);

        this.samples = buff;
    }

    public volume(level: number) {
        this.gainNode.gain.value = level;
    }

    public destory() {
        clearInterval(this.intervalId);
        this.samples = new Float32Array(0);
        this.audioCtx.close();
    }

    private flush() {
        if (!this.samples || this.samples.length === 0) return;

        const channels = this._decoderChannels || this.option.channels;
        const sr = this._decoderSampleRate || this.option.sampleRate;
        const frameCount = this.samples.length / channels;

        const minSamples = 480 * channels;
        if (this.samples.length < minSamples) {
            return;
        }

        const audioBuffer = this.audioCtx.createBuffer(channels, frameCount, sr);

        const fade = 50;

        for (let c = 0; c < channels; c++) {
            const chData = audioBuffer.getChannelData(c);

            let idx = c;

            for (let i = 0; i < frameCount; i++) {
                let s = this.samples[idx];
                if (i < fade) s *= i / fade;
                if (i >= frameCount - fade) s *= (frameCount - i) / fade;

                chData[i] = s;
                idx += channels;
            }
        }

        const src = this.audioCtx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(this.gainNode);

        if (this.startTime < this.audioCtx.currentTime) {
            this.startTime = this.audioCtx.currentTime;
        }
        src.start(this.startTime);
        this.startTime += audioBuffer.duration;

        this.samples = new Float32Array(0);
    }
}