import { ControlsState } from "resource:///org/gnome/shell/ui/overviewControls.js";

export class LayoutController {
    constructor(settings, layoutManager, searchEntry) {
        this._settings = settings;
        this._layoutManager = layoutManager;
        this._searchEntry = searchEntry;
        this._originalComputeWorkspacesBoxForState = null;
        this._originalGetAppDisplayBoxForState = null;
    }

    enable() {
        this._patchControlsLayout();
        this.updateSearchEntry();
    }

    disable() {
        this._unpatchControlsLayout();
        if (this._searchEntry) {
            this._searchEntry.visible = true;
            this._searchEntry.set_height(-1);
        }
    }

    update() {
        this._layoutManager?.layout_changed();
        this.updateSearchEntry();
    }

    updateSearchEntry() {
        if (!this._searchEntry) return;
        const show = this._settings.get_boolean("show-search-entry");
        this._searchEntry.visible = show;
        this._searchEntry.set_height(show ? -1 : 0);
    }

    shouldHideWorkspacesPeek() {
        return !this._settings.get_boolean("show-workspaces-thumbnails");
    }

    shouldCenterWorkspace() {
        return (
            !this._settings.get_boolean("show-search-entry") &&
            !this._settings.get_boolean("show-workspaces-thumbnails")
        );
    }

    _patchControlsLayout() {
        if (!this._layoutManager || this._layoutManager._chAppGridPatched)
            return;

        this._originalComputeWorkspacesBoxForState =
            this._layoutManager._computeWorkspacesBoxForState;
        this._originalGetAppDisplayBoxForState =
            this._layoutManager._getAppDisplayBoxForState;
        const controller = this;

        this._layoutManager._computeWorkspacesBoxForState = function (
            state,
            ...args
        ) {
            const workspaceBox =
                controller._originalComputeWorkspacesBoxForState.call(
                    this,
                    state,
                    ...args,
                );

            if (
                state === ControlsState.APP_GRID &&
                controller.shouldHideWorkspacesPeek()
            ) {
                const workAreaBox = args.find(
                    (arg) =>
                        arg &&
                        typeof arg.get_width === "function" &&
                        typeof arg.get_height === "function" &&
                        typeof arg.x1 === "number" &&
                        typeof arg.y1 === "number",
                );
                workspaceBox.set_origin(
                    (workAreaBox?.x2 ?? 100000) + 1000,
                    (workAreaBox?.y2 ?? 100000) + 1000,
                );
            }

            const size = controller._settings.get_int("workspace-size");
            if (state !== ControlsState.HIDDEN && size !== 100) {
                const scale = size / 100;
                const width = workspaceBox.get_width();
                const height = workspaceBox.get_height();
                const scaledWidth = width * scale;
                const scaledHeight = height * scale;
                workspaceBox.set_origin(
                    workspaceBox.x1 + (width - scaledWidth) / 2,
                    workspaceBox.y1 + (height - scaledHeight) / 2,
                );
                workspaceBox.set_size(scaledWidth, scaledHeight);
            }

            const workAreaBox = args.find(
                (arg) =>
                    arg &&
                    typeof arg.get_width === "function" &&
                    typeof arg.get_height === "function" &&
                    typeof arg.x1 === "number" &&
                    typeof arg.y1 === "number",
            );
            if (
                state === ControlsState.WINDOW_PICKER &&
                controller.shouldCenterWorkspace() &&
                workAreaBox
            ) {
                workspaceBox.set_origin(
                    workAreaBox.x1 +
                        (workAreaBox.get_width() - workspaceBox.get_width()) /
                            2,
                    workAreaBox.y1 +
                        (workAreaBox.get_height() - workspaceBox.get_height()) /
                            2,
                );
            }
            return workspaceBox;
        };

        this._layoutManager._getAppDisplayBoxForState = function (
            state,
            ...args
        ) {
            const appDisplayBox =
                controller._originalGetAppDisplayBoxForState.call(
                    this,
                    state,
                    ...args,
                );
            if (state === ControlsState.APP_GRID) {
                appDisplayBox.set_origin(...this._workAreaBox.get_origin());
                appDisplayBox.set_size(...this._workAreaBox.get_size());
            }
            return appDisplayBox;
        };
        this._layoutManager._chAppGridPatched = true;
    }

    _unpatchControlsLayout() {
        if (this._layoutManager && this._originalComputeWorkspacesBoxForState) {
            this._layoutManager._computeWorkspacesBoxForState =
                this._originalComputeWorkspacesBoxForState;
            this._layoutManager._getAppDisplayBoxForState =
                this._originalGetAppDisplayBoxForState;
            delete this._layoutManager._chAppGridPatched;
        }
        this._originalComputeWorkspacesBoxForState = null;
        this._originalGetAppDisplayBoxForState = null;
    }
}
