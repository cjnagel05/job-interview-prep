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
    for (const status of ['strong', 'partial', 'missing']) {
      const feedback = valid()
      feedback.star[dimension] = status
      assert.equal(model.interviewFeedbackSchema.safeParse(feedback).success, true)
    }
    const missing = valid()
    delete missing.star[dimension]
    assert.equal(model.interviewFeedbackSchema.safeParse(missing).success, false)
    const invalid = valid()
    invalid.star[dimension] = 'excellent'
    assert.equal(model.interviewFeedbackSchema.safeParse(invalid).success, false)
  }
})

test('feedback screen displays every requested section and identifies practice feedback', () => {
  const html = renderToStaticMarkup(React.createElement(view.InterviewFeedbackView, {
    feedback: valid(),
    onPracticeAgain() {},
  }))
  for (const label of ['Practice feedback', 'Transcript', 'Overall feedback', 'Scores',
    'Relevance', 'Specificity', 'Clarity', 'Job alignment', 'Strengths', 'Areas to improve',
    'STAR assessment', 'One goal for your next attempt', 'Practice Again']) {
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
    assert.equal(html.includes('STAR assessment'), false)
  }
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
