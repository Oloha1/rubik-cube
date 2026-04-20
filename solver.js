import * as THREE from 'three';
import Cube from 'https://esm.sh/cubejs@1.2.2';

export class Solver {
  static initialized = false;

  static async initSolverAI() {
    if (!Solver.initialized) {
      Cube.initSolver();
      Solver.initialized = true;
    }
  }

  // Parses CubeJS string output into our axis/layer/angle array
  static parseMoves(str, n = 3) {
    if (!str || str.trim() === '') return [];
    
    // Reverse the sequence conceptually? 
    // Cube.js returns moves needed to solve. 
    // "U" means rotate U face clockwise.
    const half = (n - 1) / 2;
    const moves = [];
    const tokens = str.trim().split(/\s+/);
    
    for (const tok of tokens) {
      if (!tok) continue;
      let face = tok[0];
      let prime = tok.includes("'");
      let double = tok.includes("2");
      let angle, axis, layer;

      // In our code:
      // +y (U): CW = -PI/2
      // -y (D): CW = +PI/2
      // +x (R): CW = -PI/2
      // -x (L): CW = +PI/2
      // +z (F): CW = -PI/2
      // -z (B): CW = +PI/2
      switch (face) {
        case 'U': axis = 'y'; layer = half;  angle = -Math.PI / 2; break;
        case 'D': axis = 'y'; layer = -half; angle = Math.PI / 2;  break;
        case 'R': axis = 'x'; layer = half;  angle = -Math.PI / 2; break;
        case 'L': axis = 'x'; layer = -half; angle = Math.PI / 2;  break;
        case 'F': axis = 'z'; layer = half;  angle = -Math.PI / 2; break;
        case 'B': axis = 'z'; layer = -half; angle = Math.PI / 2;  break;
        default: continue;
      }
      if (prime) angle = -angle;
      if (double) {
        moves.push({ axis, layer, angle });
        moves.push({ axis, layer, angle });
      } else {
        moves.push({ axis, layer, angle });
      }
    }
    return moves;
  }

  static findSolution(cubies, cubeSize) {
    if (cubeSize !== 3) return null; // We only support true AI for 3x3 for now
    
    // 1. Identify which colors belong to which logical face (U,R,F,D,L,B)
    // Face normals: U(+y), R(+x), F(+z), D(-y), L(-x), B(-z)
    const faceNormals = [
      { n: new THREE.Vector3(0, 1, 0),  name: 'U' },
      { n: new THREE.Vector3(1, 0, 0),  name: 'R' },
      { n: new THREE.Vector3(0, 0, 1),  name: 'F' },
      { n: new THREE.Vector3(0, -1, 0), name: 'D' },
      { n: new THREE.Vector3(-1, 0, 0), name: 'L' },
      { n: new THREE.Vector3(0, 0, -1), name: 'B' }
    ];

    const localNormals = [
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)
    ];

    const colorMap = [
      { r: 1,     g: 1,     b: 1,     id: 'W' }, // White
      { r: 0.718, g: 0.071, b: 0.204, id: 'R' }, // Red
      { r: 0,     g: 0.275, b: 0.678, id: 'B' }, // Blue
      { r: 1,     g: 0.835, b: 0,     id: 'Y' }, // Yellow
      { r: 1,     g: 0.345, b: 0,     id: 'O' }, // Orange
      { r: 0,     g: 0.608, b: 0.282, id: 'G' }  // Green
    ];

    function identifyColor(cr, cg, cb) {
      if (cr < 0.1 && cg < 0.1 && cb < 0.1) return null; // black/inner
      let best = null, bestDist = Infinity;
      for (const cm of colorMap) {
        const d = (cr - cm.r) ** 2 + (cg - cm.g) ** 2 + (cb - cm.b) ** 2;
        if (d < bestDist) { bestDist = d; best = cm.id; }
      }
      return best;
    }

    // Capture all colored stickers and their world coordinates/normals
    const stickers = [];
    const half = (cubeSize - 1) / 2;

    for (const cubie of cubies) {
      const colors = cubie.geometry.attributes.color;
      let wp = new THREE.Vector3();
      cubie.getWorldPosition(wp);
      wp.x = Math.round(wp.x * 2) / 2;
      wp.y = Math.round(wp.y * 2) / 2;
      wp.z = Math.round(wp.z * 2) / 2;

      for (let fi = 0; fi < 6; fi++) {
        const vi = fi * 4;
        const cr = colors.getX(vi), cg = colors.getY(vi), cb = colors.getZ(vi);
        const colId = identifyColor(cr, cg, cb);
        if (!colId) continue;

        const wn = localNormals[fi].clone().applyQuaternion(cubie.quaternion);
        wn.x = Math.round(wn.x); wn.y = Math.round(wn.y); wn.z = Math.round(wn.z);

        // Find which face this matches
        const faceMatch = faceNormals.find(f => f.n.x === wn.x && f.n.y === wn.y && f.n.z === wn.z);
        if (faceMatch) {
          stickers.push({ faceName: faceMatch.name, x: wp.x, y: wp.y, z: wp.z, color: colId });
        }
      }
    }

    // Find center color for each face to build color-to-face mapping
    const centerColors = {};
    for (const s of stickers) {
      // Centers are where 2 of the 3 coordinates are 0
      const zeroes = (s.x === 0 ? 1 : 0) + (s.y === 0 ? 1 : 0) + (s.z === 0 ? 1 : 0);
      if (zeroes === 2) {
        centerColors[s.color] = s.faceName;
      }
    }

    // Check if cube is solved (all stickers on a face match its center)
    let isSolved = true;
    for (const s of stickers) {
      if (centerColors[s.color] !== s.faceName) {
        isSolved = false; break;
      }
    }
    if (isSolved) return [];

    // Build the 54-char string
    // Face order: U R F D L B
    const faceOrder = ['U', 'R', 'F', 'D', 'L', 'B'];
    let stateString = '';

    for (const fn of faceOrder) {
      const faceStickers = stickers.filter(s => s.faceName === fn);
      // Sort face stickers by row, then col
      faceStickers.sort((a, b) => {
        let rA, cA, rB, cB;
        rA = getRow(fn, a); cA = getCol(fn, a);
        rB = getRow(fn, b); cB = getCol(fn, b);
        if (rA !== rB) return rA - rB;
        return cA - cB;
      });

      for (const s of faceStickers) {
        stateString += centerColors[s.color]; // e.g. maps 'W' id back to 'U'
      }
    }

    try {
      const cube = new Cube();
      cube.fromString(stateString);
      const solutionStr = cube.solve();
      return Solver.parseMoves(solutionStr, cubeSize);
    } catch(e) {
      console.error("Cube solve error:", e);
      return null;
    }
    
    function getRow(faceStr, p) {
      switch (faceStr) {
        case 'U': return 1 + p.z; // Top is B(-z) -> row 0 when z=-1
        case 'D': return 1 - p.z; // Top is F(+z) -> row 0 when z=1
        case 'R': return 1 - p.y; // Top is U(+y) -> row 0 when y=1
        case 'L': return 1 - p.y;
        case 'F': return 1 - p.y;
        case 'B': return 1 - p.y;
      }
    }
    function getCol(faceStr, p) {
      switch (faceStr) {
        case 'U': return 1 + p.x; // Left is L(-x)
        case 'D': return 1 + p.x; // Left is L(-x)
        case 'R': return 1 - p.z; // Left is F(+z)
        case 'L': return 1 + p.z; // Left is B(-z)
        case 'F': return 1 + p.x; // Left is L(-x)
        case 'B': return 1 - p.x; // Left is R(+x)
      }
    }
  }
}
