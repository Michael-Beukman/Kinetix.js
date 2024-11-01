import nj from "@d4c/numjs";
import { _assertOneDArray } from "../js2d/math";
import { Joint, ndarray, RigidBody, EnvParams, EnvState, StaticEnvParams, Thruster } from "../js2d/env_state";
import * as tf from "@tensorflow/tfjs";
import { selectShape } from "../js2d/utils";
import { getPairwiseInteractionIndices } from "../js2d/engine";

export function processActions(envState: EnvState, actions: ndarray, staticEnvParams: StaticEnvParams): ndarray {
    _assertOneDArray(actions);
    console.assert(actions.shape[0] == staticEnvParams.numMotorBindings + staticEnvParams.numThrusterBindings);
    const newActions = [];
    for (let i = 0; i < envState.joint.length; i++) {
        const joint = envState.joint[i];
        newActions.push(actions.get(joint.motorBinding));
    }

    for (let i = 0; i < envState.thruster.length; ++i) {
        const thruster = envState.thruster[i];
        newActions.push(actions.get(thruster.thrusterBinding + staticEnvParams.numMotorBindings));
    }
    console.assert(newActions.length == envState.joint.length + envState.thruster.length);
    return nj.array(newActions);
}

function doOneHot(cls: number, numClasses: number): ndarray {
    const arr = nj.zeros(numClasses);
    arr.set(cls, 1);
    return arr;
}

function getBaseShapeFeatures(shape: RigidBody, envParams: EnvParams): number[] {
    const cos = Math.cos(shape.rotation);
    const sin = Math.sin(shape.rotation);
    const roleOneHot = doOneHot(shape.role, envParams.numShapeRoles).tolist() as number[];
    return [
        shape.position.get(0),
        shape.position.get(1),
        shape.velocity.get(0),
        shape.velocity.get(1),
        shape.inverseMass,
        shape.inverseInertia,
        shape.density,
        Math.tanh(shape.angularVelocity / 10),
    ]
        .concat(roleOneHot)
        .concat([sin, cos, shape.friction, shape.restitution]);
}
function addCircleFeatures(baseFeatures: number[], shape: RigidBody, envParams: EnvParams, staticEnvParams: StaticEnvParams): number[] {
    return baseFeatures.concat([shape.radius, 1]);
}
function addPolygonFeatures(baseFeatures: number[], shape: RigidBody, envParams: EnvParams, staticEnvParams: StaticEnvParams): number[] {
    const vertices = [];
    for (let i = 0; i < staticEnvParams.maxPolygonVertices; i++) {
        if (i < shape.nVertices) {
            vertices.push(shape.vertices.get(i, 0));
            vertices.push(shape.vertices.get(i, 1));
        } else {
            vertices.push(-1);
            vertices.push(-1);
        }
    }
    return baseFeatures.concat([0].concat(vertices).concat([shape.nVertices <= 3 ? 1 : 0]));
}

function makeJointFeatures(joint: Joint, envParams: EnvParams, staticEnvParams: StaticEnvParams) {
    function _createOneWayJointFeatures(direction: number) {
        let fromPos, toPos;
        if (direction == 0) {
            fromPos = joint.aRelativePos;
            toPos = joint.bRelativePos;
        } else {
            fromPos = joint.bRelativePos;
            toPos = joint.aRelativePos;
        }
        const rotation_sin = Math.sin(joint.rotation);
        const rotation_cos = Math.cos(joint.rotation);
        const rotation_max_sin = joint.motorHasJointLimits ? Math.sin(joint.maxRotation) : 0;
        const rotation_max_cos = joint.motorHasJointLimits ? Math.cos(joint.maxRotation) : 0;

        const rotation_min_sin = joint.motorHasJointLimits ? Math.sin(joint.minRotation) : 0;
        const rotation_min_cos = joint.motorHasJointLimits ? Math.cos(joint.minRotation) : 0;

        const rotation_diff_max = joint.motorHasJointLimits ? joint.maxRotation - joint.rotation : 0;
        const rotation_diff_min = joint.motorHasJointLimits ? joint.minRotation - joint.rotation : 0;

        const features = [
            joint.active ? 1 : 0,
            joint.isFixedJoint ? 1 : 0,
            fromPos.get(0),
            fromPos.get(1),
            toPos.get(0),
            toPos.get(1),
            rotation_sin,
            rotation_cos,
        ];
        const oneHot = doOneHot(joint.motorBinding, staticEnvParams.numMotorBindings).tolist() as number[];
        const rjointFeatures = [joint.motorSpeed, joint.motorPower, joint.motorOn ? 1 : 0, joint.motorHasJointLimits ? 1 : 0]
            .concat(oneHot)
            .concat([rotation_min_sin, rotation_min_cos, rotation_max_sin, rotation_max_cos, rotation_diff_min, rotation_diff_max]);
        if (joint.isFixedJoint) {
            for (let i = 0; i < rjointFeatures.length; ++i) {
                rjointFeatures[i] *= 0;
            }
        }
        return features.concat(rjointFeatures);
    }

    const featuresOne = _createOneWayJointFeatures(0);
    const featuresTwo = _createOneWayJointFeatures(1);

    return {
        features: [featuresOne, featuresTwo],
        indexes: [
            [joint.bIndex, joint.aIndex],
            [joint.aIndex, joint.bIndex],
        ],
        mask: [joint.active, joint.active],
    };
}

function makeThrusterFeatures(thruster: Thruster, envParams: EnvParams, staticEnvParams: StaticEnvParams) {
    const sin = Math.sin(thruster.rotation);
    const cos = Math.cos(thruster.rotation);
    const thrusterFeatures = [thruster.active ? 1 : 0, thruster.relativePosition.get(0), thruster.relativePosition.get(1)]
        .concat(doOneHot(thruster.thrusterBinding, staticEnvParams.numThrusterBindings).tolist() as number[])
        .concat([sin, cos, thruster.power]);
    return {
        features: thrusterFeatures,
        indexes: thruster.objectIndex,
        mask: thruster.active,
    };
}

export function makeObservation(envState: EnvState, envParams: EnvParams, staticEnvParams: StaticEnvParams, isSymbolic: boolean) {
    if (isSymbolic) {
        return makeSymbolicObservation(envState, envParams, staticEnvParams);
    }
    return makeEntityObservation(envState, envParams, staticEnvParams);
}

function makeEntityObservation(envState: EnvState, envParams: EnvParams, staticEnvParams: StaticEnvParams) {
    const allCircleFeatures = [];
    const allPolygonFeatures = [];
    const allJointFeatures = [];
    const allThrusterFeatures = [];

    const allCircleMask = [];
    const allPolygonMask = [];
    const allJointMask = [];
    const allThrusterMask = [];

    const allThrusterIndexes = [];
    const allJointIndexes = [];

    for (let i = 0; i < staticEnvParams.numCircles; ++i) {
        const c = envState.circle[i];
        allCircleFeatures.push(
            addCircleFeatures(getBaseShapeFeatures(c, envParams), c, envParams, staticEnvParams).concat([envState.gravity.get(1) / 10])
        );
        allCircleMask.push(c.active);
    }
    for (let i = 0; i < staticEnvParams.numPolygons; ++i) {
        const p = envState.polygon[i];
        allPolygonFeatures.push(
            addPolygonFeatures(getBaseShapeFeatures(p, envParams), p, envParams, staticEnvParams).concat([envState.gravity.get(1) / 10])
        );
        allPolygonMask.push(p.active);
    }
    for (let i = 0; i < staticEnvParams.numJoints; ++i) {
        const j = envState.joint[i];
        const jf = makeJointFeatures(j, envParams, staticEnvParams); // this is of shape (2, K)
        allJointFeatures.push(jf.features);
        allJointMask.push(jf.mask);
        allJointIndexes.push(jf.indexes);
    }
    for (let i = 0; i < staticEnvParams.numThrusters; ++i) {
        const t = envState.thruster[i];
        const tf = makeThrusterFeatures(t, envParams, staticEnvParams);
        allThrusterFeatures.push(tf.features);
        allThrusterMask.push(tf.mask);
        allThrusterIndexes.push(tf.indexes);
    }
    const nShapes = staticEnvParams.numCircles + staticEnvParams.numPolygons;

    function _makeFullAttentionMask(fillValue = true) {
        const arr = [];
        for (let i = 0; i < nShapes; ++i) {
            const temp = [];
            for (let j = 0; j < nShapes; ++j) {
                temp.push(fillValue);
            }
            arr.push(temp);
        }
        return arr;
    }
    function _makeMultiHopAttentionMask() {
        const arr = [];
        for (let i = 0; i < nShapes; ++i) {
            const temp = [];
            for (let j = 0; j < nShapes; ++j) {
                temp.push(!(envState.collisionMatrix.get(i, j) == 1)); // inverse of collision mask
            }
            arr.push(temp);
        }
        return arr;
    }
    function _makeOneHopAttentionMask() {
        const arr = _makeFullAttentionMask(false);
        for (let i = 0; i < staticEnvParams.numJoints; ++i) {
            const j = envState.joint[i];
            if (!j.active) continue;
            arr[j.aIndex][j.bIndex] = true;
            arr[j.bIndex][j.aIndex] = true;
        }
        arr[0][0] = false;
        return arr;
    }

    function _makeCollisionManifoldMask() {
        const arr = _makeFullAttentionMask(false);
        const { ncc, ncp, npp, ccIndices, cpIndices, ppIndices } = getPairwiseInteractionIndices(staticEnvParams);
        for (let counter = 0; counter < ncc; counter++) {
            const [i, j] = ccIndices[counter];
            if (!envState.circle[i].active || !envState.circle[j].active) {
                continue;
            }
            if (envState.accCCManifolds[counter].active) {
                const p = staticEnvParams.numPolygons;
                arr[i + p][j + p] = true;
                arr[j + p][i + p] = true;
            }
        }
        for (let counter = 0; counter < npp; counter++) {
            const [i, j] = ppIndices[counter];
            if (!envState.polygon[i].active || !envState.polygon[j].active) {
                continue;
            }
            if (envState.accRRManifolds[counter].cm1.active || envState.accRRManifolds[counter].cm2.active) {
                arr[i][j] = true;
                arr[j][i] = true;
            }
        }
        for (let counter = 0; counter < ncp; counter++) {
            const [i, j] = cpIndices[counter];
            if (!envState.circle[i].active || !envState.polygon[j].active) {
                continue;
            }
            if (envState.accCRManifolds[counter].active) {
                const p = staticEnvParams.numPolygons;
                arr[i + p][j] = true;
                arr[j][i + p] = true;
            }
        }
        return arr;
    }

    function _maskOutInactiveShapes(mask: boolean[][]) {
        for (let i = 0; i < mask.length; ++i) {
            for (let j = 0; j < mask[i].length; ++j) {
                const a = selectShape(envState, i);
                const b = selectShape(envState, j);
                if (!a.active || !b.active) {
                    mask[i][j] = false;
                    mask[j][i] = false;
                }
            }
        }
        return mask;
    }
    const attentionMask = [
        _makeFullAttentionMask(),
        _makeMultiHopAttentionMask(),
        _makeOneHopAttentionMask(),
        _makeCollisionManifoldMask(),
    ];
    for (let i = 0; i < attentionMask.length; ++i) {
        attentionMask[i] = _maskOutInactiveShapes(attentionMask[i]);
    }
    const J = staticEnvParams.numJoints;

    return {
        circles: tf.tensor(allCircleFeatures),
        polygons: tf.tensor(allPolygonFeatures),
        joints: tf
            .tensor(allJointFeatures)
            .transpose([1, 0, 2])
            .reshape([2 * J, -1]), // (2 * J, K)
        thrusters: tf.tensor(allThrusterFeatures),

        circle_mask: tf.tensor(allCircleMask),
        polygon_mask: tf.tensor(allPolygonMask),
        joint_mask: tf.tensor(allJointMask).transpose().flatten(), // shape of (2 * J)
        thruster_mask: tf.tensor(allThrusterMask),
        attention_mask: tf.tensor(attentionMask),

        joint_indexes: tf
            .tensor(allJointIndexes)
            .transpose([1, 0, 2])
            .reshape([2 * J, 2])
            .asType("int32"), // shape of (2 * J, 2)
        thruster_indexes: tf.tensor(allThrusterIndexes).asType("int32"),
    };
}

function makeSymbolicObservation(envState: EnvState, envParams: EnvParams, staticEnvParams: StaticEnvParams) {
    const allCircleFeatures = [];
    const allPolygonFeatures = [];
    const allJointFeatures = [];
    const allThrusterFeatures = [];

    const allCircleMask = [];
    const allPolygonMask = [];
    const allJointMask = [];
    const allThrusterMask = [];

    const allThrusterIndexes = [];
    const allJointIndexes = [];

    for (let i = 0; i < staticEnvParams.numCircles; ++i) {
        const c = envState.circle[i];
        allCircleFeatures.push(addCircleFeatures(getBaseShapeFeatures(c, envParams), c, envParams, staticEnvParams));
        allCircleMask.push(c.active);
    }
    for (let i = 0; i < staticEnvParams.numPolygons; ++i) {
        if ([1, 2, 3].includes(i)) {
            continue;
        }
        const p = envState.polygon[i];
        allPolygonFeatures.push(addPolygonFeatures(getBaseShapeFeatures(p, envParams), p, envParams, staticEnvParams));
        allPolygonMask.push(p.active);
    }
    for (let i = 0; i < staticEnvParams.numJoints; ++i) {
        const j = envState.joint[i];
        const jf = makeJointFeatures(j, envParams, staticEnvParams); // only first one for symbolic

        const oneHotA = doOneHot(j.aIndex, staticEnvParams.numCircles + staticEnvParams.numPolygons).tolist() as number[];
        const oneHotB = doOneHot(j.bIndex, staticEnvParams.numCircles + staticEnvParams.numPolygons).tolist() as number[];
        allJointFeatures.push(jf.features[0].concat(oneHotA).concat(oneHotB));
        allJointMask.push(jf.mask[0]);
        // allJointIndexes.push(jf.indexes);
    }
    for (let i = 0; i < staticEnvParams.numThrusters; ++i) {
        const t = envState.thruster[i];
        const tf = makeThrusterFeatures(t, envParams, staticEnvParams);
        allThrusterFeatures.push(
            tf.features.concat(doOneHot(t.objectIndex, staticEnvParams.numCircles + staticEnvParams.numPolygons).tolist() as number[])
        );
        allThrusterMask.push(tf.mask);
        allThrusterIndexes.push(tf.indexes);
    }

    const zeroInactives = (features: number[][], mask: boolean[]) => {
        for (let i = 0; i < mask.length; ++i) {
            if (!mask[i]) {
                for (let j = 0; j < features[i].length; ++j) {
                    features[i][j] = 0;
                }
            }
        }
        return features;
    };

    const flatten = (arr: number[][]) => {
        const res = [];
        for (let i = 0; i < arr.length; ++i) {
            res.push(...arr[i]);
        }
        return res;
    };
    const features = flatten(zeroInactives(allPolygonFeatures, allPolygonMask))
        .concat(flatten(zeroInactives(allCircleFeatures, allCircleMask)))
        .concat(flatten(zeroInactives(allJointFeatures, allJointMask)))
        .concat(flatten(zeroInactives(allThrusterFeatures, allThrusterMask)))
        .concat([envState.gravity.get(1) / 10]);
    for (let i = 0; i < features.length; ++i) {
        features[i] = features[i] < -10 ? -10 : features[i] > 10 ? 10 : features[i];
    }

    return features;
}

export function observationToFlat(envState: EnvState, obs: any, isSymbolic: boolean) {
    const hidden = tf.zeros([1, 256]);
    // const dones = tf.zeros([1], "bool")
    const dones = tf.zeros([1], "float32");
    if (isSymbolic) {
        return [hidden, dones, tf.tensor(obs)];
    }
    return [
        hidden,
        dones,
        obs.circles,
        obs.polygons,
        obs.joints,
        obs.thrusters,
        obs.circle_mask,
        obs.polygon_mask,
        obs.joint_mask,
        obs.thruster_mask,
        obs.attention_mask,
        obs.joint_indexes,
        obs.thruster_indexes,
    ];
}

export function flatToCorrectOrdering(flatObs: tf.Tensor[], modelInputSpec: tf.TensorInfo[]) {
    const newArr = [...modelInputSpec.map((x) => tf.zeros([1]))];
    for (let i = 0; i < modelInputSpec.length; ++i) {
        const name = (modelInputSpec[i] as any).name; // looks like xs_{i}:xxx
        const idx = parseInt(name.split("_")[1]);
        newArr[i] = flatObs[idx];
    }
    return newArr;
}

export async function processMultiDiscreteActions(flatTensor: tf.Tensor, staticEnvParams: StaticEnvParams) {
    const _singleMotorAction = (action: number) => {
        console.assert(action >= 0 && action <= 2);
        return [0.0, 1.0, -1.0][action];
    };
    const _singleThrusterAction = (action: number) => {
        console.assert(action >= 0 && action <= 1, "Bad action: " + action.toString());
        return [0.0, 1.0][action];
    };
    const _randomSample = (probabilities: number[]) => {
        // Generate a random number between 0 and 1
        const random = Math.random();

        // Keep a cumulative sum of probabilities
        let cumulativeSum = 0;

        for (let i = 0; i < probabilities.length; i++) {
            cumulativeSum += probabilities[i];

            // If the random number is less than the cumulative sum, return the current index
            if (random < cumulativeSum) {
                return i;
            }
        }

        // If no index was selected (due to floating point issues), return the last index
        return probabilities.length - 1;
    };
    let startingPoint = 0;
    const allActions = [];
    const vals = [];

    for (let j = 0; j < staticEnvParams.numMotorBindings; j++) {
        const value = flatTensor.slice(startingPoint, 3);
        vals.push(tf.multinomial(value.as1D(), 1).array());
        startingPoint += 3;
    }
    for (let j = 0; j < staticEnvParams.numThrusterBindings; j++) {
        const value = flatTensor.slice(startingPoint, 2);
        vals.push(tf.multinomial(value.as1D(), 1).array());
        startingPoint += 2;
    }

    const allVals = (await Promise.all(vals)) as number[][];
    for (let j = 0; j < staticEnvParams.numMotorBindings; j++) {
        allActions.push(_singleMotorAction(allVals[j][0]));
    }
    for (let j = 0; j < staticEnvParams.numThrusterBindings; j++) {
        allActions.push(_singleThrusterAction(allVals[staticEnvParams.numMotorBindings + j][0]));
    }

    return nj.array(allActions);
}

export const canRunSymbolicModel = (envState: EnvState, envParams: EnvParams, staticEnvParams: StaticEnvParams) => {
    const obs = makeSymbolicObservation(envState, envParams, staticEnvParams);
    return obs.length == 679;
};
