/**
 * physics-lab.js
 * Shared infrastructure library for Making Waves physics demo apps.
 *
 * Exposes a single global: window.PhysicsLab
 *
 * Modules:
 *   PhysicsLab.AudioEngine   — AudioContext + WorkletNode + AnalyserNode setup
 *   PhysicsLab.Scope         — time-domain oscilloscope canvas
 *   PhysicsLab.Spectrum      — frequency-domain spectrum canvas
 *   PhysicsLab.Tuner         — note name + cents tuner display
 *   PhysicsLab.EnvelopeTracker — peak-hold envelope for 1D displacement arrays
 *   PhysicsLab.detectPeak    — parabolic interpolation peak finder
 *   PhysicsLab.resizeCanvas  — sync canvas pixel size to CSS layout size
 *   PhysicsLab.bindSlider    — wire <input type="range"> to badge + callback
 *
 * Usage: <script src="../lib/physics-lab.js"></script>
 * No build step required. Works from Live Server (HTTP).
 */

window.PhysicsLab = (() => {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    // Internal constants
    // ─────────────────────────────────────────────────────────────────────────
    const SAMPLE_RATE = 44100;
    const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

    // =========================================================================
    // AudioEngine
    // =========================================================================
    /**
     * Creates and wires the standard audio graph for a physics demo:
     *
     *   AudioWorkletNode  →  GainNode  →  AnalyserNode  →  destination
     *
     * Returns an "engine" object that every other PhysicsLab module accepts.
     */
    const AudioEngine = {

        /**
         * Create the full audio graph and return an engine descriptor.
         *
         * @param {object} opts
         * @param {string}  opts.workletUrl      Path to the AudioWorklet JS file.
         * @param {string}  opts.processorName   Name passed to AudioWorkletNode().
         * @param {object}  [opts.parameterData] Initial AudioParam values.
         * @param {object}  [opts.nodeOptions]   Extra AudioWorkletNode options.
         * @param {number}  [opts.fftSize=8192]  AnalyserNode FFT size.
         * @param {number}  [opts.smoothing=0.85] AnalyserNode time-domain smoothing.
         * @param {number}  [opts.initialGain=0.5] GainNode initial gain.
         *
         * @returns {Promise<AudioEngine~Engine>} engine object
         */
        async create({
            workletUrl,
            processorName,
            parameterData  = {},
            nodeOptions    = {},
            fftSize        = 8192,
            smoothing      = 0.7,
            initialGain    = 0.5
        }) {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: SAMPLE_RATE
            });

            await audioCtx.audioWorklet.addModule(workletUrl);

            const workletNode = new AudioWorkletNode(audioCtx, processorName, {
                numberOfInputs:   0,
                numberOfOutputs:  1,
                outputChannelCount: [1],
                parameterData,
                ...nodeOptions
            });

            const gainNode = audioCtx.createGain();
            gainNode.gain.value = initialGain;

            const analyser = audioCtx.createAnalyser();
            analyser.fftSize               = fftSize;
            analyser.smoothingTimeConstant = smoothing;

            // Wire graph: workletNode → analyser (analysis tap, pre-gain)
            //                        → gainNode → destination
            // Tapping before the gainNode ensures the spectrum always shows
            // the true physics signal regardless of volume or mute state.
            workletNode.connect(analyser);
            workletNode.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            // Pre-allocate read buffers (reused every animation frame)
            const timeDomainBuf = new Float32Array(fftSize);
            const frequencyBuf  = new Float32Array(analyser.frequencyBinCount);
            const binHz         = SAMPLE_RATE / fftSize;

            return {
                audioCtx,
                workletNode,
                gainNode,
                analyser,
                timeDomainBuf,
                frequencyBuf,
                binHz
            };
        },

        /**
         * Manage a Start / Stop / Resume button cycle.
         * Call on every button click.
         *
         * @param {AudioContext|null} audioCtx  Current context, or null if not yet created.
         * @param {HTMLButtonElement} btnEl
         * @param {object} labels  { start, stop, resume } — button text for each state.
         * @param {object} classes { start, stop, resume } — Bootstrap outline-* color.
         *
         *  The caller is responsible for creating the engine on first click (audioCtx===null).
         *  Pass the current audioCtx on subsequent clicks.
         *
         * @returns {string} 'create' | 'suspend' | 'resume'
         */
        cycleButton(audioCtx, btnEl, labels = {}, classes = {}) {
            const L = { start: 'Start Audio', stop: 'Stop Audio', resume: 'Resume Audio', ...labels };
            const C = { start: 'danger', stop: 'success', resume: 'warning', ...classes };

            if (!audioCtx) {
                // Will be created by caller — update button to reflect future state
                btnEl.textContent = L.stop;
                btnEl.className   = btnEl.className
                    .replace(/btn-outline-\w+/, `btn-outline-${C.stop}`);
                return 'create';
            }
            if (audioCtx.state === 'running') {
                audioCtx.suspend();
                btnEl.textContent = L.resume;
                btnEl.className   = btnEl.className
                    .replace(/btn-outline-\w+/, `btn-outline-${C.resume}`);
                return 'suspend';
            }
            audioCtx.resume();
            btnEl.textContent = L.stop;
            btnEl.className   = btnEl.className
                .replace(/btn-outline-\w+/, `btn-outline-${C.stop}`);
            return 'resume';
        }
    };

    // =========================================================================
    // Scope — time-domain oscilloscope
    // =========================================================================
    const Scope = {

        /**
         * Draw a time-domain waveform on a canvas element.
         * Uses a rising zero-crossing trigger so the waveform is
         * anchored at the same phase on every frame, eliminating swimming.
         *
         * @param {HTMLCanvasElement} canvas
         * @param {Float32Array}      timeBuf  From analyser.getFloatTimeDomainData()
         * @param {object}            [opts]
         * @param {string}  [opts.color='#4af']      Waveform stroke color.
         * @param {number}  [opts.lineWidth=1.5]
         * @param {number}  [opts.amplitude=0.45]    Fraction of canvas height for ±1.0
         * @param {number}  [opts.triggerFraction=0.5] Fraction of buffer to search
         *                                            for the trigger point (0.1–0.9).
         */
        draw(canvas, timeBuf, {
            color            = '#4af',
            lineWidth        = 1.5,
            amplitude        = 0.45,
            triggerFraction  = 0.5,
            displaySamples   = null   // if set, draw only this many samples after trigger
                                      // (zoom in on fewer cycles for a readable waveform)
        } = {}) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);

            // Equilibrium line
            ctx.strokeStyle = '#222';
            ctx.lineWidth   = 1;
            ctx.beginPath();
            ctx.moveTo(0, H/2);
            ctx.lineTo(W, H/2);
            ctx.stroke();

            // Rising zero-crossing trigger:
            // Search the first half of the buffer for a sample that crosses
            // zero upward (prev < 0, current >= 0). If none found, fall back
            // to index 0 so the display is never blank.
            const searchEnd = Math.floor(timeBuf.length * triggerFraction);
            let start = 0;
            for (let i = 1; i < searchEnd; i++) {
                if (timeBuf[i - 1] < 0 && timeBuf[i] >= 0) {
                    start = i;
                    break;
                }
            }

            // Draw one canvas-width worth of samples from the trigger point.
            // If displaySamples is set, limit to that many samples (zoomed view).
            const available = timeBuf.length - start;
            const drawCount = displaySamples
                ? Math.min(Math.round(displaySamples), available)
                : available;
            const step = W / drawCount;

            ctx.strokeStyle = color;
            ctx.lineWidth   = lineWidth;
            ctx.beginPath();
            for (let i = 0; i < drawCount; i++) {
                const x = i * step;
                const y = H/2 - timeBuf[start + i] * (H * amplitude);
                if (i === 0) ctx.moveTo(x, y);
                else         ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    };

    // =========================================================================
    // Spectrum — frequency-domain display
    // =========================================================================
    const Spectrum = {

        /**
         * Draw an FFT spectrum with optional theoretical frequency markers.
         *
         * @param {HTMLCanvasElement} canvas
         * @param {Float32Array}      freqBuf   From analyser.getFloatFrequencyData() (dBFS)
         * @param {number}            binHz     Hz per bin (sampleRate / fftSize)
         * @param {Array}             markers   [{freq: Hz, label: 'f1', color: '#ff4'}, ...]
         *                                      Frequencies are ignored if null or above display range.
         * @param {object}            [opts]
         * @param {number}  [opts.displayFraction=0.25]  Fraction of bins to display (0→Nyquist/4)
         * @param {number}  [opts.dBMin=-100]
         * @param {number}  [opts.dBMax=0]
         * @param {string|null} [opts.peakLabelId=null]  Element ID to write "Peak: 440.0 Hz" into.
         * @param {number|null} [opts.peakHz=null]       Detected peak (from detectPeak) for label.
         */
        draw(canvas, freqBuf, binHz, markers = [], {
            displayFraction = 0.25,
            dBMin           = -100,
            dBMax           = 0,
            peakLabelId     = null,
            peakHz          = null
        } = {}) {
            const ctx = canvas.getContext('2d');
            const W = canvas.width, H = canvas.height;

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, W, H);

            const displayBins = Math.floor(freqBuf.length * displayFraction);
            const maxFreq     = displayBins * binHz;
            const barW        = W / displayBins;

            // Spectrum bars
            for (let i = 1; i < displayBins; i++) {
                const norm = Math.max(0, (freqBuf[i] - dBMin) / (dBMax - dBMin));
                const h    = norm * H;
                ctx.fillStyle = `rgba(68, 170, 255, ${0.4 + norm * 0.6})`;
                ctx.fillRect(i * barW, H - h, barW - 0.5, h);
            }

            // Frequency markers
            markers.forEach(({ freq, label, color }, idx) => {
                if (!freq || freq > maxFreq) return;
                const x = (freq / maxFreq) * W;

                ctx.strokeStyle = color;
                ctx.lineWidth   = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, H);
                ctx.stroke();
                ctx.setLineDash([]);

                ctx.fillStyle = color;
                ctx.font      = '10px monospace';
                ctx.fillText(label, x + 2, 12 + idx * 14);
            });

            // Peak label
            if (peakLabelId) {
                const el = document.getElementById(peakLabelId);
                if (el) {
                    el.textContent = peakHz ? `Peak: ${peakHz.toFixed(1)} Hz` : '';
                }
            }
        }
    };

    // =========================================================================
    // Tuner
    // =========================================================================
    const Tuner = {

        /**
         * Update a tuner display.
         *
         * @param {object} els  { noteEl, centsEl, freqEl } — DOM elements (or IDs)
         * @param {number|null} freqHz  Detected peak frequency, or null for silence.
         */
        update(els, freqHz) {
            const noteEl  = typeof els.noteEl  === 'string' ? document.getElementById(els.noteEl)  : els.noteEl;
            const centsEl = typeof els.centsEl === 'string' ? document.getElementById(els.centsEl) : els.centsEl;
            const freqEl  = typeof els.freqEl  === 'string' ? document.getElementById(els.freqEl)  : els.freqEl;

            if (!freqHz || freqHz < 20) {
                if (noteEl)  { noteEl.textContent  = '--'; noteEl.style.color = '#444'; }
                if (centsEl)   centsEl.textContent = '--';
                if (freqEl)    freqEl.textContent  = '0.00 Hz';
                return;
            }

            if (freqEl) freqEl.textContent = `${freqHz.toFixed(1)} Hz`;

            const midi    = 12 * Math.log2(freqHz / 440) + 69;
            const noteIdx = Math.round(midi);
            const cents   = Math.round((midi - noteIdx) * 100);
            const octave  = Math.floor(noteIdx / 12) - 1;
            const name    = NOTE_NAMES[((noteIdx % 12) + 12) % 12];

            if (noteEl) {
                noteEl.textContent = `${name}${octave}`;
                noteEl.style.color = Math.abs(cents) < 10 ? '#4f4'
                                   : Math.abs(cents) < 30 ? '#af4' : '#4af';
            }
            if (centsEl) {
                centsEl.textContent = cents === 0 ? 'In tune'
                                    : (cents > 0  ? `+${cents}¢` : `${cents}¢`);
            }
        }
    };

    // =========================================================================
    // EnvelopeTracker
    // =========================================================================
    /**
     * Tracks the peak absolute displacement at each node in a 1D array.
     * On each update, values grow to meet new maxima and decay exponentially.
     * Used to draw the "lens-shaped" vibration envelope on string/bar visualizations.
     */
    class EnvelopeTracker {

        /**
         * @param {number} N               Initial number of nodes.
         * @param {number} decayPerUpdate  Multiplicative decay applied each time update()
         *                                 is called (~43/sec from worklet snapshots).
         *                                 0.9985 → ~6 s visual decay.
         */
        constructor(N = 50, decayPerUpdate = 0.9985) {
            this._peak = new Float32Array(N);
            this.decay = decayPerUpdate;
        }

        /** Resize and clear the peak array (call when N changes). */
        resize(N) {
            this._peak = new Float32Array(N);
        }

        /**
         * Update peak array from a new position snapshot.
         * @param {Float32Array} positions  Node positions from worklet.
         * @returns {Float32Array} The current peak array (same reference each call).
         */
        update(positions) {
            if (this._peak.length !== positions.length) {
                this.resize(positions.length);
            }
            const peak = this._peak;
            for (let i = 0; i < positions.length; i++) {
                peak[i] = Math.max(Math.abs(positions[i]), peak[i] * this.decay);
            }
            return peak;
        }

        /** Read-only access to the current peak array. */
        get peak() { return this._peak; }
    }

    // =========================================================================
    // detectPeak — parabolic interpolation on FFT magnitude
    // =========================================================================
    /**
     * Find the dominant peak frequency in a dBFS spectrum buffer.
     * Uses parabolic interpolation for sub-bin accuracy.
     *
     * @param {Float32Array} freqBuf       From analyser.getFloatFrequencyData()
     * @param {number}       binHz         Hz per bin.
     * @param {number}       [noiseFloor=-80]  Bins below this dBFS are ignored.
     * @returns {number|null} Peak frequency in Hz, or null if no clear peak.
     */
    function detectPeak(freqBuf, binHz, noiseFloor = -80) {
        let maxVal = -Infinity, maxBin = 1;
        for (let i = 2; i < freqBuf.length - 1; i++) {
            if (freqBuf[i] > maxVal) { maxVal = freqBuf[i]; maxBin = i; }
        }
        if (maxVal < noiseFloor) return null;

        // Parabolic interpolation
        const a = freqBuf[maxBin - 1];
        const b = freqBuf[maxBin];
        const c = freqBuf[maxBin + 1];
        const denom  = a - 2*b + c;
        const offset = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        return (maxBin + offset) * binHz;
    }

    // =========================================================================
    // resizeCanvas
    // =========================================================================
    /**
     * Sync a canvas's pixel dimensions to its current CSS layout size.
     * Call once per animation frame before drawing to avoid blurry canvases
     * after window/panel resize.
     *
     * @param {HTMLCanvasElement} canvas
     */
    function resizeCanvas(canvas) {
        const w = canvas.clientWidth  || 600;
        const h = parseInt(canvas.getAttribute('height')) || 150;
        if (canvas.width !== w)  canvas.width  = w;
        if (canvas.height !== h) canvas.height = h;
    }

    // =========================================================================
    // bindSlider
    // =========================================================================
    /**
     * Wire an <input type="range"> to a value-badge element and a callback.
     * Fires the callback immediately with the current value so the UI is
     * consistent on page load without requiring a separate initialization pass.
     *
     * @param {string}   inputId   ID of the <input type="range"> element.
     * @param {string}   badgeId   ID of the element that shows the current value.
     * @param {function} callback  Called with the parsed float value on every change.
     * @param {function} [fmt]     Formatter function: (value) => string.
     *                             Default: three decimal places.
     */
    function bindSlider(inputId, badgeId, callback, fmt = v => v.toFixed(3)) {
        const input = document.getElementById(inputId);
        const badge = document.getElementById(badgeId);
        if (!input) { console.warn(`bindSlider: #${inputId} not found`); return; }

        const fire = () => {
            const v = parseFloat(input.value);
            if (badge) badge.textContent = fmt(v);
            callback(v);
        };

        input.addEventListener('input', fire);
        // Initialize badge text from current slider value (no callback on load)
        if (badge) badge.textContent = fmt(parseFloat(input.value));
    }

    // =========================================================================
    // Public API
    // =========================================================================
    return {
        AudioEngine,
        Scope,
        Spectrum,
        Tuner,
        EnvelopeTracker,
        detectPeak,
        resizeCanvas,
        bindSlider,
        SAMPLE_RATE
    };

})();
