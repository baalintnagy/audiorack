import type { RackState } from './effects';
import type { RackScope } from './storage';

export interface MeterFrame {
    inputPeak: [number, number];
    inputRms: [number, number];
    outputPeak: [number, number];
    outputRms: [number, number];
    /** Gain reduction (dB) or other readings keyed by effect id, and branch levels by group id. */
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

/**
 * `rack` with scope `shared` replaces the shared rack and makes the tab follow it; with scope
 * `tab` it gives the tab a rack of its own.
 */
export type OffscreenMessage =
    | {
          target: 'offscreen';
          type: 'start';
          tabId: number;
          streamId: string;
          rack: RackState;
          scope: RackScope;
      }
    | { target: 'offscreen'; type: 'stop'; tabId: number }
    | { target: 'offscreen'; type: 'rack'; tabId: number; rack: RackState; scope: RackScope }
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
