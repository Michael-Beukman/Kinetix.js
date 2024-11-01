/**
 * @license
 * Copyright 2024 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

// This file is autogenerated.


import {registerKernel} from '@tensorflow/tfjs-core/dist/base';
import '@tensorflow/tfjs-core/dist/base_side_effects';
export * from '@tensorflow/tfjs-core/dist/base';
export * from '@tensorflow/tfjs-converter';

//backend = cpu
export * from '@tensorflow/tfjs-backend-cpu/dist/base';
import {transposeConfig as Transpose_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Transpose';
registerKernel(Transpose_cpu);
import {reshapeConfig as Reshape_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Reshape';
registerKernel(Reshape_cpu);
import {castConfig as Cast_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Cast';
registerKernel(Cast_cpu);
import {identityConfig as Identity_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Identity';
registerKernel(Identity_cpu);
import {concatConfig as Concat_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Concat';
registerKernel(Concat_cpu);
import {_fusedMatMulConfig as _FusedMatMul_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/_FusedMatMul';
registerKernel(_FusedMatMul_cpu);
import {addConfig as Add_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Add';
registerKernel(Add_cpu);
import {lessConfig as Less_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Less';
registerKernel(Less_cpu);
import {stridedSliceConfig as StridedSlice_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/StridedSlice';
registerKernel(StridedSlice_cpu);
import {equalConfig as Equal_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Equal';
registerKernel(Equal_cpu);
import {greaterEqualConfig as GreaterEqual_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/GreaterEqual';
registerKernel(GreaterEqual_cpu);
import {packConfig as Pack_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Pack';
registerKernel(Pack_cpu);
import {expandDimsConfig as ExpandDims_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/ExpandDims';
registerKernel(ExpandDims_cpu);
import {subConfig as Sub_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Sub';
registerKernel(Sub_cpu);
import {minimumConfig as Minimum_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Minimum';
registerKernel(Minimum_cpu);
import {maximumConfig as Maximum_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Maximum';
registerKernel(Maximum_cpu);
import {tileConfig as Tile_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Tile';
registerKernel(Tile_cpu);
import {tensorScatterUpdateConfig as TensorScatterUpdate_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/TensorScatterUpdate';
registerKernel(TensorScatterUpdate_cpu);
import {addNConfig as AddN_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/AddN';
registerKernel(AddN_cpu);
import {sumConfig as Sum_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Sum';
registerKernel(Sum_cpu);
import {selectConfig as Select_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Select';
registerKernel(Select_cpu);
import {logicalAndConfig as LogicalAnd_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/LogicalAnd';
registerKernel(LogicalAnd_cpu);
import {batchMatMulConfig as BatchMatMul_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/BatchMatMul';
registerKernel(BatchMatMul_cpu);
import {multiplyConfig as Multiply_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Multiply';
registerKernel(Multiply_cpu);
import {squareConfig as Square_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Square';
registerKernel(Square_cpu);
import {rsqrtConfig as Rsqrt_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Rsqrt';
registerKernel(Rsqrt_cpu);
import {einsumConfig as Einsum_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Einsum';
registerKernel(Einsum_cpu);
import {maxConfig as Max_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Max';
registerKernel(Max_cpu);
import {expConfig as Exp_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Exp';
registerKernel(Exp_cpu);
import {realDivConfig as RealDiv_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/RealDiv';
registerKernel(RealDiv_cpu);
import {negConfig as Neg_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Neg';
registerKernel(Neg_cpu);
import {reciprocalConfig as Reciprocal_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Reciprocal';
registerKernel(Reciprocal_cpu);
import {gatherV2Config as GatherV2_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/GatherV2';
registerKernel(GatherV2_cpu);
import {sliceConfig as Slice_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Slice';
registerKernel(Slice_cpu);
import {gatherNdConfig as GatherNd_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/GatherNd';
registerKernel(GatherNd_cpu);
import {tanhConfig as Tanh_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Tanh';
registerKernel(Tanh_cpu);
import {multinomialConfig as Multinomial_cpu} from '@tensorflow/tfjs-backend-cpu/dist/kernels/Multinomial';
registerKernel(Multinomial_cpu);

//backend = webgl
export * from '@tensorflow/tfjs-backend-webgl/dist/base';
import {transposeConfig as Transpose_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Transpose';
registerKernel(Transpose_webgl);
import {reshapeConfig as Reshape_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Reshape';
registerKernel(Reshape_webgl);
import {castConfig as Cast_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Cast';
registerKernel(Cast_webgl);
import {identityConfig as Identity_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Identity';
registerKernel(Identity_webgl);
import {concatConfig as Concat_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Concat';
registerKernel(Concat_webgl);
import {_fusedMatMulConfig as _FusedMatMul_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/_FusedMatMul';
registerKernel(_FusedMatMul_webgl);
import {addConfig as Add_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Add';
registerKernel(Add_webgl);
import {lessConfig as Less_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Less';
registerKernel(Less_webgl);
import {stridedSliceConfig as StridedSlice_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/StridedSlice';
registerKernel(StridedSlice_webgl);
import {equalConfig as Equal_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Equal';
registerKernel(Equal_webgl);
import {greaterEqualConfig as GreaterEqual_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/GreaterEqual';
registerKernel(GreaterEqual_webgl);
import {packConfig as Pack_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Pack';
registerKernel(Pack_webgl);
import {expandDimsConfig as ExpandDims_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/ExpandDims';
registerKernel(ExpandDims_webgl);
import {subConfig as Sub_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Sub';
registerKernel(Sub_webgl);
import {minimumConfig as Minimum_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Minimum';
registerKernel(Minimum_webgl);
import {maximumConfig as Maximum_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Maximum';
registerKernel(Maximum_webgl);
import {tileConfig as Tile_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Tile';
registerKernel(Tile_webgl);
import {tensorScatterUpdateConfig as TensorScatterUpdate_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/TensorScatterUpdate';
registerKernel(TensorScatterUpdate_webgl);
import {addNConfig as AddN_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/AddN';
registerKernel(AddN_webgl);
import {sumConfig as Sum_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Sum';
registerKernel(Sum_webgl);
import {selectConfig as Select_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Select';
registerKernel(Select_webgl);
import {logicalAndConfig as LogicalAnd_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/LogicalAnd';
registerKernel(LogicalAnd_webgl);
import {batchMatMulConfig as BatchMatMul_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/BatchMatMul';
registerKernel(BatchMatMul_webgl);
import {multiplyConfig as Multiply_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Multiply';
registerKernel(Multiply_webgl);
import {squareConfig as Square_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Square';
registerKernel(Square_webgl);
import {rsqrtConfig as Rsqrt_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Rsqrt';
registerKernel(Rsqrt_webgl);
import {einsumConfig as Einsum_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Einsum';
registerKernel(Einsum_webgl);
import {maxConfig as Max_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Max';
registerKernel(Max_webgl);
import {expConfig as Exp_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Exp';
registerKernel(Exp_webgl);
import {realDivConfig as RealDiv_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/RealDiv';
registerKernel(RealDiv_webgl);
import {negConfig as Neg_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Neg';
registerKernel(Neg_webgl);
import {reciprocalConfig as Reciprocal_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Reciprocal';
registerKernel(Reciprocal_webgl);
import {gatherV2Config as GatherV2_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/GatherV2';
registerKernel(GatherV2_webgl);
import {sliceConfig as Slice_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Slice';
registerKernel(Slice_webgl);
import {gatherNdConfig as GatherNd_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/GatherNd';
registerKernel(GatherNd_webgl);
import {tanhConfig as Tanh_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Tanh';
registerKernel(Tanh_webgl);
import {multinomialConfig as Multinomial_webgl} from '@tensorflow/tfjs-backend-webgl/dist/kernels/Multinomial';
registerKernel(Multinomial_webgl);