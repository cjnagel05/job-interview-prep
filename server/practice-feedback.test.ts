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
  transcript: 'The intake process was slow. I needed to reduce missed steps. I reviewed the intake process and created a checklist.',
  overallAssessment: 'minor-refinement',
  overallFeedback: 'You described your own actions clearly. Add a concrete outcome.',
  scores: { relevance: 4, specificity: 3, clarity: 4, jobAlignment: 4 },
  strengths: ['Identifies your own contribution.'],
  improvements: ['Explain what changed after introducing the checklist.'],
  nextAttemptFocus: 'Include one measure of the result.',
  star: {
    situation: { response: 'The intake process was slow.', status: 'strong', feedback: 'Clear context.' },
    task: { response: 'I needed to reduce missed steps.', status: 'strong', feedback: 'Clear goal.' },
    action: { response: 'I reviewed the intake process and created a checklist.', status: 'strong', feedback: 'Clear personal actions.' },
    result: { response: null, status: 'missing', feedback: 'Describe what happened after the change.' },
  },
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

test('technical and role-specific schemas omit STAR and reject unsolicited STAR output', async () => {
  const { star: _star, ...withoutStar } = feedback
  for (const questionType of ['technical', 'role-specific'] as const) {
    let calls = 0
    const review = createPracticeFeedbackReviewer(async (input) => {
      calls += 1
      const schema = input.response_format[0].schema as { properties: Record<string, unknown> }
      assert.ok(!Object.hasOwn(schema.properties, 'star'))
      return { status: 'completed', output_text: JSON.stringify({ ...withoutStar, questionType }) }
    })
    const result = await review({ ...context, questionType, audio: wav(), mimeType: 'audio/wav' })
    assert.equal(result.questionType, questionType)
    assert.equal(result.star, undefined)
    assert.equal(interviewPracticeFeedbackSchema.safeParse(result).success, true)
    assert.equal(calls, 1)
    const invalid = createPracticeFeedbackReviewer(async () => ({
      status: 'completed', output_text: JSON.stringify({ ...feedback, questionType }),
    }))
    await assert.rejects(() => invalid({ ...context, questionType, audio: wav(), mimeType: 'audio/wav' }), PracticeFeedbackError)
  }
})

test('both narrative types receive expanded STAR schema in the single evaluation call', async () => {
  for (const questionType of ['behavioral', 'experience'] as const) {
    let calls = 0
    const review = createPracticeFeedbackReviewer(async (input) => {
      calls += 1
      assert.equal(input.model, 'gemini-3.5-flash-lite')
      assert.equal(input.store, false)
      assert.equal(input.generation_config.max_output_tokens, 6000)
      const schema = input.response_format[0].schema as {
        properties: { star: { properties: Record<string, { required: string[]; properties: Record<string, unknown> }> } }
      }
      for (const key of ['situation', 'task', 'action', 'result']) {
        const component = schema.properties.star.properties[key]
        assert.deepEqual(component.required, ['response', 'status', 'feedback'])
        assert.ok(JSON.stringify(component.properties.response).includes('null'))
        assert.ok(JSON.stringify(component.properties.status).includes('needs-improvement'))
      }
      for (const rule of ['Never add facts', 'Do not infer a result', 'must NOT be required or invented', 'Do NOT force criticism']) {
        assert.ok(input.system_instruction.includes(rule))
      }
      return { status: 'completed', output_text: JSON.stringify({ ...feedback, questionType }) }
    })
    const response = await createPracticeFeedbackHandler(review)(request({ questionType }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ...feedback, questionType })
    assert.equal(calls, 1)
  }
})

test('reviewer and endpoint reject malformed STAR and mismatched original question types', async () => {
  for (const invalid of [
    { ...feedback, star: { ...feedback.star, result: { response: null, status: 'strong', feedback: 'Clear.' } } },
    { ...feedback, star: { ...feedback.star, result: { response: 'Invented result', status: 'missing', feedback: 'Absent.' } } },
    { ...feedback, star: { ...feedback.star, action: { response: 'I made a checklist.', status: 'partial', feedback: 'Add detail.' } } },
    { ...feedback, star: { ...feedback.star, task: { response: 'A goal', status: 'strong', feedback: '' } } },
    { ...feedback, questionType: 'experience' },
  ]) {
    const review = createPracticeFeedbackReviewer(async () => ({ status: 'completed', output_text: JSON.stringify(invalid) }))
    await assert.rejects(() => review({ ...context, audio: wav(), mimeType: 'audio/wav' }), PracticeFeedbackError)
    const response = await createPracticeFeedbackHandler(async () => invalid as InterviewPracticeFeedback)(request())
    assert.equal(response.status, 502)
    assert.equal((await response.json()).category, 'temporary_service_issue')
  }
})

// These mocks protect the rubric sent to Gemini and the validated return path.
// They do not measure the live model's ability to grade a recording.
const strongCalibrationStar = {
  situation: {
    response: 'The reporting dataset contained duplicate customer IDs and missing values in required fields.',
    status: 'strong', feedback: 'The data-quality problem is clear.',
  },
  task: {
    response: 'I was responsible for finding the cause and correcting the import before the reporting run.',
    status: 'strong', feedback: 'Your responsibility and goal are clear.',
  },
  action: {
    response: 'I compared the source records with the transformed dataset and traced the issue back to the source system. I corrected the import mapping and reran the required-field and duplicate checks.',
    status: 'strong', feedback: 'Specific personal actions explain the investigation, fix, and checks.',
  },
  result: {
    response: 'The checks found no duplicate IDs or missing required fields, and the reporting team accepted the corrected dataset.',
    status: 'strong', feedback: 'The checks and acceptance clearly validate the outcome without needing metrics.',
  },
} satisfies NonNullable<InterviewPracticeFeedback['star']>

const weakCalibrationTranscript = 'I noticed there were some problems with the data because some of the records did not look right. There were duplicates and some missing information. I talked with the team about the issue and made some changes to the data process. After that, I checked the data again and it seemed better. We were able to move forward with the reports.'

const calibrationCases: {
  name: string
  star: NonNullable<InterviewPracticeFeedback['star']>
  transcript?: string
  strongOverall?: boolean
  rules: string[]
}[] = [
  {
    name: 'genuinely strong STAR content allows all four components to be strong',
    star: strongCalibrationStar, strongOverall: true,
    rules: ['If clearly present and effective for its purpose, use "strong"', 'A clear non-quantified result can be strong', 'Positive feedback alone is valid for strong components'],
  },
  {
    name: 'weak data-quality example retains vague actions and outcomes without all-strong labels',
    transcript: weakCalibrationTranscript,
    star: {
      situation: { response: 'There were duplicates and some missing information.', status: 'strong', feedback: 'The duplicates and missing information establish the problem.' },
      task: { response: null, status: 'missing', feedback: 'Your personal responsibility was not clearly stated.' },
      action: { response: 'I talked with the team about the issue and made some changes to the data process. After that, I checked the data again.', status: 'needs-improvement', feedback: 'Explain the specific changes you personally made and the checks you performed.' },
      result: { response: 'It seemed better. We were able to move forward with the reports.', status: 'needs-improvement', feedback: 'Explain what the checks showed or how the fix was validated.' },
    },
    rules: ['Do not mark all four components strong', 'Do not invent ownership from noticing the problem or taking action', 'Keep the stated outcome in response, rather than returning null'],
  },
  {
    name: 'strong informal content permits optional polish without downgrading status or overall assessment',
    strongOverall: true,
    star: { ...strongCalibrationStar, action: {
      response: 'I tracked down the duplicate IDs by comparing the source and transformed records. I corrected the import mapping and reran the required-field and duplicate checks.',
      status: 'strong', feedback: 'Your investigation and fix are specific. Optional wording polish: use "traced" instead of "tracked down".',
    } },
    rules: ['Optional wording polish must neither downgrade strong content nor upgrade vague content', 'must be clearly optional and must not create an overall improvement, nextAttemptFocus, or lower overallAssessment by itself'],
  },
  {
    name: 'missing Result stays null and missing without inferring success from the fix',
    star: { ...strongCalibrationStar, result: { response: null, status: 'missing', feedback: 'Describe what happened after your changes; no outcome was stated.' } },
    rules: ['Do not infer a result just because an action probably had a positive outcome', 'No stated outcome means missing, not needs-improvement'],
  },
  {
    name: 'vague Task is present but needs improvement rather than strong or missing',
    star: { ...strongCalibrationStar, task: { response: 'I needed to help with the issue.', status: 'needs-improvement', feedback: 'Clarify your responsibility or goal in resolving the issue.' } },
    rules: ['A general problem statement alone is not a Task', '"I needed to help with the issue" is present but needs improvement'],
  },
  {
    name: 'vague Action is present but needs improvement rather than strong or missing',
    star: { ...strongCalibrationStar, action: { response: 'I talked with the team and made some changes.', status: 'needs-improvement', feedback: 'Name the specific changes you personally made.' } },
    rules: ['"I made some changes" is present but needs improvement', '"I did some things to fix it" is substantively vague and needs improvement, not just wording polish'],
  },
  {
    name: 'vague Result is present but needs improvement rather than strong or missing',
    star: { ...strongCalibrationStar, result: { response: 'It seemed better afterward.', status: 'needs-improvement', feedback: 'Describe what changed or how you validated the outcome.' } },
    rules: ['"It worked", "it seemed better", or "we moved forward" generally needs improvement unless supported by a meaningful outcome'],
  },
]

for (const scenario of calibrationCases) {
  test(`STAR calibration: ${scenario.name}`, async () => {
    const expected: InterviewPracticeFeedback = {
      ...feedback, star: scenario.star,
      transcript: scenario.transcript ?? Object.values(scenario.star).map((component) => component.response).filter(Boolean).join(' '),
      ...(scenario.strongOverall ? {
        overallAssessment: 'strong-as-is', improvements: [], nextAttemptFocus: null,
        overallFeedback: 'Your answer clearly establishes your responsibility, specific actions, and a validated outcome.',
        scores: { relevance: 5, specificity: 5, clarity: 5, jobAlignment: 5 },
      } : {
        overallAssessment: 'needs-improvement',
        overallFeedback: 'Some components need clearer substantive evidence.',
        improvements: ['Clarify the components identified in the STAR feedback.'],
        nextAttemptFocus: 'Address the missing or vague content identified in the STAR feedback.',
      }),
    }
    let calls = 0
    const review = createPracticeFeedbackReviewer(async (input) => {
      calls += 1
      assert.equal(input.model, 'gemini-3.5-flash-lite')
      assert.equal(input.store, false)
      const prompt = input.system_instruction.replace(/\s+/g, ' ')
      const steps = [
        '1. Is the component actually present?',
        '2. If present, does it clearly fulfill the purpose of that STAR element?',
        '3. If clearly present and effective for its purpose, use "strong"',
        '4. Only after determining status, consider OPTIONAL wording polish.',
      ]
      let previous = -1
      for (const step of steps) {
        const position = prompt.indexOf(step)
        assert.ok(position > previous, `Missing or out-of-order rubric step: ${step}`)
        previous = position
      }
      for (const rule of scenario.rules) assert.ok(prompt.includes(rule), `Missing calibration rule: ${rule}`)
      assert.ok(prompt.includes(weakCalibrationTranscript), 'Keep the weak example in the actual prompt')
      assert.ok(prompt.includes('Understandable alone is not enough'))
      assert.ok(!prompt.includes('because the scenario is understandable'))
      assert.ok(!prompt.includes('informal, vague, awkward, or imprecise wording'))
      return { status: 'completed', output_text: JSON.stringify(expected) }
    })
    const response = await createPracticeFeedbackHandler(review)(request({
      question: 'Tell me about a time you resolved a data quality issue. What was your responsibility, what did you do, and what happened?',
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), expected)
    assert.equal(calls, 1)
  })
}

test('Agile experience calibration forbids optional enrichment and preserves strong-as-is through reviewer and endpoint', async () => {
  const agileContext = {
    question: 'Describe your experience working within agile methodologies on software development teams.',
    questionType: 'experience' as const,
    responsibility: 'Develop software collaboratively in an Agile team.',
    skills: ['Agile methodologies', 'Communication', 'Adaptability'],
    roleTitle: 'Software developer',
  }
  const agileFeedback: InterviewPracticeFeedback = {
    questionType: 'experience',
    transcript: 'I worked in two-week sprints on a software development team. I took part in sprint planning, picked up assigned development work, and communicated my progress and blockers in daily standups. When requirements changed, I discussed the changes with the team and adjusted my work to the sprint priorities.',
    overallAssessment: 'strong-as-is',
    overallFeedback: 'Your answer clearly demonstrates hands-on Agile experience, your contribution, and how you communicated and adapted within the team.',
    scores: { relevance: 5, specificity: 5, clarity: 5, jobAlignment: 5 },
    strengths: ['Concrete sprint and ceremony experience.', 'Clear personal contribution, communication, and adaptation.'],
    improvements: [],
    nextAttemptFocus: null,
  }
  let calls = 0
  const review = createPracticeFeedbackReviewer(async (input) => {
    calls += 1
    assert.equal(input.model, 'gemini-3.5-flash-lite')
    assert.ok(input.input[0].type === 'text' && input.input[0].text.includes(agileContext.question))
    const prompt = input.system_instruction
    for (const rule of [
      'ACTUAL interview question FIRST',
      'Do not criticize an answer for omitting information that the question did not',
      'meaningful weakness that could hurt',
      'Would I genuinely advise this candidate to change this answer before an',
      'If it is only optional enrichment, do NOT include it as an improvement.',
      'A strong answer',
      'does NOT need to be perfect or exhaustive',
      'Scores of 5/5 are allowed',
      'Do not artificially lower scores',
      agileContext.question.replace(' on software development teams.', ' on\nsoftware development teams.'),
      'Could incorporate a specific challenge faced during a sprint',
      'If a different question explicitly asks about a sprint challenge or its outcome',
    ]) assert.ok(prompt.includes(rule), `Missing evaluation rule: ${rule}`)
    const schema = input.response_format[0].schema as {
      properties: { improvements: { minItems?: number }; nextAttemptFocus: unknown; overallAssessment: { enum: string[] } }
    }
    assert.equal(schema.properties.improvements.minItems ?? 0, 0)
    assert.ok(JSON.stringify(schema.properties.nextAttemptFocus).includes('null'))
    assert.ok(schema.properties.overallAssessment.enum.includes('strong-as-is'))
    return { status: 'completed', output_text: JSON.stringify(agileFeedback) }
  })
  const response = await createPracticeFeedbackHandler(review)(request(agileContext))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), agileFeedback)
  assert.equal(calls, 1)
})

test('reviewer rejects contradictory strong-as-is feedback instead of displaying optional corrections', async () => {
  for (const changes of [
    { improvements: ['Could describe a sprint challenge.'], nextAttemptFocus: null },
    { improvements: [], nextAttemptFocus: 'Add another example.' },
  ]) {
    const review = createPracticeFeedbackReviewer(async () => ({
      status: 'completed', output_text: JSON.stringify({ ...feedback, overallAssessment: 'strong-as-is', ...changes }),
    }))
    await assert.rejects(() => review({ ...context, audio: wav(), mimeType: 'audio/wav' }),
      (error: unknown) => error instanceof PracticeFeedbackError && error.category === 'temporary_service_issue')
  }
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
