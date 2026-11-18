import { interviewFeedbackSchema, type FeedbackQuestionType, type InterviewFeedback } from './interview-feedback-schema'

const samples = {
  behavioral: {
    questionType: 'behavioral',
    transcript: 'During a busy project, our team disagreed about priorities. I was responsible for helping us agree on a plan. I asked each person to explain their concerns, compared the options against our deadline, and proposed a smaller first release. We agreed on the plan and delivered it on time.',
    overallAssessment: 'needs-improvement',
    overallFeedback: 'This example has a clear sequence and shows how you handled disagreement. Explain your own decision in more detail and add evidence of the outcome to make the story more convincing.',
    scores: { relevance: 4, specificity: 3, clarity: 4, jobAlignment: 3 },
    strengths: [
      'Establishes a concrete situation and your responsibility.',
      'Explains how you brought different perspectives together.',
    ],
    improvements: [
      'Name the trade-off you made and why you chose it.',
      'Describe a measurable result beyond meeting the deadline.',
    ],
    nextAttemptFocus: 'End your next answer with one concrete outcome and explain how your action contributed to it.',
    star: {
      situation: { response: 'During a busy project, our team disagreed about priorities.', status: 'strong', feedback: 'Clear and concise context for the disagreement.' },
      task: { response: 'I was responsible for helping us agree on a plan.', status: 'strong', feedback: 'Your responsibility is clear.' },
      action: { response: 'I asked each person to explain their concerns, compared the options against our deadline, and proposed a smaller first release.', status: 'needs-improvement', feedback: 'Explain which trade-off led you to propose the smaller release.' },
      result: { response: 'We agreed on the plan and delivered it on time.', status: 'strong', feedback: 'You state a concrete outcome: agreement and on-time delivery.' },
    },
  },
  experience: {
    questionType: 'experience',
    transcript: 'In my last role, I led a project to improve a slow internal process. My goal was to reduce the time our team spent on repeated requests. I reviewed the workflow, spoke with the people using it, and created a simpler intake checklist. The team adopted the checklist, and requests became easier to handle.',
    overallAssessment: 'needs-improvement',
    overallFeedback: 'You connect your experience to a practical problem and describe the steps you took. Add the scale of the project and quantify what changed after the team adopted your solution.',
    scores: { relevance: 4, specificity: 3, clarity: 4, jobAlignment: 4 },
    strengths: [
      'Gives an example of taking ownership of a process improvement.',
      'Includes input from the people affected by the change.',
    ],
    improvements: [
      'Explain how many people or requests the process involved.',
      'Include the before-and-after turnaround time if you know it.',
    ],
    nextAttemptFocus: 'Include one before-and-after measure to show the impact of your experience.',
    star: {
      situation: { response: 'In my last role, I led a project to improve a slow internal process.', status: 'strong', feedback: 'The process problem is clear.' },
      task: { response: 'My goal was to reduce the time our team spent on repeated requests.', status: 'strong', feedback: 'You identify your goal clearly.' },
      action: { response: 'I reviewed the workflow, spoke with the people using it, and created a simpler intake checklist.', status: 'strong', feedback: 'Specific steps show your personal contribution.' },
      result: { response: 'The team adopted the checklist, and requests became easier to handle.', status: 'needs-improvement', feedback: 'Explain what easier to handle meant in practice, using an observed example or a measure if available.' },
    },
  },
  technical: {
    questionType: 'technical',
    transcript: 'I would first clarify the requirements and constraints. Then I would compare two possible approaches, looking at reliability, complexity, and performance. I would start with the simplest approach that meets the requirements, test the edge cases, and use the results to decide whether we need a more complex solution.',
    overallAssessment: 'needs-improvement',
    overallFeedback: 'Your explanation has a sensible structure and considers trade-offs. A concrete example, explicit assumptions, and a description of how you would verify the solution would make it more useful.',
    scores: { relevance: 4, specificity: 2, clarity: 4, jobAlignment: 3 },
    strengths: [
      'Starts by clarifying requirements before selecting a solution.',
      'Considers complexity and testing alongside performance.',
    ],
    improvements: [
      'Describe two actual approaches and their trade-offs.',
      'Name a specific edge case and how you would test it.',
    ],
    nextAttemptFocus: 'Walk through one concrete example and explain one trade-off behind your proposed solution.',
  },
  'role-specific': {
    questionType: 'role-specific',
    transcript: 'I would confirm the goal and agree with stakeholders on what success looks like. I would prioritize the work by impact and urgency, identify dependencies, and create a plan with clear owners. I would check progress regularly and adjust the plan when new information changes the priorities.',
    overallAssessment: 'needs-improvement',
    overallFeedback: 'You outline an organized approach to planning and collaboration. Make the answer more specific by explaining how you would prioritize competing requests and measure success in this role.',
    scores: { relevance: 4, specificity: 3, clarity: 4, jobAlignment: 3 },
    strengths: [
      'Defines success before planning the work.',
      'Includes ownership, dependencies, and regular progress checks.',
    ],
    improvements: [
      'Give an example of how you would resolve competing priorities.',
      'Identify one success measure relevant to the responsibility.',
    ],
    nextAttemptFocus: 'Name one success measure and explain how you would use it to prioritize the work.',
  },
} satisfies Record<FeedbackQuestionType, InterviewFeedback>

// Validate fixtures with the same contract that future feedback must satisfy.
// These examples do not use the question text, recording, or any API.
export function getSampleInterviewFeedback(questionType: FeedbackQuestionType): InterviewFeedback {
  return interviewFeedbackSchema.parse(samples[questionType])
}
