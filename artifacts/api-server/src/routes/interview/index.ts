import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { interviewSessions, qaEntries } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateInterviewSessionBody } from "@workspace/api-zod";
import { ai } from "@workspace/integrations-gemini-ai";

const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });
const router = Router();

// 1. GET ALL SESSIONS
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await db.select().from(interviewSessions).orderBy(interviewSessions.createdAt);
    res.json(sessions.map(s => ({ id: s.id, jobDescription: s.jobDescription, resume: s.resume, createdAt: s.createdAt.toISOString() })));
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

// 2. GET SINGLE SESSION
router.get("/sessions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [session] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, id));
    if (!session) return res.status(404).json({ error: "Session not found" });
    const entries = await db.select().from(qaEntries).where(eq(qaEntries.sessionId, id));
    res.json({ ...session, entries });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

// 3. CREATE SESSION
router.post("/sessions", async (req, res) => {
  try {
    const body = CreateInterviewSessionBody.parse(req.body);
    const [session] = await db.insert(interviewSessions).values({ jobDescription: body.jobDescription, resume: body.resume }).returning();
    res.status(201).json(session);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

// 4. THE AI ANSWER LOGIC (The "Brain")
router.post("/sessions/:id/answer", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { text: userResponse } = req.body;

    // A. Get the Context (Resume + JD) from DB
    const [session] = await db.select().from(interviewSessions).where(eq(interviewSessions.id, id));
    if (!session) return res.status(404).json({ error: "Session not found" });

    // B. Call Gemini
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `
      You are an expert technical interviewer. 
      Job Description: ${session.jobDescription}
      Candidate Resume: ${session.resume}
      Candidate's last answer: "${userResponse}"
      
      Based on the resume and the job description, evaluate their answer and ask ONE relevant follow-up interview question. 
      Keep your response professional and concise.
    `;

    const result = await model.generateContent(prompt);
    const aiQuestion = result.response.text();

    // C. Save the exchange to the database
    await db.insert(qaEntries).values({
      sessionId: id,
      question: aiQuestion,
      answer: userResponse
    });

    res.json({ question: aiQuestion });
  } catch (err) {
    console.error("AI Error:", err);
    res.status(500).json({ error: "The AI is having trouble thinking. Check your API Key names!" });
  }
});

// 5. PARSE DOCUMENT (Keep your existing working parser here)
router.post("/parse-document", upload.single("file"), async (req, res) => {
    // ... (Your existing working parser code)
});

export default router;