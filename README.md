# Physics Bridge Simulator

A static HTML experience that renders a realistic-looking 3D truss bridge and simulates structural response under gravity, moving vehicle load, damping, and lateral wind.

## Run locally

Because this app uses ES modules, serve it from a local web server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in a browser.

## Features

- 3D bridge rendering with Three.js.
- Truss-style member simulation using spring-like axial behavior.
- Adjustable span, bridge height, stiffness, damping, vehicle mass/speed, and wind.
- Live metrics for deflection, member stress, factor of safety, and dynamic state.
