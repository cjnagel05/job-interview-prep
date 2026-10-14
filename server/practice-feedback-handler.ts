import { interviewFeedbackSchema, type InterviewFeedback } from '../src/lib/interview-feedback-schema.js'
import { MAX_PRACTICE_AUDIO_BYTES, MAX_PRACTICE_REQUEST_BYTES, practiceFeedbackContextSchema } from '../src/lib/practice-feedback-contract.js'
import { reviewPracticeAnswer, type PracticeFeedbackInput } from './gemini-practice.js'
import { PracticeFeedbackError } from './practice-feedback-error.js'
import { validatePracticeAudio } from './practice-audio.js'

export type PracticeReviewer = (input: PracticeFeedbackInput) => Promise<InterviewFeedback>

async function readMultipart(request: Request): Promise<FormData> {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get('content-type') ?? '')) {
    throw new PracticeFeedbackError(400, 'invalid_request')
  }
  const length = Number(request.headers.get('content-length'))
  if (length > MAX_PRACTICE_REQUEST_BYTES) throw new PracticeFeedbackError(413, 'recording_too_large')
  if (!request.body) throw new PracticeFeedbackError(400, 'invalid_request')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_PRACTICE_REQUEST_BYTES) {
        await reader.cancel()
        throw new PracticeFeedbackError(413, 'recording_too_large')
      }
      chunks.push(chunk.value)
    }
    const bytes = Buffer.concat(chunks, size)
    const multipart = new Request('http://localhost/practice-feedback', {
      method: 'POST',
      headers: { 'Content-Type': request.headers.get('content-type')! },
      body: bytes,
    })
    return await multipart.formData()
  } catch (error) {
    if (error instanceof PracticeFeedbackError) throw error
    throw new PracticeFeedbackError(400, 'invalid_request')
  } finally {
    reader.releaseLock()
  }
}

export function createPracticeFeedbackHandler(review: PracticeReviewer = reviewPracticeAnswer) {
  return async function handlePracticeFeedback(request: Request): Promise<Response> {
    const respond = (body: unknown, status: number) =>
      Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
    if (request.method !== 'POST') {
      return Response.json({ error: 'Use POST to submit a practice recording.', category: 'invalid_request' },
        { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } })
    }
    try {
      const form = await readMultipart(request)
      const allowed = new Set(['audio', 'question', 'questionType', 'responsibility', 'skills', 'roleTitle'])
      const counts = new Set<string>()
      for (const [key, value] of form.entries()) {
        if (!allowed.has(key) || counts.has(key) || (key !== 'audio' && typeof value !== 'string')) {
          throw new PracticeFeedbackError(400, 'invalid_request')
        }
        counts.add(key)
      }
      const file = form.get('audio')
      if (!file || typeof file === 'string' || !file.size) throw new PracticeFeedbackError(400, 'missing_audio')
      if (file.size > MAX_PRACTICE_AUDIO_BYTES) throw new PracticeFeedbackError(413, 'recording_too_large')
      let skills: unknown
      try { skills = JSON.parse(String(form.get('skills'))) } catch {
        throw new PracticeFeedbackError(400, 'invalid_request')
      }
      const context = practiceFeedbackContextSchema.safeParse({
        question: form.get('question'),
        questionType: form.get('questionType'),
        responsibility: form.get('responsibility'),
        skills,
        roleTitle: form.get('roleTitle') ?? undefined,
      })
      if (!context.success) throw new PracticeFeedbackError(400, 'invalid_request')
      const audio = Buffer.from(await file.arrayBuffer())
      validatePracticeAudio(audio, file.type)
      const result = interviewFeedbackSchema.safeParse(await review({ ...context.data, audio, mimeType: file.type }))
      if (!result.success || result.data.questionType !== context.data.questionType) {
        throw new PracticeFeedbackError(502, 'temporary_service_issue')
      }
      return respond(result.data, 200)
    } catch (error) {
      if (error instanceof PracticeFeedbackError) {
        return respond({ error: error.message, category: error.category }, error.status)
      }
      const safeError = new PracticeFeedbackError(503, 'temporary_service_issue')
      return respond({ error: safeError.message, category: safeError.category }, safeError.status)
    }
  }
}
