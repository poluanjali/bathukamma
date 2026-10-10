// Web Speech API wrapper for speech recognition and synthesis

export interface SpeechRecognitionHookResult {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  isSupported: boolean;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

// Global speech synthesis manager
class SpeechManager {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private voices: SpeechSynthesisVoice[] = [];
  public isSpeaking: boolean = false;
  private onStateChange: ((speaking: boolean) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
      this.loadVoices();
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    }
  }

  private loadVoices() {
    if (this.synth) {
      this.voices = this.synth.getVoices();
    }
  }

  public subscribe(cb: (speaking: boolean) => void) {
    this.onStateChange = cb;
  }

  public speak(text: string, voiceGender: 'female' | 'male' = 'female', rate: number = 1.0): Promise<void> {
    return new Promise((resolve) => {
      if (!this.synth) {
        resolve();
        return;
      }

      this.stop();

      // Clean markdown characters from spoken text
      const cleanText = text
        .replace(/`{1,3}[^`]*`{1,3}/g, 'code snippet')
        .replace(/[*_#\[\]\(\)]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!cleanText) {
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = rate;
      utterance.pitch = voiceGender === 'female' ? 1.05 : 0.95;

      // Try selecting a suitable English voice
      const availableVoices = this.voices.filter((v) => v.lang.startsWith('en'));
      if (availableVoices.length > 0) {
        if (voiceGender === 'female') {
          const female = availableVoices.find(
            (v) =>
              v.name.includes('Female') ||
              v.name.includes('Samantha') ||
              v.name.includes('Zira') ||
              v.name.includes('Google UK English Female') ||
              v.name.includes('Karen') ||
              v.name.includes('Victoria')
          );
          if (female) utterance.voice = female;
          else utterance.voice = availableVoices[0];
        } else {
          const male = availableVoices.find(
            (v) =>
              v.name.includes('Male') ||
              v.name.includes('David') ||
              v.name.includes('Google UK English Male') ||
              v.name.includes('Daniel') ||
              v.name.includes('Alex')
          );
          if (male) utterance.voice = male;
          else utterance.voice = availableVoices[0];
        }
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
        this.onStateChange?.(true);
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        this.onStateChange?.(false);
        resolve();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
        this.onStateChange?.(false);
        resolve();
      };

      this.currentUtterance = utterance;
      this.synth.speak(utterance);
    });
  }

  public stop() {
    if (this.synth) {
      this.synth.cancel();
      this.isSpeaking = false;
      this.onStateChange?.(false);
    }
  }
}

export const speechManager = new SpeechManager();

// Continuous Web Speech Recognition manager that keeps listening without stopping on pauses
export class ContinuousSpeechRecognizer {
  private recognition: any = null;
  public isRunning: boolean = false;
  public isListening: boolean = false;
  private onTranscript: (text: string, isFinal: boolean) => void;
  private onActivity?: (active: boolean) => void;
  private onError?: (error: string) => void;
  private baseText: string = '';
  private currentFinal: string = '';
  private currentInterim: string = '';
  private restartTimeout: any = null;

  public static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    );
  }

  constructor(
    onTranscript: (text: string, isFinal: boolean) => void,
    onActivity?: (active: boolean) => void,
    onError?: (error: string) => void
  ) {
    this.onTranscript = onTranscript;
    this.onActivity = onActivity;
    this.onError = onError;
  }

  private initRecognition(): any {
    if (typeof window === 'undefined') return null;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) return null;

    try {
      const rec = new SpeechRecognition();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      rec.lang =
        (typeof navigator !== 'undefined'
          ? navigator.languages?.[0] || navigator.language
          : 'en-US') || 'en-US';

      rec.onstart = () => {
        this.isListening = true;
        this.onActivity?.(true);
      };

      rec.onspeechstart = () => {
        this.onActivity?.(true);
      };

      rec.onspeechend = () => {
        this.onActivity?.(false);
      };

      rec.onresult = (event: any) => {
        if (!this.isRunning) return;
        this.onActivity?.(true);

        let finalAccumulator = '';
        let interimAccumulator = '';

        for (let r = 0; r < event.results.length; ++r) {
          const item = event.results[r];
          if (!item || !item[0]?.transcript) continue;
          const piece = item[0].transcript.trim();
          if (piece) {
            if (item.isFinal) {
              finalAccumulator = finalAccumulator ? `${finalAccumulator} ${piece}` : piece;
            } else {
              interimAccumulator = interimAccumulator ? `${interimAccumulator} ${piece}` : piece;
            }
          }
        }

        this.currentFinal = finalAccumulator;
        this.currentInterim = interimAccumulator;

        // Merge base text with this session's recognized words
        const parts = [this.baseText, finalAccumulator, interimAccumulator].filter(Boolean);
        const combined = parts.join(' ').replace(/\s+/g, ' ').trim();

        if (combined && this.isRunning) {
          this.onTranscript(combined, !interimAccumulator);
        }
      };

      rec.onerror = (event: any) => {
        const err = event.error;
        if (err !== 'no-speech' && err !== 'aborted') {
          console.warn('Speech recognition notice:', err);
          if (err === 'not-allowed' || err === 'service-not-allowed') {
            this.onError?.('Microphone permission blocked. Please allow mic access or use the "Convert Voice to Text" button.');
          } else if (err === 'network') {
            this.onError?.('Browser speech recognition network issue. Direct audio transcriber is active.');
          } else if (err === 'audio-capture') {
            this.onError?.('No microphone input detected. Please check your mic hardware settings.');
          }
        }
      };

      rec.onend = () => {
        this.isListening = false;
        if (!this.isRunning) {
          return;
        }

        // Commit finalized text into baseText before restarting
        if (this.currentFinal) {
          const merged = [this.baseText, this.currentFinal].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
          this.baseText = merged;
          this.currentFinal = '';
          this.currentInterim = '';
        }

        // Auto-restart with safe debounce
        if (this.isRunning) {
          clearTimeout(this.restartTimeout);
          this.restartTimeout = setTimeout(() => {
            if (this.isRunning && !this.isListening) {
              try {
                this.recognition = this.initRecognition();
                this.recognition?.start();
              } catch (e) {
                console.warn('Restart recognition caught:', e);
              }
            }
          }, 100);
        }
      };

      return rec;
    } catch (e) {
      console.warn('Speech recognition init error:', e);
      return null;
    }
  }

  public syncManualText(text: string) {
    this.baseText = text.trim();
    this.currentFinal = '';
    this.currentInterim = '';
  }

  public clear() {
    this.baseText = '';
    this.currentFinal = '';
    this.currentInterim = '';
  }

  public start(existingText: string = '') {
    this.isRunning = true;
    this.baseText = existingText.trim();
    this.currentFinal = '';
    this.currentInterim = '';
    clearTimeout(this.restartTimeout);

    try {
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch {}
      }
      this.recognition = this.initRecognition();
      if (this.recognition) {
        this.recognition.start();
        this.isListening = true;
      }
    } catch (e) {
      console.warn('Recognition start caught:', e);
    }
  }

  public stop() {
    this.isRunning = false;
    clearTimeout(this.restartTimeout);
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch (e) {}
    }
    this.isListening = false;
    this.onActivity?.(false);
  }
}
