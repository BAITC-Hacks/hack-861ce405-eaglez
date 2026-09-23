# Project guide for coding assistants

Local Node.js simulator using synthetic challenge data. No external npm dependencies. Run npm start; validate with npm test. Read README and docs/TEAM_HANDOFF.md before substantive edits.

- src/engine.js is the sole scoring source. Preserve weights, 8-quarter horizon, unscaled synergies, strict critical threshold (<40), and all validation rules.
- Playable scenarios require exactly five unique measures. Internal Shapley subsets are analytical counterfactuals, not valid playable scenarios.
- Server recomputes from choices; never trust client scores, costs, or effects.
- Recommendations search one-decision replacements; never label them globally optimal.
- Keep keys server-side in local .env. Never commit or print secrets.
- Label offline text. Configured credentials do not prove a live connection.
- AI returns verified fact IDs. Preserve validation or explicitly document and test any expanded response protocol.
- UI files are in public/. Preserve DOM IDs or update selectors together.
- Rebuild dist/akim-standalone.html with python3 scripts/build-standalone.py after changing public/, src/engine.js, src/analysis.js or src/presets.js. The standalone build is deliberately offline; never insert API keys into it.
- Never change source data or scoring to make results look better.
