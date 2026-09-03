import { useEffect, useRef, useState } from 'react';
import type { Exercise } from '../db/types';
import { askCoach, buildCoachContext, type CoachTurn } from '../lib/aiCoach';

/* -------------------------------------------------------------------------- */
/*  Ask about your own training.                                             */
/*                                                                           */
/*  The one place in the app where the model answers in prose. Everything     */
/*  else it does is constrained selection with a validator behind it, so this */
/*  is also the one place where being wrong is cheap — a sentence you can     */
/*  disagree with, not a workout that goes into the week.                    */
/*                                                                           */
/*  What it looked up is shown under each answer. Not decoration: it is the   */
/*  difference between a claim and a claim you can check, and it is how you   */
/*  see that "your squat has stalled" came from reading the squat history     */
/*  rather than from nowhere.                                                */
/* -------------------------------------------------------------------------- */

/** Offered on an empty sheet. Questions the data can actually answer. */
const STARTERS = [
  'Is my squat actually moving?',
  'What did I leave unfinished recently?',
  'What is short this week, and what should I add?',
];

const TOOL_LABEL: Record<string, string> = {
  search_exercises: 'searched your exercises',
  exercise_detail: 'read an exercise',
  exercise_history: 'read your logged sets',
};

/** What it looked at, and what the answer cost, in one line. */
function Footnote({ tools, ms, tokens }: { tools: string[]; ms: number; tokens?: number }) {
  const looked = [...new Set(tools)].map((tool) => TOOL_LABEL[tool] ?? tool);
  return (
    <p className="mt-1.5 text-[11px] text-text-faint">
      {looked.length > 0 ? `${looked.join(', ')} · ` : ''}
      {/* Milliseconds under a second: "0.0s" reads as a broken clock. */}
      {ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`}
      {tokens !== undefined ? ` · ${tokens} tokens out` : ''}
    </p>
  );
}

export function CoachSheet({
  exercises,
  onClose,
}: {
  exercises: Exercise[];
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | undefined>(undefined);
  /* The answer as it arrives. Held apart from `turns` because it is not a turn
     yet: nothing may replay a half-finished reply back to the model. */
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [notes, setNotes] = useState<Record<number, { tools: string[]; ms: number; tokens?: number }>>({});
  const foot = useRef<HTMLDivElement | null>(null);

  // Keep the newest turn in view, the way any message list behaves.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'end' });
  }, [turns, pending, streaming]);

  const ask = async (text: string) => {
    const asked = text.trim();
    if (!asked || pending) return;
    setQuestion('');
    setError(undefined);
    setPending(asked);
    setStreaming('');

    /* Rebuilt per question rather than once when the sheet opens: a set logged
       two minutes ago is exactly the thing you would ask about. */
    const context = await buildCoachContext(exercises);
    const answer = await askCoach({
      question: asked,
      turns,
      exercises,
      context,
      onText: (delta) => setStreaming((sofar) => sofar + delta),
    });
    setPending(undefined);
    setStreaming('');
    if (answer.error) {
      setError(answer.error);
      return;
    }
    setTurns(answer.turns);
    setNotes((previous) => ({
      ...previous,
      [answer.turns.length - 1]: {
        tools: answer.toolCalls,
        ms: answer.ms,
        tokens: answer.usage.outputTokens,
      },
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="px-4 pt-[calc(env(safe-area-inset-top)+16px)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="screen-title text-[22px]">Ask</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-text-dim"
          >
            Close
          </button>
        </div>
        <p className="mt-1 text-[13px] text-text-dim">
          Answers come from your own logged sets and this week's plan.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {turns.length === 0 && !pending && (
          <div className="mt-2">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => void ask(starter)}
                className="mt-2 w-full rounded-2xl bg-surface px-4 py-3 text-left text-[14px] font-medium"
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <p
              key={index}
              className="mt-4 ml-auto max-w-[85%] rounded-2xl bg-cta px-3.5 py-2.5 text-[14px] font-medium text-bg"
            >
              {turn.text}
            </p>
          ) : (
            <div key={index} className="mt-3 max-w-[92%]">
              <p className="rounded-2xl bg-surface px-3.5 py-2.5 text-[14px] whitespace-pre-wrap">
                {turn.text}
              </p>
              {notes[index] && (
                <Footnote
                  tools={notes[index]?.tools ?? []}
                  ms={notes[index]?.ms ?? 0}
                  tokens={notes[index]?.tokens}
                />
              )}
            </div>
          ),
        )}

        {pending && (
          <>
            <p className="mt-4 ml-auto max-w-[85%] rounded-2xl bg-cta px-3.5 py-2.5 text-[14px] font-medium text-bg">
              {pending}
            </p>
            {/* The answer as it lands, or a word about what it is doing
                while it is still deciding to look something up. */}
            {streaming ? (
              <p className="mt-3 max-w-[92%] rounded-2xl bg-surface px-3.5 py-2.5 text-[14px] whitespace-pre-wrap">
                {streaming}
              </p>
            ) : (
              <p className="mt-3 text-[13px] text-text-dim" role="status">
                Reading your training…
              </p>
            )}
          </>
        )}

        {error && (
          <p className="mt-3 rounded-2xl bg-surface px-3.5 py-2.5 text-[13px] text-rir-1">
            {error}
          </p>
        )}
        <div ref={foot} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
        className="flex items-end gap-2 bg-bg px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+12px)]"
      >
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your training"
          aria-label="Ask about your training"
          className="min-w-0 flex-1 rounded-full bg-surface px-4 py-3 text-[15px] outline-none"
        />
        <button
          type="submit"
          disabled={!question.trim() || pending !== undefined}
          className="rounded-full bg-cta px-4 py-3 text-[14px] font-semibold text-bg disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

/** The floating button. Raised clear of the resume bar when one is showing. */
export function CoachButton({ onOpen, raised }: { onOpen: () => void; raised: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Ask about my training"
      /* Violet: the one accent the workout screens do not already use for
         something, so it reads as "the AI thing" rather than as a set count
         or a rule warning. Both themes define it. */
      style={{ background: 'var(--color-bodyweight)', color: 'var(--color-bg)' }}
      className={`fixed right-4 z-30 flex size-12 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${
        raised
          ? 'bottom-[calc(env(safe-area-inset-bottom)+124px)]'
          : 'bottom-[calc(env(safe-area-inset-bottom)+76px)]'
      }`}
    >
      <svg viewBox="0 0 24 24" className="size-5.5" fill="none" aria-hidden="true">
        <path
          d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M9 11h6m-6 3h3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </button>
  );
}
