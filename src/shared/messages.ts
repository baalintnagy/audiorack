import type { RackState } from './effects';
import type { RackScope } from './storage';

/** Stereo peak and RMS levels, linear. */
export interface Levels {
    peak: [number, number];
    rms: [number, number];
}

/**
 * What one effect's own signal looked like since the previous frame: its levels going in and
 * coming out and, for effects that draw them, its spectra as log-spaced magnitudes in dBFS.
 * Displays of an effect read this rather than the rack's input and output, so the rack's input
 * and output gain never change them.
 */
export interface SignalReading {
    input: Levels;
    output: Levels;
    pre?: number[];
    post?: number[];
}

export interface MeterFrame {
    /** The rack's own input and output levels, for its master meters. */
    inputPeak: [number, number];
    inputRms: [number, number];
    outputPeak: [number, number];
    outputRms: [number, number];
    /** Gain reduction (dB) or other readings keyed by effect id, and branch levels by group id. */
    effects: Record<string, number[]>;
    /** Each effect's own signal, keyed by effect id; none for a bypassed effect. */
    signals: Record<string, SignalReading>;
}

export interface Telemetry {
    sampleRate: number;
    meters: MeterFrame;
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
