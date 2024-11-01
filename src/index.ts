import * as p5 from "p5";
// import the sim state
import { copySimState } from "./js2d/utils";
import { makeGallerySketch } from "./pages/gallery_page";
import { SavedLevel } from "./js2d/types";
import { makeEditSketch } from "./pages/edit_page";
import { PageLoadState } from "./kinetixjs/page_load_state";
import { initialiseFirebaseApp, loadLevelFromDB } from "./web/database";
import { setupLoginUI } from "./kinetixjs/ui";
import "./styles/styles.css";
import "./styles/custom-bootstrap.scss";

const singlePageApp = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const isEmbed = searchParams.get("embed") != null;
    const shouldStartOnEditor = searchParams.get("editor") != null;
    const pageLoadState = new PageLoadState(isEmbed, shouldStartOnEditor);

    let isOnEditor = false;
    let p5Editor: p5;
    let p5Gallery: p5;

    const isIndexPageActive = () => {
        return isOnEditor;
    };
    const isGalleryPageActive = () => {
        return !isOnEditor;
    };

    const _copyLevel = (level: SavedLevel): SavedLevel => {
        return level == null
            ? null
            : {
                  level: {
                      env_state: copySimState(level.level.env_state),
                      env_params: level.level.env_params,
                      static_env_params: level.level.static_env_params,
                  },
                  metaData: level.metaData,
                  rankingData: level.rankingData,
                  levelID: level.levelID,
              };
    };

    const switchBetweenGalleryAndEdit = (level: SavedLevel, newLevels: SavedLevel[] = null) => {
        const canvEditor = document.getElementById("canvasEditor");
        const canvGallery = document.getElementById("canvasGallery");
        const switchButtons = document.getElementById("tagDiv");
        const shouldHideWhenOnEditor = [canvGallery, document.getElementById("bottom-panel"), document.getElementById("allItems")];

        pageLoadState.setShouldLoadNewLevel(level != null);

        pageLoadState.switchLevel(_copyLevel(level));
        pageLoadState.setHasJustSwitched(true);

        if (newLevels != null && newLevels.length > 0) {
            pageLoadState.setNewLevelsSavedToCloud(newLevels);
        }

        if (isOnEditor) {
            switchButtons.style.display = "block";
            canvEditor.style.display = "none";
            for (let i of shouldHideWhenOnEditor) {
                i.style.display = null;
            }
            p5Gallery.loop();
            p5Editor.noLoop();
        } else {
            switchButtons.style.display = "none";
            canvEditor.style.display = "block";
            for (let i of shouldHideWhenOnEditor) {
                i.style.display = "none";
            }
            p5Editor.loop();
        }
        isOnEditor = !isOnEditor;
    };

    const _doGallery = () => {
        const firebaseApp = initialiseFirebaseApp(pageLoadState.getAuthStateCallback());
        const createAllSketches = () => {
            p5Gallery = new p5(
                makeGallerySketch(switchBetweenGalleryAndEdit, isGalleryPageActive, pageLoadState, firebaseApp),
                document.body
            );
            p5Editor = new p5(
                makeEditSketch(
                    (levels: SavedLevel[]) => switchBetweenGalleryAndEdit(null, levels),
                    isIndexPageActive,
                    pageLoadState,
                    firebaseApp,
                    true
                ),
                document.body
            );
            p5Editor.noLoop();
            const canvA = document.getElementById("canvasEditor");
            const canvB = document.getElementById("canvasGallery");
            canvA.style.display = "none";
            canvB.style.display = "block";
        };
        setupLoginUI(firebaseApp);

        if (shouldStartOnEditor) {
            const levelID = searchParams.get("level");
            if (levelID != null) {
                loadLevelFromDB(firebaseApp, levelID)
                    .then((level: SavedLevel) => {
                        createAllSketches();
                        switchBetweenGalleryAndEdit(_copyLevel(level));
                    })
                    .catch((error) => {
                        createAllSketches();
                        switchBetweenGalleryAndEdit(null);
                    });
            } else {
                createAllSketches();
                switchBetweenGalleryAndEdit(null);
            }
        } else {
            createAllSketches();
        }
    };
    const _doEditor = () => {
        const firebaseApp = initialiseFirebaseApp(pageLoadState.getAuthStateCallback());
        const noop = () => {};
        // check if `level` is in the search params:
        const levelID = searchParams.get("level");

        const createSketch = () => {
            const sketch = makeEditSketch(noop, () => true, pageLoadState, firebaseApp); // for now
            const p5Editor = new p5(sketch, document.body);
        };
        if (levelID != null) {
            loadLevelFromDB(firebaseApp, levelID)
                .then((level: SavedLevel) => {
                    pageLoadState.setShouldLoadNewLevel(true);
                    pageLoadState.switchLevel(_copyLevel(level));
                    createSketch();
                })
                .catch((error) => {
                    createSketch();
                });
        } else {
            createSketch();
        }
        setupLoginUI(firebaseApp);
    };

    const main = () => {
        if (isEmbed && shouldStartOnEditor) {
            document.getElementById("canvasGallery").style.display = "none";
            document.getElementById("canvasEditor").style.display = "block";
            document.getElementById("bottom-panel").style.display = "none";
            _doEditor();
        } else if (window.location.toString().includes("gallery.html")) {
            _doGallery();
        } else {
            _doEditor();
            // window.addEventListener("load", () =>{
            //     document.getElementById("loadingScreen").style.display = "none";
            // });
        }

        if (isEmbed) {
            document.addEventListener("keydown", (event) => {
                // check if it is an arrow key or wasd or 1/2
                if (
                    event.key === "ArrowLeft" ||
                    event.key === "ArrowRight" ||
                    event.key === "ArrowUp" ||
                    event.key === "ArrowDown" ||
                    event.key === "w" ||
                    event.key === "a" ||
                    event.key === "s" ||
                    event.key === "d" ||
                    event.key === "1" ||
                    event.key === "2" ||
                    event.key == " "
                ) {
                    console.log("Preventing default");
                    event.preventDefault();
                }
                // event.preventDefault() ;
            });
            // document.getElementById("canvasEditor").style.margin = null;
            const items = [document.getElementById("allItems"), document.getElementById("bottom-panel")];
            for (let item of items) {
                if (item) {
                    item.style.width = "80%";
                    item.style.marginLeft = "10%";
                }
            }
        }
    };
    document.addEventListener("DOMContentLoaded", main);
    // window.addEventListener("load", () =>{
    //     document.getElementById("loadingScreen").style.display = "none";
    // });
};

singlePageApp();
