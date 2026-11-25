# Basket Lab Web

Vite + React + TypeScript client for Basket Lab. See the
[root README](../README.md) for the full two-process setup.

## Develop

```
npm ci
npm run dev
```

Vite serves `http://localhost:5173` and proxies `/api` to
`http://127.0.0.1:8000` (configured in `vite.config.ts`). Start the API from
`apps/api` as well. Without it, Insights and filing upload fail on `/api`
requests. The Portfolio workspace also needs the API.

## Test

```
npm test          # vitest run
npm run test:watch
```

Vitest runs in jsdom with `src/test/setup.ts` as the setup file
(`vitest.config.ts`). Tests do not use the network.

## Build and preview

```
npm run build     # tsc -b && vite build → dist/
npm run preview
```

`npm run preview` serves the built files. With this config it proxies `/api`
too, because Vite inherits `server.proxy` when `preview.proxy` is unset.

## Conventions

- `@` resolves to `src/` (alias in `vite.config.ts` and `vitest.config.ts`).
- UI primitives live in `src/components/ui/`, built on Radix and shadcn tokens.
- Tailwind v4 runs through `@tailwindcss/vite`. There is no `tailwind.config.js`.
- Design tokens and type rules are in [DESIGN.md](../DESIGN.md).
- Pure logic lives in `src/lib/` and carries the unit tests.
