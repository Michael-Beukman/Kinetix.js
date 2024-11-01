import { QuickSettingsPanel } from "quicksettings";
import { getUserOrAttemptLogin, getCurrentUser, showAppropriateUI, signOut } from "../web/auth";
import { FireBaseAppAndDB } from "../web/database";
import Swal from "sweetalert2";

export const setupLoginUI = (firebaseAppAndDB: FireBaseAppAndDB) => {
    const currentUser = getCurrentUser();
    showAppropriateUI(currentUser);
    document.getElementById("signoutButton").onclick = () => {
        signOut();
    };
    document.getElementById("loginButton").onclick = () => {
        getUserOrAttemptLogin(firebaseAppAndDB).then((user) => {
            showAppropriateUI(user);
        });
    };
};

export const showBackButton = (qs: QuickSettingsPanel) => {
    qs.show();
};

export const hideBackButton = (qs: QuickSettingsPanel) => {
    qs.hide();
};

export const makeUnsavedChangesPopUp = (callbackOnSuccess: () => void, callbackOnFailure: () => void) => {
    Swal.fire({
        title: "You possibly have unsaved changes!",
        text: "Do you want to discard your changes?",
        icon: "warning",
        showCancelButton: true,
        confirmButtonColor: "#3085d6",
        cancelButtonColor: "#d33",
        confirmButtonText: "Abort",
        cancelButtonText: "Discard",
    }).then((result) => {
        if (result.isConfirmed) {
            if (callbackOnFailure) callbackOnFailure();
        } else {
            if (callbackOnSuccess) callbackOnSuccess();
        }
    });
};

export const isSmallScreen = () => {
    return window.innerWidth < 600;
};

export const isMoreTallThanWide = () => {
    return window.innerHeight > window.innerWidth;
};
