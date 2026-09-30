// Sky, sun, image-based lighting and fog.
//
//  - Physically based atmospheric sky (three's Sky shader), drawn at the far
//    plane so it never clips.
//  - The same sky is baked once into a PMREM environment map: every
//    MeshStandardMaterial gets matching reflections and ambient light, which
//    is what makes paint, chrome and glass read as real materials.
//  - A warm directional sun casts soft shadows in a box that follows the truck.
//  - Fog colour matches the horizon so distant scenery melts into haze.

import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export const ENV = {
  sunElevation: 32, // degrees above horizon
  sunAzimuth: 215, // degrees
  turbidity: 3.2,
  rayleigh: 1.6,
  mieCoefficient: 0.004,
  mieDirectionalG: 0.82,
  exposure: 0.62,
  sunIntensity: 3.2,
  sunColor: 0xfff0dc,
  hemiSky: 0xbcd6f0,
  hemiGround: 0x5d6b4a,
  hemiIntensity: 0.55,
  envIntensity: 0.9,
  haze: 0xc3d3e0, // fog colour ~ sky near the horizon
  shadowBox: 55, // half-size (m) of the shadow frustum around the truck
};

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = ENV.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    // Sun direction
    const phi = THREE.MathUtils.degToRad(90 - ENV.sunElevation);
    const theta = THREE.MathUtils.degToRad(ENV.sunAzimuth);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);

    // Sky dome
    const sky = new Sky();
    sky.scale.setScalar(1000);
    const u = sky.material.uniforms;
    u.turbidity.value = ENV.turbidity;
    u.rayleigh.value = ENV.rayleigh;
    u.mieCoefficient.value = ENV.mieCoefficient;
    u.mieDirectionalG.value = ENV.mieDirectionalG;
    u.sunPosition.value.copy(this.sunDir);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.sky = sky;
    scene.add(sky);

    // Bake the sky into an environment map for reflections / ambient.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky();
    envSky.scale.setScalar(100);
    Object.assign(envSky.material.uniforms.turbidity, { value: ENV.turbidity });
    envSky.material.uniforms.rayleigh.value = ENV.rayleigh;
    envSky.material.uniforms.mieCoefficient.value = ENV.mieCoefficient;
    envSky.material.uniforms.mieDirectionalG.value = ENV.mieDirectionalG;
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    // A dark ground hemisphere so reflections aren't lit from below.
    const ground = new THREE.Mesh(
      new THREE.SphereGeometry(50, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4a5040, side: THREE.BackSide })
    );
    envScene.add(ground);
    this.envMap = pmrem.fromScene(envScene, 0, 0.1, 200).texture;
    pmrem.dispose();
    scene.environment = this.envMap;
    scene.environmentIntensity = ENV.envIntensity;

    // Lights
    this.hemi = new THREE.HemisphereLight(ENV.hemiSky, ENV.hemiGround, ENV.hemiIntensity);
    scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(ENV.sunColor, ENV.sunIntensity);
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 3;
    const sc = sun.shadow.camera;
    sc.left = -ENV.shadowBox;
    sc.right = ENV.shadowBox;
    sc.top = ENV.shadowBox;
    sc.bottom = -ENV.shadowBox;
    sc.near = 1;
    sc.far = 400;
    this.sun = sun;
    scene.add(sun);
    scene.add(sun.target);

    scene.background = new THREE.Color(ENV.haze); // only visible if the sky is hidden
    scene.fog = new THREE.Fog(ENV.haze, 120, 520);
  }

  /** Keep sky centred on the camera and the shadow box on the truck. */
  update(camera, focusX, focusZ) {
    this.sky.position.copy(camera.position);
    // Snap the shadow camera to texel-sized steps to stop shadow shimmering.
    const texel = (ENV.shadowBox * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focusX / texel) * texel;
    const fz = Math.round(focusZ / texel) * texel;
    this.sun.position.set(fx + this.sunDir.x * 200, this.sunDir.y * 200, fz + this.sunDir.z * 200);
    this.sun.target.position.set(fx, 0, fz);
  }

  setShadows(enabled, mapSize) {
    this.sun.castShadow = enabled;
    if (enabled && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  setFogFar(far) {
    this.scene.fog.far = far;
    this.scene.fog.near = Math.min(140, far * 0.3);
  }
}
