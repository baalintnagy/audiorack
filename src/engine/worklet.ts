import { RackProcessor } from '../dsp/rack';
import type { RackState } from '../shared/effects';

export const PROCESSOR_NAME = 'audiorack-processor';

const METER_RATE = 30;

class AudioRackProcessor extends AudioWorkletProcessor {
    private readonly rack = new RackProcessor(sampleRate);
    private readonly meterInterval = Math.round(sampleRate / METER_RATE);
    private sinceMeter = 0;
    private left = new Float32Array(128);
    private right = new Float32Array(128);

    constructor() {
        super();
        this.port.onmessage = (event: MessageEvent<{ type: string; rack?: RackState }>) => {
            if (event.data.type === 'rack' && event.data.rack) {
                this.rack.setRack(event.data.rack);
            }
        };
    }

    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
        const output = outputs[0];
        const input = inputs[0];
        const frames = output[0]?.length ?? 128;
        if (this.left.length < frames) {
            this.left = new Float32Array(frames);
            this.right = new Float32Array(frames);
        }
        const left = this.left;
        const right = this.right;
        if (input && input.length > 0) {
            left.set(input[0]);
            right.set(input[1] ?? input[0]);
        } else {
            left.fill(0);
            right.fill(0);
        }
        this.rack.process(left, right, frames);
        output[0]?.set(left.subarray(0, frames));
        output[1]?.set(right.subarray(0, frames));
        this.sinceMeter += frames;
        if (this.sinceMeter >= this.meterInterval) {
            this.sinceMeter = 0;
            this.port.postMessage({ type: 'meters', meters: this.rack.takeMeters() });
        }
        return true;
    }
}

registerProcessor(PROCESSOR_NAME, AudioRackProcessor);
