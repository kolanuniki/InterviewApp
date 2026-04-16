# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: OpenAI (gpt-5.2) + Gemini (gemini-3-flash-preview) via Replit AI Integrations

## Artifacts

### interview-assistant (React + Vite, previewPath: /)
Real-time interview assistant app. Compact UI optimized for use during live interviews.
- Setup page: paste Job Description + Resume, select AI provider (ChatGPT or Gemini)
- Session page: type interviewer question, click "Get Answer" for streaming natural language response
- Log tab: full Q&A history for the session
- End-of-session summary: generates downloadable text file with coaching feedback

### api-server
Express 5 backend serving `/api` routes.
- `/api/interview/sessions` - CRUD for interview sessions
- `/api/interview/sessions/:id/answer` - SSE streaming answer generation
- `/api/interview/sessions/:id/summary` - Full session coaching summary

## Database Schema

- `interview_sessions` - stores JD + resume per session
- `qa_entries` - stores each question + answer + AI provider used
- `conversations` + `messages` - OpenAI/Gemini conversation scaffolding

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
