'use client';

/**
 * The Colosseum reveal sounds, synthesized with the Web Audio API.
 *
 * There is no audio asset, no dependency and no licensing question: each cue is
 * built from oscillators. There are two of them, one per one-time milestone:
 *
 *   - {@link playCitizenshipCue} — the first, live citizenship claim (the
 *     celebratory tier). A bright C-major ascent.
 *   - {@link playResidencyCue} — the first, live residency claim. A warmer,
 *     lower G-major gesture, deliberately distinct from the citizenship cue
 *     while staying in the same synthesised family.
 *
 * Neither plays on a standard reveal or a re-open.
 *
 * Each is a short musical gesture shaped to its reveal's phases, not a blip:
 * a rising arpeggio that climbs with the card, a soft sustained pad under the
 * bloom, a high sparkle as the light crosses, and a triad that resolves and
 * rings out as the card settles. Everything is low-gain (per-note peak
 * 0.045–0.11, master 0.7), with a soft attack and an exponential release.
 *
 * Failure is always silent. If Web Audio is missing, the context is blocked by
 * the browser's autoplay policy, or any node throws, the reveal is completely
 * unaffected: every path is wrapped and a missing context is a no-op.
 */

let audioContext: AudioContext | null = null;

interface AudioContextConstructor {
  new (): AudioContext;
}

/**
 * Lazily create (and cache) one `AudioContext`. Returns null when Web Audio is
 * unavailable or the constructor throws. Creating a context per reveal would
 * exhaust the browser's small context limit, so a successful one is reused.
 */
function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  if (typeof window === 'undefined') return null;
  try {
    const globalWindow = window as unknown as {
      AudioContext?: AudioContextConstructor;
      webkitAudioContext?: AudioContextConstructor;
    };
    const Ctor = globalWindow.AudioContext ?? globalWindow.webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
    return audioContext;
  } catch {
    return null;
  }
}

interface Note {
  /** Frequency in Hz. */
  readonly frequency: number;
  /** Offset from the start of the cue, in seconds. */
  readonly start: number;
  /** How long the note rings, in seconds. */
  readonly duration: number;
  /** Per-note peak gain (the cue stays well under clipping). */
  readonly peak: number;
  readonly type?: OscillatorType;
}

/**
 * The celebration gesture, shaped to the ~2.4s animation:
 *   - ascent (0–0.9s): a rising C-major arpeggio that climbs with the card,
 *     ending on a high C as the card reaches its overshoot;
 *   - bloom (0.1–1.25s): a soft sustained C4/G4 pad under the ascent;
 *   - foil (1.0–1.65s): two high sparkles as the security light crosses;
 *   - settle (1.55–2.6s): a warm C-major triad that resolves and rings out.
 * Frequencies: C5 523.25, E5 659.25, G5 783.99, B5 987.77, C6 1046.5,
 * C4 261.63, G4 392.0, E6 1318.51, G6 1567.98.
 */
const CELEBRATION_NOTES: readonly Note[] = [
  // Ascent.
  { frequency: 523.25, start: 0.0, duration: 0.5, peak: 0.1 },
  { frequency: 659.25, start: 0.14, duration: 0.5, peak: 0.1 },
  { frequency: 783.99, start: 0.28, duration: 0.55, peak: 0.11 },
  { frequency: 987.77, start: 0.42, duration: 0.55, peak: 0.09 },
  { frequency: 1046.5, start: 0.56, duration: 0.6, peak: 0.11 },
  // Bloom pad.
  { frequency: 261.63, start: 0.1, duration: 1.15, peak: 0.06, type: 'triangle' },
  { frequency: 392.0, start: 0.2, duration: 1.05, peak: 0.05, type: 'triangle' },
  // Foil sparkles.
  { frequency: 1318.51, start: 1.0, duration: 0.5, peak: 0.05 },
  { frequency: 1567.98, start: 1.15, duration: 0.5, peak: 0.045 },
  // Settle.
  { frequency: 523.25, start: 1.55, duration: 0.9, peak: 0.09 },
  { frequency: 659.25, start: 1.6, duration: 0.9, peak: 0.09 },
  { frequency: 783.99, start: 1.65, duration: 0.95, peak: 0.09 },
];

/**
 * The residency-claim gesture, shaped to the ~2.2s residency reveal:
 *   - ascent (0–0.8s): a warm G-major arpeggio (G4–B4–D5–G5) that climbs with
 *     the card, deliberately lower and rounder than the citizenship cue;
 *   - bloom (0.1–1.3s): a soft sustained G3/D4 pad under the ascent;
 *   - foil (0.9–1.5s): one bright D6 lift as the security light crosses;
 *   - settle (1.5–2.6s): a G-major triad that resolves and rings out.
 * Frequencies: G4 392.0, B4 493.88, D5 587.33, G5 783.99, D6 1174.66,
 * G3 196.0, D4 293.66.
 */
const RESIDENCY_NOTES: readonly Note[] = [
  // Ascent.
  { frequency: 392.0, start: 0.0, duration: 0.5, peak: 0.1 },
  { frequency: 493.88, start: 0.13, duration: 0.5, peak: 0.1 },
  { frequency: 587.33, start: 0.26, duration: 0.55, peak: 0.11 },
  { frequency: 783.99, start: 0.4, duration: 0.6, peak: 0.1 },
  // Bloom pad.
  { frequency: 196.0, start: 0.08, duration: 1.2, peak: 0.06, type: 'triangle' },
  { frequency: 293.66, start: 0.18, duration: 1.1, peak: 0.05, type: 'triangle' },
  // Foil lift.
  { frequency: 1174.66, start: 0.9, duration: 0.5, peak: 0.045 },
  // Settle.
  { frequency: 392.0, start: 1.5, duration: 0.95, peak: 0.09 },
  { frequency: 493.88, start: 1.56, duration: 0.95, peak: 0.09 },
  { frequency: 587.33, start: 1.62, duration: 1.0, peak: 0.09 },
];

function scheduleNotes(context: AudioContext, notes: readonly Note[]): void {
  const now = context.currentTime;
  const master = context.createGain();
  // Headroom so the overlapping notes never clip.
  master.gain.value = 0.7;
  master.connect(context.destination);

  for (const note of notes) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = note.type ?? 'sine';
    oscillator.frequency.value = note.frequency;

    const start = now + note.start;
    const end = start + note.duration;
    // A short soft attack and an exponential release: never a hard edge.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.peak, start + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.onended = () => {
      try {
        gain.disconnect();
        oscillator.disconnect();
      } catch {
        // The node is already gone; nothing to do.
      }
    };
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }
}

/**
 * Play the one-time citizenship celebration cue. Safe to call unconditionally:
 * it is a no-op when Web Audio is unavailable or when anything throws.
 *
 * Autoplay policy: the context may start suspended until the page has received
 * a user gesture. The celebration auto-open runs in the effect right after the
 * "Become a Citizen" click, so by the time we resume the page has sticky
 * activation and the resume normally succeeds. If it does not, the notes stay
 * queued on the suspended context and simply never sound; the reveal is
 * unaffected.
 */
export function playCitizenshipCue(): void {
  playNotes(CELEBRATION_NOTES);
}

/**
 * Play the one-time residency-claim cue. The same contract as
 * {@link playCitizenshipCue}: safe to call unconditionally, a no-op when Web
 * Audio is unavailable, and it never throws into the reveal.
 *
 * The claim click is the user gesture that opens the reveal, so the page has
 * sticky activation by the time this runs and the context resume normally
 * succeeds.
 */
export function playResidencyCue(): void {
  playNotes(RESIDENCY_NOTES);
}

/** Shared, failure-silent playback for one cue. */
function playNotes(notes: readonly Note[]): void {
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }
    scheduleNotes(context, notes);
  } catch {
    // Audio must never break the reveal.
  }
}
