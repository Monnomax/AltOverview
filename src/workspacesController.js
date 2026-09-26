import Meta from "gi://Meta";

import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

import { WorkspacesView } from "resource:///org/gnome/shell/ui/workspacesView.js";

export class WorkspacesController {
    constructor(settings, workspacesView, workspacesDisplay) {
        this._settings = settings;
        this._workspacesView = workspacesView;
        this._workspacesDisplay = workspacesDisplay;

        this._workspaceManager = global.workspace_manager;
        this._injectionManager = new InjectionManager();

        this._settingsChangedIds = [];
    }

    enable() {
        this._patchWorkspaceSpacing();

        this._settingsChangedIds.push(
            this._settings.connect("changed::workspaces-scroll-direction", () =>
                this.updateOrientation(),
            ),
        );

        this._settingsChangedIds.push(
            this._settings.connect("changed::workspace-spacing-vertical", () =>
                this._queueWorkspaceRelayout(),
            ),
        );

        this._settingsChangedIds.push(
            this._settings.connect(
                "changed::workspace-spacing-horizontal",
                () => this._queueWorkspaceRelayout(),
            ),
        );

        this.updateOrientation();
    }

    disable() {
        for (const id of this._settingsChangedIds)
            this._settings.disconnect(id);

        this._settingsChangedIds = [];

        this._injectionManager.clear();

        this._restoreWorkspaceLayout();
    }

    updateOrientation() {
        const vertical =
            this._settings.get_string("workspaces-scroll-direction") ===
            "vertical";

        this._setWorkspaceLayout(vertical);

        this._workspacesView?._updateWorkspaces();
        this._workspacesView?.queue_relayout();

        this._workspacesDisplay?._updateTrackerOrientation();

        this._queueWorkspaceRelayout();
    }

    _patchWorkspaceSpacing() {
        const controller = this;

        this._injectionManager.overrideMethod(
            WorkspacesView.prototype,
            "_getSpacing",
            () => {
                return function (box, fitMode, vertical) {
                    return controller._getWorkspaceSpacing(vertical);
                };
            },
        );
    }

    _getWorkspaceSpacing(vertical) {
        const key = vertical
            ? "workspace-spacing-vertical"
            : "workspace-spacing-horizontal";

        return this._settings.get_int(key);
    }

    _queueWorkspaceRelayout() {
        const workspacesViews = this._workspacesDisplay?._workspacesViews;

        if (!workspacesViews) return;

        for (const view of workspacesViews) view?.queue_relayout();
    }

    _setWorkspaceLayout(vertical) {
        const manager = this._workspaceManager;

        if (!manager?.override_workspace_layout) return;

        if (vertical) {
            manager.override_workspace_layout(
                Meta.DisplayCorner.TOPLEFT,
                true,
                -1,
                1,
            );
        } else {
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
