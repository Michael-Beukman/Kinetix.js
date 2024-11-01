import { getAuth, signInWithPopup, GoogleAuthProvider, browserLocalPersistence, User } from "firebase/auth";
import { addOrUpdateUserInDB, FireBaseAppAndDB, UserCallback } from "./database";

export const getCurrentUser = (): User => {
    const user = getAuth().currentUser;
    return user;
};

export const setupAuth = (onStateChanged: UserCallback = null) => {
    const allCallbacks: UserCallback[] = [];
    if (onStateChanged) allCallbacks.push(onStateChanged);
    const addAuthCallback = (callback: UserCallback) => {
        allCallbacks.push(callback);
    };
    const callAllCallbacks = (user: User | null) => {
        allCallbacks.forEach((callback) => callback(user));
    };
    const auth = getAuth();
    auth.setPersistence(browserLocalPersistence);
    auth.authStateReady().then(() => {
        const user = auth.currentUser;
        showAppropriateUI(user);
        callAllCallbacks(user);
        auth.onAuthStateChanged((user) => {
            showAppropriateUI(user);
            callAllCallbacks(user);
        });
    });

    return { addAuthCallback };
};

export const getUserOrAttemptLogin = async (firebaseAppAndDB: FireBaseAppAndDB): Promise<User | null> => {
    const provider = new GoogleAuthProvider();
    const auth = getAuth();
    const currentUser = auth.currentUser;
    if (currentUser == null) {
        try {
            const result = await signInWithPopup(auth, provider);
            const credential = GoogleAuthProvider.credentialFromResult(result);
            const token = credential.accessToken;
            // The signed-in user info.
            const user = result.user;

            addOrUpdateUserInDB(firebaseAppAndDB, user);
            return user;
        } catch (error) {
            const errorCode = error.code;
            const errorMessage = error.message;
            // The email of the user's account used.
            const email = error.customData.email;
            // The AuthCredential type that was used.
            const credential = GoogleAuthProvider.credentialFromError(error);
            console.log("ERROR", errorCode, errorMessage, email, credential);
            return null;
        }
    }
    return currentUser;
};

export const signOut = async () => {
    const auth = getAuth();
    await auth.signOut();
    showAppropriateUI(null);
};

export const showAppropriateUI = (user: User | null) => {
    const loginButton = document.getElementById("loginButton");
    const signOutButton = document.getElementById("signoutButton");
    const usernameP = document.getElementById("usernameP");
    const image = document.getElementById("loginImage") as HTMLImageElement;
    if (user == null) {
        usernameP.innerText = "Not logged in";
        loginButton.style.display = "block";
        signOutButton.style.display = "none";
        image.src = "./assets/person.png";
    } else {
        usernameP.innerText = user.displayName;
        loginButton.style.display = "none";
        signOutButton.style.display = "block";
        image.src = user.photoURL;
    }
};

export const isAdmin = (firebaseAppAndDB: FireBaseAppAndDB): boolean => {
    if (firebaseAppAndDB == null) return false;
    const user = getCurrentUser();
    if (user == null) return false;
    if (user.uid == "tJDoL6npyLS8i7Pf2upqUe1TO1D2") return true;
    return false;
};
