// Resizes the source avatar frames to 256x256 WebP into public/avatar (copied to dist/avatar by Vite).
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../assets/avatar/pos");
const out = resolve(here, "../public/avatar");
const STATES = ["idle", "thinking", "talking", "happy", "sad"];

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.warn("make-avatars: sharp unavailable, using committed public/avatar files");
  process.exit(0);
}
await mkdir(out, { recursive: true });
for (const s of STATES) {
  await sharp(resolve(src, `${s}.webp`))
    .resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp()
    .toFile(resolve(out, `${s}.webp`));
}
console.log(`make-avatars: wrote ${STATES.length} frames to ${out}`);
