import * as THREE from "./libs/three.module.js";
import * as CANNON from "./libs/cannon-es.js";
import { OrbitControls } from "./libs/OrbitControls.js";
import { VRButton } from "./webxr/VRButton.js";
import { XRControllerModelFactory } from "./webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "./webxr/XRHandModelFactory.js";
import cannonDebugger from "./libs/cannon-es-debugger.js";
import { pdb } from "./utils.js";

let container;
let camera, scene, renderer, world;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let myDebugger;

let chains = [];
let resids = [];
let restypes = [];
let atomNames = [];

const timestep = 1 / 60;

const atomRadius = 0.01;
const scale = .03;
const translation = new THREE.Vector3(-0.8, 0.3, -.5);

const tmpVector1 = new THREE.Vector3();
const tmpVector2 = new THREE.Vector3();
const tmpQuatertnion = new THREE.Quaternion();
var dummy = new THREE.Object3D();
const carbonMaterial = new THREE.MeshPhongMaterial({
  color: 0x555555,
  flatShading: true,
});
const oxygenMaterial = new THREE.MeshPhongMaterial({
  color: 0xff0000,
  flatShading: true,
});
const nitrogenMaterial = new THREE.MeshPhongMaterial({
  color: 0x0000ff,
  flatShading: true,
});
const sulfurMaterial = new THREE.MeshPhongMaterial({
  color: 0xfdc12a,
  flatShading: true,
});

const atomGeometry = new THREE.SphereGeometry(atomRadius, 32, 32);
const sphereShape = new CANNON.Sphere(atomRadius);

let controls;

let grabbing = false;

const spheres = [];
const bodies = [];
const meshes = [];
let grabbedMesh;

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, 0, 0), // m/s²
  });

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x444444);

  // myDebugger = cannonDebugger(scene, world.bodies, { autoUpdate: false });

  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    10
  );
  camera.position.set(0, 1.6, 3);
  controls = new OrbitControls(camera, container);
  controls.target.set(0, 1.6, 0);
  controls.update();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(4, 4);
  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x156289 });
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const floorShape = new CANNON.Plane();
  const floorBody = new CANNON.Body({ mass: 0 });
  floorBody.quaternion.copy(floor.quaternion);
  floorBody.position.copy(floor.position);
  world.addBody(floorBody);
  bodies.push(floorBody);
  meshes.push(floor);
  floorBody.addShape(floorShape);

  // Lights
  const hemisphereLight = new THREE.HemisphereLight(0x808080, 0x606060);
  scene.add(hemisphereLight);

  const light = new THREE.DirectionalLight(0xffffff);
  light.position.set(0, 6, 0);
  light.castShadow = true;
  light.shadow.camera.top = 2;
  light.shadow.camera.bottom = -2;
  light.shadow.camera.right = 2;
  light.shadow.camera.left = -2;
  light.shadow.mapSize.set(4096, 4096);
  scene.add(light);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;

  container.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Controllers
  controller1 = renderer.xr.getController(0);
  scene.add(controller1);

  controller2 = renderer.xr.getController(1);
  scene.add(controller2);

  const controllerModelFactory = new XRControllerModelFactory();
  const handModelFactory = new XRHandModelFactory();

  // Hand1
  controllerGrip1 = renderer.xr.getControllerGrip(0);
  controllerGrip1.add(
    controllerModelFactory.createControllerModel(controllerGrip1)
  );
  scene.add(controllerGrip1);

  hand1 = renderer.xr.getHand(0);
  hand1.addEventListener("pinchstart", onPinchStart);
  hand1.addEventListener("pinchend", onPinchEnd);
  hand1.add(handModelFactory.createHandModel(hand1, "mesh"));
  scene.add(hand1);

  // Hand2
  controllerGrip2 = renderer.xr.getControllerGrip(1);
  controllerGrip2.add(
    controllerModelFactory.createControllerModel(controllerGrip2)
  );
  scene.add(controllerGrip2);

  hand2 = renderer.xr.getHand(1);
  hand2.addEventListener("pinchstart", onPinchStart);
  hand2.addEventListener("pinchend", onPinchEnd);
  hand2.add(handModelFactory.createHandModel(hand2, "mesh"));
  scene.add(hand2);

  buildMolecule(pdb);

  window.addEventListener("resize", onWindowResize);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render() {
  // myDebugger.update();
  renderer.render(scene, camera);
  world.step(timestep);
  updateMeshPositions();
}

function collideObject(indexTip) {
  for (let i = 0; i < spheres.length; i++) {
    const sphere = spheres[i];
    const distance = indexTip
      .getWorldPosition(tmpVector1)
      .distanceTo(sphere.getWorldPosition(tmpVector2));
    if (distance < sphere.geometry.boundingSphere.radius * sphere.scale.x) {
      return sphere;
    }
  }
  return null;
}

function onPinchEnd(event) {
  const controller = event.target;
  if (controller.userData.selected !== undefined) {
    const object = controller.userData.selected;
    object.material.emissive.b = 0;
    scene.attach(object);
    controller.userData.selected = undefined;
    grabbedMesh = undefined;
    grabbing = false;
  }
}

function onPinchStart(event) {
  const controller = event.target;
  const indexTip = controller.joints["index-finger-tip"];
  const object = collideObject(indexTip);
  if (object) {
    grabbing = true;
    indexTip.attach(object);
    controller.userData.selected = object;
    grabbedMesh = object;
    console.log("Selected", object);
  }
}

function updateMeshPositions() {
  for (let i = 0; i !== meshes.length; i++) {
    // bodies[i].velocity.x = bodies[i].velocity.x / 1.05;
    // bodies[i].velocity.y = bodies[i].velocity.y / 1.05;
    // bodies[i].velocity.z = bodies[i].velocity.z / 1.05;

    if (meshes[i] === grabbedMesh) {
      meshes[i].getWorldPosition(tmpVector1);
      meshes[i].getWorldQuaternion(tmpQuatertnion);
      bodies[i].position.copy(tmpVector1);
      bodies[i].quaternion.copy(tmpQuatertnion);
    } else {
      meshes[i].position.copy(bodies[i].position);
      meshes[i].quaternion.copy(bodies[i].quaternion);
    }
  }
}

function buildMolecule(pdb) {
  const mass = 1;

  const lineas = pdb.split("\n");
  let atomMaterial;

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i].substring(0, 4) == "ATOM") {
      resids.push(parseInt(lineas[i].substring(23, 26)));
      restypes.push(lineas[i].substring(17, 20).trim());
      atomNames.push(lineas[i].substring(13, 15).trim());

      if (lineas[i].substring(77, 78).trim() === "C") {
        atomMaterial = carbonMaterial;
      }
      if (lineas[i].substring(77, 78).trim() === "N") {
        atomMaterial = nitrogenMaterial;
      }
      if (lineas[i].substring(77, 78).trim() === "O") {
        atomMaterial = oxygenMaterial;
      }
      if (lineas[i].substring(77, 78).trim() === "S") {
        atomMaterial = sulfurMaterial;
      }

      const atom = new THREE.Mesh(atomGeometry, atomMaterial);
      atom.castShadow = true;
      atom.position.set(
        parseFloat(lineas[i].substring(30, 38)),
        parseFloat(lineas[i].substring(38, 46)),
        parseFloat(lineas[i].substring(46, 54))
      );
      atom.position.multiplyScalar(scale);
      atom.position.add(translation);
      meshes.push(atom);

      const sphereBody = new CANNON.Body({
        mass: mass,
        shape: sphereShape,
      });
      sphereBody.position.copy(atom.position);
      bodies.push(sphereBody);
      world.addBody(sphereBody);
      scene.add(atom);
    }
  }
}
