import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execSync } from "node:child_process";

function gitValue(command: string): string {
  try {
    return execSync(command, {
      cwd: path.resolve(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function appVersion(env: Record<string, string | undefined> = process.env): string {
  const explicit =
    env.VITE_APP_VERSION ||
    env.APP_IMAGE_TAG ||
    env.IMAGE_TAG;
  if (explicit) return explicit;

  const exactTag = gitValue("git describe --tags --exact-match --match V*");
  if (exactTag) return exactTag;

  const latestTag = gitValue("git describe --tags --abbrev=0 --match V*");
  const shortSha = gitValue("git rev-parse --short HEAD");
  if (latestTag && shortSha) return `${latestTag}+${shortSha}`;
  return shortSha ? `dev+${shortSha}` : "dev";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");

  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion(env)),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
    },
  };
});
