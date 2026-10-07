import assert from 'node:assert/strict'
import { test } from 'node:test'
import { once } from 'node:events'
import { createApp } from './app.js'
import { AnalysisError, retryGeminiRequest } from './gemini.js'
import { createInterviewAnalysisCache } from './analysis-cache.js'
import { createAnalyzeHandler, POST } from '../api/analyze.js'
import { interviewPrepSchema, jobDescriptionInputSchema, type InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'

const validJobDescription = `Product Manager role on our software product team. You will lead roadmap planning,
collaborate with design and engineering, prioritize customer needs, define product requirements,
and use analytics to measure outcomes. Required experience includes product management,
customer research, stakeholder communication, and working with cross-functional teams.`

const validResult: InterviewPrepAnalysis = {
  roleTitle: 'Product Manager',
  companyName: 'Example Software',
  summary: 'The role combines customer research, product planning, and cross-functional delivery.',
  responsibilities: [
    { responsibility: 'Lead roadmap planning and prioritization.', skills: ['Product strategy'] },
    { responsibility: 'Collaborate with design and engineering teams.', skills: ['Communication', 'Teamwork'] },
    { responsibility: 'Use analytics to measure product outcomes.', skills: ['Data analysis'] },
  ],
  keySkills: ['Product strategy', 'Communication', 'Teamwork', 'Data analysis', 'Customer research'],
  questions: [
    { type: 'behavioral', question: 'Tell me about a time you set product priorities.', basedOn: 'Lead roadmap planning and prioritization.', skills: ['Product strategy'], whyItMatters: 'The role involves roadmap decisions.' },
    { type: 'behavioral', question: 'Describe a time you worked across teams.', basedOn: 'Collaborate with design and engineering teams.', skills: ['Teamwork'], whyItMatters: 'The role is cross-functional.' },
    { type: 'experience', question: 'How have you used customer research?', basedOn: 'Required experience includes customer research.', skills: ['Customer research'], whyItMatters: 'The team values customer insight.' },
    { type: 'experience', question: 'Walk me through a product outcome you measured.', basedOn: 'Use analytics to measure product outcomes.', skills: ['Data analysis'], whyItMatters: 'The role measures product impact.' },
    { type: 'technical', question: 'Which product metrics would you use to evaluate a launch?', basedOn: 'Use analytics to measure product outcomes.', skills: ['Data analysis'], whyItMatters: 'The role uses analytics to assess outcomes.' },
    { type: 'role-specific', question: 'How would you turn customer needs into product requirements?', basedOn: 'Define product requirements and prioritize customer needs.', skills: ['Product management'], whyItMatters: 'The role translates customer needs into plans.' },
  ],
}

test('Vercel POST handler validates JSON and returns cached interview analysis', async () => {
  let calls = 0
  const handler = createAnalyzeHandler(async () => {
    calls += 1
    return validResult
  })
  const post = (body: string) => handler(new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))

  const malformed = await POST(new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{bad json',
  }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).category, 'invalid_input')

  const invalid = await post(JSON.stringify({ jobDescription: '' }))
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).category, 'invalid_input')

  const response = await post(JSON.stringify({ jobDescription: validJobDescription }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), validResult)
  const duplicate = await post(JSON.stringify({ jobDescription: ` ${validJobDescription.replace(/\s+/g, '  ')} ` }))
  assert.equal(duplicate.status, 200)
  assert.deepEqual(await duplicate.json(), validResult)
  assert.equal(calls, 1)
})

test('Vercel POST handler maps Gemini errors to safe JSON status categories', async () => {
  const makeRequest = () => new Request('https://example.test/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobDescription: validJobDescription }),
  })
  const rateLimitHandler = createAnalyzeHandler(async () => {
    throw new AnalysisError(429, 'rate_limit', 'Rate limited safely.')
  })
  const rateLimit = await rateLimitHandler(makeRequest())
  assert.equal(rateLimit.status, 429)
  assert.equal((await rateLimit.json()).category, 'rate_limit')

  const temporaryHandler = createAnalyzeHandler(async () => {
    throw new AnalysisError(502, 'temporary_service_issue', 'Temporary failure safely.')
  })
  const temporary = await temporaryHandler(makeRequest())
  assert.equal(temporary.status, 503)
  assert.equal((await temporary.json()).category, 'temporary_service_issue')

  const unexpectedHandler = createAnalyzeHandler(async () => { throw new Error('private details') })
  const unexpected = await unexpectedHandler(makeRequest())
  assert.equal(unexpected.status, 500)
  assert.equal((await unexpected.json()).category, 'temporary_service_issue')
})

test('endpoint validates input before calling the model and returns safe errors', async () => {
  let calls = 0
  let failure: unknown
  const server = createApp(async (_jobDescription) => {
    calls += 1
    if (failure) throw failure
    return validResult
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/analyze`
  const post = (body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    for (const body of [
      {},
      { jobDescription: '' },
      { jobDescription: ' '.repeat(150) },
      { jobDescription: 'short text' },
      { jobDescription: 123 },
      { jobDescription: 'unrelated prose without hiring context '.repeat(8) },
      { jobDescription: 'x'.repeat(20001) },
    ]) {
      assert.equal((await post(body)).status, 400)
    }
    const malformed = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' })
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).category, 'invalid_input')
    assert.equal((await post({ jobDescription: 'x'.repeat(140000) })).status, 413)
    assert.equal(calls, 0)

    const response = await post({ jobDescription: validJobDescription })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), validResult)
    const duplicate = await post({ jobDescription: `  ${validJobDescription.replace(/\s+/g, '  ')}  ` })
    assert.equal(duplicate.status, 200)
    assert.deepEqual(await duplicate.json(), validResult)
    assert.equal(calls, 1, 'one valid endpoint submission should invoke the analyzer once')
    failure = new Error('PRIVATE upstream headers and credentials must never escape')
    const failureDescription = `${validJobDescription} We are hiring for this role.`
    const failed = await post({ jobDescription: failureDescription })
    assert.equal(failed.status, 502)
    const failureBody = await failed.json()
    assert.equal(failureBody.category, 'temporary_service_issue')
    assert(!JSON.stringify(failureBody).includes('PRIVATE'))
    assert.equal(calls, 2, 'failed analyses must not be cached')
    for (const [status, category] of [[429, 'rate_limit'], [503, 'configuration_error'], [504, 'temporary_service_issue']] as const) {
      failure = new AnalysisError(status, category, 'Please try again later.')
      const categorizedFailure = await post({ jobDescription: failureDescription })
      assert.equal(categorizedFailure.status, status)
      assert.equal((await categorizedFailure.json()).category, category)
    }
    assert.equal(calls, 5, 'each failed analysis should invoke the analyzer again')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('analysis cache normalizes whitespace, shares in-flight work, and stays bounded', async () => {
  const cache = createInterviewAnalysisCache(2)
  let calls = 0
  let releaseAnalysis!: () => void
  const analysisGate = new Promise<void>((resolve) => { releaseAnalysis = resolve })
  const analyze = async () => { calls += 1; await analysisGate; return validResult }
  const firstPromise = cache(validJobDescription, analyze)
  const duplicatePromise = cache(validJobDescription.replace(/\s+/g, '   '), analyze)
  releaseAnalysis()
  const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise])
  assert.equal(first.cacheHit, false)
  assert.equal(duplicate.cacheHit, true)
  assert.equal(calls, 1)

  const analyzeImmediately = async () => { calls += 1; return validResult }
  await cache(`${validJobDescription} Additional position details.`, analyzeImmediately)
  await cache(`${validJobDescription} Further role responsibilities.`, analyzeImmediately)
  await cache(validJobDescription, analyzeImmediately)
  assert.equal(calls, 4, 'the oldest entry should be evicted at the configured maximum')
})

test('Gemini retries only approved transient statuses, at most twice', async () => {
  let attempts = 0
  const waits: number[] = []
  const retries: Array<[number, number]> = []
  const result = await retryGeminiRequest(async () => {
    attempts += 1
    if (attempts < 3) throw Object.assign(new Error('upstream failure'), { status: attempts === 1 ? 503 : 429 })
    return 'complete'
  }, (retryNumber, status) => retries.push([retryNumber, status]), async (milliseconds) => { waits.push(milliseconds) })
  assert.equal(result, 'complete')
  assert.equal(attempts, 3)
  assert.deepEqual(retries, [[1, 503], [2, 429]])
  assert(waits[0] >= 1000 && waits[0] <= 1250)
  assert(waits[1] >= 2000 && waits[1] <= 2250)

  for (const status of [408, 429, 500, 502, 503, 504]) {
    let transientAttempts = 0
    const recovered = await retryGeminiRequest(async () => {
      transientAttempts += 1
      if (transientAttempts === 1) throw Object.assign(new Error('transient'), { status })
      return status
    }, () => {}, async () => {})
    assert.equal(recovered, status)
    assert.equal(transientAttempts, 2)
  }

  for (const status of [400, 401, 402, 403]) {
    let nonTransientAttempts = 0
    await assert.rejects(retryGeminiRequest(async () => {
      nonTransientAttempts += 1
      throw Object.assign(new Error('do not retry'), { status })
    }, () => {}, async () => {}))
    assert.equal(nonTransientAttempts, 1)
  }
})

test('job-description input rejects tiny and unrelated text', () => {
  assert(jobDescriptionInputSchema.safeParse({ jobDescription: validJobDescription }).success)
  assert(!jobDescriptionInputSchema.safeParse({ jobDescription: 'unrelated prose without hiring context '.repeat(8) }).success)
})

test('interview-prep output enforces requested array bounds and question types', () => {
  assert(interviewPrepSchema.safeParse(validResult).success)
  assert(!interviewPrepSchema.safeParse({ ...validResult, responsibilities: validResult.responsibilities.slice(0, 2) }).success)
  assert(!interviewPrepSchema.safeParse({ ...validResult, keySkills: validResult.keySkills.slice(0, 4) }).success)
  assert(!interviewPrepSchema.safeParse({ ...validResult, questions: validResult.questions.slice(0, 5) }).success)
  const questionWithoutSkills = structuredClone(validResult)
  questionWithoutSkills.questions[0].skills = []
  assert(!interviewPrepSchema.safeParse(questionWithoutSkills).success)
  assert(!interviewPrepSchema.safeParse({ roleTitle: 'Incomplete analysis' }).success)
})
