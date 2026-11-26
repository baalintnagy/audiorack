import type { RackState } from '../shared/effects';
import type { MeterFrame, Telemetry } from '../shared/messages';
import workletUrl from './worklet.ts?worker&url';

const PROCESSOR_NAME = 'audiorack-processor';
const loadedContexts = new WeakSet<BaseAudioContext>();

/**
 * Wires a source through the rack worklet to the context destination and passes on its
 * telemetry. Everything the editors show is measured in the worklet, each effect on its own
 * signal.
 */
export class RackGraph {
    private listeners = new Set<(telemetry: Telemetry) => void>();

    private constructor(
        readonly context: AudioContext,
        private readonly source: AudioNode,
        private readonly node: AudioWorkletNode,
    ) {
        source.connect(node);
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
        return { sampleRate: this.context.sampleRate, meters };
    }

    dispose() {
        this.listeners.clear();
        this.node.port.onmessage = null;
        this.source.disconnect();
        this.node.disconnect();
    }
}
