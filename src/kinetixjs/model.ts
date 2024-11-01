import * as tf from "@tensorflow/tfjs";
import { dict } from "../js2d/types";

export interface Agent {
    model: tf.GraphModel;
    isSymbolic: boolean;
}

export const loadAllModels = async (): Promise<dict<Agent>> => {
    tf.Tensor.prototype.transpose = function (perm) {
        return tf.transpose(this, perm);
    };
    tf.Tensor.prototype.flatten = function () {
        return tf.reshape(this, [-1]);
    };
    tf.Tensor.prototype.asType = function (type) {
        return tf.cast(this, type);
    };
    //@ts-ignore
    tf.Tensor.prototype.reshape = function (shape) {
        return tf.reshape(this, shape);
    };
    tf.Tensor.prototype.slice = function (begin, size) {
        return tf.slice(this, begin, size);
    };
    tf.Tensor.prototype.as1D = function () {
        return tf.reshape(this, [-1]);
    };

    tf.setBackend("webgl");
    const entityModel = await tf.loadGraphModel("./model_entity/tfjs_models/model.json");
    const symbolicModel = await tf.loadGraphModel("./model_symbolic/tfjs_models/model.json");
    symbolicModel.inputs;

    return {
        symbolic: {
            model: symbolicModel,
            isSymbolic: true,
        },
        entity: {
            model: entityModel,
            isSymbolic: false,
        },
    } as dict<Agent>;
};
