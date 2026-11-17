/**
 * One-off asset pipeline: turns the 1M-triangle source scans into web-sized GLB files.
 *   bun run scripts/convert-models.ts "C:/path/to/modellini"
 * Reads <dir>/<Name>/base.fbx + texture_*.png, writes public/models/<name>.glb + <name>_*.jpg
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const SRC = process.argv[2] ?? 'C:/Users/poros/Desktop/modellini'
const OUT = 'public/models'
const TARGET_TRIS = 60000
mkdirSync(OUT, { recursive: true })
await MeshoptSimplifier.ready

function writeGlb(path: string, pos: Float32Array, nrm: Float32Array, uv: Float32Array, idx: Uint32Array) {
  const chunks = [pos, nrm, uv, idx].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
  let offset = 0
  const views = chunks.map((c, i) => {
    const v = { buffer: 0, byteOffset: offset, byteLength: c.byteLength, target: i === 3 ? 34963 : 34962 }
    offset += Math.ceil(c.byteLength / 4) * 4
    return v
  })
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i++) { const k = i % 3; if (pos[i] < min[k]) min[k] = pos[i]; if (pos[i] > max[k]) max[k] = pos[i] }
  const n = pos.length / 3
  const json = {
    asset: { version: '2.0', generator: 'project-chaos convert-models' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'bust' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3 }] }],
    buffers: [{ byteLength: offset }], bufferViews: views,
    accessors: [
      { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: n, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
  }
  let js = JSON.stringify(json)
  while (js.length % 4) js += ' '
  const out = new Uint8Array(12 + 8 + js.length + 8 + offset)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true)
  dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true)
  out.set(new TextEncoder().encode(js), 20)
  const b = 20 + js.length
  dv.setUint32(b, offset, true); dv.setUint32(b + 4, 0x004e4942, true)
  chunks.forEach((c, i) => out.set(c, b + 8 + views[i].byteOffset))
  writeFileSync(path, out)
}

for (const name of ['DeLux', 'Salsetta']) {
  const id = name.toLowerCase()
  const buf = readFileSync(`${SRC}/${name}/base.fbx`)
  const obj = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')
  obj.updateMatrixWorld(true)
  let mesh: THREE.Mesh | null = null
  obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh })
  if (!mesh) throw new Error(`${name}: no mesh`)
  const src = (mesh as THREE.Mesh).geometry.clone().applyMatrix4((mesh as THREE.Mesh).matrixWorld)
  for (const k of Object.keys(src.attributes)) if (!['position', 'normal', 'uv'].includes(k)) src.deleteAttribute(k)
  const g = mergeVertices(src, 1e-4)
  const P = g.attributes.position.array as Float32Array
  const N = g.attributes.normal.array as Float32Array
  const U = g.attributes.uv.array as Float32Array
  const I = new Uint32Array(g.index!.array)
  const [simplified, err] = MeshoptSimplifier.simplify(I, P, 3, TARGET_TRIS * 3, Number(process.env.ERR ?? 0.05), ['Permissive'] as never)
  // compact + normalise: feet/base at y=0, 1 unit tall
  const box = new THREE.Box3().setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute)
  const h = box.max.y - box.min.y, cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2
  const remap = new Map<number, number>()
  const pos: number[] = [], nrm: number[] = [], uv: number[] = []
  const idx = new Uint32Array(simplified.length)
  for (let i = 0; i < simplified.length; i++) {
    const v = simplified[i]
    let m = remap.get(v)
    if (m === undefined) {
      m = remap.size; remap.set(v, m)
      pos.push((P[v * 3] - cx) / h, (P[v * 3 + 1] - box.min.y) / h, (P[v * 3 + 2] - cz) / h)
      nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]); uv.push(U[v * 2], 1 - U[v * 2 + 1])
    }
    idx[i] = m
  }
  writeGlb(`${OUT}/${id}.glb`, new Float32Array(pos), new Float32Array(nrm), new Float32Array(uv), idx)
  await sharp(`${SRC}/${name}/texture_diffuse.png`).resize(1024).jpeg({ quality: 86 }).toFile(`${OUT}/${id}_diffuse.jpg`)
  await sharp(`${SRC}/${name}/texture_normal.png`).resize(1024).jpeg({ quality: 88 }).toFile(`${OUT}/${id}_normal.jpg`)
  await sharp(`${SRC}/${name}/texture_roughness.png`).resize(512).jpeg({ quality: 80 }).toFile(`${OUT}/${id}_roughness.jpg`)
  console.log(name, 'verts', I.length / 3, '→ tris', idx.length / 3, 'verts', remap.size, 'err', err.toFixed(4))
}
