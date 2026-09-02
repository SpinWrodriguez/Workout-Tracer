# Deploying `ask-model`

The relay that holds the Anthropic key server-side, so the phone never has it.
Source: `supabase/functions/ask-model/index.ts`.

**You do not need this to use AI generation.** A key pasted into Settings works
immediately and needs no deploy. This is the version that does not leave a key
on the device.

---

## Why

`localStorage` is readable by anything running on the app's origin — a
compromised dependency in the bundle, a bad service worker, an unlocked phone
with devtools. The pasted key is a real tradeoff, not a placeholder, and the app
says so where you enter it.

What the relay buys:

- **The key stays server-side.** Held in Supabase's secret store; the device
  gets an answer, never a credential.
- **One place, every device.** The pasted key does not sync and is deliberately
  excluded from backups, so a new device means pasting it again. The relay works
  wherever the Supabase session does.
- **It is not an open proxy.** The function requires an `Authorization` header
  and validates it with `supabase.auth.getUser()`. Without that check anyone
  who found the URL could spend the credit.
- **The bill is capped where the caller cannot reach it.** `ALLOWED_MODELS`
  pins the model and `MAX_TOKENS_CEILING` caps the completion, so a stolen
  session cannot run up a bill on something bigger.
- **Rotation is one command** instead of re-pasting on each device.

What it costs: one deploy step outside the Pages workflow, which means one more
thing to remember. For one person on one phone, the pasted key is defensible.

---

## How, with the CLI

`npm i -g supabase`, or `winget install Supabase.CLI` on Windows.

```bash
supabase login
supabase link --project-ref <ref>      # the <ref> in https://<ref>.supabase.co
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy ask-model
```

`link` wants a `supabase/config.toml`, which this repo does not carry. Run
`supabase init` first if it complains — it writes the config and leaves the
existing `functions/` directory alone.

## How, without the CLI

Everything below is in the Supabase dashboard, which is the easier path from a
phone or a machine without the toolchain.

1. **Edge Functions** → **Deploy a new function**, named exactly `ask-model`.
2. Paste the contents of `supabase/functions/ask-model/index.ts` and deploy.
3. **Project Settings** → **Edge Functions** → **Secrets** → add
   `ANTHROPIC_API_KEY`.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected by the Edge runtime. Do not
set them.

---

## Checking it worked

The app cannot tell a configured project from a deployed function without
calling one, and it must not call a paid API on open. So it assumes the relay is
there and corrects itself on the first failure: Settings then says the function
did not answer, and the AI buttons go away until a key is saved or the app is
reopened.

So the test is a real generation: **Program → Build the week with AI**, one day,
build. A workout means the relay is live. An error naming `ask-model` means it
is not — and pasting a key in Settings gets you working while you sort it out.

Reopening the app retries the relay, so deploying it later needs nothing else.

---

## Streaming, and why a redeploy matters

The Ask button streams its answer: the reply renders from its first sentence
rather than after the last token. That only works if the deployed relay pipes
the upstream body through. An older copy did `await upstream.text()`, which
buffers the whole stream and hands it back as one late reply — correct, and it
throws away the only thing streaming is for.

So the app checks rather than assumes. `supabase-js` returns the raw `Response`
for `text/event-stream` and parses anything else, so a buffered reply is
recognisable: the sheet says **"ask-model did not stream. Redeploy it from
supabase/functions/ask-model."** That is the one error here that means the code
is fine and the deploy is old.

Generation is not streamed and does not care: a workout is JSON that nothing can
use until it is complete and validated, so streaming it would only animate a
wait.

---

## When you change the model

`MODEL` in `src/lib/askModel.ts` and `ALLOWED_MODELS` in the function are two
places holding one fact, because the relay refuses anything else on purpose.
Change one without the other and every call returns 400 — visible only on the
deployed app. `src/lib/askModel.test.ts` asserts the two agree in the repo; it
cannot see what is deployed, so redeploy the function whenever the model moves.
