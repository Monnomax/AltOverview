import Meta from "gi://Meta";

export class WorkspacesController {
    constructor(settings, workspacesView, workspacesDisplay) {
        this._settings = settings;
        this._workspacesView = workspacesView;
        this._workspacesDisplay = workspacesDisplay;

        this._workspaceManager = global.workspace_manager;
        this._originalLayout = null;
    }

    enable() {
        this.updateOrientation();
    }

    disable() {
        this._restoreWorkspaceLayout();
    }

    updateOrientation() {
        const vertical =
            this._settings.get_string("workspaces-scroll-direction") ===
            "vertical";

        this._setWorkspaceLayout(vertical);

        /*
         * WorkspacesView already knows how to lay out workspaces according
         * to Meta.WorkspaceManager.layout_rows.
         *
         * Rebuild its geometry after changing the Mutter layout.
         */
        this._workspacesView?._updateWorkspaces();
        this._workspacesView?.queue_relayout();

        this._workspacesDisplay?._updateTrackerOrientation();
    }

    _setWorkspaceLayout(vertical) {
        const manager = this._workspaceManager;

        if (!manager?.override_workspace_layout) return;

        if (vertical) {
            /*
             * One column, unlimited rows.
             *
             * layout_rows = -1
             * layout_columns = 1
             *
             * Workspaces become:
             *
             *   0
             *   1
             *   2
             *   3
             *
             * instead of:
             *
             *   0 → 1 → 2 → 3
             */
            manager.override_workspace_layout(
                Meta.DisplayCorner.TOPLEFT,
                true,
                -1,
                1,
            );
        } else {
            /*
             * One row, unlimited columns.
             *
             * This is GNOME's normal horizontal workspace layout.
             */
            manager.override_workspace_layout(
                Meta.DisplayCorner.TOPLEFT,
                false,
                1,
                -1,
            );
        }
    }

    _restoreWorkspaceLayout() {
        const manager = this._workspaceManager;

        if (!manager?.override_workspace_layout) return;

        /*
         * Restore GNOME's normal horizontal workspace layout.
         */
        manager.override_workspace_layout(
            Meta.DisplayCorner.TOPLEFT,
            false,
            1,
            -1,
        );

        this._workspacesView?._updateWorkspaces();
        this._workspacesView?.queue_relayout();

        this._workspacesDisplay?._updateTrackerOrientation();
    }
}
