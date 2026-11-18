import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
async function load(relativePath, overrides = {}) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name),
  })
  return exports
}

const model = await load('../src/lib/interview-feedback-schema.ts')
const fixtures = await load('../src/lib/sample-interview-feedback.ts', {
  './interview-feedback-schema': model,
})
const view = await load('../src/components/interview-feedback-view.tsx', {
  '@/components/ui/button': {
    Button: ({ children, ...props }) => React.createElement('button', props, children),
  },
  '@/components/ui/textarea': {
    Textarea: (props) => React.createElement('textarea', props),
  },
})

const valid = () => fixtures.getSampleInterviewFeedback('behavioral')

test('all four sample feedback results satisfy the model and match their question type', () => {
  for (const questionType of ['behavioral', 'experience', 'technical', 'role-specific']) {
    const feedback = fixtures.getSampleInterviewFeedback(questionType)
    assert.equal(feedback.questionType, questionType)
    assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
  }
})

test('scores accept only integers from 1 to 5 for every dimension', () => {
  for (const dimension of ['relevance', 'specificity', 'clarity', 'jobAlignment']) {
    for (const value of [1, 5]) {
      const feedback = valid()
      feedback.scores[dimension] = value
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
    }
    for (const value of [0, 6, 2.5, '3', NaN, undefined]) {
      const feedback = valid()
      feedback.scores[dimension] = value
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, false)
    }
  }
})

test('strengths and improvements for answers needing changes require 1–4 nonempty strings', () => {
  for (const field of ['strengths', 'improvements']) {
    for (const count of [1, 4]) {
      const feedback = valid()
      feedback[field] = Array(count).fill('A useful observation')
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
    }
    for (const invalid of [[], Array(5).fill('Observation'), [' '], [42]]) {
      const feedback = valid()
      feedback[field] = invalid
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, false)
    }
  }
})

test('transcript, overall feedback, next focus, and question type are required', () => {
  for (const key of ['transcript', 'overallFeedback', 'overallAssessment', 'nextAttemptFocus', 'questionType']) {
    const feedback = valid()
    delete feedback[key]
    assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, false)
  }
  assert.equal(model.interviewFeedbackSchema.safeParse({ ...valid(), questionType: 'other' }).success, false)
})

test('assessment enforces empty improvements and null next focus only for strong-as-is answers', () => {
  const strong = { ...valid(), overallAssessment: 'strong-as-is', improvements: [], nextAttemptFocus: null }
  assert.equal(model.interviewFeedbackSchema.safeParse(strong).success, true)
  for (const invalid of [
    { ...strong, improvements: ['Could add another example.'] },
    { ...strong, nextAttemptFocus: 'Could describe a challenge.' },
    { ...strong, overallAssessment: 'minor-refinement' },
    { ...strong, overallAssessment: 'needs-improvement' },
    { ...strong, overallAssessment: 'perfect' },
    { ...valid(), nextAttemptFocus: null },
  ]) assert.equal(model.interviewFeedbackSchema.safeParse(invalid).success, false)
  assert.equal(model.interviewFeedbackSchema.safeParse({ ...valid(), overallAssessment: 'minor-refinement' }).success, true)
})

test('STAR can be omitted for every question type but is restricted to narrative types', () => {
  for (const questionType of ['behavioral', 'experience', 'technical', 'role-specific']) {
    const feedback = { ...valid(), questionType }
    const withStar = model.interviewFeedbackSchema.safeParse(feedback).success
    assert.equal(withStar, ['behavioral', 'experience'].includes(questionType))
    delete feedback.star
    assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
  }
})

test('STAR requires all four dimensions with a valid status', () => {
  for (const dimension of ['situation', 'task', 'action', 'result']) {
    for (const status of ['strong', 'needs-improvement', 'missing']) {
      const feedback = valid()
      feedback.star[dimension] = {
        response: status === 'missing' ? null : 'Something the candidate said.',
        status, feedback: status === 'strong' ? 'Clear and appropriately concise.' : 'Explain this part clearly.',
      }
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
    }
    const missing = valid()
    delete missing.star[dimension]
    assert.equal(model.interviewFeedbackSchema.safeParse(missing).success, false)
    const invalid = valid()
    invalid.star[dimension].status = 'excellent'
    assert.equal(model.interviewFeedbackSchema.safeParse(invalid).success, false)
  }
})

test('STAR enforces missing/null consistency and useful component text', () => {
  for (const dimension of ['situation', 'task', 'action', 'result']) {
    for (const component of [
      { response: null, status: 'strong', feedback: 'Clear.' },
      { response: null, status: 'needs-improvement', feedback: 'Add detail.' },
      { response: 'An outcome', status: 'missing', feedback: 'Missing.' },
      { response: ' ', status: 'strong', feedback: 'Clear.' },
      { response: 'An action', status: 'strong', feedback: ' ' },
      { status: 'missing', feedback: 'Absent.' },
      'strong',
    ]) {
      const feedback = valid()
      feedback.star[dimension] = component
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, false)
    }
  }
})

test('strong STAR components accept positive feedback without requiring criticism', () => {
  const feedback = { ...valid(), overallAssessment: 'strong-as-is', improvements: [], nextAttemptFocus: null }
  for (const key of Object.keys(feedback.star)) {
    feedback.star[key] = { response: 'Spoken content.', status: 'strong', feedback: 'Clear and appropriately concise.' }
  }
  assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
})

test('feedback screen displays every requested section and identifies practice feedback', () => {
  const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, {
    feedback: valid(),
    onPracticeAgain() {},
  }))
  for (const label of ['Practice feedback', 'Transcript', 'Overall feedback', 'Scores',
    'Relevance', 'Specificity', 'Clarity', 'Job alignment', 'Strengths', 'Areas to improve',
    'STAR breakdown', 'What you said', 'Feedback', 'Your revised version',
    'Your Revised STAR Response', 'One goal for your next attempt', 'Practice Again']) {
    assert.ok(html.includes(label), 'Missing feedback section: ' + label)
  }
})

test('feedback screen omits STAR when the assessment is absent', () => {
  for (const questionType of ['behavioral', 'experience', 'technical', 'role-specific']) {
    const feedback = fixtures.getSampleInterviewFeedback(questionType)
    delete feedback.star
    const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, {
      feedback,
      onPracticeAgain() {},
    }))
    assert.equal(html.includes('STAR breakdown'), false)
  }
})

test('technical and role-specific views hide STAR even if unvalidated input contains it', () => {
  for (const questionType of ['technical', 'role-specific']) {
    const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, {
      feedback: { ...valid(), questionType }, onPracticeAgain() {},
    }))
    assert.equal(html.includes('STAR breakdown'), false)
  }
})

test('worksheet renders missing text, labels, empty missing drafts, and extracted initial values', () => {
  const feedback = valid()
  feedback.star.result = { response: null, status: 'missing', feedback: 'Describe what happened afterward.' }
  const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, { feedback, onPracticeAgain() {} }))
  assert.ok(html.includes('Not clearly included in your response.'))
  assert.ok(html.includes('Describe what happened afterward.'))
  assert.ok(html.includes('Missing'))
  assert.ok(html.includes('id="star-revised-result"'))
  assert.match(html, /<textarea[^>]*id="star-revised-result"[^>]*><\/textarea>/)
  for (const key of ['situation', 'task', 'action']) {
    assert.ok(html.includes(`id="star-revised-${key}"`))
    assert.ok(html.includes(feedback.star[key].response))
  }
})

// Follow the existing deterministic hook-test approach: exercise the actual
// component's state and event handlers without browser devices or a network.
test('worksheet edits stay local, update the ordered preview, and reset with feedback/session', async () => {
  let state
  let dirty = false
  const hooks = {
    useRef: () => ({ current: null }), useEffect() {},
    useState(initial) {
      if (state === undefined) state = initial()
      return [state, (update) => {
        state = typeof update === 'function' ? update(state) : update
        dirty = true
      }]
    },
  }
  const component = await load('../src/components/interview-feedback-view.tsx', {
    react: hooks,
    '@/components/ui/button': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
    '@/components/ui/textarea': { Textarea: (props) => React.createElement('textarea', props) },
  })
  function nodes(tree) {
    if (!React.isValidElement(tree)) return []
    return [tree, ...React.Children.toArray(tree.props.children).flatMap(nodes)]
  }
  let resets = 0
  function screen(feedback) {
    return component.InterviewFeedbackView({ feedback, onPracticeAgain() { resets += 1 } })
  }
  function worksheet(tree) {
    const element = nodes(tree).find((node) => node.props.star)
    let rendered
    do {
      dirty = false
      rendered = element.type(element.props)
    } while (dirty)
    return rendered
  }
  const feedback = valid()
  feedback.star.result = { response: null, status: 'missing', feedback: 'Describe the outcome.' }
  const original = JSON.stringify(feedback)
  let tree = screen(feedback)
  let sheet = worksheet(tree)
  for (const key of ['situation', 'task', 'action', 'result']) {
    const field = nodes(sheet).find((node) => node.props.id === `star-revised-${key}`)
    assert.equal(field.props.value, feedback.star[key].response ?? '')
    field.props.onChange({ target: { value: `Revised ${key}.` } })
    sheet = worksheet(tree)
  }
  const preview = nodes(sheet).find((node) => node.type === 'p' && node.props.children === 'Revised situation.\n\nRevised task.\n\nRevised action.\n\nRevised result.')
  assert.ok(preview)
  nodes(sheet).find((node) => node.props.id === 'star-revised-task').props.onChange({ target: { value: '  ' } })
  sheet = worksheet(tree)
  assert.ok(nodes(sheet).some((node) => node.props.children === 'Revised situation.\n\nRevised action.\n\nRevised result.'))
  assert.equal(JSON.stringify(feedback), original, 'Edits must not mutate extracted feedback')

  // New feedback in the same mounted view replaces the prior drafts.
  const replacement = fixtures.getSampleInterviewFeedback('experience')
  tree = screen(replacement)
  sheet = worksheet(tree)
  assert.equal(nodes(sheet).find((node) => node.props.id === 'star-revised-action').props.value, replacement.star.action.response)

  // Practice Again calls the existing reset; the parent unmounts this view.
  nodes(tree).find((node) => node.props.onClick).props.onClick()
  assert.equal(resets, 1)
  state = undefined // simulate the next feedback view mounting after reset
  sheet = worksheet(screen(feedback))
  assert.equal(nodes(sheet).find((node) => node.props.id === 'star-revised-result').props.value, '')
  assert.equal(nodes(sheet).find((node) => node.props.id === 'star-revised-action').props.value, feedback.star.action.response)
})

test('feedback presentation hides empty improvements without inventing corrections', () => {
  for (const improvements of [[], [' ', '\n']]) {
    const feedback = { ...valid(), improvements, overallFeedback: 'This answer is strong as-is.' }
    const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, {
      feedback,
      onPracticeAgain() {},
    }))
    assert.ok(html.includes('This answer is strong as-is.'))
    assert.ok(html.includes('Strengths'))
    assert.ok(html.includes('Practice Again'))
    assert.equal(html.includes('Areas to improve'), false)
    assert.equal(html.includes('One goal for your next attempt'), false)
  }
})

test('strong-as-is feedback renders positive assessment without an empty next-attempt goal', () => {
  const feedback = model.interviewFeedbackSchema.parse({
    ...valid(), overallAssessment: 'strong-as-is', improvements: [], nextAttemptFocus: null,
    overallFeedback: 'Your Agile experience is clear and concrete. This answer is strong as-is.',
    scores: { relevance: 5, specificity: 5, clarity: 5, jobAlignment: 5 },
  })
  const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, { feedback, onPracticeAgain() {} }))
  assert.ok(html.includes(feedback.overallFeedback))
  assert.ok(html.includes('Practice Again'))
  assert.equal(html.includes('Areas to improve'), false)
  assert.equal(html.includes('Keep in mind'), false)
  assert.equal(html.includes('One goal for your next attempt'), false)
})
