# Copilot repository instructions — Voice Journal

When performing a code review in this repository, follow the review standards
in `.github/skills/code-review/SKILL.md`. In short:

- Verify claims before flagging: config/plugin claims against CI's
  `npm run config:check`, dependency/API claims against the installed
  `node_modules/` packages and Expo SDK 57 docs. Never assume older SDK
  behavior.
- Do not flag new native modules or config changes as blocking OTA/release
  concerns; release sequencing is an owner decision.
- Do not report what `npm run qualitycheck` already catches (types, lint,
  tests, config resolution).
- This repo is Android-only. Violations of the repo rules in
  `.github/skills/code-review/SKILL.md` (deprecated APIs, raw SQL outside
  DAOs, raw `Alert.alert`, emoji icons, shallow mock-based tests) are the
  only default High-severity findings; everything else must be calibrated
  to the severity rules in that skill.
