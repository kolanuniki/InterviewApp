import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { interviewSessions, qaEntries } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateInterviewSessionBody,
  GenerateAnswerBody,
  AddQAEntryBody,
  GetInterviewSessionParams,
  DeleteInterviewSessionParams,
  GetInterviewSummaryParams,
  AddQAEntryParams,
  GenerateAnswerParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ai } from "@workspace/integrations-gemini-ai";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

// List sessions
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await db.select().from(interviewSessions).orderBy(interviewSessions.createdAt);
    res.json(sessions.map(s => ({
      id: s.id,
      jobDescription: s.jobDescription,
      resume: s.resume,
      customPrompt: s.customPrompt,
      extraContext: s.extraContext,
      createdAt: s.createdAt.toISOString(),
    })));
  } catch (err) {
    req.log.error({ err }, "Failed to list sessions");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create session
router.post("/sessions", async (req, res) => {
  try {
    const body = CreateInterviewSessionBody.parse(req.body);
    const [session] = await db.insert(interviewSessions).values({
      jobDescription: body.jobDescription,
      resume: body.resume,
      customPrompt: body.customPrompt ?? "",
      extraContext: body.extraContext ?? "",
    }).returning();
    res.status(201).json({
      id: session.id,
      jobDescription: session.jobDescription,
      resume: session.resume,
      customPrompt: session.customPrompt,
      extraContext: session.extraContext,
      createdAt: session.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to create session");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get session with Q&A
router.get("/sessions/:id", async (req, res) => {
  try {
    const { id } = GetInterviewSessionParams.parse({ id: parseInt(req.params.id) });
    const session = await db.query.interviewSessions.findFirst({
      where: eq(interviewSessions.id, id),
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const entries = await db.select().from(qaEntries).where(eq(qaEntries.sessionId, id)).orderBy(qaEntries.createdAt);

    res.json({
      id: session.id,
      jobDescription: session.jobDescription,
      resume: session.resume,
      customPrompt: session.customPrompt,
      extraContext: session.extraContext,
      createdAt: session.createdAt.toISOString(),
      qaEntries: entries.map(e => ({
        id: e.id,
        sessionId: e.sessionId,
        question: e.question,
        answer: e.answer,
        aiProvider: e.aiProvider,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get session");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete session
router.delete("/sessions/:id", async (req, res) => {
  try {
    const { id } = DeleteInterviewSessionParams.parse({ id: parseInt(req.params.id) });
    const deleted = await db.delete(interviewSessions).where(eq(interviewSessions.id, id)).returning();
    if (!deleted.length) return res.status(404).json({ error: "Session not found" });
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete session");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Parse document and extract text
router.post("/parse-document", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { mimetype, originalname, buffer } = req.file;
    let extractedText = "";
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";

    if (mimetype === "application/pdf" || ext === "pdf") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      extractedText = data.text ?? "";
    } else if (
      mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value ?? "";
    } else if (mimetype === "application/msword" || ext === "doc") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value ?? "";
    } else {
      // Plain text, markdown, etc.
      extractedText = buffer.toString("utf-8");
    }

    // Trim and limit to 50k chars to avoid enormous contexts
    extractedText = extractedText.trim().slice(0, 50000);

    res.json({
      filename: originalname,
      text: extractedText,
      charCount: extractedText.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to parse document");
    res.status(500).json({ error: "Failed to extract text from document" });
  }
});

// Build system prompt from session
function buildSystemPrompt(session: {
  jobDescription: string;
  resume: string;
  customPrompt: string;
  extraContext: string;
}): string {
  const parts: string[] = [];

  parts.push(`You are an expert interview coach helping a candidate respond to interview questions naturally and convincingly.

## CRITICAL: Input is a Raw Speech Transcript
The user will give you a raw transcript captured from a microphone during a live interview. This transcript may contain a mix of:
- The interviewer's question (what you must answer)
- Normal small talk or pleasantries between people
- The candidate reading a previous answer aloud to the interviewer
- Background conversation or incomplete sentences
- Filler words, false starts, or repeated phrases

Your task:
1. Identify the MOST RECENT genuine interview question in the transcript — typically the last substantive question raised. Ignore anything that sounds like it was copied from a formal, polished written answer (that is the candidate reading a previous AI-generated response aloud).
2. Answer that question as if you are the candidate speaking live to the interviewer.
3. Do NOT answer questions about reading previous answers, do not answer "I think my strength is..." style readbacks — those are the candidate rehearsing, not questions.`);

  if (session.customPrompt?.trim()) {
    parts.push(`\n## Interview Style Instructions\n${session.customPrompt.trim()}`);
  }

  parts.push(`\n## Job Description\n${session.jobDescription}`);
  parts.push(`\n## Candidate Resume/Background\n${session.resume}`);

  if (session.extraContext?.trim()) {
    parts.push(`\n## Additional Context from Uploaded Documents\n${session.extraContext.trim()}`);
  }

  parts.push(`\n## Answer Format Rules
- Write as if the candidate is speaking directly to the interviewer out loud
- Keep it 2-4 paragraphs maximum, no bullet points, no headers, no lists
- Be specific and draw from the resume and uploaded documents
- Sound confident and genuine — conversational, use contractions and natural speech
- For behavioral questions, weave the STAR method naturally into the narrative
- Match any tone/style instructions given above
- Start the answer directly — do NOT say "Great question" or preamble`);

  return parts.join("\n");
}

// Generate answer via AI (SSE streaming)
router.post("/sessions/:id/answer", async (req, res) => {
  try {
    const { id } = GenerateAnswerParams.parse({ id: parseInt(req.params.id) });
    const body = GenerateAnswerBody.parse(req.body);

    const session = await db.query.interviewSessions.findFirst({
      where: eq(interviewSessions.id, id),
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const systemPrompt = buildSystemPrompt(session);
    const question = body.question;
    let fullResponse = "";

    if (body.aiProvider === "openai") {
      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Raw speech transcript from the interview:\n\n${question}` },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }
    } else {
      const stream = await ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: [
          { role: "user", parts: [{ text: `${systemPrompt}\n\nRaw speech transcript from the interview:\n\n${question}` }] },
        ],
        config: { maxOutputTokens: 8192 },
      });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          fullResponse += text;
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }
    }

    // Save the Q&A entry
    await db.insert(qaEntries).values({
      sessionId: id,
      question,
      answer: fullResponse,
      aiProvider: body.aiProvider,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    req.log.error({ err }, "Failed to generate answer");
    res.write(`data: ${JSON.stringify({ error: "Failed to generate answer" })}\n\n`);
    res.end();
  }
});

// Get session summary
router.get("/sessions/:id/summary", async (req, res) => {
  try {
    const { id } = GetInterviewSummaryParams.parse({ id: parseInt(req.params.id) });
    const session = await db.query.interviewSessions.findFirst({
      where: eq(interviewSessions.id, id),
    });
    if (!session) return res.status(404).json({ error: "Session not found" });

    const entries = await db.select().from(qaEntries).where(eq(qaEntries.sessionId, id)).orderBy(qaEntries.createdAt);

    if (!entries.length) {
      return res.json({ summary: "No questions answered yet in this session." });
    }

    const qaText = entries.map((e, i) =>
      `Q${i + 1}: ${e.question}\nAnswer: ${e.answer}`
    ).join("\n\n---\n\n");

    const prompt = `You are a career coach reviewing an interview session.

Job Description:
${session.jobDescription}

Candidate Resume:
${session.resume}

${session.extraContext ? `Additional candidate documents:\n${session.extraContext}\n` : ""}

Interview Q&A Log:
${qaText}

Please write a comprehensive interview preparation summary including:
1. A brief overview of the session
2. For each Q&A: the question, what was good about the answer, and 1-2 tips to improve
3. Key strengths demonstrated across the session
4. Areas for improvement
5. 3-5 specific prep tips for future interviews for this role

Write in a helpful, encouraging coach voice. Format with clear sections.`;

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    });

    const summary = response.choices[0]?.message?.content ?? "Unable to generate summary.";
    res.json({ summary });
  } catch (err) {
    req.log.error({ err }, "Failed to get summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

// Add Q&A entry manually
router.post("/sessions/:id/qa", async (req, res) => {
  try {
    const { id } = AddQAEntryParams.parse({ id: parseInt(req.params.id) });
    const body = AddQAEntryBody.parse(req.body);
    const [entry] = await db.insert(qaEntries).values({
      sessionId: id,
      question: body.question,
      answer: body.answer,
      aiProvider: body.aiProvider,
    }).returning();
    res.status(201).json({
      id: entry.id,
      sessionId: entry.sessionId,
      question: entry.question,
      answer: entry.answer,
      aiProvider: entry.aiProvider,
      createdAt: entry.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to add Q&A entry");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
