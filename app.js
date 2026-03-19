import * as THREE from 'https://unpkg.com/three@0.161.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js';

const gravity = 9.81;
const bridgeWidth = 4;
const deckMassPerNode = 420;
const topMassPerNode = 220;
const memberCapacity = 3.6e5;
const basePanelLength = 4;
const ui = {};

const state = {
  running: true,
  vehiclePosition: 0,
  bridge: null,
  three: null,
  lastTime: 0,
};

function cacheUi() {
  [
    'spanSegments', 'bridgeHeight', 'stiffness', 'damping', 'vehicleMass', 'vehicleSpeed', 'windForce',
    'spanSegmentsValue', 'bridgeHeightValue', 'stiffnessValue', 'dampingValue', 'vehicleMassValue',
    'vehicleSpeedValue', 'windForceValue', 'deflectionMetric', 'stressMetric', 'fosMetric', 'stateMetric',
    'vehicleMetric', 'bounceMetric', 'windMetric', 'rebuildButton', 'toggleLoadButton', 'resetViewButton',
    'sceneContainer',
  ].forEach((id) => {
    ui[id] = document.getElementById(id);
  });
}

function readControls() {
  return {
    spanSegments: Number(ui.spanSegments.value),
    bridgeHeight: Number(ui.bridgeHeight.value),
    stiffness: Number(ui.stiffness.value) * 1000,
    damping: Number(ui.damping.value),
    vehicleMass: Number(ui.vehicleMass.value),
    vehicleSpeed: Number(ui.vehicleSpeed.value),
    windForce: Number(ui.windForce.value) * 1000,
  };
}

function updateLabels(config) {
  ui.spanSegmentsValue.textContent = `${config.spanSegments} panels`;
  ui.bridgeHeightValue.textContent = `${config.bridgeHeight.toFixed(1)} m`;
  ui.stiffnessValue.textContent = `${Math.round(config.stiffness / 1000)} kN/m`;
  ui.dampingValue.textContent = config.damping.toFixed(3);
  ui.vehicleMassValue.textContent = `${config.vehicleMass.toLocaleString()} kg`;
  ui.vehicleSpeedValue.textContent = `${config.vehicleSpeed.toFixed(1)}×`;
  ui.windForceValue.textContent = `${(config.windForce / 1000).toFixed(1)} kN lateral`;
}

function initThree() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  ui.sceneContainer.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#07111d');
  scene.fog = new THREE.Fog('#07111d', 30, 140);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
  camera.position.set(26, 18, 26);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 4, 0);

  const hemi = new THREE.HemisphereLight('#d9f6ff', '#0b1220', 1.35);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight('#ffffff', 1.8);
  dir.castShadow = true;
  dir.position.set(16, 24, 10);
  dir.shadow.mapSize.set(2048, 2048);
  scene.add(dir);

  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshPhysicalMaterial({
      color: '#11385f', metalness: 0.1, roughness: 0.22, transmission: 0.08,
      transparent: true, opacity: 0.93,
    }),
  );
  river.rotation.x = -Math.PI / 2;
  river.position.y = -6;
  scene.add(river);

  const terrain = new THREE.Mesh(
    new THREE.BoxGeometry(240, 10, 240),
    new THREE.MeshStandardMaterial({ color: '#223523', roughness: 0.98 }),
  );
  terrain.position.y = -11;
  terrain.receiveShadow = true;
  scene.add(terrain);

  const group = new THREE.Group();
  scene.add(group);

  state.three = { renderer, scene, camera, controls, group, river };
  resize();
}

function createNode(x, y, z, mass, fixed = false) {
  const position = new THREE.Vector3(x, y, z);
  return {
    position,
    previous: position.clone(),
    velocity: new THREE.Vector3(),
    force: new THREE.Vector3(),
    mass,
    fixed,
    baseY: y,
  };
}

function createMember(a, b, stiffness, group, radius = 0.12) {
  const restLength = a.position.distanceTo(b.position);
  const geom = new THREE.CylinderGeometry(radius, radius, 1, 10);
  const material = new THREE.MeshStandardMaterial({ color: '#6be4ff', metalness: 0.35, roughness: 0.42, emissive: '#0d2330' });
  const mesh = new THREE.Mesh(geom, material);
  mesh.castShadow = true;
  group.add(mesh);
  return { a, b, restLength, stiffness, mesh, strain: 0, force: 0 };
}

function buildBridge() {
  const config = readControls();
  updateLabels(config);
  state.vehiclePosition = 0;
  const { group } = state.three;
  group.clear();

  const panelCount = config.spanSegments;
  const span = panelCount * basePanelLength;
  const nodes = [];
  const deck = [];
  const top = [];
  const members = [];
  const deckZ = [-bridgeWidth / 2, bridgeWidth / 2];

  for (let i = 0; i <= panelCount; i += 1) {
    const x = i * basePanelLength - span / 2;
    const fixed = i === 0 || i === panelCount;
    deckZ.forEach((z) => {
      const node = createNode(x, 0, z, deckMassPerNode, fixed);
      nodes.push(node);
      deck.push(node);
    });
    deck.push(createNode(x, 0, 0, deckMassPerNode * 1.2, fixed));
    nodes.push(deck.at(-1));

    deckZ.forEach((z) => {
      const node = createNode(x, config.bridgeHeight, z, topMassPerNode, fixed);
      nodes.push(node);
      top.push(node);
    });
  }

  const getDeck = (i, lane) => deck[i * 3 + lane];
  const getTop = (i, lane) => top[i * 2 + lane];

  for (let i = 0; i < panelCount; i += 1) {
    members.push(createMember(getDeck(i, 0), getDeck(i + 1, 0), config.stiffness, group));
    members.push(createMember(getDeck(i, 1), getDeck(i + 1, 1), config.stiffness, group));
    members.push(createMember(getDeck(i, 2), getDeck(i + 1, 2), config.stiffness * 1.3, group, 0.15));
    members.push(createMember(getTop(i, 0), getTop(i + 1, 0), config.stiffness * 0.9, group));
    members.push(createMember(getTop(i, 1), getTop(i + 1, 1), config.stiffness * 0.9, group));
    members.push(createMember(getDeck(i, 0), getTop(i, 0), config.stiffness * 0.75, group));
    members.push(createMember(getDeck(i, 1), getTop(i, 1), config.stiffness * 0.75, group));
    members.push(createMember(getDeck(i + 1, 0), getTop(i + 1, 0), config.stiffness * 0.75, group));
    members.push(createMember(getDeck(i + 1, 1), getTop(i + 1, 1), config.stiffness * 0.75, group));
    members.push(createMember(getDeck(i, 0), getTop(i + 1, 0), config.stiffness * 0.6, group));
    members.push(createMember(getDeck(i + 1, 0), getTop(i, 0), config.stiffness * 0.6, group));
    members.push(createMember(getDeck(i, 1), getTop(i + 1, 1), config.stiffness * 0.6, group));
    members.push(createMember(getDeck(i + 1, 1), getTop(i, 1), config.stiffness * 0.6, group));
    members.push(createMember(getDeck(i, 0), getDeck(i, 1), config.stiffness * 0.8, group));
    members.push(createMember(getDeck(i + 1, 0), getDeck(i + 1, 1), config.stiffness * 0.8, group));
    members.push(createMember(getTop(i, 0), getTop(i, 1), config.stiffness * 0.55, group));
    members.push(createMember(getTop(i + 1, 0), getTop(i + 1, 1), config.stiffness * 0.55, group));
    members.push(createMember(getDeck(i, 2), getDeck(i, 0), config.stiffness * 0.55, group, 0.1));
    members.push(createMember(getDeck(i, 2), getDeck(i, 1), config.stiffness * 0.55, group, 0.1));
  }

  const deckMesh = new THREE.Mesh(
    new THREE.BoxGeometry(span + 1.5, 0.5, bridgeWidth + 0.9),
    new THREE.MeshStandardMaterial({ color: '#56697c', metalness: 0.22, roughness: 0.72 }),
  );
  deckMesh.position.y = -0.35;
  deckMesh.receiveShadow = true;
  group.add(deckMesh);

  const vehicle = new THREE.Group();
  const truckBody = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.3, 1.7),
    new THREE.MeshStandardMaterial({ color: '#ffd166', metalness: 0.28, roughness: 0.4 }),
  );
  truckBody.castShadow = true;
  truckBody.position.y = 1.3;
  vehicle.add(truckBody);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 1.1, 1.6),
    new THREE.MeshStandardMaterial({ color: '#f4a261', metalness: 0.35, roughness: 0.35 }),
  );
  cabin.castShadow = true;
  cabin.position.set(1.25, 1.55, 0);
  vehicle.add(cabin);

  for (const offsetX of [-1.05, 1.05]) {
    for (const offsetZ of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.36, 0.28, 18),
        new THREE.MeshStandardMaterial({ color: '#1f2937', metalness: 0.12, roughness: 0.85 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      wheel.position.set(offsetX, 0.45, offsetZ * 0.55);
      vehicle.add(wheel);
    }
  }
  group.add(vehicle);

  const nodeSpheres = nodes.map((node) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(node.fixed ? 0.22 : 0.14, 12, 12),
      new THREE.MeshStandardMaterial({ color: node.fixed ? '#92ffba' : '#c2f7ff', metalness: 0.1, roughness: 0.45 }),
    );
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  });

  state.bridge = {
    config,
    span,
    nodes,
    members,
    vehicle,
    nodeSpheres,
    deckCenterline: Array.from({ length: panelCount + 1 }, (_, i) => getDeck(i, 2)),
  };

  resetCamera(span, config.bridgeHeight);
}

function resetCamera(span = state.bridge?.span ?? 40, height = state.bridge?.config.bridgeHeight ?? 5) {
  const { camera, controls } = state.three;
  camera.position.set(span * 0.45, height * 2.4 + 6, span * 0.26 + 10);
  controls.target.set(0, height * 0.55, 0);
  controls.update();
}

function applyLoads(dt) {
  const { nodes, deckCenterline, config, span } = state.bridge;
  nodes.forEach((node) => {
    node.force.set(0, -node.mass * gravity, 0);
    node.force.z += config.windForce * 0.03 * Math.sin(state.lastTime * 0.001 + node.position.x * 0.04);
  });

  if (state.running) {
    state.vehiclePosition = (state.vehiclePosition + dt * config.vehicleSpeed * 0.13) % 1;
  }

  const exactIndex = state.vehiclePosition * (deckCenterline.length - 1);
  const index = Math.floor(exactIndex);
  const localT = exactIndex - index;
  const a = deckCenterline[index];
  const b = deckCenterline[Math.min(index + 1, deckCenterline.length - 1)];
  const axleLoad = config.vehicleMass * gravity;
  a.force.y -= axleLoad * (1 - localT);
  b.force.y -= axleLoad * localT;

  const windState = config.windForce > 12000 ? 'High gusts' : config.windForce > 5000 ? 'Moderate crosswind' : 'Nominal';
  ui.windMetric.textContent = windState;
  ui.vehicleMetric.textContent = `${Math.round(state.vehiclePosition * 100)}%`;
}

function solveMembers() {
  let maxStress = 0;
  state.bridge.members.forEach((member) => {
    const delta = new THREE.Vector3().subVectors(member.b.position, member.a.position);
    const length = Math.max(delta.length(), 1e-6);
    const direction = delta.clone().divideScalar(length);
    const extension = length - member.restLength;
    const forceMagnitude = member.stiffness * extension;
    const force = direction.multiplyScalar(forceMagnitude);

    if (!member.a.fixed) member.a.force.add(force);
    if (!member.b.fixed) member.b.force.sub(force);

    member.strain = extension / member.restLength;
    member.force = forceMagnitude;
    const stressRatio = Math.min(Math.abs(forceMagnitude) / memberCapacity, 2);
    maxStress = Math.max(maxStress, stressRatio);

    const color = new THREE.Color();
    if (stressRatio < 0.5) {
      color.lerpColors(new THREE.Color('#6be4ff'), new THREE.Color('#ffb347'), stressRatio * 2);
    } else {
      color.lerpColors(new THREE.Color('#ffb347'), new THREE.Color('#ff5252'), (stressRatio - 0.5) * 2);
    }
    member.mesh.material.color.copy(color);
    member.mesh.material.emissive.copy(color).multiplyScalar(0.16);
  });

  return maxStress;
}

function integrate(dt) {
  const damping = state.bridge.config.damping;
  let maxDeflection = 0;
  let bounce = 0;

  state.bridge.nodes.forEach((node) => {
    if (node.fixed) {
      node.velocity.set(0, 0, 0);
      node.position.set(node.previous.x, node.baseY, node.previous.z);
      return;
    }

    const acceleration = node.force.clone().divideScalar(node.mass);
    node.velocity.addScaledVector(acceleration, dt);
    node.velocity.multiplyScalar(Math.pow(damping, dt * 60));
    node.previous.copy(node.position);
    node.position.addScaledVector(node.velocity, dt);

    maxDeflection = Math.max(maxDeflection, Math.abs(node.baseY - node.position.y));
    bounce = Math.max(bounce, Math.abs(node.velocity.y));
  });

  ui.deflectionMetric.textContent = `${maxDeflection.toFixed(2)} m`;
  ui.bounceMetric.textContent = `${bounce.toFixed(2)} m/s`;
  return { maxDeflection, bounce };
}

function updateScene(maxStress, maxDeflection) {
  const { members, nodes, vehicle, nodeSpheres, deckCenterline, config, span } = state.bridge;
  members.forEach((member) => {
    const midpoint = new THREE.Vector3().addVectors(member.a.position, member.b.position).multiplyScalar(0.5);
    const delta = new THREE.Vector3().subVectors(member.b.position, member.a.position);
    member.mesh.position.copy(midpoint);
    member.mesh.scale.set(1, delta.length(), 1);
    member.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  });

  nodes.forEach((node, index) => {
    nodeSpheres[index].position.copy(node.position);
  });

  const exactIndex = state.vehiclePosition * (deckCenterline.length - 1);
  const index = Math.floor(exactIndex);
  const localT = exactIndex - index;
  const position = deckCenterline[index].position.clone().lerp(deckCenterline[Math.min(index + 1, deckCenterline.length - 1)].position, localT);
  vehicle.position.copy(position).add(new THREE.Vector3(0, 0.1, 0));
  vehicle.rotation.y = Math.sin(state.lastTime * 0.0012) * 0.02;

  ui.stressMetric.textContent = `${Math.round(maxStress * 100)}%`;
  ui.fosMetric.textContent = maxStress > 0 ? (1 / maxStress).toFixed(2) : '∞';
  ui.stateMetric.textContent = maxStress > 1 || maxDeflection > 1.4 ? 'Critical' : maxStress > 0.72 || maxDeflection > 0.75 ? 'Oscillating' : 'Stable';

  const riverPulse = 0.015 * Math.sin(state.lastTime * 0.0008 + span * 0.01) + 0.02 * (config.windForce / 20000);
  state.three.river.material.emissive = new THREE.Color('#103c66').multiplyScalar(0.3 + riverPulse);
}

function tick(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  const deltaSeconds = Math.min((timestamp - state.lastTime) / 1000, 0.033);
  state.lastTime = timestamp;

  for (let i = 0; i < 3; i += 1) {
    applyLoads(deltaSeconds / 3);
    const maxStress = solveMembers();
    const { maxDeflection } = integrate(deltaSeconds / 3);
    updateScene(maxStress, maxDeflection);
  }

  state.three.controls.update();
  state.three.renderer.render(state.three.scene, state.three.camera);
  requestAnimationFrame(tick);
}

function resize() {
  if (!state.three) return;
  const { renderer, camera } = state.three;
  const width = ui.sceneContainer.clientWidth;
  const height = ui.sceneContainer.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function bindEvents() {
  ['spanSegments', 'bridgeHeight', 'stiffness', 'damping', 'vehicleMass', 'vehicleSpeed', 'windForce'].forEach((id) => {
    ui[id].addEventListener('input', () => updateLabels(readControls()));
  });
  ui.rebuildButton.addEventListener('click', buildBridge);
  ui.toggleLoadButton.addEventListener('click', () => {
    state.running = !state.running;
    ui.toggleLoadButton.textContent = state.running ? 'Pause Vehicle' : 'Resume Vehicle';
  });
  ui.resetViewButton.addEventListener('click', () => resetCamera());
  window.addEventListener('resize', resize);
}

cacheUi();
initThree();
bindEvents();
buildBridge();
requestAnimationFrame(tick);
