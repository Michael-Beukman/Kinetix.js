import nj, { ndarray } from "@d4c/numjs";
import {
    defaultEnvParams,
    defaultStaticEnvParams,
    Joint,
    RigidBody,
    EnvParams,
    EnvState,
    StaticEnvParams,
    Thruster,
} from "../js2d/env_state";
import { CompressedParams, dictOfString, LoadReturn } from "../js2d/types";
import { calculateCollisionMatrix, createEmptyEnv } from "../js2d/engine";
import { areStaticEnvParamsSame, staticEnvParamsBySize } from "../js2d/param_data";
import { copyNestedObj } from "../js2d/utils";
const keysToIgnore = ["numUnits", "highlighted", "transparent", "terminal", "downscale"];
export function snakeToCamel(s: string): string {
    let ans = s.replace(/([-_][a-z])/gi, ($1) => {
        return $1.toUpperCase().replace("-", "").replace("_", "");
    });
    if (ans.indexOf("Av") != -1) {
        ans = ans.replace("Av", "AV");
    }
    if (ans.indexOf("Rjoint") != -1) {
        ans = ans.replace("Rjoint", "RJoint");
    }
    if (ans.indexOf("Fjoint") != -1) {
        ans = ans.replace("Fjoint", "FJoint");
    }
    return ans;
}

export function camelToSnake(s: string): string {
    if (s === "accRImpulse") {
        return "acc_r_impulse";
    }
    return s
        .replace(/[\w]([A-Z])/g, function (m) {
            return m[0] + "_" + m[1];
        })
        .toLowerCase();
}

export function toArray(obj: dictOfString) {
    if (obj.hasOwnProperty("0")) {
        if (obj["0"].hasOwnProperty("0")) {
            // 2D array
            const arr = [];
            for (let outerKey in obj) {
                const temp = [];
                for (let innerKey in obj[outerKey]) {
                    const val = obj[outerKey][innerKey];
                    temp.push(val == false ? 0 : val == true ? 1 : val);
                }
                arr.push(temp);
            }
            return nj.array(arr);
        } else {
            // 1D array
            const arr = [];
            for (let key in obj) {
                arr.push(obj[key]);
            }
            return nj.array(arr);
        }
    } else {
        return obj;
    }
}

const _loadObject = <T>(json: dictOfString): T => {
    const container: dictOfString = {};
    for (let key in json) {
        const newKey = snakeToCamel(key);
        container[newKey] = toArray(json[key]);
    }
    return container as T;
};
export function loadFromJSON(w: number, h: number, to_load: dictOfString, compressed: boolean = false) {
    let envParams: EnvParams, staticEnvParams: StaticEnvParams;
    if (compressed) {
        envParams = compressedParamsToEnvParams(to_load["env_params"]);
        staticEnvParams = compressedParamsToStaticEnvParams(to_load["static_env_params"]);
    } else {
        envParams = _loadObject<EnvParams>(to_load["env_params"]);
        staticEnvParams = _loadObject<StaticEnvParams>(to_load["static_env_params"]);
    }

    const emptyState = createEmptyEnv(staticEnvParams, envParams);
    for (let i = 0; i < staticEnvParams.numPolygons; i++) {
        const poly = _loadObject<RigidBody>(to_load["env_state"]["polygon"][i]);
        emptyState.polygon[i] = poly;
    }

    for (let i = 0; i < staticEnvParams.numCircles; ++i) {
        const circle = _loadObject<RigidBody>(to_load["env_state"]["circle"][i]);
        emptyState.circle[i] = circle;
    }

    for (let i = 0; i < staticEnvParams.numJoints; ++i) {
        const joint = _loadObject<Joint>(to_load["env_state"]["joint"][i]);
        emptyState.joint[i] = joint;
    }
    for (let i = 0; i < staticEnvParams.numThrusters; ++i) {
        const thruster = _loadObject<Thruster>(to_load["env_state"]["thruster"][i]);
        emptyState.thruster[i] = thruster;
    }

    console.assert(emptyState.accRRManifolds.length % 2 == 0);
    for (let i = 0; i < emptyState.accRRManifolds.length; i += 2) {
        emptyState.accRRManifolds[i / 2].cm1 = _loadObject(to_load["env_state"]["acc_rr_manifolds"][i]);
        emptyState.accRRManifolds[i / 2].cm2 = _loadObject(to_load["env_state"]["acc_rr_manifolds"][i + 1]);
    }
    for (let i = 0; i < emptyState.accCRManifolds.length; ++i) {
        emptyState.accCRManifolds[i] = _loadObject(to_load["env_state"]["acc_cr_manifolds"][i]);
    }

    for (let i = 0; i < emptyState.accCCManifolds.length; ++i) {
        emptyState.accCCManifolds[i] = _loadObject(to_load["env_state"]["acc_cc_manifolds"][i]);
    }

    emptyState.gravity = toArray(to_load["env_state"]["gravity"]) as ndarray;
    emptyState.collisionMatrix = toArray(to_load["env_state"]["collision_matrix"]) as ndarray;

    envParams.numUnits = staticEnvParams.screenDim.get(0) / envParams.pixelsPerUnit;
    staticEnvParams.screenDim = nj.array([w, h]);

    const oldSimParams = defaultEnvParams;
    const oldStaticSimParams = defaultStaticEnvParams;
    const checkIfObjectsMatchKeysOneWay = (objA: any, objB: any): boolean => {
        for (let key in objA) {
            if (keysToIgnore.includes(key)) {
                continue;
            }
            if (!objB.hasOwnProperty(key)) {
                console.assert(false, "Key not found in object B: " + key);
                return false;
            }
        }
        return true;
    };
    const checkIfObjectsMatchKeys = (objA: any, objB: any): boolean => {
        return checkIfObjectsMatchKeysOneWay(objA, objB) && checkIfObjectsMatchKeysOneWay(objB, objA);
    };

    console.assert(checkIfObjectsMatchKeys(envParams, oldSimParams));
    console.assert(checkIfObjectsMatchKeys(staticEnvParams, oldStaticSimParams));

    return {
        env_state: emptyState,
        env_params: envParams,
        static_env_params: staticEnvParams,
    };
}

const _convertArray = (arr: ndarray, makeBoolean = false): dictOfString => {
    if (arr.shape.length == 0) {
        if (makeBoolean) {
            return arr.get() == 0 ? false : arr.get() == 1 ? true : arr.get();
        }
        return arr.get(0);
    }
    const toSave: dictOfString = {};
    for (let i = 0; i < arr.shape[0]; i++) {
        if (arr.pick(i) instanceof nj.NdArray) {
            toSave[i.toString()] = _convertArray(arr.pick(i), makeBoolean);
        } else {
            toSave[i.toString()] = arr.get(i);
            if (makeBoolean) {
                toSave[i.toString()] = arr.get(i) == 0 ? false : arr.get(i) == 1 ? true : arr.get(i);
            }
        }
    }
    return toSave;
};

const _objectToJson = (obj: any): dictOfString => {
    const container: dictOfString = {};
    for (let key in obj) {
        if (keysToIgnore.includes(key)) {
            continue;
        }
        const newKey = camelToSnake(key);
        let value = obj[key];
        if (key == "screenDim") {
            value = nj.array([500, 500]);
        }
        if (value instanceof nj.NdArray) {
            value = _convertArray(value);
        } else {
        }
        container[newKey] = value;
    }
    return container;
};

export function saveToJSON(
    envState: EnvState,
    envParams: EnvParams,
    staticEnvParams: StaticEnvParams,
    compress: boolean = false
): dictOfString {
    const accManifolds = [];
    for (let man of envState.accRRManifolds) {
        accManifolds.push(_objectToJson(man.cm1));
        accManifolds.push(_objectToJson(man.cm2));
    }

    let envParamsToSave, staticEnvParamsToSave;
    if (compress) {
        envParamsToSave = envParamsToCompressed(envParams);
        staticEnvParamsToSave = staticEnvParamsToCompressed(staticEnvParams);
    } else {
        envParamsToSave = _objectToJson(envParams);
        staticEnvParamsToSave = _objectToJson(staticEnvParams);
    }
    const to_return = {
        env_state: {
            polygon: envState.polygon.map((x) => _objectToJson(x)),
            circle: envState.circle.map((x) => _objectToJson(x)),
            joint: envState.joint.map((x) => _objectToJson(x)),
            thruster: envState.thruster.map((x) => _objectToJson(x)),
            collision_matrix: _convertArray(envState.collisionMatrix, true),
            acc_rr_manifolds: accManifolds, // envState.accRRManifolds.map(_objectToJson),
            acc_cr_manifolds: envState.accCRManifolds.map(_objectToJson),
            acc_cc_manifolds: envState.accCCManifolds.map(_objectToJson),
            gravity: _convertArray(envState.gravity),
        },
        env_params: envParamsToSave,
        static_env_params: staticEnvParamsToSave,
        version: "1.0.0",
    };

    return to_return;
}

export function compressedParamsToStaticEnvParams(compressed: CompressedParams): StaticEnvParams {
    if (compressed.type == "full") {
        console.assert(false);
        return _loadObject<StaticEnvParams>(compressed.params);
    } else {
        console.assert(staticEnvParamsBySize.hasOwnProperty(compressed.size));
        return copyNestedObj(staticEnvParamsBySize[compressed.size as keyof typeof staticEnvParamsBySize]);
    }
}

export function compressedParamsToEnvParams(compressed: CompressedParams): EnvParams {
    if (compressed.type == "full") {
        return _loadObject<EnvParams>(compressed.params);
    } else {
        return copyNestedObj(defaultEnvParams);
    }
}

export function staticEnvParamsToCompressed(staticEnvParams: StaticEnvParams): CompressedParams {
    for (let sizeKey of Object.keys(staticEnvParamsBySize) as Array<keyof typeof staticEnvParamsBySize>) {
        if (areStaticEnvParamsSame(staticEnvParamsBySize[sizeKey], staticEnvParams)) {
            return {
                type: "size",
                size: sizeKey,
                params: null,
            };
        }
    }
    return {
        type: "full",
        size: null,
        params: _objectToJson(staticEnvParams),
    };
}

export function envParamsToCompressed(envParams: EnvParams): CompressedParams {
    return {
        type: "size",
        size: "s",
        params: null,
    };
}
