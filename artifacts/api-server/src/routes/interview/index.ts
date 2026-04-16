import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { interviewSessions, qaEntries } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateInterviewSessionBody,
  GenerateAnswerBody,
  AddQAEntryParams,
} from "@workspace/api-zod";
import { openai } from "@workspace/integrations-openai-ai-server";
import { ai } from "@workspace/integrations-gemini-ai";

// 1. RAM Storage Fix (Bypasses Render's Read-Only error)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage, limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();

// --- Keep existing routes logic ---
router.get("/sessions", async (req, res) => {
  try {
    const sessions = await db.select().from(interviewSessions).orderBy(interviewSessions.createdAt);
    res.json(sessions.map(s => ({ id: s.id, jobDescription: s.jobDescription, resume: s.resume, createdAt: s.createdAt.toISOString() })));
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

router.post("/sessions", async (req, res) => {
  try {
    const body = CreateInterviewSessionBody.parse(req.body);
    const [session] = await db.insert(interviewSessions).values({ jobDescription: body.jobDescription, resume: body.resume }).returning();
    res.status(201).json(session);
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
});

// 2. THE FIXED PARSER
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
  } catch (err) {
    res.status(500).json({ error: "Extraction failed" });
  }
});

// --- Keep AI logic ---
router.post("/sessions/:id/answer", async (req, res) => {
    // ... (Your existing AI streaming code)
    res.end();
});

export default router;