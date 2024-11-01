# Kinetix.js

Kinetix.js is a TypeScript reimplementation of the <a href="https://github.com/FLAIROx/Kinetix">Kinetix</a> project, and it includes a simple way to render Kinetix scenes, full code for the environment editor, and a reimplementation of the [Jax2D](https://github.com/MichaelTMatthews/Jax2D) physics engine. Kinetix.js uses [p5.js](https://p5js.org) to deal with all of the drawing.
<p align="center">
 <img width="80%" src="extra/github_images/kinetix.gif" />
</p>


See [here](https://kinetix-env.github.io) for an explanation of the entire project, and go [here for the gallery](https://kinetix-env.github.io/gallery.html) or [here if you just want to start creating levels](https://kinetix-env.github.io/gallery.html?editor=true).

## Explanation
- `src/js2d` contains the reimplementation of [Jax2D](https://github.com/MichaelTMatthews/Jax2D), which itself is based on [Box2D-lite](https://github.com/erincatto/box2d-lite). The code here is primarily for the physics engine itself.
- `src/kinetixjs` contains the primary bulk of the code, including the environment editor (`src/kinetixjs/env_editor.ts`) and RL environment implementation (`src/kinetixjs/env.ts`).
- `src/pages` contains the primary website page code, in the form of [p5.js](https://p5js.org) sketches.
- `src/web` contains database and authentication code
- `src/index.ts` is the primary entry point for Kinetix.js


## Installation / Development
```bash
git clone https://github.com/Michael-Beukman/Kinetix.js/
cd Kinetix.js
npm install
```

## Components
### Physics Engine
The first part of Kinetix.js is the reimplementation of [Jax2D](https://github.com/MichaelTMatthews/Jax2D), so it is a simple 2D physics engine.
<p align="center">
 <img width="80%" src="extra/github_images/physics.gif" />
</p>

### Interactive Editor
Secondly, we have an [interactive editor](https://kinetix-env.github.io/v2/gallery.html?editor=true) where you can create and play your own levels, or watch an agent play them.
<p align="center">
 <img width="40%" src="extra/github_images/playing.gif" />
 <img width="40%" src="extra/github_images/playing2.gif" />
</p>
<p align="center">
 <img width="81%" src="extra/github_images/editor.png">
</p>

### Gallery
Finally, we have a [gallery](https://kinetix-env.github.io/v2/gallery.html) where you can share your own levels, and play or edit those from other people.
<p align="center">
 <img width="80%" src="extra/github_images/gallery.png" />
</p>

## See Also
- The primary [Kinetix](https://github.com/FLAIROx/Kinetix) repository, containing all of the training code.
- [Jax2D](https://github.com/MichaelTMatthews/Jax2D), the 2D physics engine built for Kinetix.
- [JaxGL](https://github.com/FLAIROx/JaxGL/), a lightweight rendering library in JAX
