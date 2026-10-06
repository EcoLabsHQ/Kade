'use client';

/**
 * The citizenship celebration sound, synthesized with the Web Audio API.
 *
 * There is no audio asset, no dependency and no licensing question: the cue is
 * built from oscillators. It is deliberately the ONLY reveal sound — it plays
 * on the one-time, live citizenship claim (the celebratory tier) and never on
 * the standard reveal, a re-open, or the residency pass.
 *
 * It is a short musical gesture shaped to the reveal's phases, not a blip: a
 * rising arpeggio that climbs with the card, a soft sustained root/fifth under
 * the bloom, two high sparkles as the light crosses, and a C-major triad that
 * resolves and rings out as the card settles. Everything is low-gain (per-note
 * peak 0.05–0.11, master 0.7), with a soft attack and an exponential release.
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
  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }
    scheduleNotes(context, CELEBRATION_NOTES);
  } catch {
    // Audio must never break the reveal.
  }
}
