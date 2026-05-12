# Cadence — web landing page

A single-file static landing page (`index.html`) summarising the project for non-technical visitors.

## Deploy options

### GitHub Pages (zero config)
1. Settings → Pages → Source = `main`, folder = `/web` → Save.
2. URL: `https://ccheh.github.io/arc402/`.

### Vercel
1. Import the repo into Vercel.
2. Root directory: `web`.
3. Framework preset: "Other".
4. Build command: (none — static).
5. Output directory: `.`.

### Local preview
```sh
cd web
python -m http.server 8080
# open http://localhost:8080
```

## Future

This is intentionally minimal — single HTML file, no framework, no build. A richer Next.js version with a live testnet activity dashboard (reading on-chain settlement events) is roadmapped for Grant milestone M4.
