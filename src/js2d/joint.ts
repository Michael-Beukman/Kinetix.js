import nj from "@d4c/numjs";
import { svCross, clipScalar, matmul, norm, rmat, vvCross, zeroToOne } from "./math";
import { Joint, ndarray, RigidBody, EnvParams, EnvState, StaticEnvParams } from "./env_state";
import { JointReturn, MotorReturn } from "./types";
import { selectShape } from "./utils";

export function recalculateGlobalPositions(envState: EnvState): EnvState {
    for (let i = 0; i < envState.thruster.length; i++) {
        const parentShape = selectShape(envState, envState.thruster[i].objectIndex);
        envState.thruster[i].globalPosition = matmul(rmat(parentShape.rotation), envState.thruster[i].relativePosition).add(
            parentShape.position
        );
    }

    for (let i = 0; i < envState.joint.length; i++) {
        const parentShape = selectShape(envState, envState.joint[i].aIndex);
        envState.joint[i].globalPosition = matmul(rmat(parentShape.rotation), envState.joint[i].aRelativePos).add(parentShape.position);
    }
    return envState;
}
export function getGlobalJointPosition(a: RigidBody, b: RigidBody, aRelativePos: ndarray, bRelativePos: ndarray) {
    const r_a = matmul(rmat(a.rotation), aRelativePos);
    const r_b = matmul(rmat(b.rotation), bRelativePos);
    const a_point = r_a.add(a.position);
    const b_point = r_b.add(b.position);
    const aInvMass = zeroToOne(a.inverseMass);
    const bInvMass = zeroToOne(b.inverseMass);

    let joint_point = a_point
        .divide(aInvMass)
        .add(b_point.divide(bInvMass))
        .divide(1 / aInvMass + 1 / bInvMass);

    if (a.inverseMass == 0) {
        joint_point = a_point;
    } else if (b.inverseMass == 0) {
        joint_point = b_point;
    }
    return {
        joint_point,
        a_point,
        b_point,
        r_a,
        r_b,
    };
}

export function resolveJoint(a: RigidBody, b: RigidBody, joint: Joint, envParams: EnvParams): JointReturn {
    const shouldResolve = !(a.inverseMass == 0 && b.inverseMass == 0) && joint.active && a.active && b.active;
    if (!shouldResolve) {
        return {
            a_dv: nj.zeros(2),
            b_dv: nj.zeros(2),
            a_drv: 0,
            b_drv: 0,
            a_dp: nj.zeros(2),
            b_dp: nj.zeros(2),
            jointPoint: nj.zeros(2),
            accImpulse: nj.zeros(2),
            accRImpulse: 0,
        };
    }

    const sumInvMass = zeroToOne(a.inverseMass + b.inverseMass);
    const sumInvInertia = zeroToOne(a.inverseInertia + b.inverseInertia);
    const { joint_point, a_point, b_point, r_a, r_b } = getGlobalJointPosition(a, b, joint.aRelativePos, joint.bRelativePos);

    const aV = a.velocity.add(svCross(a.angularVelocity, joint_point.subtract(a.position)));
    const bV = b.velocity.add(svCross(b.angularVelocity, joint_point.subtract(b.position)));

    const r_v = bV.subtract(aV);
    let impulse_direction = r_v;
    impulse_direction = impulse_direction.divide(zeroToOne(norm(impulse_direction)));

    const impulse = r_v
        .add(b_point.subtract(a_point).multiply(envParams.baumgarteCoefficientJointsV))
        .divide(
            sumInvMass +
                Math.pow(vvCross(r_a, impulse_direction), 2) * a.inverseInertia +
                Math.pow(vvCross(r_b, impulse_direction), 2) * b.inverseInertia
        )
        .multiply(envParams.jointStiffness);
    // apply impulse
    const a_dv = impulse.multiply(a.inverseMass);
    let a_drv = vvCross(r_a, impulse) * a.inverseInertia;

    const b_dv = impulse.multiply(-1).multiply(b.inverseMass);
    let b_drv = -vvCross(r_b, impulse) * b.inverseInertia;
    // positional correction

    const diff = b_point.subtract(a_point).divide(sumInvMass);
    const a_dp = diff.multiply(a.inverseMass * envParams.baumgarteCoefficientJointsP);

    const b_dp = diff.multiply(b.inverseMass * envParams.baumgarteCoefficientJointsP).multiply(-1);

    // rotational impulses

    const relativeRotation = b.rotation - a.rotation - joint.rotation;
    const targetRelativeRotation = clipScalar(relativeRotation, joint.minRotation, joint.maxRotation);
    const rjBias = (relativeRotation - targetRelativeRotation) * envParams.baumgarteCoefficientRJointLimitAV;

    // for fixed joint
    const fjBias = (b.rotation - a.rotation - joint.rotation) * envParams.baumgarteCoefficientFJointAV;

    // calculate rotational impulse
    const raw_dav = b.angularVelocity + b_drv - a.angularVelocity - a_drv;
    let dav;
    if (joint.isFixedJoint) {
        dav = raw_dav + fjBias;
    } else {
        if (Math.sign(raw_dav) == Math.sign(rjBias)) {
            dav = raw_dav + rjBias;
        } else {
            dav = 0;
        }
    }

    // apply rotational impulse
    let r_impulse = dav / sumInvInertia;
    const isApplyingRImpulse = joint.isFixedJoint || (joint.motorHasJointLimits && targetRelativeRotation != relativeRotation);
    if (!isApplyingRImpulse) r_impulse = 0;

    a_drv += r_impulse * a.inverseInertia;
    b_drv -= r_impulse * b.inverseInertia;

    // don't do WS for joint limits
    let acc_r_impulse = 0;
    if (joint.isFixedJoint) {
        acc_r_impulse = r_impulse + joint.accRImpulse;
    }

    return {
        a_dv,
        b_dv,
        a_drv,
        b_drv,
        a_dp,
        b_dp,
        jointPoint: joint_point,
        accImpulse: impulse.add(joint.accImpulse),
        accRImpulse: acc_r_impulse,
    };
}

export function resolveJointWarmStart(a: RigidBody, b: RigidBody, joint: Joint) {
    const shouldResolve = !(a.inverseMass == 0 && b.inverseMass == 0) && joint.active && a.active && b.active;
    if (!shouldResolve) {
        return {
            a_dv: nj.zeros(2),
            b_dv: nj.zeros(2),
            a_drv: 0,
            b_drv: 0,
        };
    }
    const impulse = joint.accImpulse;
    const r1 = matmul(rmat(a.rotation), joint.aRelativePos);
    const r2 = matmul(rmat(b.rotation), joint.bRelativePos);
    const a_dv = impulse.multiply(a.inverseMass);
    const b_dv = impulse.multiply(-1).multiply(b.inverseMass);
    let a_drv = vvCross(r1, impulse) * a.inverseInertia;
    let b_drv = -vvCross(r2, impulse) * b.inverseInertia;

    const r_impulse = joint.accRImpulse;
    a_drv += r_impulse * a.inverseInertia;
    b_drv -= r_impulse * b.inverseInertia;

    return { a_dv, b_dv, a_drv, b_drv };
}

function getArraysAndIndicesFromSingleJoint(envState: EnvState, joint: Joint, staticEnvParams: StaticEnvParams) {
    const arr1 = joint.aIndex < staticEnvParams.numPolygons ? envState.polygon : envState.circle;
    const arr2 = joint.bIndex < staticEnvParams.numPolygons ? envState.polygon : envState.circle;
    const ia = joint.aIndex < staticEnvParams.numPolygons ? joint.aIndex : joint.aIndex - staticEnvParams.numPolygons;
    const ib = joint.bIndex < staticEnvParams.numPolygons ? joint.bIndex : joint.bIndex - staticEnvParams.numPolygons;

    return { arr1, arr2, ia, ib };
}

export function applyImpulsesToJoints(
    envState: EnvState,
    joint: Joint,
    staticEnvParams: StaticEnvParams,
    a_dv: ndarray,
    a_drv: number,
    b_dv: ndarray,
    b_drv: number,
    a_dp: ndarray | null,
    b_dp: ndarray | null
) {
    const { arr1, arr2, ia, ib } = getArraysAndIndicesFromSingleJoint(envState, joint, staticEnvParams);

    arr1[ia].velocity.add(a_dv, false);
    arr1[ia].angularVelocity += a_drv;
    if (a_dp != null) arr1[ia].position.add(a_dp, false);

    arr2[ib].velocity.add(b_dv, false);
    arr2[ib].angularVelocity += b_drv;
    if (b_dp != null) arr2[ib].position.add(b_dp, false);

    return envState;
}

export function doResolveJoints(envState: EnvState, envParams: EnvParams, staticEnvParams: StaticEnvParams): EnvState {
    for (let j = 0; j < staticEnvParams.numJoints; ++j) {
        const joint = envState.joint[j];
        if (!joint.active) continue;

        const a = selectShape(envState, joint.aIndex);
        const b = selectShape(envState, joint.bIndex);

        const {
            a_dv,
            b_dv,
            a_drv,
            b_drv,
            a_dp,
            b_dp,
            jointPoint: joint_point,
            accImpulse: acc_impulse,
            accRImpulse: acc_r_impulse,
        } = resolveJoint(a, b, joint, envParams);

        envState.joint[j].accImpulse = acc_impulse;
        envState.joint[j].accRImpulse = acc_r_impulse;
        envState.joint[j].globalPosition = joint_point;

        envState = applyImpulsesToJoints(envState, joint, staticEnvParams, a_dv, a_drv, b_dv, b_drv, a_dp, b_dp);
    }
    return envState;
}

export function applyMotor(a: RigidBody, b: RigidBody, joint: Joint, motorAction: number, envParams: EnvParams): MotorReturn {
    const shouldResolve = a.active && b.active && joint.active && joint.motorOn && !joint.isFixedJoint && motorAction != 0;
    if (!shouldResolve) {
        return {
            a_drv: 0,
            b_drv: 0,
        };
    }

    const axialMass = 1 / zeroToOne(a.inverseInertia + b.inverseInertia);
    let motorPower = envParams.baseMotorPower * joint.motorPower * envParams.dt * axialMass;
    const avTarget = b.angularVelocity - a.angularVelocity - joint.motorSpeed * motorAction * envParams.baseMotorSpeed;
    const torqueDirection = Math.tanh(avTarget * envParams.motorDecayCoefficient);
    // joint limit
    if (!joint.isFixedJoint && joint.motorHasJointLimits) {
        const relativeRotation = b.rotation - a.rotation - joint.rotation;
        const targetRelativeRotation = clipScalar(
            relativeRotation,
            joint.minRotation + envParams.motorJointLimit,
            joint.maxRotation - envParams.motorJointLimit
        );
        const rjBias = relativeRotation - targetRelativeRotation;
        motorPower *= Math.max(
            rjBias == 0 || !joint.motorHasJointLimits ? 1.0 : Math.max(0, 1 - Math.abs(rjBias / envParams.motorJointLimit)),
            Math.sign(rjBias) != Math.sign(motorAction) ? 1 : 0
        );
    }

    const a_drv = motorPower * torqueDirection * a.inverseInertia;
    const b_drv = -motorPower * torqueDirection * b.inverseInertia;
    return { a_drv, b_drv };
}
