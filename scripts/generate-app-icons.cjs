const fs = require('node:fs/promises');
const path = require('node:path');

const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(repoRoot, 'assets');
const outputDir = path.join(assetsDir, 'app-icons');
const sourcePath = path.join(assetsDir, 'logo.png');

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
// electron-builder installs a directory of NxN.png files as the Linux hicolor icon
// set as-is. A single PNG would only ship one size.
const linuxIconSizes = [16, 24, 32, 48, 64, 128, 256, 512];
const linuxIconDir = path.join(outputDir, 'linux');
const macIconArtworkScale = 832 / 1024;
const icnsRepresentations = [
  // macOS misreads PNG payloads in the 16px and 32px @1x slots (icp4/icp5),
  // so those use the ARGB-encoded ic04/ic05 types that iconutil emits.
  { logicalSize: 16, scale: 1, type: 'ic04', encoding: 'argb' },
  { logicalSize: 16, scale: 2, type: 'ic11' },
  { logicalSize: 32, scale: 1, type: 'ic05', encoding: 'argb' },
  { logicalSize: 32, scale: 2, type: 'ic12' },
  { logicalSize: 128, scale: 1, type: 'ic07' },
  { logicalSize: 128, scale: 2, type: 'ic13' },
  { logicalSize: 256, scale: 1, type: 'ic08' },
  { logicalSize: 256, scale: 2, type: 'ic14' },
  { logicalSize: 512, scale: 1, type: 'ic09' },
  { logicalSize: 512, scale: 2, type: 'ic10' },
];

async function renderPng(size) {
  return sharp(sourcePath).resize(size, size, { fit: 'contain' }).png().toBuffer();
}

async function renderMacPng(size) {
  const artworkSize = Math.round(size * macIconArtworkScale);
  const offset = Math.round((size - artworkSize) / 2);
  const artwork = await sharp(sourcePath)
    .resize(artworkSize, artworkSize, { fit: 'contain' })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: '#00000000',
    },
  })
    .composite([{ input: artwork, left: offset, top: offset }])
    .png()
    .toBuffer();
}

async function renderMacArgb(size) {
  const { data } = await sharp(await renderMacPng(size))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = size * size;
  // ARGB icns payloads store each channel as a separate plane, in A, R, G, B order.
  const channelOrder = [3, 0, 1, 2];
  const planes = channelOrder.map((channel) => {
    const plane = Buffer.alloc(pixelCount);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      plane[pixel] = data[pixel * 4 + channel];
    }
    return encodeIcnsRunLength(plane);
  });

  return Buffer.concat([Buffer.from('ARGB', 'ascii'), ...planes]);
}

// Icns run-length encoding written as literal runs only: a header byte of n
// (0-127) is followed by n + 1 raw bytes.
function encodeIcnsRunLength(bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 128) {
    const literal = bytes.subarray(offset, offset + 128);
    chunks.push(Buffer.from([literal.length - 1]), literal);
  }
  return Buffer.concat(chunks);
}

function encodeIco(images) {
  const headerSize = 6;
  const directoryEntrySize = 16;
  const directorySize = images.length * directoryEntrySize;
  const header = Buffer.alloc(headerSize + directorySize);

  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let imageOffset = header.length;
  for (const [index, image] of images.entries()) {
    const entryOffset = headerSize + index * directoryEntrySize;
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
    header.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
    header.writeUInt8(0, entryOffset + 2);
    header.writeUInt8(0, entryOffset + 3);
    header.writeUInt16LE(1, entryOffset + 4);
    header.writeUInt16LE(32, entryOffset + 6);
    header.writeUInt32LE(image.buffer.length, entryOffset + 8);
    header.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.buffer.length;
  }

  return Buffer.concat([header, ...images.map((image) => image.buffer)]);
}

function encodeIcns(images) {
  const chunks = images.map((image) => {
    const header = Buffer.alloc(8);
    header.write(image.type, 0, 4, 'ascii');
    header.writeUInt32BE(image.buffer.length + header.length, 4);
    return Buffer.concat([header, image.buffer]);
  });

  const totalLength = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(totalLength, 4);

  return Buffer.concat([header, ...chunks]);
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true });

  const renderedImages = await Promise.all(
    pngSizes.map(async (size) => ({ size, buffer: await renderPng(size) })),
  );
  const macImages = await Promise.all(
    icnsRepresentations.map(async (representation) => ({
      ...representation,
      buffer:
        representation.encoding === 'argb'
          ? await renderMacArgb(representation.logicalSize * representation.scale)
          : await renderMacPng(representation.logicalSize * representation.scale),
    })),
  );

  for (const image of renderedImages) {
    await fs.writeFile(path.join(outputDir, `icon-${image.size}.png`), image.buffer);
    console.log(`Generated icon-${image.size}.png`);
  }

  const linuxIcon = renderedImages.find((image) => image.size === 512);
  if (!linuxIcon) {
    throw new Error('Expected a 512x512 icon for Linux packaging.');
  }
  await fs.writeFile(path.join(outputDir, 'icon.png'), linuxIcon.buffer);
  console.log('Generated icon.png');

  await fs.rm(linuxIconDir, { recursive: true, force: true });
  await fs.mkdir(linuxIconDir, { recursive: true });
  for (const image of renderedImages.filter(({ size }) => linuxIconSizes.includes(size))) {
    await fs.writeFile(path.join(linuxIconDir, `${image.size}x${image.size}.png`), image.buffer);
  }
  console.log('Generated linux icon set');

  await fs.writeFile(path.join(outputDir, 'icon-mac.png'), await renderMacPng(1024));
  console.log('Generated icon-mac.png');

  await fs.writeFile(
    path.join(outputDir, 'icon.ico'),
    encodeIco(renderedImages.filter((image) => icoSizes.includes(image.size))),
  );
  console.log('Generated icon.ico');

  await fs.writeFile(path.join(outputDir, 'icon.icns'), encodeIcns(macImages));
  console.log('Generated icon.icns');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
