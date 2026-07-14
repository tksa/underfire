#!/usr/bin/env node

/**
 * Split Digital Goblin's fused Train Track - Modular Pack GLB into five
 * independently loadable, dependency-free glTF 2.0 binary assets.
 *
 * The source pack stores all five pieces in one primitive. Its exporter kept
 * each piece in a contiguous vertex range, and no triangle crosses the five
 * validated boundaries below. This script intentionally pins the source hash
 * and layout: if the downloaded asset changes, it stops instead of silently
 * producing corrupt or incorrectly attributed derivatives.
 *
 * Usage:
 *   node scripts/split-train-track-pack.mjs
 *   node scripts/split-train-track-pack.mjs /path/to/source.glb /output/dir
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const DEFAULT_SOURCE = path.join(os.homedir(), 'Downloads', 'train_track_-_modular_pack.glb');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'models', 'railway');

const SOURCE_SHA256 = '3cab682658398a39039ec1064d810ed117d2e41147cc3f9dfbc2e64f6167ba52';
const SOURCE_VERTEX_COUNT = 40_124;
const SOURCE_INDEX_COUNT = 112_896;
const SOURCE_PROVENANCE = Object.freeze({
  author: 'Digital Goblin (https://sketchfab.com/DigitalGoblin)',
  license: 'CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
  source: 'https://sketchfab.com/3d-models/train-track-modular-pack-e662a834e5fb4b65ad4f8194f8af515b',
  title: 'Train Track - Modular Pack',
});

const MODULES = Object.freeze([
  { name: 'track_straight', start: 0, end: 2_668 },
  { name: 'track_curve_01', start: 2_668, end: 8_936 },
  { name: 'track_curve_02', start: 8_936, end: 15_204 },
  { name: 'track_curve_03', start: 15_204, end: 27_664 },
  { name: 'track_curve_04', start: 27_664, end: 40_124 },
]);

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ARRAY_BUFFER = 34_962;
const ELEMENT_ARRAY_BUFFER = 34_963;
const FLOAT = 5_126;
const UNSIGNED_SHORT = 5_123;
const TRIANGLES = 4;

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseGlb(buffer, label) {
  assert(buffer.length >= 20, `${label}: file is too short to be a GLB`);
  assert(buffer.readUInt32LE(0) === GLB_MAGIC, `${label}: invalid GLB magic`);
  assert(buffer.readUInt32LE(4) === 2, `${label}: expected GLB version 2`);
  assert(buffer.readUInt32LE(8) === buffer.length, `${label}: header length does not match file size`);

  let cursor = 12;
  const chunks = [];
  while (cursor < buffer.length) {
    assert(cursor + 8 <= buffer.length, `${label}: truncated chunk header`);
    const byteLength = buffer.readUInt32LE(cursor);
    const type = buffer.readUInt32LE(cursor + 4);
    cursor += 8;
    assert(cursor + byteLength <= buffer.length, `${label}: truncated chunk data`);
    chunks.push({ type, data: buffer.subarray(cursor, cursor + byteLength) });
    cursor += byteLength;
  }

  assert(chunks.length === 2, `${label}: expected exactly one JSON and one BIN chunk`);
  assert(chunks[0].type === JSON_CHUNK, `${label}: first chunk is not JSON`);
  assert(chunks[1].type === BIN_CHUNK, `${label}: second chunk is not BIN`);

  let json;
  try {
    json = JSON.parse(chunks[0].data.toString('utf8').trimEnd());
  } catch (error) {
    fail(`${label}: invalid JSON chunk (${error.message})`);
  }

  const declaredBinLength = json.buffers?.[0]?.byteLength;
  assert(Number.isInteger(declaredBinLength), `${label}: missing buffer byteLength`);
  assert(declaredBinLength <= chunks[1].data.length, `${label}: BIN chunk is shorter than the declared buffer`);

  return { json, bin: chunks[1].data.subarray(0, declaredBinLength) };
}

function accessorInfo(document, accessorIndex) {
  const accessor = document.json.accessors?.[accessorIndex];
  assert(accessor, `missing accessor ${accessorIndex}`);
  assert(accessor.bufferView !== undefined, `sparse/accessor-without-bufferView ${accessorIndex} is unsupported`);
  const view = document.json.bufferViews?.[accessor.bufferView];
  assert(view?.buffer === 0, `accessor ${accessorIndex} must use buffer 0`);

  const componentsByType = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const bytesByComponent = { 5123: 2, 5125: 4, 5126: 4 };
  const components = componentsByType[accessor.type];
  const componentBytes = bytesByComponent[accessor.componentType];
  assert(components && componentBytes, `unsupported accessor ${accessorIndex} format`);

  const packedStride = components * componentBytes;
  const stride = view.byteStride ?? packedStride;
  assert(stride >= packedStride, `accessor ${accessorIndex} has an invalid byteStride`);
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const end = start + (accessor.count - 1) * stride + packedStride;
  assert(start >= 0 && end <= document.bin.length, `accessor ${accessorIndex} exceeds the BIN chunk`);

  return { accessor, view, components, componentBytes, packedStride, stride, start };
}

function readFloatAccessor(document, accessorIndex, expectedType) {
  const info = accessorInfo(document, accessorIndex);
  assert(info.accessor.componentType === FLOAT, `accessor ${accessorIndex} is not FLOAT`);
  assert(info.accessor.type === expectedType, `accessor ${accessorIndex} is not ${expectedType}`);
  const output = new Float32Array(info.accessor.count * info.components);

  for (let row = 0; row < info.accessor.count; row += 1) {
    const rowOffset = info.start + row * info.stride;
    for (let component = 0; component < info.components; component += 1) {
      output[row * info.components + component] = document.bin.readFloatLE(rowOffset + component * 4);
    }
  }
  return output;
}

function readIndexAccessor(document, accessorIndex) {
  const info = accessorInfo(document, accessorIndex);
  assert(info.accessor.type === 'SCALAR', `index accessor ${accessorIndex} is not SCALAR`);
  assert(info.accessor.componentType === 5_125, `index accessor ${accessorIndex} is not UNSIGNED_INT`);
  const output = new Uint32Array(info.accessor.count);
  for (let row = 0; row < info.accessor.count; row += 1) {
    output[row] = document.bin.readUInt32LE(info.start + row * info.stride);
  }
  return output;
}

function imageBytes(document, imageIndex, expectedName) {
  const image = document.json.images?.[imageIndex];
  assert(image?.mimeType === 'image/png', `image ${imageIndex} is not an embedded PNG`);
  assert(image.bufferView !== undefined, `image ${imageIndex} is not embedded in a bufferView`);
  const view = document.json.bufferViews?.[image.bufferView];
  assert(view?.buffer === 0, `image ${imageIndex} must use buffer 0`);
  assert(view.name === expectedName, `image ${imageIndex} expected ${expectedName}, found ${view.name ?? 'unnamed'}`);
  const start = view.byteOffset ?? 0;
  const end = start + view.byteLength;
  assert(end <= document.bin.length, `image ${imageIndex} exceeds the BIN chunk`);
  const bytes = document.bin.subarray(start, end);
  assert(bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `image ${imageIndex} has an invalid PNG signature`);
  return bytes;
}

function validateSource(sourceBuffer, document) {
  assert(sha256(sourceBuffer) === SOURCE_SHA256, 'source SHA-256 does not match the pinned Sketchfab download');
  assert(document.json.asset?.version === '2.0', 'source is not glTF 2.0');
  for (const [key, value] of Object.entries(SOURCE_PROVENANCE)) {
    assert(document.json.asset?.extras?.[key] === value, `source provenance mismatch for asset.extras.${key}`);
  }

  assert(document.json.meshes?.length === 1, 'source layout changed: expected one mesh');
  const primitives = document.json.meshes[0]?.primitives;
  assert(primitives?.length === 1, 'source layout changed: expected one primitive');
  const primitive = primitives[0];
  assert((primitive.mode ?? TRIANGLES) === TRIANGLES, 'source primitive is not TRIANGLES');
  assert(primitive.attributes?.POSITION === 0, 'source POSITION accessor changed');
  assert(primitive.attributes?.NORMAL === 1, 'source NORMAL accessor changed');
  assert(primitive.attributes?.TANGENT === 2, 'source TANGENT accessor changed');
  assert(primitive.attributes?.TEXCOORD_0 === 3, 'source TEXCOORD_0 accessor changed');
  assert(primitive.indices === 4, 'source index accessor changed');
  assert(document.json.accessors?.[0]?.count === SOURCE_VERTEX_COUNT, 'source vertex count changed');
  assert(document.json.accessors?.[4]?.count === SOURCE_INDEX_COUNT, 'source index count changed');
  assert(SOURCE_INDEX_COUNT % 3 === 0, 'source index count is not divisible by three');
  assert(MODULES[0].start === 0 && MODULES.at(-1).end === SOURCE_VERTEX_COUNT, 'module ranges do not cover the source');
  for (let index = 1; index < MODULES.length; index += 1) {
    assert(MODULES[index - 1].end === MODULES[index].start, 'module ranges are not contiguous');
  }

  const material = document.json.materials?.[primitive.material];
  const legacy = material?.extensions?.KHR_materials_pbrSpecularGlossiness;
  assert(legacy?.diffuseTexture?.index === 0, 'source diffuse texture layout changed');
  assert(material?.normalTexture?.index === 2, 'source normal texture layout changed');
}

function classifyVertex(vertexIndex) {
  for (let moduleIndex = 0; moduleIndex < MODULES.length; moduleIndex += 1) {
    const module = MODULES[moduleIndex];
    if (vertexIndex >= module.start && vertexIndex < module.end) return moduleIndex;
  }
  return -1;
}

function splitIndices(indices) {
  const moduleIndices = MODULES.map(() => []);
  const usedVertices = MODULES.map((module) => new Uint8Array(module.end - module.start));

  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [indices[offset], indices[offset + 1], indices[offset + 2]];
    const groups = triangle.map(classifyVertex);
    assert(groups.every((group) => group >= 0), `triangle ${offset / 3} references a vertex outside the source range`);
    assert(groups[0] === groups[1] && groups[1] === groups[2], `triangle ${offset / 3} crosses a module boundary`);

    const moduleIndex = groups[0];
    const module = MODULES[moduleIndex];
    for (const vertexIndex of triangle) {
      moduleIndices[moduleIndex].push(vertexIndex - module.start);
      usedVertices[moduleIndex][vertexIndex - module.start] = 1;
    }
  }

  for (let moduleIndex = 0; moduleIndex < MODULES.length; moduleIndex += 1) {
    const module = MODULES[moduleIndex];
    const unused = usedVertices[moduleIndex].reduce((sum, used) => sum + (used ? 0 : 1), 0);
    assert(unused === 0, `${module.name} has ${unused} unused vertices; pinned ranges no longer match`);
    assert(moduleIndices[moduleIndex].length % 3 === 0, `${module.name} has incomplete triangles`);
  }
  return moduleIndices;
}

function sliceAttribute(source, components, start, end) {
  return source.slice(start * components, end * components);
}

function recenterAndGround(positions) {
  const sourceMin = [Infinity, Infinity, Infinity];
  const sourceMax = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis];
      if (value < sourceMin[axis]) sourceMin[axis] = value;
      if (value > sourceMax[axis]) sourceMax[axis] = value;
    }
  }

  const translation = [
    -(sourceMin[0] + sourceMax[0]) / 2,
    -sourceMin[1],
    -(sourceMin[2] + sourceMax[2]) / 2,
  ];
  const output = new Float32Array(positions.length);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let offset = 0; offset < positions.length; offset += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[offset + axis] + translation[axis];
      assert(Number.isFinite(value), 'position contains a non-finite value');
      output[offset + axis] = value;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }

  const size = max.map((value, axis) => value - min[axis]);
  const epsilon = 1e-4;
  assert(Math.abs((min[0] + max[0]) / 2) < epsilon, 'module is not centered on local X');
  assert(Math.abs(min[1]) < epsilon, 'module is not grounded at local Y=0');
  assert(Math.abs((min[2] + max[2]) / 2) < epsilon, 'module is not centered on local Z');
  return { positions: output, min, max, size, sourceMin, sourceMax, translation };
}

function typedArrayBytes(array) {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function align4(value) {
  return (value + 3) & ~3;
}

function packBinary(sections) {
  let byteLength = 0;
  for (const section of sections) {
    byteLength = align4(byteLength);
    section.byteOffset = byteLength;
    byteLength += section.bytes.length;
  }
  const output = Buffer.alloc(align4(byteLength));
  for (const section of sections) section.bytes.copy(output, section.byteOffset);
  return output;
}

function encodeGlb(json, bin) {
  const jsonText = JSON.stringify(json);
  const jsonLength = align4(Buffer.byteLength(jsonText));
  const jsonChunk = Buffer.alloc(jsonLength, 0x20);
  jsonChunk.write(jsonText, 0, 'utf8');
  const binLength = align4(bin.length);
  const binChunk = binLength === bin.length ? bin : Buffer.concat([bin, Buffer.alloc(binLength - bin.length)]);

  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(JSON_CHUNK, 16);
  jsonChunk.copy(output, 20);
  const binHeader = 20 + jsonChunk.length;
  output.writeUInt32LE(binChunk.length, binHeader);
  output.writeUInt32LE(BIN_CHUNK, binHeader + 4);
  binChunk.copy(output, binHeader + 8);
  return output;
}

function buildModuleGlb(module, attributes, rebasedIndices) {
  assert(module.end - module.start <= 65_535, `${module.name} exceeds UNSIGNED_SHORT index capacity`);
  const localPositions = sliceAttribute(attributes.positions, 3, module.start, module.end);
  const localNormals = sliceAttribute(attributes.normals, 3, module.start, module.end);
  const localTangents = sliceAttribute(attributes.tangents, 4, module.start, module.end);
  const localUvs = sliceAttribute(attributes.uvs, 2, module.start, module.end);
  const transformed = recenterAndGround(localPositions);
  const indices = Uint16Array.from(rebasedIndices);

  const sections = [
    { name: 'indices', bytes: typedArrayBytes(indices), target: ELEMENT_ARRAY_BUFFER },
    { name: 'positions', bytes: typedArrayBytes(transformed.positions), target: ARRAY_BUFFER },
    { name: 'normals', bytes: typedArrayBytes(localNormals), target: ARRAY_BUFFER },
    { name: 'tangents', bytes: typedArrayBytes(localTangents), target: ARRAY_BUFFER },
    { name: 'uvs', bytes: typedArrayBytes(localUvs), target: ARRAY_BUFFER },
  ];
  const bin = packBinary(sections);
  const bufferViews = sections.map((section) => ({
    buffer: 0,
    byteOffset: section.byteOffset,
    byteLength: section.bytes.length,
    target: section.target,
    name: section.name,
  }));

  const vertexCount = module.end - module.start;
  const extras = {
    author: SOURCE_PROVENANCE.author,
    license: SOURCE_PROVENANCE.license,
    source: SOURCE_PROVENANCE.source,
    title: SOURCE_PROVENANCE.title,
    sourceSha256: SOURCE_SHA256,
    module: module.name,
    modification: 'Split from the fused source mesh; recentered on local X/Z; grounded at local Y=0; converted from KHR_materials_pbrSpecularGlossiness to core metallic-roughness; shared diffuse and normal textures externalized.',
  };
  const json = {
    asset: {
      version: '2.0',
      generator: 'Under Fire split-train-track-pack.mjs',
      copyright: 'Digital Goblin, CC BY 4.0',
      extras,
    },
    scene: 0,
    scenes: [{ name: module.name, nodes: [0] }],
    nodes: [{ name: module.name, mesh: 0 }],
    meshes: [{
      name: module.name,
      extras: {
        sourceVertexRange: [module.start, module.end],
        sourceBounds: { min: transformed.sourceMin, max: transformed.sourceMax },
        appliedTranslation: transformed.translation,
        dimensions: transformed.size,
      },
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3 },
        indices: 4,
        material: 0,
        mode: TRIANGLES,
      }],
    }],
    accessors: [
      { bufferView: 1, componentType: FLOAT, count: vertexCount, type: 'VEC3', min: transformed.min, max: transformed.max },
      { bufferView: 2, componentType: FLOAT, count: vertexCount, type: 'VEC3' },
      { bufferView: 3, componentType: FLOAT, count: vertexCount, type: 'VEC4' },
      { bufferView: 4, componentType: FLOAT, count: vertexCount, type: 'VEC2' },
      { bufferView: 0, componentType: UNSIGNED_SHORT, count: indices.length, type: 'SCALAR', min: [0], max: [vertexCount - 1] },
    ],
    materials: [{
      name: 'train_track_dull_steel_and_wood',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [1, 1, 1, 1],
        baseColorTexture: { index: 0 },
        metallicFactor: 0.08,
        roughnessFactor: 0.72,
      },
      normalTexture: { index: 1 },
    }],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
    ],
    images: [
      { uri: 'textures/train_track_diffuse.png' },
      { uri: 'textures/train_track_normal.png' },
    ],
    samplers: [{ magFilter: 9_729, minFilter: 9_987, wrapS: 10_497, wrapT: 10_497 }],
    buffers: [{ byteLength: bin.length }],
    bufferViews,
  };
  return { glb: encodeGlb(json, bin), metadata: { ...transformed, vertexCount, indexCount: indices.length } };
}

function validateOutput(filePath, module, expected) {
  const buffer = fs.readFileSync(filePath);
  const document = parseGlb(buffer, module.name);
  const json = document.json;
  assert(json.asset?.extras?.author === SOURCE_PROVENANCE.author, `${module.name}: output attribution missing`);
  assert(json.asset?.extras?.license === SOURCE_PROVENANCE.license, `${module.name}: output license missing`);
  assert(!json.extensionsUsed && !json.extensionsRequired, `${module.name}: output still requires a glTF extension`);
  assert(json.nodes?.[0]?.name === module.name, `${module.name}: node name mismatch`);
  assert(json.meshes?.[0]?.name === module.name, `${module.name}: mesh name mismatch`);
  assert(json.accessors?.[0]?.count === expected.vertexCount, `${module.name}: output vertex count mismatch`);
  assert(json.accessors?.[4]?.count === expected.indexCount, `${module.name}: output index count mismatch`);
  assert(json.accessors?.[4]?.componentType === UNSIGNED_SHORT, `${module.name}: output indices are not UNSIGNED_SHORT`);
  assert(json.images?.[0]?.uri === 'textures/train_track_diffuse.png', `${module.name}: diffuse texture URI mismatch`);
  assert(json.images?.[1]?.uri === 'textures/train_track_normal.png', `${module.name}: normal texture URI mismatch`);
  assert(!json.images.some((image) => image.bufferView !== undefined), `${module.name}: output unexpectedly embeds a texture`);

  const positions = readFloatAccessor(document, 0, 'VEC3');
  const bounds = recenterAndGround(positions);
  const epsilon = 1e-4;
  for (let axis = 0; axis < 3; axis += 1) {
    assert(Math.abs(bounds.min[axis] - expected.min[axis]) < epsilon, `${module.name}: output min bound mismatch`);
    assert(Math.abs(bounds.max[axis] - expected.max[axis]) < epsilon, `${module.name}: output max bound mismatch`);
  }
  return { byteLength: buffer.length, sha256: sha256(buffer) };
}

function attributionMarkdown() {
  return `# Train Track - Modular Pack attribution

The railway assets in this directory are adapted from [“Train Track - Modular Pack”](https://sketchfab.com/3d-models/train-track-modular-pack-e662a834e5fb4b65ad4f8194f8af515b) by [Digital Goblin](https://sketchfab.com/DigitalGoblin), licensed under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).

Modifications for Under Fire: the five modules were split from the source’s fused mesh; each module was recentered on local X/Z and grounded at local Y=0; the legacy specular-glossiness material was converted to core glTF metallic-roughness; the diffuse and normal maps were externalized and shared. The original specular-glossiness map is not redistributed. No endorsement by the original author is implied.

Derived files:

- \`train_track_straight.glb\`
- \`train_track_curve_01.glb\`
- \`train_track_curve_02.glb\`
- \`train_track_curve_03.glb\`
- \`train_track_curve_04.glb\`
- \`textures/train_track_diffuse.png\`
- \`textures/train_track_normal.png\`

The original author, source URL, license, source SHA-256, and modification summary are also embedded in each GLB’s \`asset.extras\` metadata.
`;
}

function formatVector(values) {
  return `[${values.map((value) => Number(value.toFixed(4))).join(', ')}]`;
}

function main() {
  const sourcePath = path.resolve(process.argv[2] ?? DEFAULT_SOURCE);
  const outputDir = path.resolve(process.argv[3] ?? DEFAULT_OUTPUT_DIR);
  const textureDir = path.join(outputDir, 'textures');
  assert(fs.existsSync(sourcePath), `source GLB not found: ${sourcePath}`);

  const sourceBuffer = fs.readFileSync(sourcePath);
  const document = parseGlb(sourceBuffer, 'source');
  validateSource(sourceBuffer, document);

  const primitive = document.json.meshes[0].primitives[0];
  const attributes = {
    positions: readFloatAccessor(document, primitive.attributes.POSITION, 'VEC3'),
    normals: readFloatAccessor(document, primitive.attributes.NORMAL, 'VEC3'),
    tangents: readFloatAccessor(document, primitive.attributes.TANGENT, 'VEC4'),
    uvs: readFloatAccessor(document, primitive.attributes.TEXCOORD_0, 'VEC2'),
  };
  const sourceIndices = readIndexAccessor(document, primitive.indices);
  const moduleIndices = splitIndices(sourceIndices);
  const diffuse = imageBytes(document, 0, 'lambert1_diffuse.png');
  const normal = imageBytes(document, 2, 'lambert1_normal.png');

  fs.mkdirSync(textureDir, { recursive: true });
  fs.writeFileSync(path.join(textureDir, 'train_track_diffuse.png'), diffuse);
  fs.writeFileSync(path.join(textureDir, 'train_track_normal.png'), normal);

  const summaries = [];
  for (let moduleIndex = 0; moduleIndex < MODULES.length; moduleIndex += 1) {
    const module = MODULES[moduleIndex];
    const output = buildModuleGlb(module, attributes, moduleIndices[moduleIndex]);
    const filename = `train_${module.name}.glb`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, output.glb);
    const validation = validateOutput(filePath, module, output.metadata);
    summaries.push({ module, filename, ...output.metadata, ...validation });
  }
  fs.writeFileSync(path.join(outputDir, 'ATTRIBUTION.md'), attributionMarkdown(), 'utf8');

  console.log(`Validated source: ${sourcePath}`);
  console.log(`SHA-256: ${SOURCE_SHA256}`);
  console.log(`Extracted textures: ${diffuse.length} byte diffuse, ${normal.length} byte normal`);
  for (const summary of summaries) {
    console.log(
      `${summary.filename}: ${summary.vertexCount} vertices, ${summary.indexCount / 3} triangles, `
      + `${summary.byteLength} bytes, dimensions ${formatVector(summary.size)}, sha256 ${summary.sha256}`,
    );
  }
  console.log(`Attribution: ${path.join(outputDir, 'ATTRIBUTION.md')}`);
}

try {
  main();
} catch (error) {
  console.error(`split-train-track-pack: ${error.message}`);
  process.exitCode = 1;
}
