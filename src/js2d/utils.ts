import { ndarray, EnvState } from "./env_state";

export function copyNestedObj<T>(rb: T): T {
    const keysThatAreArrays = [
        "position",
        "velocity",
        "vertices",
        "collisionPoint",
        "aRelativePos",
        "bRelativePos",
        "globalPosition",
        "accImpulse",
        "relativePosition",
    ];
    let new_rb: { [key: string]: any } = {};
    for (let key in rb) {
        if (rb.hasOwnProperty(key)) {
            if (keysThatAreArrays.includes(key)) {
                (new_rb as any)[key] = (rb[key] as ndarray).clone();
            } else {
                new_rb[key] = rb[key];
            }
        }
    }
    return new_rb as T;
}

export function copySimState(envState: EnvState): EnvState {
    return {
        polygon: envState.polygon.map(copyNestedObj),
        circle: envState.circle.map(copyNestedObj),
        joint: envState.joint.map(copyNestedObj),
        thruster: envState.thruster.map(copyNestedObj),
        collisionMatrix: envState.collisionMatrix.clone(),

        // Impulse accumulation
        accRRManifolds: envState.accRRManifolds.map(copyNestedObj),
        accCRManifolds: envState.accCRManifolds.map(copyNestedObj),
        accCCManifolds: envState.accCCManifolds.map(copyNestedObj),

        // Defaults
        gravity: envState.gravity.clone(), // (2,)
        terminal: envState.terminal,
    };
}

export function selectShape(envState: EnvState, objectIndex: number) {
    return objectIndex < envState.polygon.length ? envState.polygon[objectIndex] : envState.circle[objectIndex - envState.polygon.length];
}
