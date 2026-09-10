import Clutter from "gi://Clutter";

export class WorkspacesController {
    constructor(settings, workspacesView, workspacesDisplay) {
        this._settings = settings;
        this._workspacesView = workspacesView;
        this._workspacesDisplay = workspacesDisplay;
        this._origUpdateWorkspaces = null;
        this._origWorkspacesAllocate = null;
        this._origUpdateTrackerOrientation = null;
    }

    enable() {
        this.updateOrientation();
    }

    disable() {
        this._unpatchVerticalWorkspaces();
    }

    updateOrientation() {
        if (!this._workspacesView) return;

        const vertical =
            this._settings.get_string("workspaces-scroll-direction") ===
            "vertical";
        if (vertical) this._patchVerticalWorkspaces();
        else this._unpatchVerticalWorkspaces();

        this._workspacesView._updateWorkspaces();
        this._workspacesView.queue_relayout();
    }

    _patchVerticalWorkspaces() {
        const view = this._workspacesView;
        if (!view || view._verticalPatched) return;

        this._origUpdateWorkspaces = view._updateWorkspaces;
        this._origWorkspacesAllocate = view.vfunc_allocate;

        view._updateWorkspaces = () => {
            this._origUpdateWorkspaces.call(view);
            this._applyVerticalWorkspaceTranslations();
        };
        view.vfunc_allocate = (box) => {
            this._origWorkspacesAllocate.call(view, box);
            this._applyVerticalWorkspaceTranslations();
        };
        view._verticalPatched = true;

        const display = this._workspacesDisplay;
        if (display && !display._verticalPatched) {
            this._origUpdateTrackerOrientation =
                display._updateTrackerOrientation;
            display._updateTrackerOrientation = () => {
                this._origUpdateTrackerOrientation.call(display);
                if (display._swipeTracker)
                    display._swipeTracker.orientation =
                        Clutter.Orientation.VERTICAL;
            };
            display._verticalPatched = true;
            display._updateTrackerOrientation();
        }
    }

    _applyVerticalWorkspaceTranslations() {
        const view = this._workspacesView;
        if (!view?._workspaces?.length) return;

        const active = global.workspace_manager.get_active_workspace_index();
        const activeWorkspace = view._workspaces[active];
        if (!activeWorkspace) return;

        view._workspaces.forEach((workspace) => {
            workspace.translation_x = 0;
            workspace.translation_y = 0;
        });

        const spacing =
            view._workspaces.length > 1
                ? Math.max(
                      0,
                      Math.abs(view._workspaces[1].x - view._workspaces[0].x) -
                          activeWorkspace.width,
                  )
                : 0;
        const activeX = activeWorkspace.x;
        const activeY = activeWorkspace.y;
        const height = activeWorkspace.height;
        const current = view._scrollAdjustment?.value ?? active;

        view._workspaces.forEach((workspace, index) => {
            workspace.translation_x = activeX - workspace.x;
            workspace.translation_y =
                activeY + (index - current) * (height + spacing) - workspace.y;
        });
    }

    _unpatchVerticalWorkspaces() {
        const view = this._workspacesView;
        if (!view?._verticalPatched || !this._origUpdateWorkspaces) return;

        view._updateWorkspaces = this._origUpdateWorkspaces;
        view.vfunc_allocate = this._origWorkspacesAllocate;
        delete view._verticalPatched;
        this._origUpdateWorkspaces = null;
        this._origWorkspacesAllocate = null;
        view._updateWorkspaces();
        view._workspaces?.forEach((workspace) => {
            workspace.translation_x = 0;
            workspace.translation_y = 0;
        });

        const display = this._workspacesDisplay;
        if (display?._verticalPatched) {
            display._updateTrackerOrientation =
                this._origUpdateTrackerOrientation;
            delete display._verticalPatched;
            this._origUpdateTrackerOrientation = null;
            display._updateTrackerOrientation();
        }
    }
}
