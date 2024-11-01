import { User } from "firebase/auth";
import { LoadReturn, SavedLevel } from "../js2d/types";
import { getCurrentUser } from "../web/auth";

export class PageLoadState {
    private _levelToLoad: SavedLevel | null = null;
    private _shouldLoadNewLevel: boolean = false;
    private _newLevelsSavedToCloud: SavedLevel[] = [];
    private _currentUser: User | null = null;
    private _hasAuthStateChanged: boolean = false;
    private _onAuthStateCallback: (user: User | null) => void;

    private _isEmbedded: boolean = false;
    private _hasJustChanged: boolean = false;
    private _didStartOnEditor: boolean = false;

    constructor(isEmbedded: boolean = false, didStartOnEditor: boolean = false) {
        this._isEmbedded = isEmbedded;
        this._didStartOnEditor = didStartOnEditor;
        this._onAuthStateCallback = (user: User | null) => {
            this._currentUser = user;
            this._hasAuthStateChanged = true;
        };
    }

    hasJustSwitched() {
        return this._hasJustChanged;
    }
    setHasJustSwitched(value: boolean) {
        this._hasJustChanged = value;
    }
    isEmbedded() {
        return this._isEmbedded;
    }
    didStartOnEditor() {
        return this._didStartOnEditor;
    }
    getAuthStateCallback() {
        return this._onAuthStateCallback;
    }
    getHasAuthStateChanged() {
        return this._hasAuthStateChanged;
    }
    setHasAuthStateChanged(value: boolean) {
        this._hasAuthStateChanged = value;
    }

    getCurrentUser() {
        this._currentUser = getCurrentUser();
        return this._currentUser;
    }
    public shouldLoadNewLevel() {
        return this._shouldLoadNewLevel;
    }
    public setShouldLoadNewLevel(value: boolean) {
        this._shouldLoadNewLevel = value;
    }

    public levelToLoad() {
        return this._levelToLoad;
    }

    public switchLevel(level: SavedLevel) {
        this._levelToLoad = level;
    }

    public setLevelToNull() {
        this._levelToLoad = null;
    }

    public setNewLevelsSavedToCloud(levels: SavedLevel[]) {
        this._newLevelsSavedToCloud = levels;
    }
    public getNewLevelsSavedToCloud() {
        return this._newLevelsSavedToCloud;
    }
}
