import nj from "@d4c/numjs";
import { deleteLevel, FireBaseAppAndDB, getLevelLink, paginatedLoad, updateVoting } from "../web/database";
import { defaultEnvParams, defaultStaticEnvParams } from "../js2d/env_state";
import { makeCleanImages, makeOriginalImages, render } from "../js2d/renderer";
import { dict, dictOfString, RankingData, SavedLevel } from "../js2d/types";
import { QueryDocumentSnapshot } from "firebase/firestore";
import { PageLoadState } from "../kinetixjs/page_load_state";

import { User } from "firebase/auth";
import Swal from "sweetalert2";
import { isAdmin } from "../web/auth";
import { createEmptyEnv } from "../js2d/engine";

export const makeGallerySketch = (
    functionWhenClicked: (level: SavedLevel) => void,
    isActive: () => boolean,
    pageLoadStateReference: PageLoadState,
    firebaseApp: FireBaseAppAndDB
) => {
    const gallerySketch = (p: p5) => {
        // P5 and setup
        let w = document.documentElement.clientWidth;
        let h = window.innerHeight;
        let images: { [id: string]: p5.Image } = {};
        let staticEnvParams = defaultStaticEnvParams;
        staticEnvParams.screenDim = nj.array([w, h]);
        const emptyLevel: SavedLevel = {
            level: {
                env_state: createEmptyEnv(staticEnvParams, defaultEnvParams),
                env_params: defaultEnvParams,
                static_env_params: staticEnvParams
            },
            metaData: null,
            rankingData: null,
            levelID: null,
        }

        // Levels & DB Stuff
        let allLevelsFromDB: dict<SavedLevel[]> = {
            core: [],
            community: [],
        };
        let lastVisible: dict<QueryDocumentSnapshot | null> = {
            core: null,
            community: null,
        };
        let levelStartingIndex = 0;
        let shouldLoadMore: dict<boolean> = { core: true, community: true };
        let isLoading = false;

        // Display
        let cols = 2;
        let rows = 2;
        const levelRenderDownScale = 4;
        const maxImageSize = 500;
        const pSize = 5;
        const minW = 25;
        const minH = 25;
        // Loading
        let loadingBarAngle = 0;

        // Display & Voting
        let allHtmlElements: HTMLElement[] = [];
        let prevActive = true;

        let votingMapping: dictOfString = {};

        const allImageURLs: dictOfString = {};

        let currentTag = "core";

        let isFirstLoad = true;

        // #region p5
        p.preload = () => {
            images = makeOriginalImages(p);
        };

        p.setup = async () => {
            p.createCanvas(w, h, document.getElementById("canvasGallery"));
            images = makeCleanImages(p, staticEnvParams, images);

            [rows, cols] = _getRowsCols();
            // make the HTML Buttons
            makeHTMLElements(rows, cols);
            setupArrowButtonsEvents();

            const bottomPanel = document.getElementById("bottom-panel");
            const topBar = document.getElementById("loginDiv");
            document.getElementById("allItems").style.height = window.innerHeight - topBar.clientHeight - bottomPanel.clientHeight + "px";
            document.getElementById("allItems").style.top = topBar.clientHeight + "px";
            _loadNextBatchOfLevels(0);

            document.getElementById("loginDiv").style.width = Math.min(w, 500) + "px";

            firebaseApp.addAuthCallback((user: User) => {
                showHideAllHtmlElements(true);
                maybeAddDeleteButtons();
            });

            const btnCore = document.getElementById("btnSelectCore");
            const btnCommunity = document.getElementById("btnSelectCommunity");

            btnCore.onclick = () => {
                if (currentTag == "core" || isLoading) return;
                btnCore.classList.add("active");
                btnCommunity.classList.remove("active");
                currentTag = "core";
                triggerChangeTag();
            };

            btnCommunity.onclick = () => {
                if (currentTag == "community" || isLoading) return;
                btnCore.classList.remove("active");
                btnCommunity.classList.add("active");
                currentTag = "community";
                triggerChangeTag();
            };

            const cardNew = (document.getElementById("cardNew") as HTMLElement)
            if (cardNew) cardNew.onclick = () => {

                showHideAllHtmlElements(false);
                functionWhenClicked(emptyLevel);
            };
        };

        p.draw = () => {
            const oldPrev = prevActive;
            prevActive = isActive();
            if (!prevActive) return;
            if (pageLoadStateReference.hasJustSwitched()) {
                pageLoadStateReference.setHasJustSwitched(false);
                // if (!oldPrev) {
                onWindowResize("minimal");
                document.getElementById("loginDiv").style.width = Math.min(w, 500) + "px";
            }

            if (pageLoadStateReference.getNewLevelsSavedToCloud() != null) {
                // need to add new level(s) to the gallery as we just saved them in the editor, and we'd like to avoid additional DB calls
                const newLevels = pageLoadStateReference.getNewLevelsSavedToCloud();
                allLevelsFromDB["community"] = newLevels.concat(allLevelsFromDB["community"]);
                pageLoadStateReference.setNewLevelsSavedToCloud(null);
                updateEntireUI();
            }

            if (isLoading) {
                showHideAllHtmlElements(false);
                drawLoadingBar();
                return;
            }
            p.clear();
        };
        const onWindowResize = (e: string = null) => {
            if (!isActive()) return;
            const minimal = e === "minimal";
            w = document.documentElement.clientWidth;
            h = window.innerHeight;
            if (!minimal) p.resizeCanvas(w, h);
            [rows, cols] = _getRowsCols();
            makeHTMLElements(rows, cols);
            showHideAllHtmlElements(true);
            updateArrowButtonsAndBottomPanel();
            _loadNextBatchOfLevels(rows * cols - 1);
        };

        p.windowResized = (e) => {
            return onWindowResize();
        };

        // #endregion

        // #region Creating HTML things
        const makeHTMLElements = (rows: number, cols: number) => {
            let madeNew = false;
            for (let i = allHtmlElements.length; i < cols * rows; ++i) {
                madeNew = true;
                allHtmlElements.push(document.createElement("div"));
                allHtmlElements[i].classList.add("divGalleryLevelInfo");
                allHtmlElements[i].classList.add("card");
                allHtmlElements[i].classList.add("text-center");
                allHtmlElements[i].innerHTML = getMainCardHTML(null, i);
                document.getElementById("allItems").appendChild(allHtmlElements[i]);

                allHtmlElements[i].onclick = (e) => {
                    const index = i + levelStartingIndex;
                    console.assert(index < allLevelsFromDB[currentTag].length);
                    const savedLevelReturn = allLevelsFromDB[currentTag][index];
                    showHideAllHtmlElements(false);
                    functionWhenClicked(savedLevelReturn);
                };
            }

            if (madeNew) {
                _setupEvents();
            }
        };
        // #endregion

        const numberOfItemsPerPage = () => {
            return rows * cols - 1;
        };

        const canGoLeft = () => levelStartingIndex > 0 && !isLoading;
        const canGoRight = () =>
            (levelStartingIndex + numberOfItemsPerPage() < allLevelsFromDB[currentTag].length || shouldLoadMore[currentTag]) && !isLoading;

        const triggerStartLoad = () => {
            isLoading = true;
            updateArrowButtonsAndBottomPanel();
        };

        const triggerEndLoad = () => {
            isLoading = false;
            if (isFirstLoad) {
                isFirstLoad = false;
                document.getElementById("loadingScreen").style.display = "none";
            }
            updateEntireUI();
        };

        const _loadNextBatchOfLevels = (startingIndex: number) => {
            if (isLoading) {
                return;
            }
            if (startingIndex + rows * cols < allLevelsFromDB[currentTag].length) {
                triggerEndLoad();
                return;
            }
            isLoading = true;
            triggerStartLoad();
            paginatedLoad(firebaseApp, lastVisible[currentTag], currentTag, rows * cols).then((x) => {
                const levels = x.levels;
                lastVisible[currentTag] = x.lastVisible;
                shouldLoadMore[currentTag] = x.areAnyMoreAvailable;
                allLevelsFromDB[currentTag] = allLevelsFromDB[currentTag].concat(levels);
                triggerEndLoad();
            });
        };

        const updateEntireUI = () => {
            showHideAllHtmlElements(true);
            updateArrowButtonsAndBottomPanel();
            updateAllGalleryCards();
        };

        const updateAllGalleryCards = () => {
            for (let row = 0; row < rows; ++row) {
                for (let column = 0; column < cols; ++column) {
                    const baseIndex = row * cols + column;
                    const index = baseIndex + levelStartingIndex;
                    if (index >= allLevelsFromDB[currentTag].length) break;
                    // if (!savedLevelReturn) { continue };
                    const savedLevelReturn = allLevelsFromDB[currentTag][index];
                    if (!(savedLevelReturn.levelID in allImageURLs)) {
                        allImageURLs[savedLevelReturn.levelID] = getImageURL(savedLevelReturn);
                    }
                    (document.getElementById(`myImage${baseIndex}`) as HTMLImageElement).src = allImageURLs[savedLevelReturn.levelID];
                    allHtmlElements[baseIndex].style.width = (maxImageSize / levelRenderDownScale) * 1.7 + "px";
                    allHtmlElements[baseIndex].style.maxHeight = (maxImageSize / levelRenderDownScale) * 2.4 + "px";
                    setHTMLTitle(baseIndex, savedLevelReturn);
                    updateRankingData(baseIndex, savedLevelReturn.rankingData, savedLevelReturn.levelID);
                }
            }
        };

        const updateArrowButtonsAndBottomPanel = () => {
            const arrRight = document.getElementById("arrow-right");
            const arrLeft = document.getElementById("arrow-left");
            if (!arrRight || !arrLeft) return;

            const makeDisabled = (elem: HTMLElement) => {
                elem.classList.remove("arrow-enabled");
                elem.classList.add("arrow-disabled");
                elem.setAttribute("disabled", "true");
            };
            const makeEnabled = (elem: HTMLElement) => {
                elem.classList.remove("arrow-disabled");
                elem.classList.add("arrow-enabled");
                elem.removeAttribute("disabled");
            };

            if (canGoLeft()) {
                makeEnabled(arrLeft);
            } else {
                makeDisabled(arrLeft);
            }
            if (canGoRight()) {
                makeEnabled(arrRight);
            } else {
                makeDisabled(arrRight);
            }
            const extra = shouldLoadMore[currentTag] ? "+" : "";
            const panelText = document.getElementById("bottomPanelText");
            if (panelText) {
                panelText.innerHTML = `L${levelStartingIndex} - L${Math.min(allLevelsFromDB[currentTag].length, levelStartingIndex + numberOfItemsPerPage())} / ${allLevelsFromDB[currentTag].length}${extra}`;
            }
        };

        const _setupEvents = () => {
            for (let i = 0; i < rows * cols; ++i) {
                const btnUp = document.getElementById("btnThumbsUp" + i);
                const btnDown = document.getElementById("btnThumbsDown" + i);
                const btnCopy = document.getElementById("btnShare" + i);

                btnCopy.onclick = (e) => {
                    const toCopy = getLevelLink(allLevelsFromDB[currentTag][i + levelStartingIndex].levelID);
                    navigator.clipboard.writeText(toCopy);

                    Swal.fire({
                        toast: true,
                        icon: "success",
                        title: `Copied to clipboard!`,
                        position: "top-start",
                        showConfirmButton: false,
                        timer: 1500,
                        timerProgressBar: true,
                        background: "#f0f9ff",
                        color: "#333",
                    });
                    e.stopPropagation();
                };
                btnUp.onclick = (e) => {
                    if (pageLoadStateReference.getCurrentUser() == null) return;
                    const absoluteIndexToUse = i + levelStartingIndex;

                    const levelID = allLevelsFromDB[currentTag][absoluteIndexToUse].levelID;

                    let downvote = 0;
                    let upvote = 1;
                    if (levelID in votingMapping) {
                        if (votingMapping[levelID] == 1) {
                            upvote = -1;
                            delete votingMapping[levelID];
                        } else if (votingMapping[levelID] == -1) {
                            downvote = -1;
                            upvote = 1;
                            votingMapping[levelID] = 1;
                        }
                    } else {
                        votingMapping[levelID] = 1;
                    }
                    updateVoting(firebaseApp, levelID, upvote, downvote).then((v) => {
                        allLevelsFromDB[currentTag][absoluteIndexToUse].rankingData = v as RankingData;
                        updateRankingData(
                            absoluteIndexToUse - levelStartingIndex,
                            allLevelsFromDB[currentTag][absoluteIndexToUse].rankingData,
                            allLevelsFromDB[currentTag][absoluteIndexToUse].levelID
                        );
                    });
                    e.stopPropagation();
                };

                btnDown.onclick = (e) => {
                    if (pageLoadStateReference.getCurrentUser() == null) return;
                    const absoluteIndexToUse = i + levelStartingIndex;

                    const levelID = allLevelsFromDB[currentTag][absoluteIndexToUse].levelID;
                    let upvote = 0;
                    let downvote = 1;
                    if (levelID in votingMapping) {
                        if (votingMapping[levelID] == -1) {
                            // cannot downvote again
                            downvote = -1;
                            // votingMapping[levelID] = 0;
                            delete votingMapping[levelID];
                            // return;
                        } else if (votingMapping[levelID] == 1) {
                            downvote = 1;
                            upvote = -1;
                            votingMapping[levelID] = -1;
                        }
                    } else {
                        votingMapping[levelID] = -1;
                    }

                    updateVoting(firebaseApp, levelID, upvote, downvote).then((v) => {
                        allLevelsFromDB[currentTag][absoluteIndexToUse].rankingData = v as RankingData;

                        updateRankingData(
                            absoluteIndexToUse - levelStartingIndex,
                            allLevelsFromDB[currentTag][absoluteIndexToUse].rankingData,
                            allLevelsFromDB[currentTag][absoluteIndexToUse].levelID
                        );
                    });
                    e.stopPropagation();
                };
            }
        };

        const setupArrowButtonsEvents = () => {
            document.getElementById("arrow-left").onclick = () => {
                if (!canGoLeft()) return;
                let newIndex = levelStartingIndex - numberOfItemsPerPage();
                if (canGoLeft() && newIndex < 0) newIndex = 0;
                if (newIndex >= 0) {
                    levelStartingIndex = newIndex;
                }
                _loadNextBatchOfLevels(newIndex);
            };
            document.getElementById("arrow-right").onclick = () => {
                if (!canGoRight()) return;
                const newIndex = levelStartingIndex + numberOfItemsPerPage();
                levelStartingIndex = newIndex;
                _loadNextBatchOfLevels(newIndex);
            };
        };

        const _getRowsCols = () => {
            rows = 2;
            cols = 2;
            const _getNumberOfRowsOrColumns = (
                sizeOverall: number,
                sizeOfElem = (maxImageSize / levelRenderDownScale) * 1.7,
                gridGap = 50
            ) => {
                return Math.floor((sizeOverall + gridGap) / (sizeOfElem + gridGap));
            };

            cols = _getNumberOfRowsOrColumns(
                document.getElementById("allItems").clientWidth,
                (maxImageSize / levelRenderDownScale) * 1.7,
                50
            );
            const bottomPanel = document.getElementById("bottom-panel");
            const topBar = document.getElementById("loginDiv");

            rows = _getNumberOfRowsOrColumns(
                window.innerHeight - topBar.clientHeight - bottomPanel.clientHeight,
                (maxImageSize / levelRenderDownScale) * 2.4,
                0
            );
            rows = Math.min(16, Math.max(1, rows));
            cols = Math.min(16, Math.max(1, cols));
            return [rows, cols];
        };

        const updateRankingData = (baseIndex: number, rankingData: RankingData, levelID: string) => {
            document.getElementById(`spanBtnThumbsUp${baseIndex}`).innerText = rankingData.upvotes.toString();
            document.getElementById(`spanBtnThumbsDown${baseIndex}`).innerText = rankingData.downvotes.toString();
            styleVotingButtons(baseIndex, levelID);
        };

        const styleVotingButtons = (baseIndex: number, levelID: string) => {
            const btnDown = document.getElementById(`btnThumbsDown${baseIndex}`);
            const btnUp = document.getElementById(`btnThumbsUp${baseIndex}`);
            if (btnDown == null || btnUp == null) return;
            btnDown.classList.remove("btnThumbsActive");
            btnUp.classList.remove("btnThumbsActive");
            if (levelID in votingMapping) {
                if (votingMapping[levelID] == 1) {
                    btnUp.classList.add("btnThumbsActive");
                }
                if (votingMapping[levelID] == -1) {
                    btnDown.classList.add("btnThumbsActive");
                }
            }
        };

        const showHideAllHtmlElements = (show: boolean) => {
            const display = show ? "block" : "none";
            let i = 0;
            for (let elem of Array.from(document.getElementsByClassName("divGalleryLevelInfo")) as HTMLElement[]) {
                if (elem.id == "cardNew" && pageLoadStateReference.isEmbedded()) {
                    continue;
                }
                elem.style.display = display;
                if (show && i + levelStartingIndex >= allLevelsFromDB[currentTag].length) {
                    elem.style.display = "none";
                }
                i += 1;
                if (i > rows * cols) {
                    elem.style.display = "none";
                }
            }

            if (show) {
                for (let i = 0; i < rows * cols; ++i) {
                    const idx = levelStartingIndex + i;
                    if (idx >= allLevelsFromDB[currentTag].length) break;
                }

                const user = pageLoadStateReference.getCurrentUser();

                for (let i = 0; i < rows * cols; ++i) {
                    const upBtn = document.getElementById(`btnThumbsUp${i}`),
                        downBtn = document.getElementById(`btnThumbsDown${i}`);
                    const btns = [upBtn, downBtn];
                    if (upBtn == null || downBtn == null) {
                        break;
                    }
                    if (user != null) {
                        for (let btn of btns) {
                            btn.classList.add("btnThumbs-notDisabled");
                            btn.classList.remove("btnThumbs-disabled");
                            btn.removeAttribute("disabled");
                        }
                    } else {
                        for (let btn of btns) {
                            btn.classList.remove("btnThumbs-notDisabled");
                            btn.classList.add("btnThumbs-disabled");
                            btn.setAttribute("disabled", "true");
                        }
                    }
                }
            }
        };

        const setHTMLTitle = (baseIndex: number, savedLevelReturn: SavedLevel) => {
            document.getElementById(`divInfoOfLevel${baseIndex}`).innerHTML = `${savedLevelReturn.metaData.levelName}`;
            // document.getElementById(`htmlTitleBottom${baseIndex}`).innerHTML = `&emsp;`//${savedLevelReturn.metaData.userName}`;
            document.getElementById(`htmlTitleBottom${baseIndex}`).innerHTML = savedLevelReturn.metaData.date.toISOString().slice(0, 10); //`&emsp;`//${savedLevelReturn.metaData.userName}`;
        };

        const maybeAddDeleteButtons = () => {
            const shouldHaveDeleteButtons = isAdmin(firebaseApp);
            for (let i = 0; i < rows * cols; ++i) {
                const id = `btnDelete${i}`;
                const deleteButton = document.getElementById(id);
                if (!shouldHaveDeleteButtons) {
                    deleteButton.style.display = "none";
                } else {
                    deleteButton.style.display = "inline-flex";
                }

                if (!shouldHaveDeleteButtons) {
                    continue;
                }
                if (deleteButton) {
                    deleteButton.onclick = (e) => {
                        e.stopPropagation();
                        deleteLevel(firebaseApp, allLevelsFromDB[currentTag][i + levelStartingIndex].levelID)
                            .then(() => {
                                allLevelsFromDB[currentTag].splice(i + levelStartingIndex, 1);
                                updateEntireUI();
                                Swal.fire({
                                    toast: true,
                                    icon: "success",
                                    title: `Level deleted!`,
                                    position: "top-start",
                                    showConfirmButton: false,
                                    timer: 1500,
                                    timerProgressBar: true,
                                    background: "#f0f9ff",
                                    color: "#333",
                                });
                            })
                            .catch((e) => {
                                Swal.fire({
                                    toast: true,
                                    icon: "error",
                                    title: `Failed to delete level!`,
                                    position: "top-start",
                                    showConfirmButton: false,
                                    timer: 1500,
                                    timerProgressBar: true,
                                    background: "#f0f9ff",
                                    color: "#333",
                                });
                            });
                    };
                }
            }
        };
        const getMainCardHTML = (savedLevelReturn: SavedLevel, baseIndex: number) => {
            const title = "TEMP";
            const btnUp = savedLevelReturn == null ? 0 : savedLevelReturn.rankingData.upvotes;
            const btnDown = savedLevelReturn == null ? 0 : savedLevelReturn.rankingData.downvotes;
            const cleanTitle = `<div id="divInfoOfLevel${baseIndex}" class="divOfLevelInfo">${title}</div>`;
            const btns = `  <div style="display: flex; flex-wrap: wrap; gap: 10px;" id="divBtnContainer${baseIndex}">
                                <button id="btnThumbsUp${baseIndex}" class="btn btn-light btnThumbs btnThumbs-disabled" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${pSize}px;">
                                    <img width="20px" src='./assets/thumbsup.png' style="margin-right: ${pSize}px;">
                                    <span id="spanBtnThumbsUp${baseIndex}">${btnUp}</span>
                                </button>
                                <button id="btnThumbsDown${baseIndex}" class="btn btn-light btnThumbs btnThumbs-disabled" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${pSize}px;">
                                    <img width="20px" src='./assets/thumbsdown.png' style="margin-right: ${pSize}px;">
                                    <span id="spanBtnThumbsDown${baseIndex}">${btnDown}</span>
                                </button>
                                    
                                <button id="btnShare${baseIndex}" class="btn btn-light btnThumbs" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: inline-flex; padding: ${pSize}px;">
                                    <img width="20px" src='./assets/clipboard.png' style="margin-right: ${pSize}px;">
                                </button>

                                <button id="btnDelete${baseIndex}" class="btn btn-light btnThumbs" style="flex-grow: 1; min-width: ${minW}px; min-height: ${minH}px; align-items: center; justify-content: center; display: none; padding: ${pSize}px;">
                                    <img width="20px" src='./assets/trashcan.png' style="margin-right: ${pSize}px;">
                                </button>
                                </div>`;
            // <img width="20px" src='./assets/thumbsdown.png' style="margin-right: ${pSize}px;">
            const width = maxImageSize / levelRenderDownScale;
            return `
                    <div class="card-header">
                    ${cleanTitle}
                    </div>
                    <div class="card-body">
                    <!-- Put the rendering here -->
                    <img width="${width}px" id="myImage${baseIndex}">
                    <div class="divToRenderIn"></div>
                    <!-- Buttons here -->
                    ${btns}
                    </div>
                    <div class="card-footer text-body-secondary" id="htmlTitleBottom${baseIndex}">
                    2 days ago
                    </div>
                    `;
            // </div>
        };

        const drawLoadingBar = () => {
            p.push();
            p.background(255);
            p.fill(0, 100, 200);
            p.strokeCap(p.ROUND); // Smooth line ends
            let numSegments = 12;
            let radius = 50;
            p.translate(w / 2, h / 2);

            // Rotate the arc
            p.rotate(loadingBarAngle);
            let segmentAngle = p.TWO_PI / numSegments;

            for (let i = 0; i < numSegments; i++) {
                let alpha = p.map(i, 0, numSegments, 50, 255); // Gradually fade segments
                p.stroke(40, alpha); // White color with varying alpha

                // Calculate x and y coordinates for each line segment
                let x1 = radius * p.cos(i * segmentAngle + loadingBarAngle);
                let y1 = radius * p.sin(i * segmentAngle + loadingBarAngle);
                let x2 = (radius + 20) * p.cos(i * segmentAngle + loadingBarAngle);
                let y2 = (radius + 20) * p.sin(i * segmentAngle + loadingBarAngle);

                p.line(x1, y1, x2, y2); // Draw line segment
            }

            // Increase the angle to rotate the spinner
            loadingBarAngle += 0.05;

            // Reset the angle to avoid overflow
            if (loadingBarAngle > p.TWO_PI) {
                loadingBarAngle = 0;
            }
            p.pop();
        };

        const getImageURL = (savedLevel: SavedLevel) => {
            const pg = p.createGraphics(500, 500);
            render(pg, savedLevel.level.env_state, savedLevel.level.static_env_params, savedLevel.level.env_params, images);
            //@ts-ignore
            return pg.canvas.toDataURL();
        };

        const triggerChangeTag = () => {
            levelStartingIndex = 0;
            _loadNextBatchOfLevels(levelStartingIndex);
        };
    };

    return gallerySketch;
};
