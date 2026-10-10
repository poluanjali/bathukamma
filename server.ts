import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '10mb' }));

// Initialize Google GenAI
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;
if (apiKey) {
  aiClient = new GoogleGenAI({ apiKey });
}

// Active supported models from SKILL.md (prioritizing high-availability flash-lite)
const PRIMARY_MODEL = 'gemini-3.1-flash-lite';
const SECONDARY_MODEL = 'gemini-3.8-flash';
const LITE_MODEL = 'gemini-flash-latest';

// In-memory cache for models that hit quota limits so we don't waste time retrying them
const quotaExhaustedUntil = new Map<string, number>();

// Helper to determine if an error is quota / rate limit related
function isQuotaExceededError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || String(err)).toLowerCase();
  const status = err.status || err.code;
  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit')
  );
}

// Execute Gemini call with model fallback and automatic graceful catch
async function callGeminiSafely(
  prompt: string,
  options: {
    thinking?: ThinkingLevel;
    json?: boolean;
    timeoutMs?: number;
  } = {}
): Promise<string | null> {
  if (!aiClient) return null;

  const { thinking, json = true, timeoutMs = 3800 } = options;
  const now = Date.now();
  const allModels = [PRIMARY_MODEL, SECONDARY_MODEL, LITE_MODEL];
  const modelsToTry = allModels.filter((m) => {
    const exhaustedUntil = quotaExhaustedUntil.get(m);
    return !exhaustedUntil || now > exhaustedUntil;
  });

  // If all models are marked exhausted, try PRIMARY_MODEL anyway
  if (modelsToTry.length === 0) {
    modelsToTry.push(PRIMARY_MODEL);
  }

  for (const model of modelsToTry) {
    try {
      const config: any = {};
      if (thinking) {
        config.thinkingConfig = { thinkingLevel: thinking };
      }
      if (json) {
        config.responseMimeType = 'application/json';
      }

      const response = await withTimeout(
        aiClient.models.generateContent({
          model,
          contents: prompt,
          config,
        }),
        timeoutMs
      );

      const text = response.text?.trim();
      if (text) return text;
    } catch (err: any) {
      if (isQuotaExceededError(err)) {
        console.warn(`[Gemini Quota Notice] Model ${model} quota reached, caching for 10m...`);
        quotaExhaustedUntil.set(model, Date.now() + 10 * 60 * 1000);
      } else {
        console.warn(`[Gemini Engine Notice] Model ${model} call encountered:`, err?.message || err);
      }
    }
  }

  return null;
}

// Helper for clean JSON extraction from Gemini output
function extractJsonFromText(text: string): any {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return JSON.parse(trimmed);
    }
    const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
      return JSON.parse(match[1]);
    }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(text.substring(firstBrace, lastBrace + 1));
    }
  } catch (err) {
    console.error('Failed to parse JSON from AI response:', err);
  }
  return null;
}

// Timeout helper to guarantee fast responses and prevent UI hangs
async function withTimeout<T>(promise: Promise<T>, ms: number = 3500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// API: Audio Transcription using Gemini
app.post('/api/transcribe', async (req, res) => {
  const { audioData, mimeType } = req.body;
  if (!audioData || typeof audioData !== 'string') {
    return res.json({ text: '' });
  }

  // Strip data URL prefix if present
  let cleanData = audioData;
  if (cleanData.includes(',')) {
    cleanData = cleanData.split(',')[1];
  }
  cleanData = cleanData.replace(/\s+/g, '');

  // Lower minimum length threshold to 500 chars to allow short phrases
  if (cleanData.length < 500) {
    return res.json({ text: '' });
  }

  // Clean mimeType: strip codec parameters like ;codecs=opus
  let cleanMime = 'audio/webm';
  if (mimeType && typeof mimeType === 'string') {
    const rawMime = mimeType.split(';')[0].trim().toLowerCase();
    const allowed = ['audio/webm', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac', 'audio/mp3'];
    if (allowed.includes(rawMime)) {
      cleanMime = rawMime;
    }
  }

  if (!aiClient) {
    return res.json({ text: '' });
  }

  const audioModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.5-transcribe', 'gemini-3.8-flash'];
  const audioPart = {
    inlineData: {
      mimeType: cleanMime,
      data: cleanData,
    },
  };

  for (const model of audioModels) {
    try {
      const response = await withTimeout(
        aiClient.models.generateContent({
          model,
          contents: {
            parts: [
              audioPart,
              {
                text: 'Transcribe this spoken interview answer into clean, accurate English text. Provide strictly the transcribed words without any quotes, metadata, or prefixes. If the audio contains only silence or non-verbal background noise, return nothing.',
              },
            ],
          },
        }),
        6000
      );

      let text = response.text ? response.text.trim() : '';
      // Strip common wrapper patterns if model outputs them
      text = text
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/^(transcription|candidate said|answer|transcript):\s*/i, '')
        .trim();

      if (text) {
        console.log(`[Audio Transcribe] Model ${model} transcribed ${text.length} chars: "${text.slice(0, 40)}..."`);
        return res.json({ text });
      }
    } catch (err: any) {
      console.warn(`[Audio Transcribe] Model ${model} notice:`, err?.message?.slice(0, 90) || err);
    }
  }

  return res.json({ text: '' });
});

// API: Resume Parsing & Skills Extraction
app.post('/api/parse-resume', async (req, res) => {
  const { resumeText } = req.body;
  if (!resumeText || typeof resumeText !== 'string' || !resumeText.trim()) {
    return res.status(400).json({ error: 'resumeText is required' });
  }

  if (!aiClient) {
    // High-quality deterministic fallback
    return res.json({
      candidateName: 'Candidate',
      summary: 'Extracted technical background highlighting core engineering proficiencies.',
      skills: ['Data Structures & Algorithms', 'JavaScript / TypeScript', 'React', 'Node.js', 'System Architecture', 'SQL & Databases'],
      projects: ['Full-stack Application with REST APIs', 'Algorithm Optimization & Realtime Data Engine'],
      suggestedTopics: ['Technical', 'DSA', 'Resume', 'Communication'],
      recommendedRole: 'Software Development Engineer (SDE-1)',
    });
  }

  try {
    const prompt = `You are an expert technical campus recruiter and resume parser.
Analyze this resume text and extract structured information for a mock interview:
\`\`\`
${resumeText.slice(0, 8000)}
\`\`\`

Return a valid JSON object strictly matching this schema:
{
  "candidateName": string,
  "summary": string (1-2 sentences),
  "skills": string[] (top 6-10 skills),
  "projects": string[] (1-3 key project titles with brief context),
  "suggestedTopics": string[] (subset of ["Technical", "DSA", "System Design", "HR", "Aptitude", "Resume", "Communication"]),
  "recommendedRole": string (e.g. Frontend Engineer, Full Stack Developer, Data Analyst, SDE-1)
}
Do not wrap in extra explanation outside of JSON.`;

    const rawResponse = await callGeminiSafely(prompt, {
      thinking: ThinkingLevel.LOW,
      json: true,
      timeoutMs: 3500,
    });

    if (rawResponse) {
      const parsed = extractJsonFromText(rawResponse);
      if (parsed) {
        return res.json(parsed);
      }
    }

    return res.json({
      candidateName: 'Candidate',
      summary: 'Extracted key software proficiencies and development background.',
      skills: ['JavaScript/TypeScript', 'DSA', 'Web Architecture', 'Database Systems', 'Git & CI/CD'],
      projects: ['Web Application System'],
      suggestedTopics: ['Technical', 'DSA', 'Resume', 'HR'],
      recommendedRole: 'Software Development Engineer (SDE-1)',
    });
  } catch (error: any) {
    console.error('Error in /api/parse-resume:', error);
    return res.json({
      candidateName: 'Candidate',
      summary: 'Extracted competencies from resume submission.',
      skills: ['Core CS Fundamentals', 'Algorithms', 'Web Development'],
      projects: ['Software Engineering Project'],
      suggestedTopics: ['Technical', 'DSA', 'Resume'],
      recommendedRole: 'Software Engineer',
    });
  }
});

// API: Generate Next Adaptive Question / Follow-up
app.post('/api/generate-question', async (req, res) => {
  const {
    session,
    transcript = [],
    previousQuestion = '',
    currentQuestionIndex = 0,
    totalQuestions = 5,
    candidateAnswer = '',
  } = req.body;

  const role = session?.role || 'Software Development Engineer';
  const company = session?.company || 'General Tech';
  const difficulty = session?.difficulty || 'Medium';
  const interviewerName = session?.interviewer?.name || 'Aria';
  const interviewerStyle = session?.interviewer?.style || 'Friendly, supportive, yet technically precise';
  const topics = session?.topics || ['Technical', 'HR'];
  const resumeText = session?.resumeText || '';

  // Determine interview stage
  let stage = 'warmup';
  if (currentQuestionIndex === 0) {
    stage = 'warmup';
  } else if (currentQuestionIndex === 1) {
    stage = topics.includes('Resume') && resumeText ? 'resume' : 'technical';
  } else if (currentQuestionIndex === 2) {
    stage = topics.includes('DSA') ? 'dsa' : 'technical';
  } else if (currentQuestionIndex === 3) {
    stage = topics.includes('System Design') ? 'system_design' : 'behavioral';
  } else if (currentQuestionIndex >= 4) {
    stage = currentQuestionIndex >= totalQuestions - 1 ? 'wrapup' : 'behavioral';
  }

  // Fallback questions bank
  const fallbackBanks: Record<string, { message: string; question: string; codePrompt?: string; hint?: string }> = {
    warmup: {
      message: `Hello! I'm ${interviewerName}. Welcome to your ${company} mock interview for the ${role} position. Tell me about yourself and your journey into software development.`,
      question: 'Tell me about yourself and your journey into software development.',
      hint: 'Use the Present-Past-Future structure: what you study/build now, key achievements, and why this role fits.',
    },
    resume: {
      message: `Thanks for sharing. Looking at your experience and projects, could you dive deep into the most challenging technical project you've built? What specific architectural decisions did you make, and how did you handle trade-offs?`,
      question: 'Explain the technical architecture and toughest engineering hurdle of a project listed on your resume.',
      hint: 'Detail the problem, your exact contribution, technical stack chosen, and measurable impact.',
    },
    technical: {
      message: `Great. Moving into our core technical round: In modern web and distributed applications, how do you handle asynchronous operations, error boundaries, and race conditions to maintain reliable user state?`,
      question: 'Explain asynchronous execution and how you prevent concurrency or state inconsistencies in production.',
      hint: 'Touch on promises, event loop mechanics, optimistic UI updates, or database transactions.',
    },
    dsa: {
      message: `Now let's tackle a problem-solving scenario. Suppose you are given an array of integers representing request timestamps and need to find the maximum number of requests processed within any sliding window of size K. How would you solve this with optimal time and space complexity?`,
      question: 'Solve the Maximum Requests in Sliding Window problem with optimal time complexity.',
      codePrompt: `function maxRequestsInWindow(timestamps: number[], k: number): number {\n  // Write your optimal solution here\n  \n}`,
      hint: 'Consider a two-pointer sliding window or monotonic queue approach for O(N) complexity.',
    },
    system_design: {
      message: `Let's discuss a system design question. If you were designing a scalable notification service that sends millions of push alerts and emails during campus placement announcements, what components and message queues would you use?`,
      question: 'Design a high-throughput, fault-tolerant notification delivery service.',
      hint: 'Break down API Gateway, message broker (Kafka/RabbitMQ), worker pools, idempotency keys, and rate limiters.',
    },
    behavioral: {
      message: `Let's talk about teamwork and workplace dynamics. Can you describe a situation where you had a disagreement with a peer or teammate over a technical direction or deadline? How did you navigate it?`,
      question: 'Describe a technical disagreement with a team member and how you achieved resolution (STAR method).',
      hint: 'Focus on empathy, data-driven reasoning, open communication, and the successful end result.',
    },
    wrapup: {
      message: `That brings us to the end of our questions today. Before we compile your final evaluation, do you have any closing questions for me about the team, culture, or growth opportunities at ${company}?`,
      question: 'Do you have any thoughtful questions for the interviewer regarding team culture, engineering practices, or role expectations?',
      hint: 'Asking questions about developer tooling, team mentorship, and sprint cycles shows genuine curiosity.',
    },
  };

  // Rich intelligent follow-up builder based specifically on the candidate's actual answer and context
  const buildInstantFollowUp = (
    ansText: string,
    prevQuestionText: string = '',
    historyQuestions: string[] = []
  ) => {
    const text = (ansText || '').trim();
    const ans = text.toLowerCase();
    const words = text.split(/\s+/).filter(Boolean);
    const historyLower = historyQuestions.map((q) => q.toLowerCase());

    const isAlreadyAsked = (qText: string) => {
      const qLower = qText.toLowerCase();
      return historyLower.some((h) => h.includes(qLower.slice(0, 30)) || qLower.includes(h.slice(0, 30)));
    };

    // If candidate submitted empty answer
    if (!text || text === '[No answer provided]' || text.startsWith('[No answer') || text === 'No verbal answer recorded.' || text.startsWith('[No verbal')) {
      return {
        message: `I didn't catch an answer to that question. Could you walk me through your initial intuition or how you would approach this?`,
        question: `Follow-up: How would you approach this problem starting from initial constraints and a baseline solution?`,
        stage,
        isFollowUp: true,
        hint: 'State your high-level intuition, clarify input constraints, and describe a baseline solution.',
      };
    }

    // Handle introductory statements like "my name is..." or "i am..."
    if ((/my name is|i am [a-z]+/i.test(text) || text.startsWith("i'm")) && words.length < 9) {
      const nameMatch = text.match(/my name is\s+([a-zA-Z]+)/i) || text.match(/i am\s+([a-zA-Z]+)/i);
      const studentName = nameMatch ? nameMatch[1] : 'there';
      return {
        message: `Welcome, ${studentName}! Could you tell me about the engineering projects you have built and the core technologies you specialize in?`,
        question: `Follow-up: What software engineering projects have you built recently, and what architectural decisions did you make?`,
        stage,
        isFollowUp: true,
        hint: 'Highlight 1-2 flagship projects, your key contributions, and architectural stack.',
      };
    }

    // Handle unclear, ambiguous, or extremely brief responses (< 6 words with no technical keywords)
    const hasAnyTechKeyword = /react|node|sql|mongo|redis|api|cache|state|algorithm|tree|graph|queue|pointer|complexity|o\(|docker|python|java|class|function|database|index/i.test(ans);
    if (words.length <= 5 && !hasAnyTechKeyword) {
      return {
        message: `Could you clarify that in more detail? Walk me through your concrete technical reasoning and step-by-step approach.`,
        question: `Follow-up: Could you clarify your approach and explain how you would solve this step-by-step?`,
        stage,
        isFollowUp: true,
        hint: 'Clarify your approach, state your assumptions, and break down the solution step-by-step.',
      };
    }

    // Map candidate topics to distinct pools of deep follow-up questions
    const questionOptions: Array<{ question: string; message: string; hint: string }> = [];

    if (ans.includes('react') || ans.includes('state') || ans.includes('redux') || ans.includes('hook')) {
      questionOptions.push(
        {
          question: `Follow-up: How do you handle asynchronous race conditions and ensure unmounting components do not cause memory leaks or state errors?`,
          message: `How do you prevent race conditions and unnecessary re-renders when updating state asynchronously?`,
          hint: 'Discuss AbortController in useEffect cleanup, memoization, and controlled unidirectional data flow.',
        },
        {
          question: `Follow-up: How do you profile and eliminate performance bottlenecks caused by excessive DOM re-renders in large component trees?`,
          message: `How do you profile rendering performance and prevent redundant component updates in production?`,
          hint: 'Mention React DevTools profiler, useMemo/useCallback boundaries, and virtualization.',
        }
      );
    }

    if (ans.includes('node') || ans.includes('express') || ans.includes('event loop') || ans.includes('thread')) {
      questionOptions.push(
        {
          question: `Follow-up: How do you ensure the single-threaded event loop remains non-blocking during CPU-intensive tasks or database queries?`,
          message: `How do you keep the single thread non-blocking under heavy concurrent workloads?`,
          hint: 'Mention worker threads, async I/O, clustering, streaming payloads, and offloading CPU work.',
        },
        {
          question: `Follow-up: How do you handle backpressure and stream large payloads without overwhelming server memory?`,
          message: `How do you manage backpressure and stream processing when transferring large datasets?`,
          hint: 'Discuss Node.js transform streams, pipeline utilities, and pause/resume mechanisms.',
        }
      );
    }

    if (ans.includes('cache') || ans.includes('redis') || ans.includes('memcached')) {
      questionOptions.push(
        {
          question: `Follow-up: How do you prevent cache stampedes (the thundering herd problem) and handle cache invalidation when primary records update?`,
          message: `How do you handle cache invalidation and mitigate the thundering herd problem under sudden traffic spikes?`,
          hint: 'Discuss mutex locks, probabilistic early expiration (XFetch), and write-through/write-back strategies.',
        },
        {
          question: `Follow-up: What cache eviction policy (LRU vs LFU) would you choose for this workload, and what happens when the cache server goes down?`,
          message: `Which eviction policy would you select, and how does your service handle cache node outages gracefully?`,
          hint: 'Discuss eviction strategies, circuit breakers, and degraded read fallbacks.',
        }
      );
    }

    if (ans.includes('sql') || ans.includes('postgres') || ans.includes('query') || ans.includes('database') || ans.includes('mongo')) {
      questionOptions.push(
        {
          question: `Follow-up: If query latency spikes from 20ms to 400ms under high concurrent traffic, what systematic steps do you take to profile and resolve it?`,
          message: `How would you diagnose a query latency spike using execution plans and index tuning?`,
          hint: 'Talk through EXPLAIN ANALYZE, composite indexes, locking contention, and connection pooling.',
        },
        {
          question: `Follow-up: How do database transaction isolation levels protect against dirty reads, non-repeatable reads, and phantom reads?`,
          message: `How do you balance database transaction isolation guarantees against write throughput?`,
          hint: 'Explain Read Committed vs Repeatable Read vs Serializable and locking overhead.',
        }
      );
    }

    if (ans.includes('tree') || ans.includes('graph') || ans.includes('sliding window') || ans.includes('binary') || ans.includes('pointer') || ans.includes('hash') || ans.includes('dsa') || ans.includes('array')) {
      questionOptions.push(
        {
          question: `Follow-up: What are the strict Big-O Time and Space bounds of that approach, and how does it handle extreme boundary inputs?`,
          message: `What is the exact Time and Space complexity, and how do you handle empty or duplicate inputs?`,
          hint: 'State Big-O Time and auxiliary Space bounds upfront, then address edge cases.',
        },
        {
          question: `Follow-up: How would you optimize the auxiliary space complexity if memory constraints were restricted to O(1)?`,
          message: `How would you adapt that solution if memory was strictly constrained to O(1) auxiliary space?`,
          hint: 'Discuss in-place modifications, two-pointer pointers, or bitwise state representations.',
        }
      );
    }

    if (ans.includes('microservice') || ans.includes('api') || ans.includes('scale') || ans.includes('system') || ans.includes('docker') || ans.includes('kafka')) {
      questionOptions.push(
        {
          question: `Follow-up: If this architecture had to scale to 100,000 active concurrent requests, where would the primary bottleneck occur and how would you optimize it?`,
          message: `Where would that approach hit its first bottleneck at 100,000 concurrent users, and how would you redesign it?`,
          hint: 'Identify DB vs CPU vs network bottlenecks and propose horizontal scaling, message queues, and caching.',
        },
        {
          question: `Follow-up: How do you enforce idempotency and fault tolerance across distributed services when network partitions occur?`,
          message: `How do you guarantee idempotency and avoid duplicate processing when network retries occur?`,
          hint: 'Discuss idempotency keys, unique transaction tokens, and dead-letter queues.',
        }
      );
    }

    // General high-level technical probes exploring reasoning, failure modes, and testing
    questionOptions.push(
      {
        question: `Follow-up: What was the primary engineering trade-off you evaluated before choosing this approach over alternative solutions?`,
        message: `What engineering trade-offs did you weigh, and what would fail first if system traffic spiked 10x?`,
        hint: 'Discuss latency vs throughput, implementation complexity vs maintainability, and resource constraints.',
      },
      {
        question: `Follow-up: How do you handle failure modes such as network timeouts, partial writes, or corrupted inputs in this pipeline?`,
        message: `How does your design recover from network timeouts, partial writes, or unexpected boundary conditions?`,
        hint: 'Highlight circuit breakers, fallback responses, transaction rollbacks, and input sanitation.',
      },
      {
        question: `Follow-up: Walk me through how you would design automated unit, integration, and load tests to validate this under production stress.`,
        message: `How would you structure integration and load tests to verify this implementation before releasing to production?`,
        hint: 'Discuss mocking external dependencies, stress benchmarking with concurrent requests, and chaos testing.',
      }
    );

    // Filter out questions that have already been asked in this session to guarantee non-repetitive flow
    const freshOptions = questionOptions.filter((opt) => !isAlreadyAsked(opt.question));
    const selected = freshOptions.length > 0 ? freshOptions[0] : questionOptions[0];

    return {
      message: selected.message,
      question: selected.question,
      stage,
      isFollowUp: true,
      hint: selected.hint,
    };
  };

  // Determine whether this request is for a follow-up or next main question
  const isFollowUpRequest = req.body.isFollowUp === true || (Boolean(candidateAnswer && candidateAnswer.trim()) && req.body.isFollowUp !== false);

  const previousInterviewerQuestions = (transcript || [])
    .filter((t: any) => t.role === 'interviewer')
    .map((t: any, i: number) => `Q${i + 1}: ${t.content || t.question || ''}`)
    .filter(Boolean);

  if (!aiClient) {
    if (isFollowUpRequest) {
      return res.json(buildInstantFollowUp(candidateAnswer, previousQuestion || transcript.slice(-1)[0]?.question || '', previousInterviewerQuestions));
    }
    const sel = fallbackBanks[stage] || fallbackBanks.technical;
    return res.json({
      message: sel.message,
      question: sel.question,
      stage,
      isFollowUp: false,
      codePrompt: sel.codePrompt,
      hint: sel.hint,
    });
  }

  try {
    const fullConversationLog = (transcript || [])
      .map((t: any) => `[${t.role === 'interviewer' ? (t.isFollowUp ? 'INTERVIEWER (FOLLOW-UP)' : interviewerName) : 'STUDENT'}]: ${t.content?.slice(0, 350) || ''}`)
      .join('\n');

    const prompt = isFollowUpRequest
      ? `You are ${interviewerName}, a senior technical campus placement interviewer for ${role} at ${company} (${difficulty} level).

STUDENT'S PREVIOUS ANSWER:
"${candidateAnswer ? candidateAnswer.slice(0, 900) : '(Student provided no answer)'}"

QUESTION THE STUDENT WAS ANSWERING:
"${previousQuestion || previousInterviewerQuestions.slice(-1)[0] || 'Initial Question'}"

PREVIOUS INTERVIEW QUESTIONS ASKED IN THIS SESSION (NEVER REPEAT ANY OF THESE):
${previousInterviewerQuestions.length > 0 ? previousInterviewerQuestions.join('\n') : '(None yet)'}

CONVERSATION HISTORY:
${fullConversationLog || '(Starting conversation)'}

CRITICAL RULES:
1. RELEVANCE & CONTEXT: Generate a relevant follow-up question based SPECIFICALLY on the student's previous answers and conversation context. Never ask generic, disconnected, or unrelated questions.
2. DO NOT DISPLAY OR QUOTE PREVIOUS ANSWER: Do NOT repeat, quote verbatim, or parrot back the student's previous answer (e.g. NEVER write "You mentioned '...' " or "Regarding your answer about '...' "). Keep the question direct, natural, and conversational.
3. EXPLORE REASONING & CONCEPTS IN DEPTH: Explore the student's reasoning, technical concepts, data structures, algorithms, or architectural decisions in greater depth. Probe "why" and "how under the hood", performance trade-offs, Big-O bounds, concurrency, memory management, or failure scenarios.
4. CLARIFICATION FOR UNCLEAR ANSWERS: If the student's answer is brief, ambiguous, or unclear, ask for clarification on their reasoning, assumptions, or concrete step-by-step approach.
5. UNIQUE & NON-REPETITIVE: Ensure every question is unique, non-repetitive, and natural. Never repeat previous questions or ask about topics already discussed in previous questions. Maintain the conversation history to avoid duplicate questions.
6. NATURAL SPOKEN MESSAGE: In "message", provide a natural spoken response (under 24 words) that sounds conversational, engaging, and professional without reciting the student's words verbatim.

Output strictly valid JSON:
{
  "message": "natural spoken question under 24 words",
  "question": "Follow-up: [unique, precise follow-up question exploring reasoning/concepts in greater depth or asking for clarification]",
  "stage": "${stage}",
  "isFollowUp": true,
  "hint": "1-sentence tip on what a strong student would address"
}`
      : `You are ${interviewerName}, a senior engineering interviewer for ${role} at ${company} (${difficulty} level).
Stage: "${stage}" (Question ${currentQuestionIndex + 1} of ${totalQuestions}).

STUDENT'S RECENT RESPONSE:
"${candidateAnswer ? candidateAnswer.slice(0, 500) : 'Completed previous stage'}"

PREVIOUS QUESTIONS ASKED IN THIS SESSION (DO NOT REPEAT):
${previousInterviewerQuestions.length > 0 ? previousInterviewerQuestions.join('\n') : '(None yet)'}

CONVERSATION HISTORY:
${fullConversationLog || '(Starting conversation)'}

CRITICAL RULES:
1. Never repeat any previous question or topic already covered in this session.
2. Transition naturally with a brief spoken "message" under 24 words.
3. Present a fresh, realistic campus placement technical question for stage "${stage}".
4. Do NOT repeat or quote the student's previous answer verbatim.

Output strictly valid JSON:
{
  "message": "spoken transition and question under 24 words",
  "question": "concise core question text",
  "stage": "${stage}",
  "isFollowUp": false,
  "hint": "brief 1-sentence tip"
}`;

    const rawResponse = await callGeminiSafely(prompt, {
      json: true,
      timeoutMs: 4200,
    });

    if (rawResponse) {
      const parsed = extractJsonFromText(rawResponse);
      if (parsed && parsed.message && parsed.question) {
        if (isFollowUpRequest && !parsed.question.toLowerCase().startsWith('follow-up')) {
          parsed.question = `Follow-up: ${parsed.question}`;
        }
        parsed.isFollowUp = isFollowUpRequest;
        return res.json(parsed);
      }
    }
  } catch (err: any) {
    console.warn('Fast fallback applied for /api/generate-question:', err?.message || err);
  }

  // Fast deterministic fallback if Gemini exceeds deadline or encounters an issue
  if (isFollowUpRequest) {
    return res.json(buildInstantFollowUp(candidateAnswer, previousQuestion || transcript.slice(-1)[0]?.question || '', previousInterviewerQuestions));
  }
  const sel = fallbackBanks[stage] || fallbackBanks.technical;
  return res.json({
    message: sel.message,
    question: sel.question,
    stage,
    isFollowUp: false,
    codePrompt: sel.codePrompt,
    hint: sel.hint,
  });
});

// Helper for dynamic fast report generation deeply analyzing candidate answers
function buildFastTranscriptReport(transcript: any[], session: any, tabSwitches: number, proctorTrustScore: number) {
  const role = session?.role || 'Software Development Engineer';
  const company = session?.company || 'General Tech';
  const questionsAnswered = (transcript || []).filter((t: any) => t.role === 'interviewer');

  // Extract all valid candidate answers
  const candidateMessages = (transcript || []).filter((t: any) => t.role === 'candidate');
  const actualCandidateTexts = candidateMessages
    .map((t: any) => (t.content || '').trim())
    .filter((c: string) => c && c !== 'Spoken answer submitted.' && c !== 'No verbal answer recorded.' && !c.startsWith('[No answer'));

  const totalCandidateWords = actualCandidateTexts.reduce((sum: number, text: string) => {
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);

  // If candidate did NOT answer any question (0 words / blank / skipped all)
  if (totalCandidateWords === 0 || actualCandidateTexts.length === 0) {
    return {
      overallScore: 0,
      performanceTier: 'Needs Focused Practice',
      categoryScores: {
        technical: 0,
        communication: 0,
        problemSolving: 0,
        confidence: 0,
        accuracy: 0,
      },
      strengths: [
        'Successfully initiated the proctored interview session and webcam verification',
        `Attempted the ${role} campus placement round`,
      ],
      weaknesses: [
        'Zero questions answered: No verbal or written explanations were submitted during the interview.',
        'Unassessed technical skills: Core computer science fundamentals, architecture, and coding logic could not be evaluated.',
        'Immediate placement rejection: In campus placement drives and company interviews, leaving questions blank results in 0 score and immediate elimination.',
      ],
      drawbacks: [
        'Silence during questions: Did not record voice or type answers for the assigned interview prompts.',
        'Skipped evaluation stages: You did not communicate high-level intuition, problem constraints, or brute-force approach.',
        `No proof of technical competency provided for ${company} ${role}.`,
      ],
      improvements: [
        'Turn on the microphone or type directly into the answer box before advancing to the next question.',
        'Even if you are not 100% sure of the optimal solution, always explain your initial intuition, ask clarifying questions, and walk through a brute-force approach.',
        'Use the 3-step answering blueprint: 1) Clarify requirements, 2) Explain logic with Big-O Time & Space complexity, 3) Discuss edge cases.',
      ],
      questionBreakdown: questionsAnswered.map((t: any, idx: number) => ({
        questionNumber: idx + 1,
        stage: t.stage || 'technical',
        question: t.question || t.content,
        candidateAnswer: '[No answer recorded / Question skipped]',
        score: 0,
        feedback: 'No response was provided for this question. In placement interviews, unanswered questions receive 0/100.',
        missingConcepts: [
          'Problem decomposition & clarifying questions',
          'Core underlying algorithmic logic or system architecture',
          'Asymptotic Time & Space complexity bounds O(...)',
          'Production edge-case considerations'
        ],
        whyItNeedsImprovement: 'The question was skipped or left blank. Leaving questions unanswered in campus placement drives leads to an immediate 0/100 and elimination. Always speak through your intuition, clarify constraints, and propose a brute-force approach first.',
        drawbacks: [
          'No explanation attempted for this question.',
          'Failed to articulate the technical concepts or algorithmic mechanics required.',
        ],
        improvements: [
          'Speak through your thought process out loud even if you only have a partial idea.',
          'State the basic definition, how it functions under the hood, and a real-world example.',
        ],
        sampleAnswer: idx === 0 
          ? `Structure with 3 pillars: 1) Current focus & education, 2) Flagship engineering project with concrete metrics (e.g. "reduced API p99 latency by 38% for 5,000 active users using Redis caching"), and 3) Alignment with ${company}'s ${role} tech stack.`
          : `State the fundamental concept clearly in the first 15 seconds, specify computational complexity bounds upfront ("Runs in Time O(N) and Space O(1)"), explain runtime mechanics, and cite boundary conditions (null pointers, concurrency, network drops).`,
      })),
      recommendedResources: [
        {
          title: 'Campus Placement Speaking & Articulation Blueprint',
          type: 'Practice',
          description: 'How to overcome nervousness and verbalize engineering thoughts under interview conditions.',
          linkOrKeyTakeaway: 'Always talk through your approach from the first 5 seconds rather than remaining silent.',
        },
        {
          title: 'STAR Method Presentation Blueprint for Campus Placements',
          type: 'Framework',
          description: 'Structure answers: Situation, Task, Action, Result with quantifiable impact.',
          linkOrKeyTakeaway: 'Spend 60% of narrative on concrete Actions and measurable Results rather than backstory.',
        },
        {
          title: 'Top DSA Placement Patterns & Constraint Clarification',
          type: 'Practice',
          description: 'Master sliding window, two-pointer, BFS/DFS, and dynamic programming patterns.',
          linkOrKeyTakeaway: 'Always verify constraints: null inputs, duplicates, and state Space O(...) alongside Time O(...).',
        },
      ],
      interviewerVerdict: `Interview Incomplete. No answers were provided during this session for ${role} at ${company}. Score: 0/100. Practice speaking or typing your responses and retake the interview to establish your performance baseline.`,
      companyFitScore: 0,
      proctorTrustScore,
      tabSwitches,
    };
  }

  // Candidate provided answers: evaluate each question dynamically
  const questionBreakdown = questionsAnswered.map((t: any, idx: number) => {
    const tIndex = transcript.indexOf(t);
    const candAns = transcript.find(
      (c: any, cIdx: number) => c.role === 'candidate' && cIdx > tIndex
    );
    const rawText = candAns?.content?.trim() || '';
    const isPlaceholder = rawText === 'Spoken answer submitted.' || rawText === 'No verbal answer recorded.' || rawText.startsWith('[No answer');
    const text = isPlaceholder ? '' : rawText;
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const lower = text.toLowerCase();

    // Technical depth signals
    const hasMetrics = /\d+%|\d+\s*(ms|s|sec|users|req|queries|gb|mb)/i.test(text);
    const hasTechDepth = /react|node|express|database|postgres|sql|mongo|redis|cache|async|promise|event loop|time complexity|o\(|space complexity|algorithm|hash|tree|graph|star|architecture|microservice|load balancer|api/i.test(lower);
    const hasTradeoffs = /trade-off|bottleneck|optimize|latency|concurrency|parallel|scale|index/i.test(lower);

    let score = 0;
    let feedback = '';
    const drawbacks: string[] = [];
    const improvements: string[] = [];
    const missingConcepts: string[] = [];
    let whyItNeedsImprovement = '';

    if (wordCount === 0 || text === '') {
      score = 0;
      feedback = 'No answer provided. In campus placement drives and technical interviews, an unanswered question receives 0/100. Always share your initial intuition, ask clarifying questions, and walk through brute force.';
      missingConcepts.push('Problem constraints & clarifying questions', 'Initial algorithmic intuition', 'Underlying technical principles & mechanisms', 'Asymptotic Time/Space complexity O(...)');
      whyItNeedsImprovement = 'The question was left blank without spoken or typed content. Without an initial solution, interviewers cannot gauge your problem-solving process, language fluency, or domain fundamentals.';
      drawbacks.push('Did not attempt an oral or written explanation for this question.');
      improvements.push('Even if unsure of the full solution, explain your high-level intuition and clarify constraints.');
    } else if (wordCount < 10) {
      score = 25;
      feedback = `Extremely brief response (${wordCount} words: "${text}"). Fails to explain core mechanisms, data structure trade-offs, or production architectural considerations.`;
      missingConcepts.push('Concrete technical architecture', 'Under-the-hood execution mechanics', 'Production failure modes or edge cases');
      whyItNeedsImprovement = 'Interviewers evaluate communication depth and technical mastery. A one-sentence response signals superficial familiarity rather than working proficiency.';
      drawbacks.push('Answer was overly terse and did not elaborate on technical mechanics or architecture.');
      improvements.push('Use the 3-step elaboration formula: state the core concept, explain how it works under the hood, and cite a practical example.');
    } else if (wordCount < 25) {
      score = 50;
      feedback = `Brief response ("${text.slice(0, 50)}..."). Missing quantitative performance impact, data structure details, and engineering trade-offs.`;
      missingConcepts.push('Big-O Time & Space complexity', 'Quantitative performance metrics (% speedup, memory)', 'Edge cases & exception handling');
      whyItNeedsImprovement = 'The answer mentions top-level terminology but fails to explain runtime behaviors, memory trade-offs, or why this approach is superior to alternatives.';
      drawbacks.push('Omitted quantitative performance impact, algorithmic complexity, and edge-case handling.');
      improvements.push('Quantify the outcome (e.g. % speedup or memory savings) and proactively discuss Big-O complexity.');
    } else if (hasTechDepth && hasMetrics && hasTradeoffs) {
      score = Math.min(96, 88 + Math.min(8, Math.floor(wordCount / 20)));
      feedback = `Excellent answer! You correctly referenced relevant technical concepts and quantified real-world outcomes. Clear logical flow and strong grasp of engineering trade-offs.`;
      missingConcepts.push('Subtle boundary conditions under extreme distributed load or network partitions');
      whyItNeedsImprovement = 'Strong demonstration. To reach the top 1% bar, elaborate on distributed idempotency, network partition handling, and observability tracing.';
      improvements.push('Maintain this high standard; ensure edge cases and boundary conditions are explicitly checked.');
    } else if (hasTechDepth) {
      score = Math.min(90, 75 + Math.min(10, Math.floor(wordCount / 25)));
      feedback = `Good conceptual grasp. You accurately highlighted relevant technologies and principles. To reach top-tier placement standards, quantify results and state Time & Space complexity upfront.`;
      missingConcepts.push('Concrete benchmark numbers (% latency reduction, RPS, memory overhead)', 'Upfront Big-O bounds (Time O(...) & Space O(...))', 'Alternative architecture comparisons');
      whyItNeedsImprovement = 'While conceptually sound, top-tier engineering interviewers expect candidates to anchor architectural choices with empirical numbers, complexity guarantees, and failure mitigations.';
      drawbacks.push('Omitted quantitative performance metrics and asymptotic complexity bounds.');
      improvements.push('Quantify the outcome (e.g. % speedup or memory savings) and proactively discuss failure recovery.');
    } else {
      score = Math.min(78, 58 + Math.min(12, Math.floor(wordCount / 25)));
      feedback = `Clear communication, but needs deeper technical precision. Ground your response in concrete architecture, database behavior, or algorithmic time/space complexity.`;
      missingConcepts.push('Low-level internal mechanics & memory model', 'Standard design pattern or protocol specification', 'Empirical engineering trade-offs');
      whyItNeedsImprovement = 'The explanation relied on high-level generalities without walking through step-by-step code execution, internal thread safety, or runtime bottlenecks.';
      drawbacks.push('Relied on high-level generalities without delving into concrete engineering implementation details.');
      improvements.push('Ground your answer in specific protocols, data structures, or Big-O complexity analysis.');
    }

    const strongerSampleAnswer = idx === 0 
      ? `"${t.question || 'Tell me about yourself'}": "I am a software engineer focused on building high-performance, resilient backend systems and responsive web applications. Recently, I spearheaded an API optimization project where I refactored our caching tier using Redis and PostgreSQL connection pooling, reducing p99 latency by 42% (from 320ms to 185ms) while handling 8,500 requests per second. When approaching technical challenges, I systematically analyze Big-O complexity upfront and design for fault tolerance. I am thrilled about ${company}'s focus on scalable systems and eager to contribute to ${role}."`
      : `Model placement answer for "${(t.question || t.content || '').slice(0, 60)}...": Start with a 15-second definition ("Under the hood, X works by..."), immediately state computational bounds ("This provides Time O(N) lookup and Space O(1) auxiliary overhead"), contrast against alternatives ("Unlike naive nested scans which degrade to O(N²), hashing eliminates the bottleneck"), and finish with production resilience ("In production, we must guard against null keys, hash collisions via open addressing/chaining, and memory pressure under high throughput spikes.")`;

    return {
      questionNumber: idx + 1,
      stage: t.stage || 'technical',
      question: t.question || t.content,
      candidateAnswer: text || '[No verbal answer recorded]',
      score,
      feedback,
      missingConcepts,
      whyItNeedsImprovement,
      drawbacks: drawbacks.length > 0 ? drawbacks : ['Could explore deeper asynchronous event-loop or scaling bottlenecks.'],
      improvements: improvements.length > 0 ? improvements : ['State trade-offs between memory footprint and execution speed.'],
      sampleAnswer: strongerSampleAnswer,
    };
  });

  const totalQuestions = Math.max(session?.totalQuestions || questionsAnswered.length, questionBreakdown.length, 1);
  const totalScoreSum = questionBreakdown.reduce((sum: number, q: any) => sum + q.score, 0);
  const avgScore = Math.round(totalScoreSum / totalQuestions);

  const candidateAllText = actualCandidateTexts.join(' ');

  const strengthsList = [
    candidateAllText.length > 60 
      ? `Clear verbal articulation and responsive communication during ${role} evaluation`
      : 'Calm composure and willingness to engage with the technical prompts',
    /react|node|sql|database|api|cache/i.test(candidateAllText)
      ? 'Demonstrated practical familiarity with core software engineering and full-stack concepts'
      : 'Structured logical approach to problem-solving and situational questions',
    'Maintained consistent professional pacing and engagement throughout the rounds',
  ];

  const weaknessesList = [
    /\d+%/i.test(candidateAllText)
      ? 'Ensure algorithmic asymptotic bounds (Time & Space O(N)) are stated upfront before writing code'
      : 'Quantify project achievements with concrete measurable metrics (e.g., % latency drop, user scale, memory usage)',
    /star/i.test(candidateAllText)
      ? 'Dedicate more time to discussing edge cases, boundary inputs, and failure recovery'
      : 'Structure behavioral answers using the 15-60-15s STAR method (15s Situation, 60s Actions, 15s Results)',
  ];

  const drawbacksList = [
    candidateAllText.split(/\s+/).length < 60
      ? 'Brevity in answers: Responses were too brief, preventing the interviewer from fully evaluating your depth of engineering knowledge.'
      : 'Lack of quantified impact: Project discussions did not include specific benchmarks, latency percentages, or scale metrics.',
    !/time complexity|space complexity|o\(/i.test(candidateAllText)
      ? 'Big-O Complexity omitted upfront: You did not state runtime or memory asymptotic bounds before explaining algorithms.'
      : 'Edge cases and failure states were not proactively addressed in technical solutions.',
    !/star|situation|action|result/i.test(candidateAllText)
      ? 'Unstructured behavioral responses: Storytelling lacked clear separation between background and concrete personal actions.'
      : 'Trade-offs between alternative technologies or patterns were not contrasted.'
  ];

  const improvementsList = [
    'Apply the 15-60-15s STAR technique: Spend 15 seconds on context, 60 seconds detailing the exact code/architecture you wrote, and 15 seconds sharing measurable results.',
    'Always state Time O(...) and Space O(...) within the first 30 seconds of explaining any algorithmic problem.',
    'Prepare 2-3 hard engineering numbers (e.g. 40% query optimization, 10k concurrent users) for your flagship projects.'
  ];

  const calculatedOverall = Math.min(98, Math.max(0, avgScore));

  return {
    overallScore: calculatedOverall,
    performanceTier: calculatedOverall >= 84 ? 'Placement Ready' : calculatedOverall >= 65 ? 'Near Ready' : 'Needs Focused Practice',
    categoryScores: {
      technical: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall + 1 : 0)),
      communication: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall : 0)),
      problemSolving: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall - 1 : 0)),
      confidence: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall - 2 : 0)),
      accuracy: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall + 1 : 0)),
    },
    strengths: strengthsList,
    weaknesses: weaknessesList,
    drawbacks: drawbacksList,
    improvements: improvementsList,
    questionBreakdown,
    recommendedResources: [
      {
        title: 'STAR Method Presentation Blueprint for Campus Placements',
        type: 'Framework',
        description: 'Structure answers: Situation, Task, Action, Result with quantifiable impact.',
        linkOrKeyTakeaway: 'Spend 60% of narrative on concrete Actions and measurable Results rather than backstory.',
      },
      {
        title: 'Top DSA Placement Patterns & Constraint Clarification',
        type: 'Practice',
        description: 'Master sliding window, two-pointer, BFS/DFS, and dynamic programming patterns.',
        linkOrKeyTakeaway: 'Always verify constraints: null inputs, duplicates, and state Space O(...) alongside Time O(...).',
      },
      {
        title: 'System Design & Core CS Fundamentals for Placements',
        type: 'Article',
        description: 'Understand client-server architecture, database indexing, caching, and concurrency.',
        linkOrKeyTakeaway: 'Identify bottlenecks (network latency vs CPU vs DB query execution) systematically.',
      },
    ],
    interviewerVerdict: calculatedOverall >= 84
      ? `Candidate demonstrated solid placement readiness for ${role} at ${company}. Recommended to proceed with practice in quantifying project metrics.`
      : calculatedOverall >= 65
      ? `Candidate has strong foundational potential for ${role}, but needs focused preparation on answer structure, technical depth, and metric quantification.`
      : `Candidate needs focused practice on speaking technical concepts out loud, problem decomposition, and answering all interview prompts.`,
    companyFitScore: Math.min(98, Math.max(0, calculatedOverall > 0 ? calculatedOverall + 1 : 0)),
    proctorTrustScore,
    tabSwitches,
  };
}

// API: Comprehensive Evaluation & Report Card
app.post('/api/evaluate-interview', async (req, res) => {
  const { session, transcript = [], telemetry = {} } = req.body;
  const role = session?.role || 'Software Development Engineer';
  const company = session?.company || 'General Tech';
  const difficulty = session?.difficulty || 'Medium';

  const tabSwitches = telemetry.tabSwitches || 0;
  const proctorTrustScore = Math.max(30, Math.min(100, 100 - (tabSwitches * 12)));

  // Extract actual candidate words
  const candidateMessages = (transcript || []).filter((t: any) => t.role === 'candidate');
  const actualCandidateTexts = candidateMessages
    .map((t: any) => (t.content || '').trim())
    .filter((c: string) => c && c !== 'Spoken answer submitted.' && c !== 'No verbal answer recorded.' && !c.startsWith('[No answer'));

  const totalCandidateWords = actualCandidateTexts.reduce((sum: number, text: string) => {
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);

  // If candidate didn't answer anything, immediately return the 0% report without calling Gemini
  if (totalCandidateWords === 0 || actualCandidateTexts.length === 0) {
    return res.json(buildFastTranscriptReport(transcript, session, tabSwitches, proctorTrustScore));
  }

  if (!aiClient) {
    return res.json(buildFastTranscriptReport(transcript, session, tabSwitches, proctorTrustScore));
  }

  try {
    const transcriptSummary = (transcript || [])
      .map((t: any, i: number) => `[${t.role.toUpperCase()} Q${i+1}]: ${t.content?.slice(0, 400)}`)
      .join('\n');

    const prompt = `You are a senior campus placement evaluator reviewing an interview for ${role} at ${company} (${difficulty}).

TRANSCRIPT OF QUESTIONS AND CANDIDATE'S ACTUAL ANSWERS:
${transcriptSummary.slice(0, 3500)}
Telemetry: Tab switches: ${tabSwitches}, Proctor Trust: ${proctorTrustScore}%.
Total candidate words spoken/submitted: ${totalCandidateWords}.

CRITICAL SCORING & FEEDBACK RULES:
- The score out of 100 per question and overall MUST strictly and ruthlessly reflect the candidate's actual answers.
- If candidate left questions unanswered or blank, unanswered questions MUST receive 0 points out of 100.
- If answers are very brief (< 15 words) or lack technical substance, score them 20-50 out of 100.
- If answers are solid with technical mechanisms, score 70-84 out of 100. If exemplary with metrics, Big-O, and trade-offs, score 85-95 out of 100.
- Do NOT inflate scores or award baseline courtesy points. In campus placement interviews, silence or lack of answers receives 0/100.
- For each question:
  * "score": integer 0-100 reflecting the candidate's answer quality.
  * "missingConcepts": array of 2-4 critical concepts, algorithms, asymptotic bounds, data structures, or trade-offs that the candidate failed to mention.
  * "whyItNeedsImprovement": 2-3 sentences explaining exactly why this answer loses marks in real engineering placement evaluations.
  * "drawbacks": array of specific flaws or omissions detected in the candidate's response.
  * "improvements": array of actionable instructions to fix the answer in their next attempt.
  * "sampleAnswer": a comprehensive, high-scoring model answer demonstrating the optimal way to answer this question.

Output valid JSON matching this exact structure:
{
  "overallScore": number (0-98 based on candidate performance),
  "performanceTier": "Placement Ready" | "Near Ready" | "Needs Focused Practice",
  "categoryScores": {
    "technical": number,
    "communication": number,
    "problemSolving": number,
    "confidence": number,
    "accuracy": number
  },
  "strengths": string[] (3 strengths based on answers),
  "weaknesses": string[] (3 specific growth areas),
  "drawbacks": string[] (3 explicit drawbacks where points were lost),
  "improvements": string[] (3 actionable fixes to improve next time),
  "questionBreakdown": [
    {
      "questionNumber": number,
      "stage": string,
      "question": string,
      "candidateAnswer": string,
      "score": number,
      "feedback": string,
      "missingConcepts": string[],
      "whyItNeedsImprovement": string,
      "drawbacks": string[],
      "improvements": string[],
      "sampleAnswer": string
    }
  ],
  "recommendedResources": [
    {
      "title": string,
      "type": "Framework" | "Practice" | "Article",
      "description": string,
      "linkOrKeyTakeaway": string
    }
  ],
  "interviewerVerdict": string,
  "companyFitScore": number
}`;

    const rawResponse = await callGeminiSafely(prompt, {
      thinking: ThinkingLevel.LOW,
      json: true,
      timeoutMs: 8000,
    });

    if (rawResponse) {
      const parsed = extractJsonFromText(rawResponse);
      if (parsed && typeof parsed.overallScore === 'number' && parsed.categoryScores) {
        parsed.proctorTrustScore = parsed.proctorTrustScore ?? proctorTrustScore;
        parsed.tabSwitches = tabSwitches;
        return res.json(parsed);
      }
    }
  } catch (err: any) {
    console.warn('Fast fallback applied for /api/evaluate-interview:', err?.message || err);
  }

  // Fast deterministic report if API exceeds deadline
  return res.json(buildFastTranscriptReport(transcript, session, tabSwitches, proctorTrustScore));
});

// Setup Vite or static serving
async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MockMate Server running on http://0.0.0.0:${PORT} (${isDev ? 'development' : 'production'})`);
  });
}

startServer();
