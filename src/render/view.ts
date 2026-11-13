// The card in layers, turning: the camera stays put in front of a dark backdrop, a warm key
// light from the upper left casts shadows (a shadow map of the sheets' cut shapes), a cool
// light grazes from the right, and the card turns in a figure of eight.

import * as THREE from 'three';
import { ART_BOX, CARD_MM, H, W } from '../card';
import { AO_H, AO_W, type Sheet } from '../cut/sheets';
import { backdropShader, casterShader, edgeShader, sheetShader } from './shaders';
import { cardBack, paperGrain } from './textures';

/** Millimetres in a unit of the 3D world. */
const UNIT = 10;
/** A sheet's thickness and the gap under it, in millimetres. */
export const THICKNESS_MM = 0.3;
export const GAP_MM = 0.9;
const PITCH = (THICKNESS_MM + GAP_MM) / UNIT;
const THICKNESS = THICKNESS_MM / UNIT;
/** The turn: side to side and, twice as often, up and down (degrees), once every few seconds. */
export const TURN = { yaw: 32, pitch: 10, seconds: 8 };
const FOV = 26;
const DISTANCE = 23;
const GRAIN_MM = 12;
const SHADOW_SIZE = 4096;
const SHADOW_SPAN = 13;

export const FINISHES = ['gloss', 'holo-art', 'holo'] as const;
export type Finish = (typeof FINISHES)[number];

export interface CardData {
  sheets: Sheet[];
  occlusion: Uint8Array[];
  /** The scan to print on the sheets (any size: it is stretched over the card). */
  scan: TexImageSource;
}

/** Where a point of the scan (by its texture coordinates) is on the card, in world units. */
const place = (u: number, v: number) => [((u - 0.5) * CARD_MM.x) / UNIT, ((0.5 - v) * CARD_MM.y) / UNIT] as const;

export class CardView {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 4 / 5, 5, 80);
  private readonly lightCamera = new THREE.OrthographicCamera(-SHADOW_SPAN / 2, SHADOW_SPAN / 2, SHADOW_SPAN / 2, -SHADOW_SPAN / 2, 1, 50);
  private readonly shadowTarget: THREE.WebGLRenderTarget;
  private readonly card = new THREE.Group();
  private readonly grain = paperGrain();
  private readonly back = cardBack();
  private readonly shared: Record<string, THREE.IUniform>;
  private casters: { mesh: THREE.Mesh; caster: THREE.Material }[] = [];
  private disposables: { dispose(): void }[] = [];
  private backdrop: THREE.Mesh;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000);
    this.camera.position.set(0, 0, DISTANCE);
    this.scene.add(this.camera, this.card);

    const keyDir = new THREE.Vector3(-0.35, 0.45, 0.82).normalize();
    const rimDir = new THREE.Vector3(0.9, 0.2, -0.35).normalize();
    this.lightCamera.position.copy(keyDir).multiplyScalar(25);
    this.lightCamera.lookAt(0, 0, 0);
    this.lightCamera.updateMatrixWorld();
    this.shadowTarget = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
      depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE, THREE.UnsignedIntType),
      depthBuffer: true,
    });
    const shadowMatrix = new THREE.Matrix4().multiplyMatrices(this.lightCamera.projectionMatrix, this.lightCamera.matrixWorldInverse);

    const linear = (hex: [number, number, number], energy: number) => new THREE.Vector3(...hex).multiplyScalar(energy);
    this.shared = {
      keyDir: { value: keyDir },
      keyColor: { value: linear([1, 0.95, 0.88], 1.25) },
      rimDir: { value: rimDir },
      rimColor: { value: linear([0.75, 0.85, 1], 0.45) },
      ambient: { value: linear([0.72, 0.74, 0.82], 0.35) },
      specAmount: { value: 0.5 },
      gloss: { value: 1 },
      shadowMap: { value: this.shadowTarget.depthTexture },
      shadowMatrix: { value: shadowMatrix },
      shadowTexel: { value: 1 / SHADOW_SIZE },
      aoStrength: { value: 0.75 },
      holo: { value: 0 },
      artWindow: { value: new THREE.Vector4(ART_BOX.x / W, ART_BOX.y / H, (ART_BOX.x + ART_BOX.w) / W, (ART_BOX.y + ART_BOX.h) / H) },
    };

    this.backdrop = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShaderMaterial(backdropShader));
    this.backdrop.position.z = -8;
    this.scene.add(this.backdrop);
  }

  /** Sizes the drawing buffer (CSS pixels times the pixel ratio). */
  setSize(width: number, height: number, pixelRatio: number): void {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Builds the card's sheets (and drops the previous card's). */
  show(data: CardData): void {
    this.clear();
    const scan = new THREE.Texture(data.scan);
    scan.colorSpace = THREE.SRGBColorSpace;
    scan.flipY = false;
    scan.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    scan.generateMipmaps = true;
    scan.minFilter = THREE.LinearMipmapLinearFilter;
    scan.needsUpdate = true;
    this.disposables.push(scan);

    const aoTextures = data.occlusion.map((bytes) => this.track(dataTexture(bytes, AO_W, AO_H)));
    // (each sheet's grain from its own place, as if cut from another part of the board)
    let seed = 5;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    for (const sheet of data.sheets) {
      const mask = this.track(dataTexture(sheet.mask, W, H));
      const faces = this.track(facesGeometry(sheet.bounds));
      const edges = this.track(edgesGeometry(sheet.edges));
      const grainOffset = new THREE.Vector2(random(), random());
      const caster = this.track(new THREE.ShaderMaterial({ ...casterShader, uniforms: { mask: { value: mask }, masked: { value: true } }, side: THREE.DoubleSide }));
      const edgeCaster = this.track(new THREE.ShaderMaterial({ ...casterShader, uniforms: { mask: { value: null }, masked: { value: false } }, side: THREE.DoubleSide }));
      for (const level of sheet.levels) {
        const ao = aoTextures[Math.min(level, aoTextures.length - 1)];
        const material = this.track(
          new THREE.ShaderMaterial({
            ...sheetShader,
            uniforms: {
              ...this.shared,
              ao: { value: ao },
              scan: { value: scan },
              mask: { value: mask },
              cardBack: { value: this.back },
              grain: { value: this.grain },
              grainRepeats: { value: new THREE.Vector2(CARD_MM.x / GRAIN_MM, CARD_MM.y / GRAIN_MM) },
              grainOffset: { value: grainOffset },
              grainDepth: { value: 0.12 },
              showsBack: { value: sheet.back },
              underside: { value: new THREE.Vector3(0.09, 0.085, 0.08) },
              metallic: { value: 0.45 },
              // (printed card is coated: glossy, though the paper's grain still shows)
              roughness: { value: 0.14 },
              roughnessSpread: { value: 0.04 },
              grainTone: { value: 0.05 },
            },
            alphaToCoverage: true,
          }),
        );
        const face = new THREE.Mesh(faces, material);
        face.position.z = level * PITCH;
        const edgeMaterial = this.track(
          new THREE.ShaderMaterial({
            ...edgeShader,
            uniforms: { ...this.shared, ao: { value: ao }, scan: { value: scan }, grain: { value: this.grain }, edgeShade: { value: 0.5 } },
          }),
        );
        const edge = new THREE.Mesh(edges, edgeMaterial);
        edge.position.z = level * PITCH;
        this.card.add(face, edge);
        this.casters.push({ mesh: face, caster }, { mesh: edge, caster: edgeCaster });
      }
    }
  }

  /** The printed faces' finish: plain gloss, a holo foil in the art window, or all over. */
  setFinish(finish: Finish): void {
    this.shared.holo.value = FINISHES.indexOf(finish);
  }

  get hasCard(): boolean {
    return this.casters.length > 0;
  }

  /** Turns the card (degrees). */
  pose(yaw: number, pitch: number): void {
    this.card.rotation.set(THREE.MathUtils.degToRad(pitch), THREE.MathUtils.degToRad(yaw), 0, 'YXZ');
  }

  render(): void {
    this.card.updateMatrixWorld(true);
    // the key light's shadow map: the sheets' shapes as the light sees them
    const own = this.casters.map(({ mesh }) => mesh.material as THREE.Material);
    for (const { mesh, caster } of this.casters) mesh.material = caster;
    this.backdrop.visible = false;
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.lightCamera);
    this.casters.forEach(({ mesh }, i) => (mesh.material = own[i]));
    this.backdrop.visible = true;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  private track<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private clear(): void {
    this.card.clear();
    this.casters = [];
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

/** One channel, 0-255, row 0 at the scan's top (texture coordinate v 0). */
function dataTexture(bytes: Uint8Array, w: number, h: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(bytes, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.unpackAlignment = 1;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A sheet's two faces over its box: the top (at 0, facing out) and the underside (a sheet's
 * thickness lower, facing back), with the scan's coordinates (the shader cuts them to the mask).
 */
function facesGeometry(box: { x: number; y: number; w: number; h: number }): THREE.BufferGeometry {
  const u0 = box.x / W;
  const v0 = box.y / H;
  const u1 = (box.x + box.w) / W;
  const v1 = (box.y + box.h) / H;
  const corners = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  for (const [z, nz] of [
    [0, 1],
    [-THICKNESS, -1],
  ]) {
    for (const [u, v] of corners) {
      const [x, y] = place(u, v);
      position.push(x, y, z);
      normal.push(0, 0, nz);
      uv.push(u, v);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // (counter-clockwise from the side each faces)
  geometry.setIndex([0, 3, 2, 0, 2, 1, 4, 6, 7, 4, 5, 6]);
  return geometry;
}

/** A strip down a sheet's outline, from its top to its underside, facing out of the shape. */
function edgesGeometry(edges: Float32Array): THREE.BufferGeometry {
  const count = edges.length / 6;
  const position = new Float32Array(count * 4 * 3);
  const normal = new Float32Array(count * 4 * 3);
  const uv = new Float32Array(count * 4 * 2);
  const index = new Uint32Array(count * 6);
  for (let s = 0; s < count; s++) {
    const [ax, ay, bx, by, sx, sy] = edges.subarray(s * 6, s * 6 + 6);
    const ua = (ax + 0.5) / W;
    const va = (ay + 0.5) / H;
    const ub = (bx + 0.5) / W;
    const vb = (by + 0.5) / H;
    const [pax, pay] = place(ua, va);
    const [pbx, pby] = place(ub, vb);
    const nx = sx;
    const ny = -sy;
    const verts = [
      [pax, pay, 0, ua, va],
      [pbx, pby, 0, ub, vb],
      [pbx, pby, -THICKNESS, ub, vb],
      [pax, pay, -THICKNESS, ua, va],
    ];
    verts.forEach(([x, y, z, u, v], k) => {
      const p = (s * 4 + k) * 3;
      position[p] = x;
      position[p + 1] = y;
      position[p + 2] = z;
      normal[p] = nx;
      normal[p + 1] = ny;
      normal[p + 2] = 0;
      uv[(s * 4 + k) * 2] = u;
      uv[(s * 4 + k) * 2 + 1] = v;
    });
    // a, b along the top then down is counter-clockwise from the side (b - a) x (0, 0, -1) =
    // (-ey, ex, 0) points to: keep it when that is out of the shape, else turn it round
    const ex = pbx - pax;
    const ey = pby - pay;
    const outward = -ey * nx + ex * ny > 0;
    const base = s * 4;
    const i = s * 6;
    if (outward) index.set([base, base + 1, base + 2, base, base + 2, base + 3], i);
    else index.set([base, base + 3, base + 2, base, base + 2, base + 1], i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  return geometry;
}
