import { resolve } from "node:path";
import { readFile, realpath } from "node:fs/promises";

import { createServer } from "vite";

const workspaceRoot = resolve(process.cwd());
const primaryPort = Number(process.env.BROWSER_FIXTURE_PORT ?? "43991");
const ports = [primaryPort, primaryPort + 1];
const servers = [];
let conformanceAliases = [
  { find: /^dual-surface-ui\/webmcp$/, replacement: resolve(workspaceRoot, ".conformance-evidence", "UNVERIFIED-webmcp.js") },
  { find: /^dual-surface-ui$/, replacement: resolve(workspaceRoot, ".conformance-evidence", "UNVERIFIED-root.js") },
];
try {
  const evidence = JSON.parse(await readFile(
    resolve(workspaceRoot, ".conformance-evidence", "package.json"),
    "utf8",
  ));
  const installedRoot = await realpath(evidence.install.root);
  if (installedRoot !== evidence.install.root) throw new Error("installed package root is aliased");
  conformanceAliases = [
    { find: /^dual-surface-ui\/webmcp$/, replacement: resolve(installedRoot, "dist/webmcp/index.js") },
    { find: /^dual-surface-ui$/, replacement: resolve(installedRoot, "dist/index.js") },
  ];
} catch {
  // Ordinary browser fixtures do not require conformance installation. The
  // conformance page fails closed instead of falling back to workspace package
  // self-resolution when authenticated install evidence is absent.
}

function healthPlugin() {
  return {
    name: "dual-surface-browser-fixture-health",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(
          request.url ?? "/",
          "http://browser-fixture.invalid",
        ).pathname;
        if (/^\/\.webmcp-[^/]*-profile(?:\/|$)/.test(pathname)) {
          response.writeHead(403, {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          });
          response.end("Forbidden");
          return;
        }
        const isolatedPaths = new Set([
          "/examples/browser-evidence/native.html",
          "/examples/browser-evidence/native-declarative.html",
          "/examples/browser-evidence/navigation-target.html",
        ]);
        if (isolatedPaths.has(request.url?.split("?", 1)[0])) {
          response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
          response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
        }
        if (request.url !== "/__health") {
          next();
          return;
        }
        response.writeHead(200, {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ status: "ready" }));
      });
    },
  };
}

for (const port of ports) {
  const server = await createServer({
    appType: "mpa",
    cacheDir: resolve(
      workspaceRoot,
      "node_modules",
      ".vite-browser-evidence",
      String(port),
    ),
    clearScreen: false,
    logLevel: "error",
    plugins: [healthPlugin()],
    resolve: { alias: conformanceAliases },
    root: workspaceRoot,
    server: {
      host: "127.0.0.1",
      port,
      strictPort: true,
    },
  });
  await server.listen();
  servers.push(server);
}

async function close() {
  await Promise.all(servers.map((server) => server.close()));
}

process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
