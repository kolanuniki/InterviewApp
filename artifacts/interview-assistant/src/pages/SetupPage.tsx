import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useCreateInterviewSession } from "@workspace/api-client-react";

type AIProvider = "openai" | "gemini";
type SetupTab = "context" | "prompt" | "documents";

interface UploadedDoc {
  name: string;
  text: string;
  size: number;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PROMPT_PRESETS = [
  { label: "Senior Engineer", value: "Answer as a seasoned senior software engineer with strong system design skills and technical depth. Be precise and demonstrate architectural thinking." },
  { label: "Product Manager", value: "Answer as a product manager with strong cross-functional experience. Emphasize data-driven decisions, stakeholder alignment, and customer obsession." },
  { label: "Leadership Focus", value: "Emphasize leadership, team management, and mentoring in every answer. Use examples that showcase influence, decision-making under pressure, and building strong teams." },
  { label: "STAR Format", value: "Always structure answers using the STAR method (Situation, Task, Action, Result) naturally woven into conversational paragraphs. Include specific metrics and outcomes where possible." },
  { label: "Startup / Entrepreneurial", value: "Answer with a scrappy, ownership-driven mindset. Highlight examples of wearing multiple hats, building from zero, and thriving in ambiguity." },
  { label: "Data / Analytics", value: "Emphasize data-driven thinking, analytics, SQL/Python expertise, and translating insights into business decisions." },
];

export default function SetupPage() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<SetupTab>("context");

  // Context tab
  const [jobDescription, setJobDescription] = useState("");
  const [resume, setResume] = useState("");
  const [aiProvider, setAiProvider] = useState<AIProvider>("openai");

  // Prompt tab
  const [customPrompt, setCustomPrompt] = useState("");

  // Documents tab
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createSession = useCreateInterviewSession();

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setUploading(true);
    setUploadError(null);

    for (const file of Array.from(files)) {
      try {
        const ext = file.name.split(".").pop()?.toLowerCase();
        if (ext === "txt" || ext === "md" || ext === "csv") {
          // Read client-side for plain text
          const text = await file.text();
          setUploadedDocs(prev => [...prev, { name: file.name, text: text.slice(0, 50000), size: file.size }]);
        } else {
          // Send to backend for PDF/DOCX extraction
          const formData = new FormData();
          formData.append("file", file);
          const resp = await fetch(`${BASE}/api/interview/parse-document`, {
            method: "POST",
            body: formData,
          });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: "Upload failed" }));
            setUploadError(err.error ?? "Upload failed");
            continue;
          }
          const data = await resp.json();
          setUploadedDocs(prev => [...prev, { name: data.filename, text: data.text, size: file.size }]);
        }
      } catch {
        setUploadError(`Failed to read ${file.name}`);
      }
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeDoc = (index: number) => {
    setUploadedDocs(prev => prev.filter((_, i) => i !== index));
  };

  const handleStart = async () => {
    if (!jobDescription.trim() || !resume.trim()) {
      setActiveTab("context");
      return;
    }

    const extraContext = uploadedDocs.map(d => `=== ${d.name} ===\n${d.text}`).join("\n\n");

    const session = await createSession.mutateAsync({
      data: {
        jobDescription: jobDescription.trim(),
        resume: resume.trim(),
        customPrompt: customPrompt.trim(),
        extraContext,
      },
    });
    navigate(`/session/${session.id}?provider=${aiProvider}`);
  };

  const tabClass = (tab: SetupTab) =>
    `flex-1 py-2.5 text-sm font-medium transition-colors ${
      activeTab === tab
        ? "text-primary border-b-2 border-primary bg-card"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 pt-8">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-4 py-1.5 mb-3">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-primary text-sm font-medium">Interview Assistant</span>
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-1">Set up your session</h1>
          <p className="text-muted-foreground text-sm">Configure your interview context, then go live</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border mb-0">
          <button onClick={() => setActiveTab("context")} className={tabClass("context")}>
            Context
            {(!jobDescription.trim() || !resume.trim()) && (
              <span className="ml-1.5 w-1.5 h-1.5 bg-destructive rounded-full inline-block" />
            )}
          </button>
          <button onClick={() => setActiveTab("prompt")} className={tabClass("prompt")}>
            Prompt
            {customPrompt.trim() && (
              <span className="ml-1.5 w-1.5 h-1.5 bg-primary rounded-full inline-block" />
            )}
          </button>
          <button onClick={() => setActiveTab("documents")} className={tabClass("documents")}>
            Documents
            {uploadedDocs.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/20 text-primary rounded-full px-1.5 py-0.5">{uploadedDocs.length}</span>
            )}
          </button>
        </div>

        <div className="bg-card border border-border border-t-0 rounded-b-xl rounded-tr-xl p-5 space-y-4">
          {activeTab === "context" && (
            <>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Job Description</label>
                <textarea
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                  placeholder="Paste the full job description here..."
                  rows={6}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Your Resume / Background</label>
                <textarea
                  value={resume}
                  onChange={e => setResume(e.target.value)}
                  placeholder="Paste your resume or key background information..."
                  rows={6}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">AI Provider</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setAiProvider("openai")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                      aiProvider === "openai"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.1 14.03A4.5 4.5 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.369 2.02-1.168a.076.076 0 0 1 .071 0l4.719 2.724a4.5 4.5 0 0 1-.676 8.122V12.44a.786.786 0 0 0-.291-.69zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.717-2.724a4.5 4.5 0 0 1 6.665 4.661zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.141.081-4.78 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>
                    ChatGPT (GPT-5)
                  </button>
                  <button
                    onClick={() => setAiProvider("gemini")}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border text-sm font-medium transition-all ${
                      aiProvider === "gemini"
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.372 0 0 5.373 0 12s5.372 12 12 12 12-5.373 12-12S18.628 0 12 0zm-.33 5.002a.598.598 0 0 1 .66 0c1.57 1.046 3.14 3.14 3.14 6.998 0 3.857-1.57 5.952-3.14 6.998a.598.598 0 0 1-.66 0C10.1 17.952 8.53 15.857 8.53 12c0-3.858 1.57-5.952 3.14-6.998zm-5.548 1.546a.6.6 0 0 1 .572.083c1.046 1.046 1.57 3.14 1.57 5.369 0 2.23-.524 4.323-1.57 5.369a.6.6 0 0 1-.572.083C5.03 16.408 4 14.313 4 12c0-2.314 1.03-4.408 2.122-5.452zm11.756 0C19.07 7.592 20 9.686 20 12c0 2.314-.93 4.408-2.122 5.452a.6.6 0 0 1-.572-.083C16.26 16.323 15.73 14.23 15.73 12c0-2.23.53-4.323 1.576-5.369a.6.6 0 0 1 .572-.083z"/></svg>
                    Gemini Flash
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === "prompt" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Custom Interview Instructions</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Tell the AI how to respond — interview style, persona, focus areas, or tone. This shapes every answer generated during your interview.
                </p>
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Answer as a senior product manager with a focus on data-driven decisions and cross-functional leadership. Always include specific metrics where relevant..."
                  rows={5}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                />
              </div>

              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Quick Presets</p>
                <div className="grid grid-cols-2 gap-2">
                  {PROMPT_PRESETS.map(preset => (
                    <button
                      key={preset.label}
                      onClick={() => setCustomPrompt(preset.value)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-all ${
                        customPrompt === preset.value
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground bg-background"
                      }`}
                    >
                      <span className="font-medium block text-xs mb-0.5">{preset.label}</span>
                      <span className="text-xs opacity-70 line-clamp-2">{preset.value.slice(0, 60)}...</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === "documents" && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">Upload Supporting Documents</label>
                <p className="text-xs text-muted-foreground mb-3">
                  Upload portfolios, cover letters, certifications, project writeups, or any relevant documents. The AI will read and use them to tailor your answers.
                  <span className="block mt-1 text-muted-foreground/70">Supported: PDF, Word (.docx), and text files (.txt, .md)</span>
                </p>

                {uploadError && (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-sm text-destructive mb-3">
                    {uploadError}
                  </div>
                )}

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="w-full border-2 border-dashed border-border rounded-xl py-8 flex flex-col items-center gap-2 hover:border-primary/50 hover:bg-primary/5 transition-all cursor-pointer disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <span className="text-sm text-muted-foreground">Reading document...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.687 11.063" />
                      </svg>
                      <span className="text-sm font-medium text-foreground">Click to upload files</span>
                      <span className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD — up to 20MB each</span>
                    </>
                  )}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.doc,.txt,.md,.csv"
                  className="hidden"
                  onChange={e => handleFileUpload(e.target.files)}
                />
              </div>

              {uploadedDocs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Uploaded Documents</p>
                  {uploadedDocs.map((doc, i) => (
                    <div key={i} className="flex items-center justify-between bg-background border border-border rounded-lg px-3 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                        </svg>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                          <p className="text-xs text-muted-foreground">{doc.text.length.toLocaleString()} characters extracted</p>
                        </div>
                      </div>
                      <button
                        onClick={() => removeDoc(i)}
                        className="shrink-0 ml-2 text-muted-foreground hover:text-destructive transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Start button always visible */}
          <div className="pt-2 border-t border-border">
            {(!jobDescription.trim() || !resume.trim()) && activeTab !== "context" && (
              <p className="text-xs text-muted-foreground text-center mb-2">
                Complete the <button className="text-primary underline" onClick={() => setActiveTab("context")}>Context tab</button> first (JD + Resume required)
              </p>
            )}
            <button
              onClick={handleStart}
              disabled={!jobDescription.trim() || !resume.trim() || createSession.isPending}
              className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createSession.isPending ? "Starting..." : "Start Interview Session"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
