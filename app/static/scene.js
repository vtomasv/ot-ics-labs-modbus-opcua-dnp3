import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const COLORS = { bg: 0x07161b, floor: 0x102a30, floorLine: 0x23464d, cyan: 0x42e5ec, cyanDeep: 0x0b7f8c, amber: 0xf2b24b, red: 0xfa5d5d, green: 0x40d49a, white: 0xe5f0ef, steel: 0x59767b, dark: 0x0a1a1f };

export class PlantScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.wrap = canvas.parentElement;
    this.level = .66;
    this.pumpEnabled = true;
    this.speed = 35;
    this.trafficSignal = 2;
    this.signCode = 0;
    this.safetyTrip = false;
    this.clock = new THREE.Clock();
    this.pointer = { down: false, x: 0, y: 0, moved: false };
    this.target = new THREE.Vector3(0, 1.32, 0);
    this.cameraState = { theta: 0.73, phi: 1.05, radius: 15.0 };
    this.cameraHome = { ...this.cameraState };
    this.pipes = [];
    this.flowParticles = [];
    this.lights = {};
    this.createRenderer();
    this.createScene();
    this.createCamera();
    this.createLights();
    this.createPlant();
    this.bindControls();
    this.resize();
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  createRenderer() {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(COLORS.bg, 1);
  }

  createScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(COLORS.bg, 12, 28);
  }

  createCamera() {
    this.camera = new THREE.PerspectiveCamera(36, 1, .1, 100);
    this.updateCamera();
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0x9ceef0, 0x09232a, 2.1));
    const key = new THREE.DirectionalLight(0xb2f6f2, 2.5); key.position.set(-5, 10, 7); this.scene.add(key);
    const fill = new THREE.PointLight(COLORS.cyan, 4, 15, 2); fill.position.set(3, 5, 1); this.scene.add(fill);
    const warm = new THREE.PointLight(COLORS.amber, 3, 10, 2); warm.position.set(-3, 2, -3); this.scene.add(warm);
  }

  mat(color, options = {}) { return new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? .62, metalness: options.metalness ?? .1, emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 0 }); }
  box(name, size, position, material, parent = this.scene, rotation = null) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.name = name; mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); parent.add(mesh); return mesh; }
  cyl(name, radius, height, position, material, parent = this.scene, radial = 20, rotation = null) { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radial), material); mesh.name = name; mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); parent.add(mesh); return mesh; }

  createPlant() {
    const ground = this.box('base', [11.5, .22, 7.7], [0, -.15, 0], this.mat(0x0b2026, { roughness: .9 }));
    const deck = this.box('deck', [10.8, .08, 7], [0, .01, 0], this.mat(0x112e35, { roughness: .78 }));
    const gridMat = new THREE.LineBasicMaterial({ color: COLORS.floorLine, transparent: true, opacity: .52 });
    for (let x = -5; x <= 5; x += 1) { const points = [new THREE.Vector3(x, .07, -3.3), new THREE.Vector3(x, .07, 3.3)]; this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMat)); }
    for (let z = -3; z <= 3; z += 1) { const points = [new THREE.Vector3(-5.2, .07, z), new THREE.Vector3(5.2, .07, z)]; this.scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), gridMat)); }

    this.createTank(-2.7, 1.15, .5);
    this.createPipeLine();
    this.createPump(1.1, .72, .25);
    this.createControlCabinet(3.2, .9, -1.55);
    this.createTrafficLight(4.15, 1.45, 1.58);
    this.createWarningSign(-.1, 2.25, 2.72);
    this.createSensor(1.95, 1.5, -1.18);
    this.createLabels();
    this.createParticles();
  }

  createTank(x, y, z) {
    const group = new THREE.Group(); group.name = 'tank-group'; group.position.set(x, 0, z); this.scene.add(group); this.tankGroup = group;
    const rimMat = this.mat(0x6c8d91, { metalness: .6, roughness: .35 });
    const bodyMat = this.mat(0x173f49, { metalness: .35, roughness: .35 });
    this.cyl('tank-body', 1.42, 2.3, [0, y, 0], bodyMat, group, 32);
    this.cyl('tank-rim', 1.5, .13, [0, y + 1.16, 0], rimMat, group, 32);
    this.cyl('tank-foot', 1.31, .13, [0, y - 1.16, 0], rimMat, group, 32);
    const cap = this.cyl('tank-liquid', 1.34, .04, [0, y + .18, 0], this.mat(COLORS.cyan, { roughness: .2, emissive: COLORS.cyanDeep, emissiveIntensity: .3 }), group, 32);
    this.liquid = cap;
    this.cyl('tank-tube', .06, 2.42, [0, y, 1.26], this.mat(0x91c5c5, { metalness: .35, roughness: .2 }), group, 12);
    for (let i = -1; i <= 1; i++) this.box('tank-band', [2.91, .045, .06], [0, y + i * .72, -1.27], this.mat(0x68bbc0, { metalness: .65, roughness: .3 }), group);
    this.cyl('tank-ladder-pole', .035, 2.6, [-.72, y, 1.33], rimMat, group, 8);
    this.cyl('tank-ladder-pole', .035, 2.6, [-1.06, y, 1.08], rimMat, group, 8, [0, .3, 0]);
    for (let i = -3; i <= 3; i++) this.box('ladder-step', [.4, .035, .035], [-.89, y + i * .32, 1.2], rimMat, group, [0, .3, 0]);
    this.tankBaseY = y;
  }

  createPipeLine() {
    const pipeMat = this.mat(0x7db9b6, { metalness: .75, roughness: .28 });
    const glowMat = this.mat(COLORS.cyan, { metalness: .15, roughness: .25, emissive: COLORS.cyanDeep, emissiveIntensity: .25 });
    this.pipeBetween('tank-outlet', new THREE.Vector3(-1.35, 1.35, .5), new THREE.Vector3(-1.35, 1.35, 1.35), pipeMat, .18);
    this.pipeBetween('pipe-to-pump', new THREE.Vector3(-1.35, 1.35, 1.35), new THREE.Vector3(1.1, .66, 1.35), pipeMat, .18);
    this.pipeBetween('pipe-riser', new THREE.Vector3(1.1, .66, 1.35), new THREE.Vector3(1.1, 1.3, 1.35), pipeMat, .18);
    this.pipeBetween('pipe-out', new THREE.Vector3(1.1, 1.3, 1.35), new THREE.Vector3(4.4, 1.3, 1.35), pipeMat, .18);
    this.pipeBetween('pipe-down', new THREE.Vector3(4.4, 1.3, 1.35), new THREE.Vector3(4.4, .4, 1.35), pipeMat, .18);
    this.pipeBetween('pipe-return', new THREE.Vector3(4.4, .4, 1.35), new THREE.Vector3(4.4, .4, -.8), pipeMat, .18);
    this.pipeBetween('pipe-feed', new THREE.Vector3(4.4, .4, -.8), new THREE.Vector3(2.5, .4, -.8), pipeMat, .18);
    this.pipeBetween('pipe-feed-up', new THREE.Vector3(2.5, .4, -.8), new THREE.Vector3(2.5, 1.1, -.8), pipeMat, .18);
    const valve = this.cyl('valve', .32, .18, [2.5, 1.1, -.8], glowMat, this.scene, 16, [Math.PI / 2, 0, 0]);
    this.box('valve-handle', [.75, .06, .08], [2.5, 1.1, -.8], this.mat(COLORS.amber, { emissive: 0x7a4312, emissiveIntensity: .5 }), this.scene, [0, .35, 0]);
  }

  pipeBetween(name, a, b, material, radius) {
    const midpoint = a.clone().add(b).multiplyScalar(.5); const direction = b.clone().sub(a); const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material); mesh.name = name; mesh.position.copy(midpoint); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); this.scene.add(mesh); this.pipes.push(mesh); return mesh;
  }

  createPump(x, y, z) {
    const group = new THREE.Group(); group.name = 'pump-group'; group.position.set(x, 0, z); this.scene.add(group); this.pumpGroup = group;
    const baseMat = this.mat(0x364c51, { metalness: .6 });
    this.box('pump-base', [1.7, .18, 1.15], [0, .13, 0], baseMat, group);
    this.box('pump-motor', [1.05, .78, .78], [0, .64, 0], this.mat(0x2e626b, { metalness: .72, roughness: .3 }), group);
    this.cyl('pump-front', .53, .3, [0, .65, .5], this.mat(0x58a0a5, { metalness: .65, roughness: .27 }), group, 24, [Math.PI / 2, 0, 0]);
    this.rotor = this.cyl('pump-rotor', .33, .035, [0, .65, .67], this.mat(COLORS.cyan, { metalness: .5, emissive: COLORS.cyanDeep, emissiveIntensity: .45 }), group, 12, [Math.PI / 2, 0, 0]);
    this.cyl('pump-shaft', .08, .34, [0, .65, .83], baseMat, group, 10, [Math.PI / 2, 0, 0]);
    this.box('pump-rack', [.11, .9, .11], [-.64, .58, -.37], baseMat, group); this.box('pump-rack', [.11, .9, .11], [.64, .58, -.37], baseMat, group);
    this.pumpY = y;
  }

  createControlCabinet(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'control-cabinet'; this.scene.add(group);
    this.box('cabinet', [1.15, 1.85, .6], [0, y, 0], this.mat(0x17363d, { metalness: .38, roughness: .48 }), group);
    this.box('cabinet-screen', [.55, .38, .025], [0, y + .33, .312], this.mat(COLORS.cyan, { emissive: COLORS.cyanDeep, emissiveIntensity: .6, roughness: .2 }), group);
    for (let i = -1; i <= 1; i++) this.cyl('cabinet-led', .035, .025, [i * .2, y - .2, .32], this.mat(i === 1 ? COLORS.amber : COLORS.green, { emissive: i === 1 ? COLORS.amber : COLORS.green, emissiveIntensity: .5 }), group, 10, [Math.PI / 2, 0, 0]);
    this.box('cabinet-foot', [1.45, .12, .78], [0, .08, 0], this.mat(0x0e2329), group);
  }

  createTrafficLight(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'traffic-light'; this.scene.add(group); this.trafficGroup = group;
    this.cyl('traffic-pole', .045, 2.2, [0, 1.1, 0], this.mat(0x70969a, { metalness: .65, roughness: .3 }), group, 10);
    this.box('traffic-housing', [.42, 1.45, .3], [0, 2.06, 0], this.mat(0x15242a, { metalness: .3 }), group);
    this.lights.red = this.cyl('red-light', .13, .035, [0, 2.52, .16], this.mat(COLORS.red, { emissive: COLORS.red, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.lights.amber = this.cyl('amber-light', .13, .035, [0, 2.06, .16], this.mat(COLORS.amber, { emissive: COLORS.amber, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.lights.green = this.cyl('green-light', .13, .035, [0, 1.60, .16], this.mat(COLORS.green, { emissive: COLORS.green, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.box('traffic-foot', [.7, .1, .7], [0, .06, 0], this.mat(0x263d42, { metalness: .45 }), group);
    this.updateTraffic(this.trafficSignal);
  }

  createWarningSign(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'warning-sign'; this.scene.add(group); this.warningGroup = group;
    const postMat = this.mat(0x77979a, { metalness: .5, roughness: .32 });
    this.cyl('sign-post', .04, 1.7, [0, .85, 0], postMat, group, 10);
    this.box('sign-board', [1.55, .85, .055], [0, 1.62, 0], this.mat(0x182b2e, { metalness: .1 }), group);
    this.cyl('sign-lamp', .09, .04, [0, 1.62, .06], this.mat(COLORS.amber, { emissive: 0xa85f10, emissiveIntensity: .9 }), group, 16, [Math.PI / 2, 0, 0]);
    const texture = this.makeSignTexture();
    const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.37, .68), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })); textMesh.position.set(0, 1.62, .041); group.add(textMesh); this.signTexture = texture;
    this.box('sign-foot', [.7, .1, .35], [0, .05, 0], this.mat(0x263d42), group);
  }

  makeSignTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e6a83f'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#142328'; ctx.lineWidth = 12; ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    ctx.fillStyle = '#142328'; ctx.textAlign = 'center'; ctx.font = '900 45px Arial'; ctx.fillText('ATENCIÓN', 256, 94); ctx.font = '700 30px Arial'; ctx.fillText('PROCESO OT', 256, 143); ctx.font = '700 23px monospace'; ctx.fillText('LAB-A / CONTROLADO', 256, 193);
    return new THREE.CanvasTexture(canvas);
  }

  createSensor(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); this.scene.add(group);
    this.box('sensor-body', [.25, .6, .25], [0, y, 0], this.mat(0x9ab5b5, { metalness: .55, roughness: .28 }), group);
    this.cyl('sensor-light', .07, .03, [0, y + .18, .14], this.mat(COLORS.cyan, { emissive: COLORS.cyan, emissiveIntensity: 1.6 }), group, 12, [Math.PI / 2, 0, 0]);
    this.box('sensor-arm', [.08, .08, .68], [0, y - .34, -.28], this.mat(0x6c8e91, { metalness: .6 }), group);
  }

  createLabels() {
    this.scene.add(this.labelSprite('TK-101', new THREE.Vector3(-2.7, 2.65, .5), COLORS.cyan, .72));
    this.scene.add(this.labelSprite('P-101', new THREE.Vector3(1.1, 1.7, .25), COLORS.amber, .58));
    this.scene.add(this.labelSprite('RTU-03', new THREE.Vector3(4.15, 3.25, 1.58), COLORS.green, .62));
  }

  labelSprite(text, position, color, scale = .7) {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 64; const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 256, 64); ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.font = '700 27px monospace'; ctx.fillText(text, 5, 37); const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false })); sprite.position.copy(position); sprite.scale.set(scale, scale * .25, 1); return sprite;
  }

  createParticles() {
    const particleMat = new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: .9 });
    const points = [
      [new THREE.Vector3(-1.35, 1.35, 1.35), new THREE.Vector3(1.1, .66, 1.35)],
      [new THREE.Vector3(1.1, 1.3, 1.35), new THREE.Vector3(4.4, 1.3, 1.35)],
      [new THREE.Vector3(4.4, .4, - .8), new THREE.Vector3(2.5, .4, -.8)],
    ];
    points.forEach(([a, b]) => { for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.055, 8, 8), particleMat); p.position.copy(a); this.scene.add(p); this.flowParticles.push({ mesh: p, a: a.clone(), b: b.clone(), offset: i / 4 }); } });
  }

  bindControls() {
    this.canvas.addEventListener('pointerdown', e => { this.pointer.down = true; this.pointer.moved = false; this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', e => { if (!this.pointer.down) return; const dx = e.clientX - this.pointer.x; const dy = e.clientY - this.pointer.y; if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true; this.cameraState.theta -= dx * .008; this.cameraState.phi = THREE.MathUtils.clamp(this.cameraState.phi + dy * .008, .58, 1.48); this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.updateCamera(); });
    this.canvas.addEventListener('pointerup', e => { this.pointer.down = false; this.canvas.releasePointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointercancel', () => { this.pointer.down = false; });
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.cameraState.radius = THREE.MathUtils.clamp(this.cameraState.radius + e.deltaY * .008, 7.2, 23); this.updateCamera(); }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetCamera());
    document.getElementById('reset-camera')?.addEventListener('click', () => this.resetCamera());
  }

  updateCamera() { const { theta, phi, radius } = this.cameraState; this.camera.position.set(this.target.x + radius * Math.sin(phi) * Math.cos(theta), this.target.y + radius * Math.cos(phi), this.target.z + radius * Math.sin(phi) * Math.sin(theta)); this.camera.lookAt(this.target); }
  resetCamera() { this.cameraState = { ...this.cameraHome }; this.updateCamera(); }
  resize() { const width = this.wrap.clientWidth || 700; const height = this.wrap.clientHeight || 450; this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }

  updateState(state = {}) {
    if (typeof state.tank_level === 'number') this.level = THREE.MathUtils.clamp(state.tank_level / 100, 0, 1);
    if (typeof state.pump_enabled === 'boolean') this.pumpEnabled = state.pump_enabled;
    if (typeof state.speed_setpoint === 'number') this.speed = state.speed_setpoint;
    if (typeof state.traffic_signal === 'number') this.updateTraffic(state.traffic_signal);
    if (typeof state.sign_code === 'number') this.updateSign(state.sign_code);
    this.safetyTrip = Boolean(state.safety_trip);
  }

  updateTraffic(code) {
    this.trafficSignal = code;
    if (!this.lights) return;
    const active = [COLORS.red, COLORS.amber, COLORS.green][code] ?? COLORS.green;
    const names = ['red', 'amber', 'green']; names.forEach((name, i) => { const on = i === code; this.lights[name].material.emissiveIntensity = on ? 2.2 : .06; this.lights[name].material.opacity = on ? 1 : .45; });
    this.lights.red.material.color.setHex(code === 0 ? COLORS.red : 0x421e23); this.lights.amber.material.color.setHex(code === 1 ? COLORS.amber : 0x4b3519); this.lights.green.material.color.setHex(code === 2 ? COLORS.green : 0x194c3d);
  }

  updateSign(code) {
    this.signCode = code;
    if (!this.warningGroup || !this.signTexture) return;
    const colors = [COLORS.green, COLORS.amber, COLORS.red, COLORS.red];
    const color = colors[code] ?? COLORS.amber;
    this.warningGroup.children.forEach(child => { if (child.name === 'sign-lamp') { child.material.color.setHex(color); child.material.emissive.setHex(color); } });
    const canvas = this.signTexture.image;
    const ctx = canvas.getContext('2d');
    const labels = ["OPERACIÓN", "MANTENIMIENTO", "DETENER", "EVACUAR"];
    ctx.fillStyle = code >= 2 ? '#f05e56' : code === 1 ? '#e6a83f' : '#43c99c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#142328'; ctx.lineWidth = 12; ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    ctx.fillStyle = '#142328'; ctx.textAlign = 'center';
    ctx.font = '900 48px Arial'; ctx.fillText(labels[code] ?? 'ATENCIÓN', 256, 100);
    ctx.font = '700 30px Arial'; ctx.fillText('PROCESO OT', 256, 150);
    ctx.font = '700 23px monospace'; ctx.fillText('LAB-A / CONTROLADO', 256, 200);
    this.signTexture.needsUpdate = true;
  }

  animate() { requestAnimationFrame(this.animate); const dt = Math.min(this.clock.getDelta(), .05); const elapsed = this.clock.elapsedTime; if (this.rotor) this.rotor.rotation.z += dt * (this.pumpEnabled ? 7 + this.speed * .1 : .15); if (this.liquid) { this.liquid.position.y = this.tankBaseY + .18 + (this.level - .5) * 1.62 + Math.sin(elapsed * 1.8) * .014; this.liquid.scale.set(1, 1, 1); } this.flowParticles.forEach(p => { const t = (elapsed * (.13 + this.speed / 500) + p.offset) % 1; p.mesh.position.lerpVectors(p.a, p.b, t); p.mesh.scale.setScalar(this.pumpEnabled ? .8 + Math.sin(elapsed * 3 + p.offset) * .2 : .25); }); if (this.warningGroup) this.warningGroup.rotation.y = Math.sin(elapsed * .5) * .02; this.renderer.render(this.scene, this.camera); }
}

export function initPlantScene(canvas) { return new PlantScene(canvas); }
