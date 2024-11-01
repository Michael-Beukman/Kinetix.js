import { CollisionManifold, ndarray, EnvParams, EnvState, StaticEnvParams } from "./env_state";
export type dictOfString = { [key: string]: any };

export type dict<T> = { [key: string]: T };
export interface CollisionReturnLite {
    isColliding: boolean;
    a_dv: ndarray;
    a_drv: number;
    b_dv: ndarray;
    b_drv: number;
}

export interface CollisionReturn extends CollisionReturnLite {
    newAccImpulseNormal: number;
    newAccImpulseTangent: number;
}

export interface PolygonPolygonCollisionManifold {
    cm1: CollisionManifold;
    cm2: CollisionManifold;
}

export interface ManifoldReturn {
    indexA: number;
    indexB: number;
    manifold: CollisionManifold;
    manifoldIndex: number;
    manifoldSecondaryIndex: number;
}

export interface JointReturn {
    a_dv: ndarray;
    b_dv: ndarray;
    a_drv: number;
    b_drv: number;
    a_dp: ndarray;
    b_dp: ndarray;
    jointPoint: ndarray;
    accImpulse: ndarray;
    accRImpulse: number;
}

export interface MotorReturn {
    a_drv: number;
    b_drv: number;
}

export interface LoadReturn {
    env_state: EnvState;
    env_params: EnvParams;
    static_env_params: StaticEnvParams;
}

export interface LevelMetaData {
    userName: string;
    date: Date;
    levelName: string;
    userID: string;
    parentID: string | null;
    tags: string[] | null;
}

export interface RankingData {
    upvotes: number;
    downvotes: number;
}

export interface SavedLevel {
    level: LoadReturn;
    metaData: LevelMetaData;
    rankingData: RankingData;
    levelID: string;
}

export interface CompressedParams {
    type: "full" | "size";
    size: string | null;
    params: dictOfString | null;
}
