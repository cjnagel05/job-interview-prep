# Interview Prep

A React and TypeScript interview-preparation tool that turns a job description
into role responsibilities, related skills, and grounded interview questions.
The app uses Vite on the frontend and Express for server-side Gemini requests.

## Run locally

1. Install dependencies with `npm.cmd install` if needed.
2. Set `GEMINI_API_KEY=your-key` in the project-root `.env` file. It is ignored by Git.
3. Run `npm.cmd run dev` and open http://localhost:5173.

This command runs Vite on port 5173 and Express on local port 3001. Ctrl+C stops
both. Restart the command after changing `.env`. On systems where npm works
directly, `npm run dev` is equivalent to `npm.cmd run dev`.

## Deploy to Vercel

Connect the repository to Vercel with the project root as the Root Directory.
The checked-in `vercel.json` sets the Vite framework, `npm run build`, and
`dist` as the static output directory. Vercel serves those built assets from its
CDN and applies an SPA rewrite so frontend routes load `index.html`.

The `api/[...path].ts` entry exports the existing Express app as a Vercel
Function. It handles `/api/analyze` without starting a persistent server; the
serverless entry disables Express's local production static-file middleware.
Local `npm run dev` still starts Vite and the standalone Express listener, with
the existing Vite `/api` proxy.

In Vercel Project Settings, configure `GEMINI_API_KEY` for Production and
Preview (and Development if using `vercel dev`). Do not prefix it with `VITE_`.
The in-memory analysis cache is per warm Function instance and may be cleared
when Vercel replaces that instance.

The existing `server/index.ts`, `server/production.ts`, `tsconfig.build.json`,
and `start` script are the previous standalone Node-server deployment path.
Vercel does not use them; they are retained for hosts that still run a
long-lived Node process. No working production code was removed.

## How analysis works

- The form accepts a job description between 100 and 20,000 characters and rejects text without basic job-description signals.
- The browser sends `{ jobDescription }` to `/api/analyze`; Vite proxies `/api` to Express during development.
- Express validates input and makes one `client.interactions.create` request using the official `@google/genai` SDK and model `gemini-3.5-flash-lite`.
- The single request asks for the complete interview-prep result using structured JSON output generated from the Zod schema.
- The server validates Gemini's response with Zod before returning it. The browser validates the response again before rendering.
- No answers are generated. Questions are intended for preparation; actual interview questions may vary.

The API key is read only by server code through `process.env.GEMINI_API_KEY`. Never
put it in React code or use a Vite-prefixed key. The browser sends the job
description, not the API key. Gemini processes the description with `store: false`;
the app does not write it to a database or browser storage.

## Main files

- `src/components/analysis-tool.tsx`: input, request, loading, and error states.
- `src/components/interview-prep-results.tsx`: role overview, responsibilities, skills, and questions.
- `src/lib/interview-prep-schema.ts`: shared input/output validation and inferred result types.
- `server/index.ts`: loads `.env` and starts Express.
- `server/app.ts`: HTTP endpoint and safe JSON error responses.
- `server/gemini.ts`: one Gemini request and structured-output validation.
- `server/prompt.ts`: interview-preparation instructions.
- `vite.config.ts`: development proxy and local file access restrictions.
- `tsconfig.server.json`: backend TypeScript checks.

## Checks

- `npm.cmd run build`: type-check frontend and backend; create frontend `dist/`.
- `npm.cmd test`: local endpoint and schema tests; no Gemini calls or credits used.
- `npm.cmd run test:live`: with both servers running and a valid key, send two fictional job descriptions to Gemini. This uses API credits.
- `npm.cmd run lint`: run Oxlint.

`npm.cmd run preview` previews only the built frontend. The `/api` proxy is for
development. `npm.cmd run start:server` starts only the local Express API;
`npm.cmd start` starts the optional compiled Node production server.

Official references: [Gemini Interactions API](https://ai.google.dev/api/interactions-api)
and [structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## Interview practice feedback

Each generated question opens an audio-only practice session with a live camera
preview. Video is never recorded or submitted. “Get Feedback” sends the audio
and question context to `POST /api/practice-feedback` as `multipart/form-data`.

Fields: `audio` (file), `question`, `questionType`, `responsibility`,
`skills` (a JSON string array), and optional `roleTitle`. The file limit is
3,000,000 bytes (3 MB); the full multipart body is also bounded. Missing audio,
invalid containers, video tracks, invalid context, and oversized requests are
rejected before a model call.

The new endpoint uses the existing server-only `GEMINI_API_KEY` and
`gemini-3.5-flash-lite`. A single Interactions API request contains base64 inline
audio with its supplied MIME type plus the question context. No Files API upload,
database, or application cache is used for practice recordings or feedback.
Structured results are validated with the shared
`interviewPracticeFeedbackSchema` on both server and client. STAR is optional
for appropriate behavioral/experience answers and excluded for technical and
role-specific questions.

The feedback UI supports progress messages, safe retryable errors, replay after
failure, and practicing the same question again. Closing the modal cancels the
browser request and releases camera/microphone tracks.

- `api/practice-feedback.ts`: dedicated Vercel endpoint.
- `server/practice-feedback-handler.ts`: bounded multipart validation.
- `server/gemini-practice.ts`: single Gemini request and output validation.
- `server/practice-feedback-prompt.ts`: answer-focused evaluation instructions.
- `src/lib/practice-feedback-contract.ts`: shared fields, limits, and errors.
- `src/hooks/use-practice-feedback.ts`: upload, progress, cancellation, and retry.
- `node --test tests/*.test.mjs`: frontend schema, media, and upload tests using
  deterministic mocks; no API credits used.

The existing `/api/analyze` handler, prompt, model request, and cache are unchanged.
