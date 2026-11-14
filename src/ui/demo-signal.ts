/**
 * Renders an original drum & bass demo track, so the rack can be tried outside the extension
 * without audio files: a two-step breakbeat, sub and reese bass, cinematic supersaw pads, a
 * ping-pong arpeggio, atmospheric noise, risers and impacts.
 *
 * Offline-rendered Web Audio nodes keep running after they stop, so scheduling every hit as
 * its own node graph is slow. Drums, bass notes and arpeggio notes are therefore rendered once
 * as short one-shots and mixed into stems in plain JavaScript; only the stems, pads and effects
 * go through the full graph with reverb, delay and bus compression.
 */

const BPM = 172;
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const BAR = BEAT * 4;
const BARS = 16;
const LOOP_SECONDS = BAR * BARS;
const TAIL_SECONDS = 3.5;
const RATE = 48000;

/** F minor: Fm9, Dbmaj7, Abmaj7 and Eb, two bars each. */
const CHORDS = [
    { root: 29, pad: [53, 56, 60, 63, 67] },
    { root: 37, pad: [49, 53, 56, 60, 65] },
    { root: 32, pad: [51, 56, 60, 63, 67] },
    { root: 39, pad: [51, 55, 58, 63, 70] },
];

const ARPEGGIO = [0, 2, 4, 1, 3, 4, 2, 1, 0, 2, 4, 3, 1, 4, 2, 3];

/** Syncopated reese rhythm within a bar: [start step, length in steps]. */
const BASS_PATTERN = [
    [0, 6],
    [6, 3],
    [10, 6],
];

function midiToFrequency(note: number) {
    return 440 * Math.pow(2, (note - 69) / 12);
}

function seededRandom(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0xffffffff;
    };
}

/** Attack-hold-release gain envelope that never ramps exponentially to zero. */
function envelope(
    param: AudioParam,
    start: number,
    peak: number,
    attack: number,
    hold: number,
    release: number,
) {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, start + attack);
    param.setValueAtTime(peak, start + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
    param.setValueAtTime(0, start + attack + hold + release + 0.01);
}

function connect(...nodes: AudioNode[]) {
    nodes.slice(1).forEach((node, index) => nodes[index].connect(node));
}

interface Studio {
    ctx: BaseAudioContext;
    out: AudioNode;
    reverb?: AudioNode;
    delay?: AudioNode;
    noise: AudioBuffer;
    random: () => number;
}

function send(s: Studio, node: AudioNode, reverb = 0, delay = 0) {
    node.connect(s.out);
    if (reverb > 0 && s.reverb) {
        connect(node, new GainNode(s.ctx, { gain: reverb }), s.reverb);
    }
    if (delay > 0 && s.delay) {
        connect(node, new GainNode(s.ctx, { gain: delay }), s.delay);
    }
}

function noiseSource(s: Studio, start: number, duration: number) {
    const source = new AudioBufferSourceNode(s.ctx, { buffer: s.noise, loop: true });
    source.start(start, s.random() * 1.5);
    source.stop(start + duration);
    return source;
}

// One-shot instruments, built at time 0 into a short offline render.

function kick(s: Studio) {
    const body = new OscillatorNode(s.ctx, { type: 'sine' });
    body.frequency.setValueAtTime(170, 0);
    body.frequency.exponentialRampToValueAtTime(48, 0.08);
    body.frequency.exponentialRampToValueAtTime(42, 0.4);
    const gain = new GainNode(s.ctx, { gain: 0 });
    envelope(gain.gain, 0, 0.95, 0.002, 0.04, 0.38);
    connect(body, gain, s.out);
    body.start(0);
    body.stop(0.5);
    const click = new GainNode(s.ctx, { gain: 0 });
    envelope(click.gain, 0, 0.25, 0.001, 0.002, 0.012);
    connect(
        noiseSource(s, 0, 0.02),
        new BiquadFilterNode(s.ctx, { type: 'highpass', frequency: 3500 }),
        click,
        s.out,
    );
}

function snare(s: Studio) {
    const tone = new OscillatorNode(s.ctx, { type: 'triangle' });
    tone.frequency.setValueAtTime(230, 0);
    tone.frequency.exponentialRampToValueAtTime(175, 0.06);
    const toneGain = new GainNode(s.ctx, { gain: 0 });
    envelope(toneGain.gain, 0, 0.5, 0.001, 0.01, 0.11);
    connect(tone, toneGain, s.out);
    tone.start(0);
    tone.stop(0.2);
    const noiseGain = new GainNode(s.ctx, { gain: 0 });
    envelope(noiseGain.gain, 0, 0.42, 0.001, 0.015, 0.2);
    connect(
        noiseSource(s, 0, 0.3),
        new BiquadFilterNode(s.ctx, { type: 'highpass', frequency: 1200 }),
        new BiquadFilterNode(s.ctx, { type: 'peaking', frequency: 4500, gain: 6, Q: 0.8 }),
        noiseGain,
        s.out,
    );
}

function hat(open: boolean, pan: number) {
    return (s: Studio) => {
        const gain = new GainNode(s.ctx, { gain: 0 });
        envelope(gain.gain, 0, 0.16, 0.001, 0.005, open ? 0.28 : 0.045);
        connect(
            noiseSource(s, 0, open ? 0.35 : 0.08),
            new BiquadFilterNode(s.ctx, { type: 'highpass', frequency: open ? 6500 : 8500 }),
            gain,
            new StereoPannerNode(s.ctx, { pan }),
            s.out,
        );
    };
}

function bassNote(root: number, duration: number) {
    return (s: Studio) => {
        const sub = new OscillatorNode(s.ctx, { type: 'sine', frequency: midiToFrequency(root) });
        const subGain = new GainNode(s.ctx, { gain: 0 });
        envelope(subGain.gain, 0, 0.42, 0.008, duration - 0.05, 0.06);
        connect(sub, subGain, s.out);
        sub.start(0);
        const shaper = new WaveShaperNode(s.ctx, {
            curve: Float32Array.from({ length: 1024 }, (_, i) => Math.tanh((i / 511.5 - 1) * 2.5)),
        });
        // Filter movement gives the reese its growl.
        const filter = new BiquadFilterNode(s.ctx, { type: 'lowpass', Q: 4 });
        filter.frequency.setValueAtTime(260, 0);
        filter.frequency.linearRampToValueAtTime(1300, duration * 0.35);
        filter.frequency.linearRampToValueAtTime(420, duration);
        const gain = new GainNode(s.ctx, { gain: 0 });
        envelope(gain.gain, 0, 0.085, 0.01, duration - 0.05, 0.08);
        connect(shaper, filter, gain, s.out);
        [-17, 17].forEach((detune) => {
            const saw = new OscillatorNode(s.ctx, {
                type: 'sawtooth',
                frequency: midiToFrequency(root + 12),
                detune,
            });
            saw.connect(shaper);
            saw.start(0);
        });
    };
}

function arpNote(note: number) {
    return (s: Studio) => {
        const osc = new OscillatorNode(s.ctx, { type: 'square', frequency: midiToFrequency(note) });
        const filter = new BiquadFilterNode(s.ctx, { type: 'lowpass', Q: 3 });
        filter.frequency.setValueAtTime(4200, 0);
        filter.frequency.exponentialRampToValueAtTime(900, 0.14);
        const gain = new GainNode(s.ctx, { gain: 0 });
        envelope(gain.gain, 0, 0.05, 0.003, 0.02, 0.14);
        connect(osc, filter, gain, s.out);
        osc.start(0);
    };
}

// Long-running parts, built directly into the main render.

function pad(s: Studio, start: number, notes: number[]) {
    const duration = BAR * 2;
    const filter = new BiquadFilterNode(s.ctx, { type: 'lowpass', Q: 0.7 });
    filter.frequency.setValueAtTime(700, start);
    filter.frequency.linearRampToValueAtTime(3400, start + duration * 0.6);
    filter.frequency.linearRampToValueAtTime(1600, start + duration + 1.2);
    const gain = new GainNode(s.ctx, { gain: 0 });
    envelope(gain.gain, start, 0.065, 0.9, duration - 0.9, 1.6);
    connect(filter, gain);
    send(s, gain, 0.7);
    notes.forEach((note, index) => {
        // Two detuned voices per note, spread hard left and right.
        [
            [-13, -0.8],
            [13, 0.8],
        ].forEach(([detune, pan]) => {
            const saw = new OscillatorNode(s.ctx, {
                type: 'sawtooth',
                frequency: midiToFrequency(note),
                detune: detune + (index % 2 ? 3 : -3),
            });
            connect(saw, new StereoPannerNode(s.ctx, { pan }), filter);
            saw.start(start);
            saw.stop(start + duration + 3);
        });
    });
}

function atmosphere(s: Studio) {
    const filter = new BiquadFilterNode(s.ctx, { type: 'bandpass', Q: 5 });
    const panner = new StereoPannerNode(s.ctx);
    for (let section = 0; section < 2; section++) {
        const t = section * 8 * BAR;
        filter.frequency.setValueAtTime(350, t);
        filter.frequency.exponentialRampToValueAtTime(2600, t + 4 * BAR);
        filter.frequency.exponentialRampToValueAtTime(350, t + 8 * BAR);
        panner.pan.setValueAtTime(-0.6, t);
        panner.pan.linearRampToValueAtTime(0.6, t + 4 * BAR);
        panner.pan.linearRampToValueAtTime(-0.6, t + 8 * BAR);
    }
    const gain = new GainNode(s.ctx, { gain: 0.09 });
    connect(noiseSource(s, 0, LOOP_SECONDS + TAIL_SECONDS), filter, panner, gain);
    send(s, gain, 0.8);
}

function riser(s: Studio, start: number) {
    const filter = new BiquadFilterNode(s.ctx, { type: 'highpass', Q: 6 });
    filter.frequency.setValueAtTime(300, start);
    filter.frequency.exponentialRampToValueAtTime(9000, start + BAR);
    const gain = new GainNode(s.ctx, { gain: 0 });
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.14, start + BAR * 0.97);
    gain.gain.linearRampToValueAtTime(0, start + BAR);
    connect(noiseSource(s, start, BAR), filter, gain);
    send(s, gain, 0.5);
}

function impact(s: Studio, t: number) {
    const boom = new OscillatorNode(s.ctx, { type: 'sine' });
    boom.frequency.setValueAtTime(62, t);
    boom.frequency.exponentialRampToValueAtTime(34, t + 1.6);
    const gain = new GainNode(s.ctx, { gain: 0 });
    envelope(gain.gain, t, 0.5, 0.005, 0.1, 1.6);
    connect(boom, gain);
    send(s, gain, 0.6);
    boom.start(t);
    boom.stop(t + 2);
}

/** Ping-pong delay at a dotted eighth. */
function createDelay(ctx: BaseAudioContext, output: AudioNode, reverb: AudioNode): AudioNode {
    const input = new GainNode(ctx);
    const left = new DelayNode(ctx, { delayTime: STEP * 3, maxDelayTime: 1 });
    const right = new DelayNode(ctx, { delayTime: STEP * 3, maxDelayTime: 1 });
    const panLeft = new StereoPannerNode(ctx, { pan: -0.85 });
    const panRight = new StereoPannerNode(ctx, { pan: 0.85 });
    connect(input, new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 3800 }), left, panLeft);
    connect(left, new GainNode(ctx, { gain: 0.42 }), right, panRight);
    connect(right, new GainNode(ctx, { gain: 0.42 }), left);
    [panLeft, panRight].forEach((pan) => {
        pan.connect(output);
        pan.connect(reverb);
    });
    return input;
}

/** Stereo impulse response: decorrelated, darkening exponential noise. */
function createImpulse(ctx: BaseAudioContext, seconds: number, random: () => number) {
    const length = Math.round(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        let smoothed = 0;
        for (let i = 0; i < length; i++) {
            const t = i / length;
            smoothed += (random() * 2 - 1 - smoothed) * (0.6 - 0.5 * t);
            data[i] = smoothed * Math.pow(1 - t, 3.2) * Math.min(1, i / 120);
        }
    }
    return buffer;
}

type Stem = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

class Renderer {
    private readonly random = seededRandom(172);
    private readonly noise: Float32Array<ArrayBuffer>;
    private readonly shots = new Map<string, Promise<AudioBuffer>>();

    constructor() {
        this.noise = Float32Array.from({ length: RATE * 2 }, () => this.random() * 2 - 1);
    }

    private noiseBuffer(ctx: BaseAudioContext) {
        const buffer = ctx.createBuffer(1, this.noise.length, ctx.sampleRate);
        buffer.copyToChannel(this.noise, 0);
        return buffer;
    }

    /** Renders an instrument once and caches it by key. */
    shot(key: string, seconds: number, build: (s: Studio) => void): Promise<AudioBuffer> {
        let shot = this.shots.get(key);
        if (!shot) {
            const ctx = new OfflineAudioContext(2, Math.round(seconds * RATE), RATE);
            build({ ctx, out: ctx.destination, noise: this.noiseBuffer(ctx), random: this.random });
            shot = ctx.startRendering();
            this.shots.set(key, shot);
        }
        return shot;
    }

    async place(stem: Stem, shot: Promise<AudioBuffer>, time: number, gain = 1) {
        const buffer = await shot;
        const offset = Math.round(time * RATE);
        stem.forEach((channel, index) => {
            const data = buffer.getChannelData(index);
            const length = Math.min(data.length, channel.length - offset);
            for (let i = 0; i < length; i++) {
                channel[offset + i] += data[i] * gain;
            }
        });
    }

    async render(): Promise<AudioBuffer> {
        const total = Math.round((LOOP_SECONDS + TAIL_SECONDS) * RATE);
        const stem = (): Stem => [new Float32Array(total), new Float32Array(total)];
        const kicks = stem();
        const tops = stem();
        const bass = stem();
        const arps = stem();
        const placements: Promise<void>[] = [];
        const hats = [-0.3, 0.3].map((pan) => this.shot(`hat${pan}`, 0.15, hat(false, pan)));
        const openHat = this.shot('open-hat', 0.5, hat(true, 0.3));
        const kickShot = this.shot('kick', 0.6, kick);
        const snareShot = this.shot('snare', 0.4, snare);

        for (let bar = 0; bar < BARS; bar++) {
            const barStart = bar * BAR;
            const fill = bar % 8 === 7;
            const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
            for (let step = 0; step < 16; step++) {
                const t = barStart + step * STEP;
                // Two-step: kicks on 1 and the "and" of 3, snares on 2 and 4.
                if (step === 0 || step === 10) {
                    placements.push(this.place(kicks, kickShot, t));
                }
                if (step === 4 || (step === 12 && !fill)) {
                    placements.push(this.place(tops, snareShot, t));
                }
                if ((step === 7 || step === 15) && !fill) {
                    placements.push(this.place(tops, snareShot, t, 0.22));
                }
                if (fill && step >= 12) {
                    placements.push(this.place(tops, snareShot, t, 0.45 + (step - 12) * 0.18));
                }
                if (step === 14 && bar % 2 === 1) {
                    placements.push(this.place(tops, openHat, t, 0.9));
                } else if (step % 2 === 0) {
                    const shot = hats[(step / 2) % 2];
                    placements.push(this.place(tops, shot, t, step % 4 === 2 ? 0.9 : 0.55));
                } else if (step === 3 || step === 13) {
                    placements.push(this.place(tops, hats[1], t, 0.3));
                }
                if (bar >= 8) {
                    const note = chord.pad[ARPEGGIO[(step + (bar % 2) * 16) % 16]] + 12;
                    const shot = this.shot(`arp${note}`, 0.3, arpNote(note));
                    placements.push(this.place(arps, shot, t, step % 4 === 0 ? 1 : 0.7));
                }
            }
            BASS_PATTERN.forEach(([step, length]) => {
                const duration = length * STEP;
                const shot = this.shot(
                    `bass${chord.root}-${length}`,
                    duration + 0.15,
                    bassNote(chord.root, duration),
                );
                placements.push(this.place(bass, shot, barStart + step * STEP));
            });
        }
        await Promise.all(placements);
        return this.mix([kicks, tops, bass, arps], total);
    }

    private async mix([kicks, tops, bass, arps]: Stem[], total: number): Promise<AudioBuffer> {
        const ctx = new OfflineAudioContext(2, total, RATE);
        const master = new GainNode(ctx, { gain: 0.9 });
        const glue = new DynamicsCompressorNode(ctx, {
            threshold: -16,
            ratio: 3,
            knee: 6,
            attack: 0.01,
            release: 0.2,
        });
        connect(master, glue, ctx.destination);
        const reverb = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 180 });
        connect(
            reverb,
            new ConvolverNode(ctx, { buffer: createImpulse(ctx, 3, this.random) }),
            new GainNode(ctx, { gain: 0.32 }),
            master,
        );
        const studio: Studio = {
            ctx,
            out: master,
            reverb,
            delay: createDelay(ctx, master, reverb),
            noise: this.noiseBuffer(ctx),
            random: this.random,
        };
        const play = (stem: Stem, reverbSend: number, delaySend = 0) => {
            const buffer = ctx.createBuffer(2, total, RATE);
            stem.forEach((channel, index) => buffer.copyToChannel(channel, index));
            const source = new AudioBufferSourceNode(ctx, { buffer });
            send(studio, source, reverbSend, delaySend);
            source.start(0);
        };
        play(kicks, 0);
        play(tops, 0.15);
        play(bass, 0.04);
        play(arps, 0.35, 0.55);

        atmosphere(studio);
        for (let bar = 0; bar < BARS; bar += 2) {
            pad(studio, bar * BAR, CHORDS[(bar / 2) % CHORDS.length].pad);
        }
        [0, 8].forEach((bar) => impact(studio, bar * BAR));
        [7, 15].forEach((bar) => riser(studio, bar * BAR));
        return loopAndNormalize(await ctx.startRendering());
    }
}

/** Folds the reverb and release tails onto the start so the loop is seamless, at -1 dBFS. */
function loopAndNormalize(rendered: AudioBuffer): AudioBuffer {
    const loopLength = Math.round(LOOP_SECONDS * RATE);
    const loop = new AudioBuffer({ numberOfChannels: 2, length: loopLength, sampleRate: RATE });
    const channels = [0, 1].map((index) => {
        const source = rendered.getChannelData(index);
        const target = loop.getChannelData(index);
        target.set(source.subarray(0, loopLength));
        for (let i = loopLength; i < source.length; i++) {
            target[i - loopLength] += source[i];
        }
        return target;
    });
    const peak = channels.reduce(
        (max, data) =>
            data.reduce((channelMax, value) => Math.max(channelMax, Math.abs(value)), max),
        0,
    );
    const gain = peak > 0 ? 0.891 / peak : 1;
    channels.forEach((data) => {
        for (let i = 0; i < data.length; i++) {
            data[i] *= gain;
        }
    });
    return loop;
}

let track: Promise<AudioBuffer> | undefined;

/** Renders the demo track once and shares it; safe to call before any user gesture. */
export function demoTrack(): Promise<AudioBuffer> {
    track ??= new Renderer().render();
    return track;
}

export const DEMO_TRACK_LABEL = 'Demo track · DnB 172';
