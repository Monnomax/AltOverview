import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import { WindowPreview } from "resource:///org/gnome/shell/ui/windowPreview.js";

export class WindowPreviewController {
    constructor(settings) {
        this._settings = settings;
        this._injectionManager = new InjectionManager();
        this._previews = new Set();
        this._settingsChangedId = 0;
    }

    enable() {
        const previewPrototype = WindowPreview.prototype;
        this._injectionManager.overrideMethod(
            previewPrototype,
            "_init",
            (originalMethod) => {
                const controller = this;
                return function (...args) {
                    originalMethod.call(this, ...args);
                    controller._previews.add(this);
                    this.connect("destroy", () =>
                        controller._previews.delete(this),
                    );
                    controller._updatePreview(this);
                };
            },
        );
        this._injectionManager.overrideMethod(
            previewPrototype,
            "_windowCanClose",
            (originalMethod) => {
                const controller = this;
                return function () {
                    return (
                        controller._settings.get_boolean(
                            "show-window-close-button",
                        ) && originalMethod.call(this)
                    );
                };
            },
        );
        this._settingsChangedId = this._settings.connect(
            "changed::show-window-close-button",
            () => this._updatePreviews(),
        );
        this._updatePreviews();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        this._injectionManager.clear();
        for (const preview of this._previews) {
            const closeButton = preview._closeButton;
            if (closeButton)
                closeButton.visible =
                    preview._overlayShown && preview._windowCanClose();
        }
        this._previews.clear();
    }

    _updatePreviews() {
        this._collectPreviews(global.stage);
        for (const preview of this._previews) this._updatePreview(preview);
    }

    _collectPreviews(actor) {
        if (actor instanceof WindowPreview) this._previews.add(actor);
        for (const child of actor.get_children?.() ?? [])
            this._collectPreviews(child);
    }

    _updatePreview(preview) {
        const closeButton = preview._closeButton;
        if (!closeButton) return;

        const shouldShow =
            this._settings.get_boolean("show-window-close-button") &&
            preview._overlayShown &&
            preview._windowCanClose();
        closeButton.visible = shouldShow;
        if (shouldShow) closeButton.opacity = 255;
    }
}
