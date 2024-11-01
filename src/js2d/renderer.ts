import { scaleScalarToPixels, simToScreen } from "./engine";
import { clipScalar, matmul, rmat } from "./math";
import { EnvState, StaticEnvParams, EnvParams, RigidBody, ndarray } from "./env_state";
import nj from "@d4c/numjs";
import { selectShape } from "./utils";
const JOINT_COLOURS = [
    [255, 255, 0], // yellow
    [255, 0, 255], // purple/magenta
    [0, 255, 255], // cyan
    [255, 153, 51], // white
    [120, 120, 120],
];

export const makeOriginalImages = (p: p5): { [id: string]: p5.Image } => {
    let images: { [id: string]: p5.Image } = {};

    images["edit"] = p.loadImage("assets/edit.png");
    images["play"] = p.loadImage("assets/play.png");

    images["circle"] = p.loadImage("assets/circle.png");
    images["square"] = p.loadImage("assets/square.png");
    images["triangle"] = p.loadImage("assets/square.png");
    images["rjoint"] = p.loadImage("assets/rjoint3.png");
    images["fjoint"] = p.loadImage("assets/fjoint2.png");
    images["thruster"] = p.loadImage("assets/thruster6.png");
    images["hand"] = p.loadImage("assets/hand.png");

    images["thumbsup"] = p.loadImage("assets/thumbsup.png");
    images["thumbsdown"] = p.loadImage("assets/thumbsdown.png");

    images["arrow_left"] = p.loadImage("assets/leftarrow.png");
    images["arrow_right"] = p.loadImage("assets/rightarrow.png");

    images["arrow_up"] = p.loadImage("assets/arrow_up.png");
    images["arrow_down"] = p.loadImage("assets/arrow_down.png");

    images["key_1"] = p.loadImage("assets/number1.png");
    images["key_2"] = p.loadImage("assets/number2.png");

    images["key_W"] = p.loadImage("assets/key_W.png");
    images["key_A"] = p.loadImage("assets/key_A.png");
    images["key_S"] = p.loadImage("assets/key_S.png");
    images["key_D"] = p.loadImage("assets/key_D.png");
    images["keycap"] = p.loadImage("assets/keycap.png");

    return images;
};

export const makeCleanImages = (p: p5, staticEnvParams: StaticEnvParams, images: { [id: string]: p5.Image }) => {
    let baseImage = images["rjoint"];

    baseImage.loadPixels();
    for (let alpha = 0; alpha <= 1; alpha++) {
        for (let j = 0; j < 5; ++j) {
            const newImage = p.createImage(baseImage.width, baseImage.height);
            newImage.loadPixels();
            for (let i = 0; i < newImage.pixels.length; i += 4) {
                newImage.pixels[i] = Math.round((baseImage.pixels[i] / 255) * (JOINT_COLOURS[j][0] / 255) * 255);
                newImage.pixels[i + 1] = Math.round((baseImage.pixels[i + 1] / 255) * (JOINT_COLOURS[j][1] / 255) * 255);
                newImage.pixels[i + 2] = Math.round((baseImage.pixels[i + 2] / 255) * (JOINT_COLOURS[j][2] / 255) * 255);
                newImage.pixels[i + 3] = baseImage.pixels[i + 3] * (alpha == 0 ? 1 : 0.5);
            }
            newImage.updatePixels();
            const name = alpha == 0 ? `rjoint_${j}` : `rjoint_${j}_alpha`;
            images[name] = newImage;
        }
    }

    baseImage = images["thruster"];
    baseImage.loadPixels();
    for (let alpha = 0; alpha <= 1; alpha++) {
        for (let j = 0; j < 6; ++j) {
            const newImage = p.createImage(baseImage.width, baseImage.height);
            newImage.loadPixels();
            for (let i = 0; i < newImage.pixels.length; i += 4) {
                const y = Math.floor(i / 4 / baseImage.width);
                if (y < 9 * 2) {
                    if (j == 5) {
                        newImage.pixels[i] = baseImage.pixels[i];
                        newImage.pixels[i + 1] = baseImage.pixels[i + 1];
                        newImage.pixels[i + 2] = baseImage.pixels[i + 2];
                    } else {
                        newImage.pixels[i] = Math.round((baseImage.pixels[i] / 255) * (JOINT_COLOURS[j][0] / 255) * 255);
                        newImage.pixels[i + 1] = Math.round((baseImage.pixels[i + 1] / 255) * (JOINT_COLOURS[j][1] / 255) * 255);
                        newImage.pixels[i + 2] = Math.round((baseImage.pixels[i + 2] / 255) * (JOINT_COLOURS[j][2] / 255) * 255);
                    }
                }
                newImage.pixels[i + 3] = baseImage.pixels[i + 3] * (alpha == 0 ? 1 : 0.5);
            }
            newImage.updatePixels();
            images[`thruster_${j}${alpha == 0 ? "" : "_alpha"}`] = newImage;
        }
    }

    for (let key of ["W", "A", "S", "D"]) {
        baseImage = images["key_" + key];
        baseImage.loadPixels();
        for (let alpha = 0; alpha <= 1; alpha++) {
            const newImage = p.createImage(baseImage.width, baseImage.height);
            newImage.loadPixels();
            for (let i = 0; i < newImage.pixels.length; i += 4) {
                // 223, 231, 235
                newImage.pixels[i] = 250;
                newImage.pixels[i + 1] = 250;
                newImage.pixels[i + 2] = 250;
                newImage.pixels[i + 3] = baseImage.pixels[i + 3];
            }
            newImage.updatePixels();
            images[`key_${key}`] = newImage;
        }
    }

    baseImage = images["edit"];
    baseImage.loadPixels();
    const newImage = p.createImage(baseImage.width, baseImage.height);
    newImage.loadPixels();
    const v = 255;
    for (let i = 0; i < newImage.pixels.length; i += 4) {
        if (baseImage.pixels[i] == v && baseImage.pixels[i + 1] == v && baseImage.pixels[i + 2] == v) {
            newImage.pixels[i] = 200;
            newImage.pixels[i + 1] = 162;
            newImage.pixels[i + 2] = 200;
        } else if (baseImage.pixels[i] == 0 && baseImage.pixels[i + 1] == 0 && baseImage.pixels[i + 2] == 0) {
            newImage.pixels[i] = 135;
            newImage.pixels[i + 1] = 206;
            newImage.pixels[i + 2] = 235;
        } else {
            newImage.pixels[i] = baseImage.pixels[i];
            newImage.pixels[i + 1] = baseImage.pixels[i + 1];
            newImage.pixels[i + 2] = baseImage.pixels[i + 2];
        }
        newImage.pixels[i + 3] = baseImage.pixels[i + 3];
    }
    newImage.updatePixels();
    images["edit"] = newImage;

    return images;
};

export const makeAllImages = (p: p5, staticEnvParams: StaticEnvParams): { [id: string]: p5.Image } => {
    let images = makeOriginalImages(p);
    images = makeCleanImages(p, staticEnvParams, images);
    return images;
};

export interface RenderActiveThrusters {
    previousThrusterActions: ndarray;
}

export function render(
    p: p5,
    state: EnvState,
    staticEnvParams: StaticEnvParams,
    envParams: EnvParams,
    images: { [id: string]: p5.Image },
    renderOnlyActiveThrusters: RenderActiveThrusters | null = null
) {
    p.push();
    //@ts-ignore
    p.clip(() => p.rect(0, 0, staticEnvParams.screenDim.get(0), staticEnvParams.screenDim.get(1)));
    p.push();
    p.fill("#F9F6F0");
    p.rect(0, 0, staticEnvParams.screenDim.get(0), staticEnvParams.screenDim.get(1));
    p.pop();

    const ROLE_COLOURS = [
        [160.0, 160.0, 160.0], // None
        [0.0, 204.0, 0.0], // Green:    The ball
        [0.0, 102.0, 204.0], // Blue:   The goal
        [255.0, 102.0, 102.0], // Red:      Death Objects
    ];
    p.rectMode(p.CENTER);
    const _getFillColour = (rb: RigidBody) => {
        const col = [...ROLE_COLOURS[rb.role]];
        for (let i = 0; i < col.length; i++) {
            col[i] *= rb.inverseMass === 0 ? 0.5 : 1;
        }
        col.push(rb.transparent ? 128 : 255);
        return col;
    };
    p.push();
    for (let i = 0; i < staticEnvParams.numPolygons; ++i) {
        const r = state.polygon[i];
        if (r == null || !r.active) {
            continue;
        }
        const pos = simToScreen(r.position, staticEnvParams, envParams);
        p.stroke(r.highlighted ? "red" : "black");
        p.push();
        p.fill(_getFillColour(r));
        p.beginShape();
        const mat = rmat(r.rotation);
        for (let j = 0; j < r.nVertices; ++j) {
            const v = r.vertices.pick(j);
            const vpos = simToScreen(matmul(mat, v).add(r.position), staticEnvParams, envParams);

            p.vertex(vpos.get(0), vpos.get(1));
        }
        p.endShape(p.CLOSE);
        p.pop();
    }

    for (let i = 0; i < staticEnvParams.numCircles; ++i) {
        const c = state.circle[i];
        if (c == null || !c.active) {
            continue;
        }
        p.stroke(c.highlighted ? "red" : "black");
        const pos = simToScreen(c.position, staticEnvParams, envParams);
        p.push();
        p.fill(_getFillColour(c));
        p.ellipse(pos.get(0), pos.get(1), scaleScalarToPixels(c.radius * 2, staticEnvParams, envParams));
        p.pop();

        const unit_vec = nj.array([1, 0]);
        const newPos = simToScreen(matmul(rmat(c.rotation), unit_vec).multiply(c.radius).add(c.position), staticEnvParams, envParams);
        p.line(pos.get(0), pos.get(1), newPos.get(0), newPos.get(1));
    }

    for (let i = 0; i < staticEnvParams.numThrusters; ++i) {
        const t = state.thruster[i];
        if (t == null || !t.active) {
            continue;
        }
        const parentShape = selectShape(state, t.objectIndex);
        const w = 16;
        const screenPos = simToScreen(t.globalPosition, staticEnvParams, envParams);
        p.push();
        p.imageMode(p.CENTER);
        p.translate(screenPos.get(0), screenPos.get(1));
        p.rotate(-parentShape.rotation - t.rotation - Math.PI / 2);
        // p.rotate(t.rotation + parentShape.rotation);
        // p.rotate(t.rotation); // use this if we do the weird flip.

        if (t.highlighted) {
            p.push();
            p.fill(255, 0, 0);
            p.rect(0, 0, w, w);
            p.pop();
        }
        const bindingId = t.thrusterBinding % JOINT_COLOURS.length;
        const thrusterImageName = `thruster_${bindingId}${t.transparent ? "_alpha" : ""}`;
        if (renderOnlyActiveThrusters === null) {
            p.image(images[thrusterImageName], 0, 0, 1.5 * w, 1.5 * w);
        } else if (renderOnlyActiveThrusters.previousThrusterActions.get(i) > 0) {
            p.image(images[thrusterImageName], 0, 0, 2 * w, 2 * w);
        } else {
            p.image(images[`thruster_5`], 0, 0, 1.5 * w, 1.5 * w);
        }
        p.pop();
    }

    // render joints
    for (let i = 0; i < staticEnvParams.numJoints; ++i) {
        const j = state.joint[i];
        if (j == null || !j.active) {
            continue;
        }
        const w = 16;
        const screenPos = simToScreen(j.globalPosition, staticEnvParams, envParams);
        p.push();
        p.imageMode(p.CENTER);
        p.translate(screenPos.get(0), screenPos.get(1));
        p.rotate(-j.rotation - Math.PI / 2);

        if (j.highlighted) {
            p.push();
            p.fill(255, 0, 0);
            if (j.isFixedJoint) p.rect(0, 0, w / 1.5, w / 1.5);
            else p.ellipse(0, 0, w / 1.2, w / 1.2);
            p.pop();
        }
        const bindingId = j.motorBinding % JOINT_COLOURS.length;
        p.image(
            images[j.isFixedJoint ? "fjoint" : !j.motorOn ? "rjoint" : j.transparent ? `rjoint_${bindingId}_alpha` : `rjoint_${bindingId}`],
            0,
            0,
            1.5 * w,
            1.5 * w
        );
        p.pop();
    }
    p.pop();
    p.pop();
}

export function renderControlOverlay(
    p: p5,
    state: EnvState,
    staticEnvParams: StaticEnvParams,
    envParams: EnvParams,
    images: { [id: string]: p5.Image }
) {
    const w = 16;
    for (let i = 0; i < state.thruster.length; ++i) {
        const t = state.thruster[i];
        if (t == null || !t.active || t.transparent) {
            continue;
        }
        const screenPos = simToScreen(t.globalPosition, staticEnvParams, envParams);
        p.push();
        p.imageMode(p.CENTER);
        p.translate(screenPos.get(0), screenPos.get(1) - w);

        const bindingId = t.thrusterBinding % JOINT_COLOURS.length;
        p.image(images[`key_${bindingId + 1}`], 0, 0, w, w);
        p.pop();
    }

    for (let i = 0; i < state.joint.length; ++i) {
        const j = state.joint[i];
        if (j == null || !j.active || j.transparent || j.isFixedJoint || !j.motorOn) {
            continue;
        }
        const screenPos = simToScreen(j.globalPosition, staticEnvParams, envParams);
        p.push();
        p.imageMode(p.CENTER);
        p.translate(screenPos.get(0), screenPos.get(1) - w);

        const bindingId = j.motorBinding % JOINT_COLOURS.length;
        const keys = {
            0: ["arrow_left", "arrow_right"],
            1: ["arrow_up", "arrow_down"],
            2: ["key_W", "key_S"],
            3: ["key_A", "key_D"],
        }[bindingId];

        if (bindingId >= 2) {
            p.image(images["keycap"], -w / 2, 0, w, w);
            p.image(images["keycap"], w / 2, 0, w, w);
            const newW = Math.round((w / 4) * 2.5);
            const offset = 1;
            p.image(images[keys[0]], -w / 2 - offset, 0 - offset, newW, newW);
            if (bindingId == 2) {
                p.image(images[keys[1]], w / 2, 0 - offset, newW, newW);
            } else {
                p.image(images[keys[1]], w / 2 - offset, 0 - offset, newW, newW);
            }
        } else {
            p.image(images[keys[0]], -w / 2 - 1, 0 - 1, w - 2, w - 2);
            p.image(images[keys[1]], w / 2 - 1, 0 - 1, w - 2, w - 2);
        }

        p.pop();
    }
}
