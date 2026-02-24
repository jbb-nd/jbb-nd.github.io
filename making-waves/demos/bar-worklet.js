/**
 * bar-worklet.js
 * AudioWorklet processor for a 1D Euler-Bernoulli bending bar (free-free).
 * Runs at audio rate (44100 Hz) inside the dedicated audio thread.
 *
 * Physics model:
 *   - 1D chain of N nodes with bending stiffness EI (dimensionless)
 *   - Equation of motion: d²z/dt² = -EI · δ⁴z
 *     where δ⁴z[i] = z[i-2] - 4z[i-1] + 6z[i] - 4z[i+1] + z[i+2]
 *   - Verlet integration with velocity damping:
 *       zNew[i] = z[i]*(2-d) - zPrev[i]*(1-d) - EI·δ⁴z[i]
 *   - Free-free boundary conditions: zero moment and shear at both ends
 *     Ghost nodes derived by substitution (see boundary stencils in process())
 *   - Stability condition: EI < 0.25  (eigenvalue of δ⁴ at k=π is 16;
 *     Verlet stable when EI·16 ≤ 4)
 *
 * Characteristic sound: inharmonic overtones with ratios ≈ 1 : 2.76 : 5.40
 *   (solutions to cosh(λ)cos(λ)=1), giving the bell/marimba quality
 *   that distinguishes a bar from a string.
 *
 * Frequency guide (large-N continuous limit):
 *   f₁ ≈ fs · √EI · (4.730 / (N-1))² / (2π)
 *   N=12, EI=0.05 → f₁ ≈ 290 Hz (D₄)
 *   N=12, EI=0.10 → f₁ ≈ 410 Hz (G#₄)
 *
 * Messages received from main thread:
 *   { type: 'setN',     n: <int> }
 *   { type: 'strike',   position: <0-1>, amplitude: <float>, width: <float> }
 *   { type: 'setOutput', position: <0-1> }
 *
 * Messages sent to main thread:
 *   { type: 'positions', data: Float32Array }  — every vizInterval blocks (~43/sec)
 */

class BarProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [
            {
                name: 'stiffness',
                defaultValue: 0.05,
                minValue:     0.0001,
                maxValue:     0.2,          // Hard limit below CFL boundary EI=0.25
                automationRate: 'k-rate'
            },
            {
                name: 'damping',
                defaultValue: 0.0002,
                minValue:     0.0,
                maxValue:     0.01,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();

        this.N     = 12;
        this.z     = new Float32Array(this.N);
        this.zPrev = new Float32Array(this.N);
        this.zNew  = new Float32Array(this.N);

        this.outputPos  = 0.22;   // fractional position along bar for audio output
        this.blockCount  = 0;
        this.vizInterval = 8;

        this.port.onmessage = (e) => {
            const { type } = e.data;

            if (type === 'setN') {
                this.N     = Math.max(4, Math.min(500, e.data.n));
                this.z     = new Float32Array(this.N);
                this.zPrev = new Float32Array(this.N);
                this.zNew  = new Float32Array(this.N);

            } else if (type === 'strike') {
                // Gaussian displacement profile (displacement pluck — same physics
                // as a rapid impulsive strike when pluck width is narrow)
                const pos    = e.data.position  ?? 0.5;
                const amp    = e.data.amplitude ?? 1.0;
                const w      = e.data.width     ?? 3.0;
                const center = Math.round(pos * (this.N - 1));

                for (let i = 0; i < this.N; i++) {
                    const dist = i - center;
                    const val  = amp * Math.exp(-(dist * dist) / (2.0 * w * w));
                    this.z[i]     = val;
                    this.zPrev[i] = val;   // zero initial velocity
                }

            } else if (type === 'setOutput') {
                this.outputPos = Math.max(0, Math.min(1, e.data.position ?? 0.22));
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputChannel = outputs[0]?.[0];
        if (!outputChannel) return true;

        const EI  = parameters.stiffness[0];
        const d   = parameters.damping[0];
        const N   = this.N;
        const z     = this.z;
        const zPrev = this.zPrev;
        const zNew  = this.zNew;

        // Output node index
        const outIdx = Math.min(N - 1, Math.max(0, Math.round(this.outputPos * (N - 1))));

        for (let s = 0; s < 128; s++) {

            // ── Free-free boundary stencils ──────────────────────────────────
            //
            // Ghost nodes at left end (moment=0 → z[-1]=2z[0]-z[1],
            //                         shear=0  → z[-2]=4z[0]-4z[1]+z[2]):
            //   After substitution, acceleration at i=0 simplifies to:
            //     acc[0] = -EI * (z[-2]-4z[-1]+6z[0]-4z[1]+z[2])
            //            = -2EI * (z[0] - 2z[1] + z[2])
            //   And at i=1:
            //     acc[1] = -EI * (-2z[0] + 5z[1] - 4z[2] + z[3])
            //
            // Ghost nodes at right end (symmetric):
            //   z[N]   = 2z[N-1]-z[N-2],  z[N+1] = 4z[N-1]-4z[N-2]+z[N-3]
            //   acc[N-2] = -EI*(z[N-4] - 4z[N-3] + 5z[N-2] - 2z[N-1])
            //   acc[N-1] = -2EI*(z[N-3] - 2z[N-2] + z[N-1])

            let acc;

            // i = 0
            acc = N > 2 ? -2.0 * EI * (z[0] - 2.0*z[1] + z[2]) : 0.0;
            zNew[0] = z[0]*(2-d) - zPrev[0]*(1-d) + acc;

            // i = 1
            if (N > 3) {
                acc = -EI * (-2.0*z[0] + 5.0*z[1] - 4.0*z[2] + z[3]);
                zNew[1] = z[1]*(2-d) - zPrev[1]*(1-d) + acc;
            }

            // i = 2 .. N-3  (interior — standard stencil)
            for (let i = 2; i <= N - 3; i++) {
                acc = -EI * (z[i-2] - 4.0*z[i-1] + 6.0*z[i] - 4.0*z[i+1] + z[i+2]);
                zNew[i] = z[i]*(2-d) - zPrev[i]*(1-d) + acc;
            }

            // i = N-2
            if (N > 3) {
                acc = -EI * (z[N-4] - 4.0*z[N-3] + 5.0*z[N-2] - 2.0*z[N-1]);
                zNew[N-2] = z[N-2]*(2-d) - zPrev[N-2]*(1-d) + acc;
            }

            // i = N-1
            acc = N > 2 ? -2.0 * EI * (z[N-3] - 2.0*z[N-2] + z[N-1]) : 0.0;
            zNew[N-1] = z[N-1]*(2-d) - zPrev[N-1]*(1-d) + acc;

            // ── Remove rigid-body modes ───────────────────────────────────
            // A free-free bar has two zero-frequency modes (translation and
            // rotation) that accumulate without bound from any asymmetric
            // strike. Project them out each sample — equivalent to supporting
            // the bar at its nodal points with frictionless cord.

            // 1. Translation: subtract mean displacement
            let sumZ = 0;
            for (let i = 0; i < N; i++) sumZ += zNew[i];
            const mean = sumZ / N;
            for (let i = 0; i < N; i++) zNew[i] -= mean;

            // 2. Rotation: subtract best-fit linear trend
            const mid = (N - 1) * 0.5;
            let sumXZ = 0, sumX2 = 0;
            for (let i = 0; i < N; i++) {
                const xi = i - mid;
                sumXZ += xi * zNew[i];
                sumX2 += xi * xi;
            }
            if (sumX2 > 0) {
                const slope = sumXZ / sumX2;
                for (let i = 0; i < N; i++) zNew[i] -= slope * (i - mid);
            }

            // Audio output at pick position
            outputChannel[s] = zNew[outIdx];

            // Rotate buffers
            zPrev.set(z);
            z.set(zNew);
        }

        // Send position snapshot for visualization
        this.blockCount++;
        if (this.blockCount >= this.vizInterval) {
            this.blockCount = 0;
            const snapshot = this.z.slice();
            this.port.postMessage({ type: 'positions', data: snapshot }, [snapshot.buffer]);
        }

        return true;
    }
}

registerProcessor('bar-processor', BarProcessor);
