import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("../frontend/node_modules/playwright");

const [inputArg, outputArg, widthArg = "640", qualityArg = "0.9"] = process.argv.slice(2);
if (!inputArg || !outputArg) {
  console.error("Usage: node scripts/optimize-static-image.mjs <input> <output> [width] [quality]");
  process.exit(1);
}

const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const targetWidth = Math.max(1, Number(widthArg));
const quality = Math.min(1, Math.max(0, Number(qualityArg)));
const mimeByExtension = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const inputMime = mimeByExtension[extname(inputPath).toLowerCase()];
if (!inputMime) throw new Error(`Unsupported input image: ${inputPath}`);

const source = await readFile(inputPath);
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  const result = await page.evaluate(
    async ({ dataUrl, width, outputQuality }) => {
      const image = new Image();
      image.src = dataUrl;
      await image.decode();

      const height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * width));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.drawImage(image, 0, 0, width, height);

      return {
        dataUrl: canvas.toDataURL("image/webp", outputQuality),
        sourceWidth: image.naturalWidth,
        sourceHeight: image.naturalHeight,
        width,
        height,
      };
    },
    {
      dataUrl: `data:${inputMime};base64,${source.toString("base64")}`,
      width: targetWidth,
      outputQuality: quality,
    },
  );

  const encoded = result.dataUrl.split(",")[1];
  const output = Buffer.from(encoded, "base64");
  await writeFile(outputPath, output);
  console.log(JSON.stringify({ ...result, dataUrl: undefined, bytes: output.length }, null, 2));
} finally {
  await browser.close();
}
