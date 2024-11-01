import {
    _assertOneDArray,
    _assertTwoDArray,
    argmax,
    argmin,
    clipScalar,
    concatenateFirstAxis,
    matmul,
    norm,
    normSq,
    rmat,
    vectorClip,
    vvDot,
    vsCross,
    vvCross,
    svCross,
} from "./math";
import { CollisionManifold, ndarray, RigidBody, EnvParams } from "./env_state";
import { CollisionReturn, CollisionReturnLite, PolygonPolygonCollisionManifold } from "./types";

import nj from "@d4c/numjs";

function _calcRelativeVelocity(
    v1: ndarray,
    com1: ndarray,
    av1: number,
    v2: ndarray,
    com2: ndarray,
    av2: number,
    cpoint: ndarray,
    normal: ndarray
): ndarray {
    const r1 = cpoint.subtract(com1);
    const r2 = cpoint.subtract(com2);
    const av = v1.add(svCross(av1, r1));
    const bv = v2.add(svCross(av2, r2));
    return nj.array([vvDot(bv.subtract(av), normal)]);
}

export function generateManifoldCircleCircle(a: RigidBody, b: RigidBody, wsManifold: CollisionManifold): CollisionManifold {
    const n = b.position.subtract(a.position);
    const dist = norm(n);
    const r = a.radius + b.radius;
    const isColliding = dist < r && a.active && b.active;

    if (!isColliding) {
        wsManifold.active = false;
        wsManifold.accImpulseNormal = 0;
        wsManifold.accImpulseTangent = 0;
        return wsManifold;
    }
    const penetration = r - dist;
    const normal = n.divide(dist);

    const collision_point = a.position.add(normal.multiply(a.radius));

    const vn = _calcRelativeVelocity(
        a.velocity,
        a.position,
        a.angularVelocity,
        b.velocity,
        b.position,
        b.angularVelocity,
        collision_point,
        normal
    );
    console.assert(vn.shape[0] == 1);
    const v_rest = vn.get(0) * Math.min(a.restitution, b.restitution);
    return {
        normal,
        penetration,
        collisionPoint: collision_point,
        active: isColliding,
        accImpulseNormal: wsManifold.active && isColliding ? wsManifold.accImpulseNormal : 0,
        accImpulseTangent: wsManifold.active && isColliding ? wsManifold.accImpulseTangent : 0,
        restitutionVelocityTarget: v_rest,
    };
}
function _getNextVertices(vertices: ndarray, n: number): ndarray {
    let next_vertices = concatenateFirstAxis([vertices.slice(1), vertices.slice([null, 1])]);
    next_vertices.set(n - 1, 0, vertices.get(0, 0));
    next_vertices.set(n - 1, 1, vertices.get(0, 1));
    return next_vertices;
}
function findAxisOfLeastPenetration(a: RigidBody, b: RigidBody) {
    const a_M = rmat(a.rotation);
    const b_M = rmat(b.rotation);

    const b_v_world_space = nj.stack(
        [
            matmul(b_M, b.vertices.pick(0)).add(b.position),
            matmul(b_M, b.vertices.pick(1)).add(b.position),
            matmul(b_M, b.vertices.pick(2)).add(b.position),
            matmul(b_M, b.vertices.pick(3)).add(b.position),
        ],
        0
    );

    const b_v_a_space = nj.stack(
        [
            // equal to the inverse because orthonormal
            matmul(a_M.transpose([1, 0]), b_v_world_space.pick(0).subtract(a.position)),
            matmul(a_M.transpose([1, 0]), b_v_world_space.pick(1).subtract(a.position)),
            matmul(a_M.transpose([1, 0]), b_v_world_space.pick(2).subtract(a.position)),
            matmul(a_M.transpose([1, 0]), b_v_world_space.pick(3).subtract(a.position)),
        ],
        0
    );

    const a_v_a_space = a.vertices;
    const rot_left = rmat(Math.PI / 2.0);

    const next_a_vertices = _getNextVertices(a.vertices, a.nVertices);

    let highest_separation = -99999;
    let highest_sep_axis_index = -1;
    let highest_sep_incident_face_indexes = [0, 0];

    for (let i = 0; i < a.nVertices; i++) {
        const normal = calcNormal(rot_left, next_a_vertices.pick(i), a.vertices.pick(i));

        const test = nj.array([-0.2, 0]);
        const _dot_stack = (v: ndarray, n_verts: number) => {
            const arr = [];
            for (let i = 0; i < n_verts; i++) {
                arr.push(vvDot(normal, v.pick(i)));
            }
            return nj.array(arr);
            return nj.stack(arr, 0);
        };

        const a_v_on_axis = _dot_stack(a_v_a_space, a.nVertices);
        const b_v_on_axis = _dot_stack(b_v_a_space, b.nVertices);

        const separation = b_v_on_axis.min() - a_v_on_axis.max();

        if (separation > highest_separation) {
            highest_separation = separation;
            highest_sep_axis_index = i;
            const arr2 = b_v_on_axis
                .tolist()
                .map((item, index: number) => [item, index])
                .sort();
            const arr = arr2.map(([item, index]) => index);

            highest_sep_incident_face_indexes = [arr[0] as number, arr[1] as number];
        }
    }
    const highest_sep_incident_face = nj.stack(
        [b_v_world_space.pick(highest_sep_incident_face_indexes[0]), b_v_world_space.pick(highest_sep_incident_face_indexes[1])],
        0
    );

    return {
        highest_separation,
        highest_sep_axis_index,
        highest_sep_incident_face,
        v_world_space: b_v_world_space,
    };
}
function shouldCollide(a: RigidBody, b: RigidBody) {
    return a.collisionMode == 2 || b.collisionMode == 2 || a.collisionMode * b.collisionMode > 0;
}

export function generateManifoldPolygonPolygon(
    a: RigidBody,
    b: RigidBody,
    wsManifold: PolygonPolygonCollisionManifold
): PolygonPolygonCollisionManifold {
    const {
        highest_separation: a_sep,
        highest_sep_axis_index: a_face_index,
        highest_sep_incident_face: a_incident_face,
        v_world_space: b_v_world_space,
    } = findAxisOfLeastPenetration(a, b);
    const {
        highest_separation: b_sep,
        highest_sep_axis_index: b_face_index,
        highest_sep_incident_face: b_incident_face,
        v_world_space: a_v_world_space,
    } = findAxisOfLeastPenetration(b, a);

    const epsilon = 0.01; // Arbitrary bias to stop collision point flip flopping around

    const a_has_most_pen = a_sep + epsilon < b_sep;
    const most_sep = Math.max(a_sep, b_sep);
    const is_colliding = most_sep < 0 && a.active && b.active && shouldCollide(a, b);
    if (!is_colliding) {
        wsManifold.cm1.active = false;
        wsManifold.cm2.active = false;
        return wsManifold;
    }

    // Calculate reference and incident faces
    const a_M = rmat(a.rotation);
    const b_M = rmat(b.rotation);

    let ref_face, incident_face;
    if (a_has_most_pen) {
        ref_face = nj.stack([b_v_world_space.pick(b_face_index), b_v_world_space.pick((b_face_index + 1) % b.nVertices)]);
        incident_face = b_incident_face;
    } else {
        ref_face = nj.stack([a_v_world_space.pick(a_face_index), a_v_world_space.pick((a_face_index + 1) % a.nVertices)]);
        incident_face = a_incident_face;
    }

    const r1_angle =
        Math.PI + Math.atan2(ref_face.pick(0).subtract(ref_face.pick(1)).get(0), ref_face.pick(0).subtract(ref_face.pick(1)).get(1));
    const r1_M = rmat(r1_angle);
    const r1_r2_len = norm(ref_face.pick(0).subtract(ref_face.pick(1)));

    const incident_face_ref_space = nj.stack([
        matmul(r1_M, incident_face.pick(0).subtract(ref_face.pick(0))),
        matmul(r1_M, incident_face.pick(1).subtract(ref_face.pick(0))),
    ]);

    const clipped_incident_face_ref_space = nj.stack([
        vectorClip(incident_face_ref_space.pick(0), nj.array([-99999, 0]), nj.array([999999, r1_r2_len])),
        vectorClip(incident_face_ref_space.pick(1), nj.array([-99999, 0]), nj.array([999999, r1_r2_len])),
    ]);

    const collision_point_index = argmax(clipped_incident_face_ref_space.pick(null, 0));
    const both_points_in_neg_space = clipped_incident_face_ref_space.pick(null, 0).min() > 0;

    let collision_point1_ref_space = clipped_incident_face_ref_space.pick(collision_point_index);
    let collision_point2_ref_space = clipped_incident_face_ref_space.pick(1 - collision_point_index);

    const collision_point1 = matmul(r1_M.transpose([1, 0]), collision_point1_ref_space).add(ref_face.pick(0));
    const collision_point2 = matmul(r1_M.transpose([1, 0]), collision_point2_ref_space).add(ref_face.pick(0));

    const rot_left = rmat(Math.PI / 2.0);

    const next_a_vertices = _getNextVertices(a.vertices, a.nVertices);
    const next_b_vertices = _getNextVertices(b.vertices, b.nVertices);

    const a_normals = calcNormals(rot_left, next_a_vertices, a.vertices);
    const b_normals = calcNormals(rot_left, next_b_vertices, b.vertices);

    let norm_to_use;
    if (a_has_most_pen) {
        norm_to_use = matmul(b_M, b_normals.pick(b_face_index)).multiply(-1);
    } else {
        norm_to_use = matmul(a_M, a_normals.pick(a_face_index));
    }

    const vn1 = _calcRelativeVelocity(
        a.velocity,
        a.position,
        a.angularVelocity,
        b.velocity,
        b.position,
        b.angularVelocity,
        collision_point1,
        norm_to_use
    );
    console.assert(vn1.shape[0] == 1);
    const v_rest1 = vn1.get(0) * Math.min(a.restitution, b.restitution);

    const vn2 = _calcRelativeVelocity(
        a.velocity,
        a.position,
        a.angularVelocity,
        b.velocity,
        b.position,
        b.angularVelocity,
        collision_point2,
        norm_to_use
    );
    console.assert(vn2.shape[0] == 1);
    const v_rest2 = vn2.get(0) * Math.min(a.restitution, b.restitution);

    const cm1 = {
        normal: norm_to_use,
        penetration: -most_sep,
        collisionPoint: collision_point1,
        accImpulseNormal: wsManifold.cm1.active && is_colliding ? wsManifold.cm1.accImpulseNormal : 0,
        accImpulseTangent: wsManifold.cm1.active && is_colliding ? wsManifold.cm1.accImpulseTangent : 0,
        active: is_colliding,
        restitutionVelocityTarget: v_rest1,
    };
    const cm2 = {
        normal: norm_to_use,
        penetration: -most_sep,
        collisionPoint: collision_point2,
        accImpulseNormal: wsManifold.cm2.active && is_colliding && both_points_in_neg_space ? wsManifold.cm2.accImpulseNormal : 0,
        accImpulseTangent: wsManifold.cm2.active && is_colliding && both_points_in_neg_space ? wsManifold.cm2.accImpulseTangent : 0,
        active: is_colliding && both_points_in_neg_space,
        restitutionVelocityTarget: v_rest2,
    };

    return { cm1, cm2 };
}

export function generateManifoldCirclePolygon(circle: RigidBody, polygon: RigidBody, wsManifold: CollisionManifold): CollisionManifold {
    const poly_M = rmat(polygon.rotation);
    const circle_centre = matmul(poly_M.transpose([1, 0]), circle.position.subtract(polygon.position));

    const _signed_line_distance = (a: ndarray, b: ndarray, c: ndarray) => {
        return (b.get(0) - a.get(0)) * (c.get(1) - a.get(1)) - (b.get(1) - a.get(1)) * (c.get(0) - a.get(0));
    };
    const _clip_point_to_line = (point: ndarray, line_a: ndarray, line_b: ndarray) => {
        const dist = _signed_line_distance(point, line_a, line_b);

        let along_line = line_b.subtract(line_a);
        let norm_val = norm(along_line);
        along_line = along_line.divide(norm_val);

        let dot = vvDot(along_line, point.subtract(line_a));
        let dot_clipped = clipScalar(dot, 0.0, norm_val);

        let clipped_point = line_a.add(along_line.multiply(dot_clipped));

        return [dist < 0, clipped_point, normSq(clipped_point.subtract(point))] as const;
    };

    const next_vertices = _getNextVertices(polygon.vertices, polygon.nVertices);

    const [in_a, clip_a, dist_a] = _clip_point_to_line(circle_centre, polygon.vertices.pick(0), next_vertices.pick(0));
    const [in_b, clip_b, dist_b] = _clip_point_to_line(circle_centre, polygon.vertices.pick(1), next_vertices.pick(1));
    const [in_c, clip_c, dist_c] = _clip_point_to_line(circle_centre, polygon.vertices.pick(2), next_vertices.pick(2));
    const [in_d, clip_d, dist_d] = _clip_point_to_line(circle_centre, polygon.vertices.pick(3), next_vertices.pick(3));

    // # If the centre is inside the polygon, then we clip it to the single closest edge
    const clips = nj.stack([clip_a, clip_b, clip_c, clip_d]);

    const distArr = [dist_a, dist_b, dist_c];

    if (polygon.nVertices == 4) {
        distArr.push(dist_d);
    }
    const dists = nj.array(distArr);
    const closest_edge = argmin(dists);
    const inside_clipped_outward_point = clips.pick(closest_edge);
    const inside = in_a && in_b && in_c && (in_d || polygon.nVertices == 3);
    const closest = inside_clipped_outward_point;
    let normal = circle_centre.subtract(closest);
    const d = norm(normal);
    const r = circle.radius;

    const active = (d <= r || inside) && circle.active && polygon.active && shouldCollide(polygon, circle);
    normal = matmul(poly_M, normal).multiply(inside ? -1 : 1);
    const norm_of_normal = norm(normal);
    normal = normal.divide(norm_of_normal).multiply(-1);

    const collision_point = matmul(poly_M, closest).add(polygon.position);

    const vn = _calcRelativeVelocity(
        circle.velocity,
        circle.position,
        circle.angularVelocity,
        polygon.velocity,
        polygon.position,
        polygon.angularVelocity,
        collision_point,
        normal
    );
    console.assert(vn.shape[0] == 1);
    const v_rest = vn.get(0) * Math.min(circle.restitution, polygon.restitution);

    return {
        normal,
        penetration: inside ? r : r - d,
        collisionPoint: collision_point,
        active,
        accImpulseNormal: wsManifold.active && active ? wsManifold.accImpulseNormal : 0,
        accImpulseTangent: wsManifold.active && active ? wsManifold.accImpulseTangent : 0,
        restitutionVelocityTarget: v_rest,
    };
}

export function resolveWarmStartingImpulse(a: RigidBody, b: RigidBody, m: CollisionManifold, does_collide: boolean): CollisionReturnLite {
    const r1 = m.collisionPoint.subtract(a.position);
    const r2 = m.collisionPoint.subtract(b.position);
    const tangent = vsCross(m.normal, 1);
    const impulse = m.normal.multiply(m.accImpulseNormal).add(tangent.multiply(m.accImpulseTangent));
    // const impulse = m.accImpulseNormal.multiply(m.normal).add(m.accImpulseTangent.multiply(tangent));
    const a_dv = impulse.multiply(-a.inverseMass);
    const b_dv = impulse.multiply(b.inverseMass);
    const a_drv = -a.inverseInertia * vvCross(r1, impulse);
    const b_drv = b.inverseInertia * vvCross(r2, impulse);
    const should_resolve = m.active && !(a.inverseMass == 0 && b.inverseMass == 0) && does_collide && a.active && b.active;

    if (should_resolve) {
        return { a_dv, a_drv, b_dv, b_drv, isColliding: true };
    } else {
        return {
            a_dv: nj.zeros(2),
            a_drv: 0,
            b_dv: nj.zeros(2),
            b_drv: 0,
            isColliding: false,
        };
    }
}

export function resolveCollision(
    a: RigidBody,
    b: RigidBody,
    collisionManifold: CollisionManifold,
    does_collide: boolean,
    envParams: EnvParams
): CollisionReturn {
    const r1 = collisionManifold.collisionPoint.subtract(a.position);
    const r2 = collisionManifold.collisionPoint.subtract(b.position);
    const av = a.velocity.add(svCross(a.angularVelocity, r1));
    const bv = b.velocity.add(svCross(b.angularVelocity, r2));
    let dv = bv.subtract(av);
    const vn = vvDot(dv, collisionManifold.normal);

    const rn1 = vvDot(r1, collisionManifold.normal);
    const rn2 = vvDot(r2, collisionManifold.normal);
    const r1_norm = normSq(r1);
    const r2_norm = normSq(r2);

    const inv_m = a.inverseMass + b.inverseMass;
    const inv_i = a.inverseInertia + b.inverseInertia;

    const inv_mass_normal = inv_m + a.inverseInertia * (r1_norm - rn1 * rn1) + b.inverseInertia * (r2_norm - rn2 * rn2);

    // baumgarte stabilisation
    const bias = (-envParams.baumgarteCoefficientCollision / envParams.dt) * Math.min(0, -collisionManifold.penetration + envParams.slop);

    let impulseNormalMag = ((collisionManifold.restitutionVelocityTarget + (vn - bias)) * -1) / inv_mass_normal;

    const newAccImpluseNormal = clipScalar(collisionManifold.accImpulseNormal + impulseNormalMag, 0, Number.MAX_VALUE);

    impulseNormalMag = newAccImpluseNormal - collisionManifold.accImpulseNormal;
    const impulseNormal = collisionManifold.normal.multiply(impulseNormalMag);

    // impulse along normal
    let a_dv = impulseNormal.multiply(-a.inverseMass);
    let b_dv = impulseNormal.multiply(b.inverseMass);

    let a_drv = -a.inverseInertia * vvCross(r1, impulseNormal);
    let b_drv = b.inverseInertia * vvCross(r2, impulseNormal);

    dv = b.velocity
        .add(b_dv)
        .add(svCross(b.angularVelocity + b_drv, r2))
        .subtract(a.velocity.add(a_dv))
        .subtract(svCross(a.angularVelocity + a_drv, r1));

    const tangent = vsCross(collisionManifold.normal, 1);
    const vt = vvDot(dv, tangent);

    const rt1 = vvDot(r1, tangent);
    const rt2 = vvDot(r2, tangent);

    const inv_mass_tangent =
        a.inverseMass + b.inverseMass + a.inverseInertia * (r1_norm - rt1 * rt1) + b.inverseInertia * (r2_norm - rt2 * rt2);

    const mu = Math.sqrt(Math.pow(a.friction * envParams.baseFriction, 2) + Math.pow(b.friction * envParams.baseFriction, 2));

    let impulse_tangent_mag = -vt / inv_mass_tangent;
    const max_friction_impulse = newAccImpluseNormal * mu;

    let new_acc_impulse_tangent = clipScalar(
        collisionManifold.accImpulseTangent + impulse_tangent_mag,
        max_friction_impulse * -1,
        max_friction_impulse
    );

    const my_impulse_tangent_mag = new_acc_impulse_tangent - collisionManifold.accImpulseTangent;
    const impulse_tangent = tangent.multiply(my_impulse_tangent_mag);

    a_dv = a_dv.subtract(impulse_tangent.multiply(a.inverseMass));
    a_drv = a_drv - a.inverseInertia * vvCross(r1, impulse_tangent);

    b_dv = b_dv.add(impulse_tangent.multiply(b.inverseMass));
    b_drv = b_drv + b.inverseInertia * vvCross(r2, impulse_tangent);

    const isColliding = does_collide && a.active && b.active && collisionManifold.active && inv_m > 0;
    return {
        isColliding,
        a_dv: isColliding ? a_dv : nj.zeros(2),
        a_drv: isColliding ? a_drv : 0,
        b_dv: isColliding ? b_dv : nj.zeros(2),
        b_drv: isColliding ? b_drv : 0,
        newAccImpulseNormal: isColliding ? newAccImpluseNormal : collisionManifold.accImpulseNormal * 0,
        newAccImpulseTangent: isColliding ? new_acc_impulse_tangent : collisionManifold.accImpulseTangent * 0,
    };
}

function calcNormal(matrix: ndarray, next_vert: ndarray, vert: ndarray) {
    _assertOneDArray(vert);
    _assertOneDArray(next_vert);
    _assertTwoDArray(matrix);
    const delta = next_vert.subtract(vert).clone();
    const n = norm(delta);
    return matmul(matrix, delta).divide(n);
}

function calcNormals(matrix: ndarray, next_verts: ndarray, verts: ndarray) {
    _assertTwoDArray(verts);
    _assertTwoDArray(next_verts);
    _assertTwoDArray(matrix);
    const arr = [];
    for (let i = 0; i < next_verts.shape[0]; ++i) {
        arr.push(calcNormal(matrix, next_verts.pick(i), verts.pick(i)));
    }
    return nj.stack(arr);
}
