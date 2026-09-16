import { Link } from 'react-router-dom';
import { PIPELINE_STAGES } from '../lib/pipeline.js';

const CAPABILITIES = [
  {
    title: 'Match records automatically',
    body: 'Join every fault or event to the account it belongs to, even when an account appears many times.',
  },
  {
    title: 'Latest record, selected consistently',
    body: 'Pick the most recent event with a deterministic, explainable rule — no more eyeballing dates.',
  },
  {
    title: 'Rules as data, not code',
    body: 'Describe classifications once, version them, and know exactly which rule produced every result.',
  },
  {
    title: 'AI only where it helps',
    body: 'An optional assistant proposes outcomes for uncertain cases and never overrides a matched rule.',
  },
  {
    title: 'Review only the exceptions',
    body: 'A fast queue shows the unusual rows with the full history side by side, then records the decision.',
  },
  {
    title: 'A reproducible report',
    body: 'Each run freezes the setup and rules it used, so last month’s file always matches last month’s result.',
  },
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="landing-brand">
          <span className="brand-mark">SP</span>
          <strong>SheetPilot</strong>
        </div>
        <nav className="landing-links" aria-label="Landing">
          <a href="#how-it-works">How it works</a>
          <a href="#capabilities">Capabilities</a>
          <Link className="button button-primary" to="/dashboard">
            Open the app
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="landing-hero">
          <p className="landing-eyebrow">Recurring spreadsheet workflows</p>
          <h1>Turn a manual spreadsheet chore into a repeatable report.</h1>
          <p className="landing-lead">
            Upload the files you already use. SheetPilot matches the records, applies your business
            rules, asks a person to review only the unusual cases, and produces the finished Excel
            file — the same way, every time.
          </p>
          <div className="landing-cta">
            <Link className="button button-primary button-large" to="/dashboard">
              Open the app
            </Link>
            <Link className="button button-large" to="/datasets">
              Upload a file
            </Link>
          </div>
          <p className="landing-note">
            Runs locally with your own files. No spreadsheet data leaves the process unless you
            explicitly enable an AI provider.
          </p>
        </section>

        <section className="landing-section" id="how-it-works">
          <h2>How it works</h2>
          <p className="landing-section-lead">
            Five clear steps. You always know where you are, and you can pause and resume at any
            point.
          </p>
          <ol className="landing-steps">
            {PIPELINE_STAGES.map((stage, index) => (
              <li key={stage.key}>
                <span className="landing-step-index">{index + 1}</span>
                <div>
                  <strong>{stage.label}</strong>
                  <p>{stage.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-section" id="capabilities">
          <h2>What it does for you</h2>
          <div className="landing-grid">
            {CAPABILITIES.map((capability) => (
              <article key={capability.title} className="landing-card">
                <h3>{capability.title}</h3>
                <p>{capability.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-final">
          <div>
            <h2>Ready to automate today’s report?</h2>
            <p className="landing-section-lead">
              Start by uploading the files you already work with. Nothing is changed in place.
            </p>
          </div>
          <Link className="button button-primary button-large" to="/dashboard">
            Get started
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span>SheetPilot</span>
        <span className="muted small">
          A local-first automation workspace for spreadsheet workflows.
        </span>
      </footer>
    </div>
  );
}
