const path = require("path");
const webpack = require("webpack");
const package = require("./package.json");
module.exports = {
    mode: "development",
    entry: "./src/index.ts",
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: "ts-loader",
                exclude: /node_modules/,
            },
            {
                test: /\.css$/i,
                use: ["style-loader", "css-loader"],
            },
            {
                test: /\.scss$/,
                use: ["style-loader", "css-loader", "sass-loader"],
            },
        ],
    },
    resolve: {
        extensions: [".tsx", ".ts", ".js"],
        fallback: { path: require.resolve("path-browserify"), util: require.resolve("util/"), buffer: require.resolve("buffer/") },
        alias: {
             "@tensorflow/tfjs$": path.resolve(__dirname, "./extra/tensorflow_additions/custom_tfjs/custom_tfjs.js"),
             "@tensorflow/tfjs-core$": path.resolve(__dirname, "./extra/tensorflow_additions/custom_tfjs/custom_tfjs_core.js"),
             "@tensorflow/tfjs-core/dist/ops/ops_for_converter": path.resolve(__dirname, "./extra/tensorflow_additions/custom_tfjs/custom_ops_for_converter.js"),
        },
    },
    output: {
        filename: "bundle.js",
        path: path.resolve(__dirname, "dist"),
    },
    devServer: {
        static: "./dist",
    },
    plugins: [
        new webpack.DefinePlugin({
            "process.env": {
                package_version: '"' + package.version.toString() + '"',
            },
            "process.env.MY": JSON.stringify("production"),
        }),
    ],
    optimization: {
        usedExports: true,
    },
};
