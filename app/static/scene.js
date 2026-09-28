import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const COLORS = { bg: 0xe9eff5, floor: 0xd6e0e8, floorLine: 0xc6d3df, cyan: 0x326f9e, cyanDeep: 0x164b75, amber: 0xb87e32, red: 0xc34a41, green: 0x287657, white: 0xf7fafc, steel: 0x9dadba, dark: 0x24394c };

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
    this.flowClock = 0;
    this.pointer = { down: false, x: 0, y: 0, moved: false };
    this.target = new THREE.Vector3(0, 1.22, 0);
    this.homeTarget = this.target.clone();
    this.focused = false;
    this.cameraState = { theta: 0.76, phi: 1.03, radius: 14.6 };
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
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb6c5d2, 2.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-5, 11, 7); this.scene.add(key);
    const fill = new THREE.PointLight(0xc7def5, 1.5, 17, 2); fill.position.set(4, 6, 2); this.scene.add(fill);
    const warm = new THREE.PointLight(0xffedd8, .85, 14, 2); warm.position.set(-3, 4, -4); this.scene.add(warm);
  }

  mat(color, options = {}) { return new THREE.MeshStandardMaterial({ color, roughness: options.roughness ?? .56, metalness: options.metalness ?? .25, emissive: options.emissive ?? 0x000000, emissiveIntensity: options.emissiveIntensity ?? 0, transparent: options.transparent ?? false, opacity: options.opacity ?? 1 }); }
  box(name, size, position, material, parent = this.scene, rotation = null) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material); mesh.name = name; mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); parent.add(mesh); return mesh; }
  cyl(name, radius, height, position, material, parent = this.scene, radial = 20, rotation = null) { const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radial), material); mesh.name = name; mesh.position.set(...position); if (rotation) mesh.rotation.set(...rotation); parent.add(mesh); return mesh; }

  createPlant() {
    this.box('base', [11.5, .22, 7.7], [0, -.15, 0], this.mat(0xb5c2ce, { roughness: .86 }));
    this.box('deck', [10.8, .08, 7], [0, .01, 0], this.mat(COLORS.floor, { roughness: .88 }));
    const gridMat = new THREE.LineBasicMaterial({ color: COLORS.floorLine, transparent: true, opacity: .68 });
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
    const rimMat = this.mat(0xc5d2dc, { metalness: .62, roughness: .3 });
    const bodyMat = this.mat(0x93aaba, { metalness: .54, roughness: .39 });
    this.cyl('tank-body', 1.42, 2.3, [0, y, 0], bodyMat, group, 32);
    this.cyl('tank-rim', 1.5, .13, [0, y + 1.16, 0], rimMat, group, 32);
    this.cyl('tank-foot', 1.31, .13, [0, y - 1.16, 0], rimMat, group, 32);
    const cap = this.cyl('tank-liquid', 1.34, .04, [0, y + .18, 0], this.mat(0x80b2ce, { roughness: .23, metalness: .1 }), group, 32);
    this.liquid = cap;
    this.cyl('tank-tube', .06, 2.42, [0, y, 1.26], this.mat(0xd8e4ec, { metalness: .45, roughness: .25 }), group, 12);
    for (let i = -1; i <= 1; i++) this.box('tank-band', [2.91, .045, .06], [0, y + i * .72, -1.27], this.mat(0xb3c8d5, { metalness: .68, roughness: .3 }), group);
    this.cyl('tank-ladder-pole', .035, 2.6, [-.72, y, 1.33], rimMat, group, 8);
    this.cyl('tank-ladder-pole', .035, 2.6, [-1.06, y, 1.08], rimMat, group, 8, [0, .3, 0]);
    for (let i = -3; i <= 3; i++) this.box('ladder-step', [.4, .035, .035], [-.89, y + i * .32, 1.2], rimMat, group, [0, .3, 0]);
    this.tankBaseY = y;
  }

  createPipeLine() {
    const pipeMat = this.mat(0x7d9db5, { metalness: .72, roughness: .32 });
    const elbowMat = this.mat(0x8ba9bf, { metalness: .58, roughness: .4 });
    // Hydraulically coherent end-suction arrangement: tank -> axial inlet,
    // volute discharge -> elevated process outlet. No fictitious return loop.
    const suction = [[-1.32,.78,.5],[-.92,.78,.5],[-.92,.78,.25],[-.18,.78,.25]];
    const discharge = [[.55,1.48,.25],[.55,1.84,.25],[4.45,1.84,.25],[4.45,.62,.25],[5.05,.62,.25]];
    for (const [label, route] of [['suction', suction], ['discharge', discharge]]) {
      for (let i = 0; i < route.length - 1; i++) {
        this.pipeBetween(`${label}-${i}`, new THREE.Vector3(...route[i]), new THREE.Vector3(...route[i + 1]), pipeMat, label === 'suction' ? .18 : .15);
        if (i > 0) { const elbow = new THREE.Mesh(new THREE.SphereGeometry(label === 'suction' ? .18 : .15, 16, 12), elbowMat); elbow.position.set(...route[i]); this.scene.add(elbow); }
      }
    }
    this.flange('tank-outlet-flange', [-1.27,.78,.5], [0,0,Math.PI/2], .27);
    this.flange('process-outlet-flange', [5.04,.62,.25], [0,0,Math.PI/2], .24);
    // A hand-operated valve and pressure gauge belong on the discharge run.
    this.cyl('valve-body', .25, .31, [2.55,1.84,.25], this.mat(0x5c81a5, { metalness: .5 }), this.scene, 24, [0,0,Math.PI/2]);
    this.cyl('valve-stem', .035, .43, [2.55,2.09,.25], this.mat(0x99aeba, { metalness: .76 }), this.scene, 12);
    const handwheel = new THREE.Mesh(new THREE.TorusGeometry(.22,.035,10,28), this.mat(0x2d5a83, { metalness: .45 })); handwheel.position.set(2.55,2.28,.25); handwheel.rotation.x = Math.PI/2; this.scene.add(handwheel);
    this.cyl('gauge-tap', .045, .22, [1.82,2.0,.25], pipeMat, this.scene, 12);
    this.cyl('pressure-gauge-case', .22, .1, [1.82,2.18,.43], this.mat(0x718392, { metalness: .65 }), this.scene, 30, [Math.PI/2,0,0]);
    this.cyl('pressure-gauge-dial', .185, .102, [1.82,2.18,.495], this.mat(0xfafaf6, { metalness: .05 }), this.scene, 30, [Math.PI/2,0,0]);
    this.box('pressure-gauge-needle', [.16,.018,.016], [1.86,2.2,.55], this.mat(0x8f3233), this.scene, [0,0,.56]);
  }

  pipeBetween(name, a, b, material, radius) {
    const midpoint = a.clone().add(b).multiplyScalar(.5); const direction = b.clone().sub(a); const length = direction.length();
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material); mesh.name = name; mesh.position.copy(midpoint); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); this.scene.add(mesh); this.pipes.push(mesh); return mesh;
  }

  flange(name, position, rotation, radius, parent = this.scene) {
    const assembly = new THREE.Group(); assembly.name = name; assembly.position.set(...position); assembly.rotation.set(...rotation); parent.add(assembly);
    const metal = this.mat(0x9bb0bf, { metalness: .72, roughness: .3 });
    const boltMetal = this.mat(0x586b79, { metalness: .82, roughness: .27 });
    this.cyl(`${name}-ring`, radius, .085, [0,0,0], metal, assembly, 28);
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8; this.cyl(`${name}-bolt`, .022, .11, [Math.cos(a)*radius*.78, .004, Math.sin(a)*radius*.78], boltMetal, assembly, 8); }
    return assembly;
  }

  createPump(x, y, z) {
    const group = new THREE.Group(); group.name = 'pump-group'; group.position.set(x, 0, z); this.scene.add(group); this.pumpGroup = group;
    const cast = this.mat(0x315f91, { metalness: .53, roughness: .4 });
    const motorBlue = this.mat(0x285387, { metalness: .55, roughness: .33 });
    const ribBlue = this.mat(0x214778, { metalness: .56, roughness: .42 });
    const baseMat = this.mat(0x687d90, { metalness: .64, roughness: .37 });
    const chrome = this.mat(0xb7c5cf, { metalness: .85, roughness: .25 });
    // Steel skid rails, anchor points and two independent equipment feet.
    this.box('pump-baseplate', [2.95,.14,1.35], [0,.17,0], baseMat, group);
    for (const zRail of [-.52,.52]) this.box('skid-rail', [2.8,.13,.14], [0,.08,zRail], baseMat, group);
    for (const px of [-1.24,1.24]) for (const pz of [-.48,.48]) this.cyl('anchor-bolt', .045,.035,[px,.25,pz], chrome, group, 10);
    this.box('pump-foot', [.66,.24,.72], [-.55,.36,0], cast, group);
    for (const px of [.42,1.02]) this.box('motor-foot', [.18,.24,.66], [px,.37,0], motorBlue, group);
    // End-suction cast volute: front cover, joint flange and eight cover bolts.
    this.cyl('volute-casing', .49,.4,[-.56,.78,0],cast,group,40,[Math.PI/2,0,0]);
    this.cyl('volute-cover', .36,.045,[-.56,.78,.225],this.mat(0x4776a1,{metalness:.56,roughness:.37}),group,40,[Math.PI/2,0,0]);
    const voluteRim = new THREE.Mesh(new THREE.TorusGeometry(.4,.047,10,42), chrome); voluteRim.position.set(-.56,.78,.24); group.add(voluteRim);
    for (let i=0;i<8;i++) { const a=i*TAU/8; this.cyl('volute-cover-bolt',.029,.035,[-.56+Math.cos(a)*.32,.78+Math.sin(a)*.32,.27],chrome,group,8,[Math.PI/2,0,0]); }
    this.cyl('suction-neck', .19,.53,[-1.05,.78,0],cast,group,24,[0,0,Math.PI/2]);
    this.flange('suction-flange',[-1.28,.78,0],[0,0,Math.PI/2],.275,group);
    this.cyl('discharge-neck', .17,.46,[-.55,1.26,0],cast,group,24);
    this.flange('discharge-flange',[-.55,1.48,0],[0,0,0],.255,group);
    // TEFC electric motor: axial cylindrical shell with cooling fins,
    // terminal box, steel shaft, guarded coupling and external fan guard.
    this.cyl('motor-stator', .36,1.14,[.7,.76,0],motorBlue,group,40,[0,0,Math.PI/2]);
    for (let i=0;i<14;i++) {
      const a=i*TAU/14;
      this.box('motor-cooling-fin',[1.02,.055,.075],[.7,.76+Math.cos(a)*.36,Math.sin(a)*.36],ribBlue,group,[a,0,0]);
    }
    for (const mx of [.18,1.21]) this.cyl('motor-endcap',.38,.08,[mx,.76,0],cast,group,36,[0,0,Math.PI/2]);
    this.box('motor-terminal-box',[.46,.2,.52],[.7,1.22,0],cast,group);
    this.box('motor-nameplate',[.44,.14,.018],[.76,.82,.394],this.mat(0xe5edf3,{metalness:.32}),group);
    this.cyl('shaft',.075,.5,[-.03,.76,0],chrome,group,16,[0,0,Math.PI/2]);
    this.cyl('coupling',.18,.2,[-.04,.76,0],this.mat(0x647887,{metalness:.74}),group,20,[0,0,Math.PI/2]);
    this.box('coupling-guard',[.47,.43,.53],[-.035,.78,0],this.mat(0x8ea6b6,{metalness:.45,roughness:.36,transparent:true,opacity:.48}),group);
    this.cyl('fan-shroud',.41,.17,[1.34,.76,0],motorBlue,group,36,[0,0,Math.PI/2]);
    this.rotor = new THREE.Group(); this.rotor.name='motor-fan-rotor'; this.rotor.position.set(1.445,.76,0); group.add(this.rotor);
    for (let i=0;i<5;i++) { const a=i*TAU/5; this.box('fan-blade',[.025,.22,.075],[0,Math.cos(a)*.2,Math.sin(a)*.2],this.mat(0x8aa5b6,{metalness:.52}),this.rotor,[a,0,0]); }
    this.cyl('fan-hub',.065,.04,[0,0,0],chrome,this.rotor,16,[0,0,Math.PI/2]);
    for (const radius of [.16,.28,.36]) { const grill = new THREE.Mesh(new THREE.TorusGeometry(radius,.012,6,36),chrome); grill.rotation.y=Math.PI/2; grill.position.set(1.49,.76,0); group.add(grill); }
    for (let i=0;i<8;i++) { const a=i*TAU/8; this.box('fan-guard-spoke',[.018,.025,.71],[1.49,.76,0],chrome,group,[a,0,0]); }
    this.pumpY = y;
  }

  createControlCabinet(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'control-cabinet'; this.scene.add(group);
    this.box('cabinet', [1.15, 1.85, .6], [0, y, 0], this.mat(0x8b9eaa, { metalness: .52, roughness: .45 }), group);
    this.box('cabinet-door', [.98,1.65,.025], [0,y,.31], this.mat(0xbdcbd4,{metalness:.44}),group);
    this.box('cabinet-screen', [.55, .38, .027], [0, y + .33, .331], this.mat(0x315e7d, { emissive: 0x123b59, emissiveIntensity: .25, roughness: .23 }), group);
    for (let i = -1; i <= 1; i++) this.cyl('cabinet-led', .035, .025, [i * .2, y - .2, .35], this.mat(i === 1 ? COLORS.amber : COLORS.green, { emissive: i === 1 ? COLORS.amber : COLORS.green, emissiveIntensity: .28 }), group, 10, [Math.PI / 2, 0, 0]);
    this.box('cabinet-foot', [1.45, .12, .78], [0, .08, 0], this.mat(0x6c7f8d,{metalness:.5}), group);
  }

  createTrafficLight(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'traffic-light'; this.scene.add(group); this.trafficGroup = group;
    this.cyl('traffic-pole', .045, 2.2, [0, 1.1, 0], this.mat(0x8494a2, { metalness: .65, roughness: .3 }), group, 10);
    this.box('traffic-housing', [.42, 1.45, .3], [0, 2.06, 0], this.mat(0x344a5a, { metalness: .38 }), group);
    this.lights.red = this.cyl('red-light', .13, .035, [0, 2.52, .16], this.mat(COLORS.red, { emissive: COLORS.red, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.lights.amber = this.cyl('amber-light', .13, .035, [0, 2.06, .16], this.mat(COLORS.amber, { emissive: COLORS.amber, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.lights.green = this.cyl('green-light', .13, .035, [0, 1.60, .16], this.mat(COLORS.green, { emissive: COLORS.green, emissiveIntensity: 2 }), group, 18, [Math.PI / 2, 0, 0]);
    this.box('traffic-foot', [.7, .1, .7], [0, .06, 0], this.mat(0x82919f, { metalness: .48 }), group);
    this.updateTraffic(this.trafficSignal);
  }

  createWarningSign(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); group.name = 'warning-sign'; this.scene.add(group); this.warningGroup = group;
    const postMat = this.mat(0x8fa2ae, { metalness: .56, roughness: .32 });
    this.cyl('sign-post', .04, 1.7, [0, .85, 0], postMat, group, 10);
    this.box('sign-board', [1.55, .85, .055], [0, 1.62, 0], this.mat(0x556b7c, { metalness: .3 }), group);
    this.cyl('sign-lamp', .09, .04, [0, 1.62, .06], this.mat(COLORS.amber, { emissive: 0xa85f10, emissiveIntensity: .9 }), group, 16, [Math.PI / 2, 0, 0]);
    const texture = this.makeSignTexture();
    const textMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.37, .68), new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })); textMesh.position.set(0, 1.62, .041); group.add(textMesh); this.signTexture = texture;
    this.box('sign-foot', [.7, .1, .35], [0, .05, 0], this.mat(0x82919f), group);
  }

  makeSignTexture() {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256; const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e6a83f'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#142328'; ctx.lineWidth = 12; ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
    ctx.fillStyle = '#142328'; ctx.textAlign = 'center'; ctx.font = '900 45px Arial'; ctx.fillText('ATENCIÓN', 256, 94); ctx.font = '700 30px Arial'; ctx.fillText('PROCESO OT', 256, 143); ctx.font = '700 23px monospace'; ctx.fillText('LAB-A / CONTROLADO', 256, 193);
    return new THREE.CanvasTexture(canvas);
  }

  createSensor(x, y, z) {
    const group = new THREE.Group(); group.position.set(x, 0, z); this.scene.add(group);
    this.box('sensor-body', [.25, .6, .25], [0, y, 0], this.mat(0xa9bac6, { metalness: .59, roughness: .28 }), group);
    this.cyl('sensor-light', .07, .03, [0, y + .18, .14], this.mat(COLORS.cyan, { emissive: COLORS.cyan, emissiveIntensity: .35 }), group, 12, [Math.PI / 2, 0, 0]);
    this.box('sensor-arm', [.08, .08, .68], [0, y - .34, -.28], this.mat(0x7b91a1, { metalness: .6 }), group);
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
    const particleMat = new THREE.MeshBasicMaterial({ color: 0x2f81b6, transparent: true, opacity: .75 });
    const points = [
      [new THREE.Vector3(-.92, .78, .25), new THREE.Vector3(-.18, .78, .25)],
      [new THREE.Vector3(.55, 1.84, .25), new THREE.Vector3(2.38, 1.84, .25)],
      [new THREE.Vector3(2.7, 1.84, .25), new THREE.Vector3(4.37, 1.84, .25)],
    ];
    points.forEach(([a, b]) => { for (let i = 0; i < 4; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(.038, 8, 8), particleMat); p.position.copy(a); this.scene.add(p); this.flowParticles.push({ mesh: p, a: a.clone(), b: b.clone(), offset: i / 4 }); } });
  }

  bindControls() {
    this.canvas.addEventListener('pointerdown', e => { this.pointer.down = true; this.pointer.moved = false; this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.canvas.setPointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointermove', e => { if (!this.pointer.down) return; const dx = e.clientX - this.pointer.x; const dy = e.clientY - this.pointer.y; if (Math.abs(dx) + Math.abs(dy) > 2) this.pointer.moved = true; this.cameraState.theta -= dx * .008; this.cameraState.phi = THREE.MathUtils.clamp(this.cameraState.phi + dy * .008, .58, 1.48); this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.updateCamera(); });
    this.canvas.addEventListener('pointerup', e => { this.pointer.down = false; this.canvas.releasePointerCapture?.(e.pointerId); });
    this.canvas.addEventListener('pointercancel', () => { this.pointer.down = false; });
    this.canvas.addEventListener('wheel', e => { e.preventDefault(); this.cameraState.radius = THREE.MathUtils.clamp(this.cameraState.radius + e.deltaY * .008, 7.2, 23); this.updateCamera(); }, { passive: false });
    this.canvas.addEventListener('dblclick', () => this.resetCamera());
    document.getElementById('reset-camera')?.addEventListener('click', () => this.resetCamera());
    document.getElementById('focus-pump')?.addEventListener('click', () => this.focusPump());
  }

  updateCamera() { const { theta, phi, radius } = this.cameraState; this.camera.position.set(this.target.x + radius * Math.sin(phi) * Math.cos(theta), this.target.y + radius * Math.cos(phi), this.target.z + radius * Math.sin(phi) * Math.sin(theta)); this.camera.lookAt(this.target); }
  focusPump() {
    if (this.focused) { this.resetCamera(); return; }
    this.focused = true;
    this.target.set(1.1, .9, .25);
    this.cameraState = { theta: 1.25, phi: 1.08, radius: 6.2 };
    this.updateCamera();
    const button = document.getElementById('focus-pump');
    button?.setAttribute('aria-pressed', 'true');
    if (button) button.textContent = 'Vista general';
    const note = document.getElementById('scene-ident'); if (note) note.hidden = false;
  }
  resetCamera() {
    this.focused = false;
    this.target.copy(this.homeTarget);
    this.cameraState = { ...this.cameraHome };
    this.updateCamera();
    const button = document.getElementById('focus-pump');
    button?.setAttribute('aria-pressed', 'false');
    if (button) button.textContent = 'Inspeccionar P-101';
    const note = document.getElementById('scene-ident'); if (note) note.hidden = true;
  }
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
    const names = ['red', 'amber', 'green']; names.forEach((name, i) => { const on = i === code; this.lights[name].material.emissiveIntensity = on ? 1.1 : .025; });
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

  animate() {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), .05);
    const elapsed = this.clock.elapsedTime;
    if (this.rotor && this.pumpEnabled && this.speed > 0) this.rotor.rotation.x += dt * (4 + this.speed * .13);
    if (this.liquid) this.liquid.position.y = this.tankBaseY + .18 + (this.level - .5) * 1.62 + Math.sin(elapsed * 1.8) * .014;
    if (this.pumpEnabled && this.speed > 0) this.flowClock += dt;
    this.flowParticles.forEach(p => {
      p.mesh.visible = this.pumpEnabled && this.speed > 0;
      const t = (this.flowClock * (.13 + this.speed / 500) + p.offset) % 1;
      p.mesh.position.lerpVectors(p.a, p.b, t);
    });
    this.renderer.render(this.scene, this.camera);
  }
}

export function initPlantScene(canvas) { return new PlantScene(canvas); }
