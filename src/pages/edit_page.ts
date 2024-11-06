import * as p5 from "p5";
// import the sim state
import { defaultEnvParams, defaultStaticEnvParams, EnvState, ndarray } from "../js2d/env_state";
import { checkParamsMatchSimState, createEmptyEnv, PhysicsEngine } from "../js2d/engine";
import { makeCleanImages, makeOriginalImages, render, renderControlOverlay } from "../js2d/renderer";
import nj from "@d4c/numjs";
import { Editor, SketchMode } from "../kinetixjs/env_editor";
import { copyNestedObj, copySimState } from "../js2d/utils";
import { setupGUI } from "../lib/p5.gui";
import { DropDownSelection, QuickSettingsPanel } from "quicksettings";
import {
    canRunSymbolicModel,
    flatToCorrectOrdering,
    makeObservation,
    observationToFlat,
    processActions,
    processMultiDiscreteActions,
} from "../kinetixjs/env";
import { Agent, loadAllModels } from "../kinetixjs/model";
import * as tf from "@tensorflow/tfjs";
import { KEYCODES } from "../lib/keys";
import { PageLoadState } from "../kinetixjs/page_load_state";
import { FireBaseAppAndDB } from "../web/database";
import { dict, SavedLevel } from "../js2d/types";
import Swal from "sweetalert2";
import { hideBackButton, isMoreTallThanWide, isSmallScreen, makeUnsavedChangesPopUp, showBackButton } from "../kinetixjs/ui";

export const makeEditSketch = (
    functionWhenSwitchMode: (levels: SavedLevel[]) => void,
    isActive: () => boolean,
    pageLoadStateReference: PageLoadState,
    firebaseApp: FireBaseAppAndDB | null = null,
    isGallery: boolean = false
) => {
    const sketch = (p: p5) => {
        const createGUI = setupGUI(8);

        let w = document.documentElement.clientWidth;
        let h = window.innerHeight;
        let diff = Math.abs(w - h);
        w = h = Math.min(w, h);
        let staticEnvParams = defaultStaticEnvParams;
        staticEnvParams.screenDim = nj.array([w, h]);
        let envParams = defaultEnvParams;
        let envState = createEmptyEnv(staticEnvParams, envParams);
        let physicsEngine = new PhysicsEngine(staticEnvParams, envParams);
        let editor: Editor;
        let mode = SketchMode.EDIT;

        let editorState: EnvState;

        let allModels: dict<Agent> = null;
        let isSymbolic = true;
        let startingUpdate = false;

        let frameTimes: number[] = [];
        const numPastFrameTimes = 25;
        let heightOfTutorial: number = null;

        let prevFrameTime = 0;

        let hasPressed = false;
        let previousThrusterActions: ndarray | null = null;
        let isFirst = true;

        let shouldWait = false;
        const disableEnablePlayButtons = (enablePlay: boolean, whichActive: string = null) => {
            const value = enablePlay ? "true" : "false";
            const value2 = enablePlay ? "false" : "true";
            const playA = document.getElementById("btnActionPlayHuman");
            const playB = document.getElementById("btnActionPlayAgentGeneral");
            const playC = document.getElementById("btnActionPlayAgentSpecialist");
            const stop = document.getElementById("btnActionPause");
            const newButton = document.getElementById("btnActionNew");

            const _makeEnabled = (items: HTMLElement[]) => {
                for (let item of items) {
                    item.removeAttribute("disabled");
                }
            };
            const _makeDisabled = (items: HTMLElement[]) => {
                for (let item of items) {
                    item.setAttribute("disabled", "true");
                }
            };
            for (let item of [playA, playB, playC]) {
                item.classList.remove("active-button-2");
            }

            if (whichActive != null) {
                const toAdd = document.getElementById(whichActive);
                toAdd.classList.add("active-button-2");
            }

            if (enablePlay) {
                _makeEnabled([playA, playB, playC, newButton]);
                _makeDisabled([stop]);
            } else {
                _makeEnabled([stop]);
                _makeDisabled([playA, playB, playC, newButton]);
            }
        };

        const startPlaying = () => {
            const _getActive = () => {
                if (!editor.qs[3].getValue("Let Agent Play")) {
                    return "btnActionPlayHuman";
                }
                if (isSymbolic) {
                    return "btnActionPlayAgentSpecialist";
                }
                return "btnActionPlayAgentGeneral";
            };
            previousThrusterActions = null;
            hasPressed = false;
            disableEnablePlayButtons(false, _getActive());
            envState = editor.stopEditing(envState);
            editorState = copySimState(envState);
            setTimeout(() => {
                mode = SketchMode.PLAY;
            }, 100);
            editor.qs[3].disableControl("Let Agent Play");

            if (firebaseApp && isGallery) {
                hideBackButton(editor.qs[7]);
            }
        };

        const stopPlaying = () => {
            disableEnablePlayButtons(true);
            startingUpdate = false;
            mode = SketchMode.EDIT;
            envState = copySimState(editorState);
            envState = editor.startEditing(envState);
            editor.qs[3].enableControl("Let Agent Play");

            if (firebaseApp && isGallery) {
                showBackButton(editor.qs[7]);
            }
        };
        const _getUIWidth = () => {
            const inner = pageLoadStateReference.isEmbedded() ? diff / 2 : diff / 2;

            return Math.max(inner, 100);
        };
        const doStop = () => {
            envState = editor.stopEditing(envState);
            for (let q of editor.qs) {
                q.hide();
            }
        };
        const setUIPositions = (isFirst = true) => {
            for (let i = 0; i < editor.qs.length; i++) {
                editor.qs[i].setWidth(_getUIWidth());
            }

            editor.qs[7].setWidth(_getUIWidth());
            const elem = document.getElementsByClassName("qs_title_bar")[7];
            if (isFirst && elem) elem.remove();
            editor.qs[7].setPosition(0, 0);

            const heightOfBackBtn = document.getElementsByClassName("qs_main")[7].clientHeight;
            editor.qs[0].setPosition(0, heightOfBackBtn);

            editor.qs[6].setPosition(
                document.documentElement.clientWidth - _getUIWidth(),
                null // staticEnvParams.screenDim.get(1) - heightOfModeUI - 100
            );
            if (isActive()) document.getElementById("loginDiv").style.width = _getUIWidth() + "px";
            //@ts-ignore
            editor.qs[6]._panel.style.bottom = "0px";
            //@ts-ignore
            editor.qs[6]._panel.style.top = null;

            const heightOfTopRight = document.getElementById("loginDiv").clientHeight;
            const doGood = (minusVal = 200) => {
                const heightOfModeUI = document.getElementsByClassName("qs_main")[6].clientHeight;
                if (heightOfTutorial == null) heightOfTutorial = document.getElementsByClassName("qs_main")[5].clientHeight;
                editor.qs[5].setSize(
                    null,
                    Math.min(heightOfTutorial, staticEnvParams.screenDim.get(1) - heightOfModeUI - heightOfTopRight - minusVal)
                );
            };

            if (isFirst) {
                //@ts-ignore
                document.getElementsByClassName("qs_main")[6].style.zIndex = 10000;
                doGood(-200);
                setTimeout(() => doGood(0), 100);
            } else {
                doGood(0);
            }
            editor.qs[5].setPosition(document.documentElement.clientWidth - _getUIWidth(), heightOfTopRight);

            const heightOfLoading = document.getElementsByClassName("qs_main")[3].clientHeight;
            // editor.qs[3].setPosition(0, staticEnvParams.screenDim.get(1) - heightOfLoading);
            editor.qs[3].setPosition(0, null);
            //@ts-ignore
            editor.qs[3]._panel.style.bottom = "0px";
            //@ts-ignore
            editor.qs[3]._panel.style.top = null;

            const heightOfStatus = document.getElementsByClassName("qs_main")[4].clientHeight;

            // editor.qs[4].setPosition(0, staticEnvParams.screenDim.get(1) - heightOfLoading - heightOfStatus);
            editor.qs[4].setPosition(0, null);
            //@ts-ignore
            editor.qs[4]._panel.style.bottom = "0px";
            //@ts-ignore
            editor.qs[4]._panel.style.top = null;

            if (isSmallScreen()) {
                editor.hideDivMode(true);
                editor.qs[5].hide();
                editor.qs[6].setPosition(null, 0);
                const size = document.getElementById("btnActionPlayAgentSpecialist").offsetHeight;
                editor.qs[6].setSize(_getUIWidth(), size * 3.5);
                (document.getElementsByClassName("qs_main")[6] as HTMLElement).style.height = size * 3.5 + "px";
                for (let id of ["btnActionPlayHuman", "btnActionPlayAgentGeneral", "btnActionNew"]) {
                    const elem = document.getElementById(id);
                    if (elem) {
                        elem.style.display = "none";
                    }
                }
                document.getElementById("mobileSpan").style.display = "block";
            }

            if (isMoreTallThanWide()) {
                const widthToUse = pageLoadStateReference.isEmbedded() ? w : w / 2;
                for (let index of [3, 6]) {
                    editor.qs[index].setSize(widthToUse, null);
                    const right = index == 6 ? "0px" : null;
                    const left = index == 3 ? "0px" : null;
                    //@ts-ignore
                    editor.qs[index]._panel.style.right = right;
                    //@ts-ignore
                    editor.qs[index]._panel.style.left = left;
                }
                // editor.qs[6].setPosition(document.documentElement.clientWidth - w / 2, null);
            }
        };

        const checkIsAllowingSymbolic = () => {
            const canRun = canRunSymbolicModel(envState, envParams, staticEnvParams);
            const specialist = document.getElementById("btnActionPlayAgentSpecialist");
            if (canRun) {
                specialist.removeAttribute("disabled");
            } else {
                specialist.setAttribute("disabled", "true");
                if (isSymbolic) {
                    editor.qs[3].setValue("Agent Type", { value: "Entity", index: 1 });
                }
            }
        };
        const afterGUIInit = () => {
            if (pageLoadStateReference.isEmbedded()) {
                editor.qs[3].hide();
                document.getElementById("loginDiv").style.display = "none";
            }
            document.getElementById("btnActionPlayHuman").addEventListener("click", () => {
                editor.qs[3].setValue("Let Agent Play", false);
                startPlaying();
            });
            document.getElementById("btnActionPlayAgentGeneral").addEventListener("click", () => {
                editor.qs[3].setValue("Agent Type", { value: "Entity", index: 1 });
                editor.qs[3].setValue("Let Agent Play", true);
                startPlaying();
            });

            document.getElementById("btnActionPlayAgentSpecialist").addEventListener("click", () => {
                editor.qs[3].setValue("Agent Type", { value: "Symbolic", index: 0 });
                checkIsAllowingSymbolic();
                editor.qs[3].setValue("Let Agent Play", true);
                startPlaying();
            });

            document.getElementById("btnActionPause").addEventListener("click", () => {
                stopPlaying();
            });

            disableEnablePlayButtons(true);
            if (firebaseApp && isGallery) {
                editor.qs[7].addHTML(
                    "Back To Gallery",
                    `   
                        <div style="width: 100%; text-align: center">             
                            <button class="btn btn-light m-auto" style="width: 100%" id="backButton"><span class="login-icon">↩️</span> Back</button>
                        </div>
                    `
                );
                editor.qs[7].hideTitle("Back To Gallery");

                const content = document.getElementsByClassName("qs_content")[7] as HTMLElement;
                (document.getElementsByClassName("qs_main")[7] as HTMLElement).style.boxShadow = "none";
                content.style.backgroundColor = "#f8f9fa";
                (content.childNodes[0] as HTMLElement).style.backgroundColor = "#f8f9fa";
                document.getElementById("backButton").addEventListener("click", () => {
                    const successFn = () => {
                        p.clear();
                        doStop();
                        hideBackButton(editor.qs[7]);
                        functionWhenSwitchMode(editor.levelsSaved);
                    };

                    if (editor.hasMadeAnyChanges) {
                        makeUnsavedChangesPopUp(successFn, null);
                    } else {
                        successFn();
                    }
                });
                hideBackButton(editor.qs[7]);
            }

            setUIPositions();
            editor.qs[3].addDropDown("Agent Type", ["Symbolic", "Entity"], (val: DropDownSelection<any>) => {
                isSymbolic = val.value == "Symbolic";

                checkIsAllowingSymbolic();
            });

            editor.qs[3].hideControl("Agent Type");

            if (!isActive()) {
                doStop();
            }
        };
        p.windowResized = () => {
            // if (!isActive()) return;
            w = document.documentElement.clientWidth;
            h = window.innerHeight;
            diff = Math.abs(w - h);
            w = h = Math.min(w, h);
            staticEnvParams.screenDim = nj.array([w, h]);
            p.resizeCanvas(w, h);
            _updateSimParams();
            setUIPositions(false);
        };

        p.keyPressed = (event: Event) => {
            if (!isActive()) return;
            const playKeys = [
                p.LEFT_ARROW,
                p.RIGHT_ARROW,
                p.UP_ARROW,
                p.DOWN_ARROW,
                KEYCODES.ONE,
                KEYCODES.TWO,
                KEYCODES.W,
                KEYCODES.A,
                KEYCODES.S,
                KEYCODES.D,
            ];
            if (p.key === " " || (playKeys.includes(p.keyCode) && mode == SketchMode.EDIT)) {
                if (mode == SketchMode.EDIT) {
                    editor.qs[3].setValue("Let Agent Play", false);
                    startPlaying();
                } else {
                    stopPlaying();
                }
            } else {
                envState = editor.keyPressed(envState);
            }
        };

        let images: { [id: string]: p5.Image } = {};
        p.preload = () => {
            images = makeOriginalImages(p);
            // images = makeAllImages(p, staticEnvParams);
        };
        p.setup = () => {
            images = makeCleanImages(p, staticEnvParams, images);

            loadAllModels().then((models) => {
                allModels = models;
            });
            const GUI = createGUI(p, "Hello");
            const qs: QuickSettingsPanel[] = GUI.map((x: any) => x.qs);
            for (let i = 0; i < qs.length; i++) {
                qs[i].setSize(_getUIWidth(), null);
                qs[i].setPosition(0, 0);
                qs[i].hide();
            }

            editor = new Editor(p, staticEnvParams, envParams, images, qs, afterGUIInit, isActive, pageLoadStateReference, firebaseApp);
            const canv = p.createCanvas(w, h, document.getElementById("canvasEditor"));

            window.addEventListener("beforeunload", function (e) {
                if (!isActive() || !editor.hasMadeAnyChanges) return;
                e.stopPropagation();
                e.preventDefault();
                e.returnValue = "";

                return "You are going to lose data.";
            });
        };
        const _updateSimParams = () => {
            envParams = editor.envParams;
            staticEnvParams = editor.staticEnvParams;
            physicsEngine = new PhysicsEngine(staticEnvParams, envParams);

            checkIsAllowingSymbolic();
        };
        const updateStep = async () => {
            const timeNow = performance.now();
            startingUpdate = true;
            let innerEnvState = copySimState(envState);
            if (mode == SketchMode.PLAY && !shouldWait) {
                let actions = _getActionsFromKeyboard(innerEnvState); // human actions
                let frameskip = 1;
                if (editor.qs[3].getValue("Let Agent Play")) {
                    actions = await _doModelForwardPass();
                    frameskip = staticEnvParams.frameSkip;
                }

                previousThrusterActions = actions.slice(staticEnvParams.numJoints);
                let isTerminal = 0;

                for (let i = 0; i < frameskip; i++) {
                    innerEnvState = physicsEngine.step(innerEnvState, actions);
                    if (innerEnvState.terminal != 0) {
                        isTerminal = innerEnvState.terminal;
                        break;
                    }
                    // isTerminal = isTerminal || innerEnvState.terminal;
                }
                console.assert(checkParamsMatchSimState(staticEnvParams, innerEnvState));

                if (isTerminal != 0) {
                    // shouldWait = true;
                    const isSuccess = isTerminal == 1;
                    const isAgentPlaying = editor.qs[3].getValue("Let Agent Play");
                    const which = isAgentPlaying ? "The Agent" : "You";
                    const message = isSuccess ? `${which} Won!` : `${which} Lost!`;
                    const messageFull = isSuccess ? "The green shape touched the blue shape." : "The green shape touched the red shape.";
                    const icon = isSuccess ? "success" : "error";
                    innerEnvState = copySimState(editorState);
                    Swal.fire({
                        title: message,
                        text: messageFull,
                        icon: icon,
                        position: "top-start",
                        toast: true,
                        showConfirmButton: false,
                        timer: 1500,
                        timerProgressBar: true,
                    });
                }
            }
            if (mode == SketchMode.PLAY) {
                envState = innerEnvState;
            }
            startingUpdate = false;
            const timeAfter = performance.now();

            prevFrameTime = timeAfter - timeNow;
        };

        const addFrameTime = (time: number) => {
            if (frameTimes.length < numPastFrameTimes) frameTimes.push(time);
            else {
                frameTimes.shift();
                frameTimes.push(time);
            }
        };

        let scale = 2;
        p.draw = () => {
            if (!isActive()) return;
            if (pageLoadStateReference.getHasAuthStateChanged()) {
                editor._showHideCloudSaveButton(pageLoadStateReference.getCurrentUser() != null);
                pageLoadStateReference.setHasAuthStateChanged(false);
            }
            if (pageLoadStateReference.shouldLoadNewLevel()) {
                if (!editor.allowSavingToCloud && pageLoadStateReference.getCurrentUser() != null) {
                    editor._showHideCloudSaveButton(true);
                }
                document.getElementById("loginDiv").style.width = _getUIWidth() + "px";
                pageLoadStateReference.setShouldLoadNewLevel(false);
                editor.onResumeFocus();
                const toLoad = pageLoadStateReference.levelToLoad();
                editor.setLevelID(toLoad.levelID);
                console.assert(toLoad != null);
                envState = toLoad.level.env_state;
                envParams = copyNestedObj(toLoad.level.env_params);
                staticEnvParams = copyNestedObj(toLoad.level.static_env_params);
                staticEnvParams.screenDim = nj.array([w, h]);

                editor.staticEnvParams = staticEnvParams;
                editor.envParams = envParams;
                pageLoadStateReference.setLevelToNull();
                envState = editor.startEditing(envState);
                _updateSimParams();
                editor.hasMadeAnyChanges = false;
            }

            if (pageLoadStateReference.hasJustSwitched()) {
                pageLoadStateReference.setHasJustSwitched(false);
                if (firebaseApp && isGallery && !(pageLoadStateReference.isEmbedded() && pageLoadStateReference.didStartOnEditor())) {
                    showBackButton(editor.qs[7]);
                } else {
                    hideBackButton(editor.qs[7]);
                }
            }
            if (isFirst) {
                isFirst = false;
                const elem = document.getElementById("loadingScreen");
                if (elem) elem.style.display = "none";
            }
            const _getThrustersRender = () => {
                if (mode == SketchMode.EDIT || previousThrusterActions == null) {
                    return null;
                } else {
                    return {
                        previousThrusterActions: previousThrusterActions,
                    };
                }
            };
            render(p, envState, staticEnvParams, envParams, images, _getThrustersRender());
            if ((mode == SketchMode.EDIT || (!hasPressed && !editor.qs[3].getValue("Let Agent Play"))) && !isSmallScreen()) {
                renderControlOverlay(p, envState, staticEnvParams, envParams, images);
            }
            if (mode == SketchMode.EDIT) {
                if (!isSmallScreen()) {
                    envState = editor.edit(envState);
                    if (editor.hasChangedParams) {
                        _updateSimParams();
                    }
                }
                addFrameTime(p.deltaTime);
            } else if (!startingUpdate) {
                updateStep();
                if (editor.qs[3].getValue("Let Agent Play")) {
                    addFrameTime(prevFrameTime);
                } else {
                    addFrameTime(p.deltaTime);
                }
            }
            editor.render(mode);

            const total = frameTimes.reduce((a, b) => a + b, 0);
            p.text(Math.round((frameTimes.length / total) * 1000) + " fps", 50, 50);
        };

        function _getActionsFromKeyboard(envState: EnvState) {
            const actions = nj.zeros(staticEnvParams.numMotorBindings + staticEnvParams.numThrusterBindings);

            // joints
            // actions.set(0, p.keyIsDown(p.LEFT_ARROW) ? -1 : p.keyIsDown(p.RIGHT_ARROW) ? 1 : 0);
            actions.set(0, p.keyIsDown(p.LEFT_ARROW) ? 1 : p.keyIsDown(p.RIGHT_ARROW) ? -1 : 0);
            actions.set(1, p.keyIsDown(p.UP_ARROW) ? 1 : p.keyIsDown(p.DOWN_ARROW) ? -1 : 0);

            actions.set(2, p.keyIsDown(KEYCODES.W) ? -1 : p.keyIsDown(KEYCODES.S) ? 1 : 0);
            actions.set(3, p.keyIsDown(KEYCODES.A) ? 1 : p.keyIsDown(KEYCODES.D) ? -1 : 0);

            for (let i = 0; i < staticEnvParams.numThrusterBindings; i++) {
                actions.set(staticEnvParams.numMotorBindings + i, p.keyIsDown(KEYCODES.ONE + i) ? 1 : 0);
            }
            if (nj.abs(actions).sum() > 0) {
                hasPressed = true;
            }
            const ans = processActions(envState, actions, staticEnvParams);
            return ans;
        }

        async function _doModelForwardPass() {
            if (allModels != null) {
                const model = _getModel();
                const obs = makeObservation(envState, envParams, staticEnvParams, model.isSymbolic);
                const flatObs = observationToFlat(envState, obs, model.isSymbolic);
                const obsToUse = flatToCorrectOrdering(flatObs, model.model.inputs as unknown as tf.TensorInfo[]);
                // return ;

                let x;
                try {
                    x = await model.model.executeAsync(obsToUse);
                } catch (e) {
                    if (isSymbolic) {
                        isSymbolic = false;
                        checkIsAllowingSymbolic();
                        editor.qs[3].setValue("Agent Type", { value: "Entity", index: 1 });
                    }
                }
                const [hidden, pi_logits, critic] = x as tf.Tensor[];
                const action = await processMultiDiscreteActions(pi_logits, staticEnvParams);
                return processActions(envState, action, staticEnvParams);
            }
        }

        const _getModel = () => {
            return isSymbolic ? allModels["symbolic"] : allModels["entity"];
        };
    };
    return sketch;
};
