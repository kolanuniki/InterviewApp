import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useGetInterviewSession } from "@workspace/api-client-react";

type AIProvider = "openai" | "gemini";

interface QAEntry {
  question: string;
  answer: string;
  aiProvider: string;
  timestamp: Date;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const sessionId = parseInt(id ?? "0");

  const searchParams = new URLSearchParams(window.location.search);
  const providerParam = searchParams.get("provider") as AIProvider ?? "openai";
  const [aiProvider, setAiProvider] = useState<AIProvider>(providerParam);

  useGetInterviewSession(sessionId, { query: { enabled: !!sessionId } });

  // Listening state
  const [isListening, setIsListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  // Transcript accumulated since last answer
  const [liveTranscript, setLiveTranscript] = useState("");
  const [interimText, setInterimText] = useState("");

  // We store transcripts in refs too so the answer handler always sees the latest value
  const liveTranscriptRef = useRef("");
  const interimTextRef = useRef("");

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // true = keep restarting automatically; false = user ended session
  const shouldRestartRef = useRef(true);
  const isAnsweringRef = useRef(false);

  // Answer state
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [isAnswering, setIsAnswering] = useState(false);

  // Q&A log
  const [qaLog, setQaLog] = useState<QAEntry[]>([]);
  const [activeTab, setActiveTab] = useState<"session" | "log">("session");

  // Summary
  const [showSummary, setShowSummary] = useState(false);
  const [summaryText, setSummaryText] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const transcriptBoxRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync with state
  useEffect(() => { liveTranscriptRef.current = liveTranscript; }, [liveTranscript]);
  useEffect(() => { interimTextRef.current = interimText; }, [interimText]);
  useEffect(() => { isAnsweringRef.current = isAnswering; }, [isAnswering]);

  // Auto-scroll transcript to bottom
  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [liveTranscript, interimText]);

  const startRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setMicError("Your browser does not support speech recognition. Please use Chrome or Edge.");
      return;
    }

    // Don't create a new instance if one is already running
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognitionRef.current = rec;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interim = "";
      let finalChunk = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          finalChunk += t + " ";
        } else {
          interim += t;
        }
      }
      if (finalChunk) {
        setLiveTranscript(prev => prev + finalChunk);
      }
      setInterimText(interim);
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error === "not-allowed") {
        setMicError("Microphone access denied. Please allow microphone access in your browser settings.");
        shouldRestartRef.current = false;
        setIsListening(false);
      }
      // no-speech and aborted are expected — do nothing, onend will restart
    };

    rec.onend = () => {
      setInterimText("");
      if (shouldRestartRef.current) {
        // Small delay before restarting to avoid rapid loop
        setTimeout(() => {
          if (shouldRestartRef.current && recognitionRef.current === rec) {
            try {
              rec.start();
            } catch {
              // rec is stale, startRecognition will be called via the restart logic
            }
          }
        }, 300);
      } else {
        setIsListening(false);
      }
    };

    try {
      rec.start();
      setIsListening(true);
      setMicError(null);
    } catch {
      setMicError("Could not access microphone. Please check your browser settings and reload.");
    }
  }, []);

  // Auto-start on mount, stop on unmount
  useEffect(() => {
    shouldRestartRef.current = true;
    startRecognition();
    return () => {
      shouldRestartRef.current = false;
      try { recognitionRef.current?.abort(); } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAnswer = useCallback(async () => {
    // Grab the latest transcript from refs to avoid stale closure
    const transcript = (liveTranscriptRef.current + " " + interimTextRef.current).trim();
    if (!transcript || isAnsweringRef.current) return;

    // Immediately clear the transcript — the next segment starts fresh
    setLiveTranscript("");
    setInterimText("");
    liveTranscriptRef.current = "";
    interimTextRef.current = "";

    setCurrentAnswer("");
    setIsAnswering(true);
    isAnsweringRef.current = true;
    setActiveTab("session");

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    let fullAnswer = "";
    let inferredQuestion = "";

    try {
      const response = await fetch(`${BASE}/api/interview/sessions/${sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: transcript, aiProvider }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) throw new Error("Request failed");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw);
            if (parsed.done) break;
            if (parsed.inferredQuestion && !inferredQuestion) {
              inferredQuestion = parsed.inferredQuestion;
            }
            if (parsed.content) {
              fullAnswer += parsed.content;
              setCurrentAnswer(prev => prev + parsed.content);
            }
          } catch {}
        }
      }

      if (fullAnswer) {
        setQaLog(prev => [{
          question: inferredQuestion || transcript,
          answer: fullAnswer,
          aiProvider,
          timestamp: new Date(),
        }, ...prev]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setCurrentAnswer("Could not generate an answer. Please try again.");
      }
    } finally {
      setIsAnswering(false);
      isAnsweringRef.current = false;
    }
  }, [sessionId, aiProvider]);

  const handleEndSession = () => {
    shouldRestartRef.current = false;
    try { recognitionRef.current?.abort(); } catch {}
    setIsListening(false);
    setActiveTab("log");
  };

  const handleGenerateSummary = async () => {
    setLoadingSummary(true);
    setShowSummary(true);
    try {
      const resp = await fetch(`${BASE}/api/interview/sessions/${sessionId}/summary`);
      const data = await resp.json();
      setSummaryText(data.summary ?? "No summary available.");
    } catch {
      setSummaryText("Failed to generate summary. Please try again.");
    } finally {
      setLoadingSummary(false);
    }
  };

  const handleDownloadSummary = () => {
    const blob = new Blob([summaryText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-summary-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasTranscript = (liveTranscript + interimText).trim().length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ maxWidth: "480px", margin: "0 auto" }}>
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {micError ? (
            <>
              <span className="w-2 h-2 rounded-full bg-destructive" />
              <span className="text-sm font-semibold text-destructive">Mic Error</span>
            </>
          ) : isListening ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-semibold text-foreground">Listening</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-sm font-semibold text-muted-foreground">Session Ended</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={aiProvider}
            onChange={e => setAiProvider(e.target.value as AIProvider)}
            className="text-xs bg-background border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="openai">ChatGPT GPT-5</option>
            <option value="gemini">Gemini Flash</option>
          </select>
          {isListening ? (
            <button
              onClick={handleEndSession}
              className="text-xs bg-destructive/10 text-destructive border border-destructive/30 px-3 py-1.5 rounded-lg font-medium hover:bg-destructive/20 transition-colors"
            >
              End Session
            </button>
          ) : (
            <button
              onClick={() => navigate("/")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Back
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        <button
          onClick={() => setActiveTab("session")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "session"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Session
        </button>
        <button
          onClick={() => setActiveTab("log")}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            activeTab === "log"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Log {qaLog.length > 0 && (
            <span className="ml-1 text-xs bg-primary/20 text-primary rounded-full px-1.5 py-0.5">{qaLog.length}</span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "session" && (
          <div className="p-4 space-y-3">
            {micError && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm text-destructive">
                {micError}
                <p className="text-xs mt-1 opacity-80">Reload the page and allow microphone access when prompted.</p>
              </div>
            )}

            {/* Live Transcript */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  {isListening && !isAnswering && (
                    <span className="flex gap-0.5 items-end h-3">
                      <span className="w-0.5 bg-emerald-400 rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "40%", animationDelay: "0ms" }} />
                      <span className="w-0.5 bg-emerald-400 rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "70%", animationDelay: "120ms" }} />
                      <span className="w-0.5 bg-emerald-400 rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "100%", animationDelay: "240ms" }} />
                      <span className="w-0.5 bg-emerald-400 rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "70%", animationDelay: "360ms" }} />
                      <span className="w-0.5 bg-emerald-400 rounded-full animate-[bounce_0.8s_ease-in-out_infinite]" style={{ height: "40%", animationDelay: "480ms" }} />
                    </span>
                  )}
                  What's being said
                </span>
                {hasTranscript && !isAnswering && (
                  <button
                    onClick={() => { setLiveTranscript(""); setInterimText(""); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div
                ref={transcriptBoxRef}
                className="min-h-[120px] max-h-[200px] overflow-y-auto"
              >
                {!hasTranscript ? (
                  <p className="text-sm text-muted-foreground text-center pt-8 italic">
                    {isListening
                      ? "Listening for speech... speak now"
                      : "Start the session to begin listening"}
                  </p>
                ) : (
                  <p className="text-sm text-foreground leading-relaxed">
                    {liveTranscript}
                    <span className="text-muted-foreground">{interimText}</span>
                  </p>
                )}
              </div>

              {!isAnswering && hasTranscript && (
                <p className="text-xs text-muted-foreground border-t border-border/50 pt-2">
                  When the interviewer finishes asking, press Answer. The transcript resets automatically for the next question.
                </p>
              )}
            </div>

            {/* Answer Button */}
            <button
              onClick={handleAnswer}
              disabled={!hasTranscript || isAnswering}
              className="w-full h-14 bg-primary text-primary-foreground font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-base"
            >
              {isAnswering ? (
                <>
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Generating answer...
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  Answer
                </>
              )}
            </button>

            {/* Answer Display */}
            {(currentAnswer || isAnswering) && (
              <div className="bg-card border border-primary/20 rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-primary uppercase tracking-wider">Your Answer</span>
                  {isAnswering && <span className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />}
                </div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {currentAnswer}
                  {isAnswering && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse" />}
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "log" && (
          <div className="p-4 space-y-4">
            {qaLog.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground text-sm">No answers yet. Answers will appear here as you go through the interview.</p>
              </div>
            ) : (
              <>
                {qaLog.map((entry, i) => (
                  <div key={i} className="bg-card border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        Q{qaLog.length - i} &middot; {entry.aiProvider === "openai" ? "ChatGPT" : "Gemini"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {entry.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                        {entry.question.length > 200 ? entry.question.slice(0, 200) + "..." : entry.question}
                      </p>
                      <p className="text-sm text-foreground leading-relaxed">{entry.answer}</p>
                    </div>
                  </div>
                ))}

                <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Session Summary</h3>
                  <p className="text-xs text-muted-foreground">
                    Generate a full coaching review with tips and improvement suggestions.
                  </p>
                  {!showSummary ? (
                    <button
                      onClick={handleGenerateSummary}
                      className="w-full bg-secondary text-secondary-foreground font-medium py-2.5 rounded-lg hover:opacity-90 transition-opacity text-sm"
                    >
                      Generate Summary
                    </button>
                  ) : (
                    <div className="space-y-3">
                      {loadingSummary ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                          Generating summary...
                        </div>
                      ) : (
                        <>
                          <div className="bg-background border border-border rounded-lg p-3 max-h-64 overflow-y-auto">
                            <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{summaryText}</p>
                          </div>
                          <button
                            onClick={handleDownloadSummary}
                            className="w-full bg-primary text-primary-foreground font-medium py-2.5 rounded-lg hover:opacity-90 transition-opacity text-sm flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                            Download Summary
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
