// Collects many small primitives, bakes their transforms and merges them per
// material. A detailed truck built from ~150 parts renders in ~10 draw calls,
// which keeps detailed models affordable on phones.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Normalise a geometry so all parts can be merged (non-indexed, pos/normal/uv only). */
function prep(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes.position.count) * 2), 2));
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

export class PartBuilder {
  constructor() {
    this.buckets = new Map(); // material -> geometries
  }

  /**
   * Add a geometry with a transform.
   * @param {THREE.BufferGeometry} geo
   * @param {THREE.Material} mat
   * @param {number[]} pos [x, y, z]
   * @param {number[]} [rot] euler [x, y, z]
   * @param {number[]} [scale]
   */
  add(geo, mat, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
    const g = prep(geo);
    _e.set(rot[0], rot[1], rot[2]);
    _q.setFromEuler(_e);
    _p.set(pos[0], pos[1], pos[2]);
    _s.set(scale[0], scale[1], scale[2]);
    _m.compose(_p, _q, _s);
    g.applyMatrix4(_m);
    if (!this.buckets.has(mat)) this.buckets.set(mat, []);
    this.buckets.get(mat).push(g);
    return this;
  }

  box(w, h, d, mat, pos, rot) {
    return this.add(new THREE.BoxGeometry(w, h, d), mat, pos, rot);
  }

  /**
   * Rounded box. Either rbox(w, h, d, radius, mat, pos, rot, seg) or, with the
   * radius omitted, rbox(w, h, d, mat, pos, rot, seg) using a proportional radius.
   */
  rbox(w, h, d, ...rest) {
    let r;
    let mat;
    let pos;
    let rot;
    let seg;
    if (typeof rest[0] === 'number') [r, mat, pos, rot, seg] = rest;
    else {
      [mat, pos, rot, seg] = rest;
      r = Math.min(w, h, d) * 0.3;
    }
    // Radius must stay below half the smallest side or the geometry degenerates.
    r = Math.max(0.001, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
    return this.add(new RoundedBoxGeometry(w, h, d, seg || 2, r), mat, pos, rot);
  }

  /** Cylinder along an axis: 'x' | 'y' | 'z'. */
  cyl(r, len, mat, pos, axis = 'y', seg = 12, r2 = r) {
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.add(new THREE.CylinderGeometry(r2, r, len, seg), mat, pos, rot);
  }

  /** Merge buckets into meshes and add them to `parent`. Returns the meshes. */
  build(parent, { castShadow = true, receiveShadow = true } = {}) {
    const meshes = [];
    for (const [mat, geos] of this.buckets) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.buckets.clear();
    return meshes;
  }
}

/** Lathe geometry around the X axis (for wheels, tanks). Profile points are [radius, x]. */
export function latheX(profile, segments = 20) {
  const pts = profile.map(([r, x]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X
  return g;
}
