// Serves website/dist exactly as a static host would, for checking a build locally. `bun run site:serve`
const root = `${import.meta.dir}/dist`;
const port = Number(process.env.PORT ?? 5180);
Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes("..")) return new Response("Not found", { status: 404 });
    const file = Bun.file(`${root}${path.endsWith("/") ? `${path}index.html` : path}`);
    return (await file.exists()) ? new Response(file) : new Response("Not found", { status: 404 });
  },
});
console.log(`Website build on http://127.0.0.1:${port}`);
