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
            this._searchEntry.translation_y = 0;
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

        this._positionSearchEntry();
    }

    _positionSearchEntry() {
        if (!this._searchEntry) return;

        const show = this._settings.get_boolean("show-search-entry");

        if (!show) {
            this._searchEntry.translation_y = 0;
            return;
        }

        this._searchEntry.translation_y = 8;
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

    /*
     * GNOME calculates a different workspace size depending on
     * the workspace orientation.
     *
     * We don't want that.
     *
     * The workspace should have one physical size regardless of
     * horizontal / vertical orientation.
     *
     * 1366 × 768 work area:
     *
     *     1366 × 0.765625 = 1046.40625
     *      768 × 0.765625 =  588.0
     *
     * This corresponds to the current horizontal workspace size
     * of approximately 1046 × 588.
     *
     * The aspect ratio is therefore preserved by using the same
     * scale on both dimensions.
     */
    _getWorkspaceScale(workAreaBox) {
        if (!workAreaBox) return 1.0;

        const BASE_WORKSPACE_RATIO = 0.765625;

        return BASE_WORKSPACE_RATIO;
    }

    _setWorkspaceSize(workspaceBox, workAreaBox) {
        if (!workspaceBox || !workAreaBox) return;

        const width = workAreaBox.get_width();
        const height = workAreaBox.get_height();

        if (width <= 0 || height <= 0) return;

        /*
         * One physical workspace size for both orientations.
         */
        const baseScale = this._getWorkspaceScale(workAreaBox);

        /*
         * User-controlled workspace size.
         *
         *  -100 = 80% of the normal physical workspace size
         *     0 = normal physical workspace size
         *  +100 = 120% of the normal physical workspace size
         */
        const userSize = this._settings.get_int("workspace-size");

        const userScale = 1 + userSize / 500;

        const scale = baseScale * userScale;

        const workspaceWidth = width * scale;
        const workspaceHeight = height * scale;

        /*
         * Center the workspace inside the work area.
         */
        const x = workAreaBox.x1 + (width - workspaceWidth) / 2;

        const y = workAreaBox.y1 + (height - workspaceHeight) / 2;

        workspaceBox.set_origin(x, y);
        workspaceBox.set_size(workspaceWidth, workspaceHeight);
    }

    _centerWorkspace(workspaceBox, workAreaBox) {
        if (!workspaceBox || !workAreaBox) return;

        workspaceBox.set_origin(
            workAreaBox.x1 +
                (workAreaBox.get_width() - workspaceBox.get_width()) / 2,
            workAreaBox.y1 +
                (workAreaBox.get_height() - workspaceBox.get_height()) / 2,
        );
    }

    _positionWorkspaceThumbnails(workspaceBox, workAreaBox) {
        if (!workspaceBox || !workAreaBox) return;

        const TOP_GAP = 20;
        const THUMBNAILS_GAP = 20;

        let y = workAreaBox.y1 + TOP_GAP;

        /*
         * When Search is visible, place thumbnails below it.
         */
        if (
            this._searchEntry &&
            this._settings.get_boolean("show-search-entry") &&
            this._searchEntry.visible
        ) {
            const [, searchY] = this._searchEntry.get_transformed_position();

            const searchHeight = this._searchEntry.get_height();

            y = searchY + searchHeight + THUMBNAILS_GAP;
        }

        workspaceBox.set_origin(
            workAreaBox.x1 +
                (workAreaBox.get_width() - workspaceBox.get_width()) / 2,
            y,
        );
    }

    _patchControlsLayout() {
        if (!this._layoutManager || this._layoutManager._chAppGridPatched) {
            return;
        }

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

            /*
             * Find the work area passed to GNOME.
             */
            const workAreaBox = args.find(
                (arg) =>
                    arg &&
                    typeof arg.get_width === "function" &&
                    typeof arg.get_height === "function" &&
                    typeof arg.x1 === "number" &&
                    typeof arg.y1 === "number",
            );

            /*
             * Apply the user-controlled workspace size only to
             * the full-size workspace in the window picker.
             * App-grid thumbnails have their own fixed size.
             */
            if (state === ControlsState.WINDOW_PICKER && workAreaBox) {
                controller._setWorkspaceSize(workspaceBox, workAreaBox);
            }

            /*
             * Keep workspace thumbnails centered in the monitor
             * when they are visible in the app grid.
             */
            if (
                state === ControlsState.APP_GRID &&
                !controller.shouldHideWorkspacesPeek() &&
                workAreaBox
            ) {
                controller._positionWorkspaceThumbnails(
                    workspaceBox,
                    workAreaBox,
                );
            }

            /*
             * APP_GRID:
             *
             * If workspace thumbnails are disabled,
             * move the workspace completely outside the
             * visible area after all size calculations.
             */
            if (
                state === ControlsState.APP_GRID &&
                controller.shouldHideWorkspacesPeek() &&
                workAreaBox
            ) {
                /*
                 * Thumbnails are disabled.
                 *
                 * Keep the workspace allocation out of the visible
                 * area, but do not let the hidden thumbnails reserve
                 * vertical space for the AppGrid.
                 */
                workspaceBox.set_origin(
                    workAreaBox.x2 + 1000000,
                    workAreaBox.y2 + 1000000,
                );
                workspaceBox.set_size(0, 0);
            }

            /*
             * WINDOW_PICKER:
             *
             * When both the search entry and workspace
             * thumbnails are hidden, explicitly center
             * the workspace in the work area.
             *
             * This is kept after the size calculation so
             * that centering uses the final dimensions.
             */
            if (
                state === ControlsState.WINDOW_PICKER &&
                controller.shouldCenterWorkspace() &&
                workAreaBox
            ) {
                controller._centerWorkspace(workspaceBox, workAreaBox);
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

            /*
             * When Search and workspace thumbnails are both hidden,
             * the AppGrid should be vertically centered in the complete
             * work area.
             */
            if (
                state === ControlsState.APP_GRID &&
                controller.shouldCenterWorkspace() &&
                appDisplayBox
            ) {
                const workAreaBox = args.find(
                    (arg) =>
                        arg &&
                        typeof arg.get_width === "function" &&
                        typeof arg.get_height === "function" &&
                        typeof arg.x1 === "number" &&
                        typeof arg.y1 === "number" &&
                        typeof arg.x2 === "number" &&
                        typeof arg.y2 === "number",
                );

                if (workAreaBox) {
                    const y =
                        workAreaBox.y1 +
                        (workAreaBox.get_height() -
                            appDisplayBox.get_height()) /
                            2;

                    appDisplayBox.set_origin(appDisplayBox.x1, y);
                }
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
