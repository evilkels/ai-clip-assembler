# AI Clip Assembler — Frontend

Electron + React + Vite app for reviewing drone clip candidates.

## Scripts

- `npm install` — install dependencies (also rebuilds Electron native deps).
- `npm run typecheck` — TypeScript strict check (verified passing).
- `npm run build` — typecheck + electron-vite production build (verified passing).
- `npm run dev` — full Electron dev launch (renderer at :5173 + main + preload).
- `npm run dev:renderer` — renderer only in a plain browser at :5174. Useful when
  Electron can't run a window (sandboxed CI) — review UI works against mock clips.
- `npm run dev:with-backend` — runs FastAPI + Electron together.

## Layout

```
src/
  main/index.ts         Electron main process (window, dev URL loader)
  preload/index.ts      Context bridge — exposes backendUrl to renderer
  renderer/
    index.html
    src/
      api/              Typed API client (swap mock → backend when #5 lands)
      components/       ScoreChip, ClipCard
      routes/           Import / Review / Export pages
      state/            ReviewContext (decisions + accepted order)
      types/clip.ts     Frontend ClipCandidate / ClipScores types
```

## Backend boundary

`api/client.ts#getClips` reads `mockClips.ts` today. The shape (`ClipCandidate`)
mirrors what backend issue #5 will return, with score fields covering smoothness,
sharpness, exposure, contrast, and an overall weighted score plus a rule-based
`reason` string. To wire the real backend, pass `{ useMock: false, projectId }`.
