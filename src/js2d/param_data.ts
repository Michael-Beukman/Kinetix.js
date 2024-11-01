import { defaultStaticEnvParams, StaticEnvParams } from "./env_state";
import { copyNestedObj } from "./utils";

function makeStaticEnvParams(numPolygons: number, numCircles: number, numJoints: number, numThrusters: number): StaticEnvParams {
    const toChange = copyNestedObj(defaultStaticEnvParams);

    toChange.numPolygons = numPolygons;
    toChange.numCircles = numCircles;
    toChange.numJoints = numJoints;
    toChange.numThrusters = numThrusters;

    return toChange;
}

export const staticEnvParamsBySize = {
    s: makeStaticEnvParams(5, 2, 1, 1),
    m: makeStaticEnvParams(6, 3, 2, 2),
    l: makeStaticEnvParams(12, 4, 6, 2),
};

export const areStaticEnvParamsSame = (s1: StaticEnvParams, s2: StaticEnvParams): boolean => {
    return (
        s1.numPolygons === s2.numPolygons &&
        s1.numCircles === s2.numCircles &&
        s1.numJoints === s2.numJoints &&
        s1.numThrusters === s2.numThrusters
    );
};
