/**
 * string-worklet.js
 * AudioWorklet processor for 1D mass-spring string simulation.
 * Runs at audio rate (44100 Hz) inside a dedicated audio thread.
 *
 * Physics model:
 *   - 1D chain of N mass points connected by springs of stiffness k
 *   - Fixed (pinned) boundary conditions: z[0] = z[N-1] = 0 always
 *   - Verlet integration with velocity damping:
 *       z_new[i] = z[i]*(2-d) - z_prev[i]*(1-d) + k*(z[i-1] - 2*z[i] + z[i+1])
 *     where d is a small damping coefficient per sample
 *   - Stability condition: k <= 0.25 (CFL constraint for wave equation with dt=1)
 *
 * Frequency guide (approximate fundamental, Hz):
 *   f1 ≈ sqrt(k) * sampleRate / N   (for N >> 1)
 *   N=50, k=0.10 → ~279 Hz (D4)
 *   N=50, k=0.20 → ~394 Hz (G4)
 *   N=50, k=0.24 → ~432 Hz (A4)
 *   N=30, k=0.10 → ~465 Hz (Bb4)
 *
 * Messages received from main thread:
 *   { type: 'setN',  n: <int> }                          — resize and reset string
 *   { type: 'pluck', position: <0-1>, amplitude: <float>, width: <float> } — excite string
 *
 * Messages sent to main thread:
 *   { type: 'positions', data: Float32Array }             — node positions for visualization
 *     (sent every vizInterval blocks, ~43 times/sec)
 */

class StringProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [
            {
                name: 'stiffness',
                defaultValue: 0.1,
                minValue: 0.001,
                maxValue: 0.249,       // Hard limit below CFL boundary k=0.25
                automationRate: 'k-rate'
            },
            {
                name: 'damping',
                defaultValue: 0.0002,  // Per-sample energy loss; 0.0002 ≈ ~4s decay at 44100 Hz
                minValue: 0.0,
                maxValue: 0.01,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();

        // String state — pre-allocated, never garbage collected in the audio thread
        this.N = 30;  // matches default state.N in string_demo.html
        this.z     = new Float32Array(this.N); // current positions
        this.zPrev = new Float32Array(this.N); // previous positions (for Verlet)
        this.zNew  = new Float32Array(this.N); // scratch buffer

        // Visualization throttle
        this.blockCount  = 0;
        this.vizInterval = 8; // send snapshot every 8 blocks ≈ 43 times/sec

        // Message handler (runs on audio thread — keep it lightweight)
        this.port.onmessage = (e) => {
            const { type } = e.data;

            if (type === 'setN') {
                this.N     = Math.max(3, Math.min(5000, e.data.n));
                this.z     = new Float32Array(this.N);
                this.zPrev = new Float32Array(this.N);
                this.zNew  = new Float32Array(this.N);

            } else if (type === 'pluck') {
                // Gaussian displacement profile; zero initial velocity (zPrev = z)
                const pos  = e.data.position  ?? 0.3;   // 0-1 fractional position along string
                const amp  = e.data.amplitude ?? 1.0;
                const w    = e.data.width      ?? 5.0;   // Gaussian width in nodes
                const center = Math.round(pos * (this.N - 1));

                for (let i = 1; i < this.N - 1; i++) {
                    const dist = i - center;
                    const val  = amp * Math.exp(-(dist * dist) / (2.0 * w * w));
                    this.z[i]     = val;
                    this.zPrev[i] = val; // zero velocity: prev = current
                }
                // Enforce fixed boundaries
                this.z[0] = 0; this.zPrev[0] = 0;
                this.z[this.N - 1] = 0; this.zPrev[this.N - 1] = 0;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputChannel = outputs[0]?.[0];
        if (!outputChannel) return true;

        const k   = parameters.stiffness[0];
        const d   = parameters.damping[0];
        const N   = this.N;
        const z     = this.z;
        const zPrev = this.zPrev;
        const zNew  = this.zNew;
        const mid   = Math.floor(N / 2);

        // Process one block of 128 samples
        for (let s = 0; s < 128; s++) {

            // Fixed boundary conditions — ends always pinned at zero
            zNew[0]     = 0.0;
            zNew[N - 1] = 0.0;

            // Verlet integration for interior nodes
            for (let i = 1; i < N - 1; i++) {
                const acc = k * (z[i - 1] - 2.0 * z[i] + z[i + 1]);
                zNew[i] = z[i] * (2.0 - d) - zPrev[i] * (1.0 - d) + acc;
            }

            // Write midpoint displacement to audio output
            // zNew[mid] is naturally in a reasonable audio range if pluck amplitude ≈ 1.0
            outputChannel[s] = zNew[mid];

            // Rotate buffers: zPrev ← z ← zNew
            // (in-place copy avoids GC pressure from new allocations)
            zPrev.set(z);
            z.set(zNew);
        }

        // Send position snapshot to main thread for visualization (throttled)
        this.blockCount++;
        if (this.blockCount >= this.vizInterval) {
            this.blockCount = 0;
            // .slice() creates a copy; we transfer its buffer to avoid a second copy
            const snapshot = this.z.slice();
            this.port.postMessage({ type: 'positions', data: snapshot }, [snapshot.buffer]);
        }

        return true; // Keep processor alive
    }
}

registerProcessor('string-processor', StringProcessor);
