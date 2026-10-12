---
name: code-review
description: Review diffs, PRs, or working-tree changes with severity-classified, Copilot-style actionable findings (must fix / suggestion / nit), focused on this repo's Android-only Expo conventions. Use when asked to review a PR, commit, or working-tree changes.
---

# Code Review

Review code changes the way GitHub Copilot's code reviewer does: **focused, severity-classified,
actionable**. Never dump a line-by-line commentary. Report only what matters.

## Scope of a review

Input is one of:

- A PR number (`gh pr view <n>`, `gh pr diff <n>`)
- A commit range (`git diff <base>...<head>`)
- The working tree (`git diff` / `git status`)

Read the full diff, then open only the files you need for context. For a PR, also read the PR body
and any existing review comments — the body lists the issues the change intends to fix.

## Workflow

1. **Understand intent first.** Read the PR body / commit messages. State what the change is
   supposed to do in one or two sentences before listing findings.
2. **Gather context.** Open the surrounding code (callers, DAOs, services) — not just the
   changed hunks. A finding that ignores existing conventions is worse than no finding.
3. **Classify findings** (see below). Order by severity, then by file.
4. **Verify each finding is real.** Reproduce claims against the code — never flag something
   the diff already handles. CI runs `npm run qualitycheck` on every PR; do not re-run it or
   report its results (type errors, lint violations, failing tests) — review only what it
   cannot catch.
5. **Summarize.** End with a verdict: *approve*, *approve with suggestions*, or *request changes*.

## Finding classification

Prefix every finding with exactly one of:

| Prefix | Meaning | Examples |
| --- | --- | --- |
| **[MUST FIX]** | Bug, data loss, security issue, or breaks a repo rule. Blocks merge. | SQL injection, raw SQL in UI components, `expo-av` usage, missing resource cleanup, `any` where a type fits |
| **[SHOULD FIX]** | Correct in a corner case but fragile, or a meaningful readability/maintainability cost. Strongly recommended. | Missing error handling on a network call, unhandled promise rejection, magic numbers |
| **[SUGGESTION]** | Better alternative exists; author's approach works. | Simplifying nested conditionals, extracting a shared style |
| **[NIT]** | Trivial/style. Author's call; no response needed. | Naming, comment wording |

Rules of engagement:

- **One finding, one issue.** Never bundle unrelated problems into a paragraph.
- **Show code.** For SHOULD FIX and above, include a short corrected snippet.
- **Say why, not just what.** Copilot-style feedback always states the consequence
  ("this leaks the recorder instance, causing audio ducking on the next playback").
- **No praise padding.** Do not list things that are fine. If the diff is clean, say "No findings."
  at the end — that is a complete review.
- **Counts.** Lead with a one-line tally, e.g. `1 MUST FIX, 2 SUGGESTION, 1 NIT`.

## What to check (priority order)

1. **Correctness** — logic errors, race conditions, off-by-one, null/undefined paths, broken
   state transitions, edge cases in queue/backoff logic.
2. **Repo-specific rules** (from `AGENTS.md` — violations are MUST FIX):
   - Android only; do not review for or suggest iOS adaptations.
   - `expo-audio` only, never `expo-av`; release players/recorders/listeners.
   - `@react-native-vector-icons/material-icons`, never emoji or `@expo/vector-icons`.
   - No raw `Alert.alert`; use `ConfirmDialog` / `Toast`; theme via `useTheme()`.
   - All DB access via `src/db/dao/*`; no raw SQL in UI or services.
3. **Data safety** — offline-first invariants (immediate local writes), FTS5 sync triggers,
   Drive upload/LRU eviction correctness, BYOK key handling (never log the Gemini API key).
4. **Security** — injection, path traversal on file names, secrets in code or logs,
   over-permissive Drive scopes.
5. **Performance** — unnecessary re-renders in list components, O(n²) over entries, blocking
   work on the JS thread during recording/playback.
6. **Tests** — real logic coverage for *new* logic (DAOs, queues, state machines), which CI
   cannot judge on its own. Do NOT suggest shallow UI component tests over mocks.
   Missing tests for new queue/DAO logic = SHOULD FIX.

Explicitly **out of scope** — anything CI (`npm run qualitycheck`) already catches: type
errors, lint violations, failing tests, and anything else mechanical; also refactors beyond
the diff's blast radius, speculative abstractions, "while you're here" rewrites, adding features.

## Output format

```markdown
## Review: <title/branch>

**Intent:** <1–2 sentences>

**Findings:** 1 MUST FIX, 2 SUGGESTION, 1 NIT

### <file>:<line> — [SEVERITY] <one-line summary>
<what + why + consequence>
```ts
// corrected snippet (MUST/SHOULD FIX only)
```

**Verdict:** Approve / Approve with suggestions / Request changes
```

If reviewing a merged/closed PR for "did it address everything": instead verify each issue the
PR body or review comments raised against the current code, and report
`Addressed / Not addressed / Regressed` per item.