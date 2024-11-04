import { CollisionManifold, Joint, ndarray, RigidBody, EnvParams, EnvState, StaticEnvParams } from "./env_state";
import nj from "@d4c/numjs";
import {
    generateManifoldCircleCircle,
    generateManifoldCirclePolygon,
    generateManifoldPolygonPolygon,
    resolveCollision,
    resolveWarmStartingImpulse,
} from "./collision";
import { ManifoldReturn } from "./types";
import { matmul, norm, rmat, vvCross, vvDot } from "./math";
import { applyImpulsesToJoints, applyMotor, doResolveJoints, recalculateGlobalPositions, resolveJointWarmStart } from "./joint";
import { selectShape } from "./utils";

function applyToRigidBodyArray(array: RigidBody[], func: (rb: RigidBody) => RigidBody) {
    for (let i = 0; i < array.length; i++) {
        if (!array[i].active) continue;
        array[i] = func(array[i]);
    }
    return array;
}

const addVelToRigidBody = (rb: RigidBody, dv: ndarray, drv: number) => {
    // if (rb.inverseMass == 0) return rb;
    rb.velocity.add(dv, false);
    rb.angularVelocity += drv;
    return rb;
};

function applyWarmStarting(
    envState: EnvState,
    manifolds: ManifoldReturn[],
    staticEnvParams: StaticEnvParams,
    shape1_rect: boolean,
    shape2_rect: boolean
): EnvState {
    const arr1 = shape1_rect ? envState.polygon : envState.circle;
    const arr2 = shape2_rect ? envState.polygon : envState.circle;
    const all_returns = [];
    for (let i = 0; i < manifolds.length; i++) {
        const manifold = manifolds[i];
        const ret = resolveWarmStartingImpulse(
            arr1[manifold.indexA],
            arr2[manifold.indexB],
            manifold.manifold,
            envState.collisionMatrix.get(
                toCombinedIndex(manifold.indexA, shape1_rect, staticEnvParams),
                toCombinedIndex(manifold.indexB, shape2_rect, staticEnvParams)
            ) == 1
        );
        if (ret.isColliding) {
            all_returns.push({
                indexA: manifold.indexA,
                indexB: manifold.indexB,
                ret: ret,
            });
        }
    }

    for (let i = 0; i < all_returns.length; i++) {
        const ret = all_returns[i];
        const shape1 = shape1_rect ? envState.polygon : envState.circle;
        const shape2 = shape2_rect ? envState.polygon : envState.circle;
        addVelToRigidBody(shape1[ret.indexA], ret.ret.a_dv, ret.ret.a_drv);
        addVelToRigidBody(shape2[ret.indexB], ret.ret.b_dv, ret.ret.b_drv);
    }
    return envState;
}

function applyWarmStartingJoints(envState: EnvState, staticEnvParams: StaticEnvParams): EnvState {
    for (let j = 0; j < staticEnvParams.numJoints; ++j) {
        const joint = envState.joint[j];
        const a = selectShape(envState, joint.aIndex);
        const b = selectShape(envState, joint.bIndex);
        const { a_dv, b_dv, a_drv, b_drv } = resolveJointWarmStart(a, b, joint);
        envState = applyImpulsesToJoints(envState, joint, staticEnvParams, a_dv, a_drv, b_dv, b_drv, null, null);
    }
    return envState;
}

export function toCombinedIndex(index: number, is_rect: boolean, staticEnvParams: StaticEnvParams): number {
    return is_rect ? index : index + staticEnvParams.numPolygons;
}

function resolveAndApplyImpulse(
    envState: EnvState,
    manifolds: ManifoldReturn[],
    staticEnvParams: StaticEnvParams,
    shape1_rect: boolean,
    shape2_rect: boolean,
    envParams: EnvParams,

    totalNumberOfManifolds: number
): EnvState {
    const arr1 = shape1_rect ? envState.polygon : envState.circle;
    const arr2 = shape2_rect ? envState.polygon : envState.circle;
    const isPP = shape1_rect && shape2_rect;
    const new_manifolds = [];

    const resolveBatchOfManifolds = (envState: EnvState, subset: (ManifoldReturn | null)[]): EnvState => {
        const all_returns = [];
        for (let i = 0; i < subset.length; i++) {
            const manifold = subset[i];
            if (manifold == null || !manifold.manifold.active) continue;

            const ret = resolveCollision(
                arr1[manifold.indexA],
                arr2[manifold.indexB],
                manifold.manifold,
                envState.collisionMatrix.get(
                    toCombinedIndex(manifold.indexA, shape1_rect, staticEnvParams),
                    toCombinedIndex(manifold.indexB, shape2_rect, staticEnvParams)
                ) == 1,
                envParams
            );
            manifold.manifold.accImpulseNormal = ret.newAccImpulseNormal;
            manifold.manifold.accImpulseTangent = ret.newAccImpulseTangent;
            new_manifolds.push(manifold);
            if (ret.isColliding) {
                all_returns.push({
                    indexA: manifold.indexA,
                    indexB: manifold.indexB,
                    ret: ret,
                });
            }
        }
        for (let ret of all_returns) {
            const shape1 = shape1_rect ? envState.polygon : envState.circle;
            const shape2 = shape2_rect ? envState.polygon : envState.circle;
            addVelToRigidBody(shape1[ret.indexA], ret.ret.a_dv, ret.ret.a_drv);
            addVelToRigidBody(shape2[ret.indexB], ret.ret.b_dv, ret.ret.b_drv);
        }

        return envState;
    };
    // now make the batches

    const polygonSecondaryManifolds = [];
    if (isPP) {
        const tempNewManifolds = [];
        for (let i = 0; i < manifolds.length; i++) {
            if (manifolds[i].manifoldSecondaryIndex == 0) {
                tempNewManifolds.push(manifolds[i]);
            } else {
                polygonSecondaryManifolds.push(manifolds[i]);
            }
        }

        manifolds = tempNewManifolds;
    }

    const tempArrayOfEmpties = [];
    for (let i = 0; i < totalNumberOfManifolds - manifolds.length; i++) {
        tempArrayOfEmpties.push(null);
    }
    const arrayWithEmpties = tempArrayOfEmpties.concat(manifolds);
    const arrayWithEmptiesSecondary = tempArrayOfEmpties.concat(polygonSecondaryManifolds);
    const actives = [];
    for (let i = 0; i < arrayWithEmpties.length; i++) {
        if (arrayWithEmpties[i] == null) {
            actives.push(false);
        } else {
            if (isPP) {
                actives.push(arrayWithEmpties[i].manifold.active || arrayWithEmptiesSecondary[i].manifold.active);
            } else {
                actives.push(arrayWithEmpties[i].manifold.active);
            }
        }
    }

    const temp = actives.map((item, index: number) => [item, index]).sort();
    const ordering = temp.map(([item, index]) => index) as number[];
    const batchSize = staticEnvParams.solverBatchSize;
    const nBatches = Math.ceil(arrayWithEmpties.length / batchSize);
    for (let i = 0; i < nBatches * batchSize - arrayWithEmpties.length; i++) {
        ordering.push(-1);
    }
    const arrOfBatches = nj.array(ordering).reshape(batchSize, nBatches).T;

    const resolveBatches = (envState: EnvState, arrayWithEmpties: (ManifoldReturn | null)[]) => {
        for (let batch = 0; batch < nBatches; ++batch) {
            const subset = [];
            for (let i = 0; i < batchSize; ++i) {
                const idx = arrOfBatches.get(batch, i);
                subset.push(idx == -1 ? null : arrayWithEmpties[idx]);
            }
            envState = resolveBatchOfManifolds(envState, subset);
        }
        return envState;
    };

    envState = resolveBatches(envState, arrayWithEmpties);
    if (isPP) {
        envState = resolveBatches(envState, arrayWithEmptiesSecondary);
    }

    return envState;
}

export function getPairwiseInteractionIndices(staticEnvParams: StaticEnvParams) {
    let counter = 0;
    let ccIndices = [];
    let ppIndices = [];
    let cpIndices = [];
    for (let i = 0; i < staticEnvParams.numCircles; i++) {
        for (let j = i + 1; j < staticEnvParams.numCircles; j++) {
            counter++;
            ccIndices.push([i, j]);
        }
    }
    const ncc = counter;
    // polygon polygon
    counter = 0;
    for (let i = 0; i < staticEnvParams.numPolygons; i++) {
        for (let j = i + 1; j < staticEnvParams.numPolygons; j++) {
            if (i < staticEnvParams.numStaticFixatedPolys && j < staticEnvParams.numStaticFixatedPolys) {
                // don't process collisions between static fixated polygons
                continue;
            }
            counter++;
            ppIndices.push([i, j]);
        }
    }
    const npp = counter;
    // circle polygon
    counter = 0;
    for (let i = 0; i < staticEnvParams.numCircles; i++) {
        for (let j = 0; j < staticEnvParams.numPolygons; j++) {
            counter++;

            cpIndices.push([i, j]);
        }
    }
    const ncp = counter;

    return { ncc, ncp, npp, ccIndices, cpIndices, ppIndices };
}

export class PhysicsEngine {
    staticEnvParams: StaticEnvParams;
    envParams: EnvParams;
    constructor(staticEnvParams: StaticEnvParams, envParams: EnvParams) {
        this.staticEnvParams = staticEnvParams;
        this.envParams = envParams;
    }

    step(envState: EnvState, actions: ndarray): EnvState {
        console.assert(actions.shape[0] == this.staticEnvParams.numThrusters + this.staticEnvParams.numJoints);
        const jointActions = actions.slice([0, this.staticEnvParams.numJoints]);
        const thrusterActions = actions.slice(this.staticEnvParams.numJoints);

        const addGrav = (rb: RigidBody): RigidBody => {
            rb.velocity.add(envState.gravity.multiply(rb.inverseMass == 0 ? 0 : this.envParams.dt), false);
            return rb;
        };
        const addRotationalVel = (rb: RigidBody): RigidBody => {
            rb.rotation += rb.angularVelocity * this.envParams.dt;
            return rb;
        };

        const addVel = (rb: RigidBody): RigidBody => {
            rb.position.add(rb.velocity.multiply(rb.inverseMass == 0 ? 0 : this.envParams.dt), false);
            return rb;
        };

        const clipVel = (rb: RigidBody): RigidBody => {
            rb.velocity = nj.clip(rb.velocity, -this.envParams.clipVelocity, this.envParams.clipVelocity);
            return rb;
        };

        const addAndClipVel = (rb: RigidBody): RigidBody => {
            rb = addVel(rb);
            rb = addRotationalVel(rb);
            rb = clipVel(rb);
            return rb;
        };

        envState.polygon = applyToRigidBodyArray(envState.polygon, addGrav);
        envState.circle = applyToRigidBodyArray(envState.circle, addGrav);
        // collisions
        // circle circle:
        const all_returns_cc = [];
        const all_returns_pp = [];
        const all_returns_cp = [];

        const { ncc, ncp, npp, ccIndices, cpIndices, ppIndices } = getPairwiseInteractionIndices(this.staticEnvParams);

        // circle circle
        for (let counter = 0; counter < ncc; counter++) {
            const [i, j] = ccIndices[counter];
            const c1 = envState.circle[i];
            const c2 = envState.circle[j];
            if (!c1.active || !c2.active) {
                continue;
            }

            const oldMan = envState.accCCManifolds[counter];
            const manifold = generateManifoldCircleCircle(c1, c2, oldMan);
            if (manifold.active) {
                all_returns_cc.push({
                    indexA: i,
                    indexB: j,
                    manifold: manifold,
                    manifoldIndex: counter,
                    manifoldSecondaryIndex: 0,
                });
            }
        }
        // polygon polygon

        for (let counter = 0; counter < npp; counter++) {
            const [i, j] = ppIndices[counter];
            const p1 = envState.polygon[i];
            const p2 = envState.polygon[j];
            if (!p1.active || !p2.active) {
                continue;
            }

            const oldManPolyPoly = envState.accRRManifolds[counter];
            const manifold = generateManifoldPolygonPolygon(p1, p2, oldManPolyPoly);
            const _add = (cm: CollisionManifold, secondaryIndex: number) => {
                return {
                    manifold: cm,
                    indexA: i,
                    indexB: j,
                    manifoldIndex: counter,
                    manifoldSecondaryIndex: secondaryIndex,
                };
            };
            if (manifold.cm1.active || manifold.cm2.active) {
                // it is much easier if we have both because of the batching calculation.
                all_returns_pp.push(_add(manifold.cm1, 0));
                all_returns_pp.push(_add(manifold.cm2, 1));
            }
        }
        // circle polygon
        for (let counter = 0; counter < ncp; counter++) {
            const [i, j] = cpIndices[counter];
            const c = envState.circle[i];
            const p = envState.polygon[j];
            if (!c.active || !p.active) {
                continue;
            }
            const oldMan = envState.accCRManifolds[counter];
            const manifold = generateManifoldCirclePolygon(c, p, oldMan);
            if (manifold.active) {
                all_returns_cp.push({
                    indexA: i,
                    indexB: j,
                    manifold: manifold,
                    manifoldIndex: counter,
                    manifoldSecondaryIndex: 0,
                });
            }
        }
        // motors
        const motorReturns = [];
        for (let i = 0; i < this.staticEnvParams.numJoints; i++) {
            const j = envState.joint[i];
            if (!j.active) {
                continue;
            }

            const a = selectShape(envState, j.aIndex);
            const b = selectShape(envState, j.bIndex);
            const motorAction = jointActions.get(i);
            const { a_drv, b_drv } = applyMotor(a, b, j, motorAction, this.envParams);
            motorReturns.push({ a_drv, b_drv, aIndex: j.aIndex, bIndex: j.bIndex });
        }
        for (let i = 0; i < motorReturns.length; i++) {
            const ret = motorReturns[i];
            const a = selectShape(envState, ret.aIndex);
            const b = selectShape(envState, ret.bIndex);
            a.angularVelocity += ret.a_drv;
            b.angularVelocity += ret.b_drv;
        }
        // thrusters
        const thruster_returns = [];
        for (let i = 0; i < this.staticEnvParams.numThrusters; ++i) {
            const t = envState.thruster[i];
            if (!t.active) {
                continue;
            }
            const thrusterAction = thrusterActions.get(i);
            const parentShape = selectShape(envState, t.objectIndex);
            const posAfterTransform = matmul(rmat(parentShape.rotation), t.relativePosition);
            t.globalPosition = posAfterTransform.add(parentShape.position);
            if (thrusterAction == 0) continue;
            const rotation = parentShape.rotation + t.rotation;
            const dir = nj.array([Math.cos(rotation), Math.sin(rotation)]);
            const force = t.power * this.envParams.baseThrusterPower * this.envParams.dt * thrusterAction;
            const drv = parentShape.inverseInertia * vvCross(posAfterTransform, dir) * force;
            const dv = dir.multiply(force * parentShape.inverseMass);
            thruster_returns.push({ index: t.objectIndex, dv: dv, drv: drv });
        }
        for (let i = 0; i < thruster_returns.length; i++) {
            const ret = thruster_returns[i];
            const rb = selectShape(envState, ret.index);
            rb.velocity.add(ret.dv, false);
            rb.angularVelocity += ret.drv;
        }

        // warm starting:
        if (this.staticEnvParams.doWarmStarting) {
            envState = applyWarmStarting(envState, all_returns_pp, this.staticEnvParams, true, true);
            envState = applyWarmStarting(envState, all_returns_cp, this.staticEnvParams, false, true);
            envState = applyWarmStarting(envState, all_returns_cc, this.staticEnvParams, false, false);
            envState = applyWarmStartingJoints(envState, this.staticEnvParams);
        }

        // resolving the manifolds
        const doSingleManifoldStep = (
            envState: EnvState,
            all_returns_cc: ManifoldReturn[],
            all_returns_pp: ManifoldReturn[],
            all_returns_cp: ManifoldReturn[]
        ) => {
            envState = resolveAndApplyImpulse(envState, all_returns_pp, this.staticEnvParams, true, true, this.envParams, npp);
            envState = resolveAndApplyImpulse(envState, all_returns_cp, this.staticEnvParams, false, true, this.envParams, ncp);
            envState = resolveAndApplyImpulse(envState, all_returns_cc, this.staticEnvParams, false, false, this.envParams, ncc);

            for (let i = 0; i < all_returns_cc.length; i++) {
                const idx = all_returns_cc[i].manifoldIndex;
                envState.accCCManifolds[idx] = all_returns_cc[i].manifold;
            }

            for (let i = 0; i < all_returns_cp.length; i++) {
                const idx = all_returns_cp[i].manifoldIndex;
                envState.accCRManifolds[idx] = all_returns_cp[i].manifold;
            }

            for (let i = 0; i < all_returns_pp.length; i++) {
                const idx = all_returns_pp[i].manifoldIndex;
                if (all_returns_pp[i].manifoldSecondaryIndex == 0) envState.accRRManifolds[idx].cm1 = all_returns_pp[i].manifold;
                else envState.accRRManifolds[idx].cm2 = all_returns_pp[i].manifold;
            }

            // put back the warm start manifolds
            return envState;
        };

        for (let i = 0; i < this.staticEnvParams.numSolverIterations; i++) {
            // joints
            envState = doResolveJoints(envState, this.envParams, this.staticEnvParams);
            // collisions
            envState = doSingleManifoldStep(envState, all_returns_cc, all_returns_pp, all_returns_cp);
        }
        // apply velocity to position, and clip velocity while we're at it
        envState.polygon = applyToRigidBodyArray(envState.polygon, addAndClipVel);
        envState.circle = applyToRigidBodyArray(envState.circle, addAndClipVel);

        envState = recalculateGlobalPositions(envState);

        envState.terminal = computeTerminal(envState, all_returns_cc, all_returns_pp, all_returns_cp);
        return envState;
    }
}

function computeTerminal(
    envState: EnvState,
    all_returns_cc: ManifoldReturn[],
    all_returns_pp: ManifoldReturn[],
    all_returns_cp: ManifoldReturn[]
): number {
    const checkVal = (manifoldReturn: ManifoldReturn, arr1: RigidBody[], arr2: RigidBody[]) => {
        const s1 = arr1[manifoldReturn.indexA],
            s2 = arr2[manifoldReturn.indexB];
        const roleMult = s1.role * s2.role;
        if (manifoldReturn.manifold.active && s1.active && s2.active && (roleMult == 2 || roleMult == 3)) {
            if (roleMult == 2) return 1;
            else if (roleMult == 3) return -1;
            // return true;
        }
        return 0;
    };
    const allCs = [];
    for (let manifold of all_returns_cc) {
        const c = checkVal(manifold, envState.circle, envState.circle);
        if (c != 0) {
            allCs.push(c);
        }
    }
    for (let manifold of all_returns_pp) {
        const c = checkVal(manifold, envState.polygon, envState.polygon);
        if (c != 0) {
            allCs.push(c);
        }
    }
    for (let manifold of all_returns_cp) {
        const c = checkVal(manifold, envState.circle, envState.polygon);
        if (c != 0) {
            allCs.push(c);
        }
    }
    if (allCs.length == 0) {
        return 0;
    } else if (allCs.includes(-1)) {
        return -1;
    } else {
        return 1;
    }
}

export function calculateCollisionMatrix(staticEnvParams: StaticEnvParams, joint: Joint[]): ndarray {
    const matrixSize = staticEnvParams.numPolygons + staticEnvParams.numCircles;

    let collisionMatrix = nj.ones([matrixSize, matrixSize]).subtract(nj.identity(matrixSize));
    // let collisionMatrix = nj.ones([matrixSize, matrixSize]);

    for (let repeats = 0; repeats < staticEnvParams.numJoints; ++repeats) {
        for (let ji = 0; ji < staticEnvParams.numJoints; ++ji) {
            const j = joint[ji];
            if (!j.active) continue;
            const a = j.aIndex;
            const b = j.bIndex;
            // so, we know matrix[a, b] = matrix[b, a] = 0, as these do not collide
            collisionMatrix.set(a, b, 0);
            collisionMatrix.set(b, a, 0);
            // now, for any other shape c, if matrix[a, c] = 0, then we must make matrix[c, b] = 0
            for (let c = 0; c < matrixSize; ++c) {
                if (collisionMatrix.get(a, c) == 0) {
                    collisionMatrix.set(c, b, 0);
                }
                if (collisionMatrix.get(b, c) == 0) {
                    collisionMatrix.set(c, a, 0);
                }
                if (collisionMatrix.get(c, a) == 0) {
                    collisionMatrix.set(b, c, 0);
                }
                if (collisionMatrix.get(c, b) == 0) {
                    collisionMatrix.set(a, c, 0);
                }
            }
        }
    }
    return collisionMatrix;
}

export function getEmptyCollisionManifolds(staticEnvParams: StaticEnvParams) {
    const np = staticEnvParams.numPolygons;
    const nc = staticEnvParams.numCircles;
    const num_joints = staticEnvParams.numJoints;
    const num_thrusters = staticEnvParams.numThrusters;

    function _makeEmptyCollisionManifold(): CollisionManifold {
        return {
            normal: nj.zeros(2, "float32"),
            penetration: 0.0,
            collisionPoint: nj.zeros(2, "float32"),
            active: false,
            restitutionVelocityTarget: 0,
            accImpulseNormal: 0.0, //nj.zeros(2, "float32"),
            accImpulseTangent: 0.0, //nj.zeros(2, "float32"),
        };
    }

    function _makeEmptyRectManifold() {
        return {
            cm1: _makeEmptyCollisionManifold(),
            cm2: _makeEmptyCollisionManifold(),
        };
    }

    const nrr_all = (np * (np - 1)) / 2;
    const nrr_sf = (staticEnvParams.numStaticFixatedPolys * (staticEnvParams.numStaticFixatedPolys - 1)) / 2;
    const nrr = nrr_all - nrr_sf;
    const ncc = Math.round((nc * (nc - 1)) / 2);
    return {
        accRRManifolds: [...Array(nrr)].map(_makeEmptyRectManifold),
        accCRManifolds: [...Array(nc * np)].map(_makeEmptyCollisionManifold),
        accCCManifolds: [...Array(ncc)].map(_makeEmptyCollisionManifold),
    };
}

export function scaleScalarToPixels(num: number, staticEnvParams: StaticEnvParams, envParams: EnvParams): number {
    return (num / envParams.numUnits) * staticEnvParams.screenDim.get(0);
}

export function scaleScalarFromPixels(pixels: number, staticEnvParams: StaticEnvParams, envParams: EnvParams): number {
    return (pixels / staticEnvParams.screenDim.get(0)) * envParams.numUnits;
}

export function simToScreen(position: ndarray, staticEnvParams: StaticEnvParams, envParams: EnvParams): ndarray {
    position = position.divide(envParams.numUnits); // position is now between 0 and 1.
    position = position.multiply(staticEnvParams.screenDim); // put it on the screen
    position.set(1, staticEnvParams.screenDim.get(1) - position.get(1));
    return position;
}

export function screenToSim(position: ndarray, staticEnvParams: StaticEnvParams, envParams: EnvParams, invert = true): ndarray {
    let pos = position.clone();
    if (invert) pos.set(1, staticEnvParams.screenDim.get(1) - pos.get(1));
    pos = pos.divide(staticEnvParams.screenDim);
    pos = pos.multiply(envParams.numUnits);
    return pos;
}

export function getRectangleVertices(width: number, height: number): ndarray {
    const half_dim = nj.array([width / 2, height / 2]);
    return nj.stack([
        half_dim.multiply(nj.array([1, 1])),
        half_dim.multiply(nj.array([1, -1])),
        half_dim.multiply(nj.array([-1, -1])),
        half_dim.multiply(nj.array([-1, 1])),
    ]);
}

function calcInverseInertiaCircle(radius: number, density: number) {
    const inertia = ((Math.PI * Math.pow(radius, 4)) / 4) * density;
    return 1 / inertia;
}

function calcInverseMassCircle(radius: number, density: number) {
    const mass = radius * radius * Math.PI * density;
    return 1 / mass;
}

function calcInverseInertiaPolygon(vertices: ndarray, nVertices: number, density: number) {
    function calcTriangleInertia(p1: ndarray, p2: ndarray): number {
        const D = vvCross(p1, p2);
        const intx2 = p1.get(0) * p1.get(0) + p2.get(0) * p1.get(0) + p2.get(0) * p2.get(0);
        const inty2 = p1.get(1) * p1.get(1) + p2.get(1) * p1.get(1) + p2.get(1) * p2.get(1);

        const I = ((0.25 * D) / 3.0) * (intx2 + inty2);

        return Math.abs(I);
    }

    let sum = 0;
    for (let i = 0; i < nVertices; i++) {
        const v1 = vertices.pick(i);
        const v2 = vertices.pick((i + 1) % nVertices);
        const I = calcTriangleInertia(v1, v2);
        sum += I;
    }
    sum = sum * density;
    return 1 / sum;
}

function calcInverseMassPolygon(vertices: ndarray, nVertices: number, density: number) {
    function calcTriangleMass(p1: ndarray, p2: ndarray, p3: ndarray) {
        let width = norm(p2.subtract(p1));
        width = width == 0 ? 1 : width;
        const t = p2.subtract(p1).divide(width);
        const a = p1.add(t.multiply(vvDot(p3.subtract(p1), t)));

        const height = norm(p3.subtract(a));

        return 0.5 * width * height;
    }

    const nTriangles = nVertices - 2;
    let sum = 0;
    let vertexSum = nj.zeros(2, "float32");
    for (let i = 0; i < nTriangles; ++i) {
        sum += calcTriangleMass(vertices.pick(0), vertices.pick(i + 1), vertices.pick(i + 2));
    }
    for (let i = 0; i < nVertices; ++i) {
        vertexSum.add(vertices.pick(i), false);
    }

    sum = sum * density;
    vertexSum = vertexSum.divide(nVertices);

    return { inverseMass: 1 / sum, com: vertexSum };
}

export function recalculateInverseMassAndInertiaPolygon(poly: RigidBody): RigidBody {
    const { inverseMass, com } = calcInverseMassPolygon(poly.vertices, poly.nVertices, poly.density);
    if (poly.inverseMass == 0) {
        return poly;
    }
    // recenter
    if (1) {
        poly.position.add(com, false);
        // now recenter each vertex
        for (let i = 0; i < poly.nVertices; ++i) {
            const newVal = poly.vertices.pick(i).subtract(com);
            poly.vertices.set(i, 0, newVal.get(0));
            poly.vertices.set(i, 1, newVal.get(1));
        }
    }

    // now calculate inertia:
    const inverseInertia = calcInverseInertiaPolygon(poly.vertices, poly.nVertices, poly.density);

    poly.inverseMass = inverseMass;
    poly.inverseInertia = inverseInertia;
    return poly;
}

export function recalculateInverseMassAndInertiaCircle(circle: RigidBody): RigidBody {
    if (circle.inverseMass == 0) {
        return circle;
    }
    circle.inverseMass = calcInverseMassCircle(circle.radius, circle.density);
    circle.inverseInertia = calcInverseInertiaCircle(circle.radius, circle.density);
    return circle;
}

export function recalculateAllInverseMassInertia(envState: EnvState): EnvState {
    for (let i = 0; i < envState.polygon.length; ++i) {
        envState.polygon[i] = recalculateInverseMassAndInertiaPolygon(envState.polygon[i]);
    }
    for (let i = 0; i < envState.circle.length; ++i) {
        envState.circle[i] = recalculateInverseMassAndInertiaCircle(envState.circle[i]);
    }
    return envState;
}

export function makeSingleEmptyRigidBody(staticEnvParams: StaticEnvParams): RigidBody {
    return {
        position: nj.zeros(2, "float32"),
        velocity: nj.zeros(2, "float32"),
        angularVelocity: 0.0,
        rotation: 0.0,
        inverseMass: 0.0,
        inverseInertia: 0.0,
        restitution: 0.0,
        friction: 0.0,
        vertices: nj.zeros([staticEnvParams.maxPolygonVertices, 2], "float32"),
        nVertices: 0.0,
        radius: 0.0,
        collisionMode: 1,
        active: false,
        density: 1.0,
        highlighted: false,
        role: 0,
        transparent: false,
    };
}

export function makeSingleEmptyJoint() {
    return {
        aIndex: 0,
        bIndex: 0,
        aRelativePos: nj.zeros(2, "float32"),
        bRelativePos: nj.zeros(2, "float32"),
        globalPosition: nj.zeros(2, "float32"),
        active: false,

        // Accumulated impulses
        accImpulse: nj.zeros(2, "float32"),
        accRImpulse: 0,

        // Motor
        motorSpeed: 0.0,
        motorPower: 0.0,
        motorOn: false,

        // Revolute Joint
        motorHasJointLimits: false,
        minRotation: 0.0,
        maxRotation: 0.0,

        // Fixed joint
        isFixedJoint: false,
        rotation: 0.0,

        // Env:
        motorBinding: 0,
        // UI:
        highlighted: false,
        transparent: false,
    };
}

export function makeSingleEmptyThruster() {
    return {
        objectIndex: 0,
        relativePosition: nj.zeros(2, "float32"),
        rotation: 0.0,
        power: 0.0,
        globalPosition: nj.zeros(2, "float32"),
        active: false,

        // Env:
        thrusterBinding: 0,
        // UI:
        highlighted: false,
        transparent: false,
    };
}

export function createEmptyEnv(staticEnvParams: StaticEnvParams, envParams: EnvParams): EnvState {
    const nc = staticEnvParams.numCircles;
    const np = staticEnvParams.numPolygons;
    const numJoints = staticEnvParams.numJoints;
    const numThrusters = staticEnvParams.numThrusters;
    const emptyCollisionManifolds = getEmptyCollisionManifolds(staticEnvParams);
    function _makeEmptyRigidBodyArray(num: number) {
        return [...Array(num)].map(() => makeSingleEmptyRigidBody(staticEnvParams));
    }
    function makeEmptyJointArray(num: number) {
        return [...Array(num)].map(makeSingleEmptyJoint);
    }

    function makeEmptyThrusterArray(num: number) {
        return [...Array(num)].map(makeSingleEmptyThruster);
    }

    let baseSimState = {
        polygon: _makeEmptyRigidBodyArray(np),
        circle: _makeEmptyRigidBodyArray(nc),
        joint: makeEmptyJointArray(numJoints),
        thruster: makeEmptyThrusterArray(numThrusters),
        collisionMatrix: nj.zeros([np + nc, np + nc], "int8"),
        accRRManifolds: emptyCollisionManifolds.accRRManifolds,
        accCRManifolds: emptyCollisionManifolds.accCRManifolds,
        accCCManifolds: emptyCollisionManifolds.accCCManifolds,
        gravity: nj.array([0.0, -9.81]),
        terminal: 0,
    };

    baseSimState.collisionMatrix = calculateCollisionMatrix(staticEnvParams, baseSimState.joint);

    const _addFixedPolygon = (pos: ndarray, index: number) => {
        let vertices;
        if (index == 0) {
            vertices = nj.array([
                [2.5, 5.2],
                [2.5, -5.2],
                [-2.5, -5.2],
                [-2.5, 5.2],
            ]);
        } else if (index == 1) {
            vertices = nj.array([
                [-5, 5],
                [-0.0, 5], // I think this is cleaner if at -0.0: -0.05
                [-0.0, 0], // I think this is cleaner if at -0.0: -0.05
                [-5, 0],
            ]);
        } else if (index == 2) {
            vertices = nj.array([
                [5, 5],
                [10.0, 5],
                [10.0, 0],
                [5, 0],
            ]);
        } else if (index == 3) {
            vertices = nj.array([
                [2.5, 5.2],
                [2.5, -5.2],
                [-2.5, -5.2],
                [-2.5, 5.2],
            ]);
        }
        baseSimState.polygon[index] = Object.assign(baseSimState.polygon[index], {
            position: pos, //
            active: true,
            vertices: vertices,
            nVertices: 4,
            inverseMass: 0,
            inverseInertia: 0,
            restitution: 0,
            friction: 1,
        });
    };

    _addFixedPolygon(nj.array([2.5, -4.8]), 0);
    _addFixedPolygon(nj.array([0.0, 0.0]), 1);
    _addFixedPolygon(nj.array([0.0, 0.0]), 2);
    _addFixedPolygon(nj.array([2.5, 0.2 + 10]), 3);

    baseSimState = recalculateAllInverseMassInertia(baseSimState);
    baseSimState = recalculateGlobalPositions(baseSimState);
    baseSimState.collisionMatrix = calculateCollisionMatrix(staticEnvParams, baseSimState.joint);
    return baseSimState;
}

export function checkParamsMatchSimState(staticEnvParams: StaticEnvParams, envState: EnvState): boolean {
    if (staticEnvParams.numCircles != envState.circle.length) {
        console.assert(false, "numCircles");
        return false;
    }
    if (staticEnvParams.numPolygons != envState.polygon.length) {
        console.assert(false, "numPolygons");
        return false;
    }
    if (staticEnvParams.numJoints != envState.joint.length) {
        console.assert(false, "numJoints");
        return;
    }
    if (staticEnvParams.numThrusters != envState.thruster.length) {
        console.assert(false, "numThrusters");
        return;
    }
    return true;
}
