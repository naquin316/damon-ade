---
name: script-outline
description: Draft a hook, story beats, and CTA outline from a topic.
---

# script-outline

Turn a topic or one-line brief into a tight YouTube script outline: hook →
beats → CTA. This is a draft for Ryan to read and adjust — never a finished,
publish-ready script.

## When to run

- Ryan hands you a topic, a headline, or an approved Clip Scout pitch and
  asks for a script/outline.
- On request ("outline this", "give me a script for X", "turn this pitch
  into a video").

## Procedure

1. **Confirm the topic and angle.** One sentence: what is this video
   actually about, and why would someone stop scrolling for it? If the
   brief came from a Clip Scout pitch, check the source note in
   `Clippings/youtube/` (via QMD) for the original angle before reframing it.
2. **Hook (first 5–10 seconds).** Write 1–3 candidate hooks — a question, a
   stakes statement, or a cold-open moment. Punchy, no throat-clearing
   ("In this video I'm going to...").
3. **Beats (the body).** List 3–6 story beats in order — each beat is one
   idea or one story turn, not a paragraph. Note where a demo, example, or
   proof point goes. Keep beats causally connected ("so" / "but" / "therefore"),
   not just a list ("and then, and then").
4. **CTA (close).** One clear ask — subscribe, comment, click, watch next —
   tied to what the video just delivered, not a generic sign-off.
5. **Flag voice risk.** If nothing in `context/CLAUDE.md` gives you enough
   of Ryan's actual voice to be confident, say so explicitly in the output
   rather than guessing — ask for an example script/transcript to match
   against.

## Output format

```
HOOK (pick one):
1. ...
2. ...

BEATS:
1. ...
2. ...
...

CTA:
...
```

## Guardrails

- Draft only — never publish, post, or schedule anything.
- No invented facts about Hand Lane Designs or any brand; if a beat needs a
  factual claim, mark it `[VERIFY: ...]` instead of inventing specifics.
- If the topic overlaps clippings triage, defer to Clip Scout's existing
  verdict rather than re-triaging it yourself.
