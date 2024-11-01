import { ndarray } from "./env_state";
import nj from "@d4c/numjs";
export const _assertOneDArray = (v: ndarray) => {
    console.assert(v.shape.length == 1);
};
export const _assertTwoDArray = (v: ndarray) => {
    console.assert(v.shape.length == 2);
};

function arraysEqual(a: Array<any>, b: Array<any>) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (a.length !== b.length) return false;

    // If you don't care about the order of the elements inside
    // the array, you should sort both arrays here.
    // Please note that calling sort on an array will modify that array.
    // you might want to clone your array first.

    for (var i = 0; i < a.length; ++i) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function vvDot(a: ndarray, b: ndarray) {
    _assertOneDArray(a);
    _assertOneDArray(b);
    console.assert(a.shape[0] == 2);
    return a.get(0) * b.get(0) + a.get(1) * b.get(1);
}

export function vvCross(a: ndarray, b: ndarray) {
    _assertOneDArray(a);
    _assertOneDArray(b);
    console.assert(a.shape[0] == 2);
    return a.get(0) * b.get(1) - a.get(1) * b.get(0);
}

export function svCross(x: number, v: ndarray): ndarray {
    return nj.array([-x * v.get(1), x * v.get(0)]);
}

export function vsCross(v: ndarray, x: number): ndarray {
    return nj.array([x * v.get(1), -x * v.get(0)]);
}

export function matmul(matrix: ndarray, vector: ndarray) {
    _assertOneDArray(vector);
    _assertTwoDArray(matrix);
    console.assert(matrix.shape[0] == 2 && matrix.shape[1] == 2 && vector.shape[0] == 2);
    return nj.array([
        matrix.get(0, 0) * vector.get(0) + matrix.get(0, 1) * vector.get(1),
        matrix.get(1, 0) * vector.get(0) + matrix.get(1, 1) * vector.get(1),
    ]);
}

export function norm(v: ndarray) {
    return Math.sqrt(normSq(v));
}

export function normSq(v: ndarray) {
    return vvDot(v, v);
}

export function clipScalar(x: number, min: number, max: number): number {
    return Math.min(Math.max(x, min), max);
}

export function vectorClip(v: ndarray, min: ndarray, max: ndarray): ndarray {
    console.assert(arraysEqual(v.shape, min.shape) && arraysEqual(v.shape, max.shape) && v.shape.length == 1);
    const new_vector = v.clone();
    for (let i = 0; i < v.shape[0]; i++) {
        new_vector.set(i, clipScalar(v.get(i), min.get(i), max.get(i)));
    }
    return new_vector;
}

export function rmat(angle: number): ndarray {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return nj.array([
        [c, -s],
        [s, c],
    ]);
}

export function argmax(v: ndarray): number {
    return argX(v, (a, b) => a > b, -Infinity);
}
export function argmin(v: ndarray): number {
    return argX(v, (a, b) => a < b, Infinity);
}

export function argX(v: ndarray, func: (a: number, b: number) => boolean, initVal: number): number {
    _assertOneDArray(v);
    let max = initVal;
    let max_idx = -1;
    for (let i = 0; i < v.shape[0]; i++) {
        if (func(v.get(i), max)) {
            //v.get(i) > max) {
            max = v.get(i);
            max_idx = i;
        }
    }
    return max_idx;
}

export function concatenateFirstAxis(arrays: ndarray[]) {
    // shapes are e.g. [(1, 2), (2, 2), (3, 2)]
    const val = [];
    for (let a of arrays) {
        _assertTwoDArray(a);
        val.push(a.T);
    }
    return nj.concatenate(val).T;
}

export function zeroToOne(x: number) {
    return x == 0 ? 1 : x;
}

export function degreesToRadians(degrees: number) {
    return (degrees * Math.PI) / 180;
}
export function radiansToDegrees(radians: number) {
    return (radians * 180) / Math.PI;
}
