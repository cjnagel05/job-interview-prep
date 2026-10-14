import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createApp } from './app.js'
import { createPracticeFeedbackHandler } from './practice-feedback-handler.js'
import { createPracticeFeedbackReviewer, safePracticeGeminiError } from './gemini-practice.js'
import { PracticeFeedbackError } from './practice-feedback-error.js'
import { validatePracticeAudio } from './practice-audio.js'
import { MAX_PRACTICE_AUDIO_BYTES, MAX_PRACTICE_REQUEST_BYTES } from '../src/lib/practice-feedback-contract.js'
import { interviewPracticeFeedbackSchema, type InterviewPracticeFeedback } from '../src/lib/interview-feedback-schema.js'
import { POST } from '../api/practice-feedback.js'

const context = {
  question: 'Tell me about a time you improved a process.',
  questionType: 'behavioral' as const,
  responsibility: 'Improve internal team processes.',
  skills: ['Communication', 'Process improvement'],
  roleTitle: 'Operations coordinator',
}
const feedback: InterviewPracticeFeedback = {
  questionType: 'behavioral',
  transcript: 'I reviewed the intake process and created a checklist that reduced missed steps.',
  overallFeedback: 'You described your own actions clearly. Add a concrete outcome.',
  scores: { relevance: 4, specificity: 3, clarity: 4, jobAlignment: 4 },
  strengths: ['Identifies your own contribution.'],
  improvements: ['Explain what changed after introducing the checklist.'],
  nextAttemptFocus: 'Include one measure of the result.',
  star: { situation: 'partial', task: 'partial', action: 'strong', result: 'missing' },
}

function wav(size = 100): Buffer {
  const bytes = Buffer.alloc(Math.max(size, 44))
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8)
  bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40)
  return bytes
}
function element(id: string, data: Buffer) {
  assert.ok(data.length < 127)
  return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x80 | data.length]), data])
}
function webm(trackType = 2, clusters = 1) {
  const header = element('1a45dfa3', element('4282', Buffer.from('webm')))
  const entry = element('ae', Buffer.concat([
    element('d7', Buffer.from([1])), element('83', Buffer.from([trackType])),
    element('86', Buffer.from(trackType === 2 ? 'A_OPUS' : 'V_VP8')),
  ]))
  const tracks = element('1654ae6b', entry)
  const cluster = Buffer.concat([Buffer.from('1f43b675ff', 'hex'),
    element('e7', Buffer.from([0])), element('a3', Buffer.from([0x81, 0, 0, 0x80, 0xf8, 0xff, 0xfe]))])
  return Buffer.concat([header, Buffer.from('18538067ff', 'hex'), tracks, ...Array(clusters).fill(cluster)])
}
function box(name: string, data: Buffer) {
  const bytes = Buffer.alloc(8)
  bytes.writeUInt32BE(data.length + 8); bytes.write(name, 4)
  return Buffer.concat([bytes, data])
}
function mp4(handler = 'soun') {
  const audioHandler = Buffer.alloc(24); audioHandler.write(handler, 8)
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000')),
    box('moov', box('trak', box('mdia', box('hdlr', audioHandler)))),
    box('mdat', Buffer.from([1, 2, 3, 4])),
  ])
}
function request(overrides: Record<string, unknown> = {}, audio: Buffer = wav(), mimeType = 'audio/wav') {
  const form = new FormData()
  for (const [key, value] of Object.entries({ ...context, ...overrides })) {
    if (value !== undefined) form.append(key, key === 'skills' ? JSON.stringify(value) : String(value))
  }
  form.append('audio', new Blob([new Uint8Array(audio)], { type: mimeType }), 'answer')
  return new Request('http://localhost/api/practice-feedback', { method: 'POST', body: form })
}

test('multipart endpoint returns validated feedback with audio and complete context', async () => {
  let calls = 0
  const handle = createPracticeFeedbackHandler(async (input) => {
    calls += 1
    assert.equal(input.mimeType, 'audio/webm;codecs=opus')
    assert.equal(input.audio.toString('base64'), webm().toString('base64'))
    assert.equal(input.roleTitle, context.roleTitle)
    assert.deepEqual(input.skills, context.skills)
    assert.equal(input.responsibility, context.responsibility)
    return feedback
  })
  const response = await handle(request({}, webm(), 'audio/webm;codecs=opus'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), feedback)
  assert.equal(calls, 1)
})

test('optional role title is accepted', async () => {
  const response = await createPracticeFeedbackHandler(async (input) => {
    assert.equal(input.roleTitle, undefined)
    return feedback
  })(request({ roleTitle: undefined }))
  assert.equal(response.status, 200)
})

test('rejects recordings over 3 MB without calling the reviewer and accepts the exact limit', async () => {
  let calls = 0
  const handle = createPracticeFeedbackHandler(async () => { calls += 1; return feedback })
  const tooLarge = await handle(request({}, wav(MAX_PRACTICE_AUDIO_BYTES + 1)))
  assert.equal(tooLarge.status, 413)
  assert.equal((await tooLarge.json()).category, 'recording_too_large')
  assert.equal(calls, 0)
  const atLimit = await handle(request({}, wav(MAX_PRACTICE_AUDIO_BYTES)))
  assert.equal(atLimit.status, 200)
  assert.equal(calls, 1)
})

test('bounds the entire body with and without content-length', async () => {
  const handle = createPracticeFeedbackHandler(async () => { throw new Error('Must not run') })
  for (const withLength of [true, false]) {
    const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data; boundary=test' }
    if (withLength) headers['Content-Length'] = String(MAX_PRACTICE_REQUEST_BYTES + 1)
    const response = await handle(new Request('http://localhost/api/practice-feedback', {
      method: 'POST', headers, body: Buffer.alloc(MAX_PRACTICE_REQUEST_BYTES + 1),
    }))
    assert.equal(response.status, 413)
  }
})

test('invalid context, invalid form, duplicate fields, and extra video fields are rejected', async () => {
  const handle = createPracticeFeedbackHandler(async () => { throw new Error('Must not run') })
  for (const values of [{ question: '' }, { questionType: 'other' }, { skills: [] }, { responsibility: undefined }]) {
    assert.equal((await handle(request(values))).status, 400)
  }
  const form = new FormData()
  form.append('question', 'one'); form.append('question', 'two')
  assert.equal((await handle(new Request('http://localhost', { method: 'POST', body: form }))).status, 400)
  const extra = await request().formData()
  extra.append('video', new Blob(['video'], { type: 'video/webm' }), 'video.webm')
  assert.equal((await handle(new Request('http://localhost', { method: 'POST', body: extra }))).status, 400)
  const malformed = new Request('http://localhost', { method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: 'invalid multipart' })
  assert.equal((await handle(malformed)).status, 400)
  assert.equal((await handle(new Request('http://localhost', { method: 'POST', body: '{}' }))).status, 400)
})

test('missing, empty, corrupt, and video audio are rejected before calling Gemini', async () => {
  const handle = createPracticeFeedbackHandler(async () => { throw new Error('Must not run') })
  for (const [bytes, mimeType, category] of [
    [Buffer.alloc(0), 'audio/wav', 'missing_audio'],
    [Buffer.from('not audio'), 'audio/webm', 'invalid_audio'],
    [wav(), 'video/mp4', 'invalid_audio'],
    [webm(1), 'audio/webm', 'invalid_audio'],
    [mp4('vide'), 'audio/mp4', 'invalid_audio'],
  ] as const) {
    const response = await handle(request({}, bytes, mimeType))
    assert.equal(response.status, 400)
    assert.equal((await response.json()).category, category)
  }
  const form = new FormData()
  form.append('question', context.question)
  const response = await handle(new Request('http://localhost', { method: 'POST', body: form }))
  assert.equal((await response.json()).category, 'missing_audio')
})

test('audio validation accepts WAV, audio MP4, and long streaming WebM with unknown cluster sizes', () => {
  validatePracticeAudio(wav(), 'audio/wav')
  validatePracticeAudio(mp4(), 'audio/mp4')
  validatePracticeAudio(webm(2, 20), 'audio/webm;codecs=opus')
  assert.throws(() => validatePracticeAudio(webm().subarray(0, 15), 'audio/webm'), PracticeFeedbackError)
})

test('safe feedback errors preserve categories without exposing provider details', async () => {
  const cases = [[429, 'rate_limit'], [400, 'invalid_audio'], [403, 'configuration_error'],
    [500, 'temporary_service_issue'], [504, 'temporary_service_issue']] as const
  for (const [status, category] of cases) {
    const error = safePracticeGeminiError({ status, message: 'SECRET RAW PROVIDER ERROR' })
    assert.equal(error.category, category)
    const response = await createPracticeFeedbackHandler(async () => { throw error })(request())
    const body = await response.text()
    assert.ok(!body.includes('SECRET'))
    assert.ok(!body.includes('stack'))
    assert.equal(JSON.parse(body).category, category)
  }
  const response = await createPracticeFeedbackHandler(async () => { throw new Error('SECRET') })(request())
  assert.equal(response.status, 503)
  assert.ok(!(await response.text()).includes('SECRET'))
})

test('reviewer sends inline audio and context in exactly one Gemini request preserving MIME', async () => {
  let calls = 0
  const review = createPracticeFeedbackReviewer(async (input) => {
    calls += 1
    assert.equal(input.model, 'gemini-3.5-flash-lite')
    assert.equal(input.store, false)
    assert.equal(input.input.length, 2)
    const audio = input.input[1]
    assert.equal(audio.type, 'audio')
    if (audio.type === 'audio') {
      assert.equal(audio.mime_type, 'audio/webm;codecs=opus')
      assert.equal(audio.data, webm().toString('base64'))
    }
    assert.ok(input.system_instruction.includes('NOT deciding whether'))
    assert.ok(input.system_instruction.includes('Do not invent facts'))
    assert.equal(input.response_format[0].mime_type, 'application/json')
    return { status: 'completed', output_text: JSON.stringify(feedback) }
  })
  assert.deepEqual(await review({ ...context, audio: webm(), mimeType: 'audio/webm;codecs=opus' }), feedback)
  assert.equal(calls, 1)
})

test('technical output schema omits STAR and retains the question type', async () => {
  const { star: _star, ...withoutStar } = feedback
  const review = createPracticeFeedbackReviewer(async (input) => {
    const schema = input.response_format[0].schema as { properties: Record<string, unknown> }
    assert.ok(!Object.hasOwn(schema.properties, 'star'))
    return { status: 'completed', output_text: JSON.stringify({ ...withoutStar, questionType: 'technical' }) }
  })
  const result = await review({ ...context, questionType: 'technical', audio: wav(), mimeType: 'audio/wav' })
  assert.equal(result.questionType, 'technical')
  assert.equal(result.star, undefined)
  assert.equal(interviewPracticeFeedbackSchema.safeParse(result).success, true)
})

test('reviewer rejects malformed, incomplete, mismatched, out-of-range, and silent output', async () => {
  for (const output of [
    { status: 'failed', output_text: JSON.stringify(feedback) },
    { status: 'completed', output_text: 'not JSON' },
    { status: 'completed', output_text: JSON.stringify({ ...feedback, questionType: 'experience' }) },
    { status: 'completed', output_text: JSON.stringify({ ...feedback, scores: { ...feedback.scores, clarity: 9 } }) },
  ]) {
    const review = createPracticeFeedbackReviewer(async () => output)
    await assert.rejects(() => review({ ...context, audio: wav(), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof PracticeFeedbackError && error.category === 'temporary_service_issue')
  }
  for (const transcript of ['', '   ', '[inaudible]']) {
    const review = createPracticeFeedbackReviewer(async () => ({
      status: 'completed', output_text: JSON.stringify({ ...feedback, transcript }),
    }))
    await assert.rejects(() => review({ ...context, audio: wav(), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof PracticeFeedbackError && error.category === 'missing_audio')
  }
})

test('Vercel handler rejects invalid requests without reading a key or contacting Gemini', async () => {
  assert.equal((await POST(new Request('http://localhost', { method: 'GET' }))).status, 405)
  assert.equal((await POST(request({}, Buffer.from('bad'), 'audio/webm'))).status, 400)
})

test('Express serves the separate multipart feedback route with safe size errors', async () => {
  let calls = 0
  const app = createApp(undefined, { serveFrontend: false, practiceReviewer: async () => { calls += 1; return feedback } })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const url = 'http://127.0.0.1:' + address.port + '/api/practice-feedback'
    const valid = await fetch(url, { method: 'POST', body: await request().formData() })
    assert.equal(valid.status, 200)
    assert.deepEqual(await valid.json(), feedback)
    const tooLarge = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'multipart/form-data; boundary=test' }, body: Buffer.alloc(MAX_PRACTICE_REQUEST_BYTES + 1) })
    assert.equal(tooLarge.status, 413)
    assert.equal((await tooLarge.json()).category, 'recording_too_large')
    assert.equal(calls, 1)
    const health = await fetch('http://127.0.0.1:' + address.port + '/api/health')
    assert.equal(health.status, 200)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
