/**
 * Renders a short procedural groove (kick, snare, hats, bass, pad and sibilant bursts) so
 * the rack can be tried outside the extension without any audio files.
 */
export function createDemoLoop(context: BaseAudioContext): AudioBuffer {
    const sampleRate = context.sampleRate;
    const bpm = 112;
    const beat = 60 / bpm;
    const bars = 2;
    const length = Math.round(beat * 4 * bars * sampleRate);
    const buffer = context.createBuffer(2, length, sampleRate);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let seed = 7;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return (seed / 0xffffffff) * 2 - 1;
    };
    const add = (start: number, duration: number, voice: (t: number) => [number, number]) => {
        const from = Math.round(start * sampleRate);
        const to = Math.min(length, from + Math.round(duration * sampleRate));
        for (let i = from; i < to; i++) {
            const [l, r] = voice((i - from) / sampleRate);
            left[i] += l;
            right[i] += r;
        }
    };
    const steps = bars * 16;
    const bassNotes = [41.2, 41.2, 49, 36.7];
    const chords = [
        [220, 261.6, 329.6],
        [196, 246.9, 293.7],
    ];
    for (let step = 0; step < steps; step++) {
        const time = (step * beat) / 4;
        if (step % 4 === 0 || step === 14 || step === 30) {
            add(time, 0.5, (t) => {
                const phase = 2 * Math.PI * (45 * t + (75 / 30) * (1 - Math.exp(-30 * t)));
                const value = Math.sin(phase) * Math.exp(-7 * t) * 0.8;
                return [value, value];
            });
        }
        if (step % 8 === 4) {
            add(time, 0.25, (t) => {
                const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-25 * t) * 0.3;
                const value = body + random() * Math.exp(-18 * t) * 0.35;
                return [value, value * 0.9];
            });
        }
        if (step % 2 === 0) {
            let previous = 0;
            add(time, 0.06, (t) => {
                const white = random();
                const value = (white - previous) * Math.exp(-60 * t) * 0.12;
                previous = white;
                return [value * 0.7, value];
            });
        }
        if (step % 4 === 2) {
            const frequency = bassNotes[Math.floor(step / 8) % bassNotes.length];
            let filtered = 0;
            add(time, beat * 0.45, (t) => {
                const saw = 2 * ((frequency * t) % 1) - 1;
                filtered += (saw - filtered) * 0.08;
                const value = filtered * Math.min(1, t * 200) * Math.exp(-3 * t) * 0.45;
                return [value, value];
            });
        }
        if (step % 16 === 0) {
            const chord = chords[(step / 16) % chords.length];
            add(time, beat * 4, (t) => {
                const envelope = Math.min(1, t * 4) * Math.exp(-0.6 * t) * 0.06;
                const l = chord.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * t), 0);
                const r = chord.reduce((sum, f) => sum + Math.sin(2 * Math.PI * f * 1.003 * t), 0);
                return [l * envelope, r * envelope];
            });
        }
        if (step % 16 === 10) {
            let previous = 0;
            add(time, 0.22, (t) => {
                const white = random();
                const hiss = (white - previous) * 0.5;
                previous = white;
                const envelope = Math.sin(Math.PI * Math.min(1, t / 0.22)) * 0.18;
                return [hiss * envelope, hiss * envelope];
            });
        }
    }
    return buffer;
}
