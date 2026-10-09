# Mines

A mobile-friendly PWA remake of [Simon Tatham's Mines](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/js/mines.html), built with React + Vite.

- No-guess boards: every board can be cleared by logic alone, starting from your first tap
- Tap to reveal, long-press (or right-click) to flag, tap a number to clear around it
- Flag mode, undo/redo (including after hitting a mine), restart the same board
- Wide boards turn sideways on portrait screens
- Haptics: Vibration API on Android; best-effort switch-haptic fallback on iOS Safari 18+
- Installable and works offline; your game and best times are saved

Keys: `U` undo · `R` redo · `N` new game · `F` flag mode.

## Develop

```sh
npm install
npm run dev     # local dev server
npm test        # generator/solver/reducer tests
npm run build   # production build in dist/
```

## Deploy to GitHub Pages

Push to `main` on GitHub, then in **Settings → Pages** set **Source** to **GitHub Actions**.
`.github/workflows/deploy.yml` tests, builds and publishes `dist/`. The build uses relative paths, so it works under any repo name.
