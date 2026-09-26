import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";
import { WindowPreview } from "resource:///org/gnome/shell/ui/windowPreview.js";

const TOOLTIP_ICON_GAP = 10;

export class WindowPreviewController {
    constructor(settings) {
        this._settings = settings;
        this._injectionManager = new InjectionManager();
        this._previews = new Set();
        this._settingsChangedId = 0;
        this._tooltipPositionChangedId = 0;
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

        /*
         * Keep GNOME's original showOverlay() completely intact.
         *
         * In "hidden" mode, temporarily suppress only title.show().
         * GNOME can therefore continue handling the rest of the overlay
         * normally: close button, animations, scaling, etc.
         */
        this._injectionManager.overrideMethod(
            previewPrototype,
            "showOverlay",
            (originalMethod) => {
                const controller = this;

                return function (animate) {
                    const position = controller._settings.get_string(
                        "workspace-tooltip-position",
                    );

                    if (position !== "hidden") {
                        originalMethod.call(this, animate);
                        return;
                    }

                    const title = this._title;

                    if (!title) {
                        originalMethod.call(this, animate);
                        return;
                    }

                    const originalShow = title.show;

                    /*
                     * Make GNOME's title.show() a no-op only while the
                     * original showOverlay() is executing.
                     */
                    title.show = function () {};

                    /*
                     * Make sure the title is already invisible in case
                     * hidden mode was selected while the overlay was shown.
                     */
                    title.remove_all_transitions();
                    title.hide();
                    title.opacity = 0;

                    try {
                        originalMethod.call(this, animate);
                    } finally {
                        title.show = originalShow;

                        /*
                         * GNOME's original showOverlay() may have changed
                         * opacity through ease(), so force the hidden state
                         * once more after it has finished.
                         */
                        title.remove_all_transitions();
                        title.hide();
                        title.opacity = 0;
                    }
                };
            },
        );

        /*
         * GNOME calculates the native icon/title position here.
         * Keep that calculation intact and apply our tooltip position
         * afterwards.
         */
        this._injectionManager.overrideMethod(
            previewPrototype,
            "_adjustOverlayOffsets",
            (originalMethod) => {
                const controller = this;

                return function (...args) {
                    originalMethod.call(this, ...args);
                    controller._updateTooltipPosition(this);
                };
            },
        );

        this._settingsChangedId = this._settings.connect(
            "changed::show-window-close-button",
            () => this._updatePreviews(),
        );

        this._tooltipPositionChangedId = this._settings.connect(
            "changed::workspace-tooltip-position",
            () => this._updateTooltipPositions(),
        );

        this._updatePreviews();
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        if (this._tooltipPositionChangedId) {
            this._settings.disconnect(this._tooltipPositionChangedId);
            this._tooltipPositionChangedId = 0;
        }

        /*
         * Restore native GNOME title state before removing our overrides.
         */
        for (const preview of this._previews) {
            const title = preview._title;

            if (title) {
                title.remove_all_transitions();
                title.show();
                title.opacity = 255;
            }

            preview._adjustOverlayOffsets?.();
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

    _updateTooltipPositions() {
        for (const preview of this._previews) preview._adjustOverlayOffsets?.();
    }

    _updateTooltipPosition(preview) {
        const title = preview?._title;
        const icon = preview?._icon;

        if (!title || !icon) return;

        const position = this._settings.get_string(
            "workspace-tooltip-position",
        );

        const parent = title.get_parent();

        if (!parent) return;

        /*
         * Hidden:
         * showOverlay() itself prevents GNOME from calling title.show().
         * Keep the title hidden here as well for immediate settings changes.
         */
        if (position === "hidden") {
            title.remove_all_transitions();
            title.hide();
            title.opacity = 0;
            return;
        }

        /*
         * Native GNOME position:
         * 12 px below the icon.
         */
        if (position === "below") {
            parent.set_child_below_sibling(title, icon);
            return;
        }

        /*
         * Above:
         * exactly 12 px above the icon.
         */
        const iconTop = icon.allocation.y1 + icon.translation_y;

        const titleHeight = title.allocation.get_height();

        const titleTop = title.allocation.y1 + title.translation_y;

        const targetTitleTop = iconTop - titleHeight - TOOLTIP_ICON_GAP;

        title.translation_y += targetTitleTop - titleTop;

        parent.set_child_above_sibling(title, icon);
    }

    _collectPreviews(actor) {
        if (actor instanceof WindowPreview) this._previews.add(actor);

        for (const child of actor.get_children?.() ?? [])
            this._collectPreviews(child);
    }

    _updatePreview(preview) {
        const closeButton = preview._closeButton;

        if (closeButton) {
            const shouldShow =
                this._settings.get_boolean("show-window-close-button") &&
                preview._overlayShown &&
                preview._windowCanClose();

            closeButton.visible = shouldShow;

            if (shouldShow) closeButton.opacity = 255;
        }

        preview._adjustOverlayOffsets?.();
    }
}
