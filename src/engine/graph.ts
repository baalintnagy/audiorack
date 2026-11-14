import type { RackState } from '../shared/effects';
import type { MeterFrame, Telemetry } from '../shared/messages';
import { toLogSpectrum } from '../shared/spectrum';
import workletUrl from './worklet.ts?worker&url';

const PROCESSOR_NAME = 'audiorack-processor';
const loadedContexts = new WeakSet<BaseAudioContext>();

function createAnalyser(context: AudioContext): AnalyserNode {
    const analyser = context.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.8;
    analyser.minDecibels = -120;
    analyser.maxDecibels = 0;
    return analyser;
}

/**
 * Wires a source through the rack worklet to the context destination and exposes
 * analyser data for the editors.
 */
export class RackGraph {
    private readonly pre: AnalyserNode;
    private readonly post: AnalyserNode;
    private readonly preData: Float32Array<ArrayBuffer>;
    private readonly postData: Float32Array<ArrayBuffer>;
    private listeners = new Set<(telemetry: Telemetry) => void>();

    private constructor(
        readonly context: AudioContext,
        private readonly source: AudioNode,
        private readonly node: AudioWorkletNode,
    ) {
        this.pre = createAnalyser(context);
        this.post = createAnalyser(context);
        this.preData = new Float32Array(this.pre.frequencyBinCount);
        this.postData = new Float32Array(this.post.frequencyBinCount);
        source.connect(this.pre);
        source.connect(node);
        node.connect(this.post);
        node.connect(context.destination);
        node.port.onmessage = (event: MessageEvent<{ type: string; meters: MeterFrame }>) => {
            if (event.data.type === 'meters' && this.listeners.size > 0) {
                const telemetry = this.telemetry(event.data.meters);
                this.listeners.forEach((listener) => listener(telemetry));
            }
        };
    }

    static async create(context: AudioContext, source: AudioNode, rack: RackState) {
        if (!loadedContexts.has(context)) {
            await context.audioWorklet.addModule(workletUrl);
            loadedContexts.add(context);
        }
        const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [2],
            channelCount: 2,
            channelCountMode: 'explicit',
            channelInterpretation: 'speakers',
        });
        const graph = new RackGraph(context, source, node);
        graph.setRack(rack);
        return graph;
    }

    setRack(rack: RackState) {
        this.node.port.postMessage({ type: 'rack', rack });
    }

    subscribe(listener: (telemetry: Telemetry) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private telemetry(meters: MeterFrame): Telemetry {
        this.pre.getFloatFrequencyData(this.preData);
        this.post.getFloatFrequencyData(this.postData);
        const sampleRate = this.context.sampleRate;
        return {
            sampleRate,
            meters,
            pre: toLogSpectrum(this.preData, sampleRate),
            post: toLogSpectrum(this.postData, sampleRate),
        };
    }

    dispose() {
        this.listeners.clear();
        this.node.port.onmessage = null;
        this.source.disconnect();
        this.node.disconnect();
    }
}
