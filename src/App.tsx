import { ArrowRight, ArrowUpRight, BriefcaseBusiness } from 'lucide-react'
import { AnalysisTool } from '@/components/analysis-tool'
import { HowItWorks } from '@/components/how-it-works'
import { Separator } from '@/components/ui/separator'

function App() {
  return (
    <>
      <a href="#prepare" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4">
        Skip to interview prep tool
      </a>
      <header className="border-b bg-background">
        <nav aria-label="Main navigation" className="page-width flex min-h-18 flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
          <a href="#" aria-label="JobQue Interview Prep home" className="nav-link flex flex-wrap items-center gap-x-2 text-lg font-semibold tracking-tight">
            <span className="text-primary">JobQue</span>
            <span className="font-normal text-border" aria-hidden="true">/</span>
            <span>Interview Prep</span>
          </a>
          <div className="flex flex-wrap items-center gap-5 text-sm font-medium text-muted-foreground sm:gap-7">
            <a className="nav-link" href="#prepare">Prepare</a>
            <a className="nav-link" href="#how-it-works">How it works</a>
            <a className="nav-link inline-flex items-center gap-1" href="https://wa.jobque.ai/">JobQue<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
          </div>
        </nav>
      </header>

      <main>
        <section className="page-width pb-10 pt-12 sm:pb-12 sm:pt-20" aria-labelledby="hero-title">
          <p className="eyebrow mb-5">Interview prep by JobQue</p>
          <h1 id="hero-title" className="max-w-4xl text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-6xl lg:text-[4.25rem]">
            Turn the job you applied for into <span className="text-primary">an interview preparation plan.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
            Find the responsibilities and skills that matter. Get focused interview questions, practice your answers, and get AI feedback.
          </p>
          <a href="#prepare" className="nav-link mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary">
            Start with your job description<ArrowRight className="size-4" aria-hidden="true" />
          </a>
        </section>

        <div className="page-width"><AnalysisTool /></div>
        <HowItWorks />

        <section id="disclaimer" className="page-width scroll-mt-8 pb-20" aria-labelledby="disclaimer-title">
          <div className="flex flex-col justify-between gap-6 rounded-2xl border border-summary-border bg-summary p-6 sm:flex-row sm:items-center sm:p-9">
            <div className="max-w-2xl">
              <p className="eyebrow">A useful starting point</p>
              <h2 id="disclaimer-title" className="mt-3 text-2xl font-semibold tracking-tight">Prepare with the role in mind.</h2>
              <p className="mt-3 text-sm leading-7 text-muted-foreground">
                Interview questions are generated from signals in the provided job description and are intended for preparation. Actual interview questions may vary.
              </p>
            </div>
            <a href="#prepare" className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-primary hover:underline">
              Build your prep<ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t bg-white py-9">
        <div className="page-width">
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
            <span className="flex items-center gap-2 font-semibold"><BriefcaseBusiness className="size-4 text-primary" aria-hidden="true" />JobQue Interview Prep</span>
            <span className="text-muted-foreground">Walk in knowing what matters.</span>
          </div>
          <Separator className="my-6" />
          <p className="max-w-4xl text-xs leading-6 text-muted-foreground">
            Interview questions are generated from signals in the provided job description and are intended for preparation. Actual interview questions may vary.
          </p>
        </div>
      </footer>
    </>
  )
}

export default App