import { IconAnimator } from "./iconAnimations.js";

export class IconInteractionController {
    static ICON_TEXTURE_OVERSAMPLE = 1.5;

    static ICON_SIZE_PX = {
        small: 48,
        medium: 64,
        large: 80,
        "extra-large": 96,
    };

    constructor(settings, appDisplay) {
        this._settings = settings;
        this._appDisplay = appDisplay;
    }

    updateNamesVisibility() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;
        const mode = this._settings.get_string("app-grid-names-visibility");
        for (let index = 0; index < grid.get_n_children(); index++)
            this.applyNameVisibilityMode(grid.get_child_at_index(index), mode);
    }

    applyNameVisibilityMode(item, mode) {
        const label = item?.icon?.label;
        if (!label) return;
        this._ensureHoverHandler(item);
        if (mode === "never") label.visible = false;
        else if (mode === "hover") label.visible = item.hover ?? false;
        else label.visible = true;
    }

    applyIconSize(item) {
        const icon = item?.icon?.icon;
        if (!icon || icon.is_destroyed?.()) return;
        if (icon._chOriginalIconSize === undefined)
            icon._chOriginalIconSize = icon.icon_size;

        const key = this._settings.get_string("app-grid-icon-size");
        const displaySize = IconInteractionController.ICON_SIZE_PX[key] ?? 64;
        icon.icon_size = Math.round(
            displaySize * IconInteractionController.ICON_TEXTURE_OVERSAMPLE,
        );
        icon.set_size(displaySize, displaySize);
    }

    disable() {
        const grid = this._appDisplay?._grid;
        if (!grid) return;
        for (let index = 0; index < grid.get_n_children(); index++) {
            const item = grid.get_child_at_index(index);
            const label = item?.icon?.label;
            if (label) label.visible = true;
            const icon = item?.icon?.icon;
            if (icon) {
                IconAnimator.reset(icon);
                if (icon._chOriginalIconSize !== undefined) {
                    icon.icon_size = icon._chOriginalIconSize;
                    icon.set_size(-1, -1);
                    icon._chOriginalIconSize = undefined;
                }
            }
            if (item?._chHoverHandlerId) {
                item.disconnect(item._chHoverHandlerId);
                item._chHoverHandlerId = 0;
            }
            if (item?._chPressHandlerId) {
                item.disconnect(item._chPressHandlerId);
                item._chPressHandlerId = 0;
            }
        }
    }

    _animate(item, kind) {
        const icon = item?.icon?.icon;
        if (!icon) return;
        const active = kind === "press" ? item.pressed : item.hover;
        const prefix =
            kind === "press" ? "app-grid-icon-press" : "app-grid-icon-hover";
        const curveName = this._settings.get_string(`${prefix}-curve`);
        IconAnimator.scale(icon, {
            active,
            targetScale: this._settings.get_double(`${prefix}-scale`),
            curveName,
            inDuration: this._getCurveDuration(
                `${prefix}-in-durations`,
                curveName,
            ),
            outDuration: this._getCurveDuration(
                `${prefix}-out-durations`,
                curveName,
            ),
        });
    }

    _getCurveDuration(key, curveName) {
        const values = this._settings.get_value(key).deep_unpack();
        return curveName in values ? values[curveName] : 200;
    }

    _ensureHoverHandler(item) {
        if (item._chHoverHandlerId) return;
        item.track_hover = true;
        item._chHoverHandlerId = item.connect("notify::hover", () => {
            if (
                this._settings.get_string("app-grid-names-visibility") ===
                "hover"
            ) {
                const label = item.icon?.label;
                if (label) label.visible = item.hover;
            }
            this._animate(item, "hover");
        });
        item.connect("destroy", () => {
            item._chHoverHandlerId = 0;
        });
        item._chPressHandlerId = item.connect("notify::pressed", () => {
            this._animate(item, "press");
        });
        item.connect("destroy", () => {
            item._chPressHandlerId = 0;
        });
    }
}
