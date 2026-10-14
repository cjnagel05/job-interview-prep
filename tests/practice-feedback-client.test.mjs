import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
async function load(relativePath, overrides = {}, globals = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText, {
    exports,
    require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
    Blob, FormData, AbortController, ...globals,
  })
  return exports
}

const model = await load('../src/lib/interview-feedback-schema.ts')
const contract = await load('../src/lib/practice-feedback-contract.ts', { './interview-feedback-schema.js': model })
const fixtures = await load('../src/lib/sample-interview-feedback.ts', { './interview-feedback-schema': model })
const context = { question: 'Describe an improvement you made.', questionType: 'behavioral',
  responsibility: 'Improve processes.', skills: ['Communication'], roleTitle: 'Coordinator' }

async function client(fetch) {
  return load('../src/lib/practice-feedback-client.ts', {
    './interview-feedback-schema': model,
    './practice-feedback-contract': contract,
  }, { fetch })
}

test('uploads exactly one audio file with complete context and preserves browser MIME', async () => {
  let calls = 0
  const api = await client(async (url, options) => {
    calls += 1
    assert.equal(url, '/api/practice-feedback')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers, undefined)
    const entries = [...options.body.entries()]
    assert.equal(entries.filter(([, value]) => typeof value !== 'string').length, 1)
    const audio = options.body.get('audio')
    assert.equal(audio.type, 'audio/webm;codecs=opus')
    assert.equal(await audio.text(), 'recorded answer')
    assert.equal(options.body.get('question'), context.question)
    assert.equal(options.body.get('questionType'), context.questionType)
    assert.equal(options.body.get('responsibility'), context.responsibility)
    assert.equal(options.body.get('skills'), JSON.stringify(context.skills))
    assert.equal(options.body.get('roleTitle'), context.roleTitle)
    assert.equal(options.body.get('video'), null)
    return Response.json(fixtures.getSampleInterviewFeedback('behavioral'))
  })
  const result = await api.requestPracticeFeedback(
    new Blob(['recorded answer'], { type: 'audio/webm;codecs=opus' }), context, new AbortController().signal)
  assert.equal(result.questionType, 'behavioral')
  assert.equal(calls, 1)
})

test('blocks missing, oversized, non-audio, and invalid-context uploads locally', async () => {
  let calls = 0
  const api = await client(async () => { calls += 1; throw new Error('Should not upload') })
  for (const [audio, input, message] of [
    [null, context, /No microphone/],
    [new Blob([new Uint8Array(contract.MAX_PRACTICE_AUDIO_BYTES + 1)], { type: 'audio/wav' }), context, /3 MB/],
    [new Blob(['video'], { type: 'video/webm' }), context, /could not read/],
    [new Blob(['audio'], { type: 'audio/webm' }), { ...context, skills: [] }, /invalid/],
  ]) {
    await assert.rejects(() => api.requestPracticeFeedback(audio, input, new AbortController().signal), message)
  }
  assert.equal(calls, 0)
})

test('maps error categories and platform errors to safe messages instead of displaying server text', async () => {
  for (const [status, body, message] of [
    [400, { category: 'invalid_audio', error: 'RAW SECRET ERROR' }, /could not read/],
    [400, { category: 'missing_audio' }, /No microphone/],
    [429, { category: 'rate_limit' }, /busy/],
    [503, { category: 'temporary_service_issue' }, /temporarily unavailable/],
    [413, null, /3 MB/],
    [500, { error: 'RAW SECRET ERROR' }, /temporarily unavailable/],
  ]) {
    const api = await client(async () => Response.json(body, { status }))
    await assert.rejects(() => api.requestPracticeFeedback(
      new Blob(['answer'], { type: 'audio/webm' }), context, new AbortController().signal), (error) => {
      assert.match(error.message, message)
      assert.ok(!error.message.includes('SECRET'))
      return true
    })
  }
})

test('rejects malformed or mismatched feedback responses', async () => {
  for (const body of [{}, { ...fixtures.getSampleInterviewFeedback('behavioral'), questionType: 'experience' }]) {
    const api = await client(async () => Response.json(body))
    await assert.rejects(() => api.requestPracticeFeedback(
      new Blob(['answer'], { type: 'audio/webm' }), context, new AbortController().signal), /temporarily unavailable/)
  }
})

async function hookHarness(request) {
  const slots = []
  const cleanups = []
  const listeners = new Map()
  const jobs = new Map()
  let cursor = 0
  let mounted = false
  let now = 0
  const schedule = (fn, delay, repeat) => {
    const id = {}
    jobs.set(id, { fn, at: now + delay, repeat })
    return id
  }
  const hook = await load('../src/hooks/use-practice-feedback.ts', {
    react: {
      useState(initial) {
        const index = cursor++
        if (!mounted) slots[index] = initial
        return [slots[index], (value) => { slots[index] = value }]
      },
      useRef(initial) {
        const index = cursor++
        if (!mounted) slots[index] = { current: initial }
        return slots[index]
      },
      useEffect(fn) { if (!mounted) cleanups.push(fn()) },
    },
    '@/lib/practice-feedback-client': { requestPracticeFeedback: request, PracticeFeedbackClientError: class extends Error {} },
    '@/lib/practice-feedback-contract': contract,
  }, {
    window: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) },
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    setTimeout: (fn, delay) => schedule(fn, delay, 0),
    clearInterval: (id) => jobs.delete(id),
    clearTimeout: (id) => jobs.delete(id),
  })
  function render() {
    cursor = 0
    const value = hook.usePracticeFeedback()
    mounted = true
    return value
  }
  render()
  function advance(ms) {
    const end = now + ms
    for (;;) {
      const next = [...jobs.entries()].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      const [id, job] = next
      now = job.at
      if (job.repeat) job.at += job.repeat
      else jobs.delete(id)
      job.fn()
    }
    now = end
  }
  return { render, advance, jobs, listeners, unmount: () => cleanups.forEach((fn) => fn()) }
}

test('shows loading progress, suppresses duplicate submits, and displays feedback', async () => {
  let resolve
  let calls = 0
  const h = await hookHarness(() => { calls += 1; return new Promise((done) => { resolve = done }) })
  const pending = h.render().getFeedback(null, context)
  assert.equal(h.render().isLoading, true)
  assert.equal(h.render().progressText, 'Reviewing your response...')
  await h.render().getFeedback(null, context)
  assert.equal(calls, 1)
  h.advance(10000)
  assert.match(h.render().progressText, /Checking/)
  h.advance(10000)
  assert.equal(h.render().progressText, 'Preparing feedback...')
  resolve(fixtures.getSampleInterviewFeedback('behavioral'))
  await pending
  assert.equal(h.render().isLoading, false)
  assert.ok(h.render().feedback)
  assert.equal(h.jobs.size, 0)
  h.render().reset()
  assert.equal(h.render().feedback, null)
  h.unmount()
})

test('closing aborts the request and ignores late feedback', async () => {
  let resolve
  let signal
  const h = await hookHarness((_audio, _context, value) => {
    signal = value
    return new Promise((done) => { resolve = done })
  })
  const pending = h.render().getFeedback(null, context)
  h.unmount()
  assert.equal(signal.aborted, true)
  assert.equal(h.jobs.size, 0)
  resolve(fixtures.getSampleInterviewFeedback('behavioral'))
  await pending
  assert.equal(h.render().feedback, null)
})

test('timeout provides a safe retryable error and clears loading', async () => {
  const h = await hookHarness((_audio, _context, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('RAW ABORT')))
  }))
  const pending = h.render().getFeedback(null, context)
  h.advance(75000)
  await pending
  assert.equal(h.render().isLoading, false)
  assert.match(h.render().error, /temporarily unavailable/)
  assert.equal(h.jobs.size, 0)
  h.unmount()
})

test('page navigation cancels pending feedback and resets the view', async () => {
  let resolve
  const h = await hookHarness(() => new Promise((done) => { resolve = done }))
  const pending = h.render().getFeedback(null, context)
  h.listeners.get('pagehide')()
  assert.equal(h.render().isLoading, false)
  assert.equal(h.jobs.size, 0)
  resolve(fixtures.getSampleInterviewFeedback('behavioral'))
  await pending
  assert.equal(h.render().feedback, null)
  h.unmount()
})
