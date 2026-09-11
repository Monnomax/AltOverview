import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { AppGridController } from "./src/appGridController.js";
import { AppGridLayoutController } from "./src/appGridLayoutController.js";
import { BackgroundController } from "./src/backgroundController.js";
import { IconInteractionController } from "./src/iconInteractionController.js";
import { LayoutController } from "./src/layoutController.js";
import { ScrollController } from "./src/scrollController.js";
import { WorkspacesController } from "./src/workspacesController.js";
import { WindowPreviewController } from "./src/windowPreviewController.js";

export default class OverviewBackgroundExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._searchEntry = Main.overview.searchEntry;
        this._controls = Main.overview._overview._controls;
        this._layoutManager = this._controls?.layout_manager ?? null;
        this._appDisplay = this._controls?._appDisplay ?? null;
        this._workspacesDisplay = this._controls?._workspacesDisplay ?? null;
        this._workspacesView =
            this._workspacesDisplay?._workspacesViews?.[0] ?? null;

        this._backgroundController = new BackgroundController(this._settings);
        this._layoutController = new LayoutController(
            this._settings,
            this._layoutManager,
            this._searchEntry,
        );
        this._workspacesController = new WorkspacesController(
            this._settings,
            this._workspacesView,
            this._workspacesDisplay,
        );
        this._appGridController = new AppGridController(
            this._settings,
            this._appDisplay,
        );
        this._iconController = new IconInteractionController(
            this._settings,
            this._appDisplay,
        );
        this._appGridLayoutController = new AppGridLayoutController(
            this._settings,
            this._appDisplay,
            this._iconController,
        );
        this._scrollController = new ScrollController(
            this._settings,
            this._appDisplay,
            this._workspacesDisplay,
            (step) => this._appGridController.goToPage(step),
        );
        this._windowPreviewController = new WindowPreviewController(
            this._settings,
        );

        this._backgroundController.enable();
        this._layoutController.enable();
        this._workspacesController.enable();
        this._appGridController.enable();
        this._iconController.updateNamesVisibility();
        this._appGridLayoutController.enable();
        this._scrollController.enable();
        this._windowPreviewController.enable();

        const applySettings = () => {
            this._backgroundController.setVisible(
                this._settings.get_boolean("enabled"),
            );
            this._backgroundController.applySettings();
            this._layoutController.update();
            this._workspacesController.updateOrientation();
            this._appGridController.updateOrientation();
            this._appDisplay?._grid?.queue_relayout();
        };

        this._settingsChangedId = this._settings.connect(
            "changed",
            applySettings,
        );
        this._appGridShowNamesChangedId = this._settings.connect(
            "changed::app-grid-names-visibility",
            () => this._iconController.updateNamesVisibility(),
        );
        applySettings();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._appGridShowNamesChangedId) {
            this._settings.disconnect(this._appGridShowNamesChangedId);
            this._appGridShowNamesChangedId = 0;
        }

        this._scrollController?.disable();
        this._windowPreviewController?.disable();
        this._appGridLayoutController?.disable();
        this._iconController?.disable();
        this._appGridController?.disable();
        this._workspacesController?.disable();
        this._layoutController?.disable();
        this._backgroundController?.disable();

        this._scrollController = null;
        this._windowPreviewController = null;
        this._appGridLayoutController = null;
        this._iconController = null;
        this._appGridController = null;
        this._workspacesController = null;
        this._layoutController = null;
        this._backgroundController = null;
        this._searchEntry = null;
        this._controls = null;
        this._layoutManager = null;
        this._appDisplay = null;
        this._workspacesDisplay = null;
        this._workspacesView = null;
        this._settings = null;
    }
}
