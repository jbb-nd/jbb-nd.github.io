/**
 * whistle-worklet.js
 * AudioWorklet processor for a 1D Verlet acoustic tube with direct-R junction model.
 * Runs at audio rate (44100 Hz) inside the dedicated audio thread.
 *
 * Physics model:
 *   - N-node Verlet spring chain; z[0] = 0 always (rigid closed left wall)
 *   - Segment 1 (tube): nodes 1..J-2 evolve under Verlet with stiffness k1
 *   - Node J-1 (last tube node) uses ghost node z[J] = R * z[J-1] as right neighbour
 *   - Direct-R junction: R ∈ [−1, +1]; R ≈ −1 → open end; R ≈ +1 → closed end
 *   - Nodes J..N-1 are NOT updated in the worklet; segment-2 radiation is a
 *     visualization-only display buffer maintained in the main thread
 *
 *   Verlet step (per sample, for i = 1..J-1):
 *     z_new[i] = z[i]*(2−d) − z_prev[i]*(1−d) + k1*(z[i−1] − 2*z[i] + z[i+1])
 *   where z[J] = R*z[J−1] (ghost node, set before the loop)
 *
 *   CFL stability: k1 ≤ 0.249 (hard AudioParam limit)
 *
 * d'Alembert decomposition (approximate, at snapshot time):
 *   pPlus[i]  = 0.5 * (2*z[i] − z_prev[i])    rightward-travelling component
 *   pMinus[i] = 0.5 * z_prev[i]               leftward-travelling component
 *
 * Default parameters:
 *   N = 60, k1 = 0.20, junctionFrac = 0.40 → J = 24, R = −0.90, damping = 0.0002
 *   → f1 ≈ 440 Hz (A4)
 *
 * AudioParams (k-rate):
 *   stiffness   — k1 spring stiffness (default 0.20, range 0.001–0.249)
 *   reflectionR — direct reflection coefficient at junction (default −0.90, −1.0–+1.0)
 *   damping     — per-sample energy loss coefficient (default 0.0002, 0.0–0.01)
 *
 * Messages received from main thread:
 *   { type: 'setN',        n: int }
 *   { type: 'setJunction', frac: float }      J = clamp(round(frac*(N−1)), 3, N−2)
 *   { type: 'setMode',     mode: string }     'impulse'|'sweep'|'fipple'|'sine'|'manual'
 *   { type: 'pulse',       amp?: float }      fire one Gaussian impulse (any mode)
 *   { type: 'setSweep',    f0: Hz, f1: Hz, duration: s }
 *   { type: 'setFipple',   gain: float, eps: float }
 *   { type: 'setSine',     freq: Hz, amp: float }
 *   { type: 'setManual',   on: bool, amp?: float }
 *
 * Messages sent to main thread:
 *   { type: 'snapshot', z: Float32Array(J), pPlus: Float32Array(J), pMinus: Float32Array(J) }
 *   (every 8 blocks ≈ 43 times/sec; all three ArrayBuffers are transferred)
 */

class WhistleProcessor extends AudioWorkletProcessor {

    static get parameterDescriptors() {
        return [
            {
                name: 'stiffness',
                defaultValue: 0.20,
                minValue: 0.001,
                maxValue: 0.249,   // Hard CFL limit
                automationRate: 'k-rate'
            },
            {
                name: 'reflectionR',
                defaultValue: -0.90,
                minValue: -1.0,
                maxValue: 1.0,
                automationRate: 'k-rate'
            },
            {
                name: 'damping',
                defaultValue: 0.0002,
                minValue: 0.0,
                maxValue: 0.01,
                automationRate: 'k-rate'
            }
        ];
    }

    constructor() {
        super();

        // Physics state
        this.N = 60;
        this.J = 24;  // junctionFrac = 0.40: J = round(0.40*(60−1)) = 24
        this._alloc();

        // Cached k1 for use inside message-handler calls (updated each process())
        this._k1 = 0.20;

        // Sub-stepping for slow motion (M=1 → real-time; M=1000 → 1000× slower)
        this.subSteps    = 1;
        this.stepCounter = 0;
        this._audioVal   = 0; // held audio value between Verlet steps

        // AGC: exponential follower on |z[audioIdx]|; normalises audio output
        // to ~0.7 amplitude regardless of physics scale.  Time constant ~5000
        // samples (0.11 s) — fast enough to catch fipple build-up without
        // audibly pumping the gain on each oscillation cycle.
        this._ampEst = 0.01; // initialised small so gain starts near 1

        // Visualization throttle
        this.blockCount  = 0;
        this.vizInterval = 8; // ~43 snapshots/sec

        // Mode
        this.mode = 'impulse';

        // Fipple state — continuous van der Pol feedback
        this.fippleGain = 0.001;  // breath gain G: energy injected per Verlet step
        this.fippleEps  = 0.0005; // velocity saturation threshold ε_v (velocity units
                                  //   ≈ 2πf₁/f_s × displacement ≈ 6% of displacement)

        // Precomputed Gaussian injection profile (depends only on J; recalculated on J change)
        this._fippleNodes   = null;  // Int32Array of node indices
        this._fippleWeights = null;  // Float32Array of normalised Gaussian weights
        this._computeFippleWeights();

        // Sweep state
        this.sweepOn      = false;
        this.sweepF0      = 200;      // Hz start frequency
        this.sweepF1      = 600;      // Hz end frequency
        this.sweepDur     = 4.0;      // seconds per sweep
        this.sweepPhase   = 0.0;      // radians
        this.sweepSample  = 0;        // current sample within sweep

        // Sine state
        this.sineOn    = false;
        this.sineFreq  = 440;         // Hz
        this.sineAmp   = 0.08;
        this.sinePhase = 0.0;

        // Manual state
        this.manualOn  = false;
        this.manualAmp = 0.08;

        // Auto-fire impulse at first process() call
        this._pendingAutoImpulse = true;

        // Message handler — runs on the audio thread; keep short
        this.port.onmessage = ({ data }) => {
            switch (data.type) {

                case 'setN': {
                    this.N = Math.max(8, Math.min(300, data.n));
                    // Keep J valid
                    this.J = Math.max(3, Math.min(this.N - 2, this.J));
                    this._alloc();
                    this._computeFippleWeights();
                    break;
                }

                case 'setJunction': {
                    const frac = Math.max(0.1, Math.min(0.9, data.frac));
                    this.J = Math.max(3, Math.min(this.N - 2,
                        Math.round(frac * (this.N - 1))));
                    this._computeFippleWeights();
                    break;
                }

                case 'setMode': {
                    this.mode    = data.mode;
                    this.sweepOn = false;
                    this.sineOn  = false;
                    this.manualOn = false;
                    if (data.mode === 'sweep') {
                        this.sweepOn    = true;
                        this.sweepSample = 0;
                        this.sweepPhase  = 0;
                    }
                    if (data.mode === 'sine') {
                        this.sineOn    = true;
                        this.sinePhase = 0;
                    }
                    if (data.mode === 'fipple') {
                        // Seed a small impulse so the feedback loop has something
                        // to latch onto.  Without this, z≡0 gives zero feedback forever.
                        this._fireImpulse(0.05);
                    }
                    break;
                }

                case 'pulse': {
                    this._fireImpulse(data.amp ?? 1.0);
                    break;
                }

                case 'setSweep': {
                    this.sweepF0  = data.f0       ?? 200;
                    this.sweepF1  = data.f1       ?? 600;
                    this.sweepDur = data.duration ?? 4.0;
                    if (this.mode === 'sweep') {
                        this.sweepSample = 0;
                        this.sweepPhase  = 0;
                    }
                    break;
                }

                case 'setFipple': {
                    this.fippleGain = data.gain ?? 0.001;
                    this.fippleEps  = data.eps  ?? 0.0005;
                    break;
                }

                case 'setSine': {
                    this.sineFreq  = data.freq ?? 440;
                    this.sineAmp   = data.amp  ?? 0.08;
                    this.sinePhase = 0;
                    break;
                }

                case 'setManual': {
                    this.manualOn  = data.on  ?? false;
                    this.manualAmp = data.amp ?? 0.08;
                    break;
                }

                case 'setSubSteps': {
                    this.subSteps    = Math.max(1, Math.min(10000, Math.round(data.steps)));
                    this.stepCounter = 0; // resync phase
                    break;
                }

                case 'clear': {
                    // Zero all physics state — parameters and mode are unchanged
                    this.z.fill(0);
                    this.zPrev.fill(0);
                    this.zNew.fill(0);
                    this._audioVal    = 0;
                    this._ampEst      = 0.01; // reset AGC so gain recovers quickly after clear
                    this.stepCounter  = 0;
                    break;
                }
            }
        };
    }

    /**
     * Precompute normalised Gaussian injection weights for fipple feedback.
     * Called whenever J changes (construction, setN, setJunction).
     *
     * Spatial Gaussian centred at round(J/3) with σ = 3 nodes:
     *   - Mode 1:  spatial coupling ≈ 0.89 × sin(π/3) — nearly full strength
     *   - Mode 3:  exactly 0 (injection centre at J/3 → sin(3π/J × J/3) = sin(π) = 0)
     *   - Mode 5:  ~3% residual (spatial LP suppresses high-k content by 97%)
     *   - Mode 11: ~1% residual (exponential Gaussian roll-off in k-space)
     * Weights are normalised so total injected energy equals the single-node case.
     */
    _computeFippleWeights() {
        const J      = this.J;
        const sigma  = 3.0;
        const centre = Math.max(3, Math.min(J - 4, Math.round(J / 3)));
        const lo     = Math.max(1, Math.round(centre - 3 * sigma));
        const hi     = Math.min(J - 2, Math.round(centre + 3 * sigma));

        const ns = [], ws = [];
        let wSum = 0;
        for (let i = lo; i <= hi; i++) {
            const di = i - centre;
            const w  = Math.exp(-(di * di) / (2.0 * sigma * sigma));
            ns.push(i);
            ws.push(w);
            wSum += w;
        }
        for (let k = 0; k < ws.length; k++) ws[k] /= wSum;
        this._fippleNodes   = new Int32Array(ns);
        this._fippleWeights = new Float32Array(ws);
    }

    /** (Re-)allocate z, zPrev, zNew arrays for current N. */
    _alloc() {
        // Length N covers all physics nodes 0..J-1 plus the ghost slot at J.
        // Since J ≤ N−2, z[J] is always a valid index within length N.
        this.z     = new Float32Array(this.N);
        this.zPrev = new Float32Array(this.N);
        this.zNew  = new Float32Array(this.N);
    }

    /**
     * Inject a rightward-biased Gaussian impulse near the left wall.
     * Velocity bias: zPrev[i] = z[i] * (1 − √k1) → clean single rightward pulse.
     *
     * Width is chosen to minimise numerical dispersion: a narrow Gaussian
     * (σ ≈ 1 node) contains significant energy near the spatial Nyquist where
     * the Verlet dispersion relation is nonlinear, producing a dispersive
     * oscillatory wake behind the pulse.  A wider Gaussian (σ ≈ 3 nodes) keeps
     * most energy at long wavelengths where the chain is nearly dispersion-free.
     * Fill range extends to 3σ = 9 nodes so the Gaussian is not abruptly clipped.
     */
    _fireImpulse(amp) {
        const sqrtK  = Math.sqrt(this._k1);
        const J      = this.J;
        const sigma  = 3.0;                      // spatial width in nodes
        const centre = Math.max(1, Math.round(sigma));  // centre ≈ σ from left wall
        const limit  = Math.min(Math.round(centre + 3 * sigma) + 1, J - 1);

        for (let i = 1; i < limit; i++) {
            const dist = i - centre;
            const val  = amp * Math.exp(-(dist * dist) / (2.0 * sigma * sigma));
            this.z[i]     = val;
            this.zPrev[i] = val * (1.0 - sqrtK); // rightward bias
        }
        // Enforce pinned left wall
        this.z[0]     = 0.0;
        this.zPrev[0] = 0.0;
    }

    /**
     * Nominal period in samples for fipple timeout fallback.
     * Uses the exact discrete dispersion relation for a closed-open chain.
     * f1 ≈ (fs/π) · arcsin(√k1 · sin(π / (2·(J−0.5))))
     */
    process(inputs, outputs, parameters) {
        const out = outputs[0]?.[0];
        if (!out) return true;

        const k1 = parameters.stiffness[0];
        const R  = parameters.reflectionR[0];
        const d  = parameters.damping[0];

        // Cache k1 for _fireImpulse calls from the message handler
        this._k1 = k1;

        // Auto-fire impulse on first block
        if (this._pendingAutoImpulse) {
            this._pendingAutoImpulse = false;
            this._fireImpulse(1.0);
        }

        const J          = this.J;
        const { z, zPrev, zNew } = this;
        const audioIdx   = Math.max(1, Math.floor(J / 2));
        const M          = this.subSteps;

        for (let s = 0; s < 128; s++) {

            this.stepCounter++;

            if (this.stepCounter >= M) {
                this.stepCounter = 0;

                // ── Ghost node: set before Verlet so loop for i=J-1 sees it ──
                z[J] = R * z[J - 1];

                // ── Verlet update: nodes 1..J-1 ──────────────────────────────
                zNew[0] = 0.0;
                for (let i = 1; i < J; i++) {
                    const acc = k1 * (z[i - 1] - 2.0 * z[i] + z[i + 1]);
                    zNew[i] = z[i] * (2.0 - d) - zPrev[i] * (1.0 - d) + acc;
                }

                // ── Excitation injection ──────────────────────────────────────
                // Phase increments are multiplied by M so that drive frequencies
                // track physics time regardless of the sub-step ratio.

                if (this.mode === 'fipple') {
                    // Gaussian-spread van der Pol feedback.
                    // Monitor VELOCITY at J/2: velocity feedback = pure negative damping;
                    // it adds NO stiffness, so resonant frequencies are unshifted and
                    // peaks align with the theoretical values.
                    // (Position feedback would add stiffness → shift peaks upward.)
                    // Even harmonics have velocity nodes at J/2 → zero gain there.
                    // Inject via precomputed σ=3 Gaussian centred at J/3:
                    //   mode 3 exactly zeroed; modes 5,11,13,… suppressed ≥97%.
                    const monNode = Math.max(2, Math.min(J - 2, Math.round(J / 2)));
                    const vMon   = z[monNode] - zPrev[monNode]; // ≈ velocity (half-step)
                    const drive  = this.fippleGain * (vMon / (Math.abs(vMon) + this.fippleEps));
                    const fw = this._fippleWeights;
                    const fn = this._fippleNodes;
                    for (let k = 0; k < fn.length; k++) {
                        zNew[fn[k]] += drive * fw[k];
                    }

                } else if (this.mode === 'sweep' && this.sweepOn) {
                    // sweepSample counts Verlet steps; one sweep lasts sweepDur real seconds
                    const physLen = (this.sweepDur * sampleRate) / M;
                    const t    = Math.min(1.0, this.sweepSample / physLen);
                    const freq = this.sweepF0 * Math.pow(this.sweepF1 / this.sweepF0, t);
                    const inc  = (2 * Math.PI * freq * M) / sampleRate;
                    zNew[1]  += 0.12 * Math.sin(this.sweepPhase);
                    this.sweepPhase = (this.sweepPhase + inc) % (2 * Math.PI);
                    this.sweepSample++;
                    if (this.sweepSample >= physLen) {
                        this.sweepSample = 0;
                        this.sweepPhase  = 0;
                    }

                } else if (this.mode === 'sine' && this.sineOn) {
                    const inc = (2 * Math.PI * this.sineFreq * M) / sampleRate;
                    zNew[1] += this.sineAmp * Math.sin(this.sinePhase);
                    this.sinePhase = (this.sinePhase + inc) % (2 * Math.PI);

                } else if (this.mode === 'manual' && this.manualOn) {
                    zNew[1] += this.manualAmp;
                }

                // ── Rotate buffers ────────────────────────────────────────────
                zPrev.set(z);
                z.set(zNew);
                this._audioVal = z[audioIdx];
            }

            // ── Audio output: AGC-normalised, held value between Verlet steps ──
            // AGC follower tracks peak amplitude; gain = min(1, 0.7/estimate)
            // so loud fipple modes don't clip and quiet impulse modes aren't boosted
            // beyond unity.
            const absV = Math.abs(this._audioVal);
            this._ampEst += 0.0002 * (absV - this._ampEst);
            out[s] = this._audioVal * Math.min(1.0, 0.7 / Math.max(this._ampEst, 0.001));
        }

        // ── Visualization snapshot (throttled to ~43/sec) ─────────────────
        if (++this.blockCount >= this.vizInterval) {
            this.blockCount = 0;

            const J         = this.J; // re-read in case it changed during the block
            const snapZ     = new Float32Array(J);
            const snapPlus  = new Float32Array(J);
            const snapMinus = new Float32Array(J);

            for (let i = 0; i < J; i++) {
                snapZ[i]     = z[i];
                snapPlus[i]  = 0.5 * (2.0 * z[i] - zPrev[i]);
                snapMinus[i] = 0.5 * zPrev[i];
            }

            this.port.postMessage(
                { type: 'snapshot', z: snapZ, pPlus: snapPlus, pMinus: snapMinus },
                [snapZ.buffer, snapPlus.buffer, snapMinus.buffer]
            );
        }

        return true; // Keep processor alive
    }
}

registerProcessor('whistle-processor', WhistleProcessor);
