import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';
import IconGen from 'icon-gen';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = resolve(ROOT, 'build/icon.svg');
const BUILD_PNG = resolve(ROOT, 'build/icon.png');
const RES_PNG = resolve(ROOT, 'resources/icon.png');
const BUILD_DIR = resolve(ROOT, 'build');

const svg = await readFile(SVG);

const png1024 = await sharp(svg, { density: 384 }).resize(1024, 1024).png().toBuffer();
await writeFile(BUILD_PNG, png1024);
await writeFile(RES_PNG, png1024);
console.log('wrote', BUILD_PNG);
console.log('wrote', RES_PNG);

const TMP = resolve(BUILD_DIR, '.icon-tmp');
await mkdir(TMP, { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  const buf = await sharp(svg, { density: Math.ceil((size / 1024) * 384) })
    .resize(size, size)
    .png()
    .toBuffer();
  await writeFile(resolve(TMP, `${size}.png`), buf);
}

await IconGen(TMP, BUILD_DIR, {
  report: false,
  ico: { name: 'icon', sizes: [16, 24, 32, 48, 64, 128, 256] },
  icns: { name: 'icon', sizes: [16, 32, 64, 128, 256, 512, 1024] },
  favicon: false,
});
console.log('wrote', resolve(BUILD_DIR, 'icon.ico'));
console.log('wrote', resolve(BUILD_DIR, 'icon.icns'));

await rm(TMP, { recursive: true, force: true });
