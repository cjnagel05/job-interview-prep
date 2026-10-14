import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test, type TestContext } from 'node:test'
import { GoogleGenAI } from '@google/genai'
import { z } from 'zod'
import {
  AnalysisError, analyzeJobDescription, retryGeminiRequest,
  GEMINI_REQUEST_TIMEOUT_MS, GEMINI_TOTAL_REQUEST_BUDGET_MS, GEMINI_MAX_ATTEMPTS,
} from './gemini.js'
import { createApp } from './app.js'
import { createAnalyzeHandler } from '../api/analyze.js'
import { interviewPrepSchema, type InterviewPrepAnalysis } from '../src/lib/interview-prep-schema.js'
import { interviewPrepPrompt } from './prompt.js'

const description = 'PRIVATE_JOB_DESCRIPTION: Product manager role. You will lead roadmap planning, collaborate with teams, prioritize customer needs, define requirements, and use analytics. Required experience includes product management and customer research.'
const secret = 'PRIVATE_TEST_API_KEY'
const result: InterviewPrepAnalysis = {
  roleTitle: 'Product Manager', companyName: null, summary: 'Plan and deliver products.',
  responsibilities: [
    { responsibility: 'Plan the roadmap.', skills: ['Planning'] },
    { responsibility: 'Work with teams.', skills: ['Communication'] },
    { responsibility: 'Measure outcomes.', skills: ['Analysis'] },
  ],
  keySkills: ['Planning', 'Communication', 'Analysis', 'Research', 'Prioritization'],
  questions: Array.from({ length: 6 }, (_, index) => ({
    type: 'behavioral', question: 'Describe a relevant project ' + index,
    basedOn: 'Plan the roadmap.', skills: ['Planning'], whyItMatters: 'The role plans products.',
  })),
}

function captureLogs(t: TestContext) {
  const logs: Record<string, unknown>[] = []
  t.mock.method(console, 'info', (line: string) => logs.push(JSON.parse(line)))
  return logs
}
function mockGemini(t: TestContext, generate: (body: Record<string, unknown>, options: { timeout: number; maxRetries: number }) => Promise<unknown>) {
  const previousKey = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = secret
  t.after(() => {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = previousKey
  })
  // Intercept the real SDK method shared by every new client; no network calls.
  const prototype = Object.getPrototypeOf(new GoogleGenAI({ apiKey: secret }).interactions)
  t.mock.method(prototype, 'create', generate)
}

test('analysis uses a 45-second SDK timeout without changing model, prompt, or schema', async (t) => {
  const logs = captureLogs(t)
  let calls = 0
  mockGemini(t, async (body, options) => {
    calls += 1
    assert.equal(options.timeout, GEMINI_REQUEST_TIMEOUT_MS)
    assert.equal(options.timeout, 45_000)
    assert.equal(options.maxRetries, 0)
    assert.equal(body.model, 'gemini-3.5-flash-lite')
    assert.equal(body.system_instruction, interviewPrepPrompt)
    assert.equal(body.input, description)
    assert.equal(body.store, false)
    assert.deepEqual(body.response_format, [{
      type: 'text', mime_type: 'application/json', schema: z.toJSONSchema(interviewPrepSchema),
    }])
    return { status: 'completed', output_text: JSON.stringify(result) }
  })
  assert.deepEqual(await analyzeJobDescription(description), result)
  assert.equal(calls, 1)
  assert.equal(logs[0].event, 'gemini_success')
  assert.equal(logs[0].responseStatus, 200)
  assert.equal(typeof logs[0].responseDurationMs, 'number')
  assert.ok(!JSON.stringify(logs).includes(description))
  assert.ok(!JSON.stringify(logs).includes(secret))
})

test('repeated transient HTTP failures stop after two total attempts and one retry', async (t) => {
  const logs = captureLogs(t)
  assert.equal(GEMINI_MAX_ATTEMPTS, 2)
  let attempts = 0
  let waits = 0
  await assert.rejects(retryGeminiRequest(async () => {
    attempts += 1
    throw Object.assign(new Error('PRIVATE provider error'), { status: 503 })
  }, () => {}, async () => { waits += 1 }), /PRIVATE provider error/)
  assert.equal(attempts, 2)
  assert.equal(waits, 1)
  assert.deepEqual(logs.map((log) => log.event), ['gemini_http_error', 'gemini_retry', 'gemini_http_error'])
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'))
})

test('client timeouts get their own duration logs and a bounded shorter second attempt', async (t) => {
  const logs = captureLogs(t)
  let clock = 0
  const timeouts: number[] = []
  const waits: number[] = []
  await assert.rejects(retryGeminiRequest(async (timeoutMs) => {
    timeouts.push(timeoutMs)
    clock += timeoutMs
    throw Object.assign(new Error('PRIVATE raw timeout with credentials'), { name: 'APIConnectionTimeoutError' })
  }, () => {}, async (milliseconds) => { waits.push(milliseconds); clock += milliseconds }, () => clock))
  assert.equal(timeouts.length, 2)
  assert.equal(timeouts[0], 45_000)
  assert.equal(timeouts[1], GEMINI_TOTAL_REQUEST_BUDGET_MS - 45_000 - waits[0])
  assert.equal(clock, GEMINI_TOTAL_REQUEST_BUDGET_MS)
  assert.deepEqual(logs.map((log) => log.event), ['gemini_timeout', 'gemini_retry', 'gemini_timeout'])
  assert.equal(logs[0].responseDurationMs, 45_000)
  assert.equal(logs[0].requestTimeoutMs, 45_000)
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'))
})

test('no retry starts when its backoff would consume the remaining budget', async (t) => {
  captureLogs(t)
  let clock = 0
  let attempts = 0
  let waits = 0
  await assert.rejects(retryGeminiRequest(async () => {
    attempts += 1
    clock = GEMINI_TOTAL_REQUEST_BUDGET_MS - 500
    throw { status: 503 }
  }, () => assert.fail('Must not announce a retry'), async () => { waits += 1 }, () => clock))
  assert.equal(attempts, 1)
  assert.equal(waits, 0)
})

test('unknown connection failures and permanent HTTP errors are not retried', async (t) => {
  captureLogs(t)
  for (const error of [new Error('connection failed'), ...[400, 401, 402, 403, 404, 422].map((status) => ({ status }))]) {
    let attempts = 0
    await assert.rejects(retryGeminiRequest(async () => { attempts += 1; throw error },
      () => assert.fail('Must not retry'), async () => {}))
    assert.equal(attempts, 1)
  }
})

test('real SDK timeout error shape becomes a safe 504 instead of a generic 502', async (t) => {
  const logs = captureLogs(t)
  let attempts = 0
  mockGemini(t, async () => {
    attempts += 1
    throw Object.assign(new Error('PRIVATE timeout details'), { name: 'APIConnectionTimeoutError' })
  })
  await assert.rejects(analyzeJobDescription(description), (error: unknown) =>
    error instanceof AnalysisError && error.status === 504 && error.category === 'temporary_service_issue')
  assert.equal(attempts, 2)
  assert.equal(logs.filter((log) => log.event === 'gemini_timeout').length, 2)
  assert.equal(logs.filter((log) => log.event === 'gemini_retry').length, 1)
  assert.ok(!JSON.stringify(logs).includes('PRIVATE'))
})

test('local /api/analyze still returns validated results through the real SDK wrapper', async (t) => {
  const logs = captureLogs(t)
  mockGemini(t, async () => ({ status: 'completed', output_text: JSON.stringify(result) }))
  const server = createApp(undefined, { serveFrontend: false }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobDescription: description }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), result)
    assert.ok(logs.some((log) => log.event === 'gemini_success'))
    assert.ok(logs.some((log) => log.event === 'interview_analysis' && log.outcome === 'success'))
    assert.ok(!JSON.stringify(logs).includes(description))
    assert.ok(!JSON.stringify(logs).includes(secret))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})

test('Vercel analysis logging preserves retry count and identifies successful responses without duplicate retry logs', async (t) => {
  const logs = captureLogs(t)
  let attempts = 0
  const handler = createAnalyzeHandler(async (_description, onRetry) => retryGeminiRequest(async () => {
    attempts += 1
    if (attempts === 1) throw { status: 503 }
    return result
  }, onRetry, async () => {}))
  const response = await handler(new Request('http://localhost/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobDescription: description }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), result)
  assert.equal(logs.filter((log) => log.event === 'gemini_retry').length, 1)
  const summary = logs.find((log) => log.event === 'interview_analysis')
  assert.equal(summary?.retryNumber, 1)
  assert.equal(summary?.outcome, 'success')
})
