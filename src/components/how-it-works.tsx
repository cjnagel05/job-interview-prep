import { ClipboardPaste, ListChecks, MessageCircleQuestion } from 'lucide-react'

const steps = [
  { title: 'Paste the job', description: 'Start with the full job description so the role’s real priorities are in view.', icon: ClipboardPaste },
  { title: 'Understand what matters', description: 'Connect the role’s responsibilities to the skills behind the work.', icon: ListChecks },
  { title: 'Prepare your stories', description: 'Use focused questions to choose the experiences you want to discuss.', icon: MessageCircleQuestion },
]

export function HowItWorks() {
  return (
    <section id="how-it-works" className="page-width scroll-mt-8 py-20 sm:py-24" aria-labelledby="how-title">
      <div className="text-center">
        <p className="eyebrow">How it works</p>
        <h2 id="how-title" className="mt-3 text-3xl font-semibold tracking-tight">From job description to ready-to-tell stories.</h2>
        <p className="mt-4 text-sm text-muted-foreground">A focused way to prepare for the work behind the job title.</p>
      </div>
      <ol className="mt-12 grid gap-9 sm:grid-cols-3 sm:gap-8">
        {steps.map(({ title, description, icon: Icon }, index) => (
          <li key={title}>
            <div className="mb-5 flex items-center gap-4">
              <span className="flex size-12 items-center justify-center rounded-2xl border bg-white"><Icon className="size-5 text-primary" aria-hidden="true" /></span>
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