import { practiceFeedbackErrorMessages, type PracticeFeedbackErrorCategory } from '../src/lib/practice-feedback-contract.js'

export class PracticeFeedbackError extends Error {
  constructor(public status: number, public category: PracticeFeedbackErrorCategory) {
    super(practiceFeedbackErrorMessages[category])
  }
}
