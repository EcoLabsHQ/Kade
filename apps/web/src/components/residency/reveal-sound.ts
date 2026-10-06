'use client';

/**
 * The reveal sound cues, synthesized with the Web Audio API.
 *
 * There is no audio asset, no dependency and no licensing question: a short,
 * soft two-note cue for the standard reveal and a slightly richer arpeggio for
 * the one-time celebration. Both are low-gain (per-note peak 0.10–0.14), with a
 * soft attack and an exponential release, so the cue is a gentle punctuation
 * rather than a fanfare.
 *
 * Failure is always silent. If Web Audio is missing, the context is blocked by
 * the browser's autoplay policy, or any node throws, the reveal is completely
 * unaffected: every path is wrapped and a missing context is a no-op. The mute
 * preference is persisted in `localStorage` (default: sound on, since the human
 * asked for sound).
 */

const MUTED_KEY = 'kade.reveal.sound.muted';

export type RevealSoundTier = 'standard' | 'celebration';

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

/** Whether the resident has muted the reveal sound. Defaults to `false`. */
export function isRevealSoundMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    // Storage can be unavailable (private mode); treat that as unmuted.
    return false;
  }
}

/** Persist the mute preference. */
export function setRevealSoundMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (muted) window.localStorage.setItem(MUTED_KEY, '1');
    else window.localStorage.removeItem(MUTED_KEY);
  } catch {
    // The in-memory control still works; the preference just will not persist.
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

/** E5 → B5, a soft open fifth. */
const STANDARD_NOTES: readonly Note[] = [
  { frequency: 659.25, start: 0, duration: 0.42, peak: 0.14 },
  { frequency: 987.77, start: 0.08, duration: 0.5, peak: 0.1 },
];

/** A C-major arpeggio, still brief and low-gain. */
const CELEBRATION_NOTES: readonly Note[] = [
  { frequency: 523.25, start: 0, duration: 0.5, peak: 0.13 },
  { frequency: 659.25, start: 0.1, duration: 0.5, peak: 0.13 },
  { frequency: 783.99, start: 0.2, duration: 0.55, peak: 0.14 },
  { frequency: 1046.5, start: 0.32, duration: 0.8, peak: 0.12 },
];

function scheduleNotes(context: AudioContext, notes: readonly Note[]): void {
  const now = context.currentTime;
  const master = context.createGain();
  // Headroom so the summed notes never clip.
  master.gain.value = 0.9;
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
 * Play the reveal cue. Safe to call unconditionally: it is a no-op when muted,
 * when Web Audio is unavailable, or when anything throws.
 *
 * Autoplay policy: the context may start suspended until the page has received
 * a user gesture. Every reveal open follows a click (a claim click or a card
 * click) and the celebration auto-open runs in the effect right after that
 * click, so by the time we resume, the page has sticky activation and the
 * resume normally succeeds. If it does not, the notes stay queued on the
 * suspended context and simply never sound; the reveal is unaffected.
 */
export function playRevealSound(tier: RevealSoundTier): void {
  try {
    if (isRevealSoundMuted()) return;
    const context = getAudioContext();
    if (!context) return;
    if (context.state === 'suspended') {
      void context.resume().catch(() => {});
    }
    scheduleNotes(
      context,
      tier === 'celebration' ? CELEBRATION_NOTES : STANDARD_NOTES,
    );
  } catch {
    // Audio must never break the reveal.
  }
}
