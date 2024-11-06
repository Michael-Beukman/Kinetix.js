import { QuickSettingsPanel } from "quicksettings";
import {
    calculateCollisionMatrix,
    createEmptyEnv,
    getEmptyCollisionManifolds,
    getRectangleVertices,
    makeSingleEmptyJoint,
    makeSingleEmptyRigidBody,
    makeSingleEmptyThruster,
    recalculateInverseMassAndInertiaCircle,
    recalculateInverseMassAndInertiaPolygon,
    scaleScalarFromPixels,
    screenToSim,
    simToScreen,
} from "../js2d/engine";
import { getGlobalJointPosition, recalculateGlobalPositions } from "../js2d/joint";
import { degreesToRadians, matmul, norm, radiansToDegrees, rmat, vvDot, zeroToOne } from "../js2d/math";
import { Joint, ndarray, RigidBody, EnvParams, EnvState, StaticEnvParams, Thruster } from "../js2d/env_state";
import nj from "@d4c/numjs";
import { copyNestedObj, copySimState, selectShape } from "../js2d/utils";
import { dictOfString, LevelMetaData, RankingData, SavedLevel } from "../js2d/types";
import { loadFromJSON, saveToJSON } from "./saving";
import { SnapReturn } from "./snapping";
import { saveAs } from "file-saver";
import { KEYCODES } from "../lib/keys";
import { addLevelToDB, FireBaseAppAndDB, getLevelLink } from "../web/database";
import Swal from "sweetalert2";
import { PageLoadState } from "./page_load_state";
import { hideBackButton, isSmallScreen, makeUnsavedChangesPopUp, showBackButton } from "./ui";

type InnerUIMapping = {
    [id: string]: { name: string; index: number } | string;
};

type UIMapping = {
    rigidBody: InnerUIMapping;
    joint: InnerUIMapping;
    thruster: InnerUIMapping;
};
export enum SketchMode {
    EDIT,
    PLAY,
}
enum EditorMode {
    ADD_CIRCLE,
    ADD_RECTANGLE,
    ADD_JOINT,
    ADD_THRUSTER,
    SELECT,
}

enum EntityType {
    CIRCLE,
    RECTANGLE,
    JOINT,
    THRUSTER,
}

interface CopyPasteObject {
    shouldTriggerPaste: boolean;
    itemToCopy: RigidBody | null;
    shapeType: EntityType;
}

const MIN_CIRCLE_SIZE = 0.1;
const DROPDOWN_ROLE_OPTIONS = ["None", "Green", "Blue", "Red"];
function isRB(entity: any): entity is RigidBody {
    return "inverseMass" in entity;
}

function isJoint(entity: any): entity is Joint {
    return "aIndex" in entity;
}

function isThruster(entity: any): entity is Thruster {
    return "objectIndex" in entity;
}
function findLowestActiveIndex(arr: (RigidBody | Thruster | Joint)[]): number {
    for (let i = 0; i < arr.length; i++) {
        if (!arr[i].active) return i;
    }
    return arr.length - 1;
}

export class Editor {
    SNAP_DIST: number = 0.05;

    staticEnvParams: StaticEnvParams;
    envParams: EnvParams;
    p: p5;

    currentMode: EditorMode = EditorMode.SELECT;
    oldMode: EditorMode = EditorMode.ADD_RECTANGLE;
    addingShapeIndex: number = -1;
    isAddingShape: boolean = false;

    // editing shape
    currentlySelectedShapeIndex: number = -1;
    currentlySelectedShapeType: EntityType = EntityType.CIRCLE;

    currentSimState: EnvState;

    startPressLocation: ndarray;
    mouseDragStartPos: ndarray;
    mouseDragStartRBPos: ndarray;

    mouseDown: boolean = false;
    mouseRightClick: boolean = false;
    images: { [id: string]: p5.Image };
    // GUI
    qs: QuickSettingsPanel[];
    uiMapping: UIMapping = {
        rigidBody: {},
        joint: {},
        thruster: {},
    };

    multipleClickCounter: number = 0;
    multipleClickPreviousPosition: ndarray = nj.array([0, 0]);

    //
    shouldTriggerUnselect: boolean = false;
    shouldReset: boolean = false;
    shouldLoad: boolean = false;
    hasChangedParams: boolean = false;
    contentShouldLoad: dictOfString;
    shouldDeleteShape: boolean = false;
    shouldDeleteShapeType: EntityType;
    shouldDeleteShapeIndex: number;

    isBusyMultiSelect: boolean = false;
    hasMultiSelected: boolean = false;
    multiSelectStartPoint: ndarray = null;
    multiSelectShapeIndices: number[] = [];

    // Joints and snapping
    isCurrentlyPlacingJoint = false;
    isCurrentlyPlacingThruster = false;
    shouldDeleteTempJoint = -1;
    shouldDeleteTempThruster = -1;
    drawCalls: Array<(p: p5, staticEnvParams: StaticEnvParams, envParams: EnvParams) => void> = [];

    // UI and Saving/Loading
    shouldSaveFileLocal: boolean = false;
    fileSaveName: string = "kinetix-level.json";

    // Copy Pasting
    copyPasteObject: CopyPasteObject = {
        shouldTriggerPaste: false,
        itemToCopy: null,
        shapeType: EntityType.CIRCLE,
    };

    levelsSaved: SavedLevel[] = [];

    isActive: () => boolean;
    shouldSaveFileCloud: boolean = false;

    shouldHaveCloudButton = true;

    firebaseApp: FireBaseAppAndDB;
    modalIsActive: boolean = false;
    allowSavingToCloud: boolean = false;

    pageLoadStateReference: PageLoadState;
    numThumbsUp: any;
    numThumbsDown: any;
    parentLevelID: string = null;

    isCurrentlyBusyEditing = true;

    hasMadeAnyChanges = false;
    shouldSnap: boolean = true;

    constructor(
        p: p5,
        staticEnvParams: StaticEnvParams,
        envParams: EnvParams,
        images: { [id: string]: p5.Image },
        qs: QuickSettingsPanel[],
        initGUICallBack: () => void,
        isActive: () => boolean,
        pageLoadStateReference: PageLoadState,
        firebaseApp: FireBaseAppAndDB | null = null
    ) {
        this.pageLoadStateReference = pageLoadStateReference;
        this.firebaseApp = firebaseApp;
        this.p = p;
        this.staticEnvParams = staticEnvParams;
        this.envParams = envParams;
        this.images = images;
        this.qs = qs;
        this.initGUI(initGUICallBack);
        this.isActive = isActive;
        p.mousePressed = (e: MouseEvent) => this.mousePressed(e, this);
        p.mouseWheel = (event: WheelEvent) => this.mouseScroll(event, this);
    }

    edit(envState: EnvState): EnvState {
        this.drawCalls = [];
        if (this.shouldTriggerUnselect) {
            this.shouldTriggerUnselect = false;
            envState = this._triggerUnselect(envState);
        }
        if (this.shouldReset) {
            envState = createEmptyEnv(this.staticEnvParams, this.envParams);
            this.parentLevelID = null;
            this.shouldReset = false;
            this.hasMadeAnyChanges = false;
            return envState;
        }
        if (this.shouldLoad) {
            this.shouldLoad = false;

            const newState = loadFromJSON(
                this.staticEnvParams.screenDim.get(0),
                this.staticEnvParams.screenDim.get(1),
                this.contentShouldLoad
            );
            envState = newState.env_state;
            this.envParams = newState.env_params;
            this.staticEnvParams = newState.static_env_params;
            this.hasChangedParams = true;
        } else {
            this.hasChangedParams = false;
        }

        if (this.shouldSaveFileLocal) {
            this.shouldSaveFileLocal = false;
            envState = this.stopEditing(envState);
            const newJson = saveToJSON(envState, this.envParams, this.staticEnvParams);
            const data = saveAs(new Blob([JSON.stringify(newJson)]), this.fileSaveName);
            envState = this.startEditing(envState);
        } else if (this.shouldSaveFileCloud && this.shouldHaveCloudButton && this.firebaseApp && this.allowSavingToCloud) {
            this.shouldSaveFileCloud = false;
            this.modalIsActive = true;
            Swal.fire({
                title: "Save Level",
                html: `
                    <p style="color: #818181!important; font-size: 0.75em">By clicking "OK", you agree that this level will be saved to the cloud and will be publicly available.
                    <br><span style="color: #818181!important; font-size: 0.5rem">To remove your data, email kinetix.rl.agent@gmail.com</span>
                    </p>
                    <label for="swal-input-levelname" class="swal2-input-label">Level Name</label>
                    <input id="swal-input-levelname" class="swal2-input">
                        `,
                focusConfirm: false,
                preConfirm: () => {
                    const levelName = (document.getElementById("swal-input-levelname") as HTMLInputElement).value;
                    if (!levelName) {
                        Swal.showValidationMessage("Missing Values!");
                        return false;
                    }
                    return {
                        levelName: levelName,
                        userName: "Anonymous",
                        userID: this.pageLoadStateReference.getCurrentUser().uid,
                    };
                },
            }).then((values) => {
                this.modalIsActive = false;
                if (values.isConfirmed) {
                    const val = values.value as {
                        levelName: string;
                        userName: string;
                        userID: string;
                    };
                    envState = this.stopEditing(envState);
                    const newJson = saveToJSON(envState, this.envParams, this.staticEnvParams, true);
                    const metaData = this._getMetaData(val.levelName, val.userName, val.userID);

                    const savedReturn: SavedLevel = {
                        level: {
                            env_state: copySimState(envState),
                            env_params: copyNestedObj(this.envParams),
                            static_env_params: copyNestedObj(this.staticEnvParams),
                        },
                        metaData: metaData,
                        rankingData: { upvotes: 0, downvotes: 0 },
                        levelID: "-1",
                    };
                    savedReturn.level.env_params.numUnits = 5; // TODO
                    savedReturn.level.static_env_params.screenDim = nj.array([500, 500]);
                    // disable save button and gallery button:
                    document.getElementById("btnSaveCloud").setAttribute("disabled", "true");
                    hideBackButton(this.qs[7]);

                    addLevelToDB(this.firebaseApp, newJson, metaData).then((id) => {
                        this.hasMadeAnyChanges = false;
                        Swal.fire({
                            icon: "success",
                            title: "Successfully Saved",
                            text: "Saved level successfully",
                            showCancelButton: true,
                            confirmButtonText: `<img width="20px" src='./assets/clipboard.png' style="margin-right: 5px;"> Copy Link`,
                            cancelButtonText: "Close",
                            customClass: {
                                confirmButton: "swal2-confirm-copy",
                            },
                        }).then((result) => {
                            if (result.isConfirmed) {
                                const toCopy = getLevelLink(id);
                                navigator.clipboard.writeText(toCopy);
                            }
                        });

                        // TODO  error checking
                        savedReturn.levelID = id;
                        this.levelsSaved.push(savedReturn);

                        // enable buttons
                        document.getElementById("btnSaveCloud").removeAttribute("disabled");
                        showBackButton(this.qs[7]);
                    });

                    envState = this.startEditing(envState);
                }
            });
        }

        if (this.shouldDeleteShape) {
            this.hasMadeAnyChanges = true;
            this.shouldDeleteShape = false;

            if (this.shouldDeleteShapeIndex !== -1) {
                const type = this.shouldDeleteShapeType;
                const idx = this.shouldDeleteShapeIndex;
                if (type === EntityType.CIRCLE || type === EntityType.RECTANGLE) {
                    envState = this._deleteRigidBody(envState, idx, type);
                } else if (type === EntityType.JOINT) {
                    envState = this._deleteJoint(envState, idx);
                } else if (type === EntityType.THRUSTER) {
                    envState = this._deleteThruster(envState, idx);
                }
                this.currentlySelectedShapeIndex = -1;
                this.shouldDeleteShapeIndex = -1;
                this.shouldDeleteShapeType = EntityType.CIRCLE;
                this._hideAllUIs();
            }
        }

        this._checkMode(envState);

        envState = this._cleanupJointsAndThrusters(envState);
        // check if current mode is any of the ADD_ ones:
        if (this.currentMode === EditorMode.ADD_CIRCLE || this.currentMode === EditorMode.ADD_RECTANGLE) {
            if (this.mouseDown) {
                this.hasMadeAnyChanges = true;
                if (this.isAddingShape) {
                    envState = this.addShapeEnd(envState);
                } else {
                    envState = this._checkIfShouldIncreaseEnvSize(envState, {
                        allowCircles: true,
                        allowPolys: true,
                    });
                    envState = this.addShapeStart(envState);
                }
                this.mouseDown = false;
            } else if (this.isAddingShape) {
                envState = this.addShapeMiddle(envState);
            }
        }
        if (this.mouseRightClick) {
            this.mouseRightClick = false;
            if (this.currentMode != EditorMode.SELECT) {
                envState = this._handleRightClick(envState);
            }
        }

        envState = this._handleKeyboardPress(envState);
        if (this.currentMode !== EditorMode.SELECT) {
            envState = this._clearHighlighted(envState);
        }
        switch (this.currentMode) {
            case EditorMode.ADD_JOINT:
                envState = this._checkIfShouldIncreaseEnvSize(envState, {
                    allowJoints: true,
                });
                envState = this.addJoint(envState);
                break;
            case EditorMode.SELECT:
                envState = this.select(envState);
                break;
            case EditorMode.ADD_THRUSTER:
                envState = this._checkIfShouldIncreaseEnvSize(envState, {
                    allowThrusters: true,
                });
                envState = this.addThruster(envState);
                break;
        }
        this._updateButtonStatuses(envState);
        return envState;
    }

    setLevelID(levelID: string) {
        this.parentLevelID = levelID;
    }
    _checkIfShouldIncreaseEnvSize(
        envState: EnvState,
        { allowCircles = false, allowPolys = false, allowJoints = false, allowThrusters = false }
    ): EnvState {
        const shouldIncreaseCircles = !this._hasAnyInactives(envState.circle) && allowCircles;
        const shouldIncreasePolys = !this._hasAnyInactives(envState.polygon) && allowPolys;
        const shouldIncreaseThrusters = !this._hasAnyInactives(envState.thruster) && allowThrusters;
        const shouldIncreaseJoints = !this._hasAnyInactives(envState.joint) && allowJoints;

        const anyChanged = shouldIncreaseCircles || shouldIncreasePolys || shouldIncreaseThrusters || shouldIncreaseJoints;

        if (!anyChanged) return envState;

        let oldCircles = this.staticEnvParams.numCircles;
        let newCircles = oldCircles;

        let oldPolys = this.staticEnvParams.numPolygons;
        let newPolys = oldPolys;

        let oldThrusters = this.staticEnvParams.numThrusters;
        let newThrusters = oldThrusters;

        let oldJoints = this.staticEnvParams.numJoints;
        let newJoints = oldJoints;

        if (shouldIncreaseCircles) {
            newCircles *= 2;
            this.staticEnvParams.numCircles = newCircles;
        }
        if (shouldIncreasePolys) {
            newPolys *= 2;
            this.staticEnvParams.numPolygons = newPolys;
        }
        if (shouldIncreaseThrusters) {
            newThrusters *= 2;
            this.staticEnvParams.numThrusters = newThrusters;
        }
        if (shouldIncreaseJoints) {
            newJoints *= 2;
            this.staticEnvParams.numJoints = newJoints;
        }
        let deltaCircles = newCircles - oldCircles;
        let deltaPolys = newPolys - oldPolys;
        let deltaThrusters = newThrusters - oldThrusters;
        let deltaJoints = newJoints - oldJoints;

        for (let i = 0; i < deltaCircles; i++) {
            envState.circle.push(makeSingleEmptyRigidBody(this.staticEnvParams));
        }
        for (let i = 0; i < deltaPolys; i++) {
            envState.polygon.push(makeSingleEmptyRigidBody(this.staticEnvParams));
        }
        // now update joint and thruster indexes
        for (let i = 0; i < envState.joint.length; i++) {
            let joint = envState.joint[i];
            if (!joint.active) {
                continue;
            }
            if (joint.aIndex >= oldPolys) {
                // means the joint object is a circle
                joint.aIndex += deltaPolys;
            }
            if (joint.bIndex >= oldPolys) {
                joint.bIndex += deltaPolys;
            }
        }

        for (let i = 0; i < envState.thruster.length; i++) {
            let thruster = envState.thruster[i];
            if (!thruster.active) {
                continue;
            }
            if (thruster.objectIndex >= oldPolys) {
                // means the joint object is a circle
                thruster.objectIndex += deltaPolys;
            }
        }

        for (let i = 0; i < deltaJoints; ++i) {
            envState.joint.push(makeSingleEmptyJoint());
        }

        for (let i = 0; i < deltaThrusters; ++i) {
            envState.thruster.push(makeSingleEmptyThruster());
        }

        // now add thrusters and joints

        if (anyChanged) {
            this.hasChangedParams = true;
            const emptyCollisionManifolds = getEmptyCollisionManifolds(this.staticEnvParams);
            envState.collisionMatrix = calculateCollisionMatrix(this.staticEnvParams, envState.joint);
            envState.accRRManifolds = emptyCollisionManifolds.accRRManifolds;
            envState.accCRManifolds = emptyCollisionManifolds.accCRManifolds;
            envState.accCCManifolds = emptyCollisionManifolds.accCCManifolds;

            console.log("\tIncreased env size", this.staticEnvParams);
        }

        return envState;
    }
    _getMetaData(levelName: string, userName: string, userID: string): LevelMetaData {
        return {
            userName: userName,
            date: new Date(),
            levelName: levelName,
            userID: userID,
            parentID: this.parentLevelID,
            tags: ["community"],
        };
    }

    select(envState: EnvState): EnvState {
        if (this.isBusyMultiSelect) {
            const newPos = nj.array([this.p.mouseX, this.p.mouseY]);

            const oldPos = simToScreen(this.multiSelectStartPoint, this.staticEnvParams, this.envParams);

            const delta = norm(newPos.subtract(oldPos));
            if (delta < this.envParams.pixelsPerUnit && !this.p.mouseIsPressed) {
                this.isBusyMultiSelect = false;
            } else {
                // draw rect:
                this.drawCalls.push((p, staticEnvParams, envParams) => {
                    p.push();
                    // this.p.drawingContext.setLineDash([5, 5]);
                    p.stroke(0);
                    p.fill(0, 0, 0, 20);
                    p.rect(oldPos.get(0), oldPos.get(1), newPos.get(0) - oldPos.get(0), newPos.get(1) - oldPos.get(1));
                    p.pop();
                });
            }
        }
        if (this.isBusyMultiSelect && !this.p.mouseIsPressed) {
            this.multiSelectShapeIndices = [];
            this.mouseDown = false;
            this.isBusyMultiSelect = false;
            this.hasMultiSelected = true;
            // const newPos = nj.array([this.p.mouseX, this.p.mouseY]);
            const newMousePos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            const rectTopLeftBottomRight = [
                Math.min(this.multiSelectStartPoint.get(0), newMousePos.get(0)),
                Math.min(this.multiSelectStartPoint.get(1), newMousePos.get(1)),
                Math.max(this.multiSelectStartPoint.get(0), newMousePos.get(0)),
                Math.max(this.multiSelectStartPoint.get(1), newMousePos.get(1)),
            ];
            const _isPointInRect = (point: ndarray, rect: number[]) => {
                return point.get(0) > rect[0] && point.get(0) < rect[2] && point.get(1) > rect[1] && point.get(1) < rect[3];
            };
            for (let i = 0; i < this.staticEnvParams.numCircles; ++i) {
                const circlePos = envState.circle[i].position;
                // chec if circle is in the rect
                if (_isPointInRect(circlePos, rectTopLeftBottomRight)) {
                    envState.circle[i].highlighted = true;
                    this.multiSelectShapeIndices.push(i + this.staticEnvParams.numPolygons);
                }
            }
            for (let i = 0; i < this.staticEnvParams.numPolygons; ++i) {
                for (let j = 0; j < envState.polygon[i].nVertices; ++j) {
                    const vertexPos = matmul(rmat(envState.polygon[i].rotation), envState.polygon[i].vertices.pick(j)).add(
                        envState.polygon[i].position
                    );
                    if (_isPointInRect(vertexPos, rectTopLeftBottomRight)) {
                        envState.polygon[i].highlighted = true;
                        this.multiSelectShapeIndices.push(i);
                        break;
                    }
                }
            }

            if (this.multiSelectShapeIndices.length === 0) {
                this.hasMultiSelected = false;
            } else if (this.multiSelectShapeIndices.length === 1) {
                const entity = selectShape(envState, this.multiSelectShapeIndices[0]);
                this.currentlySelectedShapeIndex =
                    this.multiSelectShapeIndices[0] -
                    (this.multiSelectShapeIndices[0] < this.staticEnvParams.numPolygons ? 0 : this.staticEnvParams.numPolygons);
                this.currentlySelectedShapeType =
                    this.multiSelectShapeIndices[0] < this.staticEnvParams.numPolygons ? EntityType.RECTANGLE : EntityType.CIRCLE;
                this.hasMultiSelected = false;
                this.multiSelectShapeIndices = [];
                this._triggerSelectEntity(envState, entity, this.currentlySelectedShapeType, this.currentlySelectedShapeIndex);
            }
        }
        if (this.mouseDown) {
            this.mouseDown = false;

            const isClose = norm(this.multipleClickPreviousPosition.subtract(nj.array([this.p.mouseX, this.p.mouseY]))) < 5;
            if (isClose) {
                this.multipleClickCounter++;
            } else {
                this.multipleClickCounter = 0;
            }
            this.multipleClickPreviousPosition = nj.array([this.p.mouseX, this.p.mouseY]);
            this._hideAllUIs();
            envState = this._clearHighlighted(envState);
            const ret = this._checkWhatIsClicked(envState);
            envState = ret.envState;
            if (!ret.clicked) {
                if (this.hasMultiSelected) {
                    this.hasMultiSelected = false;
                    this.multiSelectShapeIndices = [];
                }
                if (this.p.mouseIsPressed) {
                    this.isBusyMultiSelect = true;
                    this.multiSelectStartPoint = screenToSim(
                        nj.array([this.p.mouseX, this.p.mouseY]),
                        this.staticEnvParams,
                        this.envParams
                    );
                }
            }
        }

        if (this.currentlySelectedShapeIndex === -1) {
            return envState;
        }

        if (this.currentlySelectedShapeType == EntityType.CIRCLE || this.currentlySelectedShapeType == EntityType.RECTANGLE) {
            envState = this._duringSelectRigidBody(envState);
        } else if (this.currentlySelectedShapeType == EntityType.JOINT) {
            envState = this._duringSelectJoint(envState);
        } else if (this.currentlySelectedShapeType == EntityType.THRUSTER) {
            envState = this._duringSelectThruster(envState);
        }

        return envState;
    }

    render(mode: SketchMode) {
        const w = 16;
        if (mode == SketchMode.EDIT) {
            this.p.image(this.images["edit"], w / 2, w / 2, 1.5 * w, 1.5 * w);
        } else this.p.image(this.images["play"], w / 2, w / 2, 1.5 * w, 1.5 * w);

        const imageNameToUse = {
            [EditorMode.ADD_CIRCLE]: "circle",
            [EditorMode.ADD_RECTANGLE]: "square",
            [EditorMode.ADD_JOINT]: "rjoint",
            [EditorMode.SELECT]: "hand",
            [EditorMode.ADD_THRUSTER]: "thruster",
        }[this.currentMode];
        this.p.image(this.images[imageNameToUse], 3 * w, w / 2, 1.5 * w, 1.5 * w);

        for (let drawCall of this.drawCalls) {
            drawCall(this.p, this.staticEnvParams, this.envParams);
        }
    }

    // #region Add Shape
    addShapeStart(envState: EnvState): EnvState {
        this.isAddingShape = true;
        this.startPressLocation = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
        const arr = this.currentMode == EditorMode.ADD_CIRCLE ? envState.circle : envState.polygon;
        this.addingShapeIndex = findLowestActiveIndex(arr);
        arr[this.addingShapeIndex] = makeSingleEmptyRigidBody(this.staticEnvParams);
        arr[this.addingShapeIndex].active = true;
        arr[this.addingShapeIndex].position = this.startPressLocation;
        arr[this.addingShapeIndex].friction = 1;
        arr[this.addingShapeIndex].density = 1;
        // nonzero placeholders
        arr[this.addingShapeIndex].inverseInertia = 1;
        arr[this.addingShapeIndex].inverseMass = 1;
        envState = this.addShapeMiddle(envState);
        return envState;
    }

    addShapeMiddle(envState: EnvState): EnvState {
        const endPressLocation = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
        if (this.currentMode == EditorMode.ADD_CIRCLE) {
            const delta = endPressLocation.subtract(this.startPressLocation);
            envState.circle[this.addingShapeIndex].radius = Math.min(
                Math.max(MIN_CIRCLE_SIZE, norm(delta)),
                this.staticEnvParams.maxShapeSize / 2
            );
            envState.circle[this.addingShapeIndex] = recalculateInverseMassAndInertiaCircle(envState.circle[this.addingShapeIndex]);
        } else {
            let diff = endPressLocation.subtract(this.startPressLocation).divide(2);

            // diff = screenToSim(diff, this.staticEnvParams, this.envParams, false).multiply(nj.array([1, -1]));
            const clipVal = this.staticEnvParams.maxShapeSize / 2 / Math.sqrt(2);
            diff = nj.clip(diff, -clipVal, clipVal);
            let half_dim = nj.abs(diff);
            half_dim = nj.clip(half_dim, this.envParams.numUnits / this.envParams.pixelsPerUnit);
            const vertices = getRectangleVertices(half_dim.get(0) * 2, half_dim.get(1) * 2);
            envState.polygon[this.addingShapeIndex].vertices = vertices;
            envState.polygon[this.addingShapeIndex].nVertices = vertices.shape[0];
            envState.polygon[this.addingShapeIndex].position = this.startPressLocation.add(diff);
            envState.polygon[this.addingShapeIndex] = recalculateInverseMassAndInertiaPolygon(envState.polygon[this.addingShapeIndex]);
        }

        return envState;
    }

    addShapeEnd(envState: EnvState): EnvState {
        this.isAddingShape = false;
        envState = this._afterCreateEntity(
            envState,
            this.currentMode == EditorMode.ADD_CIRCLE ? EntityType.CIRCLE : EntityType.RECTANGLE,
            this.addingShapeIndex
        );
        this.addingShapeIndex = -1;
        return envState;
    }
    // #endregion

    _snapToLine(a: ndarray, b: ndarray, position: ndarray): ndarray {
        const ab = b.subtract(a);
        const ap = position.subtract(a);
        const abNorm = norm(ab);
        const apNorm = norm(ap);
        const abUnit = ab.divide(abNorm);
        const proj = vvDot(ap, abUnit);
        return a.add(abUnit.multiply(proj));
    }

    _getBestPosition(positions: SnapReturn[], base_position: ndarray): SnapReturn | null {
        let shouldRepeat = true;
        let j = 0;
        let toReturn: SnapReturn | null = null;
        while (shouldRepeat) {
            ++j;
            if (j > 10) break;
            shouldRepeat = false;
            for (let newPosA of positions) {
                let newPos = newPosA;
                if (newPosA.snap_line) {
                    newPos.pos = this._snapToLine(newPosA.snap_line[0], newPosA.snap_line[1], base_position);
                }
                if (norm(newPos.pos.subtract(base_position)) < this.SNAP_DIST) {
                    if (norm(newPos.pos.subtract(base_position)) > 0.01) {
                        base_position = newPos.pos;
                        this.drawCalls.push(newPos.addDrawToBuffer());
                        shouldRepeat = true;
                        toReturn = newPos;
                    }
                }
            }
        }
        return toReturn;
    }

    _snapPositionToRectangle(rect: RigidBody, position: ndarray): SnapReturn {
        const mat = rmat(rect.rotation);
        const p = (x: ndarray) => matmul(mat, x);
        const a = p(rect.vertices.pick(0).add(rect.vertices.pick(3)).divide(2)).add(rect.position);
        const b = p(rect.vertices.pick(1).add(rect.vertices.pick(2)).divide(2)).add(rect.position);

        const aa = p(rect.vertices.pick(0).add(rect.vertices.pick(1)).divide(2)).add(rect.position);
        const bb = p(rect.vertices.pick(2).add(rect.vertices.pick(3)).divide(2)).add(rect.position);
        const newPositionA = this._snapToLine(a, b, position);
        const newPositionB = this._snapToLine(aa, bb, position);

        const _addRectVertex = (index: number) => {
            const point = p(rect.vertices.pick(index)).add(rect.position);
            return new SnapReturn(point, null, point);
        };

        const newPositionC = rect.position;
        const positionsToTry = [
            // new SnapReturn(newPositionC, null, rect.position),
            new SnapReturn(newPositionA, [a, b], null),
            new SnapReturn(newPositionB, [aa, bb], null),
            new SnapReturn(a, null, a),
            new SnapReturn(b, null, b),
            new SnapReturn(aa, null, aa),
            new SnapReturn(bb, null, bb),
            _addRectVertex(0),
            _addRectVertex(1),
            _addRectVertex(2),
            _addRectVertex(3),
        ];
        return this._getBestPosition(positionsToTry, position);
    }
    _snapPositionToAllRectangles(envState: EnvState, position: ndarray, ignoreIndexes: number[] = []): ndarray {
        const allPos = [];
        for (let i = this.staticEnvParams.numStaticFixatedPolys; i < this.staticEnvParams.numPolygons; i++) {
            const rect = envState.polygon[i];
            if (!rect.active) continue;
            if (ignoreIndexes.includes(i)) continue;
            const candidate = this._snapPositionToRectangle(rect, position);
            if (candidate) {
                allPos.push(candidate);
            }
        }
        let bestPos = null;
        for (let newPos of allPos) {
            if (bestPos == null || norm(newPos.pos.subtract(position)) < norm(bestPos.pos.subtract(position))) {
                bestPos = newPos;
            }
        }
        if (bestPos == null) return position;
        else {
            this.drawCalls.push(bestPos.addDrawToBuffer());
            return bestPos.pos;
        }
    }
    _snapPositionToCircle(circle: RigidBody, pos: ndarray) {
        const delta = pos.subtract(circle.position);
        if (norm(delta) < this.SNAP_DIST) {
            return new SnapReturn(circle.position, null, circle.position);
        }
        return null;
    }
    _snapPositionToAllCircles(envState: EnvState, position: ndarray, ignoreIndexes: number[] = []): ndarray {
        let bestPos;
        for (let i = 0; i < envState.circle.length; i++) {
            const circle = envState.circle[i];
            if (!circle.active) continue;
            if (ignoreIndexes.includes(i)) continue;
            const candidate = this._snapPositionToCircle(circle, position);
            // const delta = position.subtract(circle.position);
            if (bestPos == null || norm(candidate.pos.subtract(position)) < norm(bestPos.pos.subtract(position))) {
                bestPos = candidate;
            }
        }
        if (bestPos) {
            this.drawCalls.push(bestPos.addDrawToBuffer());
            return bestPos.pos;
        }
        return position;
    }

    _snapPositionToAllShapes(
        envState: EnvState,
        position: ndarray,
        ignoreCircleIndex: number | null = null,
        ignorePolyIndex: number | null = null,
        unifiedIndexToIgnoreCollisionMatrix: number | null = null
    ) {
        if (!this.shouldSnap) return position;
        const ignorePolys = [];
        const ignoreCircles = [];
        if (ignorePolyIndex !== null) ignorePolys.push(ignorePolyIndex);
        if (ignoreCircleIndex !== null) ignoreCircles.push(ignoreCircleIndex);
        if (unifiedIndexToIgnoreCollisionMatrix !== null) {
            for (let i = 0; i < envState.collisionMatrix.shape[0]; i++) {
                if (envState.collisionMatrix.get(i, unifiedIndexToIgnoreCollisionMatrix) == 0) {
                    if (i < this.staticEnvParams.numPolygons) {
                        ignorePolys.push(i);
                    } else {
                        ignoreCircles.push(i - this.staticEnvParams.numPolygons);
                    }
                }
            }
        }
        position = this._snapPositionToAllRectangles(envState, position, ignorePolys);

        position = this._snapPositionToAllCircles(envState, position, ignoreCircles);
        return position;
    }

    _snapPosition(envState: EnvState, position: ndarray, aIndex: number, bIndex: number, doDraw = true): ndarray {
        if (!this.shouldSnap) return position;
        const _choosePositions = (pos: ndarray, positions: (SnapReturn | null)[]): ndarray => {
            let bestPos = null;
            for (let newPos of positions) {
                if (newPos === null) continue;
                if (bestPos == null || norm(newPos.pos.subtract(pos)) < norm(bestPos.pos.subtract(pos))) {
                    bestPos = newPos;
                }
            }
            if (doDraw && bestPos) {
                this.drawCalls.push(bestPos.addDrawToBuffer());
            }
            return bestPos == null ? pos : bestPos.pos;
        };
        const a = selectShape(envState, aIndex);
        const snapPosA =
            aIndex < this.staticEnvParams.numPolygons
                ? this._snapPositionToRectangle(a, position)
                : this._snapPositionToCircle(a, position);
        const positionsToChoose = [snapPosA];

        if (bIndex >= 0) {
            const b = selectShape(envState, bIndex);
            const snapPosB =
                bIndex < this.staticEnvParams.numPolygons
                    ? this._snapPositionToRectangle(b, position)
                    : this._snapPositionToCircle(b, position);
            positionsToChoose.push(snapPosB);
        }
        return _choosePositions(position, positionsToChoose);
    }
    // #region Add Joint and Thruster
    addJoint(envState: EnvState): EnvState {
        const rb = this._getShapeOnMouse(envState);
        if (!rb) return envState; // no op if no shape is selected
        if (!this._isModeAvailable(EditorMode.ADD_JOINT, envState)) {
            this._showStatus("No joints left to add");
            return envState;
        }
        const addTempJoint = (envState: EnvState, predefinedIndex: number | null = null) => {
            if (predefinedIndex == -1) predefinedIndex = null;
            const circlesOnMouse = this._getCircleOnMouse(envState).reverse();
            const polygonsOnMouse = this._getPolygonOnMouse(envState).reverse();
            if (circlesOnMouse.length + polygonsOnMouse.length < 2) {
                if (predefinedIndex !== null) {
                    envState.joint[predefinedIndex].active = false;
                }
                return { envState, index: -1 }; // no op}
            }

            const r1 = polygonsOnMouse.length >= 1;
            const r2 = polygonsOnMouse.length >= 2;

            let aIndex, bIndex;
            if (r1) {
                aIndex = polygonsOnMouse[0];
            } else {
                aIndex = circlesOnMouse[0] + this.staticEnvParams.numPolygons;
            }
            if (r2) {
                bIndex = polygonsOnMouse[1];
            } else {
                bIndex = circlesOnMouse[r1 ? 0 : 1] + this.staticEnvParams.numPolygons;
            }

            const a = selectShape(envState, aIndex);
            const b = selectShape(envState, bIndex);

            let jointPosSim = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);

            jointPosSim = this._snapPosition(envState, jointPosSim, aIndex, bIndex, false);

            const idx = predefinedIndex === null ? findLowestActiveIndex(envState.joint) : predefinedIndex;
            envState.joint[idx] = makeSingleEmptyJoint();

            envState.joint[idx].active = true;
            envState.joint[idx].aIndex = aIndex;
            envState.joint[idx].bIndex = bIndex;
            envState.joint[idx].globalPosition = jointPosSim;
            envState.joint[idx].rotation = b.rotation - a.rotation;
            envState.joint[idx].aRelativePos = matmul(rmat(a.rotation).transpose([1, 0]), jointPosSim.subtract(a.position));
            envState.joint[idx].bRelativePos = matmul(rmat(b.rotation).transpose([1, 0]), jointPosSim.subtract(b.position));
            envState.joint[idx].motorHasJointLimits = false;
            envState.joint[idx].motorOn = true;
            envState.joint[idx].motorPower = 1.0;
            envState.joint[idx].motorSpeed = 1.0;
            envState.joint[idx].isFixedJoint = false;

            envState.collisionMatrix = calculateCollisionMatrix(this.staticEnvParams, envState.joint);

            return { envState, index: idx };
        };
        if (this.mouseDown) {
            this.mouseDown = false;
            const ret = addTempJoint(envState, this.addingShapeIndex);
            if (ret.index != -1) {
                this.hasMadeAnyChanges = true;
                envState = ret.envState;
                envState.joint[this.addingShapeIndex].transparent = false;
                this.isCurrentlyPlacingJoint = false;
                envState = this._afterCreateEntity(envState, EntityType.JOINT, this.addingShapeIndex);
                this.addingShapeIndex = -1;
            }
        } else {
            if (this.isCurrentlyPlacingJoint && this.addingShapeIndex !== -1) {
                const ret = addTempJoint(envState, this.addingShapeIndex);
                envState.joint[this.addingShapeIndex].transparent = true;
                envState = ret.envState;

                if (ret.index === -1) {
                    envState.joint[this.addingShapeIndex].transparent = false;
                    envState.joint[this.addingShapeIndex].active = false;
                    this.addingShapeIndex = -1;
                    this.isCurrentlyPlacingJoint = false;
                }
            } else {
                this.isCurrentlyPlacingJoint = true;
                const ret = addTempJoint(envState);
                envState = ret.envState;
                this.addingShapeIndex = ret.index;
            }
        }
        return envState;
    }

    addTriangle(envState: EnvState): EnvState {
        return envState;
    }

    _hasAnyInactives(array: (RigidBody | Thruster | Joint)[]) {
        for (let item of array) {
            if (!item.active) return true;
        }
        return false;
    }
    hasAnyThrustersLeft(envState: EnvState) {
        return this._hasAnyInactives(envState.thruster);
    }
    hasAnyJointsLeft(envState: EnvState) {
        return this._hasAnyInactives(envState.joint);
    }
    hasAnyCirclesLeft(envState: EnvState) {
        return this._hasAnyInactives(envState.circle);
    }
    hasAnyPolygonsLeft(envState: EnvState) {
        return this._hasAnyInactives(envState.polygon);
    }

    _isModeAvailable(mode: EditorMode, envState: EnvState) {
        switch (mode) {
            case EditorMode.ADD_CIRCLE:
                return this.hasAnyCirclesLeft(envState);
            case EditorMode.ADD_RECTANGLE:
                return this.hasAnyPolygonsLeft(envState);
            case EditorMode.ADD_JOINT:
                return this.hasAnyJointsLeft(envState) || this.isAddingShape || this.isCurrentlyPlacingJoint;
            case EditorMode.ADD_THRUSTER:
                return this.hasAnyThrustersLeft(envState) || this.isAddingShape || this.isCurrentlyPlacingThruster;
        }
        return true;
    }

    addThruster(envState: EnvState): EnvState {
        if (!this._isModeAvailable(EditorMode.ADD_THRUSTER, envState)) {
            this._showStatus("No thrusters left to add");
            return envState;
        }
        const rb = this._getShapeOnMouse(envState);
        if (!rb && !this.isAddingShape) {
            // no op if no shape is selected
            if (this.isCurrentlyPlacingThruster && this.addingShapeIndex !== -1) {
                envState.thruster[this.addingShapeIndex].active = false;
                this.addingShapeIndex = -1;
                this.isCurrentlyPlacingThruster = false;
            }
            return envState;
        }

        const addTempThruster = (envState: EnvState, predefinedIndex: number | null = null) => {
            if (predefinedIndex == -1) predefinedIndex = null;
            let thrusterPosSim = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            const objIndex =
                this.currentlySelectedShapeIndex +
                (this.currentlySelectedShapeType === EntityType.CIRCLE ? this.staticEnvParams.numPolygons : 0);
            thrusterPosSim = this._snapPosition(envState, thrusterPosSim, objIndex, -1);
            const index = predefinedIndex === null ? findLowestActiveIndex(envState.thruster) : predefinedIndex;
            const relativePos = matmul(rmat(rb.rotation).transpose([1, 0]), thrusterPosSim.subtract(rb.position));

            let binding = 0;
            for (let i = 0; i < envState.thruster.length; i++) {
                if (
                    envState.thruster[i].active &&
                    binding == envState.thruster[i].thrusterBinding &&
                    !envState.thruster[i].transparent &&
                    i !== predefinedIndex
                ) {
                    binding = (binding + 1) % this.staticEnvParams.numThrusterBindings;
                }
            }
            envState.thruster[index] = makeSingleEmptyThruster();
            envState.thruster[index].active = true;
            envState.thruster[index].relativePosition = relativePos;
            envState.thruster[index].globalPosition = thrusterPosSim;
            envState.thruster[index].objectIndex = objIndex;
            envState.thruster[index].thrusterBinding = binding;
            envState.thruster[index].power = rb.inverseMass == 0 ? 1 : 2.5 / rb.inverseMass;
            envState.thruster[index].rotation = 0;
            return { envState, index };
        };
        if (this.mouseDown) {
            this.mouseDown = false;
            if (this.isAddingShape) {
                this.isAddingShape = false;
                envState.thruster[this.addingShapeIndex].transparent = false;
                this._afterCreateEntity(envState, EntityType.THRUSTER, this.addingShapeIndex);
                this.addingShapeIndex = -1;
            } else {
                const ret = addTempThruster(envState, this.addingShapeIndex);
                if (ret.index != -1) {
                    this.hasMadeAnyChanges = true;
                }
                envState = ret.envState;
                this.isCurrentlyPlacingThruster = false;
                this.isAddingShape = true;
                this.addingShapeIndex = ret.index;
            }
        } else {
            if (this.isAddingShape) {
                // update rotation
                const currPos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
                const parent = selectShape(envState, envState.thruster[this.addingShapeIndex].objectIndex);
                const globalThrusterPos = matmul(rmat(parent.rotation), envState.thruster[this.addingShapeIndex].relativePosition).add(
                    parent.position
                );
                const normal = envState.thruster[this.addingShapeIndex].relativePosition;
                const angleToCOM = Math.PI + Math.atan2(normal.get(1), normal.get(0));
                const relative_pos = currPos.subtract(globalThrusterPos);
                let rotation = Math.PI + Math.atan2(relative_pos.get(1), relative_pos.get(0));
                const rotSnapVal = Math.PI / 4; // 3

                const isAngleClose = (angleA: number, angleB: number, threshold: number = 0.5) => {
                    return Math.abs((angleA - angleB + Math.PI * 2) % (Math.PI * 2)) < threshold;
                };
                const snapToAngle = (angle: number, threshold = 0.5) => {
                    const divided = angle / rotSnapVal;

                    const round = Math.round(divided);
                    if (isAngleClose(round, divided)) {
                        return { angle: round * rotSnapVal, snapped: true };
                    }
                    return { angle, snapped: false };
                };

                const shouldSnapToCOM = norm(envState.thruster[this.addingShapeIndex].relativePosition) > 0.01;
                const comOpposite = angleToCOM + Math.PI;
                const comSnapReturn = new SnapReturn(null, [parent.position, globalThrusterPos], null, true);
                if (shouldSnapToCOM) {
                    this.drawCalls.push(comSnapReturn.addDrawToBuffer());
                    rotation = Math.abs(rotation - angleToCOM) < Math.abs(rotation - comOpposite) ? angleToCOM : comOpposite;
                } else {
                    const { angle: newRotation, snapped } = snapToAngle(rotation);
                    rotation = newRotation;
                }
                // if (shouldSnapToCOM && isAngleClose(rotation, angleToCOM, 0.7)) {
                //     rotation = angleToCOM;
                //     this.drawCalls.push(comSnapReturn.addDrawToBuffer());
                // } else if (shouldSnapToCOM && isAngleClose(rotation, comOpposite, 0.7)) {
                //     rotation = comOpposite;
                //     this.drawCalls.push(comSnapReturn.addDrawToBuffer());
                // } else if (!shouldSnapToCOM) {

                // }
                envState.thruster[this.addingShapeIndex].rotation = rotation;
            } else {
                if (this.isCurrentlyPlacingThruster && this.addingShapeIndex !== -1) {
                    const ret = addTempThruster(envState, this.addingShapeIndex);
                    envState.thruster[this.addingShapeIndex].transparent = true;
                    envState = ret.envState;
                    if (ret.index === -1) {
                        envState.thruster[this.addingShapeIndex].transparent = false;
                        envState.thruster[this.addingShapeIndex].active = false;
                        this.addingShapeIndex = -1;
                        this.isCurrentlyPlacingThruster = false;
                    }
                } else {
                    this.isCurrentlyPlacingThruster = true;
                    const ret = addTempThruster(envState);
                    envState = ret.envState;
                    this.addingShapeIndex = ret.index;
                }
            }
        }

        return envState;
    }

    _afterCreateEntity(envState: EnvState, type: EntityType, index: number): EnvState {
        this.changeMode(EditorMode.SELECT);
        this._hideAllUIs();
        this.currentlySelectedShapeIndex = index;
        this.currentlySelectedShapeType = type;
        this.mouseDown = false;
        envState = this._clearHighlighted(envState);
        const arr = {
            [EntityType.CIRCLE]: envState.circle,
            [EntityType.RECTANGLE]: envState.polygon,
            [EntityType.JOINT]: envState.joint,
            [EntityType.THRUSTER]: envState.thruster,
        }[type];
        envState = this._triggerSelectEntity(envState, arr[index], type, index);
        return envState;
    }

    // #endregion

    _nthItemOnMouse(envState: EnvState, offsetNumber: number = 0, forceType: EntityType | null = null) {
        const joints = this._getJointsOnMouse(envState);
        const thrusters = this._getThrustersOnMouse(envState);
        const circles = this._getCircleOnMouse(envState);
        const polygons = this._getPolygonOnMouse(envState);
        const a = joints.length;
        const b = a + thrusters.length;
        const c = b + circles.length;
        const d = c + polygons.length;
        if (offsetNumber >= d) {
            offsetNumber = offsetNumber % d;
        }

        const isTypeAllowed = (type: EntityType) => forceType === null || forceType === type;

        let array,
            idx = -1,
            type;
        if (offsetNumber < a && isTypeAllowed(EntityType.JOINT)) {
            idx = joints[offsetNumber];
            array = envState.joint;
            type = EntityType.JOINT;
        } else if (a <= offsetNumber && offsetNumber < b && isTypeAllowed(EntityType.THRUSTER)) {
            idx = thrusters[offsetNumber - a];
            array = envState.thruster;
            type = EntityType.THRUSTER;
        } else if (b <= offsetNumber && offsetNumber < c && isTypeAllowed(EntityType.CIRCLE)) {
            type = EntityType.CIRCLE;
            idx = circles[offsetNumber - b];
            array = envState.circle;
        } else if (c <= offsetNumber && offsetNumber < d && isTypeAllowed(EntityType.RECTANGLE)) {
            idx = polygons[offsetNumber - c];
            array = envState.polygon;
            type = EntityType.RECTANGLE;
        }

        return { entity: idx >= 0 ? array[idx] : null, idx, type, array };
    }

    _triggerSelectEntity(envState: EnvState, entity: RigidBody | Joint | Thruster, type: EntityType, index: number): EnvState {
        this.qs[3].hide();
        this.hasMadeAnyChanges = true;
        switch (type) {
            case EntityType.CIRCLE:
            case EntityType.RECTANGLE:
                return this._onSelectRigidBody(envState, entity as RigidBody, index);
            case EntityType.JOINT:
                return this._onSelectJoint(envState, entity as Joint, index);
            case EntityType.THRUSTER:
                return this._onSelectThruster(envState, entity as Thruster, index);
        }
    }

    _checkWhatIsClicked(envState: EnvState) {
        const { entity, array, type, idx } = this._nthItemOnMouse(envState, this.multipleClickCounter);
        if (idx == -1) return { envState: envState, clicked: false };
        this.currentlySelectedShapeType = type;

        if (this.hasMultiSelected) {
            if (
                (this.multiSelectShapeIndices.includes(idx) && type == EntityType.RECTANGLE) ||
                (this.multiSelectShapeIndices.includes(idx + this.staticEnvParams.numPolygons) && type == EntityType.CIRCLE)
            ) {
                if (this.multiSelectShapeIndices.length == 1) {
                    this.hasMultiSelected = false;
                    this.multiSelectShapeIndices = [];
                }
                for (let i of this.multiSelectShapeIndices) {
                    selectShape(envState, i).highlighted = true;
                }
            } else {
                this.hasMultiSelected = false;
                this.multiSelectShapeIndices = [];
            }
        }
        const newEnvState = this._triggerSelectEntity(envState, entity, type, idx);

        return { envState: newEnvState, clicked: true };
    }

    // #region Selecting
    _onSelectThruster(envState: EnvState, t: Thruster, idx: number | null = null): EnvState {
        if (idx !== null) {
            this.currentlySelectedShapeType = EntityType.THRUSTER;
            this.currentlySelectedShapeIndex = idx;
        }
        this.qs[2].show();
        t.highlighted = true;
        this.populateEntityFields(t);
        return envState;
    }

    _duringSelectThruster(envState: EnvState): EnvState {
        console.assert(this.currentlySelectedShapeType === EntityType.THRUSTER);
        const t = envState.thruster[this.currentlySelectedShapeIndex];

        return this.putUIFieldsInsideEntity(t, envState).envState;
    }

    _onSelectJoint(envState: EnvState, j: Joint, idx: number | null = null): EnvState {
        if (idx !== null) {
            this.currentlySelectedShapeType = EntityType.JOINT;
            this.currentlySelectedShapeIndex = idx;
        }
        this.qs[1].show();
        j.highlighted = true;
        this.populateEntityFields(j);
        return envState;
    }

    _duringSelectJoint(envState: EnvState): EnvState {
        console.assert(this.currentlySelectedShapeType === EntityType.JOINT);
        const j = envState.joint[this.currentlySelectedShapeIndex];

        return this.putUIFieldsInsideEntity(j, envState).envState;
    }

    _onSelectRigidBody(envState: EnvState, rb: RigidBody, idx: number | null = null): EnvState {
        if (idx !== null) {
            this.currentlySelectedShapeIndex = idx;
        }
        if (!this.hasMultiSelected) this.qs[0].show();
        rb.highlighted = true;
        this.populateEntityFields(rb);
        this.mouseDragStartPos = nj.array([this.p.mouseX, this.p.mouseY]);
        this.mouseDragStartRBPos = rb.position;
        return envState;
    }

    _moveRigidBody(
        envState: EnvState,
        unifiedIndex: number,
        newPosition: ndarray,
        newRotation: number = null,
        extraIndices: number[] | null = null
    ): EnvState {
        const rb = selectShape(envState, unifiedIndex);
        const changeInPos = newPosition.subtract(rb.position);
        const rotationDelta = newRotation === null ? 0 : newRotation - rb.rotation;
        const indicesThatShouldMoveTogether = [];
        for (let i = 0; i < envState.collisionMatrix.shape[0]; i++) {
            if (envState.collisionMatrix.get(i, unifiedIndex) == 0) {
                indicesThatShouldMoveTogether.push(i);
            }
        }
        if (extraIndices !== null) {
            for (let i of extraIndices) {
                if (!indicesThatShouldMoveTogether.includes(i)) {
                    indicesThatShouldMoveTogether.push(i);
                }
            }
        }
        for (let i of indicesThatShouldMoveTogether) {
            if (i < this.staticEnvParams.numStaticFixatedPolys) continue;
            const otherRb = selectShape(envState, i);
            otherRb.position = otherRb.position.add(changeInPos);
            otherRb.rotation += rotationDelta;
        }

        if (rotationDelta != 0) {
            for (let repeat = 0; repeat < envState.joint.length; repeat++) {
                for (let j = 0; j < envState.joint.length; j++) {
                    const joint = envState.joint[j];
                    if (joint.active && indicesThatShouldMoveTogether.includes(joint.aIndex)) {
                        const a = selectShape(envState, joint.aIndex);
                        const b = selectShape(envState, joint.bIndex);
                        if (
                            joint.aIndex < this.staticEnvParams.numStaticFixatedPolys ||
                            joint.bIndex < this.staticEnvParams.numStaticFixatedPolys
                        ) {
                            continue;
                        }
                        const { a_point, b_point } = getGlobalJointPosition(a, b, joint.aRelativePos, joint.bRelativePos);
                        const diff = b_point.subtract(a_point);
                        const diffMultiplied = diff;
                        if (unifiedIndex != joint.aIndex) a.position.add(diffMultiplied, false);
                        if (unifiedIndex != joint.bIndex) b.position.subtract(diffMultiplied, false);
                    }
                }
            }
        }
        return envState;
    }

    _duringSelectRigidBody(envState: EnvState): EnvState {
        const isCircle = this.currentlySelectedShapeType === EntityType.CIRCLE;
        const arr = isCircle ? envState.circle : envState.polygon;
        const rb = arr[this.currentlySelectedShapeIndex];

        if (
            this.p.mouseIsPressed &&
            this.mouseDragStartPos &&
            !(
                this.currentlySelectedShapeType === EntityType.RECTANGLE &&
                this.currentlySelectedShapeIndex < this.staticEnvParams.numStaticFixatedPolys
            )
        ) {
            let delta = nj.array([this.p.mouseX, this.p.mouseY]).subtract(this.mouseDragStartPos);
            delta = screenToSim(delta, this.staticEnvParams, this.envParams, false);
            let newPosition = this.mouseDragStartRBPos.add(delta.multiply(nj.array([1, -1])));
            const unifiedIndex = this.currentlySelectedShapeIndex + (isCircle ? this.staticEnvParams.numPolygons : 0);

            // see if we want to snap

            newPosition = this._snapPositionToAllShapes(envState, newPosition, null, null, unifiedIndex);
            envState = this._moveRigidBody(
                envState,
                unifiedIndex,
                newPosition,
                null,
                this.hasMultiSelected ? this.multiSelectShapeIndices : null
            );
            if (norm(delta) > 0.01) {
                rb.transparent = true;
            }
            this.populateEntityFields(rb);
        } else {
            this.mouseDragStartPos = null;
            rb.transparent = false;
        }

        // now put UI fields inside entity
        envState = this.putUIFieldsInsideEntity(rb, envState, this.currentlySelectedShapeType, this.currentlySelectedShapeIndex).envState;
        envState = recalculateGlobalPositions(envState);
        arr[this.currentlySelectedShapeIndex] = isCircle
            ? recalculateInverseMassAndInertiaCircle(rb)
            : recalculateInverseMassAndInertiaPolygon(rb);
        return envState;
    }
    // #endregion Selecting

    onResumeFocus() {
        this.levelsSaved = [];
    }
    hideDivMode(setDisplay = false) {
        const elem = document.getElementById("divMode");
        if (elem) {
            elem.style.visibility = "hidden";
            elem.parentElement.parentElement.style.visibility = "hidden";
            if (setDisplay) {
                elem.parentElement.parentElement.style.display = "none";
            }
        }
    }
    showDivMode() {
        const elem = document.getElementById("divMode");
        if (elem) {
            elem.style.visibility = "visible";
            elem.parentElement.parentElement.style.visibility = "visible";
            elem.parentElement.parentElement.style.display = null;
        }
    }
    stopEditing(envState: EnvState): EnvState {
        this.isCurrentlyBusyEditing = false;
        for (let q of this.qs) {
            q.hide();
        }
        this.qs[6].show();
        showBackButton(this.qs[7]);
        this.hideDivMode();
        this.drawCalls = [];
        this._discardBusyWithThrustersAndJoints();
        envState = this._cleanupJointsAndThrusters(envState);
        this.mouseDown = false;
        this.currentlySelectedShapeIndex = -1;
        return this._clearHighlighted(envState);
    }
    startEditing(envState: EnvState): EnvState {
        this.isCurrentlyBusyEditing = true;
        if (!this.pageLoadStateReference.isEmbedded()) this.qs[3].show();
        this.qs[5].show();
        this.qs[6].show();
        this.qs[7].show();
        showBackButton(this.qs[7]);
        this.showDivMode();

        if (isSmallScreen()) {
            this.setSmallScreenMode();
        }
        return envState;
    }

    setSmallScreenMode() {
        this.hideDivMode(true);
        this.qs[5].hide();
    }

    _clearHighlighted(envState: EnvState): EnvState {
        for (let i = 0; i < envState.circle.length; i++) {
            envState.circle[i].highlighted = false;
            envState.circle[i].transparent = false;
        }
        for (let i = 0; i < envState.polygon.length; i++) {
            envState.polygon[i].highlighted = false;
            envState.polygon[i].transparent = false;
        }
        for (let i = 0; i < envState.joint.length; i++) {
            envState.joint[i].highlighted = false;
            envState.joint[i].transparent = false;
        }
        for (let i = 0; i < envState.thruster.length; i++) {
            envState.thruster[i].highlighted = false;
            envState.thruster[i].transparent = false;
        }
        return envState;
    }

    drawSnapLines(envState: EnvState, circle: RigidBody | null = null, polygon: RigidBody | null = null) {
        this.p.push();
        this.p.drawingContext.setLineDash([5, 5]);
        if (circle) {
            const mousePos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            let delta = mousePos.subtract(circle.position);
            delta = delta.divide(zeroToOne(norm(delta))).multiply(circle.radius);
            const orthogonal = nj.array([delta.get(1), -delta.get(0)]);
            const doLine = (a: ndarray, b: ndarray) => {
                const aa = simToScreen(a, this.staticEnvParams, this.envParams);
                const bb = simToScreen(b, this.staticEnvParams, this.envParams);

                this.p.line(aa.get(0), aa.get(1), bb.get(0), bb.get(1));
            };
            doLine(circle.position.subtract(delta), circle.position.add(delta));
            doLine(circle.position.subtract(orthogonal), circle.position.add(orthogonal));

            // if (norm(mousePos.subtract(circle.position)) < 1){
            //     this.p.mouseX = simToScreen(circle.position, this.staticEnvParams, this.envParams).get(0);
            //     this.p.mouseY = simToScreen(circle.position, this.staticEnvParams, this.envParams).get(1);
            // }
        }
        this.p.pop();
    }

    markForDeletion() {
        this.shouldDeleteShape = true;
        this.shouldDeleteShapeIndex = this.currentlySelectedShapeIndex;
        this.shouldDeleteShapeType = this.currentlySelectedShapeType;
    }
    // #region Events

    mousePressed(e: MouseEvent, self: Editor) {
        if (self.p.mouseX < 0 || self.p.mouseX > self.p.width || self.p.mouseY < 0 || self.p.mouseY > self.p.height) {
            return;
        }
        const elem = document.getElementsByTagName("canvas")[0];
        if (!this.isActive()) return;
        if (this.modalIsActive) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.button == 0) {
            this.mouseDown = !this.mouseDown;
        } else {
            this.mouseRightClick = true;
        }
    }

    _discardBusyWithThrustersAndJoints() {
        if (this.isCurrentlyPlacingJoint) {
            this.isCurrentlyPlacingJoint = false;
            this.shouldDeleteTempJoint = this.addingShapeIndex;
        }
        if (this.isCurrentlyPlacingThruster) {
            this.isCurrentlyPlacingThruster = false;
            this.shouldDeleteTempThruster = this.addingShapeIndex;
        }
    }
    _cleanupJointsAndThrusters(envState: EnvState) {
        if (this.shouldDeleteTempJoint !== -1) {
            envState.joint[this.shouldDeleteTempJoint].active = false;
            this.shouldDeleteTempJoint = -1;
        }
        if (this.shouldDeleteTempThruster !== -1) {
            envState.thruster[this.shouldDeleteTempThruster].active = false;
            this.shouldDeleteTempThruster = -1;
        }
        return envState;
    }

    _checkMode(envState: EnvState) {
        return envState;
        let delta = Math.sign(this.currentMode - this.oldMode);
        delta = delta == 0 ? 1 : delta;
        if (this.oldMode == 0 && this.currentMode > 1) {
            delta = -1;
        }
        if (this.currentMode == 0 && this.oldMode > 1) {
            delta = 1;
        }
        while (!this._isModeAvailable(this.currentMode, envState)) {
            this.changeMode((this.currentMode + delta + 5) % 5);
        }
    }

    changeMode(newMode: EditorMode) {
        // check if new mode is available
        const oldMode = this.currentMode;
        this.currentMode = newMode;
        this.isAddingShape = false;
        if (oldMode != this.currentMode) {
            this.oldMode = oldMode;
            this._hideAllUIs();
            this._discardBusyWithThrustersAndJoints();
            this.currentlySelectedShapeIndex = -1;
        }
        return;
    }

    mouseScroll(event: WheelEvent, self: Editor) {
        if (
            self.p.mouseX < 0 ||
            self.p.mouseX > self.p.width ||
            self.p.mouseY < 0 ||
            self.p.mouseY > self.p.height ||
            this.pageLoadStateReference.isEmbedded()
        ) {
            return;
        }
        if (!this.isActive()) return;
        if (this.modalIsActive) return;
        const newMode = (self.currentMode + 1 * Math.sign(event.deltaY) + 5) % 5;
        if (newMode != self.currentMode) {
            self.changeMode(newMode);
        }
    }

    _handleRightClick(envState: EnvState): EnvState {
        this.multipleClickCounter = 0;
        const typeToAllow = {
            [EditorMode.ADD_CIRCLE]: EntityType.CIRCLE,
            [EditorMode.ADD_RECTANGLE]: EntityType.RECTANGLE,
            [EditorMode.ADD_JOINT]: EntityType.JOINT,
            [EditorMode.ADD_THRUSTER]: EntityType.THRUSTER,
        };
        if (!(this.currentMode in typeToAllow)) return envState;
        const { entity, array, type, idx } = this._nthItemOnMouse(
            envState,
            0,
            typeToAllow[this.currentMode as keyof typeof typeToAllow] as EntityType
        );
        if (idx == -1) return envState;
        this.hasMadeAnyChanges = true;
        switch (type) {
            case EntityType.CIRCLE:
            case EntityType.RECTANGLE:
                return this._deleteRigidBody(envState, idx, type);
            case EntityType.JOINT:
                return this._deleteJoint(envState, idx);
            case EntityType.THRUSTER:
                return this._deleteThruster(envState, idx);
        }
        return envState;
    }

    // #endregion Events

    // #region Deleting
    _deleteJoint(envState: EnvState, jointIndex: number): EnvState {
        envState.joint[jointIndex].active = false;
        envState.collisionMatrix = calculateCollisionMatrix(this.staticEnvParams, envState.joint);
        return envState;
    }

    _deleteThruster(envState: EnvState, thrusterIndex: number): EnvState {
        envState.thruster[thrusterIndex].active = false;
        return envState;
    }

    _deleteRigidBody(envState: EnvState, index: number, type: EntityType): EnvState {
        const arr = type === EntityType.CIRCLE ? envState.circle : envState.polygon;
        const normalisedIndex = index + (type === EntityType.CIRCLE ? this.staticEnvParams.numPolygons : 0);
        arr[index].active = false;
        // find all joints with this index and delete them
        for (let i = 0; i < envState.joint.length; ++i) {
            const joint = envState.joint[i];
            if (joint.aIndex == normalisedIndex || joint.bIndex == normalisedIndex) {
                envState = this._deleteJoint(envState, i);
            }
        }

        for (let i = 0; i < envState.thruster.length; ++i) {
            const thruster = envState.thruster[i];
            if (thruster.objectIndex == normalisedIndex) {
                envState = this._deleteThruster(envState, i);
            }
        }

        return envState;
    }

    // #endregion Deleting

    // #region Clicking

    _getShapeOnMouse(envState: EnvState): RigidBody | null {
        this.currentlySelectedShapeIndex = -1;

        const allCircleIndicesOnMouse = this._getCircleOnMouse(envState);
        const allPolygonIndicesOnMouse = this._getPolygonOnMouse(envState);
        for (let i = 0; i < allCircleIndicesOnMouse.length; i++) {
            const idx = allCircleIndicesOnMouse[i];
            this.currentlySelectedShapeIndex = idx;
            this.currentlySelectedShapeType = EntityType.CIRCLE;
            return envState.circle[idx];
        }

        for (let i = 0; i < allPolygonIndicesOnMouse.length; i++) {
            const idx = allPolygonIndicesOnMouse[i];
            this.currentlySelectedShapeIndex = idx;
            this.currentlySelectedShapeType = EntityType.RECTANGLE;
            return envState.polygon[idx];
        }
    }

    _getThrusterOnMouse(envState: EnvState): Thruster | null {
        const allThrusterIndicesOnMouse = this._getThrustersOnMouse(envState);
        for (let i = 0; i < allThrusterIndicesOnMouse.length; i++) {
            const idx = allThrusterIndicesOnMouse[i];
            this.currentlySelectedShapeIndex = idx;
            this.currentlySelectedShapeType = EntityType.THRUSTER;
            return envState.thruster[idx];
        }
    }

    _getThrustersOnMouse(envState: EnvState): number[] {
        const allThrusters = [];
        for (let i = 0; i < envState.thruster.length; i++) {
            const t = envState.thruster[i];
            if (!t.active) continue;
            const thrusterSizeWorld = scaleScalarFromPixels(8, this.staticEnvParams, this.envParams);
            const pos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            if (norm(t.globalPosition.subtract(pos)) < thrusterSizeWorld) {
                allThrusters.push(i);
            }
        }
        return allThrusters;
    }

    _getJointOnMouse(envState: EnvState): Joint | null {
        const allJointIndicesOnMouse = this._getJointsOnMouse(envState);
        for (let i = 0; i < allJointIndicesOnMouse.length; i++) {
            const idx = allJointIndicesOnMouse[i];
            this.currentlySelectedShapeIndex = idx;
            this.currentlySelectedShapeType = EntityType.JOINT;
            return envState.joint[idx];
        }
    }

    _getJointsOnMouse(envState: EnvState): number[] {
        const allJoints = [];
        for (let i = 0; i < envState.joint.length; i++) {
            const j = envState.joint[i];
            if (!j.active) continue;
            const jointSizeWorld = scaleScalarFromPixels(8, this.staticEnvParams, this.envParams);
            const pos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            if (norm(j.globalPosition.subtract(pos)) < jointSizeWorld) {
                allJoints.push(i);
            }
        }
        return allJoints;
    }

    _getCircleOnMouse(envState: EnvState): number[] {
        const allCircles = [];
        for (let i = 0; i < envState.circle.length; i++) {
            const c = envState.circle[i];
            if (!c.active) continue;
            const pos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            if (norm(c.position.subtract(pos)) < c.radius) {
                allCircles.push(i);
            }
        }
        return allCircles;
    }

    _getPolygonOnMouse(envState: EnvState): number[] {
        const allPolygons = [];
        for (let i = 0; i < envState.polygon.length; i++) {
            const r = envState.polygon[i];
            if (!r.active) continue;
            const pos = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
            const mat = rmat(r.rotation);
            const localPos = matmul(mat.transpose([1, 0]), pos.subtract(r.position));
            // how to check if point is inside polygon?
            let inside = true;
            for (let j = 0; j < r.nVertices; j++) {
                const v = r.vertices.pick(j);
                const v2 = r.vertices.pick((j + 1) % r.nVertices);
                const edge = v2.subtract(v);
                const normal = nj.array([edge.get(1), -edge.get(0)]);
                const vec = localPos.subtract(v);
                if (vvDot(vec, normal) < 0) {
                    inside = false;
                    break;
                }
            }
            if (inside) {
                allPolygons.push(i);
            }
        }
        return allPolygons;
    }

    // #endregion Clicking

    _triggerUnselect(envState: EnvState): EnvState {
        envState = this._clearHighlighted(envState);
        this._hideAllUIs();
        this.currentlySelectedShapeIndex = -1;
        this.changeMode(EditorMode.SELECT);

        return envState;
    }

    // #region Keyboard
    keyPressed(envState: EnvState): EnvState {
        if (this.p.keyCode == this.p.DELETE || this.p.keyCode == this.p.BACKSPACE) {
            this.markForDeletion();
        } else if (this.p.keyCode == this.p.ESCAPE) {
            if (this.isCurrentlyBusyEditing) envState = this._triggerUnselect(envState);
        } else if (this.p.keyIsDown(this.p.CONTROL) && this.p.keyIsDown(KEYCODES.C)) {
            if (
                this.currentMode == EditorMode.SELECT &&
                this.currentlySelectedShapeIndex != -1 &&
                [EntityType.CIRCLE, EntityType.RECTANGLE].includes(this.currentlySelectedShapeType)
            ) {
                const arr = this.currentlySelectedShapeType == EntityType.CIRCLE ? envState.circle : envState.polygon;
                const entity = arr[this.currentlySelectedShapeIndex];
                this.copyPasteObject.itemToCopy = copyNestedObj(entity);
                this.copyPasteObject.shapeType = this.currentlySelectedShapeType;
            } else {
                this.copyPasteObject.itemToCopy = null;
            }
        } else if (this.p.keyIsDown(this.p.CONTROL) && this.p.keyIsDown(KEYCODES.V)) {
            if (
                this.copyPasteObject.itemToCopy != null &&
                [EntityType.CIRCLE, EntityType.RECTANGLE].includes(this.copyPasteObject.shapeType)
            ) {
                const arr = this.copyPasteObject.shapeType == EntityType.CIRCLE ? envState.circle : envState.polygon;
                const hasLeft = arr.some((x) => !x.active);
                if (!hasLeft) {
                    envState = this._checkIfShouldIncreaseEnvSize(envState, {
                        allowCircles: this.copyPasteObject.shapeType == EntityType.CIRCLE,
                        allowPolys: this.copyPasteObject.shapeType == EntityType.RECTANGLE,
                    });
                }

                const index = findLowestActiveIndex(arr);
                arr[index] = copyNestedObj(this.copyPasteObject.itemToCopy);
                arr[index].position = screenToSim(nj.array([this.p.mouseX, this.p.mouseY]), this.staticEnvParams, this.envParams);
                arr[index].transparent = false;
                arr[index].highlighted = false;

                envState = this._afterCreateEntity(envState, this.copyPasteObject.shapeType, index);
            }
        }
        return envState;
    }
    _handleKeyboardPress(envState: EnvState): EnvState {
        return envState;
    }
    // #endregion

    // #region UI
    populateEntityFields(entity: RigidBody | Joint | Thruster) {
        const generalSet = <T>(entity: T, qs: QuickSettingsPanel, uiMapping: InnerUIMapping) => {
            for (let key in uiMapping) {
                const k2 = uiMapping[key];
                let val;
                if (typeof k2 === "string") {
                    val = entity[k2 as keyof T] as number;
                    if (k2.toLowerCase().indexOf("rotation") !== -1) {
                        val = radiansToDegrees(val);
                    }
                } else {
                    val = (entity[k2.name as keyof T] as ndarray).get(k2.index);
                }
                qs.setValue(key, val);
            }
        };
        const populateRB = (rb: RigidBody) => {
            const qs = this.qs[0];
            generalSet(rb, qs, this.uiMapping.rigidBody);
            qs.setValue("Fixed", rb.inverseMass === 0);
            qs.setValue("Role", {
                value: DROPDOWN_ROLE_OPTIONS[rb.role],
                index: rb.role,
            });
            if (this.currentlySelectedShapeType === EntityType.RECTANGLE) {
                qs.disableControl("Radius");
                qs.hideControl("Radius");
            } else {
                qs.enableControl("Radius");
                qs.showControl("Radius");
            }
            //@ts-ignore
            qs._titleBar.children[0].children[0].innerText =
                (this.currentlySelectedShapeType === EntityType.CIRCLE ? "Circle" : "Rectangle") +
                " Index " +
                this.currentlySelectedShapeIndex;
        };

        const populateJoint = (j: Joint) => {
            const qs = this.qs[1];
            generalSet(j, qs, this.uiMapping.joint);
            //@ts-ignore
            qs._titleBar.innerText = "Joint" + " Index " + this.currentlySelectedShapeIndex;
        };
        const populateThruster = (t: Thruster) => {
            const qs = this.qs[2];
            generalSet(t, qs, this.uiMapping.thruster);
            qs.setValue("Thruster Binding", t.thrusterBinding + 1);
            //@ts-ignore
            qs._titleBar.innerText = "Thruster" + " Index " + this.currentlySelectedShapeIndex;
        };

        if (isRB(entity)) {
            populateRB(entity);
        } else if (isJoint(entity)) {
            populateJoint(entity);
        } else if (isThruster(entity)) {
            populateThruster(entity);
        }
    }

    putUIFieldsInsideEntity<T>(
        entity: T,
        envState: EnvState,
        entityType: EntityType = null,
        entityIndex: number = null
    ): { entity: T; envState: EnvState } {
        const generalSet = <T>(entity: T, qs: QuickSettingsPanel, uiMapping: InnerUIMapping) => {
            for (let key in uiMapping) {
                const k2 = uiMapping[key];
                let val = qs.getValue(key);
                if (typeof k2 === "string") {
                    if (k2.toLowerCase().indexOf("rotation") !== -1) {
                        val = degreesToRadians(val); // convert rotation from degrees to radian
                    }
                    (entity[k2 as keyof T] as number) = val;
                } else {
                    if (
                        entityType === EntityType.RECTANGLE &&
                        entityIndex < this.staticEnvParams.numStaticFixatedPolys &&
                        k2.name == "position"
                    ) {
                        continue;
                    }
                    const oldVal = (entity[k2.name as keyof T] as ndarray).get(k2.index);
                    if (Math.abs(oldVal - val) < 0.01 && ["position", "radius"].includes(k2.name)) {
                        // when dragging do not let the low resolution of the slider affect the position
                        continue;
                    }
                    (entity[k2.name as keyof T] as ndarray).set(k2.index, val);
                }
            }
            return entity;
        };

        const doForRB = (rb: RigidBody) => {
            if (entityType === EntityType.RECTANGLE && entityIndex < this.staticEnvParams.numStaticFixatedPolys) {
                this.qs[0].hideControl("PositionX");
                this.qs[0].hideControl("PositionY");
                this.qs[0].disableControl("PositionX");
                this.qs[0].disableControl("PositionY");

                this.qs[0].hideControl("Delete");
            } else {
                this.qs[0].showControl("PositionX");
                this.qs[0].showControl("PositionY");
                this.qs[0].enableControl("PositionX");
                this.qs[0].enableControl("PositionY");
                this.qs[0].showControl("Delete");
            }

            // const newRole = this.qs[0].getValue("Role");
            const newRole = this.qs[0].getValue("Role").index;
            const oldRole = rb.role;
            let currNumEntitiesWithThisRole = 0;
            let otherEntityWithThisRole = null;
            if (oldRole != newRole) {
                console.assert(envState !== null);
                for (let i = 0; i < this.staticEnvParams.numPolygons; i++) {
                    if ((i == entityIndex && entityType == EntityType.RECTANGLE) || !envState.polygon[i].active) continue;
                    if (envState.polygon[i].role == newRole) {
                        currNumEntitiesWithThisRole += 1;
                        otherEntityWithThisRole = envState.polygon[i];
                    }
                }

                for (let i = 0; i < this.staticEnvParams.numCircles; i++) {
                    if ((i == entityIndex && entityType == EntityType.CIRCLE) || !envState.circle[i].active) continue;
                    if (envState.circle[i].role == newRole) {
                        currNumEntitiesWithThisRole += 1;
                        otherEntityWithThisRole = envState.circle[i];
                    }
                }
            }

            const oldPosition = rb.position.clone();
            const oldRotation = rb.rotation;
            rb = generalSet(rb, this.qs[0], this.uiMapping.rigidBody);
            rb.role = newRole;
            const newPosition = rb.position.clone();
            const newRotation = rb.rotation;
            rb.position = oldPosition;
            rb.rotation = oldRotation;
            envState = this._moveRigidBody(
                envState,
                entityIndex + (entityType == EntityType.CIRCLE ? this.staticEnvParams.numPolygons : 0),
                newPosition,
                newRotation
            );
            if (currNumEntitiesWithThisRole > 0 && [1, 2].includes(newRole)) {
                otherEntityWithThisRole.role = 0;
                // rb.role = oldRole;
                // this.qs[0].setValue("Role", { value: DROPDOWN_ROLE_OPTIONS[oldRole], index: oldRole });
            }
            if (this.qs[0].getValue("Fixed")) {
                rb.inverseMass = 0;
                rb.inverseInertia = 0;
            } else {
                rb.inverseMass = 1;
                rb.inverseInertia = 1; // will get recalculated
            }
            return rb;
        };

        const doForJoint = (joint: Joint) => {
            const oldIsFixed = joint.isFixedJoint;
            joint = generalSet(joint, this.qs[1], this.uiMapping.joint);
            const newIsFixed = joint.isFixedJoint;

            const jointLimitKeys = ["Min Joint Lt", "Max Joint Lt"];
            const jointControlsToDisable = jointLimitKeys.concat([
                "Joint Limits",
                "Motor On",
                "Motor Power",
                "Motor Speed",
                "Joint Binding",
                "Rotation",
            ]);
            for (let k of jointControlsToDisable) {
                if (joint.isFixedJoint) {
                    this.qs[1].disableControl(k);
                    this.qs[1].hideControl(k);
                } else {
                    this.qs[1].enableControl(k);
                    this.qs[1].showControl(k);
                }
            }

            if (newIsFixed && !oldIsFixed) {
                // need to set rotation.
                const a = selectShape(envState, joint.aIndex);
                const b = selectShape(envState, joint.bIndex);
                joint.rotation = b.rotation - a.rotation;
                this.qs[1].setValue("Rotation", radiansToDegrees(joint.rotation));
            }
            for (let k of jointLimitKeys) {
                if (joint.isFixedJoint) continue;
                if (!joint.motorHasJointLimits) {
                    this.qs[1].disableControl(k);
                    this.qs[1].hideControl(k);
                } else {
                    this.qs[1].enableControl(k);
                    this.qs[1].showControl(k);
                }
            }
            return joint;
        };

        const doForThruster = (thruster: Thruster) => {
            const answer = generalSet(thruster, this.qs[2], this.uiMapping.thruster);

            answer.thrusterBinding = this.qs[2].getValue("Thruster Binding") - 1;
            return answer;
        };

        let toReturn;
        if (isRB(entity)) {
            console.assert(entityType === EntityType.CIRCLE || entityType === EntityType.RECTANGLE);
            console.assert(entityIndex != null);
            toReturn = doForRB(entity) as T;
        } else if (isJoint(entity)) {
            toReturn = doForJoint(entity) as T;
        } else if (isThruster(entity)) {
            toReturn = doForThruster(entity) as T;
        } else {
            console.assert(false, "Should not reach here");
        }

        return { entity: toReturn, envState };
    }

    initGUI(initGUICallBack: () => void) {
        const makeAddMapping = (mapping: dictOfString) => {
            const addMapping = (
                keyInRigidBody: { name: string; index: number } | string,
                nameInUI: string,
                cb: (n: string) => any,
                ignore = false
            ) => {
                cb(nameInUI);
                if (!ignore) mapping[nameInUI] = keyInRigidBody;
            };
            return addMapping;
        };
        const addDeleteButton = (addMapping: any, qs: QuickSettingsPanel) => {
            addMapping(
                "delete",
                "Delete",
                (n: string) =>
                    qs.addButton(n, () => {
                        this.markForDeletion();
                    }),
                true
            );
        };
        const addRigidBodyUI = () => {
            const addMapping = makeAddMapping(this.uiMapping.rigidBody);
            // RigidBody One
            const qs = this.qs[0];
            for (let i = 0; i < 2; ++i) {
                addMapping(
                    {
                        name: "position",
                        index: i,
                    },
                    "Position" + (i === 0 ? "X" : "Y"),
                    (n) => qs.addRange(n, 0, this.envParams.numUnits, 2.5, 0.01)
                );
            }
            for (let i = 0; i < 2; ++i) {
                addMapping(
                    {
                        name: "velocity",
                        index: i,
                    },
                    "Velocity" + (i === 0 ? "X" : "Y"),
                    (n) => qs.addRange(n, -10, 10, 0, 0.1)
                );
            }
            addMapping("rotation", "Rotation", (n) => qs.addRange(n, 0, 360, 0, 15));
            addMapping("angularVelocity", "AngularVelocity", (n) => qs.addRange(n, -10, 10, 0, 0.01));
            addMapping("friction", "Friction", (n) => qs.addRange(n, 0, 1, 0, 0.1));
            addMapping("restitution", "Restitution", (n) => qs.addRange(n, 0, 1, 0, 0.01));
            addMapping("density", "Density", (n) => qs.addRange(n, 0.1, 1, 0, 0.01));
            addMapping("radius", "Radius", (n) => qs.addRange(n, MIN_CIRCLE_SIZE, 1, 1, 0.01));
            addMapping("role", "Role", (n) => qs.addDropDown(n, DROPDOWN_ROLE_OPTIONS), true);
            addMapping("fixed", "Fixed", (n) => qs.addBoolean(n, false), true);

            addDeleteButton(addMapping, qs);

            //@ts-ignore
            qs._titleBar.innerHTML =
                "<div><span id='rbTitle'>" +
                "Circle Index 0" +
                '</span><button id="btnCloseSelect" style="float: right; font-size: 16px; background: none; border: none; cursor: pointer; color:red">&times;</button></div>';
            qs.hide();
        };

        const addJointUI = () => {
            const qs = this.qs[1];
            const addMapping = makeAddMapping(this.uiMapping.joint);
            addMapping("isFixedJoint", "Fixed Joint", (n) => qs.addBoolean(n, false, () => {}));
            addMapping("motorSpeed", "Motor Speed", (n) => qs.addRange(n, 0, 3, 0, 0.01));
            addMapping("motorPower", "Motor Power", (n) => qs.addRange(n, 0, 2, 0, 0.01));
            addMapping("rotation", "Rotation", (n) => qs.addRange(n, -360, 360, 0, 15));
            addMapping("motorOn", "Motor On", (n) => qs.addBoolean(n, false));
            addMapping("motorHasJointLimits", "Joint Limits", (n) => qs.addBoolean(n, false), false);
            addMapping("minRotation", "Min Joint Lt", (n) => qs.addRange(n, 0, 360, 0, 15));
            addMapping("maxRotation", "Max Joint Lt", (n) => qs.addRange(n, 0, 360, 0, 15));
            addMapping("motorBinding", "Joint Binding", (n) => qs.addRange(n, 0, this.staticEnvParams.numMotorBindings - 1, 0, 1));
            addDeleteButton(addMapping, qs);
            qs.hide();
        };

        const addThrusterUI = () => {
            const qs = this.qs[2];
            const addMapping = makeAddMapping(this.uiMapping.thruster);
            addMapping("power", "ThrusterPower", (n) => qs.addRange(n, 0, 10, 0, 0.1));
            addMapping("rotation", "ThrusterRotation", (n) => qs.addRange(n, 0, 360, 0, 15));
            addMapping(
                "thrusterBinding",
                "Thruster Binding",
                (n) => qs.addRange(n, 1, this.staticEnvParams.numThrusterBindings, 1, 1),
                true
            );
            addDeleteButton(addMapping, qs);
            qs.hide();
        };

        const addPermanentUI = () => {
            const qs = this.qs[3];

            const minW = 50;
            const minH = 25;
            const p = 5;

            // this.qs[4].addText("Status", "Status");
            this.qs[4].addHTML("Status", "<strong>XX</strong>");
            this.qs[4].disableControl("Status");
            //@ts-ignore
            this.qs[4]._titleBar.innerText = "";

            qs.addBoolean("Let Agent Play", false);
            qs.hideControl("Let Agent Play");

            qs.addBoolean("Enable Snapping", true, () => {
                this.shouldSnap = qs.getValue("Enable Snapping");
            });

            qs.addFileChooser("Load File", "Load File", "", async (file: File) => {
                const successFn = () => {
                    const reader = new FileReader();
                    reader.addEventListener("load", (event) => {
                        try {
                            const newJson = JSON.parse(event.target.result as string);
                            this.shouldLoad = true;
                            this.contentShouldLoad = newJson;
                        } catch (e) {
                            Swal.fire({
                                title: "Could not load file",
                                text: "Failed to load: " + e,
                                icon: "error",
                                position: "top-start",
                                toast: true,
                                showConfirmButton: false,
                                timer: 1500,
                                timerProgressBar: true,
                            });
                        }
                    });
                    reader.readAsText(file);
                };
                successFn();
            });

            document.getElementsByClassName("qs_content")[3].children[2].addEventListener("click", (e) => {
                if ((e.target as HTMLElement).classList.contains("qs_file_chooser")) {
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                    const successFn = () => {
                        (document.getElementsByClassName("qs_file_chooser")[0] as HTMLElement).click();
                    };
                    if (this.hasMadeAnyChanges) makeUnsavedChangesPopUp(successFn, null);
                    else successFn();
                }
            });

            const btnSaveCloud = this.shouldHaveCloudButton
                ? `<button id="btnSaveCloud" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: none; padding: ${p}px;">
                        <img src='./assets/cloud.png' style="margin-right: ${p}px;">Save to Cloud
                    </button>

                    
                    `
                : "";
            //     <button disabled id="btnThumbsUp" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
            //     <img src='./assets/thumbsup.png' style="margin-right: ${p}px;">
            //     <span id="spanBtnThumbsUp"></span>
            // </button>
            // <button disabled id="btnThumbsDown" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
            //     <img src='./assets/thumbsdown.png' style="margin-right: ${p}px;">
            //     <span id="spanBtnThumbsDown"></span>
            // </button>
            qs.addHTML(
                "Saving",
                `<div style="display: flex; flex-wrap: wrap; gap: 10px;" id="divSaving">
                    <button id="btnSaveLocal" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                        <img src='./assets/download.png' style="margin-right: ${p}px;">Download
                    </button>
                    ${btnSaveCloud}
                </div>`
            );

            //@ts-ignore
            qs._titleBar.innerText = "";
            qs.show();

            // the rightmost permanent UI

            this.qs[6].addHTML(
                "Mode",
                `<div style="display: flex; flex-wrap: wrap; gap: 10px;" id="divMode">
                                    <button id="btnModeCircle" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/circle.png' style="margin-right: ${p}px;">Circle
                                    </button>
                                    <button id="btnModeRectangle" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/square.png' style="margin-right: ${p}px;">Rectangle
                                    </button>
                                    <button id="btnModeJoint" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/rjoint3.png' style="margin-right: ${p}px;">Joint
                                    </button>
                                    <button id="btnModeThruster" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/thruster5.png' style="margin-right: ${p}px;">Thruster
                                    </button>
                                    <button id="btnModeSelect" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/hand.png' style="margin-right: ${p}px;">Select
                                    </button>
                                </div>
                                `
            );
            this.qs[6].addHTML(
                "Actions",
                `<div style="display: flex; flex-wrap: wrap; gap: 10px;" id="divActions">
                                    <span style="display: none; font-size: 0.75em" id="mobileSpan">Please use a larger desktop screen for all features.
                                    </span>
                                    <button id="btnActionPlayHuman" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/play_human.png' style="margin-right: ${p}px;" width="32px">Human
                                    </button>
                                    
                                    <button id="btnActionPlayAgentSpecialist" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                    <img src='./assets/play_robot.png' style="margin-right: ${p}px;" width="32px">Specialist Agent
                                    </button>
                    
                                    <button id="btnActionPlayAgentGeneral" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/play_robot.png' style="margin-right: ${p}px;" width="32px">General Agent (Slow)
                                    </button>

                                    <button id="btnActionPause" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/stop.png' style="margin-right: ${p}px;">Stop
                                    </button>
                                    <button id="btnActionNew" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${p}px;">
                                        <img src='./assets/plus.png' style="margin-right: ${p}px;">New
                                    </button>
                                </div>
                                `
            );
            //@ts-ignore
            this.qs[6]._titleBar.innerText = "";
            this.qs[6].show();
        };

        const addTutorialUI = () => {
            const qs = this.qs[5];
            qs.addHTML(
                "Instructions",
                `
                <div>
                    <div>
                        <strong>Controls</strong>
                        <ul>
                            <li>Space: Switch between play and edit mode</li>
                        </ul>
                    </div>
                    <div>
                        <strong>Level Rules</strong>
                        <ul>
                            <li>There may be at most one of the blue, green shapes and multiple red ones.</li>
                            <li>The goal is to make the green shape touch the blue shape without touching the red one</li>
                        </ul>
                    </div>
                
                    <div>
                        <strong>Edit Mode</strong>
                        <ul>
                            <li>In Edit mode, you can place shapes, or joints (which connect shapes) and thrusters using left click.</li>
                            <li>Choose the hand to edit existing entities</li>
                            <li>You can also save files and share them with your friends</li>
                        </ul>
                    </div>
                    <div>
                        <strong>Play Mode</strong>
                        <ul>

                            <li>Arrows and WASD: Control joints</li>
                            <li>Numbers: 1 and 2 control yellow and pink thrusters, respectively</li>
                        </ul>
                    </div>
                </div>
                `
            );
        };
        addRigidBodyUI();
        addJointUI();
        addThrusterUI();
        addPermanentUI();
        addTutorialUI();

        setTimeout(() => {
            document.getElementById("btnModeCircle").addEventListener("click", () => {
                this.changeMode(EditorMode.ADD_CIRCLE);
            });
            document.getElementById("btnModeRectangle").addEventListener("click", () => {
                this.changeMode(EditorMode.ADD_RECTANGLE);
            });
            document.getElementById("btnModeJoint").addEventListener("click", () => {
                this.changeMode(EditorMode.ADD_JOINT);
            });
            document.getElementById("btnModeThruster").addEventListener("click", () => {
                this.changeMode(EditorMode.ADD_THRUSTER);
            });
            document.getElementById("btnModeSelect").addEventListener("click", () => {
                this.changeMode(EditorMode.SELECT);
            });

            document.getElementById("btnSaveLocal").addEventListener("click", () => {
                this.shouldSaveFileLocal = true;
            });

            if (this.shouldHaveCloudButton) {
                document.getElementById("btnSaveCloud").addEventListener("click", () => {
                    this.shouldSaveFileCloud = true;
                });
            }

            // Play / New Buttons

            document.getElementById("btnActionNew").addEventListener("click", () => {
                const successFn = () => {
                    this.shouldReset = true;
                };
                if (this.hasMadeAnyChanges) makeUnsavedChangesPopUp(successFn, null);
                else successFn();
            });

            this.qs[5].show();
            this.qs[7].show();
            // showBackButton(this.qs[7])
            //@ts-ignore
            this.qs[5]._titleBar.innerText = `Instructions V${process.env.package_version}`;
            this.qs[5].hideTitle("Instructions");
            // this.qs[4].hideControl("Status");

            for (let qs of this.qs) {
                qs.setCollapsible(false);
            }

            document.getElementById("btnCloseSelect").addEventListener("click", () => {
                this.shouldTriggerUnselect = true;
            });
            initGUICallBack();
        }, 0);
    }

    _hideAllUIs() {
        for (let q of this.qs) {
            q.hide();
        }

        this.qs[5].show();
        if (!this.pageLoadStateReference.isEmbedded()) this.qs[3].show();
        this.qs[6].show();
        showBackButton(this.qs[7]);
    }

    _showStatus(status: string) {
        this.qs[4].show();
        // this.qs[4].showControl("Status");
        this.qs[4].setValue("Status", "<span style='color:red'>" + status + "</span>");
    }

    _updateButtonStatuses(envState: EnvState) {
        const values = [
            { id: "btnModeThruster", mode: EditorMode.ADD_THRUSTER },
            { id: "btnModeJoint", mode: EditorMode.ADD_JOINT },
            { id: "btnModeCircle", mode: EditorMode.ADD_CIRCLE },
            { id: "btnModeRectangle", mode: EditorMode.ADD_RECTANGLE },
            { id: "btnModeSelect", mode: EditorMode.SELECT },
        ];
        for (let { id, mode } of values) {
            if (false && mode != EditorMode.SELECT) {
                if (!this._isModeAvailable(mode, envState)) {
                    document.getElementById(id).setAttribute("disabled", "true");
                } else {
                    document.getElementById(id).removeAttribute("disabled");
                }
            }

            if (this.currentMode == mode) {
                document.getElementById(id).classList.add("active-button");
            } else {
                document.getElementById(id).classList.remove("active-button");
            }
        }
    }

    _showHideCloudSaveButton(show: boolean) {
        const ids = ["btnSaveCloud"]; //, "btnThumbsUp", "btnThumbsDown"];
        for (let id of ids) {
            document.getElementById(id).style.display = show ? "inline-flex" : "none";
        }
        if (show) {
            this.allowSavingToCloud = true;
        } else {
            this.allowSavingToCloud = false;
        }
    }
    // #endregion
}
