import * as THREE from "./libs/three.module.js";
import * as CANNON from "./libs/cannon-es.js";
import { OrbitControls } from "./libs/OrbitControls.js";
import { VRButton } from "./webxr/VRButton.js";
import { XRControllerModelFactory } from "./webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "./webxr/XRHandModelFactory.js";
import cannonDebugger from "./libs/cannon-es-debugger.js";

let container;
let camera, scene, renderer, world;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let myDebugger;

const timestep = 1 / 60;

const tmpVector1 = new THREE.Vector3();
const tmpVector2 = new THREE.Vector3();
const tmpQuatertnion = new THREE.Quaternion();
var dummy = new THREE.Object3D();

let controls;
let box1, box2, connector;

let grabbing = false;

const spheres = [];
const sphereRadius = 0.05;

const bodies = [];
const meshes = [];
let grabbedMesh, grabbedBody;

init();
animate();

function init() {
  container = document.createElement("div");
  document.body.appendChild(container);

  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -10, 0), // m/s²
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

  // Dummy boxes
  const geometry = new THREE.BoxGeometry(
    sphereRadius,
    sphereRadius,
    sphereRadius
  );
  const material = new THREE.MeshStandardMaterial({
    color: 0xff0000,
    roughness: 1.0,
    metalness: 0.0,
  });

  const halfExtents = new CANNON.Vec3(
    sphereRadius / 2,
    sphereRadius / 2,
    sphereRadius / 2
  );

  const boxShape = new CANNON.Box(halfExtents);
  const boxShape2 = new CANNON.Box(halfExtents.scale(3));

  box1 = new THREE.Mesh(geometry, material);
  box1.geometry.computeBoundingSphere();
  box1.position.set(-0.2, 1.4, -0.5);
  box1.castShadow = true;
  const box1Body = new CANNON.Body({ mass: 0, shape: boxShape });
  box1Body.position.set(-0.2, 1.4, -0.5);
  world.addBody(box1Body);

  box2 = new THREE.Mesh(geometry, material);
  box2.geometry.computeBoundingSphere();
  box2.position.set(-0.2, 1, -0.5);
  box2.scale.multiplyScalar(3);
  box2.castShadow = true;
  const box2Body = new CANNON.Body({ mass: 20, shape: boxShape2 });
  box2Body.position.set(-0.2, 1, -0.5);
  world.addBody(box2Body);

  const sphereGeometry = new THREE.SphereBufferGeometry(0.01, 32, 16);
  const sphereMaterial = new THREE.MeshLambertMaterial({ color: "yellow" });
  connector = new THREE.InstancedMesh(sphereGeometry, sphereMaterial, 10);
  connector.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // will be updated every frame
  scene.add(connector);

  spheres.push(box1, box2);
  // grabbedMesh = box1;
  meshes.push(box1, box2);
  // meshes.push(box2);
  bodies.push(box1Body, box2Body);
  grabbedBody = box1Body;
  bodies.push(box2Body);
  scene.add(box1, box2);

  const distConstraint = new CANNON.DistanceConstraint(box1Body, box2Body);
  world.addConstraint(distConstraint);

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

  // grabbedMesh.getWorldPosition(tmpVector1);
  // grabbedMesh.getWorldQuaternion(tmpQuatertnion);

  // grabbedBody.position.copy(tmpVector1);
  // grabbedBody.quaternion.copy(tmpQuatertnion);

  for (let index = 1; index <= 10; index++) {
    var p0 = new THREE.Vector3();
    var p1 = new THREE.Vector3();
    var pf = new THREE.Vector3();

    p0.setFromMatrixPosition(box1.matrixWorld);
    p1.setFromMatrixPosition(box2.matrixWorld);
    pf.lerpVectors(p0, p1, index / 10);

    dummy.position.copy(pf);
    dummy.updateMatrix();
    connector.setMatrixAt(index, dummy.matrix);
  }
  connector.instanceMatrix.needsUpdate = true;
}
