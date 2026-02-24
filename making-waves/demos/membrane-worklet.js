/**
 * membrane-worklet.js
 * AudioWorklet processor for a 2D square membrane simulation.
 * Runs at audio rate (44100 Hz) inside the dedicated audio thread.
 *
 * Physics model:
 *   - N×N grid of mass points with nodes indexed (i=row, j=col), stored flat: z[i*N+j]
 *   - Fixed boundary conditions on all four edges: z=0 for i=0, i=N-1, j=0, j=N-1
 *   - 2D discrete Laplacian (isotropic, stiffness k):
 *       Δz[i,j] = z[i-1,j] + z[i+1,j] + z[i,j-1] + z[i,j+1] - 4·z[i,j]
 *   - Verlet integration with per-sample velocity damping d:
 *       zNew[i,j] = z[i,j]·(2-d) - zPrev[i,j]·(1-d) + k·Δz[i,j]
 *   - Only interior nodes (1 ≤ i,j ≤ N-2) are ever written; edge nodes stay zero.
 *
 * Stability condition (von Neumann analysis):
 *   Maximum eigenvalue of 2D Laplacian → |λ_max| = 8  (both sin terms → 1 as N→∞)
 *   Verlet stability: k·|λ_max| ≤ 4  →  k ≤ 0.5
 *
 * Exact discrete mode frequencies:
 *   f_mn = (fs/π)·arcsin( √(k·(sin²(mπ/(2(N-1))) + sin²(nπ/(2(N-1))))) )
 *
 * Frequency guide (approximate continuous limit: f₁₁ ≈ fs·√(2k) / (2(N-1))):
 *   N=50, k=0.10 → f₁₁ ≈ 201 Hz (Ab3)
 *   N=50, k=0.04 → f₁₁ ≈ 127 Hz (B2)
 *   N=30, k=0.10 → f₁₁ ≈ 337 Hz (E4)
 *
 * Overtone ratios (continuous square membrane): f_mn/f_11 = √(m²+n²)/√2
 *   (1,1)=1.000  (1,2)=(2,1)=1.581  (2,2)=2.000
 *   (1,3)=(3,1)=2.236  (2,3)=(3,2)=2.550  (3,3)=3.000
 *
 * Messages received from main thread:
 *   { type: 'setN',      n: <int> }                         — resize and reset grid
 *   { type: 'strike',    nx: <0-1>, ny: <0-1>,              — 2D Gaussian excitation
 *     width: <float>, amp: <float> }                            nx,ny = normalised [0,1]
 *   { type: 'setOutput', nx: <0-1>, ny: <0-1> }            — audio output node position
 *
 * Messages sent to main thread:
 *   { type: 'snapshot', data: Float32Array(N×N) }           — every vizInterval blocks
 *     Buffer is transferred (moved, not copied) to avoid structured-clone overhead.
 *     NOTE: at N=80 this allocates 25.6 KB per snapshot (~1.1 MB/s). A ping-pong
 *     pair of pre-allocated buffers (exchanged via a 'returnBuffer' message) would
 *     eliminate this GC pressure entirely; add if audio glitches appear at high N.
 */

class MembraneProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [
            {
                name: 'stiffness',
                defaultValue: 0.10,
                minValue:     0.001,
                maxValue:     0.49,        // Hard limit below CFL boundary k=0.50
                automationRate: 'k-rate'
            },
            {
                name: 'damping',
                defaultValue: 0.0002,      // Per-sample; 0.0002 ≈ ~4 s decay at 44100 Hz
                minValue:     0.0,
                maxValue:     0.01,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();

        // Default N must match the HTML slider default (N=50) to avoid
        // wrong spectrum markers during the first few seconds after audio starts.
        this.N = 50;
        this._allocArrays(this.N);

        // Audio output node (normalised coords; interior, slightly off-centre)
        this.outNx = 0.35;
        this.outNy = 0.35;

        // Visualization throttle
        this.blockCount  = 0;
        this.vizInterval = 8;   // send snapshot every 8 blocks ≈ 43 times/sec

        this.port.onmessage = (e) => {
            const { type } = e.data;

            if (type === 'setN') {
                const n = Math.max(6, Math.min(100, Math.round(e.data.n)));
                this.N = n;
                this._allocArrays(n);
                this.blockCount = 0;   // reset snapshot timer after resize

            } else if (type === 'strike') {
                const nx  = e.data.nx    ?? 0.35;
                const ny  = e.data.ny    ?? 0.35;
                const w   = e.data.width ?? 5.0;   // Gaussian σ in lattice nodes
                const amp = e.data.amp   ?? 1.0;
                const N   = this.N;

                const ci = Math.round(ny * (N - 1));
                const cj = Math.round(nx * (N - 1));
                const w2 = 2.0 * w * w;

                // Apply 2D Gaussian displacement profile, zero initial velocity
                for (let i = 0; i < N; i++) {
                    const di  = i - ci;
                    const di2 = di * di;
                    for (let j = 0; j < N; j++) {
                        const dj  = j - cj;
                        const val = amp * Math.exp(-(di2 + dj * dj) / w2);
                        this.z[i * N + j]     = val;
                        this.zPrev[i * N + j] = val;   // prev=current → zero velocity
                    }
                }

                // Re-enforce fixed boundary conditions.
                // The Gaussian tail can reach the boundary even when the centre is
                // at [0.05, 0.95], so always zero boundary after a strike.
                const Nm1 = N - 1;
                for (let j = 0; j < N; j++) {
                    this.z[j]            = 0;  this.zPrev[j]            = 0;  // top row
                    this.z[Nm1 * N + j]  = 0;  this.zPrev[Nm1 * N + j]  = 0;  // bottom row
                }
                for (let i = 0; i < N; i++) {
                    this.z[i * N]        = 0;  this.zPrev[i * N]        = 0;  // left col
                    this.z[i * N + Nm1]  = 0;  this.zPrev[i * N + Nm1]  = 0;  // right col
                }

            } else if (type === 'setOutput') {
                this.outNx = Math.max(0, Math.min(1, e.data.nx ?? 0.35));
                this.outNy = Math.max(0, Math.min(1, e.data.ny ?? 0.35));
            }
        };
    }

    /** Allocate (or reallocate) all physics arrays for an N×N grid. */
    _allocArrays(N) {
        const sz   = N * N;
        this.z     = new Float32Array(sz);   // current displacements
        this.zPrev = new Float32Array(sz);   // previous displacements (Verlet)
        this.zNew  = new Float32Array(sz);   // scratch buffer
        // Boundary nodes remain zero throughout — they are never written in the
        // inner loop, so their initial zero value is preserved by the buffer rotation.
    }

    process(inputs, outputs, parameters) {
        const outputChannel = outputs[0]?.[0];
        if (!outputChannel) return true;

        const k    = parameters.stiffness[0];
        const d    = parameters.damping[0];
        const N    = this.N;
        const Nm1  = N - 1;
        const z    = this.z;
        const zPrev = this.zPrev;
        const zNew  = this.zNew;

        // Audio output node index (clamp to interior — boundary is always zero)
        const outI   = Math.min(Nm1 - 1, Math.max(1, Math.round(this.outNy * Nm1)));
        const outJ   = Math.min(Nm1 - 1, Math.max(1, Math.round(this.outNx * Nm1)));
        const outIdx = outI * N + outJ;

        // ── Process 128 samples ─────────────────────────────────────────────
        for (let s = 0; s < 128; s++) {

            // 2D Verlet update — interior nodes only.
            // Boundary nodes are never written, so their values stay zero.
            // The inner-loop stencil: acc = k*(top + bottom + left + right - 4·centre)
            for (let i = 1; i < Nm1; i++) {
                const iN    = i * N;
                const iN_up = iN - N;   // (i-1)*N
                const iN_dn = iN + N;   // (i+1)*N
                for (let j = 1; j < Nm1; j++) {
                    const idx = iN + j;
                    const acc = k * (z[iN_up + j] + z[iN_dn + j] +
                                     z[idx - 1]   + z[idx + 1]   - 4.0 * z[idx]);
                    zNew[idx] = z[idx] * (2.0 - d) - zPrev[idx] * (1.0 - d) + acc;
                }
            }

            // Audio output at the configured interior node
            outputChannel[s] = zNew[outIdx];

            // Rotate buffers: zPrev ← z ← zNew
            zPrev.set(z);
            z.set(zNew);
        }

        // ── Send N×N displacement snapshot (~43 times/sec) ─────────────────
        this.blockCount++;
        if (this.blockCount >= this.vizInterval) {
            this.blockCount = 0;
            // .slice() creates a new Float32Array and transfers its buffer,
            // avoiding the structured-clone copy that postMessage would otherwise make.
            const snap = this.z.slice();
            this.port.postMessage({ type: 'snapshot', data: snap }, [snap.buffer]);
        }

        return true;   // Keep processor alive
    }
}

registerProcessor('membrane-processor', MembraneProcessor);
