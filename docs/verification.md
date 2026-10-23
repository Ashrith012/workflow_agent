# Restructure verification

- Python API and tool suite: 10 tests passed.
- Frontend: `npm run build` passed (TypeScript and Vite).
- CLI and server TypeScript checks passed.
- Registry check passed using `node --import tsx cli/check-registry.ts`.
- Mock workflow passed using `node --import tsx cli/run.ts examples/simple.json`;
  the agent service was not running, so this exercised the existing mock fallback.
- The tsx CLI wrapper could not create its IPC pipe in this execution environment;
  the equivalent Node import invocation above was used for runtime checks.
- Live provider calls and browser interaction were not tested.
