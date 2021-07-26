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

const atomRadius = 0.015;
const scale = .04;
const translation = new THREE.Vector3(-1.1, 0.8, -.5);

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

const atoms = [];
const atomBodies = [];
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
  for (let i = 0; i < atoms.length; i++) {
    const sphere = atoms[i];
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
      atom.geometry.computeBoundingSphere();
      meshes.push(atom);

      const sphereBody = new CANNON.Body({
        mass: mass,
        shape: sphereShape,
      });
      sphereBody.position.copy(atom.position);
      bodies.push(sphereBody);
      atomBodies.push(sphereBody);
      world.addBody(sphereBody);
      scene.add(atom);
      atoms.push(atom);
    }
  }

  for (var j = 0; j < atomBodies.length; j++) {
    if (atomNames[j] === 'CA') {
      for (var jj = j+1; jj < atomBodies.length; jj++) {
        if (atomNames[jj] === 'CA' && resids[jj]-resids[j]==1) {
          //CA - CA+1
          var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[jj].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[jj].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[jj].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[jj], atomBodies[j], distance, 1e3);
          world.addConstraint(c);
          //C-N+1
          var distance = Math.sqrt( Math.pow(atomBodies[j+1].position.x - atomBodies[jj-1].position.x,2) + Math.pow(atomBodies[j+1].position.y - atomBodies[jj-1].position.y,2) + Math.pow(atomBodies[j+1].position.z - atomBodies[jj-1].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j+1], atomBodies[jj-1], distance, 1e3);
          world.addConstraint(c);
          //O-N+1
          var distance = Math.sqrt( Math.pow(atomBodies[j+2].position.x - atomBodies[jj-1].position.x,2) + Math.pow(atomBodies[j+2].position.y - atomBodies[jj-1].position.y,2) + Math.pow(atomBodies[j+2].position.z - atomBodies[jj-1].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j+2], atomBodies[jj-1], distance, 1e3);
          world.addConstraint(c);          
          break
        }
      }
        //CA-N
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j-1].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j-1].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j-1].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j-1], distance, 1e3);
        world.addConstraint(c);
        //CA-C
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+1].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+1].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+1].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+1], distance, 1e3);
        world.addConstraint(c);
        //CA-O
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+2].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+2].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+2].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+2], distance, 1e3);
        world.addConstraint(c);
        //C-O
        var distance = Math.sqrt( Math.pow(atomBodies[j+1].position.x - atomBodies[j+2].position.x,2) + Math.pow(atomBodies[j+1].position.y - atomBodies[j+2].position.y,2) + Math.pow(atomBodies[j+1].position.z - atomBodies[j+2].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j+1], atomBodies[j+2], distance, 1e3);
        world.addConstraint(c);

        //CA-CB
        if (restypes[j] !== 'GLY') {
          var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+3].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+3].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+3].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+3], distance, 1e3);
          world.addConstraint(c);
          var distance = Math.sqrt( Math.pow(atomBodies[j-1].position.x - atomBodies[j+3].position.x,2) + Math.pow(atomBodies[j-1].position.y - atomBodies[j+3].position.y,2) + Math.pow(atomBodies[j-1].position.z - atomBodies[j+3].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j-1], atomBodies[j+3], distance, 1e3);
          world.addConstraint(c);
        }
        switch(restypes[j]) {
          case 'CYS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            break;
          case 'SER':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            break;
          case 'THR':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            break;
          case 'VAL':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            break;
          case 'ASP':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
          case 'ASN':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
          case 'GLU':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
          case 'GLN':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
          case 'PHE':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9]));
            break;
          case 'HIS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8]));
            break;
          case 'ILE':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            break;
          case 'LEU':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            break;
          case 'LYS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            break;
          case 'MET':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            break;
          case 'PRO':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j-1]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j-1]));
            break;
          case 'ARG':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9]));
            break;
          case 'TRP':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+10], atomBodies[j+11]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+10], atomBodies[j+12]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+11], atomBodies[j+12]));
            break;
          case 'TYR':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+10]));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+10]));
            break;
      }
    }
  }
}
