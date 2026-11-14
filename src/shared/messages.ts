import type { RackState } from './effects';

export interface MeterFrame {
    inputPeak: [number, number];
    inputRms: [number, number];
    outputPeak: [number, number];
    outputRms: [number, number];
    /** Gain reduction (dB) or other per-effect readings keyed by effect id. */
    effects: Record<string, number[]>;
}

export interface Telemetry {
    sampleRate: number;
    meters: MeterFrame;
    /** Log-spaced spectrum magnitudes in dBFS before and after the rack. */
    pre: number[];
    post: number[];
}

export interface CaptureStatus {
    capturing: boolean;
    sessions: number[];
    error?: string;
}

export type BackgroundMessage =
    | { target: 'background'; type: 'start-capture'; tabId: number }
    | { target: 'background'; type: 'stop-capture'; tabId: number }
    | { target: 'background'; type: 'get-status'; tabId: number }
    | { target: 'background'; type: 'session-ended'; tabId: number };

export type OffscreenMessage =
    | { target: 'offscreen'; type: 'start'; tabId: number; streamId: string; rack: RackState }
    | { target: 'offscreen'; type: 'stop'; tabId: number }
    | { target: 'offscreen'; type: 'rack'; rack: RackState }
    | { target: 'offscreen'; type: 'list' };

export type RuntimeMessage = BackgroundMessage | OffscreenMessage;

export const TELEMETRY_PORT_PREFIX = 'telemetry:';

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
    return (
        typeof value === 'object' &&
        value !== null &&
        'target' in value &&
        'type' in value &&
        typeof (value as { type: unknown }).type === 'string'
    );
}
