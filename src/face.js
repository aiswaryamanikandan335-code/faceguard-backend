// Face recognition for "Sign in with Face". A face photo becomes a descriptor: 128 numbers that describe the face
// (face-api.js, running on TensorFlow's WebAssembly backend, so no native build is needed on Render).
// Two photos of the same person give descriptors that are close together; different people are far apart.
// Tests (FACE_DRIVER=fake) use a stand-in that turns the photo bytes into a descriptor without any model.
const path = require('path');

// Euclidean distance below which two descriptors are taken as the same person. face-api's usual threshold is 0.6;
// 0.5 is stricter, because a wrong match here signs someone into another person's account. (Measured: the same
// person ~0.1–0.4, different people ~0.7.)
const MATCH_DISTANCE = 0.5;
// The best match must also be clearly better than the second best (two look-alike accounts → no match).
const MIN_MARGIN = 0.06;

let ready = null;
let faceapi = null;
let tf = null;

function init() {
  if (!ready) {
    ready = (async () => {
      tf = require('@tensorflow/tfjs');
      const wasm = require('@tensorflow/tfjs-backend-wasm');
      faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js');
      const wasmDir = path.join(path.dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist') + path.sep;
      wasm.setWasmPaths(wasmDir); // read from disk (passing true would make it fetch() the path, which Node refuses)
      await tf.setBackend('wasm');
      await tf.ready();
      const models = path.join(path.dirname(require.resolve('@vladmandic/face-api/package.json')), 'model');
      // The tiny detector (0.2 MB) instead of SSD MobileNet (5.6 MB): the photo is already a cropped face from the
      // app's oval, and Render's free plan has only 512 MB of memory.
      await faceapi.nets.tinyFaceDetector.loadFromDisk(models);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(models);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(models);
      console.log('[face] recognition models loaded');
    })();
    ready.catch((e) => {
      console.error('[face] could not load the models:', e.message);
      ready = null; // try again on the next request
    });
  }
  return ready;
}

/** JPEG bytes → [height, width, 3] tensor. Returns null for anything that is not a JPEG. */
function toTensor(buffer) {
  const jpeg = require('jpeg-js');
  let img;
  try {
    img = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 64 });
  } catch {
    return null;
  }
  return tf.tensor3d(img.data, [img.height, img.width, 3], 'int32');
}

/** The face descriptor (128 numbers) of the largest face in the photo, or null when no face is found. */
async function describe(buffer) {
  if (process.env.FACE_DRIVER === 'fake') return fakeDescriptor(buffer);
  await init();
  const tensor = toTensor(buffer);
  if (!tensor) return null;
  try {
    const result = await faceapi
      .detectSingleFace(tensor, new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptor();
    return result ? Array.from(result.descriptor) : null;
  } finally {
    tensor.dispose();
  }
}

function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/**
 * Finds whose face this is. candidates: [{ id, descriptor }]. Returns { id, distance } for a confident match,
 * otherwise null (no one close enough, or two accounts almost equally close).
 */
function bestMatch(descriptor, candidates) {
  let best = null;
  let second = Infinity;
  for (const c of candidates) {
    if (!c.descriptor || c.descriptor.length !== descriptor.length) continue;
    const d = distance(descriptor, c.descriptor);
    if (!best || d < best.distance) {
      if (best) second = best.distance;
      best = { id: c.id, distance: d };
    } else if (d < second) second = d;
  }
  if (!best || best.distance > MATCH_DISTANCE) return null;
  if (second - best.distance < MIN_MARGIN) return null;
  return best;
}

// Tests: the same photo bytes always give the same descriptor; different photos give far-apart ones.
function fakeDescriptor(buffer) {
  if (!buffer || buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  const crypto = require('crypto');
  const out = [];
  for (let i = 0; out.length < 128; i++) {
    for (const byte of crypto.createHash('sha256').update(buffer).update(String(i)).digest()) {
      if (out.length < 128) out.push(byte / 255 - 0.5);
    }
  }
  return out;
}

module.exports = { init, describe, bestMatch, distance, MATCH_DISTANCE };
