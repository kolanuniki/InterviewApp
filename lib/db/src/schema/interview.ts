import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const interviewSessions = pgTable("interview_sessions", {
  id: serial("id").primaryKey(),
  jobDescription: text("job_description").notNull(),
  resume: text("resume").notNull(),
  customPrompt: text("custom_prompt").default("").notNull(),
  extraContext: text("extra_context").default("").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInterviewSessionSchema = createInsertSchema(interviewSessions).omit({ id: true, createdAt: true });
export type InsertInterviewSession = z.infer<typeof insertInterviewSessionSchema>;
export type InterviewSession = typeof interviewSessions.$inferSelect;

export const qaEntries = pgTable("qa_entries", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => interviewSessions.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  aiProvider: text("ai_provider").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertQAEntrySchema = createInsertSchema(qaEntries).omit({ id: true, createdAt: true });
export type InsertQAEntry = z.infer<typeof insertQAEntrySchema>;
export type QAEntry = typeof qaEntries.$inferSelect;
