# Making Waves: Demo Apps User's Guide

## Overview

The Making Waves demo suite is a set of four interactive physics simulations, each modelling a different vibrating physical system. All four run the physics simulation at audio rate (44,100 times per second) so that the sound you hear *is* the simulation — there is no separate synthesis layer. What you see in the spectrum is exactly what the physics produces.

The four demos form a progression:

| Demo | System | Key physics |
|------|--------|-------------|
| **String** | Vibrating string under tension | Harmonic overtones, pluck position effects |
| **Bar** | Bending bar (marimba/xylophone key) | Inharmonic overtones, mallet hardness |
| **Membrane** | Square drumhead | 2D mode shapes, Chladni-like nodal patterns |
| **Whistle** | Acoustic tube with fipple mouthpiece | Resonance, reflection, self-sustaining feedback |

Each demo shows three instrument-specific views (what the object looks like while vibrating), an oscilloscope (time-domain waveform), a spectrum analyser (frequency content), and a tuner.

**Getting started with any demo:**
1. Click **Start Audio** — the simulation begins immediately and auto-fires a sample excitation.
2. Watch the physical view and spectrum settle.
3. Adjust sliders on the right-hand panel. All changes take effect immediately with no restart needed.
4. Click **Start Audio** again to pause; click once more to resume.

---

## 1. Vibrating String (`string_demo.html`)

### What it models

A string under uniform tension, clamped at both ends — think guitar string, piano wire, or monochord. The simulation models the string as a chain of point masses connected by springs. Both ends are pinned at zero displacement and cannot move.

When plucked, a string produces a **harmonic** series of overtones: if the fundamental is at frequency $f_1$, the overtones land at $2f_1$, $3f_1$, $4f_1$, … (slightly compressed by the discrete model, but very close to exact integer ratios). This is what gives stringed instruments their pitched, musical quality.

### What you see

- **String — Physical View:** The string displacement drawn as a rope. The translucent filled envelope shows the maximum excursion at each point; the bright white line is the instantaneous position. For a single mode, the envelope traces the mode shape (a smooth arch for the fundamental, two arches for the second harmonic, etc.).
- **Oscilloscope:** The displacement of the listening node over time. A steady tone produces a repeating waveform; decay is visible as the amplitude shrinks.
- **Spectrum:** Frequency content. Theory markers (coloured vertical lines) show where the first several modes should land given the current N and k settings. For a pluck near the midpoint you will see a strong fundamental and weaker harmonics; for a pluck near the end you will see a richer harmonic series.

### Controls

**String group**
- **Nodes (N):** Number of masses in the chain. More nodes → longer effective string → lower pitch at the same stiffness, and better spatial resolution of high modes. Default 30.
- **Stiffness (k):** The spring constant between masses. Higher k → higher wave speed → higher pitch. Log-scale slider. Default 0.15.
- **Damping:** Energy loss per sample. Low damping gives a long sustain (several seconds); high damping gives a dead, muffled sound. Log-scale slider.

**Pluck group**
- **Position:** Where along the string the pluck is centred, as a fraction of the string length (0 = left end, 1 = right end). *This is the most educational control.*
  - Plucking at **0.5 (midpoint)** zeroes all even harmonics — you hear a hollow, clarinet-like tone with only odd harmonics ($f_1, f_3, f_5, \ldots$).
  - Plucking at **0.33** zeroes the third harmonic and its multiples.
  - Plucking near **0.05 or 0.95** (close to an end) excites the richest harmonic series.
- **Width:** The spatial width of the pluck in node units. Narrow width (1–2) is a sharp, hard pluck exciting many harmonics; wide width (10–15) is a soft, thumb-pluck exciting mainly the fundamental. This is the string analogue of mallet hardness.
- **Amplitude:** Peak displacement of the pluck. Affects volume but not timbre (the system is linear).

**Audio Output group**
- **Volume:** Master output level.

### Things to try

1. **Pluck position sweep:** Drag Position from 0.05 to 0.50 slowly. Watch individual harmonics appear and disappear in the spectrum as they are alternately excited and zeroed.
2. **Mallet hardness:** Set Position to 0.30 (so several harmonics are present). Now drag Width from 1 to 15. The high harmonics disappear; the tone goes from bright to mellow.
3. **Node count and pitch:** Double N (keeping k fixed). The pitch drops by roughly an octave because the effective string length doubled.
4. **Long decay:** Set Damping to its minimum, pluck once, and watch the oscilloscope for several seconds.

---

## 2. Bending Bar (`bar_demo.html`)

### What it models

A free-free bar, such as a marimba key or xylophone bar — free at both ends, not clamped. The restoring force comes from the bar's resistance to bending (its stiffness), not from tension. Both ends are free to move, which gives a fundamentally different physics from the string.

The overtones of a free-free bar are **inharmonic**: they are not integer multiples of the fundamental. The exact ratios for the first three modes are approximately $1 : 2.76 : 5.40$. This stretched overtone series is the characteristic sound of bells, bars, and xylophones — pitched but with a distinctive ringing quality.

The two rigid-body modes (uniform translation and rotation of the whole bar) are mathematical solutions of the equations but are not physical vibrations. The simulation removes them automatically after each step, exactly as a real marimba bar is suspended at its nodal points so it can vibrate freely without translating or rotating.

### What you see

- **Bar — Physical View:** The bar deflection drawn as a rope-like curve with envelope fill. The two ends are free to move, unlike the string where they are pinned.
- **Oscilloscope and Spectrum:** Same layout as the string demo. Theory markers show the inharmonic mode frequencies; watch how they are *not* evenly spaced.

### Controls

**Bar group**
- **Nodes (N):** Number of masses. More nodes → lower pitch, more spatial detail, higher computational cost. Default 12 (enough to resolve the first five modes clearly).
- **Stiffness (EI):** Bending stiffness. Higher EI → stiffer bar → higher pitch. Physically corresponds to the Young's modulus × second moment of area. Log-scale slider.
- **Damping:** Same as the string. Marimba bars have low damping in wood, very low in metal.

**Strike group**
- **Position:** Where the mallet hits as a fraction of the bar length. Unlike the string, the ends are antinodes (maximum motion), not nodes.
  - Striking at the **centre (0.50)** excites only symmetric modes (1st, 3rd, 5th, …); asymmetric modes have a node at the centre.
  - Striking near an **end (0.05 or 0.95)** excites the fullest range of modes.
  - Striking at **0.22** (the nodal point of the second mode) silences the second mode, giving a cleaner fundamental.
- **Width:** Mallet width/hardness. Narrow → hard mallet → bright, many overtones. Wide → soft mallet → mellow, mainly fundamental. More musically important here than in the string demo because the bar's overtones are already inharmonic; adding many of them produces a more complex, bell-like sound.
- **Amplitude:** Peak strike displacement.

**Audio Output group**
- **Pick position:** Which node to use as the audio output. Moving the pick position changes the relative loudness of harmonics in the audio (not the physics), because different modes have different amplitudes at different positions. At 0.22 (first nodal point of mode 2) the second harmonic is attenuated in the audio even if it is present in the physics.
- **Volume:** Master output level.

### Things to try

1. **Inharmonic overtones:** Start audio, strike the bar near the end. Read the theory markers in the spectrum. Count the ratio of the second marker to the first — it should be approximately 2.76, not 2.0 as it would be for a string.
2. **Mallet width:** Set Position to 0.05, strike repeatedly while increasing Width. Hear the tone shift from metallic/bright to wooden/mellow.
3. **Nodal strike:** Set Position to 0.22 and strike. Compare the spectrum to a strike at 0.10. The second mode peak shrinks significantly.
4. **Pick position vs. strike position:** Strike at 0.10 to get a rich spectrum. Then drag Pick position while the bar rings. Hear how the audio timbre changes even though the physics (shown in the bar view and spectrum) has not changed.

---

## 3. Vibrating Membrane (`membrane_demo.html`)

### What it models

A square drumhead, clamped at all four edges. The membrane is modelled as a 2D grid of point masses connected to their four nearest neighbours by equal springs. All edges are pinned at zero displacement.

The mode shapes of a square membrane are products of two sine waves — one in each direction. A mode is identified by a pair of integers $(m, n)$: mode $(1,1)$ is the fundamental (one arch in each direction); mode $(1,2)$ has one arch horizontally and two vertically; mode $(2,2)$ has a cross of nodal lines through the centre, and so on.

The overtone ratios depend on $\sqrt{m^2 + n^2}$, which takes values $\sqrt{2},\,\sqrt{5},\,\sqrt{8},\,3,\ldots$ — not integer multiples of anything. This strong inharmonicity is why drums sound non-pitched: the ear cannot fuse inharmonic overtones into a single perceived pitch.

Modes $(m, n)$ and $(n, m)$ with $m \neq n$ have the same frequency (**degenerate modes**). Striking off-centre will excite both degenerate partner modes at once, producing diagonal nodal patterns.

### What you see

- **Membrane — Physical View (colour map):** A 2D colour map of the instantaneous displacement: warm colours (red–orange) for positive displacement, cool colours (blue) for negative, neutral grey for zero. Nodal lines — where the membrane does not move — appear as grey bands dividing the coloured regions. At N ≥ 30 these are clearly resolved.
- An optional **isometric 3D view** (toggle button above the canvas) tilts the colour map into a perspective surface for a more spatial impression.
- **Oscilloscope and Spectrum:** Same as other demos. The spectrum shows a cluster of inharmonic peaks; theory markers identify the $(m,n)$ mode labels.

### Controls

**Membrane group**
- **Grid (N):** The membrane is an N×N grid. Larger N gives better spatial resolution of nodal patterns and lower pitch, at higher computational cost. Default 50.
- **Stiffness (k):** Spring constant. Higher k → lower effective mass-density → higher pitch. The stability limit is k ≤ 0.5 (twice the string limit, because each node has four neighbours instead of two).
- **Damping:** Energy loss per step. Real drumheads have fairly high damping (the drum goes "thud" not "bong").

**Strike group**
- **Width:** 2D Gaussian mallet width in node units. Narrow → percussive attack with many high modes; wide → soft strike exciting mainly the fundamental.
- **Amplitude:** Peak strike displacement.
- **Strike location:** Click or tap anywhere on the membrane colour map to strike at that point. The cursor position sets the strike location; you do not use a slider for this.

**Audio Output group**
- **Listen X / Listen Y:** Which node (as normalised $[0,1]$ coordinates) is used for audio output. Moving the listening point changes which modes dominate in the audio (different modes have zero amplitude at different locations). Placing the listener at $(0.5, 0.5)$ (centre) hears symmetric modes clearly but misses antisymmetric ones.
- **Volume:** Master output level.

### Things to try

1. **Fundamental mode shape:** Set N to 30, k to 0.10. Click the centre of the membrane. You should see a single arch — red in the centre, cool at the edges — pulsing in and out. This is the $(1,1)$ fundamental.
2. **Nodal lines:** Click near $(0.25, 0.5)$ (left of centre). You excite a mixture of modes. Watch the colour map for the grey line that stays stationary while the colours on either side oscillate — this is a nodal line.
3. **Degenerate modes and diagonal patterns:** Click at $(0.25, 0.25)$ (near a corner, off-axis). The $(1,2)$ and $(2,1)$ modes are excited together and the nodal pattern is diagonal rather than axis-aligned.
4. **Listening position:** Strike the centre, then slowly drag both Listen X and Listen Y. At $(0.5, 0.5)$ you hear the $(1,1)$ strongly; move toward an edge and higher modes become more audible.
5. **Inharmonic spectrum:** Compare peaks in the spectrum against the theory markers. Note the ratios are not $1:2:3$ but approximately $1:1.58:2:2.24:2.55:3$.

---

## 4. Fipple Whistle (`whistle_demo.html`)

### What it models

A cylindrical air column excited by a fipple mouthpiece — the same basic mechanism as a recorder, tin whistle, or pennywhistle. The air column is modelled as a Verlet spring chain (the same physics as the string demo), where the spring stiffness now represents the bulk elasticity of air rather than a physical tension. The left end represents the mouthpiece and is always pinned. The right end is controlled by the reflection coefficient R.

The fipple feedback mode models the aeroacoustic feedback loop of a real whistle: the air jet from the windway is steered by the pressure field already present in the tube, which reinforces the dominant resonance of the tube and sustains a steady tone.

### What you see

- **Acoustic Tube — Pressure Bulge / Pinch:** A tube whose width varies with local air pressure. Where the tube *bulges* outward, the air is compressed (high pressure). Where it *pinches* inward, the air is rarefied (low pressure). The junction between the tube segment and the radiation zone is marked by a green dashed vertical line; the amber region to its right shows energy radiating outward.
- **String — Displacement View:** The same data shown as a rope (familiar from the string demo). Blue tint = tube segment; amber = radiation zone.
- **Wave Components (p⁺ / p⁻):** Two strips showing the rightward-travelling ($p^+$) and leftward-travelling ($p^-$) components of the wave separately. A standing wave appears as two equal-amplitude mirror images, one in each strip.
- **Oscilloscope, Spectrum, Tuner:** Same as other demos. The spectrum shows the harmonic structure of the resonating tube.

### Excitation modes

Select the excitation mode using the five buttons (Impulse, Sweep, Fipple, Sine, Manual):

- **Impulse:** Fires a single clean pressure pulse from the mouthpiece end. The pulse travels to the junction, partially reflects, returns to the mouthpiece end, and repeats. Each traversal you can see in the wave strips. Good for observing the reflection coefficient and the radiation zone.
- **Sweep:** Continuously drives the left end with a sinusoid whose frequency rises from f₀ to f₁ over a set duration. Watch the tube build a standing wave as the drive passes through each resonant frequency, then collapse again as the drive moves past it. Pedagogically shows that the tube has preferred frequencies and rejects off-resonance excitation.
- **Fipple:** Self-sustaining feedback — the simulation of blowing. The tube finds its own resonance and locks onto it. The tone builds over about 0.5–1 second from the initial seed impulse, then holds steady. This is the mode to use for listening to the instrument.
- **Sine:** Drives the left end with a steady sinusoid at a manually set frequency. Useful for comparing with the spectrum theory markers and confirming which frequency resonates most strongly.
- **Manual:** Hold the "Hold to Blow" button to inject steady pressure. Release to stop.

### Controls

**Excitation group** (shown/hidden depending on selected mode)

*Fipple mode:*
- **Breath gain (G):** Strength of the aeroacoustic feedback. Higher G drives the tube harder. Very high G can cause harmonic distortion; very low G produces a slow, quiet build-up. The AGC in the audio output compensates for amplitude differences, so the most audible effect of G is on the attack transient speed.
- **Saturation (ε):** The velocity threshold at which the feedback saturates. Lower ε means the drive clips sooner and injects more harmonic content; higher ε keeps the drive more linear. Both are log-scale sliders.

*Sweep mode:*
- **f₀ / f₁:** Start and end frequency of the sweep in Hz.
- **Duration:** Time in seconds for one complete sweep.

*Sine mode:*
- **Frequency:** Drive frequency in Hz.
- **Amplitude:** Drive amplitude.

**Tube group**
- **Resolution (N):** Total number of simulation nodes (tube + radiation zone). More nodes → lower pitch at fixed stiffness, better spatial resolution. Log-scale slider.
- **Stiffness k₁:** The pneumatic spring constant of the air column. Higher k₁ → faster wave speed → higher pitch. Log-scale slider. This is the primary pitch control — analogous to tube length in a real instrument.
- **Damping:** Energy loss per sample. Low damping → long resonance sustain; high damping → weak resonance.
- **Slow Motion:** Slows the physics by factor M (1× to 1000×), dropping the pitch by $\log_2 M$ octaves. At M > 20 the audio is muted to prevent aliasing, but the visualizations continue running in slow motion. Useful for watching a single pulse travel the tube.

**End Termination group**
- **Tube Length:** The fraction of total nodes that form the active tube segment (the rest is the radiation zone display). This is the primary physical-length control — moving it left shortens the tube and raises the pitch, analogous to opening a finger hole.
- **Reflection R:** Controls what happens at the tube's open end.
  - **R = −1 (open end):** Full reflection with sign inversion — a pressure antinode becomes a pressure node at the boundary. All harmonic modes ($f_1, f_2, f_3, \ldots$) are present. This models a flute or recorder.
  - **R = +1 (closed end):** Full reflection without sign inversion — a displacement antinode at the boundary. Odd harmonics only ($f_1, f_3, f_5, \ldots$). This models a clarinet or capped tube.
  - **R = 0:** Anechoic — the wave is fully absorbed at the junction with no reflection. Very weak or no resonance.
  - Values between −1 and 0 model a leaky open end with partial radiation.

**Audio Output group**
- **Volume:** Master output level.

**Theory group**
- Shows the calculated theoretical frequencies for the first three resonant modes given the current N, k₁, R, and Slow Motion settings. The spectrum markers are drawn at these exact frequencies. The note below the frequencies tells you whether all harmonics or only odd harmonics are present.

### Things to try

1. **Single impulse, watch the wave travel:** Set Slow Motion to about 10×–100× (audio mutes). Fire an Impulse. In the Wave Components strips, watch a blob in the p⁺ strip travel rightward, shrink as it passes the junction (some is transmitted, some reflected), and the reflected portion appear in the p⁻ strip travelling leftward.

2. **Reflection coefficient, open vs. closed:** In Impulse mode, fire a pulse with R = −0.90 and observe the sign of the echo in the p⁻ strip (it should be inverted — cold colour returns where a warm one left). Now set R = +0.90 and repeat. The echo now returns with the same sign.

3. **All harmonics vs. odd only:** Start Fipple mode with R = −0.90. Look at the spectrum and count the peaks — you should see $f_1, f_2, f_3, \ldots$ approximately evenly spaced. Now change R to +0.90. The spectrum changes: peaks at $f_2, f_4, f_6, \ldots$ disappear and you are left with only the odd harmonics (more widely spaced). The pitch perceived by the tuner jumps up.

4. **Finger hole — tube length:** In Fipple mode with R = −0.90, slowly drag the Tube Length slider from 0.40 toward 0.20. The pitch rises continuously, exactly as shortening a tube by opening a finger hole raises the pitch of a recorder.

5. **Sweep through resonance:** Switch to Sweep mode. Set f₀ to 200 Hz, f₁ to 800 Hz, Duration to 6 seconds. Start the sweep and watch the bulge/pinch view. Each time the drive frequency crosses a resonant mode of the tube you will see the tube "light up" with a standing wave pattern for a moment, then go quiet again.

6. **Mode-locking geometry:** Switch to Fipple mode, set R = +1.0 (closed end). The simulation locks to the second mode ($f_2$), not the fundamental. This happens because the fipple injection point (at 1/3 of the tube length) coincides with an antinode of mode 2 in a fixed-free tube, giving it stronger coupling than mode 1. This is the same physics that causes a capped PVC whistle to jump to a higher pitch than the open-end version.
