import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Sparkles, 
  Video, 
  VideoOff, 
  Clock, 
  CheckCircle2, 
  Loader2, 
  ChevronRight, 
  Play, 
  Monitor, 
  MonitorOff, 
  Bell, 
  ChevronDown, 
  Star, 
  ArrowRight, 
  ArrowLeft,
  Bot, 
  User, 
  Settings2, 
  Layers, 
  BarChart2, 
  FileText, 
  Target, 
  LayoutDashboard,
  ShieldCheck,
  AlertCircle,
  Maximize2,
  RefreshCw,
  FlipHorizontal,
  RotateCcw,
  Zap,
  Timer,
  Pause,
  LogOut
} from 'lucide-react';
import { ChatMessage, EvaluationReport, InterviewSession } from '../types';
import { speechManager, ContinuousSpeechRecognizer } from '../lib/speech';
import { saveReport } from '../lib/storage';
import { AI_AVATAR_IMG, CANDIDATE_AVATAR_IMG } from '../assets/images';

interface InterviewRoomProps {
  session: InterviewSession;
  onFinishInterview: (report: EvaluationReport) => void;
  onExit: () => void;
}

export const InterviewRoom: React.FC<InterviewRoomProps> = ({
  session,
  onFinishInterview,
  onExit,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [isFollowUpStep, setIsFollowUpStep] = useState(false);
  const [currentQuestion, setCurrentQuestion] = useState<{
    message: string;
    question: string;
    stage: string;
    isFollowUp?: boolean;
    hint?: string;
  }>({
    message: "Tell me about yourself and your journey into software development.",
    question: "Tell me about yourself and your journey into software development.",
    stage: "warmup",
    isFollowUp: false,
  });

  // Candidate Live Voice & Text State
  const [candidateText, setCandidateText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const recognizerRef = useRef<ContinuousSpeechRecognizer | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio / Speech State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Live Audio Meter (Mic Decibels)
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Auto-Submit on Silence Feature
  const [autoSubmitOnSilence, setAutoSubmitOnSilence] = useState(true);
  const [silenceThresholdSec, setSilenceThresholdSec] = useState(3.5);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const lastVoiceActivityRef = useRef<number>(Date.now());
  const lastSpeechApiUpdateRef = useRef<number>(0);
  const hasSpokenSinceLastTranscribeRef = useRef<boolean>(false);
  const isAutoSubmittingRef = useRef<boolean>(false);
  const cancelAutoSubmitForThisQuestionRef = useRef<boolean>(false);
  const [showEndInterviewConfirm, setShowEndInterviewConfirm] = useState(false);
  const [speechRecognitionNotice, setSpeechRecognitionNotice] = useState<string | null>(null);

  // Live Camera Access State
  const [cameraActive, setCameraActive] = useState(true);
  const [isMirrored, setIsMirrored] = useState(true); // Mirrors camera feed so lifting left hand matches left side
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraPermissionError, setCameraPermissionError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Permission Prompt State - Interview ONLY enters after user clicks OK
  const [isPermissionApproved, setIsPermissionApproved] = useState(
    Boolean(session.permissionsApproved)
  );
  const [showPermissionPrompt, setShowPermissionPrompt] = useState(false);

  // Entire Screen Sharing State
  const [screenShareActive, setScreenShareActive] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [showScreenModal, setShowScreenModal] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);

  // Countdown Timer (Default 2 minutes per question: 120 seconds -> 01:45)
  const [timeLeftSeconds, setTimeLeftSeconds] = useState(105);

  // Proctoring tab-switch telemetry
  const [tabSwitches, setTabSwitches] = useState(0);

  // Setup Web Audio Analyser for Real-time Microphone Equalizer
  const setupAudioAnalyser = (stream: MediaStream) => {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateAudioMeter = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalize volume 0 to 100
          const vol = Math.min(100, Math.round((avg / 128) * 100));
          setAudioVolume(vol);
          if (vol > 11) {
            lastVoiceActivityRef.current = Date.now();
            hasSpokenSinceLastTranscribeRef.current = true;
          }
          animFrameRef.current = requestAnimationFrame(updateAudioMeter);
        };
        updateAudioMeter();
      }
    } catch (e) {
      console.warn('Audio analyser initialization:', e);
    }
  };

  // Live Camera & Microphone Access Initializer with multi-tier audio fallback
  const startCameraAndMic = async () => {
    setCameraPermissionError(null);
    try {
      // Tier 1: High-res video + echo-cancelled noise-suppressed mic audio
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user',
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      setCameraStream(stream);
      setCameraActive(true);
      setShowPermissionPrompt(false);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setupAudioAnalyser(stream);
      recognizerRef.current?.start(candidateText);
      setIsListening(true);
      startAudioRecorder(stream);
    } catch (e: any) {
      console.warn('High-res camera/mic error, trying standard video + audio:', e);
      try {
        // Tier 2: Basic video + basic audio
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setCameraStream(stream);
        setCameraActive(true);
        setShowPermissionPrompt(false);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setupAudioAnalyser(stream);
        recognizerRef.current?.start(candidateText);
        setIsListening(true);
        startAudioRecorder(stream);
      } catch (err2) {
        // Tier 3: Separate audio and video acquisition so mic is NEVER lost even if camera is busy or denied
        let audioStream: MediaStream | null = null;
        let videoStream: MediaStream | null = null;
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (aErr) {
          console.warn('Microphone permission not granted:', aErr);
        }
        try {
          videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (vErr) {
          console.warn('Camera video not granted:', vErr);
        }

        if (audioStream || videoStream) {
          const combinedTracks = [
            ...(videoStream ? videoStream.getVideoTracks() : []),
            ...(audioStream ? audioStream.getAudioTracks() : []),
          ];
          const compositeStream = new MediaStream(combinedTracks);
          setCameraStream(compositeStream);
          setCameraActive(Boolean(videoStream));
          setShowPermissionPrompt(false);
          if (videoRef.current && videoStream) {
            videoRef.current.srcObject = compositeStream;
          }
          if (audioStream) {
            setupAudioAnalyser(compositeStream);
            recognizerRef.current?.start(candidateText);
            setIsListening(true);
            startAudioRecorder(compositeStream);
          }
        } else {
          setCameraPermissionError('Please allow microphone & camera access in your browser to enable live voice transcription and proctoring.');
        }
      }
    }
  };

  // Entire Screen Sharing Throughout Session
  const startEntireScreenShare = async () => {
    setScreenShareError(null);
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor', // request entire screen
        } as any,
        audio: false,
      });

      setScreenStream(displayStream);
      setScreenShareActive(true);

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = displayStream;
      }

      displayStream.getVideoTracks()[0].onended = () => {
        setScreenShareActive(false);
        setScreenStream(null);
      };
    } catch (err: any) {
      console.warn('Screen share error or cancel:', err);
      setScreenShareError('Screen sharing was cancelled or not granted.');
    }
  };

  const stopEntireScreenShare = () => {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
    }
    setScreenShareActive(false);
  };

  // Sync Video refs when stream updates
  useEffect(() => {
    if (cameraStream && videoRef.current) {
      videoRef.current.srcObject = cameraStream;
    }
  }, [cameraStream, cameraActive]);

  useEffect(() => {
    if (screenStream && screenVideoRef.current) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream, screenShareActive]);

  // Cleanup media streams on unmount
  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((t) => t.stop());
      }
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, []);

  // Send recorded mic chunks to /api/transcribe and append to candidateText
  const flushAndTranscribeAudio = async (): Promise<string> => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return '';
    }
    setIsTranscribingAudio(true);
    return new Promise((resolve) => {
      try {
        const recorder = mediaRecorderRef.current;
        if (!recorder) {
          setIsTranscribingAudio(false);
          resolve('');
          return;
        }

        if (recorder.state === 'recording') {
          try {
            recorder.requestData();
          } catch {}
        }

        setTimeout(async () => {
          if (audioChunksRef.current.length === 0) {
            setIsTranscribingAudio(false);
            resolve('');
            return;
          }

          const mimeType = recorder.mimeType || 'audio/webm';
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          audioChunksRef.current = [];

          if (blob.size < 400) {
            setIsTranscribingAudio(false);
            resolve('');
            return;
          }

          try {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = async () => {
              try {
                const base64Audio = (reader.result as string).split(',')[1];
                if (!base64Audio || base64Audio.length < 350) {
                  setIsTranscribingAudio(false);
                  resolve('');
                  return;
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6500);
                const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim();

                const res = await fetch('/api/transcribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  signal: controller.signal,
                  body: JSON.stringify({ audioData: base64Audio, mimeType: cleanMime }),
                });
                clearTimeout(timeoutId);

                const data = await res.json();
                const transcribed = (data.text || '').trim();
                if (transcribed) {
                  setCandidateText((prev) => {
                    if (prev.toLowerCase().includes(transcribed.toLowerCase())) return prev;
                    const updated = prev ? `${prev} ${transcribed}` : transcribed;
                    recognizerRef.current?.syncManualText(updated);
                    return updated;
                  });
                }
                setIsTranscribingAudio(false);
                resolve(transcribed);
              } catch (_e) {
                setIsTranscribingAudio(false);
                resolve('');
              }
            };
            reader.onerror = () => {
              setIsTranscribingAudio(false);
              resolve('');
            };
          } catch (_e) {
            setIsTranscribingAudio(false);
            resolve('');
          }
        }, 150);
      } catch (_e) {
        setIsTranscribingAudio(false);
        resolve('');
      }
    });
  };

  // Start Audio Recording from candidate mic stream as reliable backup
  const startAudioRecorder = (stream: MediaStream) => {
    try {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) return;
      if (typeof MediaRecorder === 'undefined') return;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const audioStream = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(audioStream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(1000);
      mediaRecorderRef.current = recorder;
    } catch (e) {
      console.warn('MediaRecorder init notice:', e);
    }
  };

  const stopAudioRecorder = (skipTranscription: boolean = false) => {
    if (skipTranscription) {
      audioChunksRef.current = [];
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }
  };

  // Initialize Continuous Speech Recognition for Voice-to-Text
  useEffect(() => {
    const recognizer = new ContinuousSpeechRecognizer(
      (transcript: string) => {
        setCandidateText(transcript);
        lastVoiceActivityRef.current = Date.now();
        lastSpeechApiUpdateRef.current = Date.now();
        cancelAutoSubmitForThisQuestionRef.current = false;
      },
      (active: boolean) => {
        setIsListening(active);
        if (active) {
          lastVoiceActivityRef.current = Date.now();
        }
      },
      (errorNotice: string) => {
        setSpeechRecognitionNotice(errorNotice);
      }
    );
    recognizerRef.current = recognizer;

    return () => {
      recognizer.stop();
      stopAudioRecorder(true);
    };
  }, []);

  // Voice Activity Detection (VAD) Background Transcriber:
  // If candidate spoke into mic and paused for 1.4s, and Web Speech API hasn't updated in 1.8s:
  // Automatically transcribe recorded audio chunks so spoken voice is ALWAYS converted to text!
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isListening || isTranscribingAudio) return;
      const now = Date.now();
      const timeSinceVoice = now - lastVoiceActivityRef.current;
      const timeSinceSpeechApi = now - lastSpeechApiUpdateRef.current;

      if (
        hasSpokenSinceLastTranscribeRef.current &&
        audioVolume < 9 &&
        timeSinceVoice > 1400 &&
        timeSinceVoice < 6500 &&
        timeSinceSpeechApi > 1800 &&
        audioChunksRef.current.length > 0
      ) {
        hasSpokenSinceLastTranscribeRef.current = false;
        flushAndTranscribeAudio();
      }
    }, 600);

    return () => clearInterval(interval);
  }, [isListening, isTranscribingAudio, audioVolume]);

  // Speech synthesis subscriber - avoid transcribing interviewer's own voice
  useEffect(() => {
    speechManager.subscribe((speaking) => {
      setIsSpeaking(speaking);
      if (speaking) {
        recognizerRef.current?.stop();
      } else {
        if (isPermissionApproved) {
          recognizerRef.current?.start(candidateText);
          setIsListening(true);
        }
      }
    });
    return () => {
      speechManager.stop();
    };
  }, [isPermissionApproved, candidateText]);

  // Countdown timer per question - ONLY runs after user clicks OK / approves
  useEffect(() => {
    if (!isPermissionApproved) return;
    const interval = setInterval(() => {
      setTimeLeftSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [currentQuestionIndex, isPermissionApproved]);

  // Handler: User explicitly clicks Turn ON Camera & Audio & enters room
  const handleApproveAndEnter = () => {
    setIsPermissionApproved(true);
    speechManager.speak(currentQuestion.message, 'female', 1.0);
    startCameraAndMic().finally(() => {
      recognizerRef.current?.start(candidateText);
      setIsListening(true);
    });
  };

  // If user already approved permissions on setup screen, start devices immediately without blocking room
  useEffect(() => {
    if (session.permissionsApproved) {
      setIsPermissionApproved(true);
      speechManager.speak(currentQuestion.message, 'female', 1.0);
      startCameraAndMic().finally(() => {
        recognizerRef.current?.start(candidateText);
        setIsListening(true);
      });
    }
  }, []);

  // Tab switch monitor
  useEffect(() => {
    const handleBlur = () => {
      setTabSwitches((prev) => prev + 1);
    };
    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, []);

  // Toggle Voice-to-Text Recording
  const toggleListening = async () => {
    if (isListening) {
      recognizerRef.current?.stop();
      if (audioChunksRef.current.length > 0) {
        await flushAndTranscribeAudio();
      }
      stopAudioRecorder(false);
      setIsListening(false);
    } else {
      recognizerRef.current?.start(candidateText);
      if (cameraStream) {
        startAudioRecorder(cameraStream);
      }
      setIsListening(true);
    }
  };

  const playQuestionAudio = () => {
    speechManager.speak(currentQuestion.message, 'female', 1.0);
  };

  // Handle Next Question & Follow-up logic
  const handleNextQuestion = async (skipFollowUp = false) => {
    if (recognizerRef.current) {
      recognizerRef.current.stop();
    }
    let trimmed = candidateText.trim();
    // If candidateText is empty or very short, but we recorded audio chunks, transcribe before submitting!
    if (trimmed.length < 5 && audioChunksRef.current.length > 0) {
      const recovered = await flushAndTranscribeAudio();
      if (recovered) {
        trimmed = recovered.trim();
        setCandidateText(trimmed);
      }
    }
    stopAudioRecorder(Boolean(trimmed));
    setIsListening(false);
    speechManager.stop();
    setIsSubmitting(true);

    const currentQText = currentQuestion.question || currentQuestion.message;
    const hasLastInterviewerMsg = messages.length > 0 && messages[messages.length - 1].role === 'interviewer';
    const interviewerMsg: ChatMessage = {
      id: 'interviewer-' + Date.now(),
      role: 'interviewer',
      content: currentQText,
      timestamp: Date.now() - 1000,
    };
    const candMsg: ChatMessage = {
      id: 'cand-' + Date.now(),
      role: 'candidate',
      content: trimmed || '[No verbal or typed answer provided]',
      timestamp: Date.now(),
    };
    const updatedMessages = hasLastInterviewerMsg
      ? [...messages, candMsg]
      : [...messages, interviewerMsg, candMsg];
    setMessages(updatedMessages);

    // If candidate has not answered a follow-up for this question yet and didn't choose to skip
    if (!isFollowUpStep && !skipFollowUp) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            session,
            transcript: updatedMessages,
            previousQuestion: currentQText,
            currentQuestionIndex,
            totalQuestions: session.totalQuestions,
            candidateAnswer: trimmed,
            isFollowUp: true,
          }),
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        setCurrentQuestion({
          message: data.message,
          question: data.question,
          stage: data.stage || currentQuestion.stage || 'technical',
          isFollowUp: true,
          hint: data.hint,
        });

        setIsFollowUpStep(true);
        setCandidateText('');
        recognizerRef.current?.clear();
        setTimeLeftSeconds(120);

        // Auto-speak follow-up question
        speechManager.speak(data.message, 'female', 1.0);
        recognizerRef.current?.start('');
        if (cameraStream) startAudioRecorder(cameraStream);
        setIsListening(true);
      } catch (err) {
        console.warn('Instant follow-up fallback activated:', err);
        const lower = trimmed.toLowerCase();
        let followUpQ = '';
        let spokenMsg = '';
        if (lower.includes('react') || lower.includes('state')) {
          followUpQ = 'How do you prevent asynchronous race conditions and memory leaks when components unmount?';
          spokenMsg = 'How do you handle race conditions and prevent memory leaks when updating state asynchronously?';
        } else if (lower.includes('node') || lower.includes('express') || lower.includes('api')) {
          followUpQ = 'How do you keep the single thread non-blocking under heavy concurrent load?';
          spokenMsg = 'How do you keep the single thread non-blocking during heavy traffic?';
        } else if (lower.includes('sql') || lower.includes('database') || lower.includes('postgres') || lower.includes('mongo')) {
          followUpQ = 'How would you diagnose a sudden query latency spike using indexing and execution plans?';
          spokenMsg = 'How would you diagnose a sudden query latency spike?';
        } else if (lower.includes('cache') || lower.includes('redis')) {
          followUpQ = 'How do you prevent cache stampedes and handle stale cache invalidation when primary records update?';
          spokenMsg = 'How do you prevent cache stampedes and handle stale data?';
        } else if (trimmed.length > 20) {
          followUpQ = 'What was the primary engineering trade-off you evaluated, and what would fail first at 10x scale?';
          spokenMsg = 'What trade-offs did you consider, and how does that approach scale?';
        } else {
          followUpQ = 'Could you clarify that in more detail and walk me through your concrete step-by-step approach?';
          spokenMsg = 'Could you clarify that in more detail? Walk me through the step-by-step approach.';
        }

        setCurrentQuestion({
          message: spokenMsg,
          question: `Follow-up: ${followUpQ}`,
          stage: currentQuestion.stage || 'technical',
          isFollowUp: true,
          hint: 'Discuss specific libraries, algorithmic trade-offs, and how you tested edge cases.',
        });
        setIsFollowUpStep(true);
        setCandidateText('');
        recognizerRef.current?.clear();
        setTimeLeftSeconds(120);
        speechManager.speak(spokenMsg, 'female', 1.0);
        recognizerRef.current?.start('');
        if (cameraStream) startAudioRecorder(cameraStream);
        setIsListening(true);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Advance to the next main question
    const nextIndex = currentQuestionIndex + 1;
    if (nextIndex >= session.totalQuestions) {
      await handleCompleteInterview(updatedMessages);
    } else {
      setCurrentQuestionIndex(nextIndex);
      setIsFollowUpStep(false);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            session,
            transcript: updatedMessages,
            previousQuestion: currentQText,
            currentQuestionIndex: nextIndex,
            totalQuestions: session.totalQuestions,
            candidateAnswer: trimmed,
            isFollowUp: false,
          }),
        });
        clearTimeout(timeoutId);

        const data = await res.json();
        setCurrentQuestion({
          message: data.message,
          question: data.question,
          stage: data.stage || 'technical',
          isFollowUp: false,
          hint: data.hint,
        });
        setCandidateText('');
        recognizerRef.current?.clear();
        setTimeLeftSeconds(120);
        speechManager.speak(data.message, 'female', 1.0);
        recognizerRef.current?.start('');
        if (cameraStream) startAudioRecorder(cameraStream);
        setIsListening(true);
      } catch (e) {
        console.warn('Fast fallback for next question:', e);
        const stagesMap: Record<number, { q: string; m: string; stage: string; hint: string }> = {
          1: {
            stage: 'technical',
            m: 'Thanks for walking through your background. Moving into our core technical round: In distributed applications, how do you handle asynchronous operations and race conditions?',
            q: 'Explain asynchronous execution and how you prevent concurrency or state inconsistencies in production.',
            hint: 'Touch on event loop mechanics, promises, optimistic updates, or database transactions.',
          },
          2: {
            stage: 'dsa',
            m: 'Now let’s look at algorithmic problem solving: Given an array of request timestamps, how would you find the maximum requests in a sliding window of size K?',
            q: 'Solve the Maximum Requests in Sliding Window problem with optimal time and space complexity.',
            hint: 'Consider a two-pointer sliding window or monotonic queue approach for O(N) complexity.',
          },
          3: {
            stage: 'system_design',
            m: 'Moving to system architecture: If you were designing a scalable notification delivery service sending millions of alerts, what components would you use?',
            q: 'Design a high-throughput, fault-tolerant notification delivery service.',
            hint: 'Break down message queues (Kafka/RabbitMQ), worker pools, idempotency, and rate limiters.',
          },
          4: {
            stage: 'behavioral',
            m: 'To wrap up, can you describe a situation where you had a disagreement with a peer over a technical direction or deadline? How did you navigate it?',
            q: 'Describe a technical disagreement with a team member and how you achieved resolution (STAR method).',
            hint: 'Focus on empathy, data-driven reasoning, open communication, and the successful end result.',
          },
        };
        const fallbackNext = stagesMap[nextIndex] || stagesMap[1];
        setCurrentQuestion({
          message: fallbackNext.m,
          question: fallbackNext.q,
          stage: fallbackNext.stage,
          isFollowUp: false,
          hint: fallbackNext.hint,
        });
        setCandidateText('');
        recognizerRef.current?.clear();
        setTimeLeftSeconds(120);
        speechManager.speak(fallbackNext.m, 'female', 1.0);
        recognizerRef.current?.start('');
        if (cameraStream) startAudioRecorder(cameraStream);
        setIsListening(true);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleCompleteInterview = async (finalTranscript: ChatMessage[]) => {
    setIsSubmitting(true);
    speechManager.stop();
    if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
    if (screenStream) screenStream.getTracks().forEach((t) => t.stop());

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 9000);

      const res = await fetch('/api/evaluate-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          session,
          transcript: finalTranscript,
          telemetry: {
            tabSwitches,
            screenShareMaintained: screenShareActive,
          },
        }),
      });
      clearTimeout(timeoutId);

      const reportData = await res.json();
      const score = typeof reportData.overallScore === 'number' ? reportData.overallScore : 0;
      const tier = reportData.performanceTier || (score >= 84 ? 'Placement Ready' : score >= 65 ? 'Near Ready' : 'Needs Focused Practice');

      const finalReport: EvaluationReport = {
        id: 'rep-' + Date.now(),
        sessionId: session.id,
        role: session.role,
        company: session.company,
        difficulty: session.difficulty,
        overallScore: score,
        performanceTier: tier,
        categoryScores: reportData.categoryScores || {
          technical: score,
          communication: score,
          problemSolving: score,
          confidence: score,
          accuracy: score,
        },
        strengths: reportData.strengths || (score > 0 ? [
          'Professional composure and clear engagement with the interviewer prompts',
          'Addressed core situational and engineering scenarios',
        ] : [
          'Successfully initiated the proctored interview session and webcam verification',
          `Attempted the ${session.role} campus placement round`,
        ]),
        weaknesses: reportData.weaknesses || (score > 0 ? [
          'State concrete algorithmic asymptotic bounds (Time & Space O(N)) earlier in technical answers',
        ] : [
          'Zero questions answered: No verbal or written explanations were submitted during the interview.',
          'In campus placement drives, unanswered questions result in 0 score and disqualification.',
        ]),
        drawbacks: reportData.drawbacks || (score > 0 ? [
          'Could provide deeper quantitative metrics on real-world projects.',
        ] : [
          'Completely skipped answering the interview questions without verbal or written responses.',
          'No evidence of technical proficiency or architectural understanding provided.',
        ]),
        improvements: reportData.improvements || (score > 0 ? [
          'State Big-O complexity upfront and quantify project results.',
        ] : [
          'Speak clearly into the microphone or type directly into the answer box before advancing.',
          'Even if unsure, explain your intuition, clarify constraints, and state a brute force approach.',
        ]),
        questionBreakdown: reportData.questionBreakdown || [],
        recommendedResources: reportData.recommendedResources || [],
        interviewerVerdict: reportData.interviewerVerdict || (score > 0
          ? `Candidate completed ${session.role} evaluation with score ${score}/100.`
          : `Interview Incomplete. No answers were provided during this session for ${session.role} at ${session.company}. Score: 0/100. Practice speaking or typing your responses and retake the interview.`),
        companyFitScore: typeof reportData.companyFitScore === 'number' ? reportData.companyFitScore : score,
        proctorTrustScore: Math.max(30, Math.min(100, 100 - tabSwitches * 10)),
        tabSwitches,
        completedAt: Date.now(),
        durationSeconds: 720,
      };

      saveReport(finalReport);
      onFinishInterview(finalReport);
    } catch (e) {
      console.warn('Fallback evaluation generated from local transcript:', e);
      // Dynamically calculate from candidate's actual answers in finalTranscript
      const questionsAnswered = (finalTranscript || []).filter((t) => t.role === 'interviewer');
      
      // Check total words submitted by candidate
      const candidateTexts = (finalTranscript || [])
        .filter((t) => t.role === 'candidate')
        .map((t) => (t.content || '').trim())
        .filter((c) => c && c !== 'Spoken answer submitted.' && c !== 'No verbal answer recorded.' && !c.startsWith('[No answer'));
      
      const totalCandWords = candidateTexts.reduce((sum, t) => sum + t.split(/\s+/).filter(Boolean).length, 0);

      const questionBreakdown = questionsAnswered.map((t, idx) => {
        const tIndex = finalTranscript.indexOf(t);
        const candAns = finalTranscript.find((c, cIdx) => c.role === 'candidate' && cIdx > tIndex);
        const rawText = candAns?.content?.trim() || '';
        const isBlank = !rawText || rawText === 'Spoken answer submitted.' || rawText === 'No verbal answer recorded.' || rawText.startsWith('[No answer');
        const text = isBlank ? '' : rawText;
        const wordCount = text.split(/\s+/).filter(Boolean).length;
        const lower = text.toLowerCase();
        const hasTechDepth = /react|node|express|database|postgres|sql|mongo|redis|cache|async|promise|event loop|time complexity|o\(|algorithm|system|api/i.test(lower);
        
        let qScore = 0;
        let qFeedback = '';
        const drawbacks: string[] = [];
        const improvements: string[] = [];

        if (wordCount === 0 || text === '') {
          qScore = 0;
          qFeedback = 'No response provided for this question. In placement interviews, unanswered questions receive 0 marks.';
          drawbacks.push('Skipped question without verbal or written attempt.');
          improvements.push('Always communicate your thought process and initial intuition.');
        } else if (wordCount < 10) {
          qScore = 25;
          qFeedback = `Extremely brief response ("${text}"). Lacks technical depth and concrete explanation.`;
          drawbacks.push('Overly brief answer lacking architectural reasoning or mechanics.');
          improvements.push('Elaborate with the concept, implementation mechanics, and an example.');
        } else if (wordCount < 25) {
          qScore = 50;
          qFeedback = `Brief response ("${text.slice(0, 45)}..."). Needs deeper technical precision.`;
          drawbacks.push('Did not elaborate on data structures, time complexity, or edge cases.');
          improvements.push('Explain the internal working and cite asymptotic bounds.');
        } else if (hasTechDepth) {
          qScore = Math.min(92, 75 + Math.min(10, Math.floor(wordCount / 25)));
          qFeedback = 'Good conceptual grasp of software engineering principles and relevant technologies.';
          drawbacks.push('Could further quantify performance metrics (e.g. latency, scale).');
          improvements.push('State edge cases and boundary conditions.');
        } else {
          qScore = Math.min(78, 58 + Math.min(12, Math.floor(wordCount / 25)));
          qFeedback = 'Clear general communication, but needs deeper technical precision and complexity analysis.';
          drawbacks.push('Relied on high-level descriptions rather than concrete technical mechanics.');
          improvements.push('Ground explanations in data structures, algorithms, or protocols.');
        }

        return {
          questionNumber: idx + 1,
          stage: t.stage || 'technical',
          question: t.question || t.content,
          candidateAnswer: text || '[No verbal answer recorded]',
          score: qScore,
          feedback: qFeedback,
          drawbacks: drawbacks.length > 0 ? drawbacks : ['Omitted quantitative metrics and edge cases.'],
          improvements: improvements.length > 0 ? improvements : ['State Big-O complexity upfront and discuss trade-offs.'],
          sampleAnswer: 'Top candidates state the fundamental core principles, walk through runtime memory/thread execution, and conclude with performance and scalability trade-offs.',
        };
      });

      const totalExpected = Math.max(session.totalQuestions || questionsAnswered.length, questionBreakdown.length, 1);
      const sumScores = questionBreakdown.reduce((sum, q) => sum + q.score, 0);
      const calculatedOverall = totalCandWords === 0 ? 0 : Math.round(sumScores / totalExpected);

      const fallbackReport: EvaluationReport = {
        id: 'rep-' + Date.now(),
        sessionId: session.id,
        role: session.role,
        company: session.company,
        difficulty: session.difficulty,
        overallScore: calculatedOverall,
        performanceTier: calculatedOverall >= 84 ? 'Placement Ready' : calculatedOverall >= 65 ? 'Near Ready' : 'Needs Focused Practice',
        categoryScores: {
          technical: calculatedOverall > 0 ? Math.min(95, calculatedOverall + 1) : 0,
          communication: calculatedOverall > 0 ? Math.min(95, calculatedOverall) : 0,
          problemSolving: calculatedOverall > 0 ? Math.min(95, calculatedOverall - 1) : 0,
          confidence: calculatedOverall > 0 ? Math.min(95, calculatedOverall - 2) : 0,
          accuracy: calculatedOverall > 0 ? Math.min(95, calculatedOverall + 1) : 0,
        },
        strengths: calculatedOverall > 0 ? [
          'Professional composure and clear engagement with the interviewer prompts',
          'Addressed core situational and engineering scenarios',
        ] : [
          'Successfully initiated the proctored interview session and webcam verification',
          `Attempted the ${session.role} campus placement round`,
        ],
        weaknesses: [
          'State algorithmic Big-O runtime and space complexity upfront before elaborating',
          'Quantify project achievements with concrete measurable metrics (% latency, user scale)',
        ],
        drawbacks: [
          'Responses lacked technical depth and quantified metrics.',
          'Big-O asymptotic bounds were omitted upfront.',
          'Behavioral answers lacked clear STAR structure.'
        ],
        improvements: [
          'Apply the 15-60-15s STAR technique for behavioral questions.',
          'State Time O(...) and Space O(...) within the first 30 seconds of algorithm design.',
          'Prepare 2-3 hard metrics for flagship resume projects.'
        ],
        questionBreakdown,
        recommendedResources: [
          {
            title: 'STAR Placement Interview Guide',
            type: 'Framework',
            description: 'Structure behavioral answers clearly: Situation, Task, Action, Result.',
            linkOrKeyTakeaway: 'Focus majority of response time on specific Actions taken.',
          },
        ],
        interviewerVerdict: calculatedOverall >= 84
          ? `Solid performance for ${session.role}. Candidate demonstrated placement readiness.`
          : calculatedOverall > 0
          ? `Candidate shows promise for ${session.role}, but needs focused preparation on answer structure and technical depth.`
          : `Interview incomplete: zero answers submitted for ${session.role}. Retake the interview to establish your performance feedback and evaluation.`,
        companyFitScore: calculatedOverall > 0 ? Math.min(95, Math.max(40, calculatedOverall + 2)) : 0,
        proctorTrustScore: Math.max(30, Math.min(100, 100 - tabSwitches * 10)),
        tabSwitches,
        completedAt: Date.now(),
        durationSeconds: 720,
      };
      saveReport(fallbackReport);
      onFinishInterview(fallbackReport);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset auto-submit timer on question progression
  useEffect(() => {
    lastVoiceActivityRef.current = Date.now();
    cancelAutoSubmitForThisQuestionRef.current = false;
    setSilenceCountdown(null);
  }, [currentQuestionIndex, isFollowUpStep]);

  const handleCancelAutoSubmit = () => {
    cancelAutoSubmitForThisQuestionRef.current = true;
    setSilenceCountdown(null);
  };

  // Silence auto-submit watchdog: automatically submits answer after maintaining silence
  useEffect(() => {
    if (!autoSubmitOnSilence || !isPermissionApproved || isSpeaking || isSubmitting) {
      setSilenceCountdown(null);
      return;
    }

    const interval = setInterval(() => {
      if (cancelAutoSubmitForThisQuestionRef.current || isSpeaking || isSubmitting || isAutoSubmittingRef.current) {
        setSilenceCountdown(null);
        return;
      }

      const text = candidateText.trim();
      const words = text.split(/\s+/).filter(Boolean);
      // Ensure candidate has given a meaningful answer before silence auto-submission
      const hasAnsweredEnough = words.length >= 4 && text.length >= 16;

      if (!hasAnsweredEnough) {
        setSilenceCountdown(null);
        return;
      }

      const elapsed = Date.now() - lastVoiceActivityRef.current;
      const thresholdMs = silenceThresholdSec * 1000;

      // Start countdown once candidate stops speaking for >= 600ms
      if (elapsed >= 600) {
        const remaining = thresholdMs - elapsed;
        if (remaining <= 0) {
          setSilenceCountdown(null);
          isAutoSubmittingRef.current = true;
          handleNextQuestion(false).finally(() => {
            isAutoSubmittingRef.current = false;
          });
        } else {
          setSilenceCountdown(Math.ceil(remaining / 1000));
        }
      } else {
        setSilenceCountdown(null);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [
    autoSubmitOnSilence,
    isPermissionApproved,
    isSpeaking,
    isSubmitting,
    candidateText,
    silenceThresholdSec,
    handleNextQuestion,
  ]);

  const formatTimer = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Pre-Interview Permission Gate: User MUST review and click Turn ON before entering room
  if (!isPermissionApproved) {
    return (
      <div className="min-h-screen bg-[#F4F6FB] flex flex-col font-sans">
        {/* Top Header */}
        <header className="h-16 border-b border-slate-200/80 bg-white px-6 sm:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onExit}
              className="p-1.5 -ml-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5D5FEF] text-white shadow-sm">
              <Bot className="h-6 w-6 stroke-[2]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 leading-tight">MockMate</h2>
              <p className="text-xs text-slate-500 font-medium">AI Mock Interview Platform</p>
            </div>
          </div>

          <button
            onClick={onExit}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            Cancel
          </button>
        </header>

        {/* Permission Confirmation Card */}
        <div className="flex-1 flex items-center justify-center p-4 sm:p-6">
          <div className="w-full max-w-lg rounded-3xl bg-white p-7 sm:p-8 shadow-xl border border-slate-200/90 space-y-6 text-center animate-in fade-in">
            {/* Visual Icon Header */}
            <div className="flex items-center justify-center gap-3 mx-auto">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-[#5D5FEF] shadow-sm">
                <Video className="h-7 w-7 stroke-[2]" />
              </div>
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-[#5D5FEF] shadow-sm">
                <Mic className="h-7 w-7 stroke-[2]" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-slate-900 tracking-tight">
                Camera & Audio Permissions
              </h3>
              <p className="text-sm text-slate-500 leading-relaxed max-w-sm mx-auto">
                Please turn ON camera and microphone permissions before entering the live interview room.
              </p>
            </div>

            {/* Session Summary Info */}
            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs text-left space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Role</span>
                <span className="font-bold text-slate-900">{session.role}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200/60 pt-2">
                <span className="text-slate-500 font-medium">Interview Round</span>
                <span className="font-bold text-[#5D5FEF]">{session.topics[0] || 'Technical'}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200/60 pt-2">
                <span className="text-slate-500 font-medium">Expected Time</span>
                <span className="font-bold text-slate-900">2 minutes per question</span>
              </div>
            </div>

            {/* Checklist */}
            <div className="space-y-2.5 text-xs text-left">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/50 border border-indigo-100">
                <CheckCircle2 className="h-4 w-4 text-[#5D5FEF] mt-0.5 shrink-0" />
                <span className="text-slate-700">
                  <strong>Camera:</strong> Activates your webcam for face-to-face AI interaction and proctoring.
                </span>
              </div>
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-indigo-50/50 border border-indigo-100">
                <CheckCircle2 className="h-4 w-4 text-[#5D5FEF] mt-0.5 shrink-0" />
                <span className="text-slate-700">
                  <strong>Microphone:</strong> Transcribes your live spoken voice into answers in real time.
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5 pt-2">
              <button
                onClick={handleApproveAndEnter}
                className="w-full py-4 px-6 rounded-xl bg-[#5D5FEF] hover:bg-indigo-600 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>OK - Turn ON Camera & Audio & Enter</span>
              </button>

              <button
                onClick={onExit}
                className="w-full py-2.5 px-4 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel & Go Back
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Click &ldquo;Allow&rdquo; when your browser prompts for camera and microphone access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F4F6FB] text-slate-800 font-sans">
      {/* 1. Left Dark Sidebar Matching Sample Screenshot */}
      <aside className="w-64 bg-[#0A1026] text-white flex flex-col justify-between p-5 shrink-0 hidden lg:flex select-none">
        <div className="space-y-7">
          {/* Brand Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5D5FEF] text-white shadow-md">
              <Bot className="h-6 w-6 stroke-[2]" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white leading-tight">MockMate</h2>
              <p className="text-[10px] text-slate-400 font-medium">AI Mock Interview Platform</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5 text-xs font-semibold">
            <button
              onClick={onExit}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <LayoutDashboard className="h-4 w-4" />
              <span>Dashboard</span>
            </button>

            <button
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[#5D5FEF] text-white shadow-md shadow-indigo-600/30 transition-all"
            >
              <Mic className="h-4 w-4" />
              <span>Mock Interview</span>
            </button>

            <button
              onClick={onExit}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <BarChart2 className="h-4 w-4" />
              <span>My Progress</span>
            </button>

            <button
              onClick={onExit}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <FileText className="h-4 w-4" />
              <span>Interview Reports</span>
            </button>

            <button
              onClick={onExit}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <Target className="h-4 w-4" />
              <span>Skill Gap Analyzer</span>
            </button>
          </nav>
        </div>

        {/* Bottom Section: Promo Card & User Profile */}
        <div className="space-y-4">
          {/* Upgrade to Pro Card */}
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 p-4 space-y-2.5">
            <div className="h-7 w-7 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center font-bold text-xs shadow-sm">
              <Star className="h-4 w-4 fill-current" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-white">Practice Today, Get Hired Tomorrow!</h4>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">
                Build your confidence with AI-powered mock interviews.
              </p>
            </div>
            <button className="w-full py-2 px-3 rounded-xl bg-[#5D5FEF] hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow">
              <span>Upgrade to Pro</span>
              <ArrowRight className="h-3 w-3" />
            </button>
          </div>

          {/* User Profile */}
          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#5D5FEF] text-white font-bold text-xs">
                R
              </div>
              <div className="text-left">
                <div className="text-xs font-bold text-white leading-tight">Reshma Polu</div>
                <div className="text-[10px] text-slate-400">Student</div>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-500" />
          </div>
        </div>
      </aside>

      {/* 2. Main Workspace Layout */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Breadcrumb Header Bar */}
        <header className="h-16 border-b border-slate-200/80 bg-white px-6 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2 text-xs font-medium">
            <button onClick={onExit} className="text-slate-500 hover:text-slate-800 transition-colors">
              Dashboard
            </button>
            <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
            <span className="font-bold text-[#5D5FEF]">Mock Interview</span>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Live Audio Equalizer Indicator */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs font-semibold">
              <Mic className={`h-3.5 w-3.5 ${audioVolume > 10 ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
              <div className="flex items-end gap-0.5 h-3">
                <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(3, (audioVolume * 0.8))}%` }} />
                <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(3, (audioVolume * 1.0))}%` }} />
                <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(3, (audioVolume * 0.6))}%` }} />
              </div>
              <span className="text-[11px] text-slate-500">{audioVolume > 5 ? 'Mic Live' : 'Mic Active'}</span>
            </div>

            {/* Screen Share Button in Header */}
            <button
              onClick={screenShareActive ? stopEntireScreenShare : startEntireScreenShare}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all ${
                screenShareActive
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                  : 'bg-indigo-50 text-[#5D5FEF] border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>{screenShareActive ? 'Screen Monitored 🟢' : 'Share Screen'}</span>
            </button>

            {/* Auto-Submit Toggle in Header */}
            <button
              onClick={() => {
                const nextState = !autoSubmitOnSilence;
                setAutoSubmitOnSilence(nextState);
                if (!nextState) setSilenceCountdown(null);
              }}
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                autoSubmitOnSilence
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
              }`}
              title="Toggle automatic submission after silence"
            >
              <Timer className={`h-3.5 w-3.5 ${autoSubmitOnSilence ? 'text-emerald-600' : 'text-slate-400'}`} />
              <span>Auto-Submit: {autoSubmitOnSilence ? 'ON ⚡' : 'OFF'}</span>
            </button>

            {/* End Interview Button in Header */}
            <button
              onClick={() => setShowEndInterviewConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 transition-all cursor-pointer shadow-2xs"
              title="End interview early and view results"
            >
              <LogOut className="h-3.5 w-3.5 text-rose-600" />
              <span>End Interview</span>
            </button>

            {/* Notification Bell */}
            <div className="relative p-2 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer">
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500" />
            </div>

            {/* Top Right Profile Avatar */}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <div className="h-8 w-8 rounded-full bg-[#5D5FEF] text-white flex items-center justify-center font-bold text-xs">
                R
              </div>
              <span className="text-xs font-bold text-slate-800 hidden sm:inline">Reshma</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </div>
          </div>
        </header>

        {/* Live Camera & Audio Permission Notice Banner */}
        {(!cameraStream || !cameraActive) && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-amber-900 font-medium">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
              <span>
                <strong>Camera & Audio Required:</strong> Please turn ON your camera and audio permissions to enable live video and speech transcription.
              </span>
            </div>
            <button
              onClick={() => setShowPermissionPrompt(true)}
              className="px-3.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Video className="h-3.5 w-3.5" />
              <span>Turn ON Permissions</span>
            </button>
          </div>
        )}

        {/* Live Proctoring Banner If Screen Share Is Not Yet Enabled */}
        {!screenShareActive && (
          <div className="bg-indigo-50/90 border-b border-indigo-100 px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 text-indigo-900 font-medium">
              <ShieldCheck className="h-4 w-4 text-[#5D5FEF] shrink-0" />
              <span>
                <strong>Proctoring Notice:</strong> Entire screen sharing is recommended throughout the session to verify testing integrity.
              </span>
            </div>
            <button
              onClick={startEntireScreenShare}
              className="px-3 py-1 rounded-lg bg-[#5D5FEF] hover:bg-indigo-600 text-white font-bold text-xs shadow-sm shrink-0 flex items-center gap-1.5 transition-colors"
            >
              <Monitor className="h-3.5 w-3.5" />
              <span>Enable Entire Screen Share</span>
            </button>
          </div>
        )}

        {/* Content Body: Left 2/3 (Live Interaction) & Right 1/3 (Progress Details) */}
        <div className="flex-1 p-5 sm:p-7 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column (8 cols): Live Interview Video & Voice Transcription */}
          <div className="lg:col-span-8 space-y-5">
            {/* AI Interviewer Top Status Card */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-[#5D5FEF]">
                  <Bot className="h-6 w-6 stroke-[2]" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 leading-tight">
                    AI Interviewer
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your AI interviewer will ask questions and give real-time feedback.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200/60 text-emerald-700 text-xs font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Live Interview</span>
              </div>
            </div>

            {/* Dual Video Stream Windows (Side by Side matching image.png) */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-3 sm:p-4 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {/* Left Video Window: AI Interviewer */}
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 border border-slate-200/60 flex items-center justify-center shadow-inner group">
                <img
                  src={AI_AVATAR_IMG}
                  alt="AI Interviewer"
                  className="w-full h-full object-cover object-center"
                />

                {/* Top-Left Audio Status Pill */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur text-white text-[11px] font-semibold">
                  <Volume2 className={`h-3.5 w-3.5 ${isSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-300'}`} />
                  <span>AI Interviewer</span>
                </div>

                {/* Speaking Waveform Animation Overlay */}
                {isSpeaking && (
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-center gap-1 bg-black/60 backdrop-blur py-1.5 px-3 rounded-full text-white text-xs font-semibold">
                    <span className="h-3 w-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-5 w-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    <span className="h-4 w-1 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '450ms' }} />
                    <span className="ml-1.5 text-[11px]">Speaking question...</span>
                  </div>
                )}
              </div>

              {/* Right Video Window: You (Live Camera Feed + Live Mic Audio Meter + Screen Share) */}
              <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-slate-900 border border-slate-200/60 flex items-center justify-center shadow-inner group">
                {/* Live Webcam Video Element (Mirrored horizontally so moving left hand displays on left side) */}
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  style={{ transform: isMirrored ? 'scaleX(-1)' : 'scaleX(1)' }}
                  className={`w-full h-full object-cover transition-transform duration-200 ${cameraActive && cameraStream ? 'block' : 'hidden'}`}
                />

                {/* Fallback portrait if camera is off or permission pending */}
                {(!cameraActive || !cameraStream) && (
                  <img
                    src={CANDIDATE_AVATAR_IMG}
                    alt="You"
                    className="w-full h-full object-cover object-center"
                  />
                )}

                {/* Top-Left Camera & Mic Status Pill */}
                <div className="absolute top-2.5 left-2.5 flex items-center gap-2 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur text-white text-[11px] font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Video className={`h-3.5 w-3.5 ${cameraActive && cameraStream ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span>You</span>
                  </span>
                  {/* Miniature Equalizer */}
                  <span className="flex items-end gap-0.5 h-2.5 pl-1 border-l border-white/20">
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: `${Math.max(2, audioVolume * 0.7)}%` }} />
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: `${Math.max(2, audioVolume * 1.0)}%` }} />
                    <span className="w-0.5 bg-emerald-400 rounded-full" style={{ height: `${Math.max(2, audioVolume * 0.5)}%` }} />
                  </span>
                </div>

                {/* Screen Share Active Pill on Video */}
                {screenShareActive && (
                  <button
                    onClick={() => setShowScreenModal(true)}
                    className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-600/90 text-white text-[10px] font-bold hover:bg-indigo-600 transition-colors shadow"
                    title="Click to preview shared screen"
                  >
                    <Monitor className="h-3 w-3" />
                    <span>Screen Shared (Preview)</span>
                  </button>
                )}

                {/* Live Camera Controls toolbar */}
                <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 opacity-90 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => setIsMirrored(!isMirrored)}
                    className={`p-1.5 rounded-lg text-white text-[10px] flex items-center gap-1 transition-colors ${
                      isMirrored ? 'bg-indigo-600/90 hover:bg-indigo-700' : 'bg-black/60 hover:bg-black'
                    }`}
                    title={isMirrored ? "Camera is Mirrored (Selfie view) - Click to unmirror" : "Camera is Normal - Click to mirror"}
                  >
                    <FlipHorizontal className="h-3.5 w-3.5" />
                    <span className="text-[10px] font-medium hidden sm:inline">{isMirrored ? 'Mirrored' : 'Normal'}</span>
                  </button>
                  <button
                    onClick={startCameraAndMic}
                    className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black text-[10px] flex items-center gap-1"
                    title="Restart / Allow Live Camera & Mic"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-slate-200" />
                  </button>
                  <button
                    onClick={() => setCameraActive(!cameraActive)}
                    className="p-1.5 rounded-lg bg-black/60 text-white hover:bg-black text-[10px] flex items-center gap-1"
                    title="Toggle Camera View"
                  >
                    {cameraActive && cameraStream ? <Video className="h-3.5 w-3.5 text-emerald-400" /> : <VideoOff className="h-3.5 w-3.5 text-rose-400" />}
                  </button>
                  <button
                    onClick={screenShareActive ? stopEntireScreenShare : startEntireScreenShare}
                    className={`p-1.5 rounded-lg text-white text-[10px] flex items-center gap-1 ${screenShareActive ? 'bg-emerald-600' : 'bg-black/60 hover:bg-black'}`}
                    title="Entire Screen Sharing"
                  >
                    <Monitor className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Current Question & Voice-to-Text Transcription Card */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
              {/* Question Header & Countdown Timer */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-full bg-indigo-100 text-[#5D5FEF] flex items-center justify-center font-bold text-xs">
                    Q
                  </div>
                  <span className="font-bold text-xs sm:text-sm text-slate-800">Current Question</span>
                  {currentQuestion.isFollowUp && (
                    <span className="px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 font-bold text-[10px] animate-pulse">
                      ✨ Follow-up Question
                    </span>
                  )}
                </div>

                {/* Time Left Pill */}
                <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  <span>Time Left</span>
                  <span className="font-mono font-bold text-slate-900">{formatTimer(timeLeftSeconds)}</span>
                </div>
              </div>

              {/* Follow-up question context indicator */}
              {currentQuestion.isFollowUp && (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs text-purple-900 animate-in fade-in">
                  <Sparkles className="h-4 w-4 text-purple-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">🎯 Follow-Up Question:</span>
                    <span className="text-purple-700">
                      The interviewer has analyzed your response and is asking this follow-up question to probe deeper into your technical decisions.
                    </span>
                  </div>
                </div>
              )}

              {/* Bold Question Text matching image */}
              <h3 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
                {currentQuestion.question}
              </h3>

              {/* Voice to Text Real-time Transcription Box */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/20 p-4 space-y-2 relative focus-within:ring-2 focus-within:ring-emerald-400">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-700">
                    <button
                      onClick={toggleListening}
                      className={`p-1.5 rounded-lg border flex items-center gap-1.5 transition-all cursor-pointer ${
                        isListening
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                      title={isListening ? 'Click to pause microphone' : 'Click to start microphone'}
                    >
                      <Mic className={`h-3.5 w-3.5 ${isListening ? 'animate-pulse' : ''}`} />
                      <span className="text-[11px] font-bold">{isListening ? 'Mic Active' : 'Start Mic'}</span>
                    </button>
                    <span className="hidden sm:inline text-slate-600 font-medium text-[11px]">
                      {isListening ? 'Speak into your microphone now' : 'Click to resume speech recognition'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Notice pill if Web Speech is in direct AI mode */}
                    {speechRecognitionNotice && (
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
                        title={speechRecognitionNotice}
                      >
                        ⚡ Direct AI Voice Active
                      </span>
                    )}

                    {/* Equalizer animation in transcription header */}
                    <div className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-full border border-emerald-200 text-[10px] text-emerald-800 font-semibold shadow-2xs">
                      <span>Mic Signal:</span>
                      <div className="flex items-end gap-0.5 h-3">
                        <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(3, audioVolume * 0.4)}px` }} />
                        <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(5, audioVolume * 0.7)}px` }} />
                        <span className="w-1 bg-emerald-500 rounded-full transition-all" style={{ height: `${Math.max(4, audioVolume * 0.5)}px` }} />
                      </div>
                      <span className="font-mono text-[9px] text-slate-500">{audioVolume > 8 ? `${audioVolume}%` : 'Silent'}</span>
                    </div>

                    {/* Explicit Manual Convert Voice to Text button */}
                    <button
                      onClick={() => flushAndTranscribeAudio()}
                      disabled={isTranscribingAudio}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                      title="Instantly convert recent speech into text"
                    >
                      {isTranscribingAudio ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-emerald-700" />
                          <span>Transcribing...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3 w-3 text-emerald-700" />
                          <span>Convert Voice to Text</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Live Silence Auto-Submit Countdown Banner */}
                {silenceCountdown !== null && (
                  <div className="p-3 rounded-xl bg-gradient-to-r from-amber-50 via-indigo-50/60 to-amber-50 border border-amber-300 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-1">
                    <div className="flex items-center gap-2.5">
                      <span className="relative flex h-3 w-3 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                      </span>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-slate-800">Silence maintained after answer:</span>
                          <span className="px-2 py-0.5 rounded-md bg-amber-200/80 text-amber-900 text-xs font-extrabold flex items-center gap-1">
                            <Timer className="h-3.5 w-3.5 text-amber-700" />
                            <span>Auto-submitting in {silenceCountdown}s</span>
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Continue speaking to reset, or click below.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                      <button
                        onClick={handleCancelAutoSubmit}
                        className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 shadow-2xs transition-colors flex items-center gap-1 cursor-pointer"
                        title="Pause auto-submit for this question"
                      >
                        <Pause className="h-3 w-3" />
                        <span>Cancel</span>
                      </button>
                      <button
                        onClick={() => handleNextQuestion(false)}
                        className="px-3 py-1 text-xs font-bold text-white bg-[#5D5FEF] hover:bg-[#4D4FD0] rounded-lg shadow-2xs transition-colors cursor-pointer"
                      >
                        Submit Now
                      </button>
                    </div>
                  </div>
                )}

                <textarea
                  rows={4}
                  value={candidateText}
                  onChange={(e) => {
                    const text = e.target.value;
                    setCandidateText(text);
                    recognizerRef.current?.syncManualText(text);
                    lastVoiceActivityRef.current = Date.now();
                    cancelAutoSubmitForThisQuestionRef.current = false;
                  }}
                  placeholder="Speak into your microphone now... your voice is transcribed to text in real time. You can also type or edit anytime."
                  className="w-full bg-transparent text-xs sm:text-sm text-slate-800 focus:outline-none resize-none leading-relaxed font-sans placeholder:text-slate-400"
                />

                <div className="flex flex-wrap items-center justify-between pt-1 gap-2 border-t border-emerald-100/60">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-[10px] text-slate-400 font-medium">
                      {candidateText.split(/\s+/).filter(Boolean).length} words recorded
                    </span>
                    {candidateText && (
                      <button
                        onClick={() => {
                          setCandidateText('');
                          recognizerRef.current?.clear();
                          lastVoiceActivityRef.current = Date.now();
                          setSilenceCountdown(null);
                        }}
                        className="text-[10px] text-slate-400 hover:text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                        title="Clear current transcription"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Clear</span>
                      </button>
                    )}

                    {/* Auto-Submit Silence Control Toggle */}
                    <button
                      onClick={() => {
                        const nextState = !autoSubmitOnSilence;
                        setAutoSubmitOnSilence(nextState);
                        if (!nextState) setSilenceCountdown(null);
                      }}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border flex items-center gap-1 transition-all cursor-pointer ${
                        autoSubmitOnSilence
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}
                      title="Automatically submits answer after 3.5s of silence"
                    >
                      <Timer className={`h-3 w-3 ${autoSubmitOnSilence ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span>Auto-submit on silence: {autoSubmitOnSilence ? `${silenceThresholdSec}s (ON)` : 'OFF'}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Quick sample answer button for instant testing */}
                    <button
                      onClick={() => {
                        const sample = currentQuestion.stage === 'warmup'
                          ? `My name is Ananya. I am a Computer Science engineering student with experience building full-stack applications using React, Node.js, and SQL databases. I enjoy solving algorithmic challenges and architecting scalable backend APIs.`
                          : `For this problem, I would first analyze the input bounds and state requirements. I would design the solution using an efficient data structure with an optimal time complexity of O(N) and space complexity of O(1).`;
                        setCandidateText(sample);
                        recognizerRef.current?.syncManualText(sample);
                        lastVoiceActivityRef.current = Date.now();
                        cancelAutoSubmitForThisQuestionRef.current = false;
                      }}
                      className="text-[10px] text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-md font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                      title="Insert high-scoring sample response"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Sample Answer</span>
                    </button>

                    <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700">
                      {isListening ? (
                        <>
                          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                          <span>Mic Active: Listening</span>
                        </>
                      ) : isTranscribingAudio ? (
                        <>
                          <Loader2 className="h-3 w-3 animate-spin text-indigo-600" />
                          <span className="text-indigo-600">Transcribing audio...</span>
                        </>
                      ) : (
                        <span className="text-slate-400 font-normal text-[10px]">Mic paused</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Submit button directly inside transcription box */}
                <div className="flex items-center justify-between pt-2 border-t border-emerald-100 flex-wrap gap-2">
                  <span className="text-[11px] text-slate-500 font-medium">
                    {isFollowUpStep
                      ? 'Answer this follow-up to advance to the next interview round'
                      : 'Submit your response to get a live AI follow-up question'}
                  </span>
                  <button
                    onClick={() => handleNextQuestion(false)}
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-[#5D5FEF] hover:bg-[#4D4FD0] text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Generating AI Follow-Up...</span>
                      </>
                    ) : (
                      <>
                        <span>{isFollowUpStep ? 'Submit & Next Round' : 'Submit Answer & Get Follow-Up'}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Bottom Action Controls Row */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                {/* Play Question Button */}
                <button
                  onClick={playQuestionAudio}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center gap-2 transition-colors self-start sm:self-auto cursor-pointer"
                >
                  <Volume2 className="h-4 w-4 text-slate-600" />
                  <span>Play Question Audio</span>
                </button>

                {/* Big Center Microphone Recording Button matching image */}
                <div className="flex flex-col items-center">
                  <button
                    onClick={toggleListening}
                    className={`h-14 w-14 rounded-full flex items-center justify-center text-white shadow-lg transition-all cursor-pointer ${
                      isListening
                        ? 'bg-rose-500 ring-8 ring-rose-200 animate-pulse'
                        : 'bg-[#5D5FEF] hover:bg-indigo-600 shadow-indigo-500/30'
                    }`}
                  >
                    {isListening ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6 stroke-[2.5]" />}
                  </button>
                  <span className="text-[11px] text-slate-500 font-medium mt-1.5">
                    {isListening ? 'Listening live (Tap to pause)' : 'Tap to start voice recording'}
                  </span>
                </div>

                {/* Screen Share status / toggle button */}
                <button
                  onClick={screenShareActive ? stopEntireScreenShare : startEntireScreenShare}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 border transition-colors ${
                    screenShareActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Monitor className="h-4 w-4 text-[#5D5FEF]" />
                  <span>{screenShareActive ? 'Entire Screen Active 🟢' : 'Share Entire Screen'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column (4 cols): Interview Progress & Question Details */}
          <div className="lg:col-span-4 space-y-5">
            {/* 1. Interview Progress Card */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-5">
              <h3 className="font-bold text-sm text-slate-900">Interview Progress</h3>

              <div className="flex items-center justify-between gap-4">
                {/* Circular Gauge 1/5 */}
                <div className="relative h-24 w-24 flex items-center justify-center shrink-0">
                  <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
                    {/* Background Ring */}
                    <path
                      className="text-slate-100"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                    {/* Foreground Arc */}
                    <path
                      className="text-emerald-500 transition-all duration-500"
                      strokeDasharray={`${((currentQuestionIndex + 1) / session.totalQuestions) * 100}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                    <span className="text-base font-black text-slate-900 leading-tight">
                      {currentQuestionIndex + 1}/{session.totalQuestions}
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Questions</span>
                  </div>
                </div>

                {/* Steps List matching image */}
                <div className="space-y-2 flex-1">
                  {Array.from({ length: session.totalQuestions }).map((_, idx) => {
                    const isCurrent = idx === currentQuestionIndex;
                    const isCompleted = idx < currentQuestionIndex;
                    return (
                      <div key={idx} className="flex items-center gap-2.5 text-xs font-medium">
                        <div
                          className={`h-5 w-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                            isCurrent
                              ? 'bg-[#5D5FEF] text-white shadow-sm'
                              : isCompleted
                              ? 'bg-emerald-500 text-white'
                              : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {idx + 1}
                        </div>
                        <span
                          className={`${
                            isCurrent
                              ? 'font-bold text-[#5D5FEF]'
                              : isCompleted
                              ? 'text-slate-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {isCurrent ? 'Current' : isCompleted ? 'Completed' : idx === currentQuestionIndex + 1 ? 'Upcoming' : 'Locked'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 2. Question Details Card */}
            <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-sm space-y-4">
              <h3 className="font-bold text-sm text-slate-900">Question Details</h3>

              <div className="space-y-3.5 text-xs">
                {/* Category */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Layers className="h-4 w-4 text-indigo-500" />
                    <span>Category</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 text-[#5D5FEF] font-bold">
                    {session.topics[0] || 'Technical'}
                  </span>
                </div>

                {/* Difficulty */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Settings2 className="h-4 w-4 text-amber-500" />
                    <span>Difficulty</span>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-700 font-bold">
                    {session.difficulty.split(' ')[0]}
                  </span>
                </div>

                {/* Time Limit */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <span>Time Limit</span>
                  </div>
                  <span className="font-bold text-slate-900">2 minutes</span>
                </div>

                {/* Response Speed Engine */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <span className="text-slate-500">AI Engine</span>
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md inline-flex items-center gap-1">
                    <Zap className="h-3 w-3 fill-emerald-500 text-emerald-500" /> Fast Response Mode
                  </span>
                </div>

                {/* Auto-Submit on Silence Status */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-2.5">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <Timer className="h-3.5 w-3.5 text-indigo-500" />
                    <span>Auto-Submit</span>
                  </div>
                  <button
                    onClick={() => {
                      const nextState = !autoSubmitOnSilence;
                      setAutoSubmitOnSilence(nextState);
                      if (!nextState) setSilenceCountdown(null);
                    }}
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                      autoSubmitOnSilence
                        ? 'bg-indigo-50 text-[#5D5FEF] border-indigo-200 hover:bg-indigo-100'
                        : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {autoSubmitOnSilence ? `On (${silenceThresholdSec}s silence)` : 'Off'}
                  </button>
                </div>
              </div>

              {/* Next Question Action Button */}
              <div className="pt-2 space-y-2">
                <button
                  onClick={() => handleNextQuestion(false)}
                  disabled={isSubmitting}
                  className="w-full py-3.5 px-4 rounded-xl bg-[#5D5FEF] hover:bg-[#4D4FD0] active:scale-[0.99] text-white font-bold flex items-center justify-center gap-2 shadow-md shadow-indigo-400/20 transition-all text-sm disabled:opacity-60 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{isFollowUpStep ? 'Compiling scores...' : 'Analyzing response (<2s)...'}</span>
                    </>
                  ) : (
                    <>
                      <span>
                        {currentQuestionIndex + 1 >= session.totalQuestions && isFollowUpStep
                          ? 'Finish Interview'
                          : isFollowUpStep
                          ? 'Next Question'
                          : 'Submit & Get Follow-up'}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>

                {/* Option to skip directly to next main question if candidate already answered comprehensively */}
                {!isFollowUpStep && currentQuestionIndex + 1 < session.totalQuestions && (
                  <button
                    onClick={() => handleNextQuestion(true)}
                    disabled={isSubmitting}
                    className="w-full py-2 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 hover:text-slate-900 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-500" />
                    <span>Skip Follow-up & Go to Next Question</span>
                  </button>
                )}

                {/* End Interview Early Button */}
                <button
                  onClick={() => setShowEndInterviewConfirm(true)}
                  disabled={isSubmitting}
                  className="w-full py-2.5 px-3 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Conclude interview now and generate your evaluation report"
                >
                  <LogOut className="h-3.5 w-3.5 text-rose-600" />
                  <span>End Interview & View Report</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Screen Sharing Picture-in-Picture Preview Modal */}
      {showScreenModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl p-5 max-w-3xl w-full space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Monitor className="h-5 w-5 text-[#5D5FEF]" />
                <h3 className="font-bold text-slate-900 text-base">Live Shared Screen Monitor</h3>
              </div>
              <button
                onClick={() => setShowScreenModal(false)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 px-3 py-1 rounded-lg hover:bg-slate-100"
              >
                Close Preview
              </button>
            </div>

            <div className="aspect-video w-full rounded-xl bg-slate-950 overflow-hidden flex items-center justify-center">
              {screenStream ? (
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center text-slate-400 text-xs">
                  Screen share stream is active.
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
              <span className="flex items-center gap-1.5 text-emerald-600 font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>Entire Screen Share is active and being monitored by AI proctoring</span>
              </span>
              <button
                onClick={stopEntireScreenShare}
                className="text-rose-500 hover:underline font-bold"
              >
                Stop Screen Share
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Camera & Audio Permissions Modal Dialog */}
      {showPermissionPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 sm:p-7 shadow-2xl border border-slate-200/90 space-y-5 text-center">
            {/* Visual Icon Header */}
            <div className="flex items-center justify-center gap-3 mx-auto">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-[#5D5FEF] shadow-sm">
                <Video className="h-6 w-6 stroke-[2]" />
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-[#5D5FEF] shadow-sm">
                <Mic className="h-6 w-6 stroke-[2]" />
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xl font-bold text-slate-900 tracking-tight">
                Camera & Audio Permissions Required
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                Please turn ON your camera and audio permissions so the AI interviewer can see your expressions, convert your voice to text, and proctor your interview.
              </p>
            </div>

            {/* Permissions Status Row */}
            <div className="grid grid-cols-2 gap-2.5 text-xs text-left">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Video className="h-3.5 w-3.5 text-[#5D5FEF]" />
                  <span>Camera</span>
                </div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {cameraStream && cameraActive ? (
                    <span className="text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Ready & Live
                    </span>
                  ) : (
                    <span className="text-amber-600">Permission needed</span>
                  )}
                </div>
              </div>

              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50/70 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-slate-800">
                  <Mic className="h-3.5 w-3.5 text-[#5D5FEF]" />
                  <span>Microphone</span>
                </div>
                <div className="text-[11px] font-semibold text-slate-500">
                  {cameraStream?.getAudioTracks().length ? (
                    <span className="text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Audio Live
                    </span>
                  ) : (
                    <span className="text-amber-600">Permission needed</span>
                  )}
                </div>
              </div>
            </div>

            {cameraPermissionError && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 text-left flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  {cameraPermissionError} Click the camera or lock icon in your browser address bar to allow permissions.
                </span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <button
                onClick={async () => {
                  await startCameraAndMic();
                  setShowPermissionPrompt(false);
                }}
                className="w-full py-3.5 px-6 rounded-xl bg-[#5D5FEF] hover:bg-indigo-600 active:scale-[0.99] text-white font-bold text-sm shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Video className="h-4 w-4" />
                <span>Turn ON Camera & Audio Permissions</span>
              </button>

              <button
                onClick={() => setShowPermissionPrompt(false)}
                className="w-full py-2.5 px-4 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Continue with Simulated Avatar
              </button>
            </div>

            <p className="text-[11px] text-slate-400">
              Click &ldquo;Allow&rdquo; when your browser prompts for camera and microphone access.
            </p>
          </div>
        </div>
      )}

      {/* End Interview Early Confirmation Modal */}
      {showEndInterviewConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-md w-full space-y-5 shadow-2xl border border-slate-200 animate-in zoom-in-95">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 shrink-0">
                <LogOut className="h-6 w-6 stroke-[2.2]" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-lg">End Interview?</h3>
                <p className="text-xs text-slate-500 font-medium">Generate evaluation report with current answers</p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5 text-slate-600">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-500">Current Progress</span>
                <span className="font-bold text-slate-900">Question {currentQuestionIndex + 1} of {session.totalQuestions}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-500">Responses Recorded</span>
                <span className="font-bold text-[#5D5FEF]">{messages.filter((m) => m.role === 'candidate').length + (candidateText.trim() ? 1 : 0)} answered</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to conclude now? MockMate will evaluate your submitted answers, compile placement feedback across categories, and immediately produce your detailed evaluation report.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => setShowEndInterviewConfirm(false)}
                className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-bold text-xs transition-colors cursor-pointer"
              >
                Continue Practice
              </button>
              <button
                onClick={async () => {
                  setShowEndInterviewConfirm(false);
                  const trimmed = candidateText.trim();
                  let finalMessages = [...messages];
                  if (trimmed) {
                    finalMessages.push({
                      id: 'cand-' + Date.now(),
                      role: 'candidate',
                      content: trimmed,
                      timestamp: Date.now(),
                    });
                  }
                  await handleCompleteInterview(finalMessages);
                }}
                disabled={isSubmitting}
                className="flex-1 py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-500/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Evaluating...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Yes, End & View Report</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
