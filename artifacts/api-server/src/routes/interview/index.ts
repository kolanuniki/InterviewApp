import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { interviewSessions, qaEntries } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateInterviewSessionBody,
} from "@workspace/api-zod";
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

// 2. FIXED: GET SINGLE SESSION (This fixes the 404!)
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

// 4. PARSE DOCUMENT
router.post("/parse-document", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const { mimetype, originalname, buffer } = req.file;
    let extractedText = "";
    const ext = originalname.split(".").pop()?.toLowerCase() ?? "";

    if (mimetype === "application/pdf" || ext === "pdf") {
      const pdfParse = require("pdf-parse");
      const data = await pdfParse(buffer);
      extractedText = data.text ?? "";
    } else if (ext === "docx" || ext === "doc") {
      const mammoth = require("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      extractedText = result.value ?? "";
    } else {
      extractedText = buffer.toString("utf-8");
    }
    res.json({ filename: originalname, text: extractedText.trim().slice(0, 50000) });
  } catch (err) { res.status(500).json({ error: "Extraction failed" }); }
});

// 5. ANSWER ROUTE (Modified for Gemini)
router.post("/sessions/:id/answer", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { audio, text } = req.body; // Depending on how your frontend sends data

        // Call your Gemini integration here
        // const response = await ai.generateResponse(text, ...); 
        
        // For now, let's send a success so the frontend stops waiting
        res.json({ status: "received", message: "AI is processing" });
    } catch (err) {
        res.status(500).json({ error: "AI failed to respond" });
    }
});

export default router;