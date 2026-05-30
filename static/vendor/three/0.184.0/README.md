Three.js vendor bundle
======================

Source: npm package `three@0.184.0`
Package URL: https://registry.npmjs.org/three/-/three-0.184.0.tgz
Homepage: https://threejs.org/
License: MIT, copied in `LICENSE`

Vendored files:

- `three.module.js`
- `three.core.js`
- `examples/jsm/controls/OrbitControls.js`
- `examples/jsm/loaders/STLLoader.js`
- `examples/jsm/loaders/OBJLoader.js`
- `examples/jsm/loaders/MTLLoader.js`
- `examples/jsm/loaders/PLYLoader.js`
- `examples/jsm/loaders/GLTFLoader.js`
- `examples/jsm/loaders/3MFLoader.js`
- `examples/jsm/libs/fflate.module.js`
- `examples/jsm/utils/BufferGeometryUtils.js`
- `examples/jsm/utils/SkeletonUtils.js`

This keeps Hermes WebUI's 3D preview self-hosted without adding npm, a bundler,
or a frontend build step.
