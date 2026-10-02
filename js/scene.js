import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const LAYER_Z = { web: -0.9, app: -0.2, spring: 0.45, db: 1.05, out: 1.75 };
const LAYER_COLOR = {
  web: 0x7eb6ff,
  app: 0xb794f6,
  spring: 0xf0b429,
  db: 0x2fd3c5,
  out: 0xff8b6a,
};
const LAYER_NAME = {
  web: "화면",
  app: "우리 서버",
  spring: "스프링",
  db: "우리 DB",
  out: "외부 서비스",
};
const TONES = {
  work: 0xf0b429,
  ok: 0x2fd3c5,
  danger: 0xff6d7a,
};

function shapeMesh(shape) {
  const geo = {
    sphere: new THREE.SphereGeometry(0.5, 28, 18),
    box: new THREE.BoxGeometry(0.86, 0.62, 0.86),
    cylinder: new THREE.CylinderGeometry(0.46, 0.46, 0.56, 24),
    octa: new THREE.OctahedronGeometry(0.52),
    torus: new THREE.TorusGeometry(0.38, 0.12, 16, 40),
    cone: new THREE.ConeGeometry(0.42, 0.72, 22),
  }[shape] || new THREE.BoxGeometry(0.8, 0.6, 0.8);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x243044,
    emissive: 0x101722,
    roughness: 0.42,
    metalness: 0.18,
  });
  return new THREE.Mesh(geo, mat);
}

export function createStage(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b14);
  scene.fog = new THREE.Fog(0x070b14, 16, 38);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.inset = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 4;
  controls.maxDistance = 42;
  controls.target.set(0, 0.35, 0);

  scene.add(new THREE.AmbientLight(0xc5d4ea, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(6, 10, 8);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7eb6ff, 0.55);
  fill.position.set(-8, 4, -6);
  scene.add(fill);

  const grid = new THREE.GridHelper(36, 28, 0x1c2838, 0x121a28);
  grid.position.y = -0.72;
  scene.add(grid);

  const legend = document.createElement("div");
  legend.className = "legend";
  container.appendChild(legend);

  const root = new THREE.Group();
  scene.add(root);

  const packet = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf0b429,
      emissive: 0xf0b429,
      emissiveIntensity: 0.85,
      roughness: 0.25,
    })
  );
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf0b429, transparent: true, opacity: 0.28 })
  );
  packet.add(glow);
  scene.add(packet);
  const packetLight = new THREE.PointLight(0xf0b429, 8, 6);
  packet.add(packetLight);

  const echo = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff6d7a })
  );
  echo.visible = false;
  scene.add(echo);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let stations = [];
  let curves = [];
  let segments = [];
  let lanes = [];
  let shown = 0;
  let target = 0;
  let tone = "work";
  let echoJob = null;
  let onPick = () => {};
  let defaultPos = new THREE.Vector3(4, 7, 12);
  const defaultTarget = new THREE.Vector3(0, 0.35, 0);

  function clearRoot() {
    stations.forEach((st) => st.el.remove());
    while (root.children.length) {
      const child = root.children.pop();
      child.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    }
    stations = [];
    curves = [];
    segments = [];
    lanes = [];
  }

  function layout(steps) {
    const gap = 2.28;
    const start = -((steps.length - 1) * gap) / 2;
    return steps.map((step, i) => new THREE.Vector3(
      start + i * gap,
      0.15 + Math.sin(i * 0.85) * 0.18,
      LAYER_Z[step.layer] ?? 0
    ));
  }

  function frame() {
    const box = new THREE.Box3();
    stations.forEach((st) => box.expandByPoint(st.pos));
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const fit = Math.max(size.x, size.z, 4) * 1.55;
    center.y += 0.45;
    defaultTarget.copy(center);
    controls.target.copy(center);
    defaultPos = new THREE.Vector3(center.x + fit * 0.04, center.y + fit * 0.5, center.z + fit * 1.12);
    camera.position.copy(defaultPos);
    controls.update();
  }

  function setScenario(steps) {
    clearRoot();
    legend.replaceChildren();
    const points = layout(steps);
    const used = [];
    points.forEach((pos, i) => {
      const step = steps[i];
      const layer = LAYER_Z[step.layer] != null ? step.layer : "app";
      if (!used.includes(layer)) used.push(layer);
      const mesh = shapeMesh(step.shape);
      mesh.position.copy(pos);
      mesh.userData.index = i;
      mesh.userData.layer = layer;
      const pad = new THREE.Mesh(
        new THREE.CircleGeometry(0.46, 24),
        new THREE.MeshBasicMaterial({ color: LAYER_COLOR[layer], transparent: true, opacity: 0.22 })
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(pos.x, -0.7, pos.z);
      const el = document.createElement("div");
      el.className = `pin is-future lane-${layer}`;
      el.innerHTML = `<b>${step.name}</b><span>${step.sub}</span>`;
      const label = new CSS2DObject(el);
      label.position.set(0, 0.55, 0);
      mesh.add(label);
      root.add(mesh);
      root.add(pad);
      stations.push({ mesh, pad, el, pos, layer });
    });

    const span = Math.max(1, points.length - 1) * 2.28;
    const midX = points.reduce((sum, p) => sum + p.x, 0) / Math.max(points.length, 1);
    used.forEach((layer) => {
      const lane = new THREE.Mesh(
        new THREE.BoxGeometry(span + 2.2, 0.025, 1.05),
        new THREE.MeshBasicMaterial({ color: LAYER_COLOR[layer], transparent: true, opacity: 0.16 })
      );
      lane.position.set(midX, -0.69, LAYER_Z[layer]);
      root.add(lane);
      const chip = document.createElement("span");
      chip.className = `lane-${layer}`;
      chip.innerHTML = `<i></i>${LAYER_NAME[layer]}`;
      legend.appendChild(chip);
      lanes.push({ layer, chip });
    });

    for (let i = 0; i < points.length - 1; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const mid = a.clone().lerp(b, 0.5);
      mid.y += 0.55;
      const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
      const geo = new THREE.TubeGeometry(curve, 24, 0.03, 8, false);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x31445d,
        emissive: 0x0c121c,
        roughness: 0.45,
      });
      const tube = new THREE.Mesh(geo, mat);
      root.add(tube);
      curves.push(curve);
      segments.push(tube);
    }
    shown = 0;
    target = 0;
    echoJob = null;
    echo.visible = false;
    frame();
    paint();
    placePacket(0);
  }

  function sample(t) {
    if (!stations.length) return new THREE.Vector3();
    if (!curves.length) return stations[0].pos.clone();
    const max = curves.length;
    const clamped = Math.min(Math.max(t, 0), max);
    const i = Math.min(max - 1, Math.floor(clamped));
    const u = clamped >= max ? 1 : clamped - i;
    return curves[i].getPoint(u);
  }

  function placePacket(t) {
    const p = sample(t);
    packet.position.copy(p);
  }

  function paint() {
    const color = TONES[tone] || TONES.work;
    packet.material.color.setHex(color);
    packet.material.emissive.setHex(color);
    glow.material.color.setHex(color);
    packetLight.color.setHex(color);
    stations.forEach((st, i) => {
      const mat = st.mesh.material;
      const future = i > Math.round(target);
      const now = i === Math.round(target);
      const lane = LAYER_COLOR[st.layer] || 0x243044;
      mat.color.setHex(lane);
      mat.emissive.setHex(now ? color : lane);
      mat.emissiveIntensity = now ? 0.9 : future ? 0.06 : 0.32;
      st.mesh.scale.setScalar(now ? 1.16 : 1);
      st.el.className = `pin lane-${st.layer}${now ? " is-now" : ""}${future ? " is-future" : ""}${now && tone === "danger" ? " is-danger" : ""}${now && tone === "ok" ? " is-ok" : ""}`;
    });
    lanes.forEach((lane) => {
      lane.chip.classList.toggle("is-now", stations[Math.round(target)]?.layer === lane.layer);
    });
    segments.forEach((tube, i) => {
      const lit = target > i;
      const dest = stations[i + 1];
      const lane = dest ? LAYER_COLOR[dest.layer] : 0x31445d;
      tube.material.color.setHex(lit ? lane : 0x31445d);
      tube.material.emissive.setHex(lit ? lane : 0x0c121c);
      tube.material.emissiveIntensity = lit ? 0.45 : 0.12;
    });
  }

  function focus(index, nextTone, echoBack) {
    target = index;
    tone = nextTone || "work";
    if (echoBack) echoJob = { from: index, age: 0 };
    paint();
  }

  function resetView() {
    camera.position.copy(defaultPos);
    controls.target.copy(defaultTarget);
    controls.update();
  }

  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    labelRenderer.setSize(w, h);
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(stations.map((st) => st.mesh));
    if (hits[0]) onPick(hits[0].object.userData.index);
  }

  let pointerDown = { x: 0, y: 0 };
  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDown = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (moved < 6) pick(event);
  });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (reduce) shown = target;
    else shown += (target - shown) * Math.min(1, dt * 4.2);
    if (Math.abs(target - shown) < 0.001) shown = target;
    placePacket(shown);
    const pulse = 1 + Math.sin(clock.elapsedTime * 4) * 0.08;
    packet.scale.setScalar(pulse);
    stations.forEach((st, i) => {
      if (i === Math.round(target)) st.mesh.rotation.y += dt * 0.7;
    });
    if (echoJob) {
      echoJob.age += dt;
      const u = Math.min(1, echoJob.age / 0.85);
      echo.visible = true;
      echo.position.copy(sample(echoJob.from * (1 - u)));
      if (u >= 1) {
        echo.visible = false;
        echoJob = null;
      }
    }
    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  });

  return {
    setScenario,
    focus,
    resetView,
    setOnPick(fn) { onPick = fn; },
  };
}
