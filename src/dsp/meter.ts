/** Accumulates stereo peak and RMS levels between reads. */
export class LevelMeter {
    private peak = [0, 0];
    private squares = [0, 0];
    private count = 0;

    add(left: Float32Array, right: Float32Array, frames: number) {
        [left, right].forEach((buffer, channel) => {
            let peak = this.peak[channel];
            let squares = this.squares[channel];
            for (let i = 0; i < frames; i++) {
                const value = buffer[i];
                const magnitude = Math.abs(value);
                if (magnitude > peak) {
                    peak = magnitude;
                }
                squares += value * value;
            }
            this.peak[channel] = peak;
            this.squares[channel] = squares;
        });
        this.count += frames;
    }

    take(): { peak: [number, number]; rms: [number, number] } {
        const count = Math.max(this.count, 1);
        const result = {
            peak: [this.peak[0], this.peak[1]] as [number, number],
            rms: [Math.sqrt(this.squares[0] / count), Math.sqrt(this.squares[1] / count)] as [
                number,
                number,
            ],
        };
        this.peak = [0, 0];
        this.squares = [0, 0];
        this.count = 0;
        return result;
    }
}
