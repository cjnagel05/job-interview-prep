import { ClipboardPaste, ListChecks, MessageCircleQuestion } from 'lucide-react'

const steps = [
  { title: 'Paste the job', description: 'Start with the full job description so the role’s real priorities are in view.', icon: ClipboardPaste },
  { title: 'Understand what matters', description: 'Connect the role’s responsibilities to the skills behind the work.', icon: ListChecks },
  { title: 'Practice your answers', description: 'Record an answer to a focused question, then get AI feedback.', icon: MessageCircleQuestion },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="page-width scroll-mt-8 py-20 sm:py-24" aria-labelledby="how-title">
      <div className="max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="mt-3 text-3xl font-semibold tracking-tight">Know the role. Practice your story.</h2>
        <p className="mt-4 text-sm text-muted-foreground">A focused way to prepare for the work behind the job title.</p>
      </div>
      <ol className="mt-9 grid gap-4 md:grid-cols-3">
        {steps.map(({ title, description, icon: Icon }, index) => (
          <li key={title} className="rounded-2xl border bg-white p-6">
            <div className="mb-5 flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-xl bg-summary"><Icon className="size-5 text-primary" aria-hidden="true" /></span>
              <span className="text-xs font-medium text-muted-foreground">0{index + 1}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <h3 className="text-base font-semibold">{title}</h3>
            <p className="mt-3 max-w-xs text-sm leading-6 text-muted-foreground">{description}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}