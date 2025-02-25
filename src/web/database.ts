import firebase from "firebase/compat/app";
// Required for side-effects
import "firebase/firestore";

import { FirebaseApp, initializeApp } from "firebase/app";
export type UserCallback = (user: User | null) => void;
import {
    getFirestore,
    collection,
    addDoc,
    doc,
    getDoc,
    initializeFirestore,
    persistentLocalCache,
    Firestore,
    getDocs,
    query,
    limit,
    orderBy,
    startAfter,
    QueryDocumentSnapshot,
    Timestamp,
    setDoc,
    increment,
    deleteDoc,
    where,
    updateDoc,
    QueryConstraint,
} from "firebase/firestore";
import { dict, dictOfString, LevelMetaData, LoadReturn, RankingData, SavedLevel } from "../js2d/types";
import { loadFromJSON, saveToJSON } from "../kinetixjs/saving";
import { setupAuth } from "./auth";
import { User } from "firebase/auth";
// import * as fs from "fs";
export interface FireBaseAppAndDB {
    app: FirebaseApp;
    db: Firestore;
    addAuthCallback: (callback: UserCallback) => void;
}

export const initialiseFirebaseApp = (authCallback: (user: User) => void = null, ignoreAuth = false): FireBaseAppAndDB => {
    const firebaseConfig = {
        // TODO:
    };

    // Initialize Firebase
    const app = initializeApp(firebaseConfig);
    const db = initializeFirestore(app, {
        localCache: persistentLocalCache(/*settings*/ {}),
    });
    let addAuthCallback = null;
    if (!ignoreAuth) {
        addAuthCallback = setupAuth(authCallback).addAuthCallback;
    }
    return { app, db, addAuthCallback };
};

export const addOrUpdateUserInDB = async (app: FireBaseAppAndDB, user: User) => {
    const db = app.db;
    const coll = collection(db, "users");
    const userRef = doc(coll, user.uid);
    const docSnap = await getDoc(userRef);
    if (!docSnap.exists()) {
        await setDoc(userRef, {
            // name: user.displayName,
            // email: user.email,
            firstLogin: new Date(),
            lastLogin: new Date(),
        });
    } else {
        await setDoc(
            userRef,
            {
                lastLogin: new Date(),
            },
            { merge: true }
        );
    }
};

export const addLevelToDB = async (app: FireBaseAppAndDB, levelToSave: dictOfString, metaData: dictOfString) => {
    // const db = getFirestore(app);
    const db = app.db;
    const itemToPutInDB = {
        levelAndParams: levelToSave,
        metaData,
        rankingData: { upvotes: 0, downvotes: 0 },
    };

    try {
        const docRef = await addDoc(collection(db, "levels"), itemToPutInDB);
        console.log("Document written with ID: ", docRef.id);

        return docRef.id;
    } catch (e) {
        console.error("Error adding document: ", e);
    }
    return null;
};

export const loadLevelFromDB = async (app: FireBaseAppAndDB, documentID: string): Promise<SavedLevel> => {
    const db = app.db;
    const docRef = await getDoc(doc(collection(db, "levels"), documentID));
    if (!docRef.exists()) {
        console.log("Document does not exist");
        throw new Error("Document does not exist");
    }
    const data = docRef.data();
    const level = loadFromJSON(500, 500, data.levelAndParams, true);
    const rankingData = data.rankingData == null ? { upvotes: 0, downvotes: 0 } : (data.rankingData as RankingData);
    return {
        level,
        metaData: data.metaData as LevelMetaData,
        rankingData,
        levelID: documentID,
    };
};

export const getMultipleLevels = async (app: FireBaseAppAndDB, documentIDs: string[]): Promise<SavedLevel[]> => {
    const ref = collection(app.db, "levels");
    const querySnapshot = await getDocs(query(ref, limit(10)));

    return querySnapshot.docs
        .map((doc): SavedLevel => {
            const data = doc.data();
            const level = loadFromJSON(500, 500, data.levelAndParams, true);
            const rankingData = data.rankingData == null ? { upvotes: 0, downvotes: 0 } : (data.rankingData as RankingData);
            return {
                level,
                metaData: data.metaData as LevelMetaData,
                rankingData,
                levelID: doc.id,
            };

            // return loadFromJSON(500, 500, doc.data().metaData.toSave, true);
        })
        .concat([await loadLevelFromDB(app, "DXvz9GNMQYARAPkNgBrm")]);
};

export const paginatedLoad = async (
    app: FireBaseAppAndDB,
    lastVisibleToUse: QueryDocumentSnapshot | null,
    tagToUse: string | null = null,
    maxPageSize: number = 25
): Promise<{
    levels: SavedLevel[];
    lastVisible: QueryDocumentSnapshot;
    areAnyMoreAvailable: boolean;
}> => {
    let documentSnapshots, lastVisible;
    let order; // = orderBy("rankingData.upvotes", "desc"); // orderBy("metaData.date", "desc");
    if (tagToUse == null || tagToUse == "core") {
        order = orderBy("rankingData.upvotes", "desc");
    } else {
        order = orderBy("metaData.date", "desc");
    }
    const queryFilters: QueryConstraint[] = [order];
    if (tagToUse != null) {
        queryFilters.push(where("metaData.tags", "array-contains", tagToUse));
    }
    if (lastVisibleToUse != null) {
        queryFilters.push(startAfter(lastVisibleToUse));
    }
    queryFilters.push(limit(maxPageSize));
    const filtering = where("metaData.tags", "array-contains", "core");
    if (lastVisibleToUse == null) {
        const first = query(collection(app.db, "levels"), ...queryFilters);
        documentSnapshots = await getDocs(first);
    } else {
        const next = query(collection(app.db, "levels"), ...queryFilters);
        documentSnapshots = await getDocs(next);
    }
    lastVisible = documentSnapshots.docs[documentSnapshots.docs.length - 1];

    // Construct a new query starting at this document,
    // get the next 25 cities.

    // const querySnapshot =
    const allLevels = documentSnapshots.docs.map((doc): SavedLevel => {
        const data = doc.data();
        const level = loadFromJSON(500, 500, data.levelAndParams, true);
        const rankingData = data.rankingData == null ? { upvotes: 0, downvotes: 0 } : (data.rankingData as RankingData);
        const ans = {
            level,
            metaData: data.metaData,
            rankingData,
            levelID: doc.id,
        };
        ans.metaData.date = (ans.metaData.date as Timestamp).toDate();
        return ans;
    });
    return {
        levels: allLevels,
        lastVisible,
        areAnyMoreAvailable: documentSnapshots.docs.length == maxPageSize,
    };
};

export const updateVoting = async (firebaseApp: FireBaseAppAndDB, levelID: string, upvote: number, downvote: number) => {
    const db = firebaseApp.db;
    const docRef = doc(db, "levels", levelID);
    const incrementUp = increment(upvote);
    const incrementDown = increment(downvote);
    updateDoc(docRef, {
        "rankingData.upvotes": incrementUp,
        "rankingData.downvotes": incrementDown,
    });

    const data = (await getDoc(docRef)).data();
    return {
        upvotes: data.rankingData.upvotes,
        downvotes: data.rankingData.downvotes,
    };
};

export const getLevelLink = (levelID: string) => {
    const splits = window.location.href.split("/");
    splits.pop();
    return splits.join("/") + `/gallery.html?level=${levelID}&editor=true`;
};

export const deleteLevel = async (app: FireBaseAppAndDB, levelID: string) => {
    const db = app.db;
    const docRef = doc(db, "levels", levelID);
    return await deleteDoc(docRef);
};
