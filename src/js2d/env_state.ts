import nj from "@d4c/numjs";
import { PolygonPolygonCollisionManifold } from "./types";
// Import necessary types
export type ndarray = nj.NdArray;

export interface RigidBody {
    position: ndarray; // (2,) Centroid
    rotation: number; // Radians
    velocity: ndarray; // (2,) m/s
    angularVelocity: number; // rad/s

    inverseMass: number; // 0 to denote a fixated object with infinite mass (constant velocity)
    inverseInertia: number; // 0 denotes an object with infinite inertia (constant angular velocity)

    friction: number;
    restitution: number; // Restitution with Baumgarte method may create energy if set to 1

    collisionMode: number; // 0 = doesn't collide with 1's. 1 = normal. 2 = collides with everything
    active: boolean;

    // Polygon
    nVertices: number; // >=3 or things blow up
    vertices: ndarray; // (nVertices, 2) Clockwise or things blow up

    // Circle
    radius: number;

    // env
    density: number;
    role: number;
    // UI
    highlighted: boolean;
    transparent: boolean;
}

export interface CollisionManifold {
    normal: ndarray;
    penetration: number;
    collisionPoint: ndarray; // (2,)
    active: boolean;

    // Accumulated impulses
    accImpulseNormal: number;
    accImpulseTangent: number;

    // 'Remember' restitution for the correct bounce
    restitutionVelocityTarget: number;
}

export interface Joint {
    aIndex: number;
    bIndex: number;
    aRelativePos: ndarray; // (2,)
    bRelativePos: ndarray; // (2,)
    globalPosition: ndarray; // (2,) // Cached
    active: boolean;

    // Accumulated impulses
    accImpulse: ndarray; // (2,)
    accRImpulse: number;

    // Motor
    motorSpeed: number;
    motorPower: number;
    motorOn: boolean;

    // Revolute Joint
    motorHasJointLimits: boolean;
    minRotation: number;
    maxRotation: number;

    // Fixed joint
    isFixedJoint: boolean;
    rotation: number;

    // Env:
    motorBinding: number;
    // UI
    highlighted: boolean;

    transparent: boolean;
}

export interface Thruster {
    objectIndex: number;
    relativePosition: ndarray; // (2,)
    rotation: number;
    power: number;
    globalPosition: ndarray; // (2,) // Cached
    active: boolean;

    // Env:
    thrusterBinding: number;
    // UI:
    highlighted: boolean;
    transparent: boolean;
}

export interface EnvState {
    polygon: RigidBody[];
    circle: RigidBody[];
    joint: Joint[];
    thruster: Thruster[];
    collisionMatrix: ndarray; // (numPolygons + numCircles, numPolygons + numCircles)

    // Impulse accumulation
    accRRManifolds: PolygonPolygonCollisionManifold[];
    accCRManifolds: CollisionManifold[];
    accCCManifolds: CollisionManifold[];

    // Defaults
    gravity: ndarray; // (2,)

    // Env:
    terminal: number;
}

export interface EnvParams {
    // Timestep size
    dt: number;

    // Collision and joint coefficients
    slop: number;
    baumgarteCoefficientJointsV: number;
    baumgarteCoefficientJointsP: number;
    baumgarteCoefficientFJointAV: number;
    baumgarteCoefficientRJointLimitAV: number;
    baumgarteCoefficientCollision: number;
    jointStiffness: number;

    // State clipping
    clipPosition: number;
    clipVelocity: number;
    clipAngularVelocity: number;

    // Motors and thrusters
    baseMotorSpeed: number; // rad/s
    baseMotorPower: number;
    baseThrusterPower: number;
    motorDecayCoefficient: number;
    motorJointLimit: number; // rad

    // Other defaults
    baseFriction: number;

    // env params
    pixelsPerUnit: number;
    numUnits: number;
    maxTimesteps: number;
    denseRewardScale: number;
    numShapeRoles: number;
}

export interface StaticEnvParams {
    // State size
    numPolygons: number;
    numCircles: number;
    numJoints: number;
    numThrusters: number;
    maxPolygonVertices: number;

    // Compute amount
    numSolverIterations: number;
    solverBatchSize: number;
    doWarmStarting: boolean;
    numStaticFixatedPolys: number;

    screenDim: ndarray;

    // env params
    maxShapeSize: number;
    numMotorBindings: number;
    numThrusterBindings: number;
    frameSkip: number;
    downscale: number;
}

// Default values for SimParams
export const defaultEnvParams: EnvParams = {
    dt: 1 / 60,
    slop: 0.01,
    baumgarteCoefficientJointsV: 2.0,
    baumgarteCoefficientJointsP: 0.7,
    baumgarteCoefficientFJointAV: 2.0,
    baumgarteCoefficientRJointLimitAV: 5.0,
    baumgarteCoefficientCollision: 0.2,
    jointStiffness: 0.6,
    clipPosition: 15,
    clipVelocity: 100,
    clipAngularVelocity: 50,
    baseMotorSpeed: 6.0,
    baseMotorPower: 900.0,
    baseThrusterPower: 10.0,
    motorDecayCoefficient: 0.1,
    motorJointLimit: 0.1,
    baseFriction: 0.4,
    pixelsPerUnit: 100,
    numUnits: 5,

    maxTimesteps: 5,
    denseRewardScale: 1.0,
    numShapeRoles: 4,
};

// Default values for StaticSimParams
export const defaultStaticEnvParams: StaticEnvParams = {
    numPolygons: 12,
    numCircles: 4,
    numJoints: 6,
    numThrusters: 2,
    maxPolygonVertices: 4,
    numSolverIterations: 10,
    solverBatchSize: 16,
    doWarmStarting: true,
    numStaticFixatedPolys: 4,
    screenDim: nj.array([500, 500]),

    maxShapeSize: 2,
    numMotorBindings: 4,
    numThrusterBindings: 2,
    frameSkip: 1,
    downscale: 1,
};
