import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the hook's lifecycle with deterministic browser APIs and clocks.
// No devices, API calls, Gemini credentials, or additional dependencies are needed.
const source = await readFile(new URL('../src/hooks/use-interview-practice.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText

function track(kind) {
  return { kind, readyState: 'live', onended: null, stop() { this.readyState = 'ended' } }
}

function harness({ getUserMedia, supported = ['audio/webm;codecs=opus'], unsupported = false } = {}) {
  let now = 0
  let cursor = 0
  let mounted = false
  const slots = []
  const cleanups = []
  const jobs = new Map()
  const requests = []
  const recorders = []
  const urls = new Map()
  const revoked = []
  const listeners = new Map()
  const tracks = [track('audio'), track('video')]
  class Stream {
    constructor(items = []) { this.tracks = items }
    getTracks() { return this.tracks }
    getAudioTracks() { return this.tracks.filter((item) => item.kind === 'audio') }
    getVideoTracks() { return this.tracks.filter((item) => item.kind === 'video') }
  }
  const media = new Stream(tracks)
  class Recorder {
    static isTypeSupported(type) { return supported.includes(type) }
    constructor(stream, options) {
      this.stream = stream
      this.mimeType = options?.mimeType ?? 'audio/default'
      this.state = 'inactive'
      recorders.push(this)
    }
    start() { this.state = 'recording' }
    stop() {
      this.state = 'inactive'
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob(['answer'], { type: this.mimeType }) })
        this.onstop?.()
      })
    }
  }
  function schedule(fn, delay, repeat) {
    const id = {}
    jobs.set(id, { fn, at: now + delay, repeat })
    return id
  }
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      assert.equal(name, 'react')
      return {
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
      }
    },
    navigator: { mediaDevices: { async getUserMedia(constraints) {
      requests.push({ ...constraints })
      return getUserMedia ? getUserMedia(constraints, media, Stream) : media
    } } },
    window: {
      addEventListener(name, fn) { listeners.set(name, fn) },
      removeEventListener(name) { listeners.delete(name) },
    },
    MediaStream: Stream,
    MediaRecorder: unsupported ? undefined : Recorder,
    Blob,
    DOMException,
    URL: {
      createObjectURL(blob) { const url = 'blob:answer-' + urls.size; urls.set(url, blob); return url },
      revokeObjectURL(url) { revoked.push(url) },
    },
    performance: { now: () => now },
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    setTimeout: (fn, delay) => schedule(fn, delay, 0),
    clearInterval: (id) => jobs.delete(id),
    clearTimeout: (id) => jobs.delete(id),
  })
  const render = () => {
    cursor = 0
    const result = exports.useInterviewPractice()
    mounted = true
    return result
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
  const unmount = () => cleanups.forEach((fn) => fn())
  return { render, advance, unmount, requests, recorders, urls, revoked, tracks, jobs, listeners }
}

test('counts down, records only audio, stops at 90 seconds, and creates replay audio', async () => {
  const h = harness()
  await h.render().startPractice()
  assert.equal(h.render().phase, 'countdown')
  assert.equal(h.render().countdown, 3)
  assert.deepEqual(h.requests, [{ video: true, audio: true }])
  assert.deepEqual(h.recorders[0].stream.getTracks().map((item) => item.kind), ['audio'])
  assert.equal(h.recorders[0].mimeType, 'audio/webm;codecs=opus')
  h.advance(1000)
  assert.equal(h.render().countdown, 2)
  h.advance(1000)
  assert.equal(h.render().countdown, 1)
  h.advance(1000)
  assert.equal(h.render().phase, 'recording')
  h.advance(89000)
  assert.equal(h.render().seconds, 89)
  assert.equal(h.recorders[0].state, 'recording')
  h.advance(1000)
  assert.equal(h.render().phase, 'saving')
  await Promise.resolve()
  assert.equal(h.render().phase, 'recorded')
  assert.equal(h.render().seconds, 90)
  assert.equal(h.urls.get(h.render().audioUrl).type, 'audio/webm;codecs=opus')
  h.unmount()
  assert.ok(h.tracks.every((item) => item.readyState === 'ended'))
  assert.equal(h.jobs.size, 0)
  assert.equal(h.revoked.length, 1)
})

test('manual stop allows replay and retake revokes the previous audio', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(3000 + 4200)
  h.render().stopRecording()
  await Promise.resolve()
  assert.equal(h.render().seconds, 4)
  const url = h.render().audioUrl
  assert.ok(url)
  h.render().retake()
  assert.equal(h.render().phase, 'idle')
  assert.equal(h.render().audioUrl, null)
  assert.ok(h.revoked.includes(url))
  await h.render().startPractice()
  assert.equal(h.requests.length, 1)
  h.unmount()
})

test('camera failure falls back to microphone-only recording and a supported MIME format', async () => {
  const h = harness({
    supported: ['audio/mp4'],
    getUserMedia(constraints, media, Stream) {
      if (constraints.video) throw new DOMException('No camera', 'NotFoundError')
      return new Stream(media.getAudioTracks())
    },
  })
  await h.render().startPractice()
  assert.equal(h.render().phase, 'countdown')
  assert.match(h.render().cameraNotice, /audio only/)
  assert.deepEqual(h.requests, [{ video: true, audio: true }, { video: false, audio: true }])
  assert.equal(h.recorders[0].mimeType, 'audio/mp4')
  h.unmount()
})

for (const [name, message] of [
  ['NotAllowedError', /permission was denied/],
  ['NotFoundError', /No microphone was found/],
  ['NotReadableError', /could not be started/],
]) {
  test('handles microphone ' + name, async () => {
    const h = harness({ getUserMedia() { throw new DOMException('Unavailable', name) } })
    await h.render().startPractice()
    assert.equal(h.render().phase, 'idle')
    assert.match(h.render().error, message)
    assert.equal(h.recorders.length, 0)
    h.unmount()
  })
}

test('unsupported browser does not request device permission', async () => {
  const h = harness({ unsupported: true })
  await h.render().startPractice()
  assert.match(h.render().error, /not supported/)
  assert.equal(h.requests.length, 0)
  h.unmount()
})

test('uses the browser default when no listed audio format is supported', async () => {
  const h = harness({ supported: [] })
  await h.render().startPractice()
  assert.equal(h.recorders[0].mimeType, 'audio/default')
  assert.deepEqual(h.recorders[0].stream.getTracks().map((item) => item.kind), ['audio'])
  h.unmount()
})

test('closing during pending permission stops late streams without recording', async () => {
  let resolve
  const h = harness({ getUserMedia: () => new Promise((done) => { resolve = done }) })
  const pending = h.render().startPractice()
  h.unmount()
  resolve({ getTracks: () => h.tracks })
  await pending
  assert.ok(h.tracks.every((item) => item.readyState === 'ended'))
  assert.equal(h.recorders.length, 0)
  assert.equal(h.jobs.size, 0)
})

test('closing during countdown or recording stops every track and discards queued audio', async () => {
  for (const elapsed of [1000, 5000]) {
    const h = harness()
    await h.render().startPractice()
    h.advance(elapsed)
    h.unmount()
    await Promise.resolve()
    assert.ok(h.tracks.every((item) => item.readyState === 'ended'))
    assert.equal(h.jobs.size, 0)
    assert.equal(h.urls.size, 0)
  }
})

test('canceling countdown prevents recording and allows a fresh take', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(1000)
  h.render().retake()
  h.advance(5000)
  assert.equal(h.recorders[0].state, 'inactive')
  assert.equal(h.render().phase, 'idle')
  await h.render().startPractice()
  h.advance(3000)
  assert.equal(h.recorders[1].state, 'recording')
  h.unmount()
})

test('microphone disconnect stops recording and shows a helpful message', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(5000)
  h.tracks[0].readyState = 'ended'
  h.tracks[0].onended()
  await Promise.resolve()
  assert.equal(h.recorders[0].state, 'inactive')
  assert.match(h.render().error, /microphone disconnected/)
  h.unmount()
})

test('leaving the page releases devices and resets replay state for browser back navigation', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(5000)
  h.render().stopRecording()
  await Promise.resolve()
  const url = h.render().audioUrl
  h.listeners.get('pagehide')()
  assert.ok(h.tracks.every((item) => item.readyState === 'ended'))
  assert.ok(h.revoked.includes(url))
  assert.equal(h.render().audioUrl, null)
  assert.equal(h.render().stream, null)
  assert.equal(h.render().phase, 'idle')
  assert.equal(h.jobs.size, 0)
  h.unmount()
})

test('recording runtime errors discard incomplete audio and permit retry', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(3000)
  h.recorders[0].onerror()
  await Promise.resolve()
  assert.equal(h.render().phase, 'idle')
  assert.match(h.render().error, /could not capture/)
  assert.equal(h.urls.size, 0)
  await h.render().startPractice()
  assert.equal(h.render().phase, 'countdown')
  h.unmount()
})

test('opening feedback releases devices and clears replay on practice again', async () => {
  const h = harness()
  await h.render().startPractice()
  h.advance(5000)
  h.render().stopRecording()
  await Promise.resolve()
  const url = h.render().audioUrl
  h.render().stopPreview()
  assert.ok(h.tracks.every((item) => item.readyState === 'ended'))
  assert.equal(h.render().stream, null)
  assert.equal(h.render().audioUrl, url)
  h.render().retake()
  assert.equal(h.render().audioUrl, null)
  assert.ok(h.revoked.includes(url))
  h.unmount()
})
