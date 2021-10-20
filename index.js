import * as THREE from "./libs/three.module.js";
import * as CANNON from "./libs/cannon-es.js";
import { OrbitControls } from "./libs/OrbitControls.js";
import { VRButton } from "./webxr/VRButton.js";
import { XRControllerModelFactory } from "./webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "./webxr/XRHandModelFactory.js";
import cannonDebugger from "./libs/cannon-es-debugger.js";
import { pdb, elementNames, elementradii } from "./utils.js";

let container;
let camera, scene, renderer, world;
let hand1, hand2;
let controller1, controller2;
let controllerGrip1, controllerGrip2;
let myDebugger;

const timestep = 1 / 60;

const atomRadius = 0.02;
const stickRadius = 0.007;
const scale = 0.04;
const translation = new THREE.Vector3(-0.6, 1, -0.5);

const tmpVector1 = new THREE.Vector3();
const tmpVector2 = new THREE.Vector3();
const tmpQuatertnion = new THREE.Quaternion();

const material = new THREE.MeshLambertMaterial();
const atomGeometry = new THREE.SphereBufferGeometry(atomRadius, 16, 16);
const cylinderGeometry = new THREE.CylinderBufferGeometry(
  stickRadius,
  stickRadius,
  0.06,
  16
);
const sphereShape = new CANNON.Sphere(atomRadius * 1.3);

let controls;

let grabbing = false;

const atoms = [];
const atomBodies = [];
const sticks = [];
const bodies = [];
const meshes = [];
let grabbedMeshes = [];

let molecule = {
  resids: [],
  restypes: [],
  atomNames: [],
  atomElements: [],
  atomPositions: [],
  atomColors: [],
  sticks: [],
  atoms: null,
  bonds: null,
};

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
  controls.enableDamping = true;
  controls.update();

  // Floor
  const floorGeometry = new THREE.PlaneGeometry(4, 4);
  const floorMaterial = new THREE.MeshLambertMaterial({ color: 0x156289 });
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
  light.shadow.mapSize.set(1024, 1024);
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
  controls.update();
  renderer.render(scene, camera);
  world.step(timestep);
  updateMeshPositions();
}

function collideObject(indexTip) {
  for (let i = 0; i < molecule.atoms.count; i++) {
    const atomPos = new THREE.Vector3();
    const atomMatrix = new THREE.Matrix4();
    molecule.atoms.getMatrixAt(i, atomMatrix);
    atomPos.setFromMatrixPosition(atomMatrix);
    const distance = indexTip
      .getWorldPosition(tmpVector1)
      .distanceTo(atomPos);
    if (distance < 0.0016) {
      return i;
    }
  }
  return null;
}

// This function returns 1.2 * (A + B)^2
// A and B are element radius
function radiiSum(elementA, elementB) {
  return 1.2 * Math.pow(elementA + elementB, 2);
}

function getBonds(atoms, indexes) {
  let bonds = {};

  for (let i = 0; i < atoms.count; i++) {
    const currentAtomI = `atom${i + 1}`;

    let distsqr;
    let bondedAtoms = [];

    for (let j = i + 1; j < atoms.count; j++) {
      const currentAtomJ = `atom${j + 1}`;

      const atomMatrix = new THREE.Matrix4();
      atoms.getMatrixAt(i, atomMatrix);
      tmpVector1.setFromMatrixPosition(atomMatrix);
      tmpVector1.sub(translation);
      tmpVector1.multiplyScalar(1 / scale);

      const atomMatrix2 = new THREE.Matrix4();
      atoms.getMatrixAt(j, atomMatrix2);
      tmpVector2.setFromMatrixPosition(atomMatrix2);
      tmpVector2.sub(translation);
      tmpVector2.multiplyScalar(1 / scale);

      //get distance squared
      distsqr =
        Math.pow(tmpVector1.x - tmpVector2.x, 2) +
        Math.pow(tmpVector1.y - tmpVector2.y, 2) +
        Math.pow(tmpVector1.z - tmpVector2.z, 2);

      //if distance squared is less than 1.2 x the sum of the radii squared, add a bond
      const radSum = radiiSum(
        elementradii[indexes[i]],
        elementradii[indexes[j]]
      );
      if (distsqr < radSum) {
        bondedAtoms.push(currentAtomJ);
      }
    }
    bonds[currentAtomI] = bondedAtoms;
  }
  return bonds;
}

function onPinchEnd(event) {
  const controller = event.target;
  // if (controller.userData.selected !== undefined) {
  //   const object = controller.userData.selected;
  //   object.material.emissive.b = 0;
  //   scene.attach(object);
  //   controller.userData.selected = undefined;
  //   const index = grabbedMeshes.indexOf(object);
  //   grabbedMeshes.splice(index, 1);
  //   grabbing = false;
  // }
}

function onPinchStart(event) {
  const controller = event.target;
  const indexTip = controller.joints["index-finger-tip"];
  const object = collideObject(indexTip);
  if (object) {
    grabbing = true;
    molecule.atoms.setColorAt(12, new THREE.Color( 0xffffff ));
    molecule.atoms.instanceColor.needsUpdate = true;
    // indexTip.attach(object);
    // controller.userData.selected = object;
    // grabbedMeshes.push(object);
    // console.log("Selected", object);
  }
}

function updateMeshPositions() {
  for (let i = 0; i !== molecule.atoms.count; i++) {
    atomBodies[i].velocity.x = atomBodies[i].velocity.x / 1.01;
    atomBodies[i].velocity.y = atomBodies[i].velocity.y / 1.01;
    atomBodies[i].velocity.z = atomBodies[i].velocity.z / 1.01;

    // const thisMeshId = meshes[i].id;
    // const isGrabbed = grabbedMeshes.some((grabbedMesh) => {
    //   return thisMeshId === grabbedMesh.id;
    // });

    // if (isGrabbed) {
    //   console.log("hey");
    //   meshes[i].getWorldPosition(tmpVector1);
    //   meshes[i].getWorldQuaternion(tmpQuatertnion);
    //   bodies[i].position.copy(tmpVector1);
    //   bodies[i].quaternion.copy(tmpQuatertnion);
    // } else {
      const matrix = new THREE.Matrix4();
      matrix.setPosition(atomBodies[i].position.x, atomBodies[i].position.y, atomBodies[i].position.z);
      molecule.atoms.setMatrixAt(i, matrix);
    // }
  }

  molecule.atoms.instanceMatrix.needsUpdate = true;

  updateBonds();

  molecule.bonds.instanceMatrix.needsUpdate = true;

  // if (grabbing) {
  //   const grabbedAtomIndex = atoms.indexOf(grabbedMesh);
  // }

  // sticks.forEach(function (bond) {
  //   atoms[bond.atomA].getWorldPosition(tmpVector1);
  //   atoms[bond.atomB].getWorldPosition(tmpVector2);

  //   const vec = tmpVector1.clone();
  //   vec.sub(tmpVector2);
  //   const h = vec.length();
  //   vec.normalize();
  //   const quaternion = new THREE.Quaternion();
  //   quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec);
  //   bond.meshes[0].position.set(0, 0, 0);
  //   bond.meshes[0].rotation.set(0, 0, 0);
  //   // bond.meshes[0].scale.y += 0.01;
  //   bond.meshes[0].translateOnAxis(0, h / 2, 0);
  //   bond.meshes[0].applyQuaternion(quaternion);
  //   bond.meshes[0].position.set(tmpVector2.x, tmpVector2.y, tmpVector2.z);
  // });
}

function buildMolecule(pdb) {
  const lineas = pdb.split("\n");

  for (let i = 0; i < lineas.length; i++) {
    if (lineas[i].substring(0, 4) === "ATOM") {
      molecule.resids.push(parseInt(lineas[i].substring(23, 26)));
      molecule.restypes.push(lineas[i].substring(17, 20).trim());
      molecule.atomNames.push(lineas[i].substring(13, 15).trim());
      molecule.atomElements.push(lineas[i].substring(77, 78).trim());

      const atomPosition = new THREE.Vector3(
        parseFloat(lineas[i].substring(30, 38)),
        parseFloat(lineas[i].substring(38, 46)),
        parseFloat(lineas[i].substring(46, 54))
      );
      atomPosition.multiplyScalar(scale);
      atomPosition.add(translation);

      molecule.atomPositions.push(atomPosition);

      // if (lineas[i].substring(77, 78).trim() === "C") {
      //   atomMaterial = carbonMaterial;
      // }
      // if (lineas[i].substring(77, 78).trim() === "N") {
      //   atomMaterial = nitrogenMaterial;
      // }
      // if (lineas[i].substring(77, 78).trim() === "O") {
      //   atomMaterial = oxygenMaterial;
      // }
      // if (lineas[i].substring(77, 78).trim() === "S") {
      //   atomMaterial = sulfurMaterial;
      // }
      // if (lineas[i].substring(77, 78).trim() === "H") {
      //   atomMaterial = hydrogenMaterial;
      // }

      // const atom = new THREE.Mesh(atomGeometry, atomMaterial);
      // atom.position.set(
      //   parseFloat(lineas[i].substring(30, 38)),
      //   parseFloat(lineas[i].substring(38, 46)),
      //   parseFloat(lineas[i].substring(46, 54))
      // );
      // atom.position.multiplyScalar(scale);
      // atom.position.add(translation);
      // atom.geometry.computeBoundingSphere();
      // meshes.push(atom);

      // const sphereBody = new CANNON.Body({
      //   mass: mass,
      //   shape: sphereShape,
      // });
      // sphereBody.position.copy(atom.position);
      // bodies.push(sphereBody);
      // atomBodies.push(sphereBody);
      // world.addBody(sphereBody);
      // scene.add(atom);
      // atoms.push(atom);
    }
  }

  molecule.atoms = new THREE.InstancedMesh(
    atomGeometry,
    material,
    molecule.atomElements.length
  );
  molecule.atoms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  
  for (let i = 0; i < molecule.atoms.count; i++) {
    const matrix = new THREE.Matrix4();
    matrix.setPosition(molecule.atomPositions[i]);
    molecule.atoms.setMatrixAt(i, matrix);

    const color = new THREE.Color();

    if (molecule.atomElements[i] === "C") {
      color.setHex(0x555555);
    }
    if (molecule.atomElements[i] === "N") {
      color.setHex(0x0000ff);
    }
    if (molecule.atomElements[i] === "O") {
      color.setHex(0xff0000);
    }
    if (molecule.atomElements[i] === "S") {
      color.setHex(0xfdc12a);
    }
    if (molecule.atomElements[i] === "H") {
      color.setHex(0xfffffff);
    }

    molecule.atomColors.push(color);

    molecule.atoms.setColorAt(i, color);

    // Physics - Atom Bodies
    const sphereBody = new CANNON.Body({
      mass: 1,
      shape: sphereShape,
    });
    sphereBody.position.copy(molecule.atomPositions[i]);
    bodies.push(sphereBody);
    atomBodies.push(sphereBody);
    world.addBody(sphereBody);
  }

  scene.add(molecule.atoms);

  let atomIndexes = [];

  molecule.atomNames.forEach((atom, index) => {
    for (let j = 0; j < elementNames.length; j++) {
      if (atom.substring(0, 1) === elementNames[j]) {
        atomIndexes[index] = j;
        break;
      }
    }
  });

  const bonds = getBonds(molecule.atoms, atomIndexes);

  const bondKeys = Object.keys(bonds);
  bondKeys.forEach(function (atom, atomIndex) {
    //point1 is the first atom (i), point3 is the second atom (j)
    //point2 is at the center in-between atoms i and j
    //then the first half of the bond is from sphere 1 to 2 and the
    //second half of the bond is from point2 to point3

    // const point1 = new THREE.Vector3();
    // const atomMatrix = new THREE.Matrix4();
    // molecule.atoms.getMatrixAt(atomIndex, atomMatrix);
    // point1.setFromMatrixPosition(atomMatrix)

    bonds[atom].forEach(function (bondedAtom) {
      const bondedAtomIndex = bondKeys.indexOf(bondedAtom);

      // const point3 = new THREE.Vector3();
      // const atomMatrix2 = new THREE.Matrix4();
      // molecule.atoms.getMatrixAt(bondedAtomIndex, atomMatrix2);
      // point3.setFromMatrixPosition(atomMatrix2)

      // const bond1 = cylindricalSegment(
      //   point3,
      //   point1,
      //   stickRadius,
      //   material
      // );

      // scene.add(bond1)

      molecule.sticks.push({
        atomA: atomIndex,
        atomB: bondedAtomIndex,
      });
    });
  });

  molecule.bonds = new THREE.InstancedMesh(
    cylinderGeometry,
    material,
    molecule.sticks.length
  );
  molecule.bonds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  updateBonds()
  scene.add(molecule.bonds);

  for (var j = 0; j < atomBodies.length; j++) {
    if (molecule.atomNames[j] === 'CA') {
      for (var jj = j+1; jj < atomBodies.length; jj++) {
        if (molecule.atomNames[jj] === 'CA' && molecule.resids[jj]-molecule.resids[j]==1) {
          //CA - CA+1
          var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[jj].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[jj].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[jj].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[jj], atomBodies[j], distance, 1e6);
          world.addConstraint(c);
          //C-N+1
          var distance = Math.sqrt( Math.pow(atomBodies[j+1].position.x - atomBodies[jj-1].position.x,2) + Math.pow(atomBodies[j+1].position.y - atomBodies[jj-1].position.y,2) + Math.pow(atomBodies[j+1].position.z - atomBodies[jj-1].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j+1], atomBodies[jj-1], distance, 1e6);
          world.addConstraint(c);
          //O-N+1
          var distance = Math.sqrt( Math.pow(atomBodies[j+2].position.x - atomBodies[jj-1].position.x,2) + Math.pow(atomBodies[j+2].position.y - atomBodies[jj-1].position.y,2) + Math.pow(atomBodies[j+2].position.z - atomBodies[jj-1].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j+2], atomBodies[jj-1], distance, 1e6);
          world.addConstraint(c);
          break
        }
      }
        //CA-N
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j-1].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j-1].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j-1].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j-1], distance, 1e6);
        world.addConstraint(c);
        //CA-C
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+1].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+1].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+1].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+1], distance, 1e6);
        world.addConstraint(c);
        //CA-O
        var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+2].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+2].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+2].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+2], distance, 1e6);
        world.addConstraint(c);
        //C-O
        var distance = Math.sqrt( Math.pow(atomBodies[j+1].position.x - atomBodies[j+2].position.x,2) + Math.pow(atomBodies[j+1].position.y - atomBodies[j+2].position.y,2) + Math.pow(atomBodies[j+1].position.z - atomBodies[j+2].position.z,2) )
        var c = new CANNON.DistanceConstraint(atomBodies[j+1], atomBodies[j+2], distance, 1e6);
        world.addConstraint(c);

        //CA-CB
        if (molecule.restypes[j] !== 'GLY') {
          var distance = Math.sqrt( Math.pow(atomBodies[j].position.x - atomBodies[j+3].position.x,2) + Math.pow(atomBodies[j].position.y - atomBodies[j+3].position.y,2) + Math.pow(atomBodies[j].position.z - atomBodies[j+3].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+3], distance, 1e6);
          world.addConstraint(c);
          var distance = Math.sqrt( Math.pow(atomBodies[j-1].position.x - atomBodies[j+3].position.x,2) + Math.pow(atomBodies[j-1].position.y - atomBodies[j+3].position.y,2) + Math.pow(atomBodies[j-1].position.z - atomBodies[j+3].position.z,2) )
          var c = new CANNON.DistanceConstraint(atomBodies[j-1], atomBodies[j+3], distance, 1e6);
          world.addConstraint(c);
        }
        switch(molecule.restypes[j]) {
          case 'CYS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            break;
          case 'SER':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            break;
          case 'THR':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            break;
          case 'VAL':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            break;
          case 'ASP':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            break;
          case 'ASN':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            break;
          case 'GLU':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            break;
          case 'GLN':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            break;
          case 'PHE':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9], undefined, 1e6));
            break;
          case 'HIS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8], undefined, 1e6));
            break;
          case 'ILE':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            break;
          case 'LEU':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            break;
          case 'LYS':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            break;
          case 'MET':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            break;
          case 'PRO':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j-1], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j-1], undefined, 1e6));
            break;
          case 'ARG':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9], undefined, 1e6));
            break;
          case 'TRP':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+10], atomBodies[j+11], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+10], atomBodies[j+12], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+11], atomBodies[j+12], undefined, 1e6));
            break;
          case 'TYR':
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+4], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+3], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+5], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+4], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+6], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+5], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+7], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+6], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+8], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+7], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+9], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+8], atomBodies[j+10], undefined, 1e6));
            world.addConstraint(new CANNON.DistanceConstraint(atomBodies[j+9], atomBodies[j+10], undefined, 1e6));
            break;
      }
    }
  }
}

function updateBonds() {
  for (let i = 0; i < molecule.bonds.count; i++) {
    const matrix = new THREE.Matrix4();

    const atom1Index = molecule.sticks[i].atomA;
    const atom2Index = molecule.sticks[i].atomB;

    const point1 = new THREE.Vector3();
    const atomMatrix = new THREE.Matrix4();
    molecule.atoms.getMatrixAt(atom1Index, atomMatrix);
    point1.setFromMatrixPosition(atomMatrix);

    const point3 = new THREE.Vector3();
    const atomMatrix2 = new THREE.Matrix4();
    molecule.atoms.getMatrixAt(atom2Index, atomMatrix2);
    point3.setFromMatrixPosition(atomMatrix2);

    const vec = point1.clone();
    vec.sub(point3);
    const h = vec.length();
    vec.normalize();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vec);

    const stickPosition = new THREE.Vector3();
    stickPosition.lerpVectors(point3, point1, 0.5);

    matrix.makeRotationFromQuaternion(quaternion);
    matrix.setPosition(stickPosition);

    molecule.bonds.setMatrixAt(i, matrix);
  }
}
